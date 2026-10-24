import * as vscode from 'vscode';
import { readProjectLaunch } from '../../shared/projectState';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { registerWorkspaceProjectCommands } from './workspaceProjectCommands';
import { WORKSPACE_PROJECTS_VIEW_ID, WorkspaceProjectsTreeProvider } from './workspaceProjectsView';
import { workspaceProjectsSource } from './workspaceProjectsSource';

/**
 * Регистрирует вид «Рабочая область» и команды «1С: Проект».
 *
 * @param context - Контекст расширения
 * @param showNoProjects - Сообщение, что проектов нет
 */
export function registerWorkspaceProjectsFeature(
	context: vscode.ExtensionContext,
	showNoProjects: () => void
): void {
	const source = workspaceProjectsSource();
	const vrunner = VRunnerManager.getInstance(context);
	const launchChanged = new vscode.EventEmitter<void>();
	const provider = new WorkspaceProjectsTreeProvider(source, readProjectLaunch, launchChanged.event);
	const treeView = vscode.window.createTreeView(WORKSPACE_PROJECTS_VIEW_ID, {
		treeDataProvider: provider,
		showCollapseAll: false,
	});
	context.subscriptions.push(
		launchChanged,
		vrunner.onDidChangeActiveEnvProfile(() => launchChanged.fire()),
		vrunner.onDidChangeActiveEnvironment(() => launchChanged.fire()),
		provider,
		treeView,
		...registerWorkspaceProjectCommands(source, showNoProjects)
	);
}
