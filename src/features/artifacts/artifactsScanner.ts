/**
 * Артефакты рабочей области: исходный код из раскладки проекта, собранные файлы
 * поиском по маске с исключениями `artifacts.exclude`.
 *
 * @module artifactsScanner
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	externalDirectory,
	externalEntry,
	resolveProjectLayout,
	sourceEntry,
	type ProjectLayout,
	type SourceFormat,
	type SourceRoot,
} from '../../shared/projectLayout';

export type ArtifactType = 'configuration' | 'extension' | 'processor' | 'report';

/** Собранные файлы: маска поиска и вид по расширению. */
const BINARY_GLOB = '**/*.{cf,cfe,epf,erf}';

/** Каталоги, где собранных файлов не бывает: рабочая область EDT держит в `.metadata` свой индекс с расширением `.cfe`. */
const ALWAYS_EXCLUDED = ['.git', '.metadata', 'node_modules', 'oscript_modules'];
const BINARY_TYPES: ReadonlyMap<string, ArtifactType> = new Map([
	['.cf', 'configuration'],
	['.cfe', 'extension'],
	['.epf', 'processor'],
	['.erf', 'report'],
]);

/** Каталог исходного кода или собранный файл. */
export interface Artifact {
	type: ArtifactType;
	/** Каталог или файл, с которым работают команды. */
	uri: vscode.Uri;
	name: string;
	relativePath: string;
	kind: 'source' | 'binary';
	/** У исходного кода: формат каталога. */
	format?: SourceFormat;
	/** У исходного кода: файл описания, который открывается в редакторе. */
	sourceEntryUri?: vscode.Uri;
}

/** Результат {@link scanArtifacts}. */
export interface ArtifactsScanResult {
	configurations: Artifact[];
	extensions: Artifact[];
	processors: Artifact[];
	reports: Artifact[];
}

function excludeSegments(): string[] {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const configured = config.get<string[]>('artifacts.exclude');
	const segments = Array.isArray(configured)
		? configured
		: config.inspect<string[]>('artifacts.exclude')?.defaultValue ?? [];
	const own = segments.filter((segment): segment is string => typeof segment === 'string' && segment.length > 0);
	return [...new Set([...ALWAYS_EXCLUDED, ...own])];
}

function isExcluded(uri: vscode.Uri, segments: readonly string[]): boolean {
	const normalized = uri.fsPath.replaceAll('\\', '/');
	return segments.some((segment) => normalized.includes(`/${segment}/`) || normalized.endsWith(`/${segment}`));
}

function throwIfCancelled(token: vscode.CancellationToken | undefined): void {
	if (token?.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
}

function relativePathOf(uri: vscode.Uri): string {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) {
		return uri.fsPath;
	}
	// Исходный код в корне рабочей области: сама папка, а не её полный путь
	if (folders.some((folder) => folder.uri.fsPath === uri.fsPath)) {
		return '.';
	}
	return vscode.workspace.asRelativePath(uri, false).replaceAll('\\', '/');
}

function sourceArtifact(type: ArtifactType, dir: string, name: string, format: SourceFormat, entry: string): Artifact {
	const uri = vscode.Uri.file(dir);
	return {
		type,
		uri,
		name: name || path.basename(dir),
		relativePath: relativePathOf(uri),
		kind: 'source',
		format,
		sourceEntryUri: vscode.Uri.file(entry),
	};
}

/** Исходный код рабочей области: конфигурации, расширения и внешние объекты, тестовые вместе с остальными. */
function sourcesOf(layout: ProjectLayout): Artifact[] {
	const configurations = [layout.configuration, ...layout.others].filter((root): root is SourceRoot => root !== undefined);
	const extensions = [...layout.extensions, ...layout.testExtensions];
	const externals = [...layout.processors, ...layout.reports, ...layout.testProcessors];
	const ofRoot = (type: ArtifactType, root: SourceRoot) => sourceArtifact(type, root.dir, root.name, root.format, sourceEntry(root));
	return [
		...configurations.map((root) => ofRoot('configuration', root)),
		...extensions.map((root) => ofRoot('extension', root)),
		...externals.map((root) => sourceArtifact(root.kind, externalDirectory(root), root.name, root.format, externalEntry(root))),
	];
}

async function binariesIn(
	root: string,
	exclude: readonly string[],
	token: vscode.CancellationToken | undefined
): Promise<Artifact[]> {
	const pattern = new vscode.RelativePattern(vscode.Uri.file(root), BINARY_GLOB);
	const files = await vscode.workspace.findFiles(pattern, undefined, undefined, token);
	const found: Artifact[] = [];
	for (const uri of files) {
		const type = BINARY_TYPES.get(path.extname(uri.fsPath).toLowerCase());
		if (!type || isExcluded(uri, exclude)) {
			continue;
		}
		found.push({ type, uri, name: path.basename(uri.fsPath), relativePath: relativePathOf(uri), kind: 'binary' });
	}
	return found;
}

/**
 * Артефакты рабочей области.
 *
 * @param token - Отмена при повторном обновлении
 * @param roots - Корни для обхода; по умолчанию папки рабочей области
 */
export async function scanArtifacts(
	token?: vscode.CancellationToken,
	roots?: readonly string[]
): Promise<ArtifactsScanResult> {
	const folders = roots ?? (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
	const exclude = excludeSegments();
	const found: Artifact[] = [];
	for (const root of folders) {
		throwIfCancelled(token);
		found.push(...sourcesOf(await resolveProjectLayout(root)));
		found.push(...(await binariesIn(root, exclude, token)));
	}
	const of = (type: ArtifactType) => found.filter((artifact) => artifact.type === type);
	return {
		configurations: of('configuration'),
		extensions: of('extension'),
		processors: of('processor'),
		reports: of('report'),
	};
}
