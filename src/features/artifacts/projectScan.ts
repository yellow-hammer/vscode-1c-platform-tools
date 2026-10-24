/**
 * Каталоги проектов для поиска файлов и группы по проектам в панелях.
 *
 * @module projectScan
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { sameOrUnder } from '../../shared/projectLayout';
import {
	currentRoot,
	listProjects,
	outsideProject,
	projectByRoot,
	projectDisplayName,
	projectScanRoots,
	sameProjectRoot,
	type ProjectScanRoot,
} from '../../shared/workspaceProjects';

/** Описание группы выбранного проекта. */
export const CURRENT_PROJECT_DESCRIPTION = 'текущий';

/** Каталоги проектов после полного обнаружения. */
export async function detectedScanRoots(): Promise<ProjectScanRoot[]> {
	await listProjects();
	return projectScanRoots();
}

/**
 * Проект с каталогами, которые ему не принадлежат, после полного обнаружения.
 *
 * @param root - Корень проекта
 */
export async function projectScanRootOf(root: string): Promise<ProjectScanRoot> {
	return (await detectedScanRoots()).find((scanRoot) => sameProjectRoot(scanRoot.root, root)) ?? { root, excludeDirs: [] };
}

/**
 * Не относится ли файл к проекту: лежит вне его корня, в подпроекте, во вложенной
 * папке рабочей области или под исключённым сегментом пути внутри проекта.
 *
 * @param scanRoot - Проект и каталоги, которые ему не принадлежат
 * @param file - Абсолютный путь
 * @param segments - Исключённые сегменты; сравниваются только ниже корня проекта
 */
export function isOutsideScanRoot(scanRoot: ProjectScanRoot, file: string, segments: readonly string[]): boolean {
	if (!sameOrUnder(file, scanRoot.root) || scanRoot.excludeDirs.some((dir) => sameOrUnder(file, dir))) {
		return true;
	}
	const relative = `/${projectRelativePath(scanRoot.root, file)}/`;
	return segments.some((segment) => segment.length > 0 && relative.includes(`/${segment}/`));
}

/** Символы синтаксиса масок поиска файлов. */
const GLOB_SYNTAX = /[*?[\]{}!,]/;

/**
 * Делит маску на каталог без символов маски в начале и остаток.
 *
 * @param glob - Маска относительно корня проекта
 * @returns Каталог через `/`, пустой для корня, и маска относительно него
 */
export function splitGlobBase(glob: string): { base: string; pattern: string } {
	let normalized = glob.replaceAll('\\', '/');
	while (normalized.startsWith('./')) {
		normalized = normalized.slice(2);
	}
	const segments = normalized.split('/');
	let fixed = 0;
	while (fixed < segments.length - 1 && segments[fixed] !== '' && !GLOB_SYNTAX.test(segments[fixed])) {
		fixed += 1;
	}
	return { base: segments.slice(0, fixed).join('/'), pattern: segments.slice(fixed).join('/') };
}

/**
 * Маска исключения для поиска от каталога: исключённые сегменты и каталоги, которые
 * проекту не принадлежат. Путь с символами маски в неё не попадает, его отсекает
 * проверка найденного.
 *
 * @param base - Абсолютный каталог поиска
 * @param scanRoot - Проект и каталоги, которые ему не принадлежат
 * @param segments - Исключённые сегменты пути
 * @returns undefined, когда исключать нечего
 */
export function searchExcludeGlob(base: string, scanRoot: ProjectScanRoot, segments: readonly string[]): string | undefined {
	const bySegment = segments
		.filter((segment) => /^[^/\\]+(?:\/[^/\\]+)*$/.test(segment) && !GLOB_SYNTAX.test(segment))
		.map((segment) => `**/${segment}/**`);
	const byDirectory = scanRoot.excludeDirs
		.map((dir) => path.relative(base, dir))
		.filter((relative) => relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative))
		.map((relative) => relative.split(path.sep).join('/'))
		.filter((relative) => !GLOB_SYNTAX.test(relative))
		.map((relative) => `${relative}/**`);
	const patterns = [...new Set([...bySegment, ...byDirectory])];
	return patterns.length === 0 ? undefined : `{${patterns.join(',')}}`;
}

/**
 * Маска проекта от каталога в начале маски.
 *
 * @param root - Корень проекта
 * @param glob - Маска относительно корня проекта
 */
export function projectGlobPattern(root: string, glob: string): vscode.RelativePattern {
	const { base, pattern } = splitGlobBase(glob);
	return new vscode.RelativePattern(vscode.Uri.file(path.resolve(root, base)), pattern);
}

/**
 * Подходит ли файл под маску проекта так же, как при поиске по ней.
 *
 * @param root - Корень проекта
 * @param glob - Маска относительно корня проекта
 * @param uri - Файл
 */
export function matchesProjectGlob(root: string, glob: string, uri: vscode.Uri): boolean {
	const candidate = { uri, languageId: '' } as vscode.TextDocument;
	return vscode.languages.match({ pattern: projectGlobPattern(root, glob) }, candidate) > 0;
}

/**
 * Файлы проекта по маске: поиск от каталога в начале маски, без исключённых
 * сегментов, подпроектов и вложенных папок рабочей области.
 *
 * @param scanRoot - Проект и каталоги, которые ему не принадлежат
 * @param glob - Маска относительно корня проекта
 * @param segments - Исключённые сегменты пути
 * @param token - Отмена поиска
 */
export async function findProjectFiles(
	scanRoot: ProjectScanRoot,
	glob: string,
	segments: readonly string[],
	token?: vscode.CancellationToken
): Promise<vscode.Uri[]> {
	const include = projectGlobPattern(scanRoot.root, glob);
	const directory = include.baseUri.fsPath;
	if (isOutsideScanRoot(scanRoot, directory, segments)) {
		return [];
	}
	const stat = await fs.stat(directory).catch(() => undefined);
	if (!stat?.isDirectory()) {
		return [];
	}
	const uris = await vscode.workspace.findFiles(include, searchExcludeGlob(directory, scanRoot, segments), undefined, token);
	return uris.filter((uri) => !isOutsideScanRoot(scanRoot, uri.fsPath, segments));
}

/**
 * Путь от корня проекта через `/`.
 *
 * @param root - Корень проекта
 * @param file - Абсолютный путь внутри проекта
 * @returns `.` для самого корня
 */
export function projectRelativePath(root: string, file: string): string {
	const relative = path.relative(root, file);
	return relative === '' ? '.' : relative.split(/[\\/]/).join('/');
}

/** Корень выбранного проекта без корня вызова. */
export function selectedRoot(): string | undefined {
	return outsideProject(() => currentRoot());
}

/** Корень выбранного проекта. */
export function isSelectedRoot(root: string): boolean {
	const selected = selectedRoot();
	return selected !== undefined && sameProjectRoot(root, selected);
}

/**
 * Элементы в прежнем порядке, элемент выбранного проекта первым.
 *
 * @param items - Элементы по проектам
 * @param rootOf - Корень проекта элемента
 */
export function selectedFirst<T>(items: readonly T[], rootOf: (item: T) => string): T[] {
	const selected = selectedRoot();
	const index = selected === undefined ? -1 : items.findIndex((item) => sameProjectRoot(rootOf(item), selected));
	return index <= 0 ? [...items] : [items[index], ...items.slice(0, index), ...items.slice(index + 1)];
}

/** Подпись группы проекта. */
export function projectLabel(root: string): string {
	const project = projectByRoot(root);
	return project ? projectDisplayName(project) : path.basename(root);
}

/**
 * Совпадает ли набор просканированных корней с каталогами проектов.
 *
 * @param scanned - Корни последнего скана
 * @param roots - Каталоги проектов сейчас
 */
export function sameScanRoots(scanned: readonly string[], roots: readonly ProjectScanRoot[]): boolean {
	return scanned.length === roots.length && scanned.every((root, index) => sameProjectRoot(root, roots[index].root));
}
