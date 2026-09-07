import * as assert from 'node:assert';
import * as path from 'node:path';
import { invalidateProjectLayout, setLayoutExclusions } from '../../shared/projectLayout';
import { projectPaths } from '../../shared/projectPaths';

/** Рабочие области с исходным кодом в обоих форматах. */
const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');
const DESIGNER_WORKSPACE = path.join(FIXTURES, 'designer');
const EDT_WORKSPACE = path.join(FIXTURES, 'edt-workspace');

suite('пути раскладки', () => {
	setup(() => {
		setLayoutExclusions(() => []);
		invalidateProjectLayout();
	});

	test('выгрузка конфигуратора: общий каталог у расширений и у внешних объектов', async () => {
		const paths = await projectPaths(DESIGNER_WORKSPACE);

		assert.strictEqual(paths.extensionsContainer, 'src/cfe');
		assert.strictEqual(paths.testExtensionsContainer, 'tests/cfe');
		assert.strictEqual(paths.processorsContainer, 'src/epf');
		assert.strictEqual(paths.reportsContainer, 'src/erf');
		assert.strictEqual(paths.testProcessorsContainer, 'tests/epf');
	});

	test('проект EDT: у внешних объектов каталог проектов, у расширений базой остаётся рабочая область', async () => {
		const paths = await projectPaths(EDT_WORKSPACE);

		assert.strictEqual(paths.testProcessorsContainer, 'tests/epf');
		assert.strictEqual(paths.extensionsContainer, undefined);
		assert.strictEqual(paths.testExtensionsContainer, undefined);
	});
});
