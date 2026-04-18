import * as vscode from 'vscode';
import type { SetVersionCommands } from '../../commands/setVersionCommands';
import {
	PlatformTreeDataProvider,
	PlatformTreeItem,
	TREE_GROUP_EXPANDED_STATE_KEY,
} from './treeViewProvider';

export interface MainTreeViewRegistration {
	treeDataProvider: PlatformTreeDataProvider;
}

/**
 * Регистрирует tree view панели «Инструменты 1С» и сохранение состояния раскрытия групп.
 */
export function registerMainTreeView(
	context: vscode.ExtensionContext,
	setVersionCommands: SetVersionCommands
): MainTreeViewRegistration {
	// Дерево создаём всегда: при отсутствии проекта панель скрыта (when), после создания packagedef — показывается
	const treeDataProvider = new PlatformTreeDataProvider(
		context.extensionUri,
		setVersionCommands,
		context
	);
	const treeView = vscode.window.createTreeView('1c-platform-tools', {
		treeDataProvider,
		showCollapseAll: true,
	});

	const saveGroupExpandedState = (element: unknown, expanded: boolean): void => {
		if (!(element instanceof PlatformTreeItem) || !element.groupId) {
			return;
		}
		const state =
			context.globalState.get<Record<string, boolean>>(TREE_GROUP_EXPANDED_STATE_KEY) ?? {};
		state[element.groupId] = expanded;
		void context.globalState.update(TREE_GROUP_EXPANDED_STATE_KEY, state);
	};

	context.subscriptions.push(
		treeView,
		treeView.onDidExpandElement((event) =>
			saveGroupExpandedState(event.element, true)
		),
		treeView.onDidCollapseElement((event) =>
			saveGroupExpandedState(event.element, false)
		)
	);

	return { treeDataProvider };
}
