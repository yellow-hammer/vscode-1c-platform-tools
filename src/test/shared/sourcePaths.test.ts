import * as assert from 'node:assert';
import * as path from 'node:path';
import { invalidateProjectLayout, setLayoutExclusions } from '../../shared/projectLayout';
import { detectedSourceDirs } from '../../shared/sourcePaths';

/** Рабочие области с исходным кодом в обоих форматах. */
const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');
const DESIGNER_WORKSPACE = path.join(FIXTURES, 'designer');
const EDT_WORKSPACE = path.join(FIXTURES, 'edt-workspace');

suite('каталоги для md-sparrow', () => {
	setup(() => {
		setLayoutExclusions(() => []);
		invalidateProjectLayout();
	});

	test('выгрузка конфигуратора: расширения и внешние объекты точными каталогами, тестовые вместе с остальными', async () => {
		const dirs = await detectedSourceDirs(DESIGNER_WORKSPACE);

		assert.strictEqual(dirs.cf, 'src/cf');
		assert.strictEqual(dirs.cfe, 'src/cfe');
		assert.deepStrictEqual(dirs.cfeDirs, ['src/cfe/МоёРасширение', 'src/cfe/подмодуль/src/cfe/Вложенное', 'tests/cfe/Тесты']);
		assert.deepStrictEqual(dirs.epfDirs, ['src/epf/ПечатьСчёта', 'tests/epf/Тесты_Арифметика']);
		assert.deepStrictEqual(dirs.erfDirs, ['src/erf/ОстаткиТоваров', 'src/erf/ОтчётПоОстаткам']);
	});

	test('проект EDT: конфигурация и расширения проектами, внешние объекты EDT не передаются', async () => {
		const dirs = await detectedSourceDirs(EDT_WORKSPACE);

		assert.strictEqual(dirs.cf, 'ssl31');
		assert.deepStrictEqual(dirs.cfeDirs, ['ssl31._ДемоРасширение', 'tests/cfe/yaxunit-test']);
		assert.deepStrictEqual(dirs.epfDirs, []);
		assert.deepStrictEqual(dirs.erfDirs, []);
	});
});
