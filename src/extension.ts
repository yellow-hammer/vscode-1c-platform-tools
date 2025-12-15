import * as vscode from 'vscode';
import * as path from 'node:path';
import { PlatformTreeDataProvider } from './treeViewProvider';
import { VRunnerManager } from './vrunnerManager';
import { InfobaseCommands } from './commands/infobaseCommands';
import { ConfigurationCommands } from './commands/configurationCommands';
import { ExtensionsCommands } from './commands/extensionsCommands';
import { ExternalFilesCommands } from './commands/externalFilesCommands';
import { DependenciesCommands } from './commands/dependenciesCommands';
import { RunCommands } from './commands/runCommands';
import { TestCommands } from './commands/testCommands';
import { WorkspaceTasksCommands } from './commands/workspaceTasksCommands';

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

	const vrunnerManager = VRunnerManager.getInstance(context);

	const infobaseCommands = new InfobaseCommands();
	const configurationCommands = new ConfigurationCommands();
	const extensionsCommands = new ExtensionsCommands();
	const externalFilesCommands = new ExternalFilesCommands();
	const dependenciesCommands = new DependenciesCommands();
	const runCommands = new RunCommands();
	const testCommands = new TestCommands();
	const workspaceTasksCommands = new WorkspaceTasksCommands();

	const treeDataProvider = new PlatformTreeDataProvider(context.extensionUri);

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

	const configurationLoadFromSrcCommand = vscode.commands.registerCommand('1c-platform-tools.configuration.loadFromSrc', () => {
		configurationCommands.loadFromSrc('update');
	});

	const configurationLoadFromSrcInitCommand = vscode.commands.registerCommand('1c-platform-tools.configuration.loadFromSrc.init', () => {
		configurationCommands.loadFromSrc('init');
	});

	const configurationLoadFromCfCommand = vscode.commands.registerCommand('1c-platform-tools.configuration.loadFromCf', () => {
		configurationCommands.loadFromCf();
	});

	const configurationDumpToSrcCommand = vscode.commands.registerCommand('1c-platform-tools.configuration.dumpToSrc', () => {
		configurationCommands.dumpToSrc();
	});

	const configurationDumpToCfCommand = vscode.commands.registerCommand('1c-platform-tools.configuration.dumpToCf', () => {
		configurationCommands.dumpToCf();
	});

	const configurationDumpToDistCommand = vscode.commands.registerCommand('1c-platform-tools.configuration.dumpToDist', () => {
		configurationCommands.dumpToDist();
	});

	const configurationBuildCommand = vscode.commands.registerCommand('1c-platform-tools.configuration.build', () => {
		configurationCommands.compile();
	});

	const configurationDecompileCommand = vscode.commands.registerCommand('1c-platform-tools.configuration.decompile', () => {
		configurationCommands.decompile();
	});

	const extensionsLoadFromSrcCommand = vscode.commands.registerCommand('1c-platform-tools.extensions.loadFromSrc', () => {
		extensionsCommands.loadFromSrc();
	});

	const extensionsLoadFromCfeCommand = vscode.commands.registerCommand('1c-platform-tools.extensions.loadFromCfe', () => {
		extensionsCommands.loadFromCfe();
	});

	const extensionsDumpToSrcCommand = vscode.commands.registerCommand('1c-platform-tools.extensions.dumpToSrc', () => {
		extensionsCommands.dumpToSrc();
	});

	const extensionsDumpToCfeCommand = vscode.commands.registerCommand('1c-platform-tools.extensions.dumpToCfe', () => {
		extensionsCommands.dumpToCfe();
	});

	const extensionsBuildCommand = vscode.commands.registerCommand('1c-platform-tools.extensions.build', () => {
		extensionsCommands.compile();
	});

	const extensionsDecompileCommand = vscode.commands.registerCommand('1c-platform-tools.extensions.decompile', () => {
		extensionsCommands.decompile();
	});

	const externalProcessorsBuildCommand = vscode.commands.registerCommand('1c-platform-tools.externalProcessors.build', () => {
		externalFilesCommands.compile('processor');
	});

	const externalProcessorsDecompileCommand = vscode.commands.registerCommand('1c-platform-tools.externalProcessors.decompile', () => {
		externalFilesCommands.decompile('processor');
	});

	const externalReportsBuildCommand = vscode.commands.registerCommand('1c-platform-tools.externalReports.build', () => {
		externalFilesCommands.compile('report');
	});

	const externalReportsDecompileCommand = vscode.commands.registerCommand('1c-platform-tools.externalReports.decompile', () => {
		externalFilesCommands.decompile('report');
	});

	const externalFilesClearCacheCommand = vscode.commands.registerCommand('1c-platform-tools.externalFiles.clearCache', () => {
		externalFilesCommands.clearCache();
	});

	const infobaseUpdateDatabaseCommand = vscode.commands.registerCommand('1c-platform-tools.infobase.updateDatabase', () => {
		infobaseCommands.updateDatabase();
	});

	const infobaseBlockExternalResourcesCommand = vscode.commands.registerCommand('1c-platform-tools.infobase.blockExternalResources', () => {
		infobaseCommands.blockExternalResources();
	});

	const infobaseInitializeCommand = vscode.commands.registerCommand('1c-platform-tools.infobase.initialize', () => {
		infobaseCommands.initialize();
	});

	const infobaseDumpToDtCommand = vscode.commands.registerCommand('1c-platform-tools.infobase.dumpToDt', () => {
		infobaseCommands.dumpToDt();
	});

	const infobaseLoadFromDtCommand = vscode.commands.registerCommand('1c-platform-tools.infobase.loadFromDt', () => {
		infobaseCommands.loadFromDt();
	});

	const dependenciesInstallCommand = vscode.commands.registerCommand('1c-platform-tools.dependencies.install', () => {
		dependenciesCommands.installDependencies();
	});

	const dependenciesRemoveCommand = vscode.commands.registerCommand('1c-platform-tools.dependencies.remove', () => {
		dependenciesCommands.removeDependencies();
	});

	const dependenciesInitializePackagedefCommand = vscode.commands.registerCommand('1c-platform-tools.dependencies.initializePackagedef', () => {
		dependenciesCommands.initializePackagedef();
	});

	const buildConfigurationCommand = vscode.commands.registerCommand('1c-platform-tools.build.configuration', () => {
		configurationCommands.compile();
	});

	const buildExtensionsCommand = vscode.commands.registerCommand('1c-platform-tools.build.extensions', () => {
		extensionsCommands.compile();
	});

	const buildExternalProcessorCommand = vscode.commands.registerCommand('1c-platform-tools.build.externalProcessor', () => {
		externalFilesCommands.compile();
	});

	const buildExternalReportCommand = vscode.commands.registerCommand('1c-platform-tools.build.externalReport', () => {
		externalFilesCommands.compile();
	});

	const decompileConfigurationCommand = vscode.commands.registerCommand('1c-platform-tools.decompile.configuration', () => {
		configurationCommands.decompile();
	});

	const decompileExternalProcessorCommand = vscode.commands.registerCommand('1c-platform-tools.decompile.externalProcessor', () => {
		externalFilesCommands.decompile();
	});

	const decompileExternalReportCommand = vscode.commands.registerCommand('1c-platform-tools.decompile.externalReport', () => {
		externalFilesCommands.decompile();
	});

	const decompileExtensionCommand = vscode.commands.registerCommand('1c-platform-tools.decompile.extension', () => {
		extensionsCommands.decompile();
	});

	const runEnterpriseCommand = vscode.commands.registerCommand('1c-platform-tools.run.enterprise', () => {
		runCommands.runEnterprise();
	});

	const runDesignerCommand = vscode.commands.registerCommand('1c-platform-tools.run.designer', () => {
		runCommands.runDesigner();
	});

	const testXUnitCommand = vscode.commands.registerCommand('1c-platform-tools.test.xunit', () => {
		testCommands.runXUnit();
	});

	const testSyntaxCheckCommand = vscode.commands.registerCommand('1c-platform-tools.test.syntaxCheck', () => {
		testCommands.runSyntaxCheck();
	});

	const testVanessaCommand = vscode.commands.registerCommand('1c-platform-tools.test.vanessa', () => {
		testCommands.runVanessa('normal');
	});

	const testAllureCommand = vscode.commands.registerCommand('1c-platform-tools.test.allure', () => {
		testCommands.generateAllureReport();
	});

	const launchViewCommand = vscode.commands.registerCommand('1c-platform-tools.launch.view', () => {
		treeDataProvider.refresh();
	});

	const launchRunCommand = vscode.commands.registerCommand('1c-platform-tools.launch.run', async (taskLabel: string) => {
		await workspaceTasksCommands.runTask(taskLabel);
	});

	const launchEditCommand = vscode.commands.registerCommand('1c-platform-tools.launch.edit', () => {
		workspaceTasksCommands.editTasks();
	});

	const fileOpenCommand = vscode.commands.registerCommand('1c-platform-tools.file.open', async (filePath: string) => {
		const uri = vscode.Uri.file(filePath);
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc);
	});

	const launchEditConfigurationsCommand = vscode.commands.registerCommand('1c-platform-tools.launch.editConfigurations', () => {
		workspaceTasksCommands.editLaunchConfigurations();
	});

	const configEnvEditCommand = vscode.commands.registerCommand('1c-platform-tools.config.env.edit', async () => {
		const workspaceRoot = vrunnerManager.getWorkspaceRoot();
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
			return;
		}
		const envPath = vscode.Uri.file(path.join(workspaceRoot, 'env.json'));
		const doc = await vscode.workspace.openTextDocument(envPath);
		await vscode.window.showTextDocument(doc);
	});

	const infobaseCreateEmptyCommand = vscode.commands.registerCommand('1c-platform-tools.infobase.createEmpty', () => {
		infobaseCommands.createEmptyInfobase();
	});

	context.subscriptions.push(
		treeView,
		refreshCommand,
		settingsCommand,
		infobaseCreateEmptyCommand,
		configurationLoadFromSrcCommand,
		configurationLoadFromSrcInitCommand,
		configurationLoadFromCfCommand,
		configurationDumpToSrcCommand,
		configurationDumpToCfCommand,
		configurationDumpToDistCommand,
		configurationBuildCommand,
		configurationDecompileCommand,
		extensionsLoadFromSrcCommand,
		extensionsLoadFromCfeCommand,
		extensionsDumpToSrcCommand,
		extensionsDumpToCfeCommand,
		extensionsBuildCommand,
		extensionsDecompileCommand,
		externalProcessorsBuildCommand,
		externalProcessorsDecompileCommand,
		externalReportsBuildCommand,
		externalReportsDecompileCommand,
		externalFilesClearCacheCommand,
		infobaseUpdateDatabaseCommand,
		infobaseBlockExternalResourcesCommand,
		infobaseInitializeCommand,
		infobaseDumpToDtCommand,
		infobaseLoadFromDtCommand,
		dependenciesInstallCommand,
		dependenciesRemoveCommand,
		dependenciesInitializePackagedefCommand,
		buildConfigurationCommand,
		buildExtensionsCommand,
		buildExternalProcessorCommand,
		buildExternalReportCommand,
		decompileConfigurationCommand,
		decompileExternalProcessorCommand,
		decompileExternalReportCommand,
		decompileExtensionCommand,
		runEnterpriseCommand,
		runDesignerCommand,
		testXUnitCommand,
		testSyntaxCheckCommand,
		testVanessaCommand,
		testAllureCommand,
		launchViewCommand,
		launchRunCommand,
		launchEditCommand,
		fileOpenCommand,
		launchEditConfigurationsCommand,
		configEnvEditCommand
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
