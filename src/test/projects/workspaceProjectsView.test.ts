import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { normalizeProjectRoot, sameProjectRoot, type ProjectCandidate } from '../../shared/workspaceProjects';
import { candidateDescription } from '../../features/projects/projectPresentation';
import {
	WorkspaceProjectsTreeProvider,
	type WorkspaceProjectsNode,
} from '../../features/projects/workspaceProjectsView';
import { bindProjectDescription } from '../../features/projects/projectViewDescription';
import { projectPickItems } from '../../features/projects/workspaceProjectPicker';
import { initializeChoices } from '../../features/projects/projectInitialization';
import { listProjectsResult } from '../../features/projects/projectList';
import type { ProjectLaunch } from '../../shared/projectState';
import {
	ACCOUNTING,
	at,
	copyFixtures,
	DELIVERY,
	detectedProjects,
	NOT_PROJECT,
	PROJECT,
	resetLayout,
	sameNamedCandidates,
	SUB_PROJECT,
	TWO_CONFIGURATIONS,
	type ProjectsFixture,
} from './workspaceProjectsFixture';

const ROOTS = [PROJECT, NOT_PROJECT, TWO_CONFIGURATIONS];

const launchOf = (root: string): ProjectLaunch => (sameProjectRoot(root, PROJECT) ? { profile: 'dev' } : {});

function rootOfNode(node: WorkspaceProjectsNode): string | undefined {
	switch (node.kind) {
		case 'project':
			return node.project.root;
		case 'extraConfiguration':
		case 'candidate':
			return node.candidate.root;
		default:
			return undefined;
	}
}

function row(provider: WorkspaceProjectsTreeProvider, node: WorkspaceProjectsNode): [string, string | undefined, string | undefined, string | undefined] {
	const item = provider.getTreeItem(node);
	return [String(item.label), item.description === undefined ? undefined : String(item.description), item.contextValue, rootOfNode(node)];
}

suite('проекты: вид «Рабочая область»', () => {
	let fixture: ProjectsFixture;
	let provider: WorkspaceProjectsTreeProvider;

	setup(async () => {
		resetLayout();
		fixture = await detectedProjects(ROOTS);
		provider = new WorkspaceProjectsTreeProvider(fixture.source, launchOf);
	});

	teardown(() => {
		provider.dispose();
		fixture.instance.dispose();
	});

	test('корневые проекты, затем группа «Не проекты»', () => {
		const top = provider.getChildren();

		assert.deepStrictEqual(
			top.map((node) => row(provider, node)),
			[
				['проект', 'текущий · Конфигуратор · Основная · профиль: dev', 'workspaceProjectCurrent', PROJECT],
				['две-конфигурации', 'Конфигуратор · Первая', 'workspaceProject', TWO_CONFIGURATIONS],
				['Не проекты', undefined, 'workspaceCandidates', undefined],
			]
		);
	});

	test('подпроект вложен в родителя, вторые конфигурации под своим проектом', () => {
		const [project, twoConfigurations, group] = provider.getChildren();

		assert.deepStrictEqual(provider.getChildren(project).map((node) => row(provider, node)), [
			['подпроект', 'Конфигуратор · Подпроект', 'workspaceProject', SUB_PROJECT],
		]);
		assert.deepStrictEqual(provider.getChildren(twoConfigurations).map((node) => row(provider, node)), [
			['Вторая', 'вторая конфигурация · Конфигуратор · Вторая', 'workspaceExtraConfiguration', DELIVERY],
			['Учёт', 'вторая конфигурация · EDT · Учёт', 'workspaceExtraConfiguration', ACCOUNTING],
		]);
		assert.deepStrictEqual(provider.getChildren(group).map((node) => row(provider, node)), [
			['без-packagedef', 'Конфигуратор · БезПроекта', 'workspaceCandidate', NOT_PROJECT],
		]);
	});

	test('значки: текущий цветом, подпроект значком и цветом подмодуля, вторая конфигурация предупреждением', async () => {
		const [project, twoConfigurations] = provider.getChildren();
		const [subProject] = provider.getChildren(project);
		const [extra] = provider.getChildren(twoConfigurations);

		const icon = (node: WorkspaceProjectsNode) => provider.getTreeItem(node).iconPath as vscode.ThemeIcon;
		assert.strictEqual(icon(project).id, 'repo');
		assert.strictEqual(icon(project).color?.id, 'testing.iconPassed');
		assert.strictEqual(icon(twoConfigurations).color, undefined);
		assert.strictEqual(icon(subProject).id, 'file-submodule');
		assert.strictEqual(icon(subProject).color?.id, 'gitDecoration.submoduleResourceForeground');
		assert.strictEqual(icon(extra).id, 'warning');
		await fixture.source.selectProject(SUB_PROJECT);
		assert.strictEqual(icon(subProject).color?.id, 'testing.iconPassed');
		assert.strictEqual(provider.getTreeItem(subProject).description, 'текущий · Конфигуратор · Подпроект');
		await fixture.source.selectProject(PROJECT);
		assert.strictEqual(provider.getTreeItem(project).collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
		assert.strictEqual(provider.getTreeItem(subProject).collapsibleState, vscode.TreeItemCollapsibleState.None);
	});

	test('вложенные строки без имени родителя, одинаковые имена на одном уровне различаются', async () => {
		const copy = copyFixtures('проект');
		const local = await detectedProjects([PROJECT, ...copy.roots]);
		const localProvider = new WorkspaceProjectsTreeProvider(local.source, () => ({}));
		try {
			const [copyRoot] = copy.roots;
			const top = localProvider.getChildren();
			const label = (node: WorkspaceProjectsNode) => String(localProvider.getTreeItem(node).label);

			assert.deepStrictEqual(top.map(label), [`проект (${PROJECT})`, `проект (${copyRoot})`]);
			assert.deepStrictEqual(
				top.map((node) => localProvider.getChildren(node).map(label)),
				[['подпроект'], ['подпроект']]
			);
		} finally {
			localProvider.dispose();
			local.instance.dispose();
			copy.dispose();
		}
	});

	test('проекты из папки без packagedef: после проектов в корне папок, значок подмодуля и путь, текущий по умолчанию в корне папки', async () => {
		const local = await detectedProjects([at('монорепозиторий'), PROJECT]);
		const localProvider = new WorkspaceProjectsTreeProvider(local.source, launchOf);
		try {
			const top = localProvider.getChildren();
			const icon = (node: WorkspaceProjectsNode) => localProvider.getTreeItem(node).iconPath as vscode.ThemeIcon;

			assert.deepStrictEqual(
				top.map((node) => row(localProvider, node)),
				[
					['проект', 'текущий · Конфигуратор · Основная · профиль: dev', 'workspaceProjectCurrent', PROJECT],
					['библиотека', 'монорепозиторий · Конфигуратор · Библиотека', 'workspaceProject', at('монорепозиторий', 'библиотека')],
					['приложение', 'монорепозиторий · Конфигуратор · Приложение', 'workspaceProject', at('монорепозиторий', 'приложение')],
				]
			);
			assert.deepStrictEqual(top.map((node) => icon(node).id), ['repo', 'file-submodule', 'file-submodule']);
			assert.strictEqual(icon(top[1]).color?.id, 'gitDecoration.submoduleResourceForeground');

			const items = projectPickItems(local.source.snapshotNow(), local.source.selectedRoot()).filter((item) => item.kind === undefined);
			assert.deepStrictEqual(
				items.map((item) => [item.label, item.description, (item.iconPath as vscode.ThemeIcon | undefined)?.id]),
				[
					['проект', 'текущий · Конфигуратор · Основная', 'check'],
					['подпроект', 'src/cfe/подпроект · Конфигуратор · Подпроект', 'file-submodule'],
					['библиотека', 'монорепозиторий · Конфигуратор · Библиотека', 'file-submodule'],
					['приложение', 'монорепозиторий · Конфигуратор · Приложение', 'file-submodule'],
					['модуль', 'src/cfe/модуль · Конфигуратор · Модуль', 'file-submodule'],
				]
			);
		} finally {
			localProvider.dispose();
			local.instance.dispose();
		}
	});

	test('проект без конфигурации подписан видом', async () => {
		const scripts = at('инструменты', 'tools', 'deploy');
		const local = await detectedProjects([scripts]);
		const localProvider = new WorkspaceProjectsTreeProvider(local.source, () => ({}));
		try {
			const [project] = localProvider.getChildren();
			assert.deepStrictEqual(row(localProvider, project), ['deploy', 'текущий · OneScript', 'workspaceProjectCurrent', scripts]);
			assert.strictEqual(localProvider.getTreeItem(project).tooltip, `${scripts}\nВид: OneScript`);
		} finally {
			localProvider.dispose();
			local.instance.dispose();
		}
	});

	test('клик по строке проекта выбирает его', () => {
		const [, twoConfigurations] = provider.getChildren();

		const command = provider.getTreeItem(twoConfigurations).command;

		assert.strictEqual(command?.command, '1c-platform-tools.project.select');
		assert.deepStrictEqual(command?.arguments, [TWO_CONFIGURATIONS]);
	});

	test('родитель строки: проект для подпроекта и второй конфигурации, группа для не проекта', () => {
		const [project, twoConfigurations, group] = provider.getChildren();
		const [subProject] = provider.getChildren(project);
		const [extra] = provider.getChildren(twoConfigurations);
		const [candidate] = provider.getChildren(group);

		assert.strictEqual(provider.getParent(subProject), project);
		assert.strictEqual(provider.getParent(extra), twoConfigurations);
		assert.strictEqual(provider.getParent(candidate), group);
		assert.strictEqual(provider.getParent(project), undefined);
		assert.strictEqual(provider.getParent(group), undefined);
	});

	test('смена профиля или окружения перерисовывает их в строках', () => {
		const launches = new Map<string, ProjectLaunch>([[PROJECT, { profile: 'dev' }]]);
		const profileChanged = new vscode.EventEmitter<void>();
		const local = new WorkspaceProjectsTreeProvider(fixture.source, (root) => launches.get(root) ?? {}, profileChanged.event);
		let changes = 0;
		const subscription = local.onDidChangeTreeData(() => {
			changes += 1;
		});
		try {
			launches.set(PROJECT, { profile: 'test', environment: 'ci' });
			launches.set(TWO_CONFIGURATIONS, { profile: 'prod' });
			profileChanged.fire();

			const [project, twoConfigurations] = local.getChildren();
			assert.strictEqual(changes, 1);
			assert.strictEqual(local.getTreeItem(project).description, 'текущий · Конфигуратор · Основная · профиль: test · окружение: ci');
			assert.strictEqual(local.getTreeItem(twoConfigurations).description, 'Конфигуратор · Первая · профиль: prod');
		} finally {
			subscription.dispose();
			local.dispose();
			profileChanged.dispose();
		}
	});

	test('смена текущего проекта перерисовывает вид', async () => {
		let changes = 0;
		const subscription = provider.onDidChangeTreeData(() => {
			changes += 1;
		});

		await fixture.source.selectProject(TWO_CONFIGURATIONS);
		subscription.dispose();

		const [project, twoConfigurations] = provider.getChildren();
		assert.ok(changes > 0);
		assert.strictEqual(provider.getTreeItem(project).description, 'Конфигуратор · Основная · профиль: dev');
		assert.strictEqual(provider.getTreeItem(twoConfigurations).description, 'текущий · Конфигуратор · Первая');
		assert.strictEqual(provider.getTreeItem(twoConfigurations).contextValue, 'workspaceProjectCurrent');
	});
});

suite('проекты: окно выбора и описание видов', () => {
	let fixture: ProjectsFixture;

	setup(async () => {
		resetLayout();
		fixture = await detectedProjects(ROOTS);
	});

	teardown(() => {
		fixture.instance.dispose();
	});

	test('окно выбора: проекты по корневым проектам с отметкой текущего, не проекты за разделителем', () => {
		const items = projectPickItems(fixture.source.snapshotNow(), PROJECT);

		assert.deepStrictEqual(
			items.map((item) => [item.label, item.description, (item.iconPath as vscode.ThemeIcon | undefined)?.id, item.kind]),
			[
				['проект', undefined, undefined, vscode.QuickPickItemKind.Separator],
				['проект', 'текущий · Конфигуратор · Основная', 'check', undefined],
				['подпроект', 'src/cfe/подпроект · Конфигуратор · Подпроект', 'file-submodule', undefined],
				['две-конфигурации', undefined, undefined, vscode.QuickPickItemKind.Separator],
				['две-конфигурации', 'Конфигуратор · Первая', 'repo', undefined],
				['Не проекты', undefined, undefined, vscode.QuickPickItemKind.Separator],
				['без-packagedef', 'Конфигуратор · БезПроекта', 'folder', undefined],
				['поставка', 'вторая конфигурация · Конфигуратор · Вторая', 'warning', undefined],
				['учёт', 'вторая конфигурация · EDT · Учёт', 'warning', undefined],
			]
		);
		assert.deepStrictEqual(items.filter((item) => item.detail !== undefined), []);
	});

	test('окно выбора с одним корневым проектом: без разделителя, пути подпроектов от корневого проекта', async () => {
		const retail = await detectedProjects([at('розница')]);
		try {
			const items = projectPickItems(retail.source.snapshotNow(), at('розница', 'src', 'cfe', 'метрики'));

			assert.deepStrictEqual(
				items.map((item) => [item.label, item.description, (item.iconPath as vscode.ThemeIcon | undefined)?.id, item.kind]),
				[
					['розница', 'Конфигуратор · Розница', 'repo', undefined],
					['менеджер-пакетов', 'src/cfe/менеджер-пакетов · Конфигуратор · БазаМенеджераПакетов', 'file-submodule', undefined],
					['метрики', 'текущий · src/cfe/метрики · Конфигуратор · БазаМетрик', 'check', undefined],
					['экспорт', 'src/cfe/метрики/src/cfe/экспорт · Конфигуратор · БазаЭкспорта', 'file-submodule', undefined],
				]
			);
		} finally {
			retail.instance.dispose();
		}
	});

	test('описание вида следует за текущим проектом, когда проектов несколько', async () => {
		const view: { description?: string } = {};
		const binding = bindProjectDescription(view, fixture.source);

		assert.strictEqual(view.description, 'проект');
		await fixture.source.selectProject(TWO_CONFIGURATIONS);
		assert.strictEqual(view.description, 'две-конфигурации');
		binding.dispose();
	});

	test('совпадающие имена не проектов различаются в виде, окне выбора, вариантах инициализации и списке', async () => {
		const copy = sameNamedCandidates();
		const local = await detectedProjects(copy.roots);
		const provider = new WorkspaceProjectsTreeProvider(local.source, () => ({}));
		try {
			const [first, , x, y] = copy.roots;
			const group = provider.getChildren().find((node) => node.kind === 'candidates');
			assert.ok(group);
			assert.deepStrictEqual(
				provider.getChildren(group).map((node) => String(provider.getTreeItem(node).label)),
				[`без-packagedef (${x})`, `без-packagedef (${y})`]
			);

			const candidates = projectPickItems(local.source.snapshotNow(), first)
				.filter((item) => item.pick?.kind === 'candidate')
				.map((item) => item.label);
			assert.deepStrictEqual(candidates, [
				'поставка (первая)',
				'учёт (первая)',
				'поставка (вторая)',
				'учёт (вторая)',
				`без-packagedef (${x})`,
				`без-packagedef (${y})`,
			]);

			const extraChoices = initializeChoices(local.folders, await local.source.listCandidates())
				.filter((choice) => !copy.roots.includes(choice.dir))
				.map((choice) => choice.label);
			assert.deepStrictEqual(extraChoices, ['поставка (первая)', 'учёт (первая)', 'поставка (вторая)', 'учёт (вторая)']);

			const list = await listProjectsResult(local.source, () => ({}));
			assert.deepStrictEqual(
				list.data.candidates.map((candidate) => candidate.name),
				candidates
			);
		} finally {
			provider.dispose();
			local.instance.dispose();
			copy.dispose();
		}
	});

	test('не проект с конфигурацией глубже места packagedef показывает её каталог', () => {
		const root = normalizeProjectRoot(path.join(path.sep, 'w', 'инструмент'));
		const candidate = (dir: string): ProjectCandidate => ({
			root,
			name: 'инструмент',
			folder: root,
			kind: 'folder',
			configuration: { dir: path.join(root, dir), format: 'designer', name: 'Проверка', isExtension: false },
		});

		assert.strictEqual(candidateDescription(candidate(path.join('test', 'fixtures', 'cf'))), 'test/fixtures/cf · Конфигуратор · Проверка');
		assert.strictEqual(candidateDescription(candidate(path.join('src', 'cf'))), 'Конфигуратор · Проверка');
	});

	test('с одним проектом описание вида пустое', async () => {
		const single = await detectedProjects([TWO_CONFIGURATIONS]);
		const view: { description?: string } = { description: 'было' };

		const binding = bindProjectDescription(view, single.source);

		assert.strictEqual(view.description, undefined);
		binding.dispose();
		single.instance.dispose();
	});
});
