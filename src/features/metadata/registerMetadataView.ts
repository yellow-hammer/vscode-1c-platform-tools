import * as vscode from 'vscode';
import {
	MetadataLeafTreeItem,
	MetadataTreeDataProvider,
} from './metadataTreeView';
import { METADATA_SEARCH_VIEW_ID, MetadataSearchViewProvider } from './metadataSearchView';
import { METADATA_FILTERS_VIEW_ID, MetadataFilterViewProvider, type FilterSelection } from './metadataFilterView';
import { computeSubsystemFilter } from './metadataSubsystemFilter';

/** Отмеченные подсистемы применяются сразу: пустой набор снимает отбор. */
function applyFilterSelection(metadataTreeProvider: MetadataTreeDataProvider, selection: FilterSelection): void {
	if (selection.checkedPaths.size === 0) {
		metadataTreeProvider.clearSubsystemFilter();
		void vscode.commands.executeCommand('setContext', '1c-platform-tools.metadata.subsystemFilterActive', false);
		return;
	}
	const result = computeSubsystemFilter(selection.roots, selection.checkedPaths, selection);
	const label =
		selection.checkedPaths.size === 1
			? [...result.subsystemNames][0] ?? 'подсистема'
			: `подсистем: ${selection.checkedPaths.size}`;
	metadataTreeProvider.setSubsystemFilter(label, result.names, result.keys, result.subsystemNames);
	void vscode.commands.executeCommand('setContext', '1c-platform-tools.metadata.subsystemFilterActive', true);
}

export interface MetadataViewRegistration {
	metadataTreeProvider: MetadataTreeDataProvider;
	metadataTreeView: vscode.TreeView<vscode.TreeItem>;
	metadataSearchProvider: MetadataSearchViewProvider;
	metadataFilterProvider: MetadataFilterViewProvider;
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

	const metadataFilterProvider = new MetadataFilterViewProvider(context, metadataTreeProvider, (selection) => {
		applyFilterSelection(metadataTreeProvider, selection);
	});
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(METADATA_FILTERS_VIEW_ID, metadataFilterProvider),
		// Панель открывается раньше, чем дерево прочитано: без этого список подсистем остаётся пустым.
		metadataTreeProvider.onDidChangeTreeData(() => {
			metadataFilterProvider.refresh();
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
