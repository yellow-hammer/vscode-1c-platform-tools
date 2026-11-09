import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createVRunnerTask, taskProjectRoot, TaskOutputChain } from '../../features/tasks/vrunnerTask';
import { buildPipelineTask } from '../../features/pipelines/pipelineTaskProvider';
import { currentRoot, workspaceFolderOf } from '../../shared/workspaceProjects';
import { createMockWorkspaceFolder } from '../fixtures/mocks/vscodeMocks';

const FIXTURES = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'workspaceProjects');
const PROJECT = path.join(FIXTURES, 'проект');

suite('вывод задач одной команды', () => {
	test('первая задача цепочки очищает терминал, остальные дописывают', () => {
		const chain = new TaskOutputChain();

		assert.strictEqual(chain.append(), false);
		assert.strictEqual(chain.append(), true);
		assert.strictEqual(chain.append(), true);
	});

	test('одиночная задача очищает терминал, задача цепочки сохраняет вывод предыдущей', () => {
		const single = createVRunnerTask({ name: 'Сборка', command: 'vrunner compile', cwd: '.' });
		const chained = createVRunnerTask({ name: 'Сборка', command: 'vrunner compile', cwd: '.', appendOutput: true });

		assert.strictEqual(single.presentationOptions.clear, true);
		assert.strictEqual(single.presentationOptions.echo, false);
		assert.strictEqual(chained.presentationOptions.clear, false);
	});
});

suite('задачи в проекте', () => {
	test('задача vrunner помнит корень проекта и лежит в его папке рабочей области', () => {
		const task = createVRunnerTask({ name: 'Сборка', command: 'vrunner compile', cwd: PROJECT, root: PROJECT });

		assert.strictEqual(task.definition.project, PROJECT);
		assert.strictEqual(task.scope, workspaceFolderOf(PROJECT) ?? vscode.TaskScope.Workspace);
	});

	test('задача пайплайна помнит корень проекта, определение из tasks.json не меняется', () => {
		const provided = buildPipelineTask(PROJECT, 'p-build', 'Сборка');
		assert.deepStrictEqual(provided.definition, { type: '1c-pipeline', pipeline: 'p-build', project: PROJECT });

		const fromFile = { type: '1c-pipeline' as const, pipeline: 'p-build' };
		assert.strictEqual(buildPipelineTask(PROJECT, 'p-build', 'Сборка', undefined, fromFile).definition, fromFile);
	});

	test('project из tasks.json берётся от папки задачи', () => {
		const folder = createMockWorkspaceFolder(FIXTURES);

		assert.strictEqual(taskProjectRoot(folder, 'проект'), PROJECT);
		assert.strictEqual(taskProjectRoot(folder, PROJECT), PROJECT);
		assert.strictEqual(taskProjectRoot(vscode.TaskScope.Workspace, PROJECT), PROJECT);
	});

	test('без project задача без папки идёт в текущем проекте', () => {
		assert.strictEqual(taskProjectRoot(vscode.TaskScope.Workspace, undefined), currentRoot());
		assert.strictEqual(taskProjectRoot(undefined, ''), currentRoot());
	});

	test('без project задача папки вне текущего проекта идёт в своей папке', () => {
		const outside = path.parse(FIXTURES).root;
		const folder = createMockWorkspaceFolder(path.join(outside, 'папка-задачи'));

		assert.strictEqual(taskProjectRoot(folder, undefined), folder.uri.fsPath);
	});
});
