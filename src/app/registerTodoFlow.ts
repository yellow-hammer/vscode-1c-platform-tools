import * as vscode from 'vscode';
import { registerTodoFeature } from '../features/todo/registerTodoFeature';
import { registerTodoView } from '../features/todo/registerTodoView';

export interface TodoFlow {
	todoFeatureDisposables: vscode.Disposable[];
}

/**
 * Инициализирует flow фичи «Список дел»: view и runtime-команды.
 */
export function registerTodoFlow(
	context: vscode.ExtensionContext,
	isProjectRef: { current: boolean }
): TodoFlow {
	const { todoPanelProvider } = registerTodoView(context);
	const todoFeatureDisposables = registerTodoFeature({
		todoPanelProvider,
		isProjectRef,
	});

	return { todoFeatureDisposables };
}
