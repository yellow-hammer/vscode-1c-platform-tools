/**
 * Ссылки в терминале на исходники по выводу команд.
 *
 * Разбираются три записи, встречающиеся в выводе:
 *   - OneScript: `{Модуль <путь>.os / Ошибка в строке: 188 / …}`;
 *   - путь к файлу с необязательным номером строки: `…/Module.bsl:12`, `…(12)`;
 *   - путь по метаданным 1С: `HTTPСервис.Биллинг.Модуль`, в конце может стоять `(12)`.
 *
 * Путь по метаданным раскладывается в файл по формату исходников: выгрузка
 * конфигуратора и проект EDT различаются каталогом `Ext`. Формат и корни
 * берутся из раскладки проекта, поэтому ссылка работает и в конфигурации,
 * и в расширениях.
 *
 * Разбор строки — чистая функция, тестируется без vscode.
 * @module terminalLinks
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { METADATA_TYPE_NAMES, resolveBslPathFromMetadata } from '../diagnostics/metadataPathResolver';
import { resolveProjectLayout, type SourceRoot } from '../../shared/projectLayout';
import { sourcePath } from '../../shared/objectPaths';
import { DEFAULT_PATHS } from '../../shared/pathDefaults';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { logger } from '../../shared/logger';

const log = logger.scope('tools');

/** Расширения файлов, на которые ставится ссылка. */
const LINKED_EXTENSIONS = ['bsl', 'os', 'feature', 'xml', 'mdo', 'json', 'md'];

/** Цель ссылки: файл на диске либо путь по метаданным. */
export type TerminalLinkTarget =
	| { kind: 'file'; file: string; line?: number }
	| { kind: 'metadata'; metadataPath: string; line?: number };

/** Найденный в строке фрагмент со ссылкой. */
export interface TerminalLinkMatch {
	/** Смещение фрагмента в строке. */
	startIndex: number;
	/** Длина фрагмента. */
	length: number;
	target: TerminalLinkTarget;
}

const EXTENSIONS_GROUP = LINKED_EXTENSIONS.join('|');

/** OneScript: путь модуля и номер строки в одном сообщении. */
const ONESCRIPT_RE = new RegExp(
	String.raw`Модуль\s+(?<file>[^\r\n]+?\.os)\s*/\s*Ошибка в строке:\s*(?<line>\d+)`,
	'g'
);

/**
 * Путь к файлу с необязательным номером строки.
 *
 * Токен берётся целиком: перед ним должен идти пробел, кавычка или скобка,
 * иначе из `src/cf/…/Module.bsl` вырезался бы кусок от внутреннего слэша.
 */
const FILE_RE = new RegExp(
	String.raw`(?<![^\s"'(\[<>|])(?<file>[^\s"'<>|]+\.(?:${EXTENSIONS_GROUP}))` +
	String.raw`(?:\((?<paren>\d+)\)|:(?<colon>\d+))?`,
	'g'
);

/**
 * Путь по метаданным: известный тип, имя объекта и хвост.
 *
 * Границу слова `\b` использовать нельзя: она считает словом только латиницу,
 * поэтому перед `ОбщийМодуль` не срабатывала. Проверяется предыдущий символ.
 */
const METADATA_RE = new RegExp(
	String.raw`(?<![A-Za-zА-Яа-яЁё0-9_.])` +
	String.raw`(?<path>(?:${METADATA_TYPE_NAMES.join('|')})(?:\.[A-Za-zА-Яа-яЁё0-9_]+){2,4})` +
	String.raw`(?:\((?<line>\d+)\))?`,
	'g'
);

function toLine(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Пересекается ли фрагмент с уже найденными. */
function overlaps(found: TerminalLinkMatch[], start: number, length: number): boolean {
	return found.some((m) => start < m.startIndex + m.length && m.startIndex < start + length);
}

/**
 * Находит в строке вывода фрагменты, из которых делается ссылка.
 *
 * Записи разбираются по очереди: сначала OneScript (там путь и строка идут
 * вместе), затем обычные пути, затем пути по метаданным. Пересекающиеся
 * фрагменты отбрасываются, поэтому путь внутри записи OneScript не удваивается.
 *
 * @param line - Одна строка вывода терминала
 * @returns Фрагменты со ссылками в порядке появления
 */
export function findTerminalLinkMatches(line: string): TerminalLinkMatch[] {
	const found: TerminalLinkMatch[] = [];

	for (const match of line.matchAll(ONESCRIPT_RE)) {
		const file = match.groups?.file;
		if (!file || match.index === undefined) {
			continue;
		}
		const startIndex = match.index + match[0].indexOf(file);
		found.push({
			startIndex,
			length: file.length,
			target: { kind: 'file', file, line: toLine(match.groups?.line) },
		});
	}

	for (const match of line.matchAll(FILE_RE)) {
		const file = match.groups?.file;
		if (!file || match.index === undefined || overlaps(found, match.index, match[0].length)) {
			continue;
		}
		found.push({
			startIndex: match.index,
			length: match[0].length,
			target: {
				kind: 'file',
				file,
				line: toLine(match.groups?.paren ?? match.groups?.colon),
			},
		});
	}

	for (const match of line.matchAll(METADATA_RE)) {
		const metadataPath = match.groups?.path;
		if (!metadataPath || match.index === undefined || overlaps(found, match.index, match[0].length)) {
			continue;
		}
		found.push({
			startIndex: match.index,
			length: match[0].length,
			target: { kind: 'metadata', metadataPath, line: toLine(match.groups?.line) },
		});
	}

	return found.sort((a, b) => a.startIndex - b.startIndex);
}

/** Ссылка терминала с разобранной целью. */
interface ResolvedTerminalLink extends vscode.TerminalLink {
	target: TerminalLinkTarget;
}

/**
 * Провайдер ссылок терминала: открывает исходник по клику в выводе команд.
 */
export class SourceTerminalLinkProvider implements vscode.TerminalLinkProvider<ResolvedTerminalLink> {
	constructor(private readonly vrunner: VRunnerManager) {}

	provideTerminalLinks(context: vscode.TerminalLinkContext): ResolvedTerminalLink[] {
		return findTerminalLinkMatches(context.line).map((match) => ({
			startIndex: match.startIndex,
			length: match.length,
			target: match.target,
			tooltip: match.target.kind === 'metadata' ? 'Открыть модуль' : 'Открыть файл',
		}));
	}

	async handleTerminalLink(link: ResolvedTerminalLink): Promise<void> {
		const file = await this.resolveTarget(link.target);
		if (!file) {
			void vscode.window.showWarningMessage('Не нашли исходник для этой ссылки.');
			return;
		}
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const editor = await vscode.window.showTextDocument(document);
		const lineNumber = link.target.line;
		if (lineNumber !== undefined) {
			const position = new vscode.Position(Math.max(0, lineNumber - 1), 0);
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
		}
	}

	/** Абсолютный путь к существующему файлу либо undefined. */
	private async resolveTarget(target: TerminalLinkTarget): Promise<string | undefined> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (target.kind === 'file') {
			const candidate = path.isAbsolute(target.file)
				? target.file
				: workspaceRoot
					? path.resolve(workspaceRoot, target.file)
					: undefined;
			return candidate && (await exists(candidate)) ? candidate : undefined;
		}
		return workspaceRoot ? this.resolveMetadata(target.metadataPath, workspaceRoot) : undefined;
	}

	/**
	 * Ищет модуль по пути метаданных во всех корнях рабочей области.
	 *
	 * Порядок: конфигурация, расширения, прочие корни. Формат берётся у самого
	 * корня, поэтому в одной рабочей области могут лежать и выгрузка
	 * конфигуратора, и проект EDT.
	 */
	private async resolveMetadata(metadataPath: string, workspaceRoot: string): Promise<string | undefined> {
		let roots: SourceRoot[];
		try {
			const layout = await resolveProjectLayout(workspaceRoot, {
				configuration: vscode.workspace
					.getConfiguration('1c-platform-tools')
					.get<string>('path.cf', DEFAULT_PATHS.cf),
				extensions: [this.vrunner.getCfePath(), this.vrunner.getTestsCfePath()],
			});
			roots = [
				...(layout.configuration ? [layout.configuration] : []),
				...layout.extensions,
				...layout.others,
			];
		} catch (error) {
			log.info(`раскладка проекта не прочиталась: ${String(error)}`);
			return undefined;
		}

		return resolveMetadataInRoots(metadataPath, roots);
	}
}

/**
 * Ищет файл модуля по пути метаданных в заданных корнях.
 *
 * Формат берётся у каждого корня отдельно, поэтому в одной рабочей области
 * могут лежать и выгрузка конфигуратора, и проект EDT. Возвращается первый
 * существующий файл, поэтому порядок корней задаёт приоритет.
 *
 * @param metadataPath - Путь по метаданным, например `ОбщийМодуль.Имя.Модуль`
 * @param roots - Корни конфигурации и расширений в порядке поиска
 * @returns Абсолютный путь к найденному модулю либо undefined
 */
export async function resolveMetadataInRoots(
	metadataPath: string,
	roots: readonly Pick<SourceRoot, 'dir' | 'format'>[]
): Promise<string | undefined> {
	for (const root of roots) {
		const relative = resolveBslPathFromMetadata(metadataPath, root.format);
		if (!relative) {
			continue;
		}
		const candidate = sourcePath(root as SourceRoot, relative);
		if (await exists(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

async function exists(file: string): Promise<boolean> {
	try {
		const stat = await fs.stat(file);
		return stat.isFile();
	} catch {
		return false;
	}
}
