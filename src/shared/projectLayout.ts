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
 * каталог тестов, тестовый. Имя каталога задаёт настройка, по умолчанию `tests`.
 *
 * Каталог с `packagedef` и своей конфигурацией ниже корня проекта это подпроект: у
 * него своя раскладка, а его расширения, кроме тестовых, входят и в расширения
 * проекта. Найденное в каталоге с `packagedef` без своей конфигурации, например в
 * репозитории расширения или обработки, принадлежит проекту. Решение о каталоге
 * запоминается и меняется, только когда `packagedef` в нём появился или удалён либо
 * удалён сам каталог: выгрузка, на время очищающая каталог, его не меняет. У корня
 * без `packagedef` подпроект любой каталог с `packagedef`. Обход не заходит и за
 * границы: вложенные папки рабочей области, их задаёт {@link setLayoutBoundaries}.
 *
 * Раскладка единственный источник путей: настроек каталогов исходного кода нет.
 * Результат кэшируется на корень: потребителей много, а обход дерева один и тот
 * же. Ключ кэша - {@link directoryKey} корня. Кэш сбрасывают {@link invalidateProjectLayout},
 * {@link invalidateProjectLayoutsContaining}, {@link invalidateProjectLayoutsForFile} и
 * {@link invalidateProjectLayoutsAffectedBy}.
 * @module projectLayout
 */

import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_TESTING } from './pathDefaults';

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
	/** Имя объекта: у выгрузки конфигуратора имя каталога. */
	name: string;
	/** Имя описания без расширения: в выгрузке конфигуратора оно бывает названо не как каталог. */
	file: string;
}

/** Раскладка рабочей области. */
export interface ProjectLayout {
	configuration?: SourceRoot;
	/** Расширения решения: все, что не под каталогом тестов, вместе с расширениями подпроектов. */
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
	/** Подпроекты ниже корня в порядке обхода. */
	subProjects: string[];
}

/** Файл, по которому каталог считается проектом. */
export const PROJECT_FILE = 'packagedef';

/** Файл-маркер формата конфигуратора. */
const DESIGNER_MARKER = 'Configuration.xml';

/** Файл-маркер формата EDT относительно корня проекта. */
const EDT_MARKER = path.join('src', 'Configuration', 'Configuration.mdo');

/** Каталоги внешних обработок и отчётов в проекте EDT. */
export const EDT_EXTERNAL_DIRECTORIES: Readonly<Record<ExternalKind, string>> = {
	processor: 'ExternalDataProcessors',
	report: 'ExternalReports',
};

/** Каталоги, в которые обход не заходит: пакеты и результаты сборок; скрытые каталоги пропускаются все. */
const SKIP_DIRECTORIES = new Set(['node_modules', 'oscript_modules', 'Ext', 'out', 'dist', 'target', 'coverage']);

/** Размер читаемого заголовка файла метаданных. */
const HEAD_SIZE = 4096;

/** Имя каталога тестов из настроек. */
let testsDirectory: (root?: string) => string = () => DEFAULT_TESTING.directoryName;

/**
 * Задаёт источник имени каталога тестов.
 *
 * @param provider - Имя каталога для корня проекта; читается при каждом разборе
 */
export function setTestsDirectory(provider: (root?: string) => string): void {
	testsDirectory = provider;
	cache.clear();
}

/**
 * Имя каталога тестов: пустая настройка значит имя по умолчанию.
 *
 * @param root - Корень проекта, чьи настройки читаются
 */
export function testsDirectoryName(root?: string): string {
	const name = testsDirectory(root).trim();
	return name.length > 0 ? name : DEFAULT_TESTING.directoryName;
}

/** Каталоги, которые обход пропускает сверх встроенных: каталог сборки и исключения артефактов. */
let extraExclusions: (root: string) => readonly string[] = () => [];

/**
 * Задаёт источник дополнительных исключений обхода.
 *
 * @param provider - Имена каталогов и сегменты путей для корня обхода; читаются при каждом разборе
 */
export function setLayoutExclusions(provider: (root: string) => readonly string[]): void {
	extraExclusions = provider;
	cache.clear();
}

/** Каталоги вне обхода корня: вложенные папки рабочей области. */
let boundaries: (root: string) => readonly string[] = () => [];

/**
 * Задаёт источник границ обхода.
 *
 * @param provider - Абсолютные каталоги ниже корня обхода, в которые обход не заходит
 */
export function setLayoutBoundaries(provider: (root: string) => readonly string[]): void {
	boundaries = provider;
	cache.clear();
}

/** Ключ каталога для сравнения и кэшей: абсолютный путь, на Windows без учёта регистра. */
export function directoryKey(directory: string): string {
	const resolved = path.resolve(directory);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Лежит ли каталог там, куда обход корня не заходит: вне корня, в скрытом или
 * пропускаемом каталоге, в исключении из настроек, за границей обхода.
 *
 * @param root - Корень обхода
 * @param directory - Проверяемый каталог
 */
export function isExcludedFromLayout(root: string, directory: string): boolean {
	const top = path.resolve(root);
	const relative = path.relative(top, path.resolve(directory));
	if (relative === '') {
		return false;
	}
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		return true;
	}
	if (hasSkippedSegment(relative, new Set(extraExclusions(top)))) {
		return true;
	}
	const rootKey = directoryKey(top);
	return boundaries(top).some((boundary) => directoryKey(boundary) !== rootKey && sameOrUnder(directory, boundary));
}

/** Есть ли в относительном пути сегмент, в который обход не заходит. */
function hasSkippedSegment(relative: string, skip: ReadonlySet<string>): boolean {
	return relative.split(/[\\/]/).some((segment) => segment.startsWith('.') || SKIP_DIRECTORIES.has(segment) || skip.has(segment));
}

/** Лежит ли в каталоге `packagedef`. */
export function hasProjectFile(directory: string): boolean {
	return fssync.existsSync(path.join(directory, PROJECT_FILE));
}

/** Первые байты файла без ожидания. */
function readHeadSync(file: string): string | undefined {
	let handle: number | undefined;
	try {
		handle = fssync.openSync(file, 'r');
		const buffer = Buffer.alloc(HEAD_SIZE);
		const bytesRead = fssync.readSync(handle, buffer, 0, HEAD_SIZE, 0);
		return buffer.subarray(0, bytesRead).toString('utf8');
	} catch {
		return undefined;
	} finally {
		if (handle !== undefined) {
			fssync.closeSync(handle);
		}
	}
}

/**
 * Останавливается ли обход на каталоге: в нём исходный код конфигурации или
 * расширения либо внешний объект, или каталог не читается. Правила те же, что у
 * обхода, проверка без ожидания.
 */
export function stopsLayoutWalk(directory: string): boolean {
	const marker = markerIn(directory);
	if (marker && readHeadSync(marker.file) !== undefined) {
		return true;
	}
	let entries: fssync.Dirent[];
	try {
		entries = fssync.readdirSync(directory, { withFileTypes: true });
	} catch {
		return true;
	}
	const descriptions = entries
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.xml'))
		.map((entry) => entry.name)
		.filter((file) => externalKindOfHead(readHeadSync(path.join(directory, file)) ?? '') !== undefined);
	if (descriptions.length === 1 || descriptions.includes(`${path.basename(directory)}.xml`)) {
		return true;
	}
	return Object.values(EDT_EXTERNAL_DIRECTORIES).some((kindDirectory) => {
		const objects = path.join(directory, 'src', kindDirectory);
		try {
			return fssync
				.readdirSync(objects, { withFileTypes: true })
				.some((entry) => entry.isDirectory() && fssync.existsSync(path.join(objects, entry.name, `${entry.name}.mdo`)));
		} catch {
			return false;
		}
	});
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

/** Тот же каталог или каталог внутри него; на Windows регистр не важен. */
export function sameOrUnder(directory: string, root: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(directory));
	if (relative === '') {
		return true;
	}
	return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Корень раскладки, которому принадлежит каталог: сам корень или каталог внутри него.
 *
 * Инструментам передаётся корень целиком: у проекта EDT это каталог проекта, а не
 * его `src`, который приходит из дерева метаданных. Из вложенных корней берётся
 * самый глубокий.
 */
export function rootOfDirectory(layout: ProjectLayout, directory: string): SourceRoot | undefined {
	const roots = [
		...(layout.configuration ? [layout.configuration] : []),
		...layout.others,
		...layout.extensions,
		...layout.testExtensions,
	];
	let found: SourceRoot | undefined;
	for (const root of roots) {
		if (sameOrUnder(directory, root.dir) && (!found || root.dir.length > found.dir.length)) {
			found = root;
		}
	}
	return found;
}

/**
 * Каталог проекта 1C:EDT: конфигурация, расширение или проект внешних объектов.
 *
 * Проект внешних объектов описания конфигурации не имеет, его выдают файлы проекта.
 */
export function isEdtProject(directory: string): boolean {
	return (
		markerIn(directory)?.format === 'edt' ||
		(fssync.existsSync(path.join(directory, '.project')) &&
			fssync.existsSync(path.join(directory, 'DT-INF', 'PROJECT.PMF')))
	);
}

/**
 * Ближайший проект EDT, внутри которого лежит каталог, не выше корня рабочей области.
 *
 * @returns каталог проекта либо undefined
 */
export function enclosingEdtProject(workspaceRoot: string, directory: string): string | undefined {
	const top = path.resolve(workspaceRoot);
	let current = path.resolve(directory);
	while (sameOrUnder(current, top)) {
		if (isEdtProject(current)) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
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

/** Подпроект и его раскладка; у подпроектов корня без `packagedef` раскладки нет. */
interface FoundSubProject {
	dir: string;
	layout?: ProjectLayout;
}

/** Найденное обходом. */
interface Found {
	/** Корень обхода проект: каталоги с `packagedef` в нём подпроекты, только если так решено. */
	project: boolean;
	/** Корни в порядке обхода, расширения подпроектов на месте подпроекта. */
	roots: SourceRoot[];
	externals: ExternalRoot[];
	subProjects: FoundSubProject[];
}

/** Раскладки подпроектов законченного обхода: изменения в подпроекте меняют расширения родителя. */
const subProjectLayouts = new WeakMap<ProjectLayout, readonly Required<FoundSubProject>[]>();

/** Подпроект раскладки, внутри которого лежит каталог. */
function subProjectContaining(layout: ProjectLayout, directory: string): Required<FoundSubProject> | undefined {
	return subProjectLayouts.get(layout)?.find((item) => sameOrUnder(directory, item.dir));
}

/** Решения о каталогах с `packagedef` ниже корня проекта: ключ {@link directoryKey}, true подпроект. */
const subProjectDecisions = new Map<string, boolean>();

/**
 * Забывает решение о каталоге с `packagedef`: `packagedef` в нём появился или удалён.
 * Следующий обход решает по тому, что найдёт в каталоге.
 *
 * @param directory - Каталог `packagedef`
 */
export function forgetSubProjectDecision(directory: string): void {
	subProjectDecisions.delete(directoryKey(directory));
}

/** Забывает решения о каталогах в удалённом пути и о каталоге удалённого `packagedef`. */
function forgetSubProjectDecisionsForRemoval(removed: string): void {
	if (path.basename(removed) === PROJECT_FILE) {
		forgetSubProjectDecision(path.dirname(removed));
	}
	const key = directoryKey(removed);
	for (const dir of [...subProjectDecisions.keys()]) {
		if (sameOrUnder(dir, key)) {
			subProjectDecisions.delete(dir);
		}
	}
}

/**
 * Каталог с `packagedef` ниже корня проекта: подпроект, и родителю достаются его
 * расширения, или часть родителя, и родителю достаётся всё найденное в нём.
 */
async function walkProjectDirectory(root: string, skip: ReadonlySet<string>, stops: ReadonlySet<string>, found: Found): Promise<void> {
	if (!found.project) {
		found.subProjects.push({ dir: root });
		return;
	}
	const inner: Found = { project: true, roots: [], externals: [], subProjects: [] };
	await walk(root, skip, stops, inner);
	const key = directoryKey(root);
	// Подпроектом каталог остаётся, пока есть packagedef; прозрачный становится подпроектом, когда в нём появилась конфигурация
	let subProject = subProjectDecisions.get(key);
	if (subProject !== true) {
		subProject = inner.roots.some((item) => !item.isExtension);
		subProjectDecisions.set(key, subProject);
	}
	if (subProject) {
		const layout = layoutOfFound(root, inner);
		found.subProjects.push({ dir: root, layout });
		found.roots.push(...layout.extensions);
		return;
	}
	found.roots.push(...inner.roots);
	found.externals.push(...inner.externals);
	found.subProjects.push(...inner.subProjects);
}

/**
 * Каталог тестов внутри конфигурации: обход заходит в него, когда конфигурация
 * лежит в самом корне обхода, например проект EDT с `packagedef`. Каталог лежит
 * вне `src` и метаданными конфигурации не считается.
 *
 * @returns Каталог либо undefined у расширения
 */
function testsInsideConfiguration(root: SourceRoot): string | undefined {
	return root.isExtension ? undefined : path.join(root.dir, testsDirectoryName(root.dir));
}

/**
 * Обход дерева: найденный корень не обходится, остальное идёт до конца, поэтому
 * расширение из репозитория, вложенного в каталог расширений, находится вместе с остальными.
 * Подпроект ниже корня обхода обходится своим обходом.
 */
async function walk(root: string, skip: ReadonlySet<string>, stops: ReadonlySet<string>, found: Found, top = true): Promise<void> {
	if (!top && stops.size > 0 && stops.has(directoryKey(root))) {
		return;
	}
	if (!top && hasProjectFile(root)) {
		await walkProjectDirectory(root, skip, stops, found);
		return;
	}
	const here = await readRoot(root);
	if (here) {
		found.roots.push(here);
		// Конфигурация в корне обхода сама проект 1С: каталог тестов лежит в ней, как у выгрузки в каталоге проекта
		const tests = top ? testsInsideConfiguration(here) : undefined;
		if (tests !== undefined && fssync.existsSync(tests)) {
			await walk(tests, skip, stops, found, false);
		}
		// Корень обхода сам является проектом: внешние проекты внутри него обычный обход не видит
		if (top) {
			await walkEdtExternalProjects(here.dir, skip, stops, found);
		}
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
		await walk(path.join(root, entry.name), skip, stops, found, false);
	}
}

/** Соседние каталоги с проектом внешних отчётов или обработок. */
async function walkEdtExternalProjects(
	projectDir: string,
	skip: ReadonlySet<string>,
	stops: ReadonlySet<string>,
	found: Found
): Promise<void> {
	let entries: fssync.Dirent[];
	try {
		entries = await fs.readdir(projectDir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name) || skip.has(entry.name)) {
			continue;
		}
		const child = path.join(projectDir, entry.name);
		const external = Object.values(EDT_EXTERNAL_DIRECTORIES).some((kindDirectory) =>
			fssync.existsSync(path.join(child, 'src', kindDirectory))
		);
		if (external) {
			await walk(child, skip, stops, found, false);
		}
	}
}

/** Лежит ли каталог под каталогом тестов рабочей области. */
export function isTestPath(workspaceRoot: string, directory: string): boolean {
	const relative = path.relative(workspaceRoot, directory);
	if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
		return false;
	}
	// Регистр имени не важен: на Windows Tests и tests это один каталог
	const name = testsDirectoryName(workspaceRoot).toLowerCase();
	return relative
		.split(/[\\/]/)
		.slice(0, -1)
		.some((segment) => segment.toLowerCase() === name);
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

/** Изменение, пришедшее во время обхода. */
type WalkChange = { removed: string } | { file: string };

/** Сколько раз подряд повторяется обход, во время которого менялось найденное. */
const MAX_WALKS = 5;

/**
 * Глубина каталогов внешнего объекта, в которых обход читает описания: у проекта EDT
 * `src/ExternalDataProcessors/<Имя>`, у выгрузки конфигуратора только каталог объекта.
 */
const EXTERNAL_DESCRIPTION_DEPTH: Readonly<Record<SourceFormat, number>> = { edt: 3, designer: 0 };

/** Разобранная раскладка и ключ настроек, по которым она получена. */
interface CacheEntry {
	/** Корень обхода в написании первого вызова. */
	root: string;
	key: string;
	/** Исключения обхода из настроек. */
	skip: ReadonlySet<string>;
	/** Ключи границ обхода. */
	stops: ReadonlySet<string>;
	layout: Promise<ProjectLayout>;
	/** Раскладка, когда обход закончен. */
	resolved?: ProjectLayout;
	/** Изменения во время идущего обхода. */
	changes?: WalkChange[];
	/** Обход повторялся {@link MAX_WALKS} раз, и найденное всё ещё менялось. */
	stale?: boolean;
}

/** Раскладки: ключ - {@link directoryKey} корня обхода. */
const cache = new Map<string, CacheEntry>();

/**
 * Забывает разобранную раскладку.
 *
 * @param workspaceRoot - Корень; без него забываются все
 */
export function invalidateProjectLayout(workspaceRoot?: string): void {
	if (workspaceRoot === undefined) {
		cache.clear();
		return;
	}
	cache.delete(directoryKey(workspaceRoot));
}

/**
 * Забывает раскладки корней, внутри которых лежит путь: файл изменился только у них.
 *
 * @param target - Изменившийся файл или каталог
 * @returns true, если что-то забыто
 */
export function invalidateProjectLayoutsContaining(target: string): boolean {
	let forgotten = false;
	for (const [key, entry] of [...cache]) {
		if (sameOrUnder(target, entry.root)) {
			cache.delete(key);
			forgotten = true;
		}
	}
	return forgotten;
}

/** Исключён ли каталог из обхода, которым получена раскладка записи. */
function excludedFromEntry(entry: CacheEntry, directory: string): boolean {
	const relative = path.relative(entry.root, path.resolve(directory));
	if (relative === '') {
		return false;
	}
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		return true;
	}
	return hasSkippedSegment(relative, entry.skip) || [...entry.stops].some((stop) => sameOrUnder(directory, stop));
}

/** Каталоги внешних объектов обоих форматов. */
function externalDirectoriesOf(layout: ProjectLayout): string[] {
	return externalObjectsOf(layout).map((item) => item.dir);
}

/** Каталоги внешних объектов с форматом. */
function externalObjectsOf(layout: ProjectLayout): Array<{ dir: string; format: SourceFormat }> {
	return [
		...[...layout.processors, ...layout.reports, ...layout.testProcessors].map((root) => ({ dir: root.dir, format: root.format })),
		...layout.externals.map((dir) => ({ dir, format: 'edt' as const })),
	];
}

/**
 * Видит ли законченный обход файл описания: файл вне подпроектов и найденных
 * корней или в каталоге тестов конфигурации, описание найденной конфигурации или расширения, описание в верхних
 * каталогах внешнего объекта. Файл подпроекта проекта видит, если его видит обход подпроекта.
 */
function layoutSeesFile(layout: ProjectLayout, file: string): boolean {
	const directory = path.dirname(file);
	const subProject = subProjectContaining(layout, directory);
	if (subProject) {
		return layoutSeesFile(subProject.layout, file);
	}
	if (layout.subProjects.some((dir) => sameOrUnder(directory, dir))) {
		return false;
	}
	// Каталог тестов внутри конфигурации обход проходит, как каталоги вне корней
	const root = rootOfDirectory(layout, directory);
	const tests = root === undefined ? undefined : testsInsideConfiguration(root);
	if (root && !(tests !== undefined && sameOrUnder(directory, tests))) {
		const key = directoryKey(file);
		return key === directoryKey(path.join(root.dir, DESIGNER_MARKER)) || key === directoryKey(path.join(root.dir, EDT_MARKER));
	}
	const external = externalObjectsOf(layout).find((item) => sameOrUnder(directory, item.dir));
	return (
		external === undefined ||
		path.relative(external.dir, directory).split(/[\\/]/).filter((segment) => segment.length > 0).length <=
			EXTERNAL_DESCRIPTION_DEPTH[external.format]
	);
}

/** Что удаление каталога меняет в законченной раскладке. */
function removalImpact(layout: ProjectLayout, target: string): { affected: boolean; projects: boolean } {
	const subProject = subProjectContaining(layout, target);
	if (subProject && directoryKey(subProject.dir) !== directoryKey(target)) {
		return removalImpact(subProject.layout, target);
	}
	const inside = (dir: string) => sameOrUnder(dir, target);
	const configurations = [...(layout.configuration ? [layout.configuration] : []), ...layout.others].map((root) => root.dir);
	const projects = [...configurations, ...layout.subProjects].some(inside);
	const objects = [...layout.extensions, ...layout.testExtensions].map((root) => root.dir);
	return { affected: projects || [...objects, ...externalDirectoriesOf(layout)].some(inside), projects };
}

function walkChangeAffects(layout: ProjectLayout, change: WalkChange): boolean {
	return 'removed' in change ? removalImpact(layout, change.removed).affected : layoutSeesFile(layout, change.file);
}

/**
 * Забывает раскладки корней, обход которых видит файл описания: файл в
 * пропускаемом каталоге (`oscript_modules`, `.git`, каталог сборки) или внутри
 * найденной конфигурации, кроме её описания, раскладку не меняет; файл подпроекта
 * меняет, если его видит обход подпроекта.
 * Идущий обход не забывается: изменение запоминается, и обход повторяется, если
 * оно касается найденного.
 *
 * @param file - Появившийся или удалённый файл
 * @returns true, если что-то забыто
 */
export function invalidateProjectLayoutsForFile(file: string): boolean {
	const resolvedFile = path.resolve(file);
	const directory = path.dirname(resolvedFile);
	let forgotten = false;
	for (const [key, entry] of [...cache]) {
		if (!sameOrUnder(directory, entry.root) || excludedFromEntry(entry, directory)) {
			continue;
		}
		if (!entry.resolved) {
			entry.changes?.push({ file: resolvedFile });
			continue;
		}
		if (layoutSeesFile(entry.resolved, resolvedFile)) {
			cache.delete(key);
			forgotten = true;
		}
	}
	return forgotten;
}

/** Что забыто после удаления или переименования. */
export interface LayoutInvalidation {
	/** Хотя бы одна раскладка забыта. */
	forgotten: boolean;
	/** Забытое касалось корня обхода, конфигурации или подпроекта: проекты ищутся заново. */
	projects: boolean;
}

/**
 * Забывает раскладки, которые затронуло удаление или переименование пути: корень
 * лежит в нём, или законченный обход корня нашёл в нём конфигурацию, расширение,
 * внешний объект или подпроект. Идущий обход не забывается: удаление
 * запоминается, и обход повторяется, если в удалённом оказалось найденное.
 * Решения о подпроектах в удалённом пути и о каталоге удалённого `packagedef` забываются.
 *
 * @param target - Удалённый или переименованный файл или каталог
 */
export function invalidateProjectLayoutsForRemoval(target: string): LayoutInvalidation {
	const removed = path.resolve(target);
	forgetSubProjectDecisionsForRemoval(removed);
	const result: LayoutInvalidation = { forgotten: false, projects: false };
	for (const [key, entry] of [...cache]) {
		let impact: { affected: boolean; projects: boolean };
		if (sameOrUnder(entry.root, removed)) {
			impact = { affected: true, projects: true };
		} else if (!sameOrUnder(removed, entry.root) || excludedFromEntry(entry, removed)) {
			continue;
		} else if (!entry.resolved) {
			entry.changes?.push({ removed });
			continue;
		} else {
			impact = removalImpact(entry.resolved, removed);
		}
		if (impact.affected) {
			cache.delete(key);
			result.forgotten = true;
			result.projects ||= impact.projects;
		}
	}
	return result;
}

/**
 * То же, что {@link invalidateProjectLayoutsForRemoval}.
 *
 * @param target - Удалённый или переименованный файл или каталог
 * @returns true, если что-то забыто
 */
export function invalidateProjectLayoutsAffectedBy(target: string): boolean {
	return invalidateProjectLayoutsForRemoval(target).forgotten;
}

/** Обход, повторённый, пока изменения во время него касаются найденного. */
async function readSettledLayout(entry: CacheEntry): Promise<ProjectLayout> {
	for (let walk = 1; ; walk += 1) {
		const changes: WalkChange[] = [];
		entry.changes = changes;
		const layout = await readLayout(entry.root, entry.skip, entry.stops);
		entry.changes = undefined;
		const affected = changes.some((change) => walkChangeAffects(layout, change));
		if (!affected || walk === MAX_WALKS) {
			entry.stale = affected;
			entry.resolved = layout;
			return layout;
		}
	}
}

/**
 * Раскладка корня; повторные вызовы отдают разобранную.
 *
 * @param workspaceRoot корень проекта или папки рабочей области
 */
export function resolveProjectLayout(workspaceRoot: string): Promise<ProjectLayout> {
	const root = path.resolve(workspaceRoot);
	const rootKey = directoryKey(root);
	const exclusions = [...extraExclusions(root)];
	const stops = boundaries(root).map(directoryKey).filter((stop) => stop !== rootKey).sort();
	const key = JSON.stringify([exclusions, testsDirectoryName(root), stops]);
	const cached = cache.get(rootKey);
	if (cached?.key === key && !cached.stale) {
		return cached.layout;
	}

	const entry: CacheEntry = {
		root,
		key,
		skip: new Set(exclusions),
		stops: new Set(stops),
		// Неудачную попытку не запоминаем: следующий вызов должен попробовать снова.
		layout: Promise.resolve()
			.then(() => readSettledLayout(entry))
			.catch((error: unknown) => {
				if (cache.get(rootKey) === entry) {
					cache.delete(rootKey);
				}
				throw error;
			}),
	};
	cache.set(rootKey, entry);
	return entry.layout;
}

async function readLayout(workspaceRoot: string, skip: ReadonlySet<string>, stops: ReadonlySet<string>): Promise<ProjectLayout> {
	const found: Found = { project: hasProjectFile(workspaceRoot), roots: [], externals: [], subProjects: [] };
	await walk(workspaceRoot, skip, stops, found);
	return layoutOfFound(workspaceRoot, found);
}

/** Раскладка из найденного обходом корня. */
function layoutOfFound(workspaceRoot: string, found: Found): ProjectLayout {
	const configurations = found.roots.filter((root) => !root.isExtension);
	const extensions = found.roots.filter((root) => root.isExtension);
	const configuration = configurations[0];
	const test = (root: { dir: string }) => isTestPath(workspaceRoot, root.dir);

	const layout: ProjectLayout = {
		configuration,
		extensions: extensions.filter((root) => !test(root)),
		testExtensions: extensions.filter(test),
		others: configurations.filter((root) => root.dir !== configuration?.dir),
		processors: found.externals.filter((root) => root.kind === 'processor' && !test(root)),
		reports: found.externals.filter((root) => root.kind === 'report' && !test(root)),
		testProcessors: found.externals.filter(test),
		externals: [...new Set(found.externals.filter((root) => root.format === 'edt').map((root) => root.dir))],
		subProjects: found.subProjects.map((item) => item.dir),
	};
	subProjectLayouts.set(
		layout,
		found.subProjects.filter((item): item is Required<FoundSubProject> => item.layout !== undefined)
	);
	return layout;
}
