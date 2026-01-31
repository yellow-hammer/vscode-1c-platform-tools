import * as vscode from 'vscode';
import { PlatformTreeDataProvider } from './treeViewProvider';
import { InfobaseCommands } from './commands/infobaseCommands';
import { ConfigurationCommands } from './commands/configurationCommands';
import { ExtensionsCommands } from './commands/extensionsCommands';
import { ExternalFilesCommands } from './commands/externalFilesCommands';
import { DependenciesCommands } from './commands/dependenciesCommands';
import { RunCommands } from './commands/runCommands';
import { TestCommands } from './commands/testCommands';
import { SetVersionCommands } from './commands/setVersionCommands';
import { WorkspaceTasksCommands } from './commands/workspaceTasksCommands';
import { OscriptTasksCommands } from './commands/oscriptTasksCommands';
import { registerCommands } from './commands/commandRegistry';
import { VRunnerManager } from './vrunnerManager';

/**
 * Проверяет, является ли открытая рабочая область проектом 1С
 * Расширение активируется, если в корне есть файл packagedef
 * @returns true, если это проект 1С
 */
async function is1CProject(): Promise<boolean> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return false;
	}

	const workspaceRoot = workspaceFolders[0].uri.fsPath;
	const fs = await import('node:fs/promises');
	const path = await import('node:path');

	const packagedefPath = path.join(workspaceRoot, 'packagedef');
	
	try {
		await fs.access(packagedefPath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Активирует расширение
 * @param context - Контекст расширения VS Code
 */
export async function activate(context: vscode.ExtensionContext) {
	await vscode.commands.executeCommand('setContext', '1c-platform-tools.is1CProject', false);
	
	const isProject = await is1CProject();
	
	if (!isProject) {
		return;
	}

	await vscode.commands.executeCommand('setContext', '1c-platform-tools.is1CProject', true);

	// Инициализируем VRunnerManager с контекстом расширения для доступа к extensionPath
	VRunnerManager.getInstance(context);

	const commands = {
		infobase: new InfobaseCommands(),
		configuration: new ConfigurationCommands(),
		extensions: new ExtensionsCommands(),
		externalFiles: new ExternalFilesCommands(),
		dependencies: new DependenciesCommands(),
		run: new RunCommands(),
		test: new TestCommands(),
		setVersion: new SetVersionCommands(),
		oscriptTasks: new OscriptTasksCommands(),
		workspaceTasks: new WorkspaceTasksCommands(),
	};

	const commandDisposables = registerCommands(context, commands);

	const treeDataProvider = new PlatformTreeDataProvider(context.extensionUri, commands.setVersion);

	const treeView = vscode.window.createTreeView('1c-platform-tools', {
		treeDataProvider: treeDataProvider,
		showCollapseAll: true,
	});

	const refreshCommand = vscode.commands.registerCommand('1c-platform-tools.refresh', () => {
		treeDataProvider.refresh();
		vscode.window.showInformationMessage('Дерево обновлено');
	});

	const settingsCommand = vscode.commands.registerCommand('1c-platform-tools.settings', () => {
		vscode.commands.executeCommand('workbench.action.openSettings', '@ext:yellow-hammer.1c-platform-tools');
	});

	const launchViewCommand = vscode.commands.registerCommand('1c-platform-tools.launch.view', () => {
		treeDataProvider.refresh();
	});

	const launchRunCommand = vscode.commands.registerCommand('1c-platform-tools.launch.run', async (taskLabel: string) => {
		await commands.workspaceTasks.runTask(taskLabel);
	});

	const oscriptRunCommand = vscode.commands.registerCommand('1c-platform-tools.oscript.run', async (taskName: string) => {
		await commands.oscriptTasks.runOscriptTask(taskName);
	});

	const oscriptAddTaskCommand = vscode.commands.registerCommand('1c-platform-tools.oscript.addTask', async () => {
		await commands.oscriptTasks.addOscriptTask();
		treeDataProvider.refresh();
	});

	const launchEditCommand = vscode.commands.registerCommand('1c-platform-tools.launch.edit', () => {
		commands.workspaceTasks.editTasks();
	});

	const fileOpenCommand = vscode.commands.registerCommand('1c-platform-tools.file.open', async (filePath: string) => {
		const uri = vscode.Uri.file(filePath);
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc);
	});

	const launchEditConfigurationsCommand = vscode.commands.registerCommand('1c-platform-tools.launch.editConfigurations', () => {
		commands.workspaceTasks.editLaunchConfigurations();
	});

	const onWorkspaceTasksSave = vscode.workspace.onDidSaveTextDocument((document) => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return;
		}
		const relativePath = vscode.workspace.asRelativePath(document.uri);
		if (relativePath === '.vscode/tasks.json' || relativePath === '.vscode/launch.json') {
			treeDataProvider.refresh();
		}
	});

	context.subscriptions.push(
		treeView,
		refreshCommand,
		settingsCommand,
		launchViewCommand,
		launchRunCommand,
		oscriptRunCommand,
		oscriptAddTaskCommand,
		launchEditCommand,
		fileOpenCommand,
		launchEditConfigurationsCommand,
		onWorkspaceTasksSave,
		...commandDisposables
	);

}

/**
 * Деактивирует расширение
 * Очистка не требуется: все ресурсы автоматически освобождаются
 * через context.subscriptions при деактивации расширения
 */
export function deactivate() {
	// Очистка не требуется
}
