import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { pickExtensions } from '../../features/extensions/extensionPicker';
import {
	cfeStem,
	getStoredExtensionSelection,
	setStoredExtensionSelection,
	filterExtensionsBySelection,
	filterCfeFilesBySelection,
	findExtension,
	matchesExtension,
	normalizeConfiguredExtensions,
	selectionKey,
	type ExtensionNames
} from '../../features/extensions/extensionSelection';

/** Минимальная подмена vscode.Memento для тестов хранения. */
class FakeMemento implements vscode.Memento {
	private readonly store = new Map<string, unknown>();
	keys(): readonly string[] {
		return [...this.store.keys()];
	}
	get<T>(key: string, defaultValue?: T): T | undefined {
		return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
	}
	async update(key: string, value: unknown): Promise<void> {
		if (value === undefined) {
			this.store.delete(key);
		} else {
			this.store.set(key, value);
		}
	}
}

/** Расширение выгрузки конфигуратора: каталог и имя из метаданных совпадают. */
const plain = (folder: string, dir = `src/cfe/${folder}`): ExtensionNames => ({ folder, name: folder, dir });

/** Расширения рабочей области EDT: проект назван по конфигурации, тестовое лежит под tests. */
const DEMO: ExtensionNames = { folder: 'ssl31._ДемоРасширение', name: '_ДемоРасширение', dir: 'ssl31._ДемоРасширение' };
const TESTS: ExtensionNames = { folder: 'yaxunit-test', name: 'Тесты', dir: 'tests/cfe/yaxunit-test' };

suite('extensionSelection', () => {
	test('matchesExtension: подходит имя каталога, путь к нему и имя из метаданных, регистр не важен', () => {
		assert.strictEqual(matchesExtension(TESTS, 'yaxunit-test'), true);
		assert.strictEqual(matchesExtension(TESTS, 'YAXUNIT-TEST'), true);
		assert.strictEqual(matchesExtension(TESTS, 'Тесты'), true);
		assert.strictEqual(matchesExtension(TESTS, 'тесты'), true);
		assert.strictEqual(matchesExtension(TESTS, 'tests/cfe/yaxunit-test'), true);
		assert.strictEqual(matchesExtension(TESTS, 'tests\\cfe\\yaxunit-test\\'), true);
		assert.strictEqual(matchesExtension(TESTS, ' yaxunit-test '), true);
		assert.strictEqual(matchesExtension(TESTS, 'yaxunit'), false);
		assert.strictEqual(matchesExtension(TESTS, ''), false);
	});

	test('matchesExtension: расширение без каталога находится по имени', () => {
		const fromInfobase: ExtensionNames = { folder: 'Зарплата', name: 'Зарплата' };
		assert.strictEqual(matchesExtension(fromInfobase, 'зарплата'), true);
		assert.strictEqual(matchesExtension(fromInfobase, 'src/cfe/Зарплата'), false);
	});

	test('findExtension: первое подходящее', () => {
		assert.strictEqual(findExtension([DEMO, TESTS], '_ДемоРасширение'), DEMO);
		assert.strictEqual(findExtension([DEMO, TESTS], 'tests/cfe/yaxunit-test'), TESTS);
		assert.strictEqual(findExtension([DEMO, TESTS], 'Нет'), undefined);
	});

	test('selectionKey: имя каталога, а у одноимённых каталогов путь', () => {
		assert.strictEqual(selectionKey(DEMO, [DEMO, TESTS]), 'ssl31._ДемоРасширение');
		assert.strictEqual(selectionKey(TESTS, [DEMO, TESTS]), 'yaxunit-test');
		const twins = [plain('Тесты'), plain('Тесты', 'tests/cfe/Тесты')];
		assert.strictEqual(selectionKey(twins[0], twins), 'src/cfe/Тесты');
		assert.strictEqual(selectionKey(twins[1], twins), 'tests/cfe/Тесты');
	});

	test('filterExtensionsBySelection: без выбора — все расширения', () => {
		const available = [plain('ext_a'), plain('ext_b'), plain('ext_c')];
		assert.deepStrictEqual(filterExtensionsBySelection(available, undefined), available);
	});

	test('filterExtensionsBySelection: оставляет только выбранные, сохраняя порядок', () => {
		const available = [plain('ext_a'), plain('ext_b'), plain('ext_c')];
		assert.deepStrictEqual(filterExtensionsBySelection(available, ['ext_c', 'ext_a']), [available[0], available[2]]);
	});

	test('filterExtensionsBySelection: новые каталоги в подмножество не попадают', () => {
		const available = [plain('ext_a'), plain('ext_b'), plain('ext_new')];
		assert.deepStrictEqual(filterExtensionsBySelection(available, ['ext_a', 'ext_b']), [available[0], available[1]]);
	});

	test('filterExtensionsBySelection: пустой выбор — пустой результат', () => {
		assert.deepStrictEqual(filterExtensionsBySelection([plain('ext_a')], []), []);
	});

	test('filterExtensionsBySelection: любое из имён расширения, без учёта регистра', () => {
		const available = [DEMO, TESTS];
		assert.deepStrictEqual(filterExtensionsBySelection(available, ['_деморасширение']), [DEMO]);
		assert.deepStrictEqual(filterExtensionsBySelection(available, ['tests/cfe/yaxunit-test']), [TESTS]);
		assert.deepStrictEqual(filterExtensionsBySelection(available, ['Тесты', 'ssl31._ДемоРасширение']), [DEMO, TESTS]);
		assert.deepStrictEqual(filterExtensionsBySelection(available, ['ext_x']), []);
	});

	test('cfeStem: имя файла без .cfe, каталог отбрасывается', () => {
		assert.strictEqual(cfeStem('ssl31._ДемоРасширение.cfe'), 'ssl31._ДемоРасширение');
		assert.strictEqual(cfeStem('build/out/cfe/Ext_A.CFE'), 'Ext_A');
		assert.strictEqual(cfeStem('build\\out\\cfe\\Ext_A.cfe'), 'Ext_A');
	});

	test('filterCfeFilesBySelection: без выбора — все файлы', () => {
		const files = ['ext_a.cfe', 'ext_b.cfe'];
		assert.deepStrictEqual(filterCfeFilesBySelection(files, undefined), files);
	});

	test('filterCfeFilesBySelection: сопоставление по имени файла без учёта регистра', () => {
		const files = ['Ext_A.cfe', 'ext_b.CFE', 'ext_c.cfe'];
		assert.deepStrictEqual(filterCfeFilesBySelection(files, ['ext_a', 'ext_b']), ['Ext_A.cfe', 'ext_b.CFE']);
	});

	test('normalizeConfiguredExtensions: не массив — пустой список', () => {
		assert.deepStrictEqual(normalizeConfiguredExtensions(undefined), []);
		assert.deepStrictEqual(normalizeConfiguredExtensions('ext_a'), []);
		assert.deepStrictEqual(normalizeConfiguredExtensions(null), []);
	});

	test('normalizeConfiguredExtensions: обрезает пробелы и отбрасывает пустые/не-строки', () => {
		assert.deepStrictEqual(
			normalizeConfiguredExtensions([' ext_a ', '', 'ext_b', 42, '  ']),
			['ext_a', 'ext_b']
		);
	});

	test('getStoredExtensionSelection: по умолчанию undefined', () => {
		const memento = new FakeMemento();
		assert.strictEqual(getStoredExtensionSelection(memento), undefined);
	});

	test('setStoredExtensionSelection / getStoredExtensionSelection: round-trip', async () => {
		const memento = new FakeMemento();
		await setStoredExtensionSelection(memento, ['ext_a', 'ext_b']);
		assert.deepStrictEqual(getStoredExtensionSelection(memento), ['ext_a', 'ext_b']);
		await setStoredExtensionSelection(memento, undefined);
		assert.strictEqual(getStoredExtensionSelection(memento), undefined);
	});

	test('getStoredExtensionSelection: undefined memento — undefined', () => {
		assert.strictEqual(getStoredExtensionSelection(undefined), undefined);
	});
});

suite('extensionSelection: области выбора', () => {
	test('выбор тестовых расширений не затирает выбор расширений решения', async () => {
		const memento = new FakeMemento();

		await setStoredExtensionSelection(memento, ['РасширениеРешения']);
		await setStoredExtensionSelection(memento, ['ТестовоеРасширение'], 'tests');

		assert.deepStrictEqual(getStoredExtensionSelection(memento), ['РасширениеРешения']);
		assert.deepStrictEqual(getStoredExtensionSelection(memento, 'tests'), ['ТестовоеРасширение']);
	});

	test('настройка области отбирает свои расширения: имена решения к тестовым не подходят', () => {
		// в settings.json списки разные: cfe.selected - решение,
		// test.cfe.selected - тестовые; пересечения между ними нет
		const testExtensions = [plain('yaxunit', 'tests/cfe/yaxunit'), TESTS];
		assert.deepStrictEqual(
			filterExtensionsBySelection(testExtensions, normalizeConfiguredExtensions(['РасширениеРешения'])),
			[]
		);
		assert.deepStrictEqual(
			filterExtensionsBySelection(testExtensions, normalizeConfiguredExtensions([' YAXUNIT '])),
			[testExtensions[0]]
		);
	});

	test('сброс одной области не трогает другую', async () => {
		const memento = new FakeMemento();
		await setStoredExtensionSelection(memento, ['РасширениеРешения']);
		await setStoredExtensionSelection(memento, ['ТестовоеРасширение'], 'tests');

		await setStoredExtensionSelection(memento, undefined, 'tests');

		assert.deepStrictEqual(getStoredExtensionSelection(memento), ['РасширениеРешения']);
		assert.strictEqual(getStoredExtensionSelection(memento, 'tests'), undefined);
	});

	test('область по умолчанию - расширения решения', async () => {
		const memento = new FakeMemento();
		await setStoredExtensionSelection(memento, ['РасширениеРешения'], 'solution');

		assert.deepStrictEqual(getStoredExtensionSelection(memento), ['РасширениеРешения']);
	});
});

suite('pickExtensions: прогон без окна выбора', () => {
	const memento = (value: unknown): vscode.Memento =>
		({
			get: () => value,
			update: async () => undefined,
			keys: () => [],
		}) as unknown as vscode.Memento;

	const first = plain('Расширение1');
	const second = plain('Расширение2');

	test('пустой запомненный выбор не останавливает прогон: берём все', async () => {
		const picked = await pickExtensions([first, second], memento([]), { wait: true });

		assert.deepStrictEqual(picked, [first, second]);
	});

	test('запомненный выбор от другого состава не оставляет прогон без расширений', async () => {
		const picked = await pickExtensions([first], memento(['УдалённоеРасширение']), { wait: true });

		assert.deepStrictEqual(picked, [first]);
	});

	test('запомненный выбор применяется, когда совпал', async () => {
		const picked = await pickExtensions([first, second], memento(['Расширение2']), { wait: true });

		assert.deepStrictEqual(picked, [second]);
	});

	test('запомненный выбор подходит расширению по любому из имён', async () => {
		// Установка версии запоминала имя из метаданных, команды расширений путь к проекту:
		// оба находят то же расширение
		assert.deepStrictEqual(await pickExtensions([DEMO, TESTS], memento(['_ДемоРасширение']), { wait: true }), [DEMO]);
		assert.deepStrictEqual(await pickExtensions([DEMO, TESTS], memento(['tests/cfe/yaxunit-test']), { wait: true }), [TESTS]);
	});

	test('явный список агента отбирает по имени каталога или из метаданных', async () => {
		assert.deepStrictEqual(await pickExtensions([DEMO, TESTS], memento(undefined), { wait: true, extensions: ['yaxunit-test'] }), [TESTS]);
		assert.deepStrictEqual(await pickExtensions([DEMO, TESTS], memento(undefined), { wait: true, extensions: ['Тесты', '_ДемоРасширение'] }), [DEMO, TESTS]);
		assert.deepStrictEqual(await pickExtensions([DEMO, TESTS], memento(undefined), { wait: true, extensions: ['Нет'] }), []);
	});
});
