/**
 * Артефакты проектов: исходный код из раскладки проекта, собранные файлы
 * поиском по маске с исключениями `artifacts.exclude`.
 *
 * Проект OneScript конфигурацией 1С не сканируется: у него только собранные
 * пакеты. Пакеты проекта 1С показываются, если они есть.
 *
 * @module artifactsScanner
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { projectConfiguration } from '../../shared/projectConfiguration';
import {
	externalDirectory,
	externalEntry,
	resolveProjectLayout,
	sourceEntry,
	type ProjectLayout,
	type SourceFormat,
	type SourceRoot,
} from '../../shared/projectLayout';
import { PACKAGE_EXTENSION } from '../../shared/packagedef';
import type { ProjectKind } from '../../shared/projectKind';
import { projectByRoot, type ProjectScanRoot } from '../../shared/workspaceProjects';
import { detectedScanRoots, findProjectFiles, isOutsideScanRoot, projectRelativePath } from './projectScan';

export type ArtifactType = 'configuration' | 'extension' | 'processor' | 'report' | 'package';

/** Собранные файлы проекта 1С вместе с пакетами OneScript: маска поиска и вид по расширению. */
const BINARY_GLOB = '**/*.{cf,cfe,epf,erf,ospx}';

/** Собранные пакеты OneScript. */
const PACKAGE_GLOB = `**/*${PACKAGE_EXTENSION}`;

/** Каталоги, где собранных файлов не бывает: рабочая область EDT держит в `.metadata` свой индекс с расширением `.cfe`. */
const ALWAYS_EXCLUDED = ['.git', '.metadata', 'node_modules', 'oscript_modules'];
const BINARY_TYPES: ReadonlyMap<string, ArtifactType> = new Map([
	['.cf', 'configuration'],
	['.cfe', 'extension'],
	['.epf', 'processor'],
	['.erf', 'report'],
	[PACKAGE_EXTENSION, 'package'],
]);

/** Каталог исходного кода или собранный файл. */
export interface Artifact {
	type: ArtifactType;
	/** Каталог или файл, с которым работают команды. */
	uri: vscode.Uri;
	name: string;
	/** Путь от корня проекта через `/`. */
	relativePath: string;
	kind: 'source' | 'binary';
	/** У исходного кода: формат каталога. */
	format?: SourceFormat;
	/** У исходного кода: файл описания, который открывается в редакторе. */
	sourceEntryUri?: vscode.Uri;
}

/** Артефакты одного проекта по видам. */
export interface ArtifactsScanResult {
	configurations: Artifact[];
	extensions: Artifact[];
	processors: Artifact[];
	reports: Artifact[];
	/** Собранные пакеты OneScript. */
	packages: Artifact[];
}

/** Результат {@link scanArtifacts} для одного проекта. */
export interface ProjectArtifacts extends ArtifactsScanResult {
	/** Корень проекта. */
	root: string;
	/** Проект OneScript: артефактов 1С у него не бывает. */
	oneScript: boolean;
}

function excludeSegments(root: string): string[] {
	const config = projectConfiguration(root);
	const configured = config.get<string[]>('artifacts.exclude');
	const segments = Array.isArray(configured)
		? configured
		: config.inspect<string[]>('artifacts.exclude')?.defaultValue ?? [];
	const own = segments.filter((segment): segment is string => typeof segment === 'string' && segment.length > 0);
	return [...new Set([...ALWAYS_EXCLUDED, ...own])];
}

function throwIfCancelled(token: vscode.CancellationToken | undefined): void {
	if (token?.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
}

function sourceArtifact(
	root: string,
	type: ArtifactType,
	dir: string,
	name: string,
	format: SourceFormat,
	entry: string
): Artifact {
	return {
		type,
		uri: vscode.Uri.file(dir),
		name: name || path.basename(dir),
		relativePath: projectRelativePath(root, dir),
		kind: 'source',
		format,
		sourceEntryUri: vscode.Uri.file(entry),
	};
}

/** Исходный код проекта: конфигурации, расширения и внешние объекты, тестовые вместе с остальными. */
function sourcesOf(scanRoot: ProjectScanRoot, layout: ProjectLayout): Artifact[] {
	const root = scanRoot.root;
	const configurations = [layout.configuration, ...layout.others].filter((source): source is SourceRoot => source !== undefined);
	const extensions = [...layout.extensions, ...layout.testExtensions];
	const externals = [...layout.processors, ...layout.reports, ...layout.testProcessors];
	const ofRoot = (type: ArtifactType, source: SourceRoot) =>
		sourceArtifact(root, type, source.dir, source.name, source.format, sourceEntry(source));
	return [
		...configurations.map((source) => ofRoot('configuration', source)),
		...extensions.map((source) => ofRoot('extension', source)),
		...externals.map((source) =>
			sourceArtifact(root, source.kind, externalDirectory(source), source.name, source.format, externalEntry(source))
		),
	].filter((artifact) => !isOutsideScanRoot(scanRoot, artifact.uri.fsPath, []));
}

async function binariesIn(
	scanRoot: ProjectScanRoot,
	glob: string,
	exclude: readonly string[],
	token: vscode.CancellationToken | undefined
): Promise<Artifact[]> {
	const files = await findProjectFiles(scanRoot, glob, exclude, token);
	const found: Artifact[] = [];
	for (const uri of files) {
		const type = BINARY_TYPES.get(path.extname(uri.fsPath).toLowerCase());
		if (!type) {
			continue;
		}
		found.push({
			type,
			uri,
			name: path.basename(uri.fsPath),
			relativePath: projectRelativePath(scanRoot.root, uri.fsPath),
			kind: 'binary',
		});
	}
	return found;
}

/**
 * Артефакты одного проекта.
 *
 * @param scanRoot - Проект и каталоги, которые ему не принадлежат
 * @param token - Отмена при повторном обновлении
 * @param kind - Вид проекта; по умолчанию из найденных проектов окна
 */
export async function scanProjectArtifacts(
	scanRoot: ProjectScanRoot,
	token?: vscode.CancellationToken,
	kind: ProjectKind | undefined = projectByRoot(scanRoot.root)?.kind
): Promise<ProjectArtifacts> {
	const oneScript = kind === 'onescript';
	const exclude = excludeSegments(scanRoot.root);
	const found = [
		...(oneScript ? [] : sourcesOf(scanRoot, await resolveProjectLayout(scanRoot.root))),
		...(await binariesIn(scanRoot, oneScript ? PACKAGE_GLOB : BINARY_GLOB, exclude, token)),
	];
	const of = (type: ArtifactType) => found.filter((artifact) => artifact.type === type);
	return {
		root: scanRoot.root,
		oneScript,
		configurations: of('configuration'),
		extensions: of('extension'),
		processors: of('processor'),
		reports: of('report'),
		packages: of('package'),
	};
}

/**
 * Артефакты проектов окна.
 *
 * @param token - Отмена при повторном обновлении
 * @param roots - Проекты для обхода; по умолчанию все проекты после обнаружения
 * @returns По проекту в порядке проектов
 */
export async function scanArtifacts(
	token?: vscode.CancellationToken,
	roots?: readonly ProjectScanRoot[]
): Promise<ProjectArtifacts[]> {
	const scanRoots = roots ?? (await detectedScanRoots());
	const result: ProjectArtifacts[] = [];
	for (const scanRoot of scanRoots) {
		throwIfCancelled(token);
		result.push(await scanProjectArtifacts(scanRoot, token));
	}
	throwIfCancelled(token);
	return result;
}
