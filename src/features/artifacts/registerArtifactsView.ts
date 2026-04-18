import * as vscode from 'vscode';
import { ProjectArtifactsTreeDataProvider } from './projectArtifactsView';

export interface ArtifactsViewRegistration {
	artifactsProvider: ProjectArtifactsTreeDataProvider;
	artifactsTreeView: vscode.TreeView<vscode.TreeItem>;
}

/**
 * Регистрирует tree view панели «Артефакты проекта».
 */
export function registerArtifactsView(
	context: vscode.ExtensionContext
): ArtifactsViewRegistration {
	const artifactsProvider = new ProjectArtifactsTreeDataProvider(context);
	const artifactsTreeView = vscode.window.createTreeView(
		'1c-platform-tools-artifacts-tree',
		{
			treeDataProvider: artifactsProvider,
			showCollapseAll: true,
		}
	);
	context.subscriptions.push(artifactsTreeView);

	return { artifactsProvider, artifactsTreeView };
}
