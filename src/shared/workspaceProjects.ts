/**
 * Проекты 1С в рабочей области и текущий проект.
 *
 * Проект - каталог, в котором прямо лежит `packagedef`: папка рабочей области,
 * каталог внутри папки без `packagedef` или подпроект внутри другого проекта.
 * Проекты внутри папки и подпроекты находит обход раскладки, в подпроект обход
 * родителя не заходит.
 *
 * Модуль единственный источник корня для команд, панелей и MCP. Корень берут
 * через {@link currentRoot}; команда над файлом или узлом дерева выполняется в
 * `runWithProject(projectOf(uri), fn)` и выбор пользователя не трогает.
 * @module workspaceProjects
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { statSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	directoryKey,
	forgetSubProjectDecision,
	hasProjectFile,
	invalidateProjectLayoutsAffectedBy,
	invalidateProjectLayoutsContaining,
	isExcludedFromLayout,
	PROJECT_FILE,
	resolveProjectLayout,
	sameOrUnder,
	setLayoutBoundaries,
	stopsLayoutWalk,
	type ProjectLayout,
	type SourceRoot,
} from './projectLayout';
import { logger } from './logger';
import { outsideLaunchSelection } from './launchSelection';
import { declaresPackageApi, parsePackagedef } from './packagedef';
import { projectKindOf, type ProjectKind } from './projectKind';
import { notifyProjectLayoutChanged, onDidChangeProjectLayout, type ProjectLayoutChange } from './projectLayoutWatch';

const log = logger.scope('projects');

/** Ключ выбранного проекта в workspaceState: абсолютный корень. */
export const CURRENT_PROJECT_KEY = '1c-platform-tools.currentProject';

/** Настройка проекта по умолчанию. */
export const DEFAULT_PROJECT_SETTING = '1c-platform-tools.project.default';

/** Ключ контекста: в окне есть хотя бы один проект. */
export const IS_1C_PROJECT_CONTEXT = '1c-platform-tools.is1CProject';

/** Ключ контекста: проектов вместе с подпроектами больше одного. */
export const MULTIPLE_PROJECTS_CONTEXT = '1c-platform-tools.project.multiple';

/** Ключ контекста: в окне есть не проекты. */
export const HAS_CANDIDATES_CONTEXT = '1c-platform-tools.project.hasCandidates';

/** Ключ контекста: первое полное обнаружение проектов ещё не закончено. */
export const DETECTING_CONTEXT = '1c-platform-tools.project.detecting';

/** Ключ контекста: вид текущего проекта, пусто, пока он не известен. */
export const PROJECT_KIND_CONTEXT = '1c-platform-tools.project.kind';

/** Шаблон `packagedef` относительно каталога расширения. */
export const PROJECT_FILE_TEMPLATE = path.join('resources', 'templates', 'packagedef.template');

/** Шаблон `packagedef` проекта OneScript относительно каталога расширения. */
export const ONESCRIPT_PROJECT_FILE_TEMPLATE = path.join('resources', 'templates', 'packagedef-onescript.template');

/** Место имени пакета в шаблоне `packagedef`: туда ставится имя каталога проекта. */
const TEMPLATE_NAME = '{{name}}';

/** Пачка изменений файлов даёт одно обнаружение. */
const REFRESH_DELAY_MS = 200;

/** Папка рабочей области. */
export interface WorkspaceFolderRef {
	name: string;
	/** Абсолютный путь. */
	root: string;
}

/** Проект 1С. */
export interface WorkspaceProject {
	/** Абсолютный корень: каталог с `packagedef`. */
	root: string;
	/** Имя папки рабочей области у проекта в корне папки, иначе имя каталога. */
	name: string;
	/** Корень папки рабочей области, в которой лежит проект. */
	folder: string;
	/** Корень проекта, внутри которого лежит подпроект. */
	parent?: string;
	/** Лежит внутри другого проекта. */
	subProject: boolean;
	/** Конфигурация из раскладки проекта; нет до полного обнаружения и без исходного кода. */
	configuration?: SourceRoot;
	/** Вид проекта, см. {@link projectKindOf}; нет до полного обнаружения. */
	kind?: ProjectKind;
	/** `packagedef` объявляет классы, модули или исполняемый файл: проект собирается пакетом OneScript. */
	package?: boolean;
}

/** Откуда взялся не проект. */
export type ProjectCandidateKind = 'folder' | 'extraConfiguration';

/** Исходный код конфигурации без своего `packagedef`. */
export interface ProjectCandidate {
	/** Каталог, в который ставится `packagedef`. */
	root: string;
	/** Имя папки рабочей области или имя каталога. */
	name: string;
	/**
	 * Имя для показа: совпадающие имена не проектов различаются так же, как у
	 * {@link projectDisplayName}. Есть у найденных обнаружением.
	 */
	displayName?: string;
	/** Корень папки рабочей области. */
	folder: string;
	/** Проект, внутри которого найдена вторая конфигурация. */
	parent?: string;
	kind: ProjectCandidateKind;
	configuration: SourceRoot;
}

/** Найденные проекты и не проекты. */
export interface WorkspaceProjectsSnapshot {
	/** По порядку папок, за каждым проектом его подпроекты. */
	projects: WorkspaceProject[];
	candidates: ProjectCandidate[];
	/** false: полный обход ещё не закончен, известны корневые проекты и найденное прошлым обходом. */
	complete: boolean;
}

/** Смена текущего проекта. */
export interface CurrentProjectChange {
	previous: string | undefined;
	current: string | undefined;
}

/** Каталог, в котором ищутся файлы проекта. */
export interface ProjectScanRoot {
	root: string;
	/** Абсолютные каталоги внутри root, которые принадлежат другим проектам или папкам. */
	excludeDirs: string[];
}

/** Как создать `packagedef`. */
export interface CreateProjectFileOptions {
	/** Перезаписать существующий файл. */
	overwrite?: boolean;
	/** Сделать новый проект текущим; по умолчанию true. */
	select?: boolean;
	/** Шаблон вместо шаблона расширения. */
	templateFile?: string;
	/** Проект OneScript: шаблон пакета OneScript вместо шаблона проекта 1С. */
	oneScript?: boolean;
}

/** `packagedef` уже есть, а перезапись не запрошена. */
export class ProjectFileExistsError extends Error {
	constructor(readonly file: string) {
		super(`Файл ${PROJECT_FILE} уже есть: ${file}`);
		this.name = 'ProjectFileExistsError';
	}
}

/**
 * Корень в едином написании: абсолютный, на Windows буква диска строчная, как в
 * путях папок рабочей области.
 */
export function normalizeProjectRoot(root: string): string {
	const resolved = path.resolve(root);
	return process.platform === 'win32' ? resolved.replace(/^[A-Z](?=:)/, (drive) => drive.toLowerCase()) : resolved;
}

/** Ключ корня для сравнения, словарей и имён ключей состояния; на Windows без учёта регистра. */
export function projectRootKey(root: string): string {
	return directoryKey(root);
}

/** Один и тот же каталог; на Windows регистр не важен. */
export function sameProjectRoot(left: string, right: string): boolean {
	return projectRootKey(left) === projectRootKey(right);
}

/**
 * Каталог, в который ставится `packagedef` для найденной конфигурации: у выгрузки
 * конфигуратора `<p>/src/cf` это `<p>`, иначе каталог конфигурации.
 *
 * @param parentRoot - Проект, внутри которого найдена конфигурация: каталог не выше
 *   и не равен ему, иначе берётся каталог конфигурации
 */
export function packagedefTargetDir(configuration: SourceRoot, parentRoot?: string): string {
	const dir = path.resolve(configuration.dir);
	const parent = path.dirname(dir);
	const target =
		configuration.format === 'designer' && path.basename(dir) === 'cf' && path.basename(parent) === 'src'
			? path.dirname(parent)
			: dir;
	if (parentRoot !== undefined && (sameProjectRoot(target, parentRoot) || !sameOrUnder(target, parentRoot))) {
		return dir;
	}
	return target;
}

async function layoutOf(root: string): Promise<ProjectLayout | undefined> {
	try {
		return await resolveProjectLayout(root);
	} catch {
		return undefined;
	}
}

/** Корневые проекты: папки с `packagedef` в корне, без обхода. */
export function rootProjectsOf(folders: readonly WorkspaceFolderRef[]): WorkspaceProject[] {
	return folders
		.filter((folder) => hasProjectFile(folder.root))
		.map((folder) => {
			const root = normalizeProjectRoot(folder.root);
			return { root, name: folder.name, folder: root, subProject: false };
		});
}

/** Папки рабочей области строго внутри каталога: для него это границы обхода. */
export function nestedWorkspaceFolders(folders: readonly WorkspaceFolderRef[], root: string): string[] {
	const key = projectRootKey(root);
	return folders
		.filter((folder) => projectRootKey(folder.root) !== key && sameOrUnder(folder.root, root))
		.map((folder) => normalizeProjectRoot(folder.root));
}

/** Не проекты без повторов корня; папка рабочей области важнее второй конфигурации. */
function uniqueCandidates(candidates: readonly ProjectCandidate[]): ProjectCandidate[] {
	const result: ProjectCandidate[] = [];
	const index = new Map<string, number>();
	for (const candidate of candidates) {
		const key = projectRootKey(candidate.root);
		const at = index.get(key);
		if (at === undefined) {
			index.set(key, result.length);
			result.push(candidate);
		} else if (candidate.kind === 'folder' && result[at].kind !== 'folder') {
			result[at] = candidate;
		}
	}
	return result;
}

/**
 * Проекты, подпроекты и не проекты всех папок рабочей области.
 *
 * Папка без `packagedef` отдаёт проекты, найденные в ней обходом, и сама становится
 * не проектом, если у неё есть конфигурация вне этих проектов. Вложенные папки
 * рабочей области обход родителя не видит, когда границы заданы через
 * `setLayoutBoundaries` (это делает {@link initWorkspaceProjects}).
 *
 * @param folders - Папки по порядку рабочей области
 */
export async function detectWorkspaceProjects(folders: readonly WorkspaceFolderRef[]): Promise<WorkspaceProjectsSnapshot> {
	const projects: WorkspaceProject[] = [];
	const candidates: ProjectCandidate[] = [];
	const folderKeys = new Set(folders.map((folder) => projectRootKey(folder.root)));
	const seen = new Set<string>();

	const visit = async (project: WorkspaceProject): Promise<void> => {
		const key = projectRootKey(project.root);
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		const layout = await layoutOf(project.root);
		const manifest = parsePackagedef(await fs.readFile(path.join(project.root, PROJECT_FILE), 'utf-8').catch(() => ''));
		projects.push({
			...project,
			configuration: layout?.configuration,
			kind: layout ? projectKindOf(layout, manifest) : undefined,
			package: declaresPackageApi(manifest),
		});
		for (const other of layout?.others ?? []) {
			const root = normalizeProjectRoot(packagedefTargetDir(other, project.root));
			candidates.push({
				root,
				name: path.basename(root),
				folder: project.folder,
				parent: project.root,
				kind: 'extraConfiguration',
				configuration: other,
			});
		}
		for (const dir of layout?.subProjects ?? []) {
			if (!folderKeys.has(projectRootKey(dir))) {
				const root = normalizeProjectRoot(dir);
				await visit({ root, name: path.basename(root), folder: project.folder, parent: project.root, subProject: true });
			}
		}
	};

	for (const folder of folders) {
		const root = normalizeProjectRoot(folder.root);
		if (hasProjectFile(root)) {
			await visit({ root, name: folder.name, folder: root, subProject: false });
			continue;
		}
		const layout = await layoutOf(root);
		if (layout?.configuration) {
			candidates.push({ root, name: folder.name, folder: root, kind: 'folder', configuration: layout.configuration });
		}
		for (const dir of layout?.subProjects ?? []) {
			if (!folderKeys.has(projectRootKey(dir))) {
				const projectRoot = normalizeProjectRoot(dir);
				await visit({ root: projectRoot, name: path.basename(projectRoot), folder: root, subProject: false });
			}
		}
	}
	return { projects, candidates: withDisplayNames(uniqueCandidates(candidates), projects), complete: true };
}

/** Самый глубокий проект (или папка), внутри которого лежит путь. */
export function deepestProject<T extends { root: string }>(projects: readonly T[], target: string): T | undefined {
	let found: T | undefined;
	for (const project of projects) {
		if (sameOrUnder(target, project.root) && (!found || path.resolve(project.root).length > path.resolve(found.root).length)) {
			found = project;
		}
	}
	return found;
}

/**
 * Корни, которые может означать настройка проекта по умолчанию, в порядке
 * проверки: абсолютный путь, путь относительно первой папки, имя папки.
 */
export function defaultProjectPaths(value: string | undefined, folders: readonly WorkspaceFolderRef[]): string[] {
	const trimmed = value?.trim();
	if (!trimmed) {
		return [];
	}
	if (path.isAbsolute(trimmed)) {
		return [normalizeProjectRoot(trimmed)];
	}
	const first = folders.at(0);
	return [
		...(first ? [normalizeProjectRoot(path.join(first.root, trimmed))] : []),
		...folders.filter((folder) => folder.name === trimmed).map((folder) => normalizeProjectRoot(folder.root)),
	];
}

/** Что известно для выбора текущего проекта. */
export interface CurrentRootInputs {
	/** Корень вызова. */
	override?: string;
	/** Сохранённый выбор. */
	persisted?: string;
	/** Значение настройки проекта по умолчанию. */
	defaultSetting?: string;
	folders: readonly WorkspaceFolderRef[];
	projects: readonly WorkspaceProject[];
	/** Есть ли в окне такой проект. */
	isProject: (root: string) => boolean;
}

/** Проект в корне папки рабочей области, а не найденный обходом внутри неё. */
export function isFolderRootProject(project: WorkspaceProject): boolean {
	return sameProjectRoot(project.root, project.folder);
}

/**
 * Текущий корень: корень вызова, сохранённый выбор, настройка, первый проект в
 * корне папки рабочей области, первый проект не внутри другого проекта,
 * единственная папка рабочей области.
 */
export function resolveCurrentRoot(inputs: CurrentRootInputs): string | undefined {
	if (inputs.override !== undefined) {
		return normalizeProjectRoot(inputs.override);
	}
	if (inputs.persisted !== undefined && inputs.isProject(inputs.persisted)) {
		return normalizeProjectRoot(inputs.persisted);
	}
	const configured = defaultProjectPaths(inputs.defaultSetting, inputs.folders).find((root) => inputs.isProject(root));
	if (configured !== undefined) {
		return configured;
	}
	const first = inputs.projects.find(isFolderRootProject) ?? inputs.projects.find((project) => !project.subProject);
	if (first) {
		return first.root;
	}
	return inputs.folders.length === 1 ? normalizeProjectRoot(inputs.folders[0].root) : undefined;
}

/**
 * Имя проекта для показа. Совпадающие имена различаются именем родительского
 * проекта, затем путём от каталога над папкой рабочей области, затем корнем.
 *
 * @param project - Проект
 * @param all - Все проекты окна
 */
export function projectDisplayName(project: WorkspaceProject, all: readonly WorkspaceProject[] = projectsSnapshot().projects): string {
	return distinctName(project, all, all);
}

/** Имя с корнем, папкой и родительским проектом. */
interface NamedRoot {
	root: string;
	name: string;
	folder: string;
	parent?: string;
}

/**
 * Имя, которое отличается от остальных имён списка: само имя, затем с именем
 * родительского проекта, затем с путём от каталога над папкой рабочей области,
 * затем с корнем.
 *
 * @param item - Элемент списка
 * @param all - Список, в котором имена должны различаться
 * @param projects - Проекты, среди которых ищется родительский
 */
function distinctName<T extends NamedRoot>(item: T, all: readonly T[], projects: readonly WorkspaceProject[]): string {
	const key = projectRootKey(item.root);
	const group = [item, ...all.filter((other) => other.name === item.name && projectRootKey(other.root) !== key)];
	if (group.length === 1) {
		return item.name;
	}
	const distinct = (label: (entry: T) => string) => new Set(group.map(label)).size === group.length;
	const byParent = (entry: T) => {
		const parentRoot = entry.parent;
		const parent = parentRoot === undefined ? undefined : projects.find((other) => sameProjectRoot(other.root, parentRoot));
		return parent ? `${entry.name} (${parent.name})` : entry.name;
	};
	if (distinct(byParent)) {
		return byParent(item);
	}
	const byPath = (entry: T) =>
		`${entry.name} (${path.relative(path.dirname(entry.folder), entry.root).split(path.sep).join('/')})`;
	if (distinct(byPath)) {
		return byPath(item);
	}
	return `${item.name} (${item.root})`;
}

/** Не проекты с именами для показа. */
function withDisplayNames(candidates: readonly ProjectCandidate[], projects: readonly WorkspaceProject[]): ProjectCandidate[] {
	return candidates.map((candidate) => ({ ...candidate, displayName: distinctName(candidate, candidates, projects) }));
}

/** Каталоги без каталогов, лежащих внутри других из списка. */
function outermost(dirs: readonly string[]): string[] {
	const unique = [...new Map(dirs.map((dir) => [projectRootKey(dir), dir])).values()];
	return unique.filter((dir) => !unique.some((other) => !sameProjectRoot(other, dir) && sameOrUnder(dir, other)));
}

/**
 * Каталоги для поиска файлов проектов: корень каждого проекта без его подпроектов
 * и вложенных папок рабочей области. Не проекты не сканируются. Без проектов -
 * запасной корень, если он есть.
 *
 * @param snapshot - Проекты окна
 * @param folders - Папки рабочей области
 * @param fallbackRoot - Корень без проектов: единственная папка рабочей области
 */
export function scanRootsOf(
	snapshot: WorkspaceProjectsSnapshot,
	folders: readonly WorkspaceFolderRef[],
	fallbackRoot?: string
): ProjectScanRoot[] {
	if (snapshot.projects.length === 0) {
		return fallbackRoot === undefined ? [] : [{ root: fallbackRoot, excludeDirs: outermost(nestedWorkspaceFolders(folders, fallbackRoot)) }];
	}
	return snapshot.projects.map((project) => {
		const inner = snapshot.projects
			.filter((other) => !sameProjectRoot(other.root, project.root) && sameOrUnder(other.root, project.root))
			.map((other) => other.root);
		return { root: project.root, excludeDirs: outermost([...inner, ...nestedWorkspaceFolders(folders, project.root)]) };
	});
}

/**
 * Имя пакета нового проекта: имя каталога без пробелов.
 *
 * @param dir - Каталог проекта
 */
export function packageNameOf(dir: string): string {
	return path.basename(path.resolve(dir)).trim().replace(/\s+/g, '-');
}

/**
 * Пишет `packagedef` из шаблона; `{{name}}` в шаблоне заменяется именем каталога.
 *
 * @param dir - Каталог проекта; создаётся, если его нет
 * @param templateFile - Шаблон
 * @param overwrite - Перезаписать существующий файл
 * @returns путь к файлу
 * @throws {ProjectFileExistsError} файл есть, перезапись не запрошена
 */
export async function writeProjectFile(dir: string, templateFile: string, overwrite = false): Promise<string> {
	const file = path.join(path.resolve(dir), PROJECT_FILE);
	const content = (await fs.readFile(templateFile, 'utf-8')).replaceAll(TEMPLATE_NAME, packageNameOf(dir));
	await fs.mkdir(path.dirname(file), { recursive: true });
	try {
		await fs.writeFile(file, content, { encoding: 'utf-8', flag: overwrite ? 'w' : 'wx' });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			throw new ProjectFileExistsError(file);
		}
		throw error;
	}
	return file;
}

function snapshotSignature(snapshot: WorkspaceProjectsSnapshot): string {
	return JSON.stringify([
		snapshot.projects.map((project) => [
			project.root,
			project.name,
			project.folder,
			project.parent,
			project.subProject,
			project.configuration?.dir,
			project.configuration?.format,
			project.configuration?.name,
			project.kind,
			project.package,
		]),
		snapshot.candidates.map((candidate) => [candidate.root, candidate.kind, candidate.parent, candidate.configuration.dir]),
	]);
}

const projectStorage = new AsyncLocalStorage<string>();

/**
 * Выполняет fn с корнем вызова: {@link currentRoot} внутри fn и во всём, что fn
 * запускает асинхронно, отдаёт root. Без корня fn выполняется как есть.
 */
export function runWithProject<T>(root: string | undefined, fn: () => T): T {
	return root === undefined ? fn() : projectStorage.run(normalizeProjectRoot(root), fn);
}

/** Корень вызова из {@link runWithProject}. */
export function projectOverride(): string | undefined {
	return projectStorage.getStore();
}

/**
 * Выполняет fn без корня вызова: всё, что fn запускает асинхронно (таймеры,
 * обещания, события), видит выбранный проект, а не проект вызывающего, и
 * профиль с окружением, выбранные в редакторе.
 */
export function outsideProject<T>(fn: () => T): T {
	return projectStorage.exit(() => outsideLaunchSelection(fn));
}

/** Источники состояния для {@link WorkspaceProjects}. */
export interface WorkspaceProjectsOptions {
	folders: () => readonly WorkspaceFolderRef[];
	memento?: vscode.Memento;
	defaultSetting?: () => string | undefined;
	setContext?: (key: string, value: boolean | string) => void;
	/** Шаблон `packagedef` для {@link WorkspaceProjects.createProjectFile}. */
	templateFile?: string;
	/** Шаблон `packagedef` проекта OneScript. */
	oneScriptTemplateFile?: string;
	/** Сообщает потребителям раскладки об изменении; без него проекты ищутся заново сами. */
	notifyLayout?: (change: ProjectLayoutChange) => void;
}

/** Что подключается при активации. */
export type WorkspaceProjectsBindings = Pick<
	WorkspaceProjectsOptions,
	'memento' | 'setContext' | 'templateFile' | 'oneScriptTemplateFile' | 'notifyLayout'
>;

/** Сколько после {@link WorkspaceProjects.createProjectFile} событие о созданном файле не в счёт. */
const OWN_PROJECT_FILE_EVENT_MS = 5000;

/**
 * Проекты окна и текущий проект. Расширение держит один экземпляр, функции модуля
 * работают с ним; отдельный экземпляр нужен тестам.
 */
export class WorkspaceProjects implements vscode.Disposable {
	private readonly projectsChanged = new vscode.EventEmitter<void>();
	private readonly currentChanged = new vscode.EventEmitter<CurrentProjectChange>();
	readonly onDidChangeProjects = this.projectsChanged.event;
	readonly onDidChangeCurrentProject = this.currentChanged.event;

	private bindings: WorkspaceProjectsBindings;
	private snapshot: WorkspaceProjectsSnapshot | undefined;
	private generation = 0;
	private detectedGeneration = -1;
	private detection: { generation: number; promise: Promise<WorkspaceProjectsSnapshot> } | undefined;
	private detected = false;
	private selection: string | undefined;
	private current: string | undefined;
	private timer: NodeJS.Timeout | undefined;
	/**
	 * Ключи корней, в которых `packagedef` создаёт сам экземпляр: сколько вызовов создания идёт
	 * и до какого времени после них событие о файле не в счёт.
	 */
	private readonly ownProjectFiles = new Map<string, { pending: number; until: number }>();

	constructor(private readonly options: WorkspaceProjectsOptions) {
		this.bindings = { ...options };
		this.current = this.resolve();
	}

	/** Подключает хранилище выбора, ключи контекста, шаблон и уведомление раскладки. */
	attach(bindings: WorkspaceProjectsBindings): void {
		this.bindings = { ...this.bindings, ...bindings };
		this.publishContext();
		this.updateCurrent();
	}

	/** Известное сейчас, без ожидания обхода. */
	snapshotNow(): WorkspaceProjectsSnapshot {
		this.snapshot ??= { projects: rootProjectsOf(this.options.folders()), candidates: [], complete: false };
		return this.snapshot;
	}

	async listProjects(): Promise<WorkspaceProject[]> {
		return (await this.detect()).projects;
	}

	async listCandidates(): Promise<ProjectCandidate[]> {
		return (await this.detect()).candidates;
	}

	hasProjects(): boolean {
		return this.snapshotNow().projects.length > 0;
	}

	currentRoot(): string | undefined {
		const override = projectOverride();
		return override === undefined ? this.current : this.canonical(override);
	}

	currentProject(): WorkspaceProject | undefined {
		const root = this.currentRoot();
		return root === undefined ? undefined : this.projectByRoot(root);
	}

	projectByRoot(root: string): WorkspaceProject | undefined {
		const key = projectRootKey(root);
		return this.snapshotNow().projects.find((project) => projectRootKey(project.root) === key);
	}

	/** Самая глубокая папка рабочей области, внутри которой лежит путь. */
	folderOf(target: string): WorkspaceFolderRef | undefined {
		return deepestProject(this.options.folders(), target);
	}

	projectOf(target: vscode.Uri | string): string | undefined {
		const file = typeof target === 'string' ? target : target.scheme === 'file' ? target.fsPath : undefined;
		return file === undefined ? undefined : deepestProject(this.snapshotNow().projects, file)?.root;
	}

	scanRoots(): ProjectScanRoot[] {
		return scanRootsOf(this.snapshotNow(), this.options.folders(), this.current);
	}

	async selectProject(root: string): Promise<boolean> {
		const project =
			this.projectByRoot(root) ?? (await this.listProjects()).find((item) => sameProjectRoot(item.root, root));
		if (!project) {
			return false;
		}
		this.selection = project.root;
		await this.bindings.memento?.update(CURRENT_PROJECT_KEY, project.root);
		this.updateCurrent();
		return true;
	}

	/**
	 * Создаёт `packagedef`, находит проекты заново и делает новый проект текущим.
	 *
	 * @returns корень проекта
	 * @throws {ProjectFileExistsError} файл есть, перезапись не запрошена
	 */
	async createProjectFile(dir: string, options: CreateProjectFileOptions = {}): Promise<string> {
		const templateFile =
			options.templateFile ?? (options.oneScript ? this.bindings.oneScriptTemplateFile : this.bindings.templateFile);
		if (templateFile === undefined) {
			throw new Error(`Не задан шаблон ${PROJECT_FILE}`);
		}
		const root = normalizeProjectRoot(dir);
		const key = projectRootKey(root);
		const own = this.ownProjectFiles.get(key) ?? { pending: 0, until: 0 };
		own.pending += 1;
		this.ownProjectFiles.set(key, own);
		try {
			await writeProjectFile(root, templateFile, options.overwrite);
		} catch (error) {
			own.pending -= 1;
			this.forgetOwnProjectFile(key, own);
			throw error;
		}
		try {
			forgetSubProjectDecision(root);
			invalidateProjectLayoutsContaining(root);
			await this.refresh();
			const project = this.projectByRoot(root);
			if (project && options.select !== false) {
				await this.selectProject(project.root);
			}
			return project?.root ?? root;
		} finally {
			own.pending -= 1;
			own.until = Date.now() + OWN_PROJECT_FILE_EVENT_MS;
		}
	}

	/** Обнаруживает заново. */
	refresh(): Promise<WorkspaceProjectsSnapshot> {
		this.cancelScheduled();
		this.generation += 1;
		return this.detect();
	}

	/** Обнаруживает заново после паузы; вызовы в паузе сливаются. */
	scheduleRefresh(): void {
		this.generation += 1;
		this.cancelScheduled();
		this.timer = outsideProject(() =>
			setTimeout(() => {
				this.timer = undefined;
				void this.detect();
			}, REFRESH_DELAY_MS)
		);
	}

	cancelScheduled(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	/**
	 * Состав папок изменился: проекты удалённых папок пропадают, корневые проекты
	 * новых папок появляются сразу, остальное после обхода.
	 */
	foldersChanged(): Promise<WorkspaceProjectsSnapshot> {
		this.cancelScheduled();
		this.generation += 1;
		this.apply(this.partialSnapshot());
		return this.detect();
	}

	/**
	 * Появился или удалён `packagedef`.
	 *
	 * @returns true, если проекты будут искаться заново
	 */
	projectFileChanged(file: string, created: boolean): boolean {
		const dir = normalizeProjectRoot(path.dirname(file));
		if (!created) {
			const key = projectRootKey(dir);
			const own = this.ownProjectFiles.get(key);
			if (own) {
				own.until = 0;
				this.forgetOwnProjectFile(key, own);
			}
		} else if (this.isOwnProjectFile(dir)) {
			return false;
		}
		if (!this.reachable(dir)) {
			return false;
		}
		if (created && this.snapshotNow().complete && this.projectByRoot(dir)) {
			return false;
		}
		log.info(`${PROJECT_FILE} ${created ? 'появился' : 'удалён'}: ${dir}`);
		forgetSubProjectDecision(dir);
		invalidateProjectLayoutsContaining(dir);
		this.requestRefresh();
		return true;
	}

	/**
	 * `packagedef` известного проекта изменён: от его текста зависит вид проекта.
	 *
	 * @returns true, если проекты будут искаться заново
	 */
	projectFileEdited(file: string): boolean {
		if (!this.projectByRoot(path.dirname(file))) {
			return false;
		}
		this.scheduleRefresh();
		return true;
	}

	/**
	 * Пути удалены или переименованы.
	 *
	 * @param removed - Удалённые пути и старые пути переименованных
	 * @param added - Новые пути переименованных, по порядку старых
	 * @returns true, если затронуты известные проекты или не проекты либо переименование
	 *   открыло обходу каталог, и проекты будут искаться заново
	 */
	pathsRemoved(removed: readonly string[], added: readonly string[] = []): boolean {
		const touched =
			removed.some((target) => this.touchesKnown(target)) ||
			added.some((target, index) => this.renameReveals(removed.at(index), target));
		if (!touched) {
			return false;
		}
		for (const target of removed) {
			invalidateProjectLayoutsAffectedBy(target);
		}
		for (const target of added) {
			invalidateProjectLayoutsContaining(target);
		}
		this.requestRefresh();
		return true;
	}

	/** Пересчитывает текущий проект и сообщает о смене. */
	updateCurrent(): void {
		const change = this.recomputeCurrent();
		if (change) {
			this.publishKindContext();
			outsideProject(() => this.currentChanged.fire(change));
		}
	}

	dispose(): void {
		this.cancelScheduled();
		this.projectsChanged.dispose();
		this.currentChanged.dispose();
	}

	private requestRefresh(): void {
		const notify = this.bindings.notifyLayout;
		outsideProject(() => (notify ? notify({ projects: true }) : this.scheduleRefresh()));
	}

	private touchesKnown(target: string): boolean {
		const snapshot = this.snapshotNow();
		const roots = [
			...snapshot.projects.flatMap((project) => [project.root, ...(project.configuration ? [project.configuration.dir] : [])]),
			...snapshot.candidates.flatMap((candidate) => [candidate.root, candidate.configuration.dir]),
		];
		return roots.some((root) => sameOrUnder(root, target));
	}

	private partialSnapshot(): WorkspaceProjectsSnapshot {
		const previous = this.snapshotNow();
		const projects: WorkspaceProject[] = [];
		const candidates: ProjectCandidate[] = [];
		const seen = new Set<string>();
		for (const folder of this.options.folders()) {
			const key = projectRootKey(folder.root);
			const inFolder = (item: { folder: string }) => projectRootKey(item.folder) === key;
			const root = normalizeProjectRoot(folder.root);
			const known = previous.projects.filter(inFolder);
			if (hasProjectFile(root) && !known.some((project) => projectRootKey(project.root) === key)) {
				known.unshift({ root, name: folder.name, folder: root, subProject: false });
			}
			for (const project of known) {
				const projectKey = projectRootKey(project.root);
				if (!seen.has(projectKey)) {
					seen.add(projectKey);
					projects.push(project);
				}
			}
			candidates.push(...previous.candidates.filter(inFolder));
		}
		return { projects, candidates: withDisplayNames(uniqueCandidates(candidates), projects), complete: false };
	}

	private persisted(): string | undefined {
		return this.bindings.memento ? this.bindings.memento.get<string>(CURRENT_PROJECT_KEY) : this.selection;
	}

	/** Корень в написании известного проекта или папки. */
	private canonical(root: string): string {
		const folder = this.options.folders().find((item) => sameProjectRoot(item.root, root));
		return this.projectByRoot(root)?.root ?? (folder ? normalizeProjectRoot(folder.root) : normalizeProjectRoot(root));
	}

	private isProject(root: string): boolean {
		const snapshot = this.snapshotNow();
		if (snapshot.projects.some((project) => sameProjectRoot(project.root, root))) {
			return true;
		}
		return !snapshot.complete && hasProjectFile(root) && this.reachable(root);
	}

	/**
	 * Доходит ли обнаружение до каталога: он в папке рабочей области, не исключён из
	 * обхода, и ни один каталог от корня папки до его родителя обход не останавливает.
	 */
	private reachable(target: string): boolean {
		const folder = this.folderOf(target);
		if (!folder || isExcludedFromLayout(folder.root, target)) {
			return false;
		}
		if (sameProjectRoot(target, folder.root)) {
			return true;
		}
		for (let dir = path.dirname(path.resolve(target)); sameOrUnder(dir, folder.root); dir = path.dirname(dir)) {
			if (stopsLayoutWalk(dir)) {
				return false;
			}
			if (sameProjectRoot(dir, folder.root)) {
				break;
			}
		}
		return true;
	}

	/** Переименование принесло `packagedef` или открыло обнаружению каталог, до которого оно не доходило. */
	private renameReveals(previous: string | undefined, target: string): boolean {
		if (hasProjectFile(target)) {
			return true;
		}
		if ((previous !== undefined && this.reachable(previous)) || !this.reachable(target)) {
			return false;
		}
		try {
			return statSync(target).isDirectory();
		} catch {
			return false;
		}
	}

	/** `packagedef` в каталоге создаёт или только что создал {@link WorkspaceProjects.createProjectFile}. */
	private isOwnProjectFile(dir: string): boolean {
		for (const [key, own] of this.ownProjectFiles) {
			this.forgetOwnProjectFile(key, own);
		}
		return this.ownProjectFiles.has(projectRootKey(dir));
	}

	/** Убирает запись о своём `packagedef`, когда создание не идёт и срок событий вышел. */
	private forgetOwnProjectFile(key: string, own: { pending: number; until: number }): void {
		if (own.pending === 0 && own.until < Date.now() && this.ownProjectFiles.get(key) === own) {
			this.ownProjectFiles.delete(key);
		}
	}

	private resolve(): string | undefined {
		const root = resolveCurrentRoot({
			persisted: this.persisted(),
			defaultSetting: this.options.defaultSetting?.(),
			folders: this.options.folders(),
			projects: this.snapshotNow().projects,
			isProject: (candidate) => this.isProject(candidate),
		});
		return root === undefined ? undefined : this.canonical(root);
	}

	private recomputeCurrent(): CurrentProjectChange | undefined {
		const previous = this.current;
		const current = this.resolve();
		this.current = current;
		const same = previous === undefined || current === undefined ? previous === current : sameProjectRoot(previous, current);
		return same ? undefined : { previous, current };
	}

	private publishContext(): void {
		const setContext = this.bindings.setContext;
		if (!setContext) {
			return;
		}
		const snapshot = this.snapshotNow();
		setContext(IS_1C_PROJECT_CONTEXT, snapshot.projects.length > 0);
		setContext(MULTIPLE_PROJECTS_CONTEXT, snapshot.projects.length > 1);
		setContext(HAS_CANDIDATES_CONTEXT, snapshot.candidates.length > 0);
		setContext(DETECTING_CONTEXT, !this.detected);
		this.publishKindContext();
	}

	/** Вид текущего проекта для условий видимости в манифесте. */
	private publishKindContext(): void {
		const root = this.current;
		this.bindings.setContext?.(PROJECT_KIND_CONTEXT, (root === undefined ? undefined : this.projectByRoot(root)?.kind) ?? '');
	}

	private detect(): Promise<WorkspaceProjectsSnapshot> {
		const generation = this.generation;
		if (this.snapshot?.complete && this.detectedGeneration === generation) {
			return Promise.resolve(this.snapshot);
		}
		if (this.detection?.generation === generation) {
			return this.detection.promise;
		}
		const folders = this.options.folders();
		const promise = outsideProject(() =>
			detectWorkspaceProjects(folders)
				.catch((): WorkspaceProjectsSnapshot => ({ projects: rootProjectsOf(folders), candidates: [], complete: true }))
				.then((next): WorkspaceProjectsSnapshot | Promise<WorkspaceProjectsSnapshot> => {
					if (generation !== this.generation) {
						return this.detect();
					}
					this.detectedGeneration = generation;
					this.apply(next);
					return next;
				})
		);
		this.detection = { generation, promise };
		return promise;
	}

	/** Состав проектов сменился: от него зависит, видны ли панели проекта. */
	private logProjects(previous: WorkspaceProjectsSnapshot | undefined, next: WorkspaceProjectsSnapshot): void {
		const roots = next.projects.map((project) => project.root).join(', ');
		const was = previous ? `, было ${previous.projects.length}` : '';
		log.info(`проектов в окне: ${next.projects.length}${was}${roots ? `: ${roots}` : ''}`);
		if (next.projects.length > 0) {
			return;
		}
		const folders = this.options
			.folders()
			.map((folder) => `${folder.root} ${hasProjectFile(folder.root) ? `с ${PROJECT_FILE}` : `без ${PROJECT_FILE}`}`);
		log.warn(`проектов нет, панели проекта скрыты; папки окна: ${folders.join(', ') || 'нет'}`);
	}

	private apply(next: WorkspaceProjectsSnapshot): void {
		const previous = this.snapshot;
		this.snapshot = next;
		const firstComplete = next.complete && !this.detected;
		if (next.complete) {
			this.detected = true;
		}
		const change = this.recomputeCurrent();
		const listChanged = !previous || snapshotSignature(previous) !== snapshotSignature(next);
		if (listChanged || firstComplete) {
			this.publishContext();
		} else if (change) {
			this.publishKindContext();
		}
		if (next.complete && (listChanged || firstComplete)) {
			this.logProjects(firstComplete ? undefined : previous, next);
		}
		outsideProject(() => {
			if (listChanged) {
				this.projectsChanged.fire();
			}
			if (change) {
				this.currentChanged.fire(change);
			}
		});
	}
}

function workspaceFolderRefs(): WorkspaceFolderRef[] {
	return (vscode.workspace.workspaceFolders ?? [])
		.filter((folder) => folder.uri.scheme === 'file')
		.map((folder) => ({ name: folder.name, root: folder.uri.fsPath }));
}

let service: WorkspaceProjects | undefined;
let workspaceState: vscode.Memento | undefined;

function projects(): WorkspaceProjects {
	service ??= new WorkspaceProjects({
		folders: workspaceFolderRefs,
		defaultSetting: () => vscode.workspace.getConfiguration('1c-platform-tools').get<string>('project.default'),
	});
	return service;
}

/**
 * Корень текущего проекта: корень вызова из {@link runWithProject}, сохранённый
 * выбор, настройка `project.default`, первый проект в корне папки рабочей области,
 * первый проект не внутри другого проекта, единственная папка рабочей области;
 * иначе undefined.
 *
 * Корень не обязательно проект из списка: это бывает единственная папка без
 * `packagedef` или любой каталог, переданный в `runWithProject`.
 */
export function currentRoot(): string | undefined {
	return projects().currentRoot();
}

/** Текущий проект из списка; undefined, когда {@link currentRoot} не проект. */
export function currentProject(): WorkspaceProject | undefined {
	return projects().currentProject();
}

/** Известный проект с этим корнем. */
export function projectByRoot(root: string): WorkspaceProject | undefined {
	return projects().projectByRoot(root);
}

/**
 * Проект OneScript: платформа 1С ему не нужна, метаданных и артефактов 1С у него нет.
 *
 * @param root - Корень проекта; по умолчанию текущий
 * @returns false и тогда, когда вид проекта ещё не известен
 */
export function isOneScriptProject(root: string | undefined = currentRoot()): boolean {
	return root !== undefined && projectByRoot(root)?.kind === 'onescript';
}

/**
 * Самый глубокий проект, внутри которого лежит файл или каталог.
 *
 * До конца первого обнаружения известны только корневые проекты.
 * @returns корень проекта; undefined, если путь вне проектов или не файловый
 */
export function projectOf(target: vscode.Uri | string): string | undefined {
	return projects().projectOf(target);
}

/**
 * Самая глубокая папка рабочей области, внутри которой лежит каталог.
 *
 * @param root - Корень проекта или любой каталог
 * @param folders - Папки рабочей области
 */
export function workspaceFolderOf(
	root: string,
	folders: readonly vscode.WorkspaceFolder[] = vscode.workspace.workspaceFolders ?? []
): vscode.WorkspaceFolder | undefined {
	const refs = folders.filter((folder) => folder.uri.scheme === 'file').map((folder) => ({ root: folder.uri.fsPath, folder }));
	return deepestProject(refs, root)?.folder;
}

/** Каталоги для поиска файлов проектов, см. {@link scanRootsOf}. */
export function projectScanRoots(): ProjectScanRoot[] {
	return projects().scanRoots();
}

/** Проекты и подпроекты после полного обнаружения. */
export function listProjects(): Promise<WorkspaceProject[]> {
	return projects().listProjects();
}

/** Не проекты после полного обнаружения. */
export function listCandidates(): Promise<ProjectCandidate[]> {
	return projects().listCandidates();
}

/** Известное сейчас без ожидания; `complete` говорит, закончен ли обход. */
export function projectsSnapshot(): WorkspaceProjectsSnapshot {
	return projects().snapshotNow();
}

/** В окне есть хотя бы один проект. */
export function hasProjects(): boolean {
	return projects().hasProjects();
}

/**
 * Делает проект текущим и сохраняет выбор.
 *
 * @returns false, если такого проекта в окне нет; выбор тогда не меняется
 */
export function selectProject(root: string): Promise<boolean> {
	return projects().selectProject(root);
}

/**
 * Создаёт `packagedef` из шаблона расширения, находит проекты заново и делает
 * новый проект текущим.
 *
 * @param dir - Каталог проекта
 * @returns корень проекта
 * @throws {ProjectFileExistsError} файл есть, перезапись не запрошена
 */
export function createProjectFile(dir: string, options?: CreateProjectFileOptions): Promise<string> {
	return projects().createProjectFile(dir, options);
}

/** Обнаруживает проекты заново, например после своих операций с каталогами. */
export async function refreshProjects(): Promise<void> {
	await projects().refresh();
}

/** Список проектов или не проектов изменился. */
export const onDidChangeProjects: vscode.Event<void> = (listener, thisArgs, disposables) =>
	projects().onDidChangeProjects(listener, thisArgs, disposables);

/** Текущий проект сменился; смена на тот же корень события не даёт. */
export const onDidChangeCurrentProject: vscode.Event<CurrentProjectChange> = (listener, thisArgs, disposables) =>
	projects().onDidChangeCurrentProject(listener, thisArgs, disposables);

/** workspaceState окна; undefined до {@link initWorkspaceProjects}. */
export function workspaceMemento(): vscode.Memento | undefined {
	return workspaceState;
}

function fileUris(uris: readonly vscode.Uri[]): string[] {
	return uris.filter((uri) => uri.scheme === 'file').map((uri) => uri.fsPath);
}

/**
 * Подключает хранилище выбора, ключи контекста, границы обхода и наблюдателей.
 * Вызывается при активации раньше всего, что читает корень.
 */
export function initWorkspaceProjects(context: vscode.ExtensionContext): vscode.Disposable {
	const instance = projects();
	workspaceState = context.workspaceState;
	setLayoutBoundaries((root) => nestedWorkspaceFolders(workspaceFolderRefs(), root));
	instance.attach({
		memento: context.workspaceState,
		setContext: (key, value) => void vscode.commands.executeCommand('setContext', key, value),
		templateFile: path.join(context.extensionPath, PROJECT_FILE_TEMPLATE),
		oneScriptTemplateFile: path.join(context.extensionPath, ONESCRIPT_PROJECT_FILE_TEMPLATE),
		notifyLayout: notifyProjectLayoutChanged,
	});

	const watcher = vscode.workspace.createFileSystemWatcher(`**/${PROJECT_FILE}`);
	void instance.refresh();

	return vscode.Disposable.from(
		watcher,
		watcher.onDidCreate((uri) => instance.projectFileChanged(uri.fsPath, true)),
		watcher.onDidChange((uri) => instance.projectFileEdited(uri.fsPath)),
		watcher.onDidDelete((uri) => instance.projectFileChanged(uri.fsPath, false)),
		vscode.workspace.onDidDeleteFiles((event) => instance.pathsRemoved(fileUris(event.files))),
		vscode.workspace.onDidRenameFiles((event) => {
			const files = event.files.filter((file) => file.oldUri.scheme === 'file' && file.newUri.scheme === 'file');
			instance.pathsRemoved(
				files.map((file) => file.oldUri.fsPath),
				files.map((file) => file.newUri.fsPath)
			);
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => void instance.foldersChanged()),
		onDidChangeProjectLayout((change) => {
			if (change.projects) {
				void instance.refresh();
			}
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(DEFAULT_PROJECT_SETTING)) {
				instance.updateCurrent();
			}
		}),
		new vscode.Disposable(() => instance.cancelScheduled())
	);
}
