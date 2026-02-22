/**
 * Сканирование workspace на артефакты 1С: feature-файлы, конфигурации,
 * расширения, внешние обработки и отчёты (исходники и бинарные файлы).
 * @module artifactsScanner
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';

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


/** Найденный feature-файл */
export interface FeatureArtifact {
	type: 'feature';
	uri: vscode.Uri;
	name: string;
	relativePath: string;
}

/** Найденная конфигурация (исходники или .cf) */
export interface ConfigurationArtifact {
	type: 'configuration';
	uri: vscode.Uri;
	name: string;
	relativePath: string;
	kind: 'source' | 'binary';
}

/** Найденное расширение (исходники или .cfe) */
export interface ExtensionArtifact {
	type: 'extension';
	uri: vscode.Uri;
	name: string;
	relativePath: string;
	kind: 'source' | 'binary';
}

/** Найденная внешняя обработка (исходники или .epf) */
export interface ProcessorArtifact {
	type: 'processor';
	uri: vscode.Uri;
	name: string;
	relativePath: string;
	kind: 'source' | 'binary';
}

/** Найденный внешний отчёт (исходники или .erf) */
export interface ReportArtifact {
	type: 'report';
	uri: vscode.Uri;
	name: string;
	relativePath: string;
	kind: 'source' | 'binary';
}

export type Artifact =
	| FeatureArtifact
	| ConfigurationArtifact
	| ExtensionArtifact
	| ProcessorArtifact
	| ReportArtifact;

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
 * Сканирует workspace на feature-файлы (*.feature)
 */
async function scanFeatures(): Promise<FeatureArtifact[]> {
	const files = await vscode.workspace.findFiles('**/*.feature');
	const exclude = getExcludeSegments();
	const filtered = files.filter((uri) => !isUriExcluded(uri, exclude));
	return filtered.map((uri) => {
		const rel = getWorkspaceRelativePath(uri);
		const name = path.basename(uri.fsPath);
		return { type: 'feature' as const, uri, name, relativePath: rel };
	});
}

/**
 * Сканирует workspace на бинарные конфигурации (*.cf)
 */
async function scanConfigurationBinaries(): Promise<ConfigurationArtifact[]> {
	const files = await vscode.workspace.findFiles('**/*.cf');
	const exclude = getExcludeSegments();
	return files
		.filter((uri) => uri.fsPath.toLowerCase().endsWith('.cf') && !isUriExcluded(uri, exclude))
		.map((uri) => {
			const rel = getWorkspaceRelativePath(uri);
			const name = path.basename(uri.fsPath);
			return { type: 'configuration' as const, uri, name, relativePath: rel, kind: 'binary' as const };
		});
}

/**
 * Проверяет, содержит ли Configuration.xml поле ObjectBelonging (признак расширения)
 */
async function configurationXmlHasObjectBelonging(filePath: string): Promise<boolean> {
	try {
		const content = await fs.readFile(filePath, { encoding: 'utf-8', flag: 'r' });
		return /<ObjectBelonging>/.test(content);
	} catch {
		return false;
	}
}

/**
 * Сканирует workspace на папки с Configuration.xml (исходники конфигурации, без ObjectBelonging)
 */
async function scanConfigurationSources(): Promise<ConfigurationArtifact[]> {
	const files = await vscode.workspace.findFiles('**/Configuration.xml');
	const exclude = getExcludeSegments();
	const result: ConfigurationArtifact[] = [];
	for (const uri of files) {
		if (isUriExcluded(uri, exclude)) {
			continue;
		}
		const hasObjectBelonging = await configurationXmlHasObjectBelonging(uri.fsPath);
		if (hasObjectBelonging) {
			continue;
		}
		const dir = path.dirname(uri.fsPath);
		const dirUri = vscode.Uri.file(dir);
		const rel = getWorkspaceRelativePath(dirUri);
		const name = path.basename(dir);
		result.push({ type: 'configuration', uri: dirUri, name, relativePath: rel, kind: 'source' });
	}
	return result;
}

/**
 * Сканирует workspace на бинарные расширения (*.cfe)
 */
async function scanExtensionBinaries(): Promise<ExtensionArtifact[]> {
	const files = await vscode.workspace.findFiles('**/*.cfe');
	const exclude = getExcludeSegments();
	return files
		.filter((uri) => !isUriExcluded(uri, exclude))
		.map((uri) => {
			const rel = getWorkspaceRelativePath(uri);
			const name = path.basename(uri.fsPath);
			return { type: 'extension' as const, uri, name, relativePath: rel, kind: 'binary' as const };
		});
}

/**
 * Сканирует workspace на папки с Configuration.xml, содержащим ObjectBelonging (исходники расширений)
 */
async function scanExtensionSources(): Promise<ExtensionArtifact[]> {
	const files = await vscode.workspace.findFiles('**/Configuration.xml');
	const exclude = getExcludeSegments();
	const result: ExtensionArtifact[] = [];
	for (const uri of files) {
		if (isUriExcluded(uri, exclude)) {
			continue;
		}
		const hasObjectBelonging = await configurationXmlHasObjectBelonging(uri.fsPath);
		if (!hasObjectBelonging) {
			continue;
		}
		const dir = path.dirname(uri.fsPath);
		const dirUri = vscode.Uri.file(dir);
		const rel = getWorkspaceRelativePath(dirUri);
		const name = path.basename(dir);
		result.push({ type: 'extension', uri: dirUri, name, relativePath: rel, kind: 'source' });
	}
	return result;
}

/**
 * Сканирует workspace на бинарные внешние обработки (*.epf)
 */
async function scanProcessorBinaries(): Promise<ProcessorArtifact[]> {
	const files = await vscode.workspace.findFiles('**/*.epf');
	const exclude = getExcludeSegments();
	return files
		.filter((uri) => !isUriExcluded(uri, exclude))
		.map((uri) => {
			const rel = getWorkspaceRelativePath(uri);
			const name = path.basename(uri.fsPath);
			return { type: 'processor' as const, uri, name, relativePath: rel, kind: 'binary' as const };
		});
}

const XML_HEAD_SIZE = 4096;

/**
 * Проверяет, является ли XML-файл корневым описанием внешней обработки (корневой элемент ExternalDataProcessor)
 */
async function xmlIsExternalDataProcessor(filePath: string): Promise<boolean> {
	let fh: fs.FileHandle | undefined;
	try {
		fh = await fs.open(filePath, 'r');
		const buf = Buffer.alloc(XML_HEAD_SIZE);
		const { bytesRead } = await fh.read(buf, 0, XML_HEAD_SIZE, 0);
		const content = buf.subarray(0, bytesRead).toString('utf-8');
		return /<ExternalDataProcessor[\s>]/.test(content);
	} catch {
		return false;
	} finally {
		await fh?.close();
	}
}

/**
 * Сканирует workspace на папки с корневым XML обработки (содержит ExternalDataProcessor)
 */
async function scanProcessorSources(): Promise<ProcessorArtifact[]> {
	const files = await vscode.workspace.findFiles('**/*.xml');
	const exclude = getExcludeSegments();
	const result: ProcessorArtifact[] = [];
	const seen = new Set<string>();

	for (const uri of files) {
		if (isUriExcluded(uri, exclude)) {
			continue;
		}
		if (!(await xmlIsExternalDataProcessor(uri.fsPath))) {
			continue;
		}
		const dir = path.dirname(uri.fsPath);
		const normalized = path.normalize(dir).toLowerCase();
		if (seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		const dirUri = vscode.Uri.file(dir);
		const rel = getWorkspaceRelativePath(dirUri);
		const name = path.basename(dir);
		result.push({ type: 'processor', uri: dirUri, name, relativePath: rel, kind: 'source' });
	}
	return result;
}

/**
 * Сканирует workspace на бинарные внешние отчёты (*.erf)
 */
async function scanReportBinaries(): Promise<ReportArtifact[]> {
	const files = await vscode.workspace.findFiles('**/*.erf');
	const exclude = getExcludeSegments();
	return files
		.filter((uri) => !isUriExcluded(uri, exclude))
		.map((uri) => {
			const rel = getWorkspaceRelativePath(uri);
			const name = path.basename(uri.fsPath);
			return { type: 'report' as const, uri, name, relativePath: rel, kind: 'binary' as const };
		});
}

/**
 * Проверяет, является ли XML-файл корневым описанием внешнего отчёта (корневой элемент ExternalReport)
 */
async function xmlIsExternalReport(filePath: string): Promise<boolean> {
	let fh: fs.FileHandle | undefined;
	try {
		fh = await fs.open(filePath, 'r');
		const buf = Buffer.alloc(XML_HEAD_SIZE);
		const { bytesRead } = await fh.read(buf, 0, XML_HEAD_SIZE, 0);
		const content = buf.subarray(0, bytesRead).toString('utf-8');
		return /<ExternalReport[\s>]/.test(content);
	} catch {
		return false;
	} finally {
		await fh?.close();
	}
}

/**
 * Сканирует workspace на папки с корневым XML отчёта (содержит ExternalReport)
 */
async function scanReportSources(): Promise<ReportArtifact[]> {
	const files = await vscode.workspace.findFiles('**/*.xml');
	const exclude = getExcludeSegments();
	const result: ReportArtifact[] = [];
	const seen = new Set<string>();

	for (const uri of files) {
		if (isUriExcluded(uri, exclude)) {
			continue;
		}
		if (!(await xmlIsExternalReport(uri.fsPath))) {
			continue;
		}
		const dir = path.dirname(uri.fsPath);
		const normalized = path.normalize(dir).toLowerCase();
		if (seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		const dirUri = vscode.Uri.file(dir);
		const rel = getWorkspaceRelativePath(dirUri);
		const name = path.basename(dir);
		result.push({ type: 'report', uri: dirUri, name, relativePath: rel, kind: 'source' });
	}
	return result;
}

/**
 * Сканирует workspace на все артефакты 1С
 */
export async function scanArtifacts(): Promise<ArtifactsScanResult> {
	const [
		features,
		configBinaries,
		configSources,
		extBinaries,
		extSources,
		procBinaries,
		procSources,
		reportBinaries,
		reportSources,
	] = await Promise.all([
		scanFeatures(),
		scanConfigurationBinaries(),
		scanConfigurationSources(),
		scanExtensionBinaries(),
		scanExtensionSources(),
		scanProcessorBinaries(),
		scanProcessorSources(),
		scanReportBinaries(),
		scanReportSources(),
	]);

	return {
		features,
		configurations: [...configSources, ...configBinaries],
		extensions: [...extSources, ...extBinaries],
		processors: [...procSources, ...procBinaries],
		reports: [...reportSources, ...reportBinaries],
	};
}
