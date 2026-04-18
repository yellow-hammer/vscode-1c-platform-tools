/**
 * Поиск артефактов 1С в workspace через {@link vscode.workspace.findFiles}.
 *
 * Порядок: один проход по `Configuration.xml` (конфигурации, расширения, префиксы для прунинга);
 * пул из пяти лёгких сканов (feature, cf, cfe, epf, erf) с ограниченным параллелизмом;
 * один проход по `*.xml` с пропуском файлов внутри деревьев исходников конфигурации/расширения
 * и одним чтением заголовка на оставшийся кандидат.
 *
 * @module artifactsScanner
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';

const XML_HEAD_SIZE = 4096;
const CANCEL_CHECK_INTERVAL = 512;

function getExcludeSegments(): string[] {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const arr = config.get<string[]>('artifacts.exclude');
	if (Array.isArray(arr)) {
		return arr.filter((s): s is string => typeof s === 'string' && s.length > 0);
	}
	const fromSchema = config.inspect<string[]>('artifacts.exclude')?.defaultValue;
	return Array.isArray(fromSchema) ? fromSchema.filter((s): s is string => typeof s === 'string') : [];
}

function isUriExcluded(uri: vscode.Uri, excludeSegments: string[]): boolean {
	if (excludeSegments.length === 0) {
		return false;
	}
	const pathNorm = uri.fsPath.replaceAll('\\', '/');
	return excludeSegments.some(
		(seg) => pathNorm.includes(`/${seg}/`) || pathNorm.endsWith(`/${seg}`)
	);
}

function throwIfCancelled(token: vscode.CancellationToken | undefined): void {
	if (token?.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
}

/**
 * Нормализованный префикс каталога (нижний регистр, с завершающим path.sep) для сравнения путей под Windows.
 */
function directoryAsRootPrefix(dir: string): string {
	const n = path.normalize(dir);
	const withSep = n.endsWith(path.sep) ? n : n + path.sep;
	return withSep.toLowerCase();
}

/**
 * true, если файл лежит внутри или в корне одного из деревьев исходников конфигурации/расширения
 * (родительский каталог Configuration.xml и всё ниже).
 */
function isUnderConfigOrExtensionTree(filePath: string, rootPrefixes: string[]): boolean {
	if (rootPrefixes.length === 0) {
		return false;
	}
	const fp = path.normalize(filePath).toLowerCase();
	return rootPrefixes.some((root) => fp.startsWith(root));
}

type PoolFnTuple = readonly (() => Promise<unknown>)[];

/**
 * Тип кортежа сканеров: без него TypeScript сводит возвращаемые типы к объединению.
 * @internal
 */
type BinaryScansPool = readonly [
	() => Promise<FeatureArtifact[]>,
	() => Promise<ConfigurationArtifact[]>,
	() => Promise<ExtensionArtifact[]>,
	() => Promise<ProcessorArtifact[]>,
	() => Promise<ReportArtifact[]>,
];

/**
 * Выполняет независимые async-задачи с ограничением числа одновременно выполняющихся.
 */
async function runPoolTuple<T extends PoolFnTuple>(
	fns: T,
	concurrency: number,
	token: vscode.CancellationToken | undefined
): Promise<{ [I in keyof T]: Awaited<ReturnType<T[I]>> }> {
	if (fns.length === 0) {
		return [] as { [I in keyof T]: Awaited<ReturnType<T[I]>> };
	}
	const results: unknown[] = new Array(fns.length);
	let next = 0;
	const nWorkers = Math.min(Math.max(1, concurrency), fns.length);

	async function worker(): Promise<void> {
		while (true) {
			throwIfCancelled(token);
			const i = next++;
			if (i >= fns.length) {
				return;
			}
			results[i] = await fns[i]();
		}
	}

	await Promise.all(Array.from({ length: nWorkers }, () => worker()));
	return results as { [I in keyof T]: Awaited<ReturnType<T[I]>> };
}

/** Feature-файл (Vanessa Automation). */
export interface FeatureArtifact {
	type: 'feature';
	uri: vscode.Uri;
	name: string;
	relativePath: string;
}

/** Конфигурация: каталог исходников или файл `.cf`. */
export interface ConfigurationArtifact {
	type: 'configuration';
	uri: vscode.Uri;
	name: string;
	relativePath: string;
	kind: 'source' | 'binary';
	/** Для `kind: 'source'` — `Configuration.xml` (открытие в редакторе). */
	sourceEntryUri?: vscode.Uri;
}

/** Расширение: каталог исходников или файл `.cfe`. */
export interface ExtensionArtifact {
	type: 'extension';
	uri: vscode.Uri;
	name: string;
	relativePath: string;
	kind: 'source' | 'binary';
	/** Для `kind: 'source'` — `Configuration.xml`. */
	sourceEntryUri?: vscode.Uri;
}

/** Внешняя обработка: каталог исходников или `.epf`. */
export interface ProcessorArtifact {
	type: 'processor';
	uri: vscode.Uri;
	name: string;
	relativePath: string;
	kind: 'source' | 'binary';
	/** Для `kind: 'source'` — корневой XML (`ExternalDataProcessor`). */
	sourceEntryUri?: vscode.Uri;
}

/** Внешний отчёт: каталог исходников или `.erf`. */
export interface ReportArtifact {
	type: 'report';
	uri: vscode.Uri;
	name: string;
	relativePath: string;
	kind: 'source' | 'binary';
	/** Для `kind: 'source'` — корневой XML (`ExternalReport`). */
	sourceEntryUri?: vscode.Uri;
}

export type Artifact =
	| FeatureArtifact
	| ConfigurationArtifact
	| ExtensionArtifact
	| ProcessorArtifact
	| ReportArtifact;

/** Результат {@link scanArtifacts}. */
export interface ArtifactsScanResult {
	features: FeatureArtifact[];
	configurations: ConfigurationArtifact[];
	extensions: ExtensionArtifact[];
	processors: ProcessorArtifact[];
	reports: ReportArtifact[];
}

function getWorkspaceRelativePath(uri: vscode.Uri): string {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders?.length) {
		return uri.fsPath;
	}
	const relative = vscode.workspace.asRelativePath(uri, false);
	return relative.replaceAll('\\', '/');
}

/**
 * Классификация по началу файла: корень внешней обработки или отчёта.
 * Ожидается фрагмент в начале файла (например первые 4 КБ).
 */
export function classifyXmlArtifactHead(content: string): 'processor' | 'report' | null {
	if (/<ExternalDataProcessor[\s>]/.test(content)) {
		return 'processor';
	}
	if (/<ExternalReport[\s>]/.test(content)) {
		return 'report';
	}
	return null;
}

/** Признак расширения: наличие `ObjectBelonging` в `Configuration.xml`. */
async function configurationXmlHasObjectBelonging(filePath: string): Promise<boolean> {
	try {
		const content = await fs.readFile(filePath, { encoding: 'utf-8', flag: 'r' });
		return /<ObjectBelonging>/.test(content);
	} catch {
		return false;
	}
}

async function readXmlHeadForClassification(filePath: string): Promise<string> {
	let fh: fs.FileHandle | undefined;
	try {
		fh = await fs.open(filePath, 'r');
		const buf = Buffer.alloc(XML_HEAD_SIZE);
		const { bytesRead } = await fh.read(buf, 0, XML_HEAD_SIZE, 0);
		return buf.subarray(0, bytesRead).toString('utf-8');
	} catch {
		return '';
	} finally {
		await fh?.close();
	}
}

interface ConfigExtensionSplit {
	configSources: ConfigurationArtifact[];
	extSources: ExtensionArtifact[];
	/** Нормализованные префиксы каталогов с `Configuration.xml` (пропуск вложенных XML при поиске epf/erf). */
	configTreeRootPrefixes: string[];
}

/** Один вызов {@link vscode.workspace.findFiles} по `Configuration.xml`. */
async function scanConfigurationAndExtensionSources(
	exclude: string[],
	token: vscode.CancellationToken | undefined
): Promise<ConfigExtensionSplit> {
	const files = await vscode.workspace.findFiles('**/Configuration.xml', undefined, undefined, token);
	const configSources: ConfigurationArtifact[] = [];
	const extSources: ExtensionArtifact[] = [];
	const configTreeRootPrefixes: string[] = [];

	let i = 0;
	for (const uri of files) {
		if (i++ % CANCEL_CHECK_INTERVAL === 0) {
			throwIfCancelled(token);
		}
		if (isUriExcluded(uri, exclude)) {
			continue;
		}
		const hasObjectBelonging = await configurationXmlHasObjectBelonging(uri.fsPath);
		const dir = path.dirname(uri.fsPath);
		configTreeRootPrefixes.push(directoryAsRootPrefix(dir));

		const dirUri = vscode.Uri.file(dir);
		const rel = getWorkspaceRelativePath(dirUri);
		const name = path.basename(dir);
		if (hasObjectBelonging) {
			extSources.push({
				type: 'extension',
				uri: dirUri,
				name,
				relativePath: rel,
				kind: 'source',
				sourceEntryUri: uri,
			});
		} else {
			configSources.push({
				type: 'configuration',
				uri: dirUri,
				name,
				relativePath: rel,
				kind: 'source',
				sourceEntryUri: uri,
			});
		}
	}

	return { configSources, extSources, configTreeRootPrefixes };
}

async function scanFeatures(
	exclude: string[],
	token: vscode.CancellationToken | undefined
): Promise<FeatureArtifact[]> {
	const files = await vscode.workspace.findFiles('**/*.feature', undefined, undefined, token);
	const filtered = files.filter((uri) => !isUriExcluded(uri, exclude));
	return filtered.map((uri) => {
		const rel = getWorkspaceRelativePath(uri);
		const name = path.basename(uri.fsPath);
		return { type: 'feature' as const, uri, name, relativePath: rel };
	});
}

async function scanConfigurationBinaries(
	exclude: string[],
	token: vscode.CancellationToken | undefined
): Promise<ConfigurationArtifact[]> {
	const files = await vscode.workspace.findFiles('**/*.cf', undefined, undefined, token);
	return files
		.filter(
			(uri) =>
				uri.fsPath.toLowerCase().endsWith('.cf') && !isUriExcluded(uri, exclude)
		)
		.map((uri) => {
			const rel = getWorkspaceRelativePath(uri);
			const name = path.basename(uri.fsPath);
			return { type: 'configuration' as const, uri, name, relativePath: rel, kind: 'binary' as const };
		});
}

async function scanExtensionBinaries(
	exclude: string[],
	token: vscode.CancellationToken | undefined
): Promise<ExtensionArtifact[]> {
	const files = await vscode.workspace.findFiles('**/*.cfe', undefined, undefined, token);
	return files
		.filter((uri) => !isUriExcluded(uri, exclude))
		.map((uri) => {
			const rel = getWorkspaceRelativePath(uri);
			const name = path.basename(uri.fsPath);
			return { type: 'extension' as const, uri, name, relativePath: rel, kind: 'binary' as const };
		});
}

async function scanProcessorBinaries(
	exclude: string[],
	token: vscode.CancellationToken | undefined
): Promise<ProcessorArtifact[]> {
	const files = await vscode.workspace.findFiles('**/*.epf', undefined, undefined, token);
	return files
		.filter((uri) => !isUriExcluded(uri, exclude))
		.map((uri) => {
			const rel = getWorkspaceRelativePath(uri);
			const name = path.basename(uri.fsPath);
			return { type: 'processor' as const, uri, name, relativePath: rel, kind: 'binary' as const };
		});
}

async function scanReportBinaries(
	exclude: string[],
	token: vscode.CancellationToken | undefined
): Promise<ReportArtifact[]> {
	const files = await vscode.workspace.findFiles('**/*.erf', undefined, undefined, token);
	return files
		.filter((uri) => !isUriExcluded(uri, exclude))
		.map((uri) => {
			const rel = getWorkspaceRelativePath(uri);
			const name = path.basename(uri.fsPath);
			return { type: 'report' as const, uri, name, relativePath: rel, kind: 'binary' as const };
		});
}

interface ProcessorReportSources {
	procSources: ProcessorArtifact[];
	reportSources: ReportArtifact[];
}

/** Добавляет артефакт-источник по одному корневому XML (на каталог — один раз). */
function addProcessorOrReportSource(
	kind: 'processor' | 'report',
	xmlUri: vscode.Uri,
	seenProc: Set<string>,
	seenRep: Set<string>,
	procSources: ProcessorArtifact[],
	reportSources: ReportArtifact[]
): void {
	const dir = path.dirname(xmlUri.fsPath);
	const normalized = path.normalize(dir).toLowerCase();
	const dirUri = vscode.Uri.file(dir);
	const rel = getWorkspaceRelativePath(dirUri);
	const name = path.basename(dir);
	if (kind === 'processor') {
		if (seenProc.has(normalized)) {
			return;
		}
		seenProc.add(normalized);
		procSources.push({
			type: 'processor',
			uri: dirUri,
			name,
			relativePath: rel,
			kind: 'source',
			sourceEntryUri: xmlUri,
		});
		return;
	}
	if (seenRep.has(normalized)) {
		return;
	}
	seenRep.add(normalized);
	reportSources.push({
		type: 'report',
		uri: dirUri,
		name,
		relativePath: rel,
		kind: 'source',
		sourceEntryUri: xmlUri,
	});
}

/**
 * Источники внешних обработок и отчётов: один поиск `*.xml`, без чтения XML внутри деревьев конфигурации/расширения.
 */
async function scanProcessorAndReportSources(
	exclude: string[],
	configTreeRootPrefixes: string[],
	token: vscode.CancellationToken | undefined
): Promise<ProcessorReportSources> {
	const files = await vscode.workspace.findFiles('**/*.xml', undefined, undefined, token);
	const procSources: ProcessorArtifact[] = [];
	const reportSources: ReportArtifact[] = [];
	const seenProc = new Set<string>();
	const seenRep = new Set<string>();

	let i = 0;
	for (const uri of files) {
		if (i++ % CANCEL_CHECK_INTERVAL === 0) {
			throwIfCancelled(token);
		}
		if (isUriExcluded(uri, exclude)) {
			continue;
		}
		if (isUnderConfigOrExtensionTree(uri.fsPath, configTreeRootPrefixes)) {
			continue;
		}

		const head = await readXmlHeadForClassification(uri.fsPath);
		const kind = classifyXmlArtifactHead(head);
		if (kind === null) {
			continue;
		}
		addProcessorOrReportSource(kind, uri, seenProc, seenRep, procSources, reportSources);
	}

	return { procSources, reportSources };
}

/**
 * Полный скан артефактов workspace.
 *
 * @param token — отмена при повторном `refresh` (передаётся в {@link vscode.workspace.findFiles}).
 */
export async function scanArtifacts(
	token?: vscode.CancellationToken
): Promise<ArtifactsScanResult> {
	throwIfCancelled(token);
	const exclude = getExcludeSegments();

	const { configSources, extSources, configTreeRootPrefixes } =
		await scanConfigurationAndExtensionSources(exclude, token);

	throwIfCancelled(token);

	const [features, configBinaries, extBinaries, procBinaries, reportBinaries] = await runPoolTuple(
		[
			() => scanFeatures(exclude, token),
			() => scanConfigurationBinaries(exclude, token),
			() => scanExtensionBinaries(exclude, token),
			() => scanProcessorBinaries(exclude, token),
			() => scanReportBinaries(exclude, token),
		] as BinaryScansPool,
		3,
		token
	);

	throwIfCancelled(token);

	const { procSources, reportSources } = await scanProcessorAndReportSources(
		exclude,
		configTreeRootPrefixes,
		token
	);

	return {
		features,
		configurations: [...configSources, ...configBinaries],
		extensions: [...extSources, ...extBinaries],
		processors: [...procSources, ...procBinaries],
		reports: [...reportSources, ...reportBinaries],
	};
}
