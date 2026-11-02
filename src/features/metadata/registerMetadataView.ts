import * as vscode from 'vscode';
import {
	MetadataLeafTreeItem,
	MetadataSourceTreeItem,
	MetadataTreeDataProvider,
} from './metadataTreeView';
import { OneScriptGroupTreeItem, OneScriptTasksGroupTreeItem } from './oneScriptPackageTree';
import { METADATA_SEARCH_VIEW_ID, MetadataSearchViewProvider } from './metadataSearchView';
import { METADATA_FILTERS_VIEW_ID, MetadataFilterViewProvider, type FilterSelection } from './metadataFilterView';
import { computeSubsystemFilter } from './metadataSubsystemFilter';
import { bindProjectDescription } from '../projects/projectViewDescription';

/** Отмеченные подсистемы применяются сразу: пустой набор снимает отбор. */
function applyFilterSelection(metadataTreeProvider: MetadataTreeDataProvider, selection: FilterSelection): void {
	if (selection.checkedPaths.size === 0) {
		metadataTreeProvider.clearSubsystemFilter();
		return;
	}
	const result = computeSubsystemFilter(selection.roots, selection.checkedPaths, selection);
	const single = selection.checkedPaths.size === 1;
	const label = single ? [...result.subsystemNames][0] ?? 'подсистема' : `подсистем: ${selection.checkedPaths.size}`;
	const caption = single ? undefined : `подсистемы (${selection.checkedPaths.size})`;
	metadataTreeProvider.setSubsystemFilter(label, result.names, result.keys, result.subsystemNames, caption);
}

/** Действующий отбор по подсистемам виден над деревом и включает кнопку сброса. */
function bindSubsystemFilterMessage(
	metadataTreeProvider: MetadataTreeDataProvider,
	metadataTreeView: vscode.TreeView<vscode.TreeItem>
): vscode.Disposable {
	let shown: string | undefined;
	return metadataTreeProvider.onDidChangeTreeData(() => {
		const caption = metadataTreeProvider.getSubsystemFilterCaption();
		if (caption === shown) {
			return;
		}
		shown = caption;
		metadataTreeView.message = caption ? `Отбор: ${caption}` : undefined;
		void vscode.commands.executeCommand(
			'setContext',
			'1c-platform-tools.metadata.subsystemFilterActive',
			caption !== undefined
		);
	});
}

export interface MetadataViewRegistration {
	metadataTreeProvider: MetadataTreeDataProvider;
	metadataTreeView: vscode.TreeView<vscode.TreeItem>;
	metadataSearchProvider: MetadataSearchViewProvider;
	metadataFilterProvider: MetadataFilterViewProvider;
}

/** Идентификатор узла верхнего уровня, чьё раскрытие запоминается. */
function expandedNodeId(element: unknown): string | undefined {
	if (element instanceof MetadataSourceTreeItem) {
		return element.sourceId;
	}
	if (element instanceof OneScriptGroupTreeItem || element instanceof OneScriptTasksGroupTreeItem) {
		return element.expansionId;
	}
	return undefined;
}

/**
 * Регистрирует tree view панели «1С: Метаданные» и базовые UI-контексты выбора.
 */
export function registerMetadataView(
	context: vscode.ExtensionContext
): MetadataViewRegistration {
	const metadataTreeProvider = new MetadataTreeDataProvider(context);
	const metadataTreeView = vscode.window.createTreeView('1c-platform-tools-metadata-tree', {
		treeDataProvider: metadataTreeProvider,
		showCollapseAll: true,
	});
	context.subscriptions.push(
		metadataTreeView,
		bindProjectDescription(metadataTreeView),
		bindSubsystemFilterMessage(metadataTreeProvider, metadataTreeView)
	);
	// Раскрытие верхнего уровня переживает обновление дерева: оно перестраивается целиком.
	context.subscriptions.push(
		metadataTreeView.onDidExpandElement((e) => {
			const id = expandedNodeId(e.element);
			if (id !== undefined) {
				metadataTreeProvider.rememberSourceExpanded(id, true);
			}
		}),
		metadataTreeView.onDidCollapseElement((e) => {
			const id = expandedNodeId(e.element);
			if (id !== undefined) {
				metadataTreeProvider.rememberSourceExpanded(id, false);
			}
		})
	);

	const metadataSearchProvider = new MetadataSearchViewProvider(
		context.extensionUri,
		(query) => {
			metadataTreeProvider.setTextFilter(query);
		},
		() => metadataTreeProvider.getTextFilter() ?? ''
	);
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
