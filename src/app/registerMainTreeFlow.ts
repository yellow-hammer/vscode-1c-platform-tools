import * as vscode from 'vscode';
import type { OscriptTasksCommands } from '../commands/oscriptTasksCommands';
import type { SetVersionCommands } from '../commands/setVersionCommands';
import type { WorkspaceTasksCommands } from '../commands/workspaceTasksCommands';
import { registerMainTreeCommands } from '../features/tools/registerMainTreeCommands';
import { registerMainTreeView } from '../features/tools/registerMainTreeView';
import type { PlatformTreeDataProvider } from '../features/tools/treeViewProvider';

export interface RegisterMainTreeFlowParams {
	context: vscode.ExtensionContext;
	isProjectRef: { current: boolean };
	showNot1CProjectMessage: () => void;
	setVersionCommands: SetVersionCommands;
	oscriptTasksCommands: OscriptTasksCommands;
	workspaceTasksCommands: WorkspaceTasksCommands;
}

export interface MainTreeFlow {
	treeDataProvider: PlatformTreeDataProvider;
	mainTreeCommandDisposables: vscode.Disposable[];
}

/**
 * Инициализирует flow главного дерева: view и runtime-команды.
 */
export function registerMainTreeFlow(
	params: RegisterMainTreeFlowParams
): MainTreeFlow {
	const {
		context,
		isProjectRef,
		showNot1CProjectMessage,
		setVersionCommands,
		oscriptTasksCommands,
		workspaceTasksCommands,
	} = params;

	const { treeDataProvider } = registerMainTreeView(context, setVersionCommands);
	const mainTreeCommandDisposables = registerMainTreeCommands({
		context,
		treeDataProvider,
		isProjectRef,
		showNot1CProjectMessage,
		setVersionCommands,
		oscriptTasksCommands,
		workspaceTasksCommands,
	});

	return { treeDataProvider, mainTreeCommandDisposables };
}
