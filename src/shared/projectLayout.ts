/**
 * Раскладка проекта: где конфигурация и где расширения.
 *
 * Правила распознавания взяты из mdclasses, которым пользуется вся экосистема:
 * исходный код в формате конфигуратора опознаётся по `Configuration.xml`, формат EDT — по
 * `src/Configuration/Configuration.mdo`, расширение отличается от конфигурации
 * признаком принадлежности объектов.
 *
 * Настройки путей главнее автоопределения: заданный каталог с маркером берётся как есть,
 * обход дерева включается только там, где по настройке маркера нет. Настройки временные:
 * когда все панели перейдут на автоопределение, они снимаются, и раскладка останется
 * единственным источником путей, поэтому {@link LayoutPaths} необязателен.
 *
 * Результат кэшируется на рабочую область: потребителей у раскладки много, а обход
 * дерева один и тот же. Кэш сбрасывает {@link invalidateProjectLayout}.
 * @module projectLayout
 */

import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import * as path from 'node:path';

/** Формат исходного кода. */
export type SourceFormat = 'designer' | 'edt';

/** Корень конфигурации или расширения. */
export interface SourceRoot {
	/** Каталог, который передаётся инструментам (rootProject, аргументы vrunner). */
	dir: string;
	format: SourceFormat;
	/** Имя из метаданных; у конфигурации может быть пустым. */
	name: string;
	/** Расширение конфигурации, а не сама конфигурация. */
	isExtension: boolean;
}

/** Раскладка рабочей области. */
export interface ProjectLayout {
	configuration?: SourceRoot;
	extensions: SourceRoot[];
	/** Прочие конфигурации рабочей области: мультирут и соседние проекты в формате EDT. */
	others: SourceRoot[];
	/** Каталоги проектов EDT с внешними обработками и отчётами. */
	externals: string[];
}

/** Файл-маркер формата конфигуратора. */
const DESIGNER_MARKER = 'Configuration.xml';

/** Файл-маркер формата EDT относительно корня проекта. */
const EDT_MARKER = path.join('src', 'Configuration', 'Configuration.mdo');

/** Каталоги внешних обработок и отчётов в формате EDT. */
const EDT_EXTERNAL_DIRECTORIES = ['ExternalDataProcessors', 'ExternalReports'];

/** Каталоги, в которые обход не заходит. */
const SKIP_DIRECTORIES = new Set([
	'.git',
	'.metadata',
	'.vscode',
	'node_modules',
	'oscript_modules',
	'Ext',
]);

/** На сколько уровней вглубь рабочей области искать маркеры. */
const MAX_DEPTH = 3;

/** Размер читаемого заголовка файла метаданных. */
const HEAD_SIZE = 4096;

/** Маркер в каталоге; undefined — исходного кода тут нет. */
export function markerIn(directory: string): { format: SourceFormat; file: string } | undefined {
	const designer = path.join(directory, DESIGNER_MARKER);
	if (fssync.existsSync(designer)) {
		return { format: 'designer', file: designer };
	}
	const edt = path.join(directory, EDT_MARKER);
	if (fssync.existsSync(edt)) {
		return { format: 'edt', file: edt };
	}
	return undefined;
}

/** Имя и признак расширения из заголовка файла метаданных. */
export function describeMarker(head: string, format: SourceFormat): { name: string; isExtension: boolean } {
	const isExtension = format === 'designer'
		? /<ObjectBelonging>/i.test(head)
		: /<objectBelonging>/.test(head) || /namePrefix/.test(head);
	const name = format === 'designer'
		? head.match(/<Name>([^<]+)<\/Name>/)?.[1] ?? ''
		: head.match(/<name>([^<]+)<\/name>/)?.[1] ?? '';
	return { name: name.trim(), isExtension };
}

/** Проект EDT с внешними обработками или отчётами. */
function hasExternalObjects(directory: string): boolean {
	return EDT_EXTERNAL_DIRECTORIES.some(
		(name) =>
			fssync.existsSync(path.join(directory, 'src', name)) ||
			fssync.existsSync(path.join(directory, name))
	);
}

/** Проекты EDT с внешними обработками и отчётами; обход не заходит в найденный проект. */
async function findExternalRoots(root: string, depth: number, found: string[]): Promise<void> {
	if (hasExternalObjects(root)) {
		found.push(root);
		return;
	}
	if (depth === 0) {
		return;
	}

	let entries: fssync.Dirent[];
	try {
		entries = await fs.readdir(root, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (!entry.isDirectory() || SKIP_DIRECTORIES.has(entry.name)) {
			continue;
		}
		await findExternalRoots(path.join(root, entry.name), depth - 1, found);
	}
}

async function readRoot(directory: string): Promise<SourceRoot | undefined> {
	const marker = markerIn(directory);
	if (!marker) {
		return undefined;
	}

	let head = '';
	try {
		const handle = await fs.open(marker.file, 'r');
		try {
			const buffer = Buffer.alloc(HEAD_SIZE);
			const { bytesRead } = await handle.read(buffer, 0, HEAD_SIZE, 0);
			head = buffer.subarray(0, bytesRead).toString('utf8');
		} finally {
			await handle.close();
		}
	} catch {
		return undefined;
	}

	const { name, isExtension } = describeMarker(head, marker.format);
	return { dir: directory, format: marker.format, name, isExtension };
}

/** Каталоги с исходным кодом в дереве; обход не заходит в найденный корень. */
async function findRoots(root: string, depth: number, found: SourceRoot[]): Promise<void> {
	const here = await readRoot(root);
	if (here) {
		found.push(here);
		return;
	}
	if (depth === 0) {
		return;
	}

	let entries: fssync.Dirent[];
	try {
		entries = await fs.readdir(root, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (!entry.isDirectory() || SKIP_DIRECTORIES.has(entry.name)) {
			continue;
		}
		await findRoots(path.join(root, entry.name), depth - 1, found);
	}
}

/** Разобранная раскладка и ключ настроек, по которому она получена. */
interface CacheEntry {
	key: string;
	layout: Promise<ProjectLayout>;
}

/** Раскладки рабочих областей: ключ - корень рабочей области. */
const cache = new Map<string, CacheEntry>();

/**
 * Забывает разобранную раскладку.
 *
 * @param workspaceRoot - Рабочая область; без него забываются все
 */
export function invalidateProjectLayout(workspaceRoot?: string): void {
	if (workspaceRoot === undefined) {
		cache.clear();
		return;
	}
	cache.delete(path.resolve(workspaceRoot));
}

/** Настройки путей проекта; пустой путь означает корень рабочей области. */
export interface LayoutPaths {
	/** Каталог конфигурации (path.cf). */
	configuration: string;
	/** Каталоги, внутри которых лежат расширения (path.cfe, <path.tests>/cfe). */
	extensions: string[];
}

/**
 * Раскладка рабочей области; повторные вызовы отдают разобранную.
 *
 * @param workspaceRoot корень рабочей области
 * @param paths настройки путей проекта; без них раскладка определяется обходом
 */
export function resolveProjectLayout(workspaceRoot: string, paths?: LayoutPaths): Promise<ProjectLayout> {
	const root = path.resolve(workspaceRoot);
	const key = paths ? JSON.stringify([paths.configuration, ...paths.extensions]) : '';
	const cached = cache.get(root);
	if (cached?.key === key) {
		return cached.layout;
	}

	// Неудачную попытку не запоминаем: следующий вызов должен попробовать снова.
	const layout = readLayout(root, paths).catch((error: unknown) => {
		cache.delete(root);
		throw error;
	});
	cache.set(root, { key, layout });
	return layout;
}

async function readLayout(workspaceRoot: string, paths?: LayoutPaths): Promise<ProjectLayout> {
	const configuration = paths ? await readRoot(path.resolve(workspaceRoot, paths.configuration)) : undefined;
	const externals: string[] = [];
	await findExternalRoots(workspaceRoot, MAX_DEPTH, externals);
	const extensions: SourceRoot[] = [];

	for (const relative of paths?.extensions ?? []) {
		const base = path.resolve(workspaceRoot, relative);
		let entries: fssync.Dirent[];
		try {
			entries = await fs.readdir(base, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			const root = await readRoot(path.join(base, entry.name));
			if (root) {
				extensions.push(root);
			}
		}
	}

	if (configuration && extensions.length > 0) {
		return { configuration, extensions, others: [], externals };
	}

	// По настройкам исходного кода нет: ищем его в рабочей области.
	const found: SourceRoot[] = [];
	await findRoots(workspaceRoot, MAX_DEPTH, found);

	const configurations = found.filter((root) => !root.isExtension);
	const resolved = configuration ?? configurations[0];

	return {
		configuration: resolved,
		extensions: extensions.length > 0 ? extensions : found.filter((root) => root.isExtension),
		others: configurations.filter((root) => root.dir !== resolved?.dir),
		externals,
	};
}
