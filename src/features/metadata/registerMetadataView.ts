import * as vscode from 'vscode';
import {
	MetadataLeafTreeItem,
	MetadataTreeDataProvider,
} from './metadataTreeView';
import { METADATA_SEARCH_VIEW_ID, MetadataSearchViewProvider } from './metadataSearchView';
import {
	METADATA_FILTERS_VIEW_ID,
	MetadataFilterTreeDataProvider,
	type MetadataFilterTreeItem,
} from './metadataFilterView';

export interface MetadataViewRegistration {
	metadataTreeProvider: MetadataTreeDataProvider;
	metadataTreeView: vscode.TreeView<vscode.TreeItem>;
	metadataSearchProvider: MetadataSearchViewProvider;
	metadataFilterProvider: MetadataFilterTreeDataProvider;
}

/**
 * Регистрирует tree view панели «Метаданные 1С» и базовые UI-контексты выбора.
 */
export function registerMetadataView(
	context: vscode.ExtensionContext
): MetadataViewRegistration {
	const metadataTreeProvider = new MetadataTreeDataProvider(context);
	const metadataTreeView = vscode.window.createTreeView('1c-platform-tools-metadata-tree', {
		treeDataProvider: metadataTreeProvider,
		showCollapseAll: true,
	});
	context.subscriptions.push(metadataTreeView);

	const metadataSearchProvider = new MetadataSearchViewProvider(context.extensionUri, (query) => {
		metadataTreeProvider.setTextFilter(query);
	});
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(METADATA_SEARCH_VIEW_ID, metadataSearchProvider)
	);

	const metadataFilterProvider = new MetadataFilterTreeDataProvider(metadataTreeProvider);
	const metadataFilterView = vscode.window.createTreeView<MetadataFilterTreeItem>(METADATA_FILTERS_VIEW_ID, {
		treeDataProvider: metadataFilterProvider,
		// Флажками управляем сами: охват подчинённых и родительских задают переключатели, а не иерархия.
		manageCheckboxStateManually: true,
	});
	context.subscriptions.push(
		metadataFilterView,
		metadataFilterView.onDidChangeCheckboxState((event) => {
			for (const [item, state] of event.items) {
				metadataFilterProvider.setChecked(item, state === vscode.TreeItemCheckboxState.Checked);
			}
		})
	);

	const syncMetadataCatalogSelectionContext = (): void => {
		const has = metadataTreeView.selection.some(
			(selection) =>
				selection instanceof MetadataLeafTreeItem &&
				selection.objectType === 'Catalog'
		);
		void vscode.commands.executeCommand(
			'setContext',
			'1c-platform-tools.metadata.catalogSelected',
			has
		);

		const hasSubsystem = metadataTreeView.selection.some(
			(selection) =>
				selection instanceof MetadataLeafTreeItem &&
				selection.objectType === 'Subsystem'
		);
		void vscode.commands.executeCommand(
			'setContext',
			'1c-platform-tools.metadata.subsystemSelected',
			hasSubsystem
		);
	};

	void vscode.commands.executeCommand(
		'setContext',
		'1c-platform-tools.metadata.catalogSelected',
		false
	);
	void vscode.commands.executeCommand(
		'setContext',
		'1c-platform-tools.metadata.subsystemSelected',
		false
	);
	void vscode.commands.executeCommand(
		'setContext',
		'1c-platform-tools.metadata.subsystemFilterActive',
		false
	);

	context.subscriptions.push(
		metadataTreeView.onDidChangeSelection(syncMetadataCatalogSelectionContext)
	);

	return { metadataTreeProvider, metadataTreeView, metadataSearchProvider, metadataFilterProvider };
}
