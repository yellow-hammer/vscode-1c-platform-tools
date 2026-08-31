import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { revealOpenPanel, trackOpenPanel } from '../../features/editors/openPanels';

/** Вкладка-заглушка: реестру нужны только reveal и onDidDispose. */
function fakePanel(): { panel: vscode.WebviewPanel; revealed: () => number; dispose: () => void } {
	let revealCount = 0;
	let onDispose: (() => void) | undefined;
	const panel = {
		viewColumn: vscode.ViewColumn.One,
		reveal: () => {
			revealCount += 1;
		},
		onDidDispose: (listener: () => void) => {
			onDispose = listener;
			return { dispose: () => undefined };
		},
	} as unknown as vscode.WebviewPanel;
	return { panel, revealed: () => revealCount, dispose: () => onDispose?.() };
}

suite('реестр открытых вкладок', () => {
	test('второе открытие того же объекта показывает уже открытую вкладку', () => {
		const path = 'C:/ws/src/cf/Catalogs/Справочник1.xml';
		assert.strictEqual(revealOpenPanel('objectProperties', path), false);

		const first = fakePanel();
		trackOpenPanel('objectProperties', path, first.panel);

		assert.strictEqual(revealOpenPanel('objectProperties', path), true);
		assert.strictEqual(first.revealed(), 1);
	});

	test('у разных объектов вкладки разные', () => {
		const one = 'C:/ws/src/cf/Catalogs/Справочник2.xml';
		const two = 'C:/ws/src/cf/Catalogs/Справочник3.xml';
		const panel = fakePanel();
		trackOpenPanel('objectProperties', one, panel.panel);

		assert.strictEqual(revealOpenPanel('objectProperties', two), false);
		assert.strictEqual(panel.revealed(), 0);
	});

	test('у одного файла свойства и форма — разные вкладки', () => {
		const path = 'C:/ws/src/cf/CommonForms/Настройки.xml';
		const properties = fakePanel();
		trackOpenPanel('objectProperties', path, properties.panel);

		assert.strictEqual(revealOpenPanel('form', path), false);
		assert.strictEqual(properties.revealed(), 0);
	});

	test('путь сравнивается без учёта регистра: Windows отдаёт разный регистр диска', () => {
		const path = 'C:/ws/src/cf/Catalogs/Справочник4.xml';
		trackOpenPanel('objectProperties', path, fakePanel().panel);
		assert.strictEqual(revealOpenPanel('objectProperties', 'c:/WS/src/cf/Catalogs/Справочник4.xml'), true);
	});

	test('закрытая вкладка снимается с учёта', () => {
		const path = 'C:/ws/src/cf/Catalogs/Справочник5.xml';
		const panel = fakePanel();
		trackOpenPanel('objectProperties', path, panel.panel);
		panel.dispose();

		assert.strictEqual(revealOpenPanel('objectProperties', path), false);
	});
});
