import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { markerIn, resolveProjectLayout } from '../../shared/projectLayout';
import { activeConfiguration, describeConfiguration } from '../../shared/activeConfiguration';

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

suite('выбор активной конфигурации', () => {
	test('сохранённый выбор применяется, пока конфигурация есть в рабочей области', () => {
		const first = { dir: 'C:/ws/ssl31', format: 'edt' as const, name: 'Первая', isExtension: false };
		const second = { dir: 'C:/ws/other', format: 'designer' as const, name: 'Вторая', isExtension: false };
		const memento = {
			get: <T>() => 'C:/ws/other' as unknown as T,
			update: async () => undefined,
			keys: () => [],
		} as unknown as vscode.Memento;

		assert.strictEqual(activeConfiguration(memento, [first, second]), second);
	});

	test('без сохранённого выбора берётся первая найденная', () => {
		const first = { dir: 'C:/ws/ssl31', format: 'edt' as const, name: 'Первая', isExtension: false };
		const memento = {
			get: <T>() => undefined as unknown as T,
			update: async () => undefined,
			keys: () => [],
		} as unknown as vscode.Memento;

		assert.strictEqual(activeConfiguration(memento, [first]), first);
		assert.strictEqual(activeConfiguration(memento, []), undefined);
	});

	test('подпись показывает имя и формат исходного кода', () => {
		assert.strictEqual(
			describeConfiguration({ dir: 'C:/ws/ssl31', format: 'edt', name: 'Демо', isExtension: false }),
			'Демо (EDT)'
		);
		assert.strictEqual(
			describeConfiguration({ dir: 'C:/ws/src/cf', format: 'designer', name: '', isExtension: false }),
			'C:/ws/src/cf (конфигуратор)'
		);
	});
});
