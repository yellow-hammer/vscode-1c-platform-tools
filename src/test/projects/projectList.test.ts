import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { sameProjectRoot } from '../../shared/workspaceProjects';
import { listProjectsResult, selectProjectByRoot } from '../../features/projects/projectList';
import { rootArgument } from '../../features/projects/workspaceProjectCommands';
import {
	ACCOUNTING,
	DELIVERY,
	detectedProjects,
	NOT_PROJECT,
	PROJECT,
	resetLayout,
	SUB_PROJECT,
	TWO_CONFIGURATIONS,
	type ProjectsFixture,
} from './workspaceProjectsFixture';

/** На Windows то же написание другим регистром. */
const otherCase = (root: string) => (process.platform === 'win32' ? root.toUpperCase() : root);

suite('проекты: список и выбор текущего проекта', () => {
	let fixture: ProjectsFixture;

	setup(async () => {
		resetLayout();
		fixture = await detectedProjects([PROJECT, NOT_PROJECT, TWO_CONFIGURATIONS]);
	});

	teardown(() => {
		fixture.instance.dispose();
	});

	test('список: текущий корень, проекты с видом, форматом и конфигурацией, не проекты с видом', async () => {
		const result = await listProjectsResult(fixture.source, (root) => (sameProjectRoot(root, PROJECT) ? { profile: 'dev', environment: 'ci' } : {}));

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.stdout, '');
		assert.deepStrictEqual(result.data, {
			current: PROJECT,
			projects: [
				{ root: PROJECT, name: 'проект', subProject: false, kind: 'designer', format: 'designer', configuration: 'Основная', current: true, profile: 'dev', environment: 'ci' },
				{ root: SUB_PROJECT, name: 'подпроект', parent: PROJECT, subProject: true, kind: 'designer', format: 'designer', configuration: 'Подпроект', current: false },
				{ root: TWO_CONFIGURATIONS, name: 'две-конфигурации', subProject: false, kind: 'designer', format: 'designer', configuration: 'Первая', current: false },
			],
			candidates: [
				{ root: NOT_PROJECT, name: 'без-packagedef', kind: 'folder' },
				{ root: DELIVERY, name: 'поставка', parent: TWO_CONFIGURATIONS, kind: 'extraConfiguration' },
				{ root: ACCOUNTING, name: 'учёт', parent: TWO_CONFIGURATIONS, kind: 'extraConfiguration' },
			],
		});
	});

	test('выбор по корню делает проект текущим и возвращает корень', async () => {
		const result = await selectProjectByRoot(fixture.source, otherCase(SUB_PROJECT));

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.data.current, SUB_PROJECT);
		assert.strictEqual(fixture.instance.currentRoot(), SUB_PROJECT);
		assert.deepStrictEqual(result.data.projects, [PROJECT, SUB_PROJECT, TWO_CONFIGURATIONS]);
	});

	test('неизвестный корень: отказ со списком проектов, выбор не меняется', async () => {
		const result = await selectProjectByRoot(fixture.source, NOT_PROJECT);

		assert.strictEqual(result.success, false);
		assert.strictEqual(result.exitCode, 1);
		assert.ok(result.stderr.startsWith(`Проект не найден: ${NOT_PROJECT}.`), result.stderr);
		assert.ok(result.stderr.includes(`проект: ${PROJECT}`), result.stderr);
		assert.ok(result.stderr.includes(`две-конфигурации: ${TWO_CONFIGURATIONS}`), result.stderr);
		assert.strictEqual(result.data.current, PROJECT);
		assert.strictEqual(fixture.instance.currentRoot(), PROJECT);
	});

	test('корень из аргумента команды: строка, объект с root, файловый Uri', () => {
		assert.strictEqual(rootArgument(` ${PROJECT} `), PROJECT);
		assert.strictEqual(rootArgument({ root: PROJECT, wait: true }), PROJECT);
		assert.strictEqual(rootArgument(vscode.Uri.file(PROJECT))?.toLowerCase(), PROJECT.toLowerCase());
		assert.strictEqual(rootArgument({ wait: true }), undefined);
		assert.strictEqual(rootArgument(undefined), undefined);
	});
});
