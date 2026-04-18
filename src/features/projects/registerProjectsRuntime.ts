import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { registerProjectsDecoration } from './decoration';
import { registerProjectsCommands } from './commands';
import { HelpAndSupportProvider } from './helpAndSupportProvider';
import type { OneCLocator } from './oneCLocator';
import {
	type ProjectStorage,
	type ProjectsProviders,
	type ProjectsStack,
	showStatusBar,
} from './index';

export interface RegisterProjectsRuntimeParams {
	context: vscode.ExtensionContext;
	projectStorage: ProjectStorage;
	oneCLocator: OneCLocator;
	providers: ProjectsProviders;
	stack: ProjectsStack;
	projectFilePath: string;
	onArtifactsExcludeChanged?: () => void;
}

export interface RegisterProjectsRuntimeResult {
	projectsCommandDisposables: vscode.Disposable[];
	onProjectsConfigChange: vscode.Disposable;
}

/**
 * Регистрирует runtime-часть фичи «Проекты 1С» (view, команды, реакция на изменения).
 */
export async function registerProjectsRuntime(
	params: RegisterProjectsRuntimeParams
): Promise<RegisterProjectsRuntimeResult> {
	const {
		context,
		projectStorage,
		oneCLocator,
		providers,
		stack,
		projectFilePath,
		onArtifactsExcludeChanged,
	} = params;

	const helpAndSupportProvider = new HelpAndSupportProvider();
	const helpAndSupportTreeView = vscode.window.createTreeView('1c-platform-tools-projects-help', {
		treeDataProvider: helpAndSupportProvider,
		showCollapseAll: false,
	});
	const metadataHelpTreeView = vscode.window.createTreeView('1c-platform-tools-metadata-help', {
		treeDataProvider: helpAndSupportProvider,
		showCollapseAll: false,
	});
	context.subscriptions.push(helpAndSupportTreeView, metadataHelpTreeView);

	registerProjectsDecoration(context);
	showStatusBar(projectStorage, oneCLocator);
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			showStatusBar(projectStorage, oneCLocator);
		})
	);

	const projectsCommandDisposables = registerProjectsCommands(
		context,
		projectStorage,
		oneCLocator,
		providers,
		stack
	);

	try {
		await providers.showTreeViews();
	} catch (err) {
		logger.error(`Ошибка при загрузке списка проектов 1С: ${String(err)}`);
	}

	try {
		fs.watch(path.dirname(projectFilePath), (_, filename) => {
			if (filename === 'projects.json') {
				projectStorage.load();
				providers.refreshStorage();
			}
		});
	} catch {
		/* Папка может не существовать */
	}

	const onProjectsConfigChange = vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('1c-platform-tools.projects')) {
			void oneCLocator.refreshProjects(true).then(() => {
				providers.refreshAll();
				providers.updateStorageTitle();
				providers.updateAutodetectTitle();
			});
		}
		if (e.affectsConfiguration('1c-platform-tools.artifacts.exclude')) {
			onArtifactsExcludeChanged?.();
		}
	});

	return { projectsCommandDisposables, onProjectsConfigChange };
}
