import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DEFAULT_TESTING } from '../../shared/pathDefaults';
import {
	invalidateProjectLayout,
	invalidateProjectLayoutsAffectedBy,
	invalidateProjectLayoutsForFile,
	invalidateProjectLayoutsForRemoval,
	resolveProjectLayout,
	setLayoutBoundaries,
	setLayoutExclusions,
	setTestsDirectory,
	type SourceRoot,
} from '../../shared/projectLayout';
import { changesConfigurations, type ProjectLayoutChange } from '../../shared/projectLayoutWatch';
import {
	CURRENT_PROJECT_KEY,
	DETECTING_CONTEXT,
	HAS_CANDIDATES_CONTEXT,
	IS_1C_PROJECT_CONTEXT,
	MULTIPLE_PROJECTS_CONTEXT,
	PROJECT_KIND_CONTEXT,
	ProjectFileExistsError,
	WorkspaceProjects,
	deepestProject,
	defaultProjectPaths,
	detectWorkspaceProjects,
	nestedWorkspaceFolders,
	normalizeProjectRoot,
	packagedefTargetDir,
	projectDisplayName,
	projectOverride,
	resolveCurrentRoot,
	runWithProject,
	sameProjectRoot,
	scanRootsOf,
	workspaceFolderOf,
	type CurrentProjectChange,
	type WorkspaceFolderRef,
	type WorkspaceProject,
} from '../../shared/workspaceProjects';

const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/workspaceProjects');
const TEMPLATE = path.resolve(__dirname, '../../../resources/templates/packagedef.template');
const at = (...parts: string[]) => normalizeProjectRoot(path.join(FIXTURES, ...parts));

const PROJECT = at('проект');
const SUB_PROJECT = at('проект', 'src', 'cfe', 'подпроект');
const PACKAGE = at('проект', 'oscript_modules', 'пакет');
const NOT_PROJECT = at('без-packagedef');
const EMPTY = at('пустая');
const TWO_CONFIGURATIONS = at('две-конфигурации');
const DELIVERY = at('две-конфигурации', 'поставка');
const MONOREPO = at('монорепозиторий');
const APPLICATION = at('монорепозиторий', 'приложение');
const MODULE = at('монорепозиторий', 'приложение', 'src', 'cfe', 'модуль');
const LIBRARY = at('монорепозиторий', 'библиотека');
const MONOREPO_WITH_CONFIGURATION = at('монорепозиторий-с-конфигурацией');
const SERVICE = at('монорепозиторий-с-конфигурацией', 'сервис');
const NESTED_PARENT = at('вложенная-папка');
const NESTED_FOLDER = at('вложенная-папка', 'app');
const RETAIL = at('розница');
const RETAIL_EXTENSIONS = at('розница', 'src', 'cfe');
const ADAPTER = at('розница', 'src', 'cfe', 'адаптер');
const PACKAGE_MANAGER = at('розница', 'src', 'cfe', 'менеджер-пакетов');
const METRICS = at('розница', 'src', 'cfe', 'метрики');
const EXPORT = at('розница', 'src', 'cfe', 'метрики', 'src', 'cfe', 'экспорт');
const TOOLS = at('инструменты');
const PRINT = at('инструменты', 'src', 'epf', 'печать');
const DEPLOY = at('инструменты', 'tools', 'deploy');

const folder = (root: string): WorkspaceFolderRef => ({ name: path.basename(root), root });
const FOLDERS = [folder(PROJECT), folder(NOT_PROJECT), folder(EMPTY), folder(TWO_CONFIGURATIONS)];

/** На Windows то же написание другим регистром; на остальных системах путь как есть. */
const otherCase = (root: string) => (process.platform === 'win32' ? root.toUpperCase() : root);

/** workspaceState в памяти. */
function memoryMemento(): vscode.Memento {
	const values = new Map<string, unknown>();
	return {
		keys: () => [...values.keys()],
		get: (key: string, defaultValue?: unknown) => (values.has(key) ? values.get(key) : defaultValue),
		update: async (key: string, value: unknown) => {
			values.set(key, value);
		},
	} as vscode.Memento;
}

/** Копия каталога фикстуры во временном каталоге: тесты удаления и создания меняют файлы. */
function copyFixture(name: string): { root: string; dispose: () => void } {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-projects-'));
	const root = normalizeProjectRoot(path.join(base, name));
	fs.cpSync(path.join(FIXTURES, name), root, { recursive: true });
	return { root, dispose: () => fs.rmSync(base, { recursive: true, force: true }) };
}

/** Ждёт первого события. */
function nextEvent<T>(event: vscode.Event<T>, read: (value: T) => unknown): Promise<unknown> {
	return new Promise((resolve) => {
		const subscription = event((value) => {
			subscription.dispose();
			resolve(read(value));
		});
	});
}

suite('проекты рабочей области: обнаружение', () => {
	setup(() => {
		setLayoutExclusions(() => []);
		setLayoutBoundaries(() => []);
		invalidateProjectLayout();
	});

	teardown(() => {
		setLayoutBoundaries(() => []);
	});

	test('проекты: папки с packagedef по порядку, подпроект вслед за родителем', async () => {
		const { projects, complete } = await detectWorkspaceProjects(FOLDERS);

		assert.strictEqual(complete, true);
		assert.deepStrictEqual(
			projects.map((project) => [project.root, project.name, project.folder, project.parent, project.subProject, project.configuration?.name]),
			[
				[PROJECT, 'проект', PROJECT, undefined, false, 'Основная'],
				[SUB_PROJECT, 'подпроект', PROJECT, PROJECT, true, 'Подпроект'],
				[TWO_CONFIGURATIONS, 'две-конфигурации', TWO_CONFIGURATIONS, undefined, false, 'Первая'],
			]
		);
	});

	test('конфигурация подпроекта проекту не принадлежит, расширения подпроекта принадлежат', async () => {
		const parent = await resolveProjectLayout(PROJECT);
		const child = await resolveProjectLayout(SUB_PROJECT);

		assert.deepStrictEqual(parent.subProjects.map(normalizeProjectRoot), [SUB_PROJECT]);
		assert.strictEqual(parent.configuration?.name, 'Основная');
		assert.deepStrictEqual(parent.extensions.map((root) => root.name), ['РасширениеПодпроекта']);
		assert.deepStrictEqual(parent.others, []);
		assert.strictEqual(child.configuration?.name, 'Подпроект');
		assert.deepStrictEqual(child.extensions.map((root) => root.name), ['РасширениеПодпроекта']);
		assert.deepStrictEqual(child.subProjects, []);
	});

	test('не проекты: папка с исходным кодом без packagedef и вторые конфигурации проекта', async () => {
		const { candidates } = await detectWorkspaceProjects(FOLDERS);

		assert.deepStrictEqual(
			candidates.map((candidate) => [candidate.kind, candidate.root, candidate.parent, candidate.configuration.name]),
			[
				['folder', NOT_PROJECT, undefined, 'БезПроекта'],
				['extraConfiguration', DELIVERY, TWO_CONFIGURATIONS, 'Вторая'],
				['extraConfiguration', at('две-конфигурации', 'учёт'), TWO_CONFIGURATIONS, 'Учёт'],
			]
		);
	});

	test('папка без исходного кода не проект и не кандидат', async () => {
		const found = await detectWorkspaceProjects([folder(EMPTY)]);

		assert.deepStrictEqual(found.projects, []);
		assert.deepStrictEqual(found.candidates, []);
	});

	test('вид проекта: пакет OneScript, проект и подпроект в формате конфигуратора', async () => {
		const scripts = at('инструменты', 'tools', 'deploy');
		const { projects } = await detectWorkspaceProjects([folder(scripts), folder(PROJECT)]);

		assert.deepStrictEqual(
			projects.map((project) => [project.root, project.kind]),
			[
				[scripts, 'onescript'],
				[PROJECT, 'designer'],
				[SUB_PROJECT, 'designer'],
			]
		);
	});

	test('подпроект, открытый отдельной папкой, стоит корневым проектом один раз', async () => {
		const { projects } = await detectWorkspaceProjects([folder(PROJECT), folder(SUB_PROJECT)]);

		assert.deepStrictEqual(
			projects.map((project) => [project.root, project.subProject]),
			[[PROJECT, false], [SUB_PROJECT, false]]
		);
	});

	test('папка без packagedef с проектами внутри: проекты верхнего уровня, пакеты не проекты', async () => {
		const { projects, candidates } = await detectWorkspaceProjects([folder(MONOREPO)]);

		assert.deepStrictEqual(
			projects.map((project) => [project.root, project.name, project.folder, project.parent, project.subProject, project.configuration?.name]),
			[
				[LIBRARY, 'библиотека', MONOREPO, undefined, false, 'Библиотека'],
				[APPLICATION, 'приложение', MONOREPO, undefined, false, 'Приложение'],
				[MODULE, 'модуль', MONOREPO, APPLICATION, true, 'Модуль'],
			]
		);
		assert.deepStrictEqual(candidates, []);
	});

	test('папка без packagedef со своей конфигурацией вне проектов остаётся не проектом', async () => {
		const { projects, candidates } = await detectWorkspaceProjects([folder(MONOREPO_WITH_CONFIGURATION)]);

		assert.deepStrictEqual(projects.map((project) => [project.root, project.subProject]), [[SERVICE, false]]);
		assert.deepStrictEqual(
			candidates.map((candidate) => [candidate.kind, candidate.root, candidate.configuration.name]),
			[['folder', MONOREPO_WITH_CONFIGURATION, 'Общая']]
		);
	});

	test('каталог с packagedef и своей конфигурацией подпроект, репозиторий расширения часть проекта', async () => {
		const { projects, candidates } = await detectWorkspaceProjects([folder(RETAIL)]);

		assert.deepStrictEqual(
			projects.map((project) => [project.root, project.parent, project.subProject, project.configuration?.name]),
			[
				[RETAIL, undefined, false, 'Розница'],
				[PACKAGE_MANAGER, RETAIL, true, 'БазаМенеджераПакетов'],
				[METRICS, RETAIL, true, 'БазаМетрик'],
				[EXPORT, METRICS, true, 'БазаЭкспорта'],
			]
		);
		assert.deepStrictEqual(candidates, []);
	});

	test('подпроект без выгрузки конфигурации остаётся подпроектом и текущим', async () => {
		const copy = copyFixture('розница');
		const packageManager = normalizeProjectRoot(path.join(copy.root, 'src', 'cfe', 'менеджер-пакетов'));
		const metrics = normalizeProjectRoot(path.join(copy.root, 'src', 'cfe', 'метрики'));
		const local = new WorkspaceProjects({ folders: () => [folder(copy.root)] });
		try {
			await local.refresh();
			assert.strictEqual(await local.selectProject(packageManager), true);
			const configuration = path.join(packageManager, 'src', 'cf');
			fs.rmSync(configuration, { recursive: true });

			assert.strictEqual(local.pathsRemoved([configuration]), true);
			const projects = await local.listProjects();

			assert.deepStrictEqual(
				projects.map((project) => [project.root, project.parent, project.subProject, project.configuration?.name]),
				[
					[copy.root, undefined, false, 'Розница'],
					[packageManager, copy.root, true, undefined],
					[metrics, copy.root, true, 'БазаМетрик'],
					[normalizeProjectRoot(path.join(metrics, 'src', 'cfe', 'экспорт')), metrics, true, 'БазаЭкспорта'],
				]
			);
			assert.strictEqual(local.currentRoot(), packageManager);
			const retail = await resolveProjectLayout(copy.root);
			assert.deepStrictEqual(retail.extensions.map((root) => root.name), ['Адаптер', 'Доработки', 'МенеджерПакетов', 'КлиентМетрик', 'ЭкспортМетрик']);
			assert.deepStrictEqual(retail.testExtensions, []);

			fs.cpSync(path.join(PACKAGE_MANAGER, 'src', 'cf'), configuration, { recursive: true });
			assert.strictEqual(invalidateProjectLayoutsForFile(path.join(configuration, 'Configuration.xml')), true);
			await local.refresh();
			assert.strictEqual(local.projectByRoot(packageManager)?.configuration?.name, 'БазаМенеджераПакетов');
			assert.deepStrictEqual((await resolveProjectLayout(copy.root)).others, []);
		} finally {
			local.dispose();
			copy.dispose();
		}
	});

	test('репозиторий расширения без описания остаётся частью проекта, расширение возвращается к проекту', async () => {
		const copy = copyFixture('розница');
		const description = path.join(copy.root, 'src', 'cfe', 'адаптер', 'Configuration.xml');
		const local = new WorkspaceProjects({ folders: () => [folder(copy.root)] });
		try {
			const projects = (await local.listProjects()).map((project) => project.root);
			fs.rmSync(description);

			assert.strictEqual(invalidateProjectLayoutsForFile(description), true);
			await local.refresh();
			assert.deepStrictEqual((await local.listProjects()).map((project) => project.root), projects);
			assert.deepStrictEqual(
				(await resolveProjectLayout(copy.root)).extensions.map((root) => root.name),
				['Доработки', 'МенеджерПакетов', 'КлиентМетрик', 'ЭкспортМетрик']
			);

			fs.copyFileSync(path.join(ADAPTER, 'Configuration.xml'), description);
			assert.strictEqual(invalidateProjectLayoutsForFile(description), true);
			await local.refresh();
			assert.deepStrictEqual((await local.listProjects()).map((project) => project.root), projects);
			assert.deepStrictEqual(
				(await resolveProjectLayout(copy.root)).extensions.map((root) => root.name),
				['Адаптер', 'Доработки', 'МенеджерПакетов', 'КлиентМетрик', 'ЭкспортМетрик']
			);
		} finally {
			local.dispose();
			copy.dispose();
		}
	});

	test('удаление и появление packagedef решают о каталоге заново', async () => {
		const copy = copyFixture('розница');
		const packageManager = normalizeProjectRoot(path.join(copy.root, 'src', 'cfe', 'менеджер-пакетов'));
		const metrics = normalizeProjectRoot(path.join(copy.root, 'src', 'cfe', 'метрики'));
		const exported = normalizeProjectRoot(path.join(metrics, 'src', 'cfe', 'экспорт'));
		const file = path.join(packageManager, 'packagedef');
		const local = new WorkspaceProjects({ folders: () => [folder(copy.root)] });
		try {
			await local.refresh();
			const configuration = path.join(packageManager, 'src', 'cf');
			fs.rmSync(configuration, { recursive: true });
			assert.strictEqual(local.pathsRemoved([configuration]), true);
			assert.strictEqual((await local.listProjects()).some((project) => project.root === packageManager), true);

			fs.rmSync(file);
			assert.strictEqual(local.projectFileChanged(file, false), true);
			assert.deepStrictEqual((await local.listProjects()).map((project) => project.root), [copy.root, metrics, exported]);
			assert.deepStrictEqual((await resolveProjectLayout(copy.root)).testExtensions.map((root) => root.name), ['ТестыМенеджераПакетов']);

			fs.copyFileSync(path.join(PACKAGE_MANAGER, 'packagedef'), file);
			assert.strictEqual(local.projectFileChanged(file, true), true);
			assert.deepStrictEqual((await local.listProjects()).map((project) => project.root), [copy.root, metrics, exported]);
			assert.deepStrictEqual((await resolveProjectLayout(copy.root)).testExtensions.map((root) => root.name), ['ТестыМенеджераПакетов']);
		} finally {
			local.dispose();
			copy.dispose();
		}
	});

	test('репозиторий обработки и пакет OneScript с packagedef без своей конфигурации принадлежат проекту', async () => {
		const local = new WorkspaceProjects({ folders: () => [folder(TOOLS)] });
		try {
			assert.deepStrictEqual(
				(await local.listProjects()).map((project) => [project.root, project.subProject, project.configuration?.name]),
				[[TOOLS, false, 'Инструменты']]
			);
			assert.deepStrictEqual(await local.listCandidates(), []);
			const layout = await resolveProjectLayout(TOOLS);
			assert.deepStrictEqual(layout.processors.map((root) => [root.file, normalizeProjectRoot(root.dir)]), [['Печать', PRINT]]);
			assert.deepStrictEqual(layout.subProjects, []);
			assert.strictEqual(local.projectOf(path.join(PRINT, 'Печать.xml')), TOOLS);
			assert.strictEqual(local.projectOf(path.join(DEPLOY, 'main.os')), TOOLS);
		} finally {
			local.dispose();
		}
	});

	test('расширения подпроектов входят в проект без тестовых, у подпроекта своя раскладка', async () => {
		const retail = await resolveProjectLayout(RETAIL);
		const packageManager = await resolveProjectLayout(PACKAGE_MANAGER);
		const metrics = await resolveProjectLayout(METRICS);

		assert.deepStrictEqual(retail.subProjects.map(normalizeProjectRoot), [PACKAGE_MANAGER, METRICS]);
		assert.deepStrictEqual(
			retail.extensions.map((root) => [root.name, normalizeProjectRoot(root.dir)]),
			[
				['Адаптер', ADAPTER],
				['Доработки', at('розница', 'src', 'cfe', 'доработки')],
				['МенеджерПакетов', at('розница', 'src', 'cfe', 'менеджер-пакетов', 'src', 'cfe', 'МенеджерПакетов')],
				['КлиентМетрик', at('розница', 'src', 'cfe', 'метрики', 'src', 'cfe', 'КлиентМетрик')],
				['ЭкспортМетрик', at('розница', 'src', 'cfe', 'метрики', 'src', 'cfe', 'экспорт', 'src', 'cfe', 'ЭкспортМетрик')],
			]
		);
		assert.deepStrictEqual(retail.testExtensions, []);
		assert.deepStrictEqual(retail.others, []);
		assert.strictEqual(packageManager.configuration?.name, 'БазаМенеджераПакетов');
		assert.deepStrictEqual(packageManager.extensions.map((root) => root.name), ['МенеджерПакетов']);
		assert.deepStrictEqual(packageManager.testExtensions.map((root) => root.name), ['ТестыМенеджераПакетов']);
		assert.deepStrictEqual(metrics.extensions.map((root) => root.name), ['КлиентМетрик', 'ЭкспортМетрик']);
		assert.deepStrictEqual(metrics.subProjects.map(normalizeProjectRoot), [EXPORT]);
	});

	test('каталоги поиска: репозиторий расширения у проекта, подпроекты отдельно', async () => {
		const snapshot = await detectWorkspaceProjects([folder(RETAIL)]);

		assert.deepStrictEqual(scanRootsOf(snapshot, [folder(RETAIL)]), [
			{ root: RETAIL, excludeDirs: [PACKAGE_MANAGER, METRICS] },
			{ root: PACKAGE_MANAGER, excludeDirs: [] },
			{ root: METRICS, excludeDirs: [EXPORT] },
			{ root: EXPORT, excludeDirs: [] },
		]);
	});

	test('в папке без packagedef каталог с packagedef проект и без своей конфигурации', async () => {
		const { projects } = await detectWorkspaceProjects([folder(RETAIL_EXTENSIONS)]);

		assert.deepStrictEqual(
			projects.map((project) => [project.root, project.parent, project.subProject]),
			[
				[ADAPTER, undefined, false],
				[PACKAGE_MANAGER, undefined, false],
				[METRICS, undefined, false],
				[EXPORT, METRICS, true],
			]
		);
	});

	test('вложенная папка рабочей области: не кандидат дважды', async () => {
		const folders = [folder(TWO_CONFIGURATIONS), folder(DELIVERY)];

		const { candidates } = await detectWorkspaceProjects(folders);

		assert.deepStrictEqual(
			candidates.map((candidate) => [candidate.kind, candidate.root]),
			[['folder', DELIVERY], ['extraConfiguration', at('две-конфигурации', 'учёт')]]
		);
	});

	test('вложенная папка рабочей области не конфигурация проекта и не вторая конфигурация', async () => {
		const folders = [folder(NESTED_PARENT), folder(NESTED_FOLDER)];
		setLayoutBoundaries((root) => nestedWorkspaceFolders(folders, root));

		const { projects, candidates } = await detectWorkspaceProjects(folders);

		assert.deepStrictEqual(projects.map((project) => [project.root, project.configuration?.name]), [[NESTED_PARENT, 'Своя']]);
		assert.deepStrictEqual(
			candidates.map((candidate) => [candidate.kind, candidate.root, candidate.configuration.name]),
			[['folder', NESTED_FOLDER, 'Вложенная']]
		);
	});

	test('packagedef ставится над src/cf выгрузки конфигуратора, иначе в каталог конфигурации', () => {
		const root = (dir: string, format: SourceRoot['format']): SourceRoot => ({ dir, format, name: '', isExtension: false });

		assert.strictEqual(packagedefTargetDir(root(path.join('/w', 'p', 'src', 'cf'), 'designer')), path.resolve('/w/p'));
		assert.strictEqual(packagedefTargetDir(root(path.join('/w', 'p', 'cf'), 'designer')), path.resolve('/w/p/cf'));
		assert.strictEqual(packagedefTargetDir(root(path.join('/w', 'учёт'), 'edt')), path.resolve('/w/учёт'));
	});

	test('packagedef второй конфигурации не выше и не в корне родительского проекта', () => {
		const second: SourceRoot = { dir: path.resolve('/w/x/src/cf'), format: 'designer', name: '', isExtension: false };

		assert.strictEqual(packagedefTargetDir(second, path.resolve('/w/x/src')), path.resolve('/w/x/src/cf'));
		assert.strictEqual(packagedefTargetDir(second, path.resolve('/w/x')), path.resolve('/w/x/src/cf'));
		assert.strictEqual(packagedefTargetDir(second, path.resolve('/w')), path.resolve('/w/x'));
	});

	test('путь принадлежит самому глубокому проекту', async () => {
		const { projects } = await detectWorkspaceProjects(FOLDERS);

		assert.strictEqual(deepestProject(projects, path.join(SUB_PROJECT, 'src', 'cf', 'Configuration.xml'))?.root, SUB_PROJECT);
		assert.strictEqual(deepestProject(projects, path.join(PROJECT, 'src', 'cf'))?.root, PROJECT);
		assert.strictEqual(deepestProject(projects, NOT_PROJECT), undefined);
	});

	test('удаление каталога забывает раскладки, которые его видели', async () => {
		await resolveProjectLayout(PROJECT);
		await resolveProjectLayout(SUB_PROJECT);

		assert.strictEqual(invalidateProjectLayoutsAffectedBy(path.join(PROJECT, 'src', 'cf', 'Catalogs')), false);
		assert.strictEqual(invalidateProjectLayoutsAffectedBy(path.join(PROJECT, 'oscript_modules')), false);
		assert.strictEqual(invalidateProjectLayoutsAffectedBy(path.join(PROJECT, 'src', 'cfe')), true);
		assert.strictEqual(invalidateProjectLayoutsAffectedBy(path.join(PROJECT, 'src', 'cfe')), false);
	});

	test('файл в пропускаемом каталоге раскладку не сбрасывает', async () => {
		const layout = await resolveProjectLayout(PROJECT);

		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(PACKAGE, 'src', 'cf', 'Configuration.xml')), false);
		assert.strictEqual(await resolveProjectLayout(PROJECT), layout);
		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(PROJECT, 'src', 'cf', 'Configuration.xml')), true);
		assert.notStrictEqual(await resolveProjectLayout(PROJECT), layout);
	});

	test('состав проектов ищется заново только по файлам конфигураций', () => {
		assert.strictEqual(changesConfigurations(path.join(PROJECT, 'src', 'cf', 'Configuration.xml')), true);
		assert.strictEqual(changesConfigurations(path.join(TWO_CONFIGURATIONS, 'учёт', 'src', 'Configuration', 'Configuration.mdo')), true);
		assert.strictEqual(changesConfigurations(path.join(TWO_CONFIGURATIONS, 'учёт', '.project')), true);
		assert.strictEqual(changesConfigurations(path.join(PROJECT, 'src', 'cf', 'Catalogs', 'Товары.xml')), false);
	});

	test('на Windows корень с другим регистром тот же', async () => {
		assert.strictEqual(sameProjectRoot(otherCase(PROJECT), PROJECT), true);
		assert.strictEqual(await resolveProjectLayout(otherCase(PROJECT)), await resolveProjectLayout(PROJECT));
	});
});

suite('проекты рабочей области: имена и каталоги поиска', () => {
	const r = (dir: string) => normalizeProjectRoot(dir);
	const project = (root: string, name: string, folderRoot: string, parent?: string): WorkspaceProject => ({
		root: r(root),
		name,
		folder: r(folderRoot),
		parent: parent === undefined ? undefined : r(parent),
		subProject: parent !== undefined,
	});

	test('одинаковые имена различаются родителем, затем путём', () => {
		const a = project('/w/a', 'a', '/w/a');
		const appOfA = project('/w/a/src/app', 'app', '/w/a', '/w/a');
		const b = project('/w/b', 'b', '/w/b');
		const appOfB = project('/w/b/app', 'app', '/w/b', '/w/b');
		const all = [a, appOfA, b, appOfB];

		assert.strictEqual(projectDisplayName(a, all), 'a');
		assert.strictEqual(projectDisplayName(appOfA, all), 'app (a)');
		assert.strictEqual(projectDisplayName(appOfB, all), 'app (b)');

		const first = project('/w/one/app', 'app', '/w/one');
		const second = project('/w/two/app', 'app', '/w/two');
		assert.strictEqual(projectDisplayName(first, [first, second]), 'app (one/app)');
		assert.strictEqual(projectDisplayName(second, [first, second]), 'app (two/app)');
	});

	test('каталоги поиска: проект без подпроектов и вложенных папок', async () => {
		setLayoutExclusions(() => []);
		setLayoutBoundaries(() => []);
		invalidateProjectLayout();
		const snapshot = await detectWorkspaceProjects(FOLDERS);

		assert.deepStrictEqual(scanRootsOf(snapshot, [...FOLDERS, folder(DELIVERY)]), [
			{ root: PROJECT, excludeDirs: [SUB_PROJECT] },
			{ root: SUB_PROJECT, excludeDirs: [] },
			{ root: TWO_CONFIGURATIONS, excludeDirs: [DELIVERY] },
		]);
		assert.deepStrictEqual(scanRootsOf({ projects: [], candidates: [], complete: true }, [folder(NOT_PROJECT)], NOT_PROJECT), [
			{ root: NOT_PROJECT, excludeDirs: [] },
		]);
		assert.deepStrictEqual(scanRootsOf({ projects: [], candidates: [], complete: true }, FOLDERS), []);
	});

	test('папка рабочей области корня: самая глубокая из содержащих', () => {
		const workspaceFolder = (root: string, index: number): vscode.WorkspaceFolder => ({
			uri: vscode.Uri.file(root),
			name: path.basename(root),
			index,
		});
		const outer = workspaceFolder(FIXTURES, 0);
		const inner = workspaceFolder(PROJECT, 1);
		const folders = [outer, inner, { ...workspaceFolder(TWO_CONFIGURATIONS, 2), uri: vscode.Uri.parse('untitled:две') }];

		assert.strictEqual(workspaceFolderOf(SUB_PROJECT, folders), inner);
		assert.strictEqual(workspaceFolderOf(otherCase(SUB_PROJECT), folders), inner);
		assert.strictEqual(workspaceFolderOf(TWO_CONFIGURATIONS, folders), outer);
		assert.strictEqual(workspaceFolderOf(path.parse(FIXTURES).root, folders), undefined);
	});
});

suite('текущий проект: порядок выбора', () => {
	const r = (dir: string) => normalizeProjectRoot(dir);
	const folders: WorkspaceFolderRef[] = [
		{ name: 'a', root: r('/w/a') },
		{ name: 'b', root: r('/w/b') },
	];
	const projects: WorkspaceProject[] = [
		{ root: r('/w/a'), name: 'a', folder: r('/w/a'), subProject: false },
		{ root: r('/w/a/sub'), name: 'sub', folder: r('/w/a'), parent: r('/w/a'), subProject: true },
		{ root: r('/w/b'), name: 'b', folder: r('/w/b'), subProject: false },
	];
	const isProject = (root: string) => projects.some((project) => sameProjectRoot(project.root, root));
	const base = { folders, projects, isProject };

	test('корень вызова важнее выбора', () => {
		assert.strictEqual(resolveCurrentRoot({ ...base, override: r('/w/b'), persisted: r('/w/a') }), r('/w/b'));
	});

	test('сохранённый выбор действует, пока такой проект есть', () => {
		assert.strictEqual(resolveCurrentRoot({ ...base, persisted: r('/w/a/sub'), defaultSetting: 'b' }), r('/w/a/sub'));
		assert.strictEqual(resolveCurrentRoot({ ...base, persisted: r('/w/нет'), defaultSetting: 'b' }), r('/w/b'));
	});

	test('настройка: абсолютный путь, путь от первой папки, имя папки', () => {
		assert.strictEqual(resolveCurrentRoot({ ...base, defaultSetting: r('/w/b') }), r('/w/b'));
		assert.strictEqual(resolveCurrentRoot({ ...base, defaultSetting: 'sub' }), r('/w/a/sub'));
		assert.strictEqual(resolveCurrentRoot({ ...base, defaultSetting: 'b' }), r('/w/b'));
		assert.strictEqual(resolveCurrentRoot({ ...base, defaultSetting: 'нет' }), r('/w/a'));
		assert.deepStrictEqual(defaultProjectPaths('  ', folders), []);
	});

	test('без выбора и настройки первый корневой проект', () => {
		assert.strictEqual(resolveCurrentRoot({ ...base, projects: [projects[1], projects[2], projects[0]] }), r('/w/b'));
	});

	test('проект в корне папки важнее проекта, найденного в папке без packagedef', () => {
		const nested: WorkspaceProject = { root: r('/w/c/fixtures/x'), name: 'x', folder: r('/w/c'), subProject: false };

		assert.strictEqual(resolveCurrentRoot({ ...base, projects: [nested, ...projects] }), r('/w/a'));
		assert.strictEqual(resolveCurrentRoot({ ...base, projects: [nested] }), r('/w/c/fixtures/x'));
	});

	test('без проектов единственная папка, иначе корня нет', () => {
		const none = { projects: [], isProject: () => false };

		assert.strictEqual(resolveCurrentRoot({ ...none, folders: [folders[0]] }), r('/w/a'));
		assert.strictEqual(resolveCurrentRoot({ ...none, folders }), undefined);
	});
});

suite('текущий проект: выбор и события', () => {
	let memento: vscode.Memento;
	let contexts: Map<string, boolean | string>;
	let service: WorkspaceProjects;
	const disposables: vscode.Disposable[] = [];

	const track = <T extends vscode.Disposable>(item: T): T => {
		disposables.push(item);
		return item;
	};

	setup(() => {
		setLayoutExclusions(() => []);
		setLayoutBoundaries(() => []);
		invalidateProjectLayout();
		memento = memoryMemento();
		contexts = new Map();
		service = track(
			new WorkspaceProjects({
				folders: () => FOLDERS,
				memento,
				setContext: (key, value) => contexts.set(key, value),
			})
		);
	});

	teardown(() => {
		for (const item of disposables.splice(0)) {
			item.dispose();
		}
	});

	test('без выбора текущий первый проект', async () => {
		assert.strictEqual(service.currentRoot(), PROJECT);
		await service.refresh();
		assert.strictEqual(service.currentRoot(), PROJECT);
		assert.strictEqual(service.currentProject()?.configuration?.name, 'Основная');
	});

	test('выбор сохраняется, событие одно, выбор того же корня молчит', async () => {
		const changes: CurrentProjectChange[] = [];
		service.onDidChangeCurrentProject((change) => changes.push(change));

		assert.strictEqual(await service.selectProject(SUB_PROJECT), true);
		assert.strictEqual(await service.selectProject(SUB_PROJECT), true);

		assert.strictEqual(memento.get(CURRENT_PROJECT_KEY), SUB_PROJECT);
		assert.strictEqual(service.currentRoot(), SUB_PROJECT);
		assert.deepStrictEqual(changes, [{ previous: PROJECT, current: SUB_PROJECT }]);
	});

	test('не проект выбрать нельзя', async () => {
		assert.strictEqual(await service.selectProject(NOT_PROJECT), false);
		assert.strictEqual(memento.get(CURRENT_PROJECT_KEY), undefined);
		assert.strictEqual(service.currentRoot(), PROJECT);
		assert.strictEqual(service.projectByRoot(NOT_PROJECT), undefined);
	});

	test('сохранённый выбор без проекта не действует и не стирается', async () => {
		const missing = at('удалённый');
		await memento.update(CURRENT_PROJECT_KEY, missing);
		const restored = track(new WorkspaceProjects({ folders: () => FOLDERS, memento }));

		await restored.refresh();
		assert.strictEqual(restored.currentRoot(), PROJECT);
		assert.strictEqual(memento.get(CURRENT_PROJECT_KEY), missing);
	});

	test('сохранённый подпроект действует и до конца обхода', async () => {
		await memento.update(CURRENT_PROJECT_KEY, SUB_PROJECT);
		const restored = track(new WorkspaceProjects({ folders: () => FOLDERS, memento }));

		assert.strictEqual(restored.snapshotNow().complete, false);
		assert.strictEqual(restored.currentRoot(), SUB_PROJECT);
	});

	test('до конца обхода каталог в oscript_modules не текущий, после обхода смены нет', async () => {
		await memento.update(CURRENT_PROJECT_KEY, PACKAGE);
		const restored = track(new WorkspaceProjects({ folders: () => FOLDERS, memento }));
		const configured = track(new WorkspaceProjects({ folders: () => FOLDERS, defaultSetting: () => 'oscript_modules/пакет' }));
		const changes: CurrentProjectChange[] = [];
		restored.onDidChangeCurrentProject((change) => changes.push(change));
		configured.onDidChangeCurrentProject((change) => changes.push(change));

		assert.strictEqual(restored.currentRoot(), PROJECT);
		assert.strictEqual(configured.currentRoot(), PROJECT);
		await restored.refresh();
		await configured.refresh();
		assert.deepStrictEqual(changes, []);
	});

	test('до конца обхода сохранённый проект внутри папки без packagedef действует', async () => {
		await memento.update(CURRENT_PROJECT_KEY, MODULE);
		const restored = track(new WorkspaceProjects({ folders: () => [folder(MONOREPO)], memento }));
		const changes: CurrentProjectChange[] = [];
		restored.onDidChangeCurrentProject((change) => changes.push(change));

		assert.strictEqual(restored.currentRoot(), MODULE);
		await restored.refresh();
		assert.strictEqual(restored.currentRoot(), MODULE);
		assert.deepStrictEqual(changes, []);
	});

	test('настройка по умолчанию задаёт проект без выбора', () => {
		const configured = track(new WorkspaceProjects({ folders: () => FOLDERS, defaultSetting: () => 'две-конфигурации' }));

		assert.strictEqual(configured.currentRoot(), TWO_CONFIGURATIONS);
	});

	test('корень вызова перекрывает выбор только внутри вызова', async () => {
		await service.selectProject(SUB_PROJECT);

		const inside = await runWithProject(TWO_CONFIGURATIONS, async () => {
			await new Promise((resolve) => setImmediate(resolve));
			return service.currentRoot();
		});

		assert.strictEqual(inside, TWO_CONFIGURATIONS);
		assert.strictEqual(service.currentRoot(), SUB_PROJECT);
		assert.strictEqual(runWithProject(undefined, () => service.currentRoot()), SUB_PROJECT);
	});

	test('слушатели событий не видят корень вызова, из которого пришла смена', async () => {
		const seen: Array<string | undefined> = [];
		service.onDidChangeProjects(() => seen.push(`projects:${service.currentRoot()}:${projectOverride()}`));
		service.onDidChangeCurrentProject(() => seen.push(`current:${service.currentRoot()}:${projectOverride()}`));

		await runWithProject(NOT_PROJECT, () => service.refresh());
		await runWithProject(TWO_CONFIGURATIONS, () => service.selectProject(SUB_PROJECT));

		assert.deepStrictEqual(seen, [`projects:${PROJECT}:undefined`, `current:${SUB_PROJECT}:undefined`]);
	});

	test('отложенное обнаружение не наследует корень вызова', async () => {
		const seen = nextEvent(service.onDidChangeProjects, () => [service.currentRoot(), projectOverride()]);

		runWithProject(NOT_PROJECT, () => service.scheduleRefresh());

		assert.deepStrictEqual(await seen, [PROJECT, undefined]);
	});

	test('проект файла: самый глубокий из найденных', async () => {
		await service.refresh();

		assert.strictEqual(service.projectOf(vscode.Uri.file(path.join(SUB_PROJECT, 'src', 'cf', 'Configuration.xml'))), SUB_PROJECT);
		assert.strictEqual(service.projectOf(path.join(PROJECT, 'src', 'cf')), PROJECT);
		assert.strictEqual(service.projectOf(NOT_PROJECT), undefined);
		assert.strictEqual(service.projectOf(vscode.Uri.parse('untitled:Без имени')), undefined);
	});

	test('на Windows корень с другим регистром: тот же проект в написании списка', async () => {
		await service.refresh();

		assert.strictEqual(service.projectOf(otherCase(path.join(SUB_PROJECT, 'src'))), SUB_PROJECT);
		assert.strictEqual(service.projectByRoot(otherCase(SUB_PROJECT))?.root, SUB_PROJECT);
		assert.strictEqual(runWithProject(otherCase(TWO_CONFIGURATIONS), () => service.currentRoot()), TWO_CONFIGURATIONS);
		assert.strictEqual(await service.selectProject(otherCase(SUB_PROJECT)), true);
		assert.strictEqual(memento.get(CURRENT_PROJECT_KEY), SUB_PROJECT);
		assert.strictEqual(service.currentRoot(), SUB_PROJECT);
	});

	test('обход обновляет ключи контекста и шлёт событие списка только при изменениях', async () => {
		let fired = 0;
		service.onDidChangeProjects(() => fired++);
		service.attach({});

		assert.strictEqual(contexts.get(DETECTING_CONTEXT), true);
		await service.refresh();
		await service.refresh();

		assert.strictEqual(fired, 1);
		assert.strictEqual(contexts.get(IS_1C_PROJECT_CONTEXT), true);
		assert.strictEqual(contexts.get(MULTIPLE_PROJECTS_CONTEXT), true);
		assert.strictEqual(contexts.get(HAS_CANDIDATES_CONTEXT), true);
		assert.strictEqual(contexts.get(DETECTING_CONTEXT), false);
		assert.strictEqual(contexts.get(PROJECT_KIND_CONTEXT), 'designer');
	});

	test('проект OneScript: вид в ключе контекста и признак пакета', async () => {
		const oneScriptRoot = normalizeProjectRoot(path.resolve(__dirname, '../../../src/test/fixtures/workspaceScan/пакет'));
		const library = at('инструменты', 'tools', 'deploy');
		const oneScript = track(
			new WorkspaceProjects({
				folders: () => [folder(oneScriptRoot), folder(library)],
				setContext: (key, value) => contexts.set(key, value),
			})
		);

		const projects = (await oneScript.refresh()).projects;
		assert.deepStrictEqual(
			projects.map((project) => [path.basename(project.root), project.kind, project.package]),
			[['пакет', 'onescript', false], ['deploy', 'onescript', false]]
		);
		assert.strictEqual(contexts.get(PROJECT_KIND_CONTEXT), 'onescript');
	});

	test('без проектов корня нет, папка с исходным кодом в не проектах', async () => {
		const bare = track(
			new WorkspaceProjects({
				folders: () => [folder(NOT_PROJECT), folder(EMPTY)],
				setContext: (key, value) => contexts.set(key, value),
			})
		);

		await bare.refresh();
		assert.strictEqual(bare.currentRoot(), undefined);
		assert.strictEqual(bare.hasProjects(), false);
		assert.strictEqual(contexts.get(IS_1C_PROJECT_CONTEXT), false);
		assert.strictEqual(contexts.get(MULTIPLE_PROJECTS_CONTEXT), false);
		assert.strictEqual(contexts.get(HAS_CANDIDATES_CONTEXT), true);
		assert.deepStrictEqual((await bare.listCandidates()).map((candidate) => candidate.root), [NOT_PROJECT]);
	});

	test('смена папок сразу убирает проекты удалённой папки, остальное после обхода', async () => {
		let folders: WorkspaceFolderRef[] = FOLDERS;
		const changing = track(
			new WorkspaceProjects({ folders: () => folders, setContext: (key, value) => contexts.set(key, value) })
		);
		await changing.refresh();
		const changes: CurrentProjectChange[] = [];
		let listChanges = 0;
		changing.onDidChangeCurrentProject((change) => changes.push(change));
		changing.onDidChangeProjects(() => listChanges++);

		folders = [folder(NOT_PROJECT), folder(TWO_CONFIGURATIONS)];
		const detection = changing.foldersChanged();

		assert.strictEqual(changing.currentRoot(), TWO_CONFIGURATIONS);
		assert.strictEqual(changing.snapshotNow().complete, false);
		assert.deepStrictEqual(changing.snapshotNow().projects.map((project) => project.root), [TWO_CONFIGURATIONS]);
		assert.deepStrictEqual(changes, [{ previous: PROJECT, current: TWO_CONFIGURATIONS }]);
		assert.strictEqual(listChanges, 1);
		assert.strictEqual(contexts.get(MULTIPLE_PROJECTS_CONTEXT), false);

		await detection;
		assert.strictEqual(changing.snapshotNow().complete, true);
		assert.strictEqual(changes.length, 1);

		folders = [folder(NOT_PROJECT)];
		void changing.foldersChanged();
		assert.strictEqual(changing.hasProjects(), false);
		assert.strictEqual(contexts.get(IS_1C_PROJECT_CONTEXT), false);
		assert.strictEqual(changing.currentRoot(), NOT_PROJECT);
	});

	test('переименование и удаление подпроекта: список обновляется, текущий возвращается к проекту', async () => {
		const copy = copyFixture('проект');
		try {
			const oldSub = normalizeProjectRoot(path.join(copy.root, 'src', 'cfe', 'подпроект'));
			const renamed = normalizeProjectRoot(path.join(copy.root, 'src', 'cfe', 'переименованный'));
			const local = track(new WorkspaceProjects({ folders: () => [folder(copy.root)], memento }));
			assert.strictEqual(await local.selectProject(oldSub), true);
			const changes: CurrentProjectChange[] = [];
			local.onDidChangeCurrentProject((change) => changes.push(change));

			assert.strictEqual(local.pathsRemoved([path.join(copy.root, 'src', 'cf', 'Catalogs')]), false);
			fs.renameSync(oldSub, renamed);
			assert.strictEqual(local.pathsRemoved([oldSub], [renamed]), true);

			assert.deepStrictEqual((await local.listProjects()).map((project) => project.root), [copy.root, renamed]);
			assert.strictEqual(local.currentRoot(), copy.root);
			assert.deepStrictEqual(changes, [{ previous: oldSub, current: copy.root }]);

			fs.rmSync(renamed, { recursive: true });
			assert.strictEqual(local.pathsRemoved([renamed]), true);
			assert.deepStrictEqual((await local.listProjects()).map((project) => project.root), [copy.root]);
		} finally {
			copy.dispose();
		}
	});

	test('packagedef в oscript_modules и уже найденный проект обнаружение не запускают', async () => {
		await service.refresh();

		assert.strictEqual(service.projectFileChanged(path.join(PACKAGE, 'packagedef'), true), false);
		assert.strictEqual(service.projectFileChanged(path.join(SUB_PROJECT, 'packagedef'), true), false);
		assert.strictEqual(service.projectFileChanged(path.join(path.parse(PROJECT).root, 'packagedef'), true), false);
		assert.strictEqual(service.projectFileChanged(path.join(SUB_PROJECT, 'packagedef'), false), true);
	});

	test('создание packagedef: проект найден, выбран, события по одному', async () => {
		const copy = copyFixture('без-packagedef');
		try {
			const local = track(
				new WorkspaceProjects({ folders: () => [folder(copy.root), folder(TWO_CONFIGURATIONS)], memento, templateFile: TEMPLATE })
			);
			await local.refresh();
			assert.deepStrictEqual((await local.listCandidates()).map((candidate) => candidate.root).slice(0, 1), [copy.root]);
			let listChanges = 0;
			const changes: CurrentProjectChange[] = [];
			local.onDidChangeProjects(() => listChanges++);
			local.onDidChangeCurrentProject((change) => changes.push(change));

			assert.strictEqual(await local.createProjectFile(copy.root), copy.root);

			assert.strictEqual(fs.readFileSync(path.join(copy.root, 'packagedef'), 'utf-8'), fs.readFileSync(TEMPLATE, 'utf-8'));
			assert.strictEqual(local.currentRoot(), copy.root);
			assert.strictEqual(local.projectByRoot(copy.root)?.configuration?.name, 'БезПроекта');
			assert.strictEqual(listChanges, 1);
			assert.deepStrictEqual(changes, [{ previous: TWO_CONFIGURATIONS, current: copy.root }]);
			assert.strictEqual(local.projectFileChanged(path.join(copy.root, 'packagedef'), true), false);

			await assert.rejects(local.createProjectFile(copy.root), ProjectFileExistsError);
			assert.strictEqual(await local.createProjectFile(copy.root, { overwrite: true }), copy.root);
		} finally {
			copy.dispose();
		}
	});
});

suite('раскладка: удаление и изменение файлов', () => {
	setup(() => {
		setLayoutExclusions(() => []);
		setLayoutBoundaries(() => []);
		setTestsDirectory(() => DEFAULT_TESTING.directoryName);
		invalidateProjectLayout();
	});

	teardown(() => {
		setLayoutExclusions(() => []);
		setTestsDirectory(() => DEFAULT_TESTING.directoryName);
	});

	test('удаление обычного файла раскладку не сбрасывает, удаление расширения не ищет проекты заново', async () => {
		await resolveProjectLayout(SUB_PROJECT);

		assert.deepStrictEqual(invalidateProjectLayoutsForRemoval(path.join(SUB_PROJECT, 'docs', 'readme.md')), { forgotten: false, projects: false });
		assert.deepStrictEqual(
			invalidateProjectLayoutsForRemoval(path.join(SUB_PROJECT, 'src', 'cf', 'Catalogs', 'Товары.xml')),
			{ forgotten: false, projects: false }
		);
		assert.deepStrictEqual(
			invalidateProjectLayoutsForRemoval(path.join(SUB_PROJECT, 'src', 'cfe', 'РасширениеПодпроекта')),
			{ forgotten: true, projects: false }
		);
		await resolveProjectLayout(SUB_PROJECT);
		assert.deepStrictEqual(invalidateProjectLayoutsForRemoval(path.join(SUB_PROJECT, 'src', 'cf')), { forgotten: true, projects: true });
	});

	test('изменения в подпроекте сбрасывают раскладку родителя, если их видит обход подпроекта', async () => {
		const layout = await resolveProjectLayout(RETAIL);

		assert.deepStrictEqual(invalidateProjectLayoutsForRemoval(path.join(METRICS, 'docs')), { forgotten: false, projects: false });
		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(EXPORT, 'src', 'cf', 'Catalogs', 'Товары.xml')), false);
		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(ADAPTER, 'Catalogs', 'Товары.xml')), false);
		assert.strictEqual(await resolveProjectLayout(RETAIL), layout);

		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(METRICS, 'src', 'cfe', 'Новое', 'Configuration.xml')), true);
		await resolveProjectLayout(RETAIL);
		assert.deepStrictEqual(
			invalidateProjectLayoutsForRemoval(path.join(EXPORT, 'src', 'cfe', 'ЭкспортМетрик')),
			{ forgotten: true, projects: false }
		);
		await resolveProjectLayout(RETAIL);
		assert.deepStrictEqual(invalidateProjectLayoutsForRemoval(path.join(PACKAGE_MANAGER, 'src', 'cf')), { forgotten: true, projects: true });
	});

	test('файл внутри найденной конфигурации и подпроекта раскладку не сбрасывает, описание сбрасывает', async () => {
		const layout = await resolveProjectLayout(PROJECT);

		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(PROJECT, 'src', 'cf', 'Catalogs', 'Товары.xml')), false);
		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(SUB_PROJECT, 'src', 'cf', 'Catalogs', 'Товары.xml')), false);
		assert.strictEqual(await resolveProjectLayout(PROJECT), layout);
		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(PROJECT, 'docs', 'Configuration.xml')), true);
		await resolveProjectLayout(PROJECT);
		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(PROJECT, 'src', 'cf', 'Configuration.xml')), true);
		await resolveProjectLayout(PROJECT);
		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(SUB_PROJECT, 'src', 'cf', 'Configuration.xml')), true);
	});

	test('исключения из настроек не читаются на каждое событие', async () => {
		let reads = 0;
		setLayoutExclusions(() => {
			reads += 1;
			return [];
		});
		await resolveProjectLayout(PROJECT);
		const before = reads;

		for (let index = 0; index < 20; index += 1) {
			invalidateProjectLayoutsForRemoval(path.join(PROJECT, 'docs', `${index}.md`));
			invalidateProjectLayoutsForFile(path.join(PROJECT, 'src', 'cf', 'Catalogs', `${index}.xml`));
		}

		assert.strictEqual(reads, before);
	});

	test('раскладка, найденное в которой менялось все повторы обхода, обычные файлы в счёт не берёт', async () => {
		let resolving = true;
		let index = 0;
		setTestsDirectory(() => {
			if (resolving) {
				index += 1;
				invalidateProjectLayoutsForFile(path.join(SUB_PROJECT, 'docs', `${index}.xml`));
			}
			return DEFAULT_TESTING.directoryName;
		});

		const layout = await resolveProjectLayout(SUB_PROJECT);
		resolving = false;

		assert.deepStrictEqual(invalidateProjectLayoutsForRemoval(path.join(SUB_PROJECT, 'docs', 'readme.md')), { forgotten: false, projects: false });
		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(SUB_PROJECT, 'src', 'cf', 'Catalogs', 'Товары.xml')), false);
		assert.notStrictEqual(await resolveProjectLayout(SUB_PROJECT), layout, 'такую раскладку следующий вызов обходит заново');
	});

	test('описания внутри внешнего объекта конфигуратора раскладку не сбрасывают, у EDT сбрасывают до каталога объекта', async () => {
		const layouts = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');
		const designer = path.join(layouts, 'designer');
		const processor = path.join(designer, 'src', 'epf', 'ПечатьСчёта');
		const edt = path.join(layouts, 'edt-workspace');
		const edtObjects = path.join(edt, 'dp', 'src', 'ExternalDataProcessors');

		await resolveProjectLayout(designer);
		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(processor, 'Forms', 'Форма.xml')), false);
		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(processor, 'Templates', 'Макет.xml')), false);
		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(processor, 'Forms', 'Форма', 'Ext', 'Form.xml')), false);
		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(processor, 'Другое.xml')), true);

		await resolveProjectLayout(edt);
		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(edtObjects, 'ТестоваяВнешняяОбработка', 'Forms', 'Форма', 'Form.mdo')), false);
		assert.strictEqual(invalidateProjectLayoutsForFile(path.join(edtObjects, 'Новая', 'Новая.mdo')), true);
	});

	test('изменения во время обхода: обход не забывается и повторяется, только если удалено найденное', async () => {
		const copy = copyFixture('проект');
		try {
			const sub = normalizeProjectRoot(path.join(copy.root, 'src', 'cfe', 'подпроект'));
			const extension = path.join(sub, 'src', 'cfe', 'РасширениеПодпроекта');
			const during: unknown[] = [];
			let calls = 0;
			// Второе чтение каталога тестов идёт после обхода, до готовой раскладки
			setTestsDirectory(() => {
				calls += 1;
				if (calls === 2) {
					during.push(invalidateProjectLayoutsForRemoval(path.join(sub, 'readme.md')));
					during.push(invalidateProjectLayoutsForFile(path.join(sub, 'src', 'cf', 'Catalogs', 'Товары.xml')));
					fs.rmSync(extension, { recursive: true });
					during.push(invalidateProjectLayoutsForRemoval(extension));
				}
				return DEFAULT_TESTING.directoryName;
			});

			const layout = await resolveProjectLayout(sub);

			assert.deepStrictEqual(during, [{ forgotten: false, projects: false }, false, { forgotten: false, projects: false }]);
			assert.strictEqual(layout.configuration?.name, 'Подпроект');
			assert.deepStrictEqual(layout.extensions, []);
			assert.strictEqual(await resolveProjectLayout(sub), layout);
		} finally {
			copy.dispose();
		}
	});
});

suite('проекты рабочей области: создание, переименование, недостижимые каталоги', () => {
	const disposables: vscode.Disposable[] = [];

	const track = <T extends vscode.Disposable>(item: T): T => {
		disposables.push(item);
		return item;
	};

	setup(() => {
		setLayoutExclusions(() => []);
		setLayoutBoundaries(() => []);
		invalidateProjectLayout();
	});

	teardown(() => {
		for (const item of disposables.splice(0)) {
			item.dispose();
		}
	});

	test('событие своего packagedef до конца создания обнаружение не запускает', async () => {
		const copy = copyFixture('без-packagedef');
		try {
			const notified: ProjectLayoutChange[] = [];
			const file = path.join(copy.root, 'packagedef');
			const local = track(
				new WorkspaceProjects({
					folders: () => [folder(copy.root)],
					memento: memoryMemento(),
					templateFile: TEMPLATE,
					notifyLayout: (change) => notified.push(change),
				})
			);
			await local.refresh();

			const creating = local.createProjectFile(copy.root);
			assert.strictEqual(local.projectFileChanged(file, true), false);
			assert.strictEqual(await creating, copy.root);
			assert.strictEqual(local.projectFileChanged(file, true), false);
			assert.deepStrictEqual(notified, []);

			assert.strictEqual(local.projectFileChanged(file, false), true);
			assert.deepStrictEqual(notified, [{ projects: true }]);
		} finally {
			copy.dispose();
		}
	});

	test('правка packagedef проекта пересчитывает его вид, packagedef вне проектов не в счёт', async () => {
		const copy = copyFixture('инструменты');
		try {
			const scripts = normalizeProjectRoot(path.join(copy.root, 'tools', 'deploy'));
			const local = track(new WorkspaceProjects({ folders: () => [folder(scripts)] }));
			assert.strictEqual((await local.listProjects())[0].kind, 'onescript');

			fs.writeFileSync(path.join(scripts, 'packagedef'), 'Описание.Имя("deploy").ЗависитОт("vanessa-runner");', 'utf-8');
			assert.strictEqual(local.projectFileEdited(path.join(copy.root, 'packagedef')), false);
			const changed = nextEvent(local.onDidChangeProjects, () => local.projectByRoot(scripts)?.kind);
			assert.strictEqual(local.projectFileEdited(path.join(scripts, 'packagedef')), true);
			assert.strictEqual(await changed, 'onec');
		} finally {
			copy.dispose();
		}
	});

	test('проигравший параллельный вызов создания не снимает защиту от события своего packagedef', async () => {
		const copy = copyFixture('без-packagedef');
		try {
			const notified: ProjectLayoutChange[] = [];
			const file = path.join(copy.root, 'packagedef');
			const local = track(
				new WorkspaceProjects({
					folders: () => [folder(copy.root)],
					memento: memoryMemento(),
					templateFile: TEMPLATE,
					notifyLayout: (change) => notified.push(change),
				})
			);
			await local.refresh();

			const changedAtRejection: boolean[] = [];
			const settle = (creating: Promise<string>): Promise<unknown> =>
				creating.then(
					() => undefined,
					(error: unknown) => {
						changedAtRejection.push(local.projectFileChanged(file, true));
						return error;
					}
				);

			const errors = (await Promise.all([settle(local.createProjectFile(copy.root)), settle(local.createProjectFile(copy.root))])).filter(
				(error) => error !== undefined
			);

			assert.strictEqual(errors.length, 1);
			assert.ok(errors[0] instanceof ProjectFileExistsError);
			assert.deepStrictEqual(changedAtRejection, [false]);
			assert.strictEqual(local.projectFileChanged(file, true), false);
			assert.deepStrictEqual(notified, []);
		} finally {
			copy.dispose();
		}
	});

	test('первый проект окна: в слушателе списка текущий корень уже новый, смена текущего следом', async () => {
		const copy = copyFixture('без-packagedef');
		try {
			const local = track(new WorkspaceProjects({ folders: () => [folder(copy.root), folder(EMPTY)], templateFile: TEMPLATE }));
			await local.refresh();
			assert.strictEqual(local.currentRoot(), undefined);
			const seen: string[] = [];
			local.onDidChangeProjects(() => seen.push(`projects:${local.currentRoot()}`));
			local.onDidChangeCurrentProject((change) => seen.push(`current:${change.previous}:${change.current}`));

			await local.createProjectFile(copy.root);

			assert.deepStrictEqual(seen, [`projects:${copy.root}`, `current:undefined:${copy.root}`]);
		} finally {
			copy.dispose();
		}
	});

	test('переименование приносит проект, лежащий глубже, из пропускаемого каталога', async () => {
		const copy = copyFixture('проект');
		try {
			const sub = normalizeProjectRoot(path.join(copy.root, 'src', 'cfe', 'подпроект'));
			const local = track(new WorkspaceProjects({ folders: () => [folder(copy.root)] }));
			assert.deepStrictEqual((await local.listProjects()).map((project) => project.root), [copy.root, sub]);

			const docs = path.join(copy.root, 'docs');
			fs.mkdirSync(docs);
			fs.renameSync(docs, path.join(copy.root, 'документы'));
			assert.strictEqual(local.pathsRemoved([docs], [path.join(copy.root, 'документы')]), false);

			const hidden = path.join(copy.root, 'oscript_modules');
			const visible = path.join(copy.root, 'пакеты');
			fs.renameSync(hidden, visible);
			assert.strictEqual(local.pathsRemoved([hidden], [visible]), true);

			assert.deepStrictEqual(
				(await local.listProjects()).map((project) => project.root),
				[copy.root, sub, normalizeProjectRoot(path.join(visible, 'пакет'))]
			);
		} finally {
			copy.dispose();
		}
	});

	test('до конца обхода сохранённый или настроенный каталог, в который обход не заходит, не текущий', async () => {
		const root = at('недостижимые');
		const unreachable = [
			at('недостижимые', 'src', 'cf', 'внутри'),
			at('недостижимые', 'обработки', 'Обработка', 'внутри'),
			at('недостижимые', 'edt', 'Расширение', 'внутри'),
		];

		for (const saved of unreachable) {
			const memento = memoryMemento();
			await memento.update(CURRENT_PROJECT_KEY, saved);
			const restored = track(new WorkspaceProjects({ folders: () => [folder(root)], memento }));
			const configured = track(new WorkspaceProjects({ folders: () => [folder(root)], defaultSetting: () => saved }));
			const changes: CurrentProjectChange[] = [];
			restored.onDidChangeCurrentProject((change) => changes.push(change));
			configured.onDidChangeCurrentProject((change) => changes.push(change));

			assert.strictEqual(restored.currentRoot(), root, saved);
			assert.strictEqual(configured.currentRoot(), root, saved);
			await restored.refresh();
			await configured.refresh();
			assert.deepStrictEqual(changes, [], saved);
			assert.deepStrictEqual((await restored.listProjects()).map((project) => project.root), [root]);
		}
	});

	test('совпадающие имена не проектов различаются родительским проектом', async () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-candidates-'));
		try {
			const first = normalizeProjectRoot(path.join(base, 'первая'));
			const second = normalizeProjectRoot(path.join(base, 'вторая'));
			fs.cpSync(TWO_CONFIGURATIONS, first, { recursive: true });
			fs.cpSync(TWO_CONFIGURATIONS, second, { recursive: true });
			const local = track(new WorkspaceProjects({ folders: () => [folder(first), folder(second), folder(NOT_PROJECT)] }));

			assert.deepStrictEqual(
				(await local.listCandidates()).map((candidate) => [candidate.name, candidate.displayName]),
				[
					['поставка', 'поставка (первая)'],
					['учёт', 'учёт (первая)'],
					['поставка', 'поставка (вторая)'],
					['учёт', 'учёт (вторая)'],
					['без-packagedef', 'без-packagedef'],
				]
			);
		} finally {
			fs.rmSync(base, { recursive: true, force: true });
		}
	});
});
