/**
 * Ссылки в терминале, которые сам VS Code не откроет: сообщение OneScript
 * с номером строки в тексте и путь по метаданным. Обычный путь к файлу
 * не размечается: ссылка расширения заменяет штатную и не отдаёт клик обратно.
 * @module terminalLinks
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { METADATA_TYPE_NAMES, resolveBslPathFromMetadata } from '../diagnostics/metadataPathResolver';
import { resolveProjectLayout, type SourceRoot } from '../../shared/projectLayout';
import { sourcePath } from '../../shared/objectPaths';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { logger } from '../../shared/logger';
import { terminalProjectRoot } from '../tasks/terminalProjects';

const log = logger.scope('tools');

const MAX_LINE_LENGTH = 2000;

export type TerminalLinkTarget =
	| { kind: 'file'; file: string; line?: number }
	| { kind: 'metadata'; metadataPath: string; line?: number };

export interface TerminalLinkMatch {
	startIndex: number;
	length: number;
	target: TerminalLinkTarget;
}

const ONESCRIPT_PATTERN =
	String.raw`Модуль\s+(?<file>[^\r\n]+?\.os)\s*/\s*Ошибка в строке:\s*(?<line>\d+)`;

// `\b` считает словом только латиницу и перед `ОбщийМодуль` не срабатывает.
const METADATA_PATTERN =
	String.raw`(?<![A-Za-zА-Яа-яЁё0-9_.])` +
	String.raw`(?<path>(?:${METADATA_TYPE_NAMES.join('|')})(?:\.[A-Za-zА-Яа-яЁё0-9_]+){2,4})` +
	String.raw`(?:\((?<line>\d+)\))?`;

function toLine(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function overlaps(found: readonly { startIndex: number; length: number }[], start: number, length: number): boolean {
	return found.some((item) => start < item.startIndex + item.length && item.startIndex < start + length);
}

export function findTerminalLinkMatches(line: string): TerminalLinkMatch[] {
	const source = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line;
	const found: TerminalLinkMatch[] = [];

	for (const match of source.matchAll(new RegExp(ONESCRIPT_PATTERN, 'g'))) {
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

	for (const match of source.matchAll(new RegExp(METADATA_PATTERN, 'g'))) {
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

	return found;
}

interface ResolvedTerminalLink extends vscode.TerminalLink {
	target: TerminalLinkTarget;
	root: string | undefined;
	resolvedFile: string;
}

export class SourceTerminalLinkProvider implements vscode.TerminalLinkProvider<ResolvedTerminalLink> {
	constructor(private readonly vrunner: VRunnerManager) {}

	async provideTerminalLinks(
		context: vscode.TerminalLinkContext,
		token: vscode.CancellationToken
	): Promise<ResolvedTerminalLink[]> {
		if (token.isCancellationRequested) {
			return [];
		}
		const root = terminalProjectRoot(context.terminal) ?? this.vrunner.getWorkspaceRoot();
		const links: ResolvedTerminalLink[] = [];
		for (const match of findTerminalLinkMatches(context.line)) {
			if (token.isCancellationRequested) {
				return links;
			}
			const resolvedFile = await resolveTerminalLinkTarget(match.target, root);
			if (!resolvedFile) {
				continue;
			}
			links.push({
				startIndex: match.startIndex,
				length: match.length,
				target: match.target,
				root,
				resolvedFile,
				tooltip: match.target.kind === 'metadata' ? 'Открыть модуль' : 'Открыть файл',
			});
		}
		return links;
	}

	async handleTerminalLink(link: ResolvedTerminalLink): Promise<void> {
		try {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(link.resolvedFile));
			const editor = await vscode.window.showTextDocument(document);
			const lineNumber = link.target.line;
			if (lineNumber !== undefined) {
				const position = new vscode.Position(Math.max(0, lineNumber - 1), 0);
				editor.selection = new vscode.Selection(position, position);
				editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
			}
		} catch (error) {
			log.debug(`не открыли исходник: ${String(error)}`);
		}
	}
}

export async function resolveTerminalLinkTarget(target: TerminalLinkTarget, root: string | undefined): Promise<string | undefined> {
	if (target.kind === 'file') {
		const candidate = path.isAbsolute(target.file)
			? target.file
			: root
				? path.resolve(root, target.file)
				: undefined;
		return candidate && (await exists(candidate)) ? candidate : undefined;
	}
	return root ? resolveMetadataInProject(target.metadataPath, root) : undefined;
}

async function resolveMetadataInProject(metadataPath: string, root: string): Promise<string | undefined> {
	let roots: SourceRoot[];
	try {
		const layout = await resolveProjectLayout(root);
		roots = [
			...(layout.configuration ? [layout.configuration] : []),
			...layout.extensions,
			...layout.testExtensions,
			...layout.others,
		];
	} catch (error) {
		log.info(`раскладка проекта не прочиталась: ${String(error)}`);
		return undefined;
	}
	return resolveMetadataInRoots(metadataPath, roots);
}

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
