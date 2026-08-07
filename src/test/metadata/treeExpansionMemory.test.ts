import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { MetadataSourceTreeItem, MetadataTreeDataProvider } from '../../features/metadata/metadataTreeView';
import { createMockExtensionContext } from '../fixtures/mocks/vscodeMocks';

const KEY = '1c-platform-tools.metadata.expandedSources';

/** Контекст с работающим хранилищем: общий мок ничего не запоминает. */
function contextWithState(saved?: string[]): vscode.ExtensionContext {
	const state = new Map<string, unknown>();
	if (saved) {
		state.set(KEY, saved);
	}
	const context = createMockExtensionContext();
	return {
		...context,
		workspaceState: {
			get: (key: string) => state.get(key),
			update: (key: string, value: unknown) => {
				state.set(key, value);
				return Promise.resolve();
			},
			keys: () => [...state.keys()],
		} as unknown as vscode.Memento,
	} as vscode.ExtensionContext;
}

function saved(context: vscode.ExtensionContext): string[] | undefined {
	return context.workspaceState.get<string[]>(KEY);
}

suite('Память раскрытия дерева метаданных', () => {
	test('без сохранённого состояния раскрыта основная конфигурация', () => {
		const main = new MetadataSourceTreeItem('cf', 'Основная конфигурация', 'main', undefined, undefined);
		const extension = new MetadataSourceTreeItem('cfe1', 'Расширение', 'extension', undefined, undefined);

		assert.strictEqual(main.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
		assert.strictEqual(extension.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
	});

	test('сохранённое состояние сильнее умолчания', () => {
		const main = new MetadataSourceTreeItem('cf', 'Основная', 'main', undefined, undefined, false);
		const extension = new MetadataSourceTreeItem('cfe1', 'Расширение', 'extension', undefined, undefined, true);

		assert.strictEqual(main.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
		assert.strictEqual(extension.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
	});

	test('раскрытие источника запоминается', () => {
		const context = contextWithState();
		const provider = new MetadataTreeDataProvider(context);

		provider.rememberSourceExpanded('cfe1', true);

		assert.deepStrictEqual(saved(context), ['cfe1']);
	});

	test('сворачивание убирает источник из запомненных', () => {
		const context = contextWithState(['cf', 'cfe1']);
		const provider = new MetadataTreeDataProvider(context);

		provider.rememberSourceExpanded('cf', false);

		assert.deepStrictEqual(saved(context), ['cfe1'], 'основную свернули, расширение осталось раскрытым');
	});

	test('повторное раскрытие не плодит записей', () => {
		const context = contextWithState(['cfe1']);
		const provider = new MetadataTreeDataProvider(context);

		provider.rememberSourceExpanded('cfe1', true);
		provider.rememberSourceExpanded('cfe1', true);

		assert.deepStrictEqual(saved(context), ['cfe1']);
	});
});
