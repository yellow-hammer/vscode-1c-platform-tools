import * as assert from 'node:assert';
import * as path from 'node:path';
import { inCurrentProject, inProjectOf, inProjectRoot, projectLabel, projectRelativePath } from '../../commands/projectScope';
import { currentRoot, normalizeProjectRoot, outsideProject, runWithProject } from '../../shared/workspaceProjects';

const FIXTURES = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'workspaceProjects');
const PROJECT = normalizeProjectRoot(path.join(FIXTURES, 'проект'));
const OTHER = normalizeProjectRoot(path.join(FIXTURES, 'две-конфигурации'));

suite('проект команды', () => {
	test('команда остаётся в проекте, с которым её вызвали', async () => {
		const handler = inCurrentProject(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1));
			return currentRoot();
		});

		const result = await runWithProject(PROJECT, () => handler());

		assert.strictEqual(result, PROJECT);
	});

	test('действие над файлом вне проектов идёт в текущем проекте', () => {
		const outside = path.parse(FIXTURES).root;
		assert.strictEqual(runWithProject(OTHER, () => inProjectOf(outside, () => currentRoot())), OTHER);
	});

	test('корень узла важнее проекта, из которого вызвали команду', () => {
		assert.strictEqual(
			runWithProject(OTHER, () => inProjectRoot(PROJECT, () => currentRoot())),
			PROJECT
		);
		assert.strictEqual(
			runWithProject(OTHER, () => inProjectRoot(undefined, () => currentRoot())),
			OTHER
		);
	});

	test('без файла действие идёт в текущем проекте', () => {
		assert.strictEqual(
			runWithProject(OTHER, () => inProjectOf(undefined, () => currentRoot())),
			OTHER
		);
		assert.strictEqual(outsideProject(() => inProjectOf(undefined, () => currentRoot())), currentRoot());
	});

	test('путь для команды считается от корня проекта', () => {
		assert.strictEqual(projectRelativePath(PROJECT, path.join(PROJECT, 'build', 'out', '1Cv8.cf')), 'build/out/1Cv8.cf');
		assert.strictEqual(projectRelativePath(PROJECT, PROJECT), '.');
		const outside = path.join(OTHER, 'build');
		assert.strictEqual(projectRelativePath(PROJECT, outside), outside);
	});

	test('имя каталога вне списка проектов берётся из пути', () => {
		assert.strictEqual(projectLabel(path.join(FIXTURES, 'не-проект')), 'не-проект');
	});
});
