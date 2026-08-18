import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { markerIn, resolveProjectLayout } from '../../shared/projectLayout';

/** Рабочие области с исходным кодом в форматах EDT и конфигуратора. */
const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');
const EDT_WORKSPACE = path.join(FIXTURES, 'edt-workspace');
const DESIGNER_WORKSPACE = path.join(FIXTURES, 'designer');

/** Настройки путей проекта по умолчанию. */
const DEFAULT_PATHS = { configuration: 'src/cf', extensions: ['src/cfe'] };

suite('раскладка проекта', () => {
	test('маркер отличает формат конфигуратора от формата EDT', () => {
		assert.strictEqual(markerIn(path.join(DESIGNER_WORKSPACE, 'src/cf'))?.format, 'designer');
		assert.strictEqual(markerIn(path.join(EDT_WORKSPACE, 'ssl31'))?.format, 'edt');
		assert.strictEqual(markerIn(EDT_WORKSPACE), undefined);
	});

	test('настройки путей главнее автоопределения', async () => {
		const layout = await resolveProjectLayout(DESIGNER_WORKSPACE, DEFAULT_PATHS);

		assert.strictEqual(layout.configuration?.dir, path.join(DESIGNER_WORKSPACE, 'src', 'cf'));
		assert.strictEqual(layout.configuration?.format, 'designer');
		assert.strictEqual(layout.configuration?.name, 'Конфигурация');
		assert.deepStrictEqual(
			layout.extensions.map((extension) => extension.name),
			['Расширение']
		);
	});

	test('без исходного кода по настройкам раскладка определяется обходом', async () => {
		const layout = await resolveProjectLayout(EDT_WORKSPACE, DEFAULT_PATHS);

		assert.strictEqual(layout.configuration?.format, 'edt');
		assert.strictEqual(layout.configuration?.name, 'БиблиотекаСтандартныхПодсистемДемо');
		assert.strictEqual(layout.configuration?.dir, path.join(EDT_WORKSPACE, 'ssl31'));
	});

	test('расширение EDT берёт имя из метаданных, а не из имени каталога', async () => {
		const layout = await resolveProjectLayout(EDT_WORKSPACE, DEFAULT_PATHS);

		assert.deepStrictEqual(
			layout.extensions.map((extension) => extension.name),
			['_ДемоРасширение']
		);
		assert.strictEqual(
			layout.extensions[0].dir,
			path.join(EDT_WORKSPACE, 'ssl31._ДемоРасширение')
		);
	});

	test('проект EDT с внешними обработками попадает в раскладку', async () => {
		const layout = await resolveProjectLayout(EDT_WORKSPACE, DEFAULT_PATHS);

		assert.deepStrictEqual(layout.externals, [path.join(EDT_WORKSPACE, 'dp')]);
	});

	test('без исходного кода раскладка пустая', async () => {
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), '1cpt-layout-empty-'));

		const layout = await resolveProjectLayout(empty, DEFAULT_PATHS);

		assert.strictEqual(layout.configuration, undefined);
		assert.deepStrictEqual(layout.extensions, []);
		assert.deepStrictEqual(layout.externals, []);
	});
});
