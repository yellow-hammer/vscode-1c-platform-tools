import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { invalidateProjectLayout, markerIn, resolveProjectLayout } from '../../shared/projectLayout';

/** Рабочие области с исходным кодом в форматах EDT и конфигуратора. */
const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');
const EDT_WORKSPACE = path.join(FIXTURES, 'edt-workspace');
const DESIGNER_WORKSPACE = path.join(FIXTURES, 'designer');

/** Настройки путей проекта по умолчанию. */
const DEFAULT_PATHS = { configuration: 'src/cf', extensions: ['src/cfe'] };

suite('раскладка проекта', () => {
	setup(() => {
		invalidateProjectLayout();
	});

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

		// Раскладка отдаёт все расширения рабочей области; по конфигурациям их
		// раскладывает выбор активной конфигурации.
		assert.deepStrictEqual(
			layout.extensions.map((extension) => extension.name),
			['_ДемоРасширение', 'РасширениеУчёта']
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

	test('раскладка определяется и без настроек путей', async () => {
		const edt = await resolveProjectLayout(EDT_WORKSPACE);
		const designer = await resolveProjectLayout(DESIGNER_WORKSPACE);

		assert.strictEqual(edt.configuration?.format, 'edt');
		assert.strictEqual(edt.configuration?.dir, path.join(EDT_WORKSPACE, 'ssl31'));
		assert.strictEqual(designer.configuration?.format, 'designer');
		assert.strictEqual(designer.configuration?.dir, path.join(DESIGNER_WORKSPACE, 'src', 'cf'));
	});

	test('повторный вызов отдаёт разобранную раскладку', async () => {
		const first = await resolveProjectLayout(EDT_WORKSPACE, DEFAULT_PATHS);
		const second = await resolveProjectLayout(EDT_WORKSPACE, DEFAULT_PATHS);

		assert.strictEqual(first, second);
	});

	test('после сброса раскладка читается заново', async () => {
		const first = await resolveProjectLayout(EDT_WORKSPACE, DEFAULT_PATHS);
		invalidateProjectLayout(EDT_WORKSPACE);
		const second = await resolveProjectLayout(EDT_WORKSPACE, DEFAULT_PATHS);

		assert.notStrictEqual(first, second);
		assert.deepStrictEqual(first, second);
	});

	test('другие настройки путей читаются заново', async () => {
		const byDefault = await resolveProjectLayout(DESIGNER_WORKSPACE, DEFAULT_PATHS);
		const byOther = await resolveProjectLayout(DESIGNER_WORKSPACE, { configuration: '', extensions: [] });

		assert.notStrictEqual(byDefault, byOther);
		assert.strictEqual(byOther.configuration?.dir, path.join(DESIGNER_WORKSPACE, 'src', 'cf'));
	});

	test('без исходного кода раскладка пустая', async () => {
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), '1cpt-layout-empty-'));

		const layout = await resolveProjectLayout(empty, DEFAULT_PATHS);

		assert.strictEqual(layout.configuration, undefined);
		assert.deepStrictEqual(layout.extensions, []);
		assert.deepStrictEqual(layout.externals, []);
	});
});
