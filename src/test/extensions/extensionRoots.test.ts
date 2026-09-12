import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	cfeFileEntries,
	extensionContaining,
	extensionEntries,
	newExtensionDir,
} from '../../features/extensions/extensionRoots';
import { findExtension, selectionKey } from '../../features/extensions/extensionSelection';
import { invalidateProjectLayout, setLayoutExclusions } from '../../shared/projectLayout';
import { projectPaths, type ProjectPaths } from '../../shared/projectPaths';

/** Рабочие области с исходным кодом в обоих форматах. */
const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');
const DESIGNER_WORKSPACE = path.join(FIXTURES, 'designer');
const EDT_WORKSPACE = path.join(FIXTURES, 'edt-workspace');

suite('расширения раскладки', () => {
	setup(() => {
		setLayoutExclusions(() => []);
		invalidateProjectLayout();
	});

	test('проекты EDT: каталог проекта, имя каталога и имя из метаданных', async () => {
		const paths = await projectPaths(EDT_WORKSPACE);

		assert.deepStrictEqual(extensionEntries(paths, 'solution'), [
			{ dir: 'ssl31._ДемоРасширение', folder: 'ssl31._ДемоРасширение', name: '_ДемоРасширение', format: 'edt' },
		]);
		assert.deepStrictEqual(extensionEntries(paths, 'tests'), [
			{ dir: 'tests/cfe/yaxunit-test', folder: 'yaxunit-test', name: 'Тесты', format: 'edt' },
		]);
		// Установка версии предлагает и решение, и тестовые
		assert.deepStrictEqual(
			extensionEntries(paths, 'all').map((entry) => entry.folder),
			['ssl31._ДемоРасширение', 'yaxunit-test']
		);
		assert.deepStrictEqual(extensionEntries(undefined, 'all'), []);
	});

	test('выгрузка конфигуратора: вложенное расширение зовётся по своему каталогу', async () => {
		const paths = await projectPaths(DESIGNER_WORKSPACE);

		assert.deepStrictEqual(extensionEntries(paths, 'solution'), [
			{ dir: 'src/cfe/МоёРасширение', folder: 'МоёРасширение', name: 'Расширение', format: 'designer' },
			{ dir: 'src/cfe/подмодуль/src/cfe/Вложенное', folder: 'Вложенное', name: 'Вложенное', format: 'designer' },
		]);
		assert.deepStrictEqual(extensionEntries(paths, 'tests'), [
			{ dir: 'tests/cfe/Тесты', folder: 'Тесты', name: 'Тесты', format: 'designer' },
		]);
	});

	test('одно расширение под любым из имён: каталог, путь, имя из метаданных', async () => {
		const entries = extensionEntries(await projectPaths(EDT_WORKSPACE), 'all');
		const tests = entries[1];

		assert.strictEqual(findExtension(entries, 'yaxunit-test'), tests);
		assert.strictEqual(findExtension(entries, 'Тесты'), tests);
		assert.strictEqual(findExtension(entries, 'tests/cfe/yaxunit-test'), tests);
		assert.strictEqual(findExtension(entries, 'TESTS\\CFE\\YAXUNIT-TEST'), tests);
		assert.strictEqual(findExtension(entries, '_ДемоРасширение'), entries[0]);
		assert.strictEqual(findExtension(entries, 'ssl31._ДемоРасширение'), entries[0]);
		// В окне выбора ключом служит имя каталога
		assert.deepStrictEqual(entries.map((entry) => selectionKey(entry, entries)), ['ssl31._ДемоРасширение', 'yaxunit-test']);
	});

	test('файл *.cfe приводится к расширению по имени каталога или из метаданных', async () => {
		const roots = extensionEntries(await projectPaths(EDT_WORKSPACE), 'solution');
		const entries = cfeFileEntries(['ssl31._ДемоРасширение.cfe', '_ДемоРасширение.cfe', 'YAxUnit.cfe', 'YAxUnit.cfe'], roots);

		assert.deepStrictEqual(
			entries.map((entry) => [entry.folder, entry.name, entry.dir, entry.root?.dir]),
			[
				['ssl31._ДемоРасширение', '_ДемоРасширение', 'ssl31._ДемоРасширение', 'ssl31._ДемоРасширение'],
				['_ДемоРасширение', '_ДемоРасширение', 'ssl31._ДемоРасширение', 'ssl31._ДемоРасширение'],
				['YAxUnit', 'YAxUnit', undefined, undefined],
			]
		);
	});

	test('путь внутри расширения ведёт к нему: сборке нужен каталог проекта, а не его src', async () => {
		const entries = extensionEntries(await projectPaths(EDT_WORKSPACE), 'all');
		const project = path.join(EDT_WORKSPACE, 'ssl31._ДемоРасширение');

		assert.strictEqual(extensionContaining(entries, EDT_WORKSPACE, path.join(project, 'src'))?.dir, 'ssl31._ДемоРасширение');
		assert.strictEqual(extensionContaining(entries, EDT_WORKSPACE, project)?.folder, 'ssl31._ДемоРасширение');
		assert.strictEqual(extensionContaining(entries, EDT_WORKSPACE, path.join(EDT_WORKSPACE, 'tests', 'cfe', 'yaxunit-test', 'src'))?.name, 'Тесты');
		assert.strictEqual(extensionContaining(entries, EDT_WORKSPACE, path.join(EDT_WORKSPACE, 'ssl31', 'src')), undefined);
	});

	test('новое расширение: проект EDT рядом с конфигурацией, выгрузка в общий каталог, тестовое под tests', async () => {
		const edt = await projectPaths(EDT_WORKSPACE);
		assert.strictEqual(newExtensionDir(edt, 'Новое', 'solution'), 'ssl31.Новое');
		assert.strictEqual(newExtensionDir(edt, 'Новое', 'tests'), 'tests/cfe/Новое');

		const designer = await projectPaths(DESIGNER_WORKSPACE);
		assert.strictEqual(newExtensionDir(designer, 'Новое', 'solution'), 'src/cfe/Новое');
		assert.strictEqual(newExtensionDir(designer, 'Новое', 'tests'), 'tests/cfe/Новое');

		// Без раскладки привычные места
		assert.strictEqual(newExtensionDir(undefined, 'Новое', 'solution'), 'src/cfe/Новое');

		// Проект конфигурации EDT открыт как рабочая область: рядом с ним места нет
		const rootProject: ProjectPaths = {
			configuration: { name: 'Конфигурация', dir: '.', format: 'edt' },
			extensions: [],
			testExtensions: [],
			processors: [],
			reports: [],
			testProcessors: [],
		};
		assert.strictEqual(newExtensionDir(rootProject, 'Новое', 'solution'), undefined);
		assert.strictEqual(newExtensionDir(rootProject, 'Новое', 'tests'), 'tests/cfe/Новое');
	});
});
