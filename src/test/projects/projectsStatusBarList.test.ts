import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { InvocationSource } from '../../features/projects/constants';
import { normalizePath } from '../../features/projects/pathUtils';
import {
	openPickedProject,
	pickedFromItem,
	projectListItems,
	type ProjectListItem,
} from '../../features/projects/projectsPicker';
import { ProjectsStack } from '../../features/projects/stack';
import { currentProjectStatus } from '../../features/projects/statusBar';
import { ProjectStorage } from '../../features/projects/storage';
import { workspaceProjectItems } from '../../features/projects/workspaceProjectPicker';
import { createMockExtensionContext } from '../fixtures/mocks/vscodeMocks';
import { at, detectedProjects, NOT_PROJECT, PROJECT, resetLayout, TWO_CONFIGURATIONS, type ProjectsFixture } from './workspaceProjectsFixture';

const RETAIL = at('розница');
const PACKAGE_MANAGER = at('розница', 'src', 'cfe', 'менеджер-пакетов');
const METRICS = at('розница', 'src', 'cfe', 'метрики');
const EXPORT = at('розница', 'src', 'cfe', 'метрики', 'src', 'cfe', 'экспорт');

const stack = (): ProjectsStack => new ProjectsStack(() => undefined, async () => undefined);

/** Выполняет `run`, записывая вызовы команд вместо их выполнения. */
async function recordingCommands(run: (calls: unknown[][]) => Promise<void>): Promise<void> {
	const original = Object.getOwnPropertyDescriptor(vscode.commands, 'executeCommand');
	const calls: unknown[][] = [];
	Object.defineProperty(vscode.commands, 'executeCommand', {
		value: async (...args: unknown[]) => {
			calls.push(args);
			return undefined;
		},
		configurable: true,
		writable: true,
	});
	try {
		await run(calls);
	} finally {
		if (original) {
			Object.defineProperty(vscode.commands, 'executeCommand', original);
		}
	}
}

suite('проекты: строка состояния и список проектов', () => {
	let fixture: ProjectsFixture;

	setup(async () => {
		resetLayout();
		fixture = await detectedProjects([RETAIL, TWO_CONFIGURATIONS]);
	});

	teardown(() => {
		fixture.instance.dispose();
	});

	const list = (): ProjectListItem[] =>
		projectListItems(
			workspaceProjectItems(fixture.source.snapshotNow(), fixture.source.selectedRoot(), false),
			[
				{ label: 'основной', description: PROJECT },
				{ label: 'Метрики', description: METRICS },
			],
			[
				{ label: 'две-конфигурации', description: TWO_CONFIGURATIONS },
				{ label: 'без-packagedef', description: NOT_PROJECT },
			]
		);

	test('строка состояния: имя из избранного с тем же корнем, иначе имя проекта, в подсказке путь', async () => {
		await fixture.source.selectProject(METRICS);
		const projects = fixture.source.snapshotNow().projects;
		const metrics = projects.find((project) => project.root === METRICS);
		assert.ok(metrics);
		const storage = new ProjectStorage(path.join(os.tmpdir(), 'projects-status-bar.json'));
		storage.add('Розница', RETAIL);

		assert.deepStrictEqual(currentProjectStatus(metrics, storage, projects), { text: '$(folder) метрики', tooltip: METRICS });

		storage.add('Метрики', process.platform === 'win32' ? METRICS.toUpperCase() : METRICS);
		assert.deepStrictEqual(currentProjectStatus(metrics, storage, projects), { text: '$(folder) Метрики', tooltip: METRICS });

		storage.rename('Метрики', 'Сбор метрик');
		assert.strictEqual(currentProjectStatus(metrics, storage, projects).text, '$(folder) Сбор метрик');
	});

	test('список: проекты окна по корневым проектам с отметкой текущего, затем избранное и все проекты без проектов окна', () => {
		assert.deepStrictEqual(
			list().map((item) => [
				item.label,
				item.description,
				(item.iconPath as vscode.ThemeIcon | undefined)?.id,
				item.kind,
				item.inWindow,
				item.path,
			]),
			[
				['Рабочая область', undefined, undefined, vscode.QuickPickItemKind.Separator, undefined, ''],
				['розница', 'текущий · 1C:Конфигуратор · Розница', 'check', undefined, true, RETAIL],
				['менеджер-пакетов', 'src/cfe/менеджер-пакетов · 1C:Конфигуратор · БазаМенеджераПакетов', 'file-submodule', undefined, true, PACKAGE_MANAGER],
				['метрики', 'src/cfe/метрики · 1C:Конфигуратор · БазаМетрик', 'file-submodule', undefined, true, METRICS],
				['экспорт', 'src/cfe/метрики/src/cfe/экспорт · 1C:Конфигуратор · БазаЭкспорта', 'file-submodule', undefined, true, EXPORT],
				['две-конфигурации', '1C:Конфигуратор · Первая', 'repo', undefined, true, TWO_CONFIGURATIONS],
				['Избранное', undefined, undefined, vscode.QuickPickItemKind.Separator, undefined, ''],
				['основной', PROJECT, undefined, undefined, undefined, PROJECT],
				['Все проекты', undefined, undefined, vscode.QuickPickItemKind.Separator, undefined, ''],
				['без-packagedef', NOT_PROJECT, undefined, undefined, undefined, NOT_PROJECT],
			]
		);
	});

	test('без проектов в окне список начинается с избранного', () => {
		assert.deepStrictEqual(
			projectListItems([], [], []).map((item) => item.label),
			['Избранное', 'Все проекты']
		);
	});

	test('проект окна из списка становится текущим и папку не открывает', async () => {
		const item = list().find((entry) => entry.inWindow && entry.path === METRICS);
		assert.ok(item);
		const picked = pickedFromItem(item, false, undefined);
		assert.deepStrictEqual(picked, { item: { name: 'метрики', rootPath: METRICS }, openInNewWindow: false, inWindow: true });

		await recordingCommands(async (calls) => {
			await openPickedProject(picked, true, InvocationSource.Palette, stack(), createMockExtensionContext(), fixture.source);
			assert.deepStrictEqual(calls.filter(([command]) => command === 'vscode.openFolder'), []);
		});
		assert.strictEqual(fixture.source.selectedRoot(), METRICS);
	});

	test('проект из избранного и всех проектов открывается папкой, кнопка открывает в новом окне', async () => {
		const favorite = list().find((entry) => !entry.inWindow && entry.path === PROJECT);
		assert.ok(favorite);
		const picked = pickedFromItem(favorite, false, undefined);
		const pickedNew = pickedFromItem(favorite, true, undefined);
		assert.deepStrictEqual(picked, { item: { name: 'основной', rootPath: normalizePath(PROJECT) }, openInNewWindow: false });

		await recordingCommands(async (calls) => {
			await openPickedProject(picked, false, InvocationSource.Palette, stack(), createMockExtensionContext(), fixture.source);
			await openPickedProject(pickedNew, false, InvocationSource.Palette, stack(), createMockExtensionContext(), fixture.source);
			assert.deepStrictEqual(
				calls
					.filter(([command]) => command === 'vscode.openFolder')
					.map(([, uri, options]) => [(uri as vscode.Uri).fsPath, options]),
				[
					[vscode.Uri.file(normalizePath(PROJECT)).fsPath, { forceNewWindow: false }],
					[vscode.Uri.file(normalizePath(PROJECT)).fsPath, { forceNewWindow: true }],
				]
			);
		});
		assert.strictEqual(fixture.source.selectedRoot(), RETAIL);
	});
});
