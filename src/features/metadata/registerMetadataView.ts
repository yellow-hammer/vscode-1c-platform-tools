import * as vscode from 'vscode';
import {
	MetadataLeafTreeItem,
	MetadataTreeDataProvider,
} from './metadataTreeView';

export interface MetadataViewRegistration {
	metadataTreeProvider: MetadataTreeDataProvider;
	metadataTreeView: vscode.TreeView<vscode.TreeItem>;
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

	return { metadataTreeProvider, metadataTreeView };
}
