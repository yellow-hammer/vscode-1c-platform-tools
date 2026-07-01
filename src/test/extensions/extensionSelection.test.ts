import * as assert from 'node:assert';
import type * as vscode from 'vscode';
import {
	getStoredExtensionSelection,
	setStoredExtensionSelection,
	filterExtensionsBySelection,
	filterCfeFilesBySelection,
	normalizeConfiguredExtensions,
	filterByConfiguredNames
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

suite('extensionSelection', () => {
	test('filterExtensionsBySelection: без выбора — все каталоги', () => {
		const available = ['ext_a', 'ext_b', 'ext_c'];
		assert.deepStrictEqual(filterExtensionsBySelection(available, undefined), available);
	});

	test('filterExtensionsBySelection: оставляет только выбранные, сохраняя порядок', () => {
		const available = ['ext_a', 'ext_b', 'ext_c'];
		assert.deepStrictEqual(filterExtensionsBySelection(available, ['ext_c', 'ext_a']), ['ext_a', 'ext_c']);
	});

	test('filterExtensionsBySelection: новые каталоги в подмножество не попадают', () => {
		const available = ['ext_a', 'ext_b', 'ext_new'];
		assert.deepStrictEqual(filterExtensionsBySelection(available, ['ext_a', 'ext_b']), ['ext_a', 'ext_b']);
	});

	test('filterExtensionsBySelection: пустой выбор — пустой результат', () => {
		assert.deepStrictEqual(filterExtensionsBySelection(['ext_a'], []), []);
	});

	test('filterCfeFilesBySelection: без выбора — все файлы', () => {
		const files = ['ext_a.cfe', 'ext_b.cfe'];
		assert.deepStrictEqual(filterCfeFilesBySelection(files, undefined), files);
	});

	test('filterCfeFilesBySelection: сопоставление по имени без учёта регистра', () => {
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

	test('filterByConfiguredNames: пересечение без учёта регистра, порядок доступных', () => {
		const available = ['Ext_A', 'ext_b', 'ext_c'];
		assert.deepStrictEqual(filterByConfiguredNames(available, ['EXT_A', 'ext_c']), ['Ext_A', 'ext_c']);
	});

	test('filterByConfiguredNames: имена не из списка отбрасываются', () => {
		assert.deepStrictEqual(filterByConfiguredNames(['ext_a', 'ext_b'], ['ext_x']), []);
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
