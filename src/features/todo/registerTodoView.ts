import * as vscode from 'vscode';
import { TodoPanelTreeDataProvider, type TodoNode } from './todoPanelView';

export interface TodoViewRegistration {
	todoPanelProvider: TodoPanelTreeDataProvider;
	todoTreeView: vscode.TreeView<TodoNode>;
}

/**
 * Регистрирует tree view панели «Список дел».
 */
export function registerTodoView(
	context: vscode.ExtensionContext
): TodoViewRegistration {
	const todoPanelProvider = new TodoPanelTreeDataProvider(context);
	const todoTreeView = vscode.window.createTreeView('1c-platform-tools-todo-list', {
		treeDataProvider: todoPanelProvider,
		showCollapseAll: true,
	});
	todoPanelProvider.setTreeView(todoTreeView);
	context.subscriptions.push(todoTreeView);

	return { todoPanelProvider, todoTreeView };
}
