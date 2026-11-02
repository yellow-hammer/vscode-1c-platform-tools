import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { MetadataSourceTreeItem, MetadataTreeDataProvider } from '../../features/metadata/metadataTreeView';
import { OneScriptGroupTreeItem, OneScriptTasksGroupTreeItem } from '../../features/metadata/oneScriptPackageTree';
import { METADATA_EXPANDED_SOURCES_STATE, projectMemento } from '../../shared/projectState';
import { createMockExtensionContext } from '../fixtures/mocks/vscodeMocks';

/** Корень проекта, которого больше ни один тест не касается: состояние проектов общее на весь файл. */
function projectRoot(name: string): string {
	return path.join(os.tmpdir(), 'metadata-tree-expansion', name);
}

function providerAt(root: string, saved?: string[]): MetadataTreeDataProvider {
	if (saved) {
		void projectMemento(root).update(METADATA_EXPANDED_SOURCES_STATE, saved);
	}
	const provider = new MetadataTreeDataProvider(createMockExtensionContext());
	(provider as unknown as { _workspaceRoot: string })._workspaceRoot = root;
	return provider;
}

function saved(root: string): string[] | undefined {
	return projectMemento(root).get<string[]>(METADATA_EXPANDED_SOURCES_STATE);
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

	test('раскрытие источника запоминается в проекте дерева', () => {
		const root = projectRoot('раскрытие');
		const provider = providerAt(root);

		provider.rememberSourceExpanded('cfe1', true);

		assert.deepStrictEqual(saved(root), ['cfe1']);
	});

	test('сворачивание убирает источник из запомненных', () => {
		const root = projectRoot('сворачивание');
		const provider = providerAt(root, ['cf', 'cfe1']);

		provider.rememberSourceExpanded('cf', false);

		assert.deepStrictEqual(saved(root), ['cfe1'], 'основную свернули, расширение осталось раскрытым');
	});

	test('повторное раскрытие не плодит записей', () => {
		const root = projectRoot('повтор');
		const provider = providerAt(root, ['cfe1']);

		provider.rememberSourceExpanded('cfe1', true);
		provider.rememberSourceExpanded('cfe1', true);

		assert.deepStrictEqual(saved(root), ['cfe1']);
	});

	test('у каждого проекта своё раскрытие', () => {
		const first = projectRoot('первый');
		const second = projectRoot('второй');
		const provider = providerAt(first, ['cf']);

		(provider as unknown as { _workspaceRoot: string })._workspaceRoot = second;
		provider.rememberSourceExpanded('cfe1', true);

		assert.deepStrictEqual(saved(second), ['cfe1'], 'второй проект не унаследовал раскрытие первого');
		assert.deepStrictEqual(saved(first), ['cf']);
	});

	test('группы OneScript и задачи без сохранённого состояния свёрнуты, сохранённое раскрывает', async () => {
		const root = projectRoot('onescript');
		await projectMemento(root).update(METADATA_EXPANDED_SOURCES_STATE, undefined);
		fs.mkdirSync(path.join(root, 'tasks'), { recursive: true });
		fs.writeFileSync(path.join(root, 'tasks', 'job.os'), '');
		fs.writeFileSync(path.join(root, 'packagedef'), `
			Описание.Имя("os")
				.ОпределяетКласс("Класс", "src/Классы/Класс.os")
				.ОпределяетМодуль("Модуль", "src/Модули/Модуль.os")
				.ИсполняемыйФайл("src/main.os", "os");
		`);
		const fresh = providerAt(root);
		(fresh as unknown as { _contentOneScript: boolean })._contentOneScript = true;
		const closed = await fresh.getChildren();
		assert.ok(closed.filter((item) => item instanceof OneScriptGroupTreeItem || item instanceof OneScriptTasksGroupTreeItem)
			.every((item) => item.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed));

		const provider = providerAt(root, ['oscript:class', 'oscript:tasks']);
		(provider as unknown as { _contentOneScript: boolean })._contentOneScript = true;
		const rows = await provider.getChildren();
		const byLabel = new Map(rows.map((item) => [String(item.label), item]));
		assert.strictEqual(byLabel.get('Классы')?.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
		assert.strictEqual(byLabel.get('Модули')?.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
		assert.strictEqual(byLabel.get('Программы')?.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
		assert.strictEqual(byLabel.get('Задачи (oscript)')?.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
	});
});
