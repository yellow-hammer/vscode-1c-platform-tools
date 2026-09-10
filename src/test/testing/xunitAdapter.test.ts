import * as assert from 'node:assert';
import * as path from 'node:path';
import { epfTestSourceInfo, XUnitAdapter } from '../../features/testing/adapters/xunitAdapter';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { DEFAULT_PATHS, TESTS_SUBDIRS, testsSubPath } from '../../shared/pathDefaults';

suite('xunitAdapter', () => {
	test('epfTestSourceInfo: стандартная структура decompileepf', () => {
		const info = epfTestSourceInfo(
			'C:\\proj\\src\\tests\\Тесты_Сложение\\Тесты_Сложение\\Ext\\ObjectModule.bsl'
		);
		assert.ok(info);
		assert.strictEqual(info.processorName, 'Тесты_Сложение');
		assert.strictEqual(
			info.processorDir,
			path.join('C:', 'proj', 'src', 'tests', 'Тесты_Сложение')
		);
	});

	test('epfTestSourceInfo: обработка в подкаталоге-группе', () => {
		const info = epfTestSourceInfo(
			'C:/proj/tests/epf/Core/Тест_Плагины/Тест_Плагины/Ext/ObjectModule.bsl'
		);
		assert.ok(info);
		assert.strictEqual(info.processorName, 'Тест_Плагины');
		assert.ok(info.processorDir.endsWith(path.join('Core', 'Тест_Плагины')));
	});

	test('epfTestSourceInfo: без дублирующего каталога — берётся внутренний', () => {
		const info = epfTestSourceInfo('C:/proj/tests/epf/Тест_Один/Ext/ObjectModule.bsl');
		assert.ok(info);
		assert.strictEqual(info.processorName, 'Тест_Один');
		assert.ok(info.processorDir.endsWith('Тест_Один'));
	});

	test('поиск обработок идёт по корню тестов', () => {
		const adapter = new XUnitAdapter(VRunnerManager.getInstance());

		const globs = adapter.getIncludeGlobs();

		// Панель ищет исходники там же, куда смотрят команды сборки, иначе ветка
		// xUnit опустеет
		const expected = testsSubPath(DEFAULT_PATHS.tests, TESTS_SUBDIRS.epf);
		assert.strictEqual(expected, 'tests/epf');
		assert.deepStrictEqual(globs, [
			`${expected}/**/Ext/ObjectModule.bsl`,
			`${expected}/**/src/ExternalDataProcessors/*/ObjectModule.bsl`,
		]);
	});

	test('epfTestSourceInfo: не ObjectModule.bsl — undefined', () => {
		assert.strictEqual(epfTestSourceInfo('C:/proj/tests/Тест.os'), undefined);
		assert.strictEqual(
			epfTestSourceInfo('C:/proj/tests/epf/Тест/Forms/Форма/Ext/Form/Module.bsl'),
			undefined
		);
		assert.strictEqual(epfTestSourceInfo('C:/proj/ObjectModule.bsl'), undefined);
	});
});

suite('поиск тестов в раскладке EDT', () => {
	test('xUnit ищет тестовые обработки и в проекте EDT', () => {
		const adapter = new XUnitAdapter(VRunnerManager.getInstance());

		const globs = adapter.getIncludeGlobs();

		assert.ok(
			globs.some((glob) => glob.endsWith('/src/ExternalDataProcessors/*/ObjectModule.bsl')),
			`в раскладке EDT обработки лежат иначе: ${globs.join(', ')}`
		);
	});
});
