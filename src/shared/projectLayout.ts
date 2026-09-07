/**
 * Раскладка проекта: где конфигурация, расширения, внешние обработки и отчёты.
 *
 * Правила распознавания взяты из mdclasses, которым пользуется вся экосистема:
 * исходный код в формате конфигуратора опознаётся по `Configuration.xml`, формат EDT по
 * `src/Configuration/Configuration.mdo`, расширение отличается от конфигурации
 * признаком принадлежности объектов, внешняя обработка и отчёт по корневому
 * `<Имя>.xml` с заголовком `ExternalDataProcessor` или `ExternalReport` либо по
 * проекту EDT с каталогом `src/ExternalDataProcessors` или `src/ExternalReports`.
 *
 * Тестовое отличается от поставляемого местом: корень, у которого в пути есть
 * каталог `tests`, тестовый. Так лежат `tests/cfe` и `tests/epf` в обоих форматах.
 *
 * Раскладка единственный источник путей: настроек каталогов исходного кода нет.
 * Результат кэшируется на рабочую область: потребителей много, а обход дерева
 * один и тот же. Кэш сбрасывает {@link invalidateProjectLayout}.
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

/** Вид внешнего объекта. */
export type ExternalKind = 'processor' | 'report';

/** Корень внешней обработки или отчёта. */
export interface ExternalRoot {
	/**
	 * Каталог, который передаётся инструментам: у выгрузки конфигуратора каталог
	 * объекта с `<Имя>.xml` в корне, у EDT каталог проекта.
	 */
	dir: string;
	format: SourceFormat;
	kind: ExternalKind;
	/** Имя объекта: у выгрузки конфигуратора имя каталога, им же названы собранные файлы. */
	name: string;
	/** Имя описания без расширения: в выгрузке конфигуратора оно бывает названо не как каталог. */
	file: string;
}

/** Раскладка рабочей области. */
export interface ProjectLayout {
	configuration?: SourceRoot;
	/** Расширения решения: все, что не под каталогом тестов. */
	extensions: SourceRoot[];
	/** Тестовые расширения: под каталогом `tests`. */
	testExtensions: SourceRoot[];
	/** Прочие конфигурации рабочей области: мультирут и соседние проекты в формате EDT. */
	others: SourceRoot[];
	/** Внешние обработки решения. */
	processors: ExternalRoot[];
	/** Внешние отчёты решения. */
	reports: ExternalRoot[];
	/** Тестовые обработки и отчёты: под каталогом `tests`. */
	testProcessors: ExternalRoot[];
	/** Каталоги проектов EDT с внешними обработками и отчётами. */
	externals: string[];
}

/** Файл-маркер формата конфигуратора. */
const DESIGNER_MARKER = 'Configuration.xml';

/** Файл-маркер формата EDT относительно корня проекта. */
const EDT_MARKER = path.join('src', 'Configuration', 'Configuration.mdo');

/** Каталоги внешних обработок и отчётов в проекте EDT. */
const EDT_EXTERNAL_DIRECTORIES: Readonly<Record<ExternalKind, string>> = {
	processor: 'ExternalDataProcessors',
	report: 'ExternalReports',
};

/** Каталог тестов: корни под ним тестовые. */
const TESTS_DIRECTORY = 'tests';

/** Каталоги, в которые обход не заходит: пакеты и результаты сборок; скрытые каталоги пропускаются все. */
const SKIP_DIRECTORIES = new Set(['node_modules', 'oscript_modules', 'Ext', 'out', 'dist', 'target', 'coverage']);

/** Размер читаемого заголовка файла метаданных. */
const HEAD_SIZE = 4096;

/** Каталоги, которые обход пропускает сверх встроенных: каталог сборки и исключения артефактов. */
let extraExclusions: () => readonly string[] = () => [];

/**
 * Задаёт источник дополнительных исключений обхода.
 *
 * @param provider - Имена каталогов и сегменты путей; читаются при каждом разборе
 */
export function setLayoutExclusions(provider: () => readonly string[]): void {
	extraExclusions = provider;
	cache.clear();
}

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

/**
 * Вид внешнего объекта по заголовку его описания в выгрузке конфигуратора.
 *
 * Корневой тег бывает с префиксом пространства имён.
 */
export function externalKindOfHead(head: string): ExternalKind | undefined {
	if (/<(?:[\w.-]+:)?ExternalDataProcessor[\s>]/.test(head)) {
		return 'processor';
	}
	if (/<(?:[\w.-]+:)?ExternalReport[\s>]/.test(head)) {
		return 'report';
	}
	return undefined;
}

/** Файл описания конфигурации или расширения. */
export function sourceEntry(root: SourceRoot): string {
	return path.join(root.dir, root.format === 'designer' ? DESIGNER_MARKER : EDT_MARKER);
}

/** Каталог внешнего объекта: у выгрузки конфигуратора сам корень, у EDT каталог объекта внутри проекта. */
export function externalDirectory(root: ExternalRoot): string {
	return root.format === 'designer'
		? root.dir
		: path.join(root.dir, 'src', EDT_EXTERNAL_DIRECTORIES[root.kind], root.name);
}

/** Файл описания внешнего объекта. */
export function externalEntry(root: ExternalRoot): string {
	return path.join(externalDirectory(root), root.format === 'designer' ? `${root.file}.xml` : `${root.file}.mdo`);
}

/** Первые байты файла: заголовка хватает, чтобы понять, что это. */
async function readHead(file: string): Promise<string | undefined> {
	try {
		const handle = await fs.open(file, 'r');
		try {
			const buffer = Buffer.alloc(HEAD_SIZE);
			const { bytesRead } = await handle.read(buffer, 0, HEAD_SIZE, 0);
			return buffer.subarray(0, bytesRead).toString('utf8');
		} finally {
			await handle.close();
		}
	} catch {
		return undefined;
	}
}

async function readRoot(directory: string): Promise<SourceRoot | undefined> {
	const marker = markerIn(directory);
	if (!marker) {
		return undefined;
	}
	const head = await readHead(marker.file);
	if (head === undefined) {
		return undefined;
	}
	const { name, isExtension } = describeMarker(head, marker.format);
	return { dir: directory, format: marker.format, name, isExtension };
}

/**
 * Внешний объект выгрузки конфигуратора.
 *
 * Описание лежит в корне каталога объекта и обычно зовётся как каталог, но
 * выгрузка этого не требует, поэтому годится любое описание внешнего объекта.
 */
async function designerExternal(
	directory: string,
	name: string,
	entries: readonly fssync.Dirent[]
): Promise<ExternalRoot | undefined> {
	const files = entries
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.xml'))
		.map((entry) => entry.name)
		.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
	const found: ExternalRoot[] = [];
	for (const file of files) {
		const kind = externalKindOfHead((await readHead(path.join(directory, file))) ?? '');
		if (!kind) {
			continue;
		}
		const root: ExternalRoot = { dir: directory, format: 'designer', kind, name, file: path.basename(file, '.xml') };
		if (file === `${name}.xml`) {
			return root;
		}
		found.push(root);
	}
	// Несколько описаний в каталоге: это не объект, а каталог объектов, и обход идёт дальше
	return found.length === 1 ? found[0] : undefined;
}

/**
 * Внешние объекты каталога.
 *
 * Проект EDT: объекты лежат в `src/ExternalDataProcessors` и `src/ExternalReports`,
 * каждый в своём каталоге с `<Имя>.mdo`.
 */
async function readExternals(directory: string, entries: readonly fssync.Dirent[]): Promise<ExternalRoot[]> {
	const name = path.basename(directory);
	const designer = await designerExternal(directory, name, entries);
	if (designer) {
		return [designer];
	}

	const found: ExternalRoot[] = [];
	for (const kind of Object.keys(EDT_EXTERNAL_DIRECTORIES) as ExternalKind[]) {
		const objects = path.join(directory, 'src', EDT_EXTERNAL_DIRECTORIES[kind]);
		let entries: fssync.Dirent[];
		try {
			entries = await fs.readdir(objects, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.isDirectory() && fssync.existsSync(path.join(objects, entry.name, `${entry.name}.mdo`))) {
				found.push({ dir: directory, format: 'edt', kind, name: entry.name, file: entry.name });
			}
		}
	}
	return found;
}

/** Найденное обходом. */
interface Found {
	roots: SourceRoot[];
	externals: ExternalRoot[];
}

/**
 * Обход дерева: найденный корень не обходится, остальное идёт до конца, поэтому
 * расширение из репозитория, вложенного в каталог расширений, находится вместе с остальными.
 */
async function walk(root: string, skip: ReadonlySet<string>, found: Found): Promise<void> {
	const here = await readRoot(root);
	if (here) {
		found.roots.push(here);
		return;
	}
	let entries: fssync.Dirent[];
	try {
		entries = await fs.readdir(root, { withFileTypes: true });
	} catch {
		return;
	}

	const externals = await readExternals(root, entries);
	if (externals.length > 0) {
		found.externals.push(...externals);
		return;
	}
	// Порядок по кодам символов не зависит от локали машины: первая найденная конфигурация одна и та же везде
	entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name) || skip.has(entry.name)) {
			continue;
		}
		await walk(path.join(root, entry.name), skip, found);
	}
}

/** Лежит ли каталог под каталогом тестов рабочей области. */
export function isTestPath(workspaceRoot: string, directory: string): boolean {
	const relative = path.relative(workspaceRoot, directory);
	if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
		return false;
	}
	return relative.split(/[\\/]/).slice(0, -1).includes(TESTS_DIRECTORY);
}

/**
 * Самый глубокий общий каталог корней: каталог расширений и тогда, когда одно
 * из них лежит в репозитории, вложенном в этот каталог.
 *
 * @returns undefined без корней и когда общего каталога нет
 */
export function commonParent(roots: ReadonlyArray<{ dir: string }>): string | undefined {
	const parents = roots.map((root) => path.normalize(path.dirname(root.dir)).split(path.sep));
	if (parents.length === 0) {
		return undefined;
	}
	const common = parents.reduce((shared, parts) => {
		let length = 0;
		while (length < shared.length && length < parts.length && shared[length] === parts[length]) {
			length += 1;
		}
		return shared.slice(0, length);
	});
	const joined = common.join(path.sep);
	return joined.length > 0 ? joined : undefined;
}

/** Разобранная раскладка и ключ исключений, по которым она получена. */
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

/**
 * Раскладка рабочей области; повторные вызовы отдают разобранную.
 *
 * @param workspaceRoot корень рабочей области
 */
export function resolveProjectLayout(workspaceRoot: string): Promise<ProjectLayout> {
	const root = path.resolve(workspaceRoot);
	const exclusions = [...extraExclusions()];
	const key = JSON.stringify(exclusions);
	const cached = cache.get(root);
	if (cached?.key === key) {
		return cached.layout;
	}

	// Неудачную попытку не запоминаем: следующий вызов должен попробовать снова.
	const layout = readLayout(root, new Set(exclusions)).catch((error: unknown) => {
		cache.delete(root);
		throw error;
	});
	cache.set(root, { key, layout });
	return layout;
}

async function readLayout(workspaceRoot: string, skip: ReadonlySet<string>): Promise<ProjectLayout> {
	const found: Found = { roots: [], externals: [] };
	await walk(workspaceRoot, skip, found);

	const configurations = found.roots.filter((root) => !root.isExtension);
	const extensions = found.roots.filter((root) => root.isExtension);
	const configuration = configurations[0];
	const test = (root: { dir: string }) => isTestPath(workspaceRoot, root.dir);

	return {
		configuration,
		extensions: extensions.filter((root) => !test(root)),
		testExtensions: extensions.filter(test),
		others: configurations.filter((root) => root.dir !== configuration?.dir),
		processors: found.externals.filter((root) => root.kind === 'processor' && !test(root)),
		reports: found.externals.filter((root) => root.kind === 'report' && !test(root)),
		testProcessors: found.externals.filter(test),
		externals: [...new Set(found.externals.filter((root) => root.format === 'edt').map((root) => root.dir))],
	};
}
