import * as vscode from 'vscode';
import {
	MetadataLeafTreeItem,
	MetadataTreeDataProvider,
} from './metadataTreeView';
import { METADATA_SEARCH_VIEW_ID, MetadataSearchViewProvider } from './metadataSearchView';
import { METADATA_FILTERS_VIEW_ID, MetadataFilterViewProvider, type FilterSelection } from './metadataFilterView';
import { applySubsystemFilter } from './metadataSubsystemFilter';

/** Отмеченные подсистемы применяются сразу: пустой набор снимает отбор. */
async function applyFilterSelection(
	context: vscode.ExtensionContext,
	metadataTreeProvider: MetadataTreeDataProvider,
	selection: FilterSelection
): Promise<void> {
	if (selection.subsystems.length === 0) {
		metadataTreeProvider.clearSubsystemFilter();
		void vscode.commands.executeCommand('setContext', '1c-platform-tools.metadata.subsystemFilterActive', false);
		return;
	}
	const label =
		selection.subsystems.length === 1
			? selection.subsystems[0].name
			: `подсистем: ${selection.subsystems.length}`;
	await applySubsystemFilter(context, metadataTreeProvider, selection.subsystems, selection, label);
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

	const metadataFilterProvider = new MetadataFilterViewProvider(metadataTreeProvider, (selection) => {
		void applyFilterSelection(context, metadataTreeProvider, selection);
	});
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(METADATA_FILTERS_VIEW_ID, metadataFilterProvider)
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
