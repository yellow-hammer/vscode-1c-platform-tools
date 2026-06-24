import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { logger } from '../../shared/logger';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { DEFAULT_PATHS } from '../../shared/pathDefaults';
import {
	resolveConfigPath,
	syntaxCheckJUnitPathFromEnv,
	syntaxCheckGroupByMetadataFromEnv,
} from '../testing/projectTestConfig';
import { parseSyntaxCheckFindings, SyntaxCheckFinding, SyntaxCheckSeverity } from './syntaxCheckJUnit';
import { resolveBslPathFromMetadata } from './metadataPathResolver';
import { extractQuotedIdentifier, findIdentifierOffsets, LineMap } from './bslLocator';

const log = logger.scope('syntax-check');

/** Источник диагностик в панели Problems */
const DIAGNOSTIC_SOURCE = '1С: синтаксический контроль';

/** Путь к junit-отчёту по умолчанию (если не задан в env.json) */
const DEFAULT_JUNIT_REL = 'build/out/syntax-check/junit/junit.xml';

/**
 * Диагностика синтаксического контроля в панели Problems.
 *
 * Источник данных — jUnit-отчёт vrunner syntax-check; путь берётся из env.json
 * (секция syntax-check, --junitpath; формат vanessa-runner v2), с откатом на
 * стандартный путь. Обновление завязано на FileSystemWatcher по файлу отчёта:
 * UI-режим запускает vrunner в терминале «выстрелил и забыл», поэтому опираться
 * на момент завершения команды нельзя — перечитываем отчёт по факту перезаписи.
 * Перезапуск env.json меняет путь → watcher пересоздаётся.
 *
 * Номера строк vrunner не выдаёт: каждая находка ставится в начало файла модуля
 * (range 0:0). Метаданные, не разложившиеся в .bsl (справка, неизвестные типы),
 * собираются на fallback-файле (Configuration.xml) с префиксом пути в тексте.
 */
export class SyntaxCheckDiagnostics implements vscode.Disposable {
	private readonly collection: vscode.DiagnosticCollection;
	private readonly disposables: vscode.Disposable[] = [];
	/** Watcher'ы, пересоздаваемые при reconfigure (файл отчёта + активный env-файл) */
	private readonly reconfigurableListeners: vscode.Disposable[] = [];

	constructor(private readonly vrunner: VRunnerManager) {
		this.collection = vscode.languages.createDiagnosticCollection('1c-syntax-check');
		this.disposables.push(this.collection);

		// Смена активного профиля запуска меняет читаемый env-файл и путь к отчёту
		this.disposables.push(
			this.vrunner.onDidChangeActiveEnvProfile(() => void this.reconfigure())
		);
		// Дефолтный профиль может задаваться настройкой
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration('1c-platform-tools.defaultEnvProfile')) {
					void this.reconfigure();
				}
			})
		);

		void this.reconfigure();
	}

	/**
	 * Пересоздаёт watcher'ы (активный env-файл + файл отчёта) и перечитывает отчёт
	 */
	private async reconfigure(): Promise<void> {
		const root = this.vrunner.getWorkspaceRoot();

		for (const listener of this.reconfigurableListeners.splice(0)) {
			listener.dispose();
		}
		if (!root) {
			this.collection.clear();
			return;
		}

		// Следим за активным env-файлом: правка пути/опции syntax-check → пересборка
		const envWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(root, this.vrunner.getActiveEnvFile())
		);
		this.reconfigurableListeners.push(
			envWatcher,
			envWatcher.onDidChange(() => void this.reconfigure()),
			envWatcher.onDidCreate(() => void this.reconfigure()),
			envWatcher.onDidDelete(() => void this.reconfigure())
		);

		// Следим за файлом отчёта: перезапись после прогона → обновление диагностики
		const junitAbs = await this.resolveJunitPath(root);
		const junitWatcher = vscode.workspace.createFileSystemWatcher(buildWatchPattern(root, junitAbs));
		this.reconfigurableListeners.push(
			junitWatcher,
			junitWatcher.onDidChange(() => void this.refresh()),
			junitWatcher.onDidCreate(() => void this.refresh()),
			junitWatcher.onDidDelete(() => this.clear())
		);

		await this.refresh();
	}

	/**
	 * Разрешает абсолютный путь к junit-отчёту из env активного профиля
	 *
	 * Берётся файл выбранного профиля запуска (env.<id>.json), а не корневой
	 * env.json. Путь — из секции syntax-check (--junitpath), с откатом на дефолт.
	 */
	private async resolveJunitPath(root: string): Promise<string> {
		let rel = DEFAULT_JUNIT_REL;
		const envFile = this.vrunner.getActiveEnvFile();
		try {
			const envJson = (await this.vrunner.readEnvJson(envFile)) as Record<string, unknown>;
			const configured = syntaxCheckJUnitPathFromEnv(envJson);
			if (configured) {
				rel = configured;
			}
			if (syntaxCheckGroupByMetadataFromEnv(envJson) === false) {
				log.debug(
					'syntax-check.--groupbymetadata=false: имена testcase не по метаданным, ' +
						'диагностика уйдёт на fallback-файл'
				);
			}
		} catch (error) {
			log.debug(`не удалось прочитать ${envFile}: ${(error as Error).message}`);
		}
		return resolveConfigPath(rel, root);
	}

	/**
	 * Перечитывает отчёт и публикует диагностику (или очищает, если отчёта нет)
	 */
	public async refresh(): Promise<void> {
		const root = this.vrunner.getWorkspaceRoot();
		if (!root) {
			this.collection.clear();
			return;
		}

		const junitAbs = await this.resolveJunitPath(root);
		let xml: string;
		try {
			xml = await fs.readFile(junitAbs, 'utf8');
		} catch {
			// Отчёта ещё нет — показывать нечего
			this.collection.clear();
			return;
		}

		let findings: SyntaxCheckFinding[];
		try {
			findings = parseSyntaxCheckFindings(xml);
		} catch (error) {
			// Битый XML (например, vrunner пишет файл прямо сейчас) — не трогаем текущую диагностику
			log.warn(`не удалось разобрать ${junitAbs}: ${(error as Error).message}`);
			return;
		}

		await this.publish(findings, root);
	}

	/**
	 * Раскладывает находки по файлам и записывает в DiagnosticCollection
	 */
	private async publish(findings: SyntaxCheckFinding[], root: string): Promise<void> {
		const cfRel = vscode.workspace
			.getConfiguration('1c-platform-tools')
			.get<string>('paths.cf', DEFAULT_PATHS.cf);
		const cfRoot = path.join(root, cfRel);
		const fallbackUri = await resolveFallbackUri(cfRoot, root);

		// Группируем находки по целевому файлу (кэш «метаданные → файл»: у модуля много находок)
		const targetCache = new Map<string, ResolvedTarget>();
		const byFile = new Map<string, { target: ResolvedTarget; findings: SyntaxCheckFinding[] }>();

		for (const finding of findings) {
			let target = targetCache.get(finding.metadataPath);
			if (!target) {
				target = await resolveTarget(finding.metadataPath, cfRoot, fallbackUri);
				targetCache.set(finding.metadataPath, target);
			}
			const key = target.uri.toString();
			let group = byFile.get(key);
			if (!group) {
				group = { target, findings: [] };
				byFile.set(key, group);
			}
			group.findings.push(finding);
		}

		this.collection.clear();
		for (const { target, findings: fileFindings } of byFile.values()) {
			const diagnostics = target.resolved
				? await this.buildLocatedDiagnostics(target.uri, fileFindings)
				: fileFindings.map((finding) =>
						this.makeDiagnostic(
							new vscode.Range(0, 0, 0, 0),
							`${finding.metadataPath}: ${finding.message}`,
							finding
						)
				  );
			this.collection.set(target.uri, diagnostics);
		}
	}

	/**
	 * Строит диагностики для файла модуля, привязывая каждую к строке вызова
	 *
	 * Номеров строк в отчёте нет: позицию ищем по идентификатору метода из текста
	 * ошибки. Находки группируются по идентификатору; на каждое вхождение в модуле
	 * — отдельная диагностика. Если идентификатор не извлечён или не найден —
	 * откат на начало файла, чтобы число записей совпадало с отчётом.
	 */
	private async buildLocatedDiagnostics(
		uri: vscode.Uri,
		fileFindings: SyntaxCheckFinding[]
	): Promise<vscode.Diagnostic[]> {
		let text: string | undefined;
		try {
			// Файлы выгрузки — UTF-8 с BOM; снимаем BOM, чтобы смещения совпадали с позициями
			text = (await fs.readFile(uri.fsPath, 'utf8')).replace(/^﻿/, '');
		} catch {
			text = undefined;
		}

		const diagnostics: vscode.Diagnostic[] = [];
		const topOfFile = new vscode.Range(0, 0, 0, 0);

		if (!text) {
			for (const finding of fileFindings) {
				diagnostics.push(this.makeDiagnostic(topOfFile, finding.message, finding));
			}
			return diagnostics;
		}

		const lineMap = new LineMap(text);
		const byIdentifier = new Map<string, SyntaxCheckFinding[]>();
		const unlocatable: SyntaxCheckFinding[] = [];

		for (const finding of fileFindings) {
			const identifier = extractQuotedIdentifier(finding.message);
			if (identifier) {
				const group = byIdentifier.get(identifier) ?? [];
				group.push(finding);
				byIdentifier.set(identifier, group);
			} else {
				unlocatable.push(finding);
			}
		}

		for (const [identifier, group] of byIdentifier) {
			const offsets = findIdentifierOffsets(text, identifier);
			const located = Math.min(offsets.length, group.length);
			for (let i = 0; i < located; i++) {
				const start = lineMap.positionAt(offsets[i]);
				const range = new vscode.Range(
					start.line,
					start.character,
					start.line,
					start.character + identifier.length
				);
				diagnostics.push(this.makeDiagnostic(range, group[i].message, group[i]));
			}
			// Находки сверх числа вхождений (или если вхождений нет) — на начало файла
			for (let i = located; i < group.length; i++) {
				diagnostics.push(this.makeDiagnostic(topOfFile, group[i].message, group[i]));
			}
		}

		for (const finding of unlocatable) {
			diagnostics.push(this.makeDiagnostic(topOfFile, finding.message, finding));
		}

		return diagnostics;
	}

	/** Создаёт диагностику с общими полями (источник, код = путь по метаданным) */
	private makeDiagnostic(
		range: vscode.Range,
		message: string,
		finding: SyntaxCheckFinding
	): vscode.Diagnostic {
		const diagnostic = new vscode.Diagnostic(range, message, toDiagnosticSeverity(finding.severity));
		diagnostic.source = DIAGNOSTIC_SOURCE;
		diagnostic.code = finding.metadataPath;
		return diagnostic;
	}

	/** Очищает диагностику синтаксического контроля */
	public clear(): void {
		this.collection.clear();
	}

	public dispose(): void {
		for (const listener of this.reconfigurableListeners.splice(0)) {
			listener.dispose();
		}
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}
	}
}

/** Целевой файл для находки */
interface ResolvedTarget {
	uri: vscode.Uri;
	/** true — нашли файл модуля; false — fallback-файл */
	resolved: boolean;
}

/**
 * Определяет файл для находки: модуль по метаданным или fallback
 */
async function resolveTarget(
	metadataPath: string,
	cfRoot: string,
	fallbackUri: vscode.Uri
): Promise<ResolvedTarget> {
	const relCandidate = resolveBslPathFromMetadata(metadataPath);
	if (relCandidate) {
		const abs = path.join(cfRoot, relCandidate.split('/').join(path.sep));
		if (await fileExists(abs)) {
			return { uri: vscode.Uri.file(abs), resolved: true };
		}
	}
	return { uri: fallbackUri, resolved: false };
}

/**
 * Выбирает fallback-файл для находок без сопоставления: Configuration.xml, иначе env.json
 */
async function resolveFallbackUri(cfRoot: string, root: string): Promise<vscode.Uri> {
	const configurationXml = path.join(cfRoot, 'Configuration.xml');
	if (await fileExists(configurationXml)) {
		return vscode.Uri.file(configurationXml);
	}
	return vscode.Uri.file(path.join(root, 'env.json'));
}

/**
 * Строит шаблон слежения за файлом отчёта
 *
 * Внутри workspace — относительно корня (рекурсивный watcher ловит создание во
 * вложенных каталогах, даже если каталог отчёта ещё не существует). Вне workspace
 * — по базовому каталогу файла.
 */
function buildWatchPattern(root: string, junitAbs: string): vscode.RelativePattern {
	const rel = path.relative(root, junitAbs);
	if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
		return new vscode.RelativePattern(root, rel.split(path.sep).join('/'));
	}
	return new vscode.RelativePattern(vscode.Uri.file(path.dirname(junitAbs)), path.basename(junitAbs));
}

async function fileExists(absPath: string): Promise<boolean> {
	try {
		await fs.access(absPath);
		return true;
	} catch {
		return false;
	}
}

function toDiagnosticSeverity(severity: SyntaxCheckSeverity): vscode.DiagnosticSeverity {
	return severity === 'warning'
		? vscode.DiagnosticSeverity.Warning
		: vscode.DiagnosticSeverity.Error;
}
