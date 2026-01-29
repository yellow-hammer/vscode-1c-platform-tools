import * as vscode from 'vscode';
import * as path from 'node:path';
import { InfobaseCommands } from './infobaseCommands';
import { ConfigurationCommands } from './configurationCommands';
import { ExtensionsCommands } from './extensionsCommands';
import { ExternalFilesCommands } from './externalFilesCommands';
import { DependenciesCommands } from './dependenciesCommands';
import { RunCommands } from './runCommands';
import { TestCommands } from './testCommands';
import { WorkspaceTasksCommands } from './workspaceTasksCommands';
import { VRunnerManager } from '../vrunnerManager';

/**
 * Объект со всеми командами расширения
 */
interface Commands {
	infobase: InfobaseCommands;
	configuration: ConfigurationCommands;
	extensions: ExtensionsCommands;
	externalFiles: ExternalFilesCommands;
	dependencies: DependenciesCommands;
	run: RunCommands;
	test: TestCommands;
	workspaceTasks: WorkspaceTasksCommands;
}

/**
 * Регистрирует все команды расширения
 * 
 * @param context - Контекст расширения VS Code
 * @param commands - Объекты команд
 * @returns Массив Disposable для подписки в context.subscriptions
 */
export function registerCommands(context: vscode.ExtensionContext, commands: Commands): vscode.Disposable[] {
	const disposables: vscode.Disposable[] = [];

	// Команды информационных баз
	const infobaseCommands = [
		vscode.commands.registerCommand('1c-platform-tools.infobase.createEmpty', () => {
			commands.infobase.createEmptyInfobase();
		}),
		vscode.commands.registerCommand('1c-platform-tools.infobase.updateDatabase', () => {
			commands.infobase.updateDatabase();
		}),
		vscode.commands.registerCommand('1c-platform-tools.infobase.blockExternalResources', () => {
			commands.infobase.blockExternalResources();
		}),
		vscode.commands.registerCommand('1c-platform-tools.infobase.initialize', () => {
			commands.infobase.initialize();
		}),
		vscode.commands.registerCommand('1c-platform-tools.infobase.dumpToDt', () => {
			commands.infobase.dumpToDt();
		}),
		vscode.commands.registerCommand('1c-platform-tools.infobase.loadFromDt', () => {
			commands.infobase.loadFromDt();
		})
	];

	// Команды конфигурации
	const configurationCommands = [
		vscode.commands.registerCommand('1c-platform-tools.configuration.loadFromSrc', () => {
			commands.configuration.loadFromSrc('update');
		}),
		vscode.commands.registerCommand('1c-platform-tools.configuration.loadFromSrc.init', () => {
			commands.configuration.loadFromSrc('init');
		}),
		vscode.commands.registerCommand('1c-platform-tools.configuration.loadIncrementFromSrc', () => {
			commands.configuration.loadIncrementFromSrc();
		}),
		vscode.commands.registerCommand('1c-platform-tools.configuration.loadFromCf', () => {
			commands.configuration.loadFromCf();
		}),
		vscode.commands.registerCommand('1c-platform-tools.configuration.dumpToSrc', () => {
			commands.configuration.dumpToSrc();
		}),
		vscode.commands.registerCommand('1c-platform-tools.configuration.dumpToCf', () => {
			commands.configuration.dumpToCf();
		}),
		vscode.commands.registerCommand('1c-platform-tools.configuration.dumpToDist', () => {
			commands.configuration.dumpToDist();
		}),
		vscode.commands.registerCommand('1c-platform-tools.configuration.build', () => {
			commands.configuration.compile();
		}),
		vscode.commands.registerCommand('1c-platform-tools.configuration.decompile', () => {
			commands.configuration.decompile();
		})
	];

	// Команды расширений
	const extensionsCommands = [
		vscode.commands.registerCommand('1c-platform-tools.extensions.loadFromSrc', () => {
			commands.extensions.loadFromSrc();
		}),
		vscode.commands.registerCommand('1c-platform-tools.extensions.loadFromCfe', () => {
			commands.extensions.loadFromCfe();
		}),
		vscode.commands.registerCommand('1c-platform-tools.extensions.dumpToSrc', () => {
			commands.extensions.dumpToSrc();
		}),
		vscode.commands.registerCommand('1c-platform-tools.extensions.dumpToCfe', () => {
			commands.extensions.dumpToCfe();
		}),
		vscode.commands.registerCommand('1c-platform-tools.extensions.build', () => {
			commands.extensions.compile();
		}),
		vscode.commands.registerCommand('1c-platform-tools.extensions.decompile', () => {
			commands.extensions.decompile();
		})
	];

	// Команды внешних файлов
	const externalFilesCommands = [
		vscode.commands.registerCommand('1c-platform-tools.externalProcessors.build', () => {
			commands.externalFiles.compile('processor');
		}),
		vscode.commands.registerCommand('1c-platform-tools.externalProcessors.decompile', () => {
			commands.externalFiles.decompile('processor');
		}),
		vscode.commands.registerCommand('1c-platform-tools.externalReports.build', () => {
			commands.externalFiles.compile('report');
		}),
		vscode.commands.registerCommand('1c-platform-tools.externalReports.decompile', () => {
			commands.externalFiles.decompile('report');
		}),
		vscode.commands.registerCommand('1c-platform-tools.externalFiles.clearCache', () => {
			commands.externalFiles.clearCache();
		})
	];

	// Команды зависимостей
	const dependenciesCommands = [
		vscode.commands.registerCommand('1c-platform-tools.dependencies.install', () => {
			commands.dependencies.installDependencies();
		}),
		vscode.commands.registerCommand('1c-platform-tools.dependencies.remove', () => {
			commands.dependencies.removeDependencies();
		}),
		vscode.commands.registerCommand('1c-platform-tools.dependencies.initializePackagedef', () => {
			commands.dependencies.initializePackagedef();
		})
	];

	// Команды запуска
	const runCommands = [
		vscode.commands.registerCommand('1c-platform-tools.run.enterprise', () => {
			commands.run.runEnterprise();
		}),
		vscode.commands.registerCommand('1c-platform-tools.run.designer', () => {
			commands.run.runDesigner();
		})
	];

	// Команды тестирования
	const testCommands = [
		vscode.commands.registerCommand('1c-platform-tools.test.xunit', () => {
			commands.test.runXUnit();
		}),
		vscode.commands.registerCommand('1c-platform-tools.test.syntaxCheck', () => {
			commands.test.runSyntaxCheck();
		}),
		vscode.commands.registerCommand('1c-platform-tools.test.vanessa', () => {
			commands.test.runVanessa('normal');
		}),
		vscode.commands.registerCommand('1c-platform-tools.test.allure', () => {
			commands.test.generateAllureReport();
		})
	];

	// Команды сборки и разбора (алиасы)
	const buildDecompileCommands = [
		vscode.commands.registerCommand('1c-platform-tools.build.configuration', () => {
			commands.configuration.compile();
		}),
		vscode.commands.registerCommand('1c-platform-tools.build.extensions', () => {
			commands.extensions.compile();
		}),
		vscode.commands.registerCommand('1c-platform-tools.build.externalProcessor', () => {
			commands.externalFiles.compile();
		}),
		vscode.commands.registerCommand('1c-platform-tools.build.externalReport', () => {
			commands.externalFiles.compile();
		}),
		vscode.commands.registerCommand('1c-platform-tools.decompile.configuration', () => {
			commands.configuration.decompile();
		}),
		vscode.commands.registerCommand('1c-platform-tools.decompile.externalProcessor', () => {
			commands.externalFiles.decompile();
		}),
		vscode.commands.registerCommand('1c-platform-tools.decompile.externalReport', () => {
			commands.externalFiles.decompile();
		}),
		vscode.commands.registerCommand('1c-platform-tools.decompile.extension', () => {
			commands.extensions.decompile();
		})
	];

	// Команда редактирования env.json
	const vrunnerManager = VRunnerManager.getInstance();
	const envEditCommand = vscode.commands.registerCommand('1c-platform-tools.config.env.edit', async () => {
		const workspaceRoot = vrunnerManager.getWorkspaceRoot();
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
			return;
		}
		const envPath = vscode.Uri.file(path.join(workspaceRoot, 'env.json'));
		const doc = await vscode.workspace.openTextDocument(envPath);
		await vscode.window.showTextDocument(doc);
	});

	disposables.push(
		...infobaseCommands,
		...configurationCommands,
		...extensionsCommands,
		...externalFilesCommands,
		...dependenciesCommands,
		...runCommands,
		...testCommands,
		...buildDecompileCommands,
		envEditCommand
	);

	return disposables;
}

