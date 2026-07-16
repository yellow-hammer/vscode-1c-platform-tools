import * as vscode from 'vscode';
import * as path from 'node:path';
import { logger } from '../shared/logger';
import { InfobaseCommands } from './infobaseCommands';
import { ConfigurationCommands } from './configurationCommands';
import { ExtensionsCommands } from './extensionsCommands';
import { ExternalFilesCommands } from './externalFilesCommands';
import { SupportCommands } from './supportCommands';
import { DependenciesCommands } from './dependenciesCommands';
import { RunCommands } from './runCommands';
import { TestCommands } from './testCommands';
import { SetVersionCommands } from './setVersionCommands';
import { WorkspaceTasksCommands } from './workspaceTasksCommands';
import { ArtifactCommands } from './artifactCommands';
import { SkillsCommands } from './skillsCommands';
import { ServiceFilesCommands } from './serviceFilesCommands';
import { VRunnerManager } from '../shared/vrunnerManager';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';

const log = logger.scope('commands');

/**
 * Объект со всеми командами расширения
 */
interface Commands {
	infobase: InfobaseCommands;
	configuration: ConfigurationCommands;
	extensions: ExtensionsCommands;
	externalFiles: ExternalFilesCommands;
	support: SupportCommands;
	dependencies: DependenciesCommands;
	run: RunCommands;
	test: TestCommands;
	setVersion: SetVersionCommands;
	workspaceTasks: WorkspaceTasksCommands;
	artifact: ArtifactCommands;
	skills: SkillsCommands;
	serviceFiles: ServiceFilesCommands;
}

function getActiveEditorResourceUri(): vscode.Uri | undefined {
	return (
		vscode.window.activeTextEditor?.document.uri ??
		(vscode.window.tabGroups.activeTabGroup?.activeTab?.input as { uri?: vscode.Uri })?.uri
	);
}

function registerFromEditor(
	id: string,
	handler: (uri: vscode.Uri) => void | Promise<void>
): vscode.Disposable {
	return vscode.commands.registerCommand(id, async () => {
		const uri = getActiveEditorResourceUri();
		if (uri) {
			await handler(uri);
		}
	});
}

/**
 * Регистрация vrunner-команды с поддержкой CommandExecutionOptions (MCP wait: true).
 */
function registerVRunnerCommand(
	id: string,
	handler: (opts?: CommandExecutionOptions) => Promise<StructuredCommandResult | void>
): vscode.Disposable {
	return vscode.commands.registerCommand(id, async (opts?: CommandExecutionOptions) => handler(opts));
}

/**
 * Регистрирует все команды расширения
 * 
 * @param context - Контекст расширения VS Code
 * @param commands - Объекты команд
 * @returns Массив Disposable для подписки в context.subscriptions
 */
export function registerCommands(
	context: vscode.ExtensionContext,
	commands: Commands
): vscode.Disposable[] {
	const disposables: vscode.Disposable[] = [];

	// Команды навыков для AI
	const skillsCommands = [
		vscode.commands.registerCommand('1c-platform-tools.skills.addDevSkills', (destination?: unknown) => {
			void commands.skills.addDevSkills(context, typeof destination === 'string' ? destination : undefined);
		}),
		vscode.commands.registerCommand('1c-platform-tools.skills.add1cpt', (destination?: unknown) => {
			void commands.skills.add1cptSkills(context, typeof destination === 'string' ? destination : undefined);
		}),
	];
	disposables.push(...skillsCommands);

	// Агентный вызов (MCP/IPC всегда передаёт объект опций) не должен открывать
	// окно выбора: пользователь может быть не за экраном (web-сессия, телефон)
	const rejectAgentInteractive = (arg: unknown, hint: string): StructuredCommandResult | undefined => {
		if (typeof arg === 'object' && arg !== null) {
			return {
				success: false,
				exitCode: 1,
				stdout: '',
				stderr: `Команда открывает окно выбора и недоступна агенту. ${hint}`,
			};
		}
		return undefined;
	};

	// Команды служебных файлов
	const serviceFilesCommands = [
		vscode.commands.registerCommand('1c-platform-tools.serviceFiles.create', (arg?: unknown) =>
			rejectAgentInteractive(arg, 'Используйте serviceFiles.createRecommendedSet, createGitignore, createGitattributes, createEnvJson или serviceFiles.ensure с id файла.')
				?? commands.serviceFiles.pickAndCreate()
		),
		vscode.commands.registerCommand('1c-platform-tools.serviceFiles.ensure', (specId?: unknown) => {
			if (typeof specId === 'string') {
				return commands.serviceFiles.ensure(specId);
			}
			return rejectAgentInteractive(specId, 'Передайте id служебного файла строкой (например, launchProfile).')
				?? commands.serviceFiles.pickAndCreate();
		}),
		vscode.commands.registerCommand('1c-platform-tools.serviceFiles.createGitignore', () =>
			commands.serviceFiles.createGitignore()
		),
		vscode.commands.registerCommand('1c-platform-tools.serviceFiles.createGitattributes', () =>
			commands.serviceFiles.createGitattributes()
		),
		vscode.commands.registerCommand('1c-platform-tools.serviceFiles.createEnvJson', () =>
			commands.serviceFiles.createEnvJson()
		),
		vscode.commands.registerCommand('1c-platform-tools.serviceFiles.createRecommendedSet', () =>
			commands.serviceFiles.createRecommendedSet()
		),
	];
	disposables.push(...serviceFilesCommands);

	// Команды информационных баз
	const infobaseCommands = [
		registerVRunnerCommand('1c-platform-tools.infobase.createEmpty', (opts) =>
			commands.infobase.createEmptyInfobase(opts)
		),
		registerVRunnerCommand('1c-platform-tools.infobase.updateInfobase', (opts) =>
			commands.infobase.updateInfobase(opts)
		),
		registerVRunnerCommand('1c-platform-tools.infobase.updateDatabase', (opts) =>
			commands.infobase.updateDatabase(opts)
		),
		registerVRunnerCommand('1c-platform-tools.infobase.blockExternalResources', (opts) =>
			commands.infobase.blockExternalResources(opts)
		),
		registerVRunnerCommand('1c-platform-tools.infobase.initialize', (opts) =>
			commands.infobase.initialize(opts)
		),
		registerVRunnerCommand('1c-platform-tools.infobase.dumpToDt', (opts) =>
			commands.infobase.dumpToDt(opts)
		),
		registerVRunnerCommand('1c-platform-tools.infobase.loadFromDt', (opts) =>
			commands.infobase.loadFromDt(opts)
		),
	];

	// Команды конфигурации
	const configurationCommands = [
		registerVRunnerCommand('1c-platform-tools.configuration.loadFromSrc', (opts) =>
			commands.configuration.loadFromSrc('update', opts)
		),
		registerVRunnerCommand('1c-platform-tools.configuration.loadFromSrc.init', (opts) =>
			commands.configuration.loadFromSrc('init', opts)
		),
		registerVRunnerCommand('1c-platform-tools.configuration.loadIncrementFromSrc', (opts) =>
			commands.configuration.loadIncrementFromSrc(opts)
		),
		registerVRunnerCommand('1c-platform-tools.configuration.loadFromFilesByList', (opts) =>
			commands.configuration.loadFromFilesByList(opts)
		),
		registerVRunnerCommand('1c-platform-tools.configuration.loadFromCf', (opts) =>
			commands.configuration.loadFromCf(opts)
		),
		registerVRunnerCommand('1c-platform-tools.configuration.dumpToSrc', (opts) =>
			commands.configuration.dumpToSrc(opts)
		),
		registerVRunnerCommand('1c-platform-tools.configuration.dumpIncrementToSrc', (opts) =>
			commands.configuration.dumpIncrementToSrc(opts)
		),
		registerVRunnerCommand('1c-platform-tools.configuration.dumpToCf', (opts) =>
			commands.configuration.dumpToCf(opts)
		),
		registerVRunnerCommand('1c-platform-tools.configuration.dumpToDist', (opts) =>
			commands.configuration.dumpToDist(opts)
		),
		registerVRunnerCommand('1c-platform-tools.configuration.build', (opts) =>
			commands.configuration.compile(opts)
		),
		registerVRunnerCommand('1c-platform-tools.configuration.decompile', (opts) =>
			commands.configuration.decompile(opts)
		),
	];

	// Команды расширений
	const extensionsCommands = [
		registerVRunnerCommand('1c-platform-tools.extensions.loadFromSrc', (opts) =>
			commands.extensions.loadFromSrc(opts)
		),
		registerVRunnerCommand('1c-platform-tools.extensions.loadFromFilesByList', (opts) =>
			commands.extensions.loadFromFilesByList(opts)
		),
		registerVRunnerCommand('1c-platform-tools.extensions.loadFromCfe', (opts) =>
			commands.extensions.loadFromCfe(opts)
		),
		registerVRunnerCommand('1c-platform-tools.extensions.dumpToSrc', (opts) =>
			commands.extensions.dumpToSrc(opts)
		),
		registerVRunnerCommand('1c-platform-tools.extensions.dumpToCfe', (opts) =>
			commands.extensions.dumpToCfe(opts)
		),
		registerVRunnerCommand('1c-platform-tools.extensions.build', (opts) =>
			commands.extensions.compile(opts)
		),
		registerVRunnerCommand('1c-platform-tools.extensions.decompile', (opts) =>
			commands.extensions.decompile(opts)
		),
		registerVRunnerCommand('1c-platform-tools.extensions.updateInInfobase', (opts) =>
			commands.extensions.updateInInfobase(opts)
		),
	];

	// Команды внешних файлов
	const externalFilesCommands = [
		registerVRunnerCommand('1c-platform-tools.externalProcessors.build', (opts) =>
			commands.externalFiles.compile('processor', opts)
		),
		registerVRunnerCommand('1c-platform-tools.externalProcessors.decompile', (opts) =>
			commands.externalFiles.decompile('processor', opts)
		),
		registerVRunnerCommand('1c-platform-tools.externalReports.build', (opts) =>
			commands.externalFiles.compile('report', opts)
		),
		registerVRunnerCommand('1c-platform-tools.externalReports.decompile', (opts) =>
			commands.externalFiles.decompile('report', opts)
		),
		registerVRunnerCommand('1c-platform-tools.externalFiles.clearCache', (opts) =>
			commands.externalFiles.clearCache(opts)
		),
	];

	// Команды поддержки и поставки
	const supportCommands = [
		vscode.commands.registerCommand('1c-platform-tools.support.updateCfg', () => {
			commands.support.updateCfg();
		}),
		vscode.commands.registerCommand('1c-platform-tools.support.disableCfgSupport', () => {
			commands.support.disableCfgSupport();
		}),
		vscode.commands.registerCommand('1c-platform-tools.support.createDeliveryDescriptionFile', () => {
			commands.support.createDeliveryDescriptionFile();
		}),
		vscode.commands.registerCommand('1c-platform-tools.support.createTemplateListFile', () => {
			commands.support.createTemplateListFile();
		}),
		vscode.commands.registerCommand('1c-platform-tools.support.createDistributivePackage', () => {
			commands.support.createDistributivePackage();
		}),
		vscode.commands.registerCommand('1c-platform-tools.support.createDistributionFiles', () => {
			commands.support.createDistributionFiles();
		})
	];

	// Команды зависимостей
	const dependenciesCommands = [
		vscode.commands.registerCommand('1c-platform-tools.dependencies.initializeProjectStructure', () => {
			commands.dependencies.initializeProjectStructure();
		}),
		vscode.commands.registerCommand('1c-platform-tools.dependencies.initializePackagedef', () => {
			commands.dependencies.initializePackagedef();
		}),
		vscode.commands.registerCommand('1c-platform-tools.project.createFromWelcome', () => {
			commands.dependencies.createProjectFromWelcome(context);
		}),
		vscode.commands.registerCommand('1c-platform-tools.dependencies.setupGit', () => {
			commands.dependencies.setupGit();
		}),
		vscode.commands.registerCommand('1c-platform-tools.dependencies.installOscript', () => {
			commands.dependencies.installOscript();
		}),
		vscode.commands.registerCommand('1c-platform-tools.dependencies.updateOpm', () => {
			commands.dependencies.updateOpm();
		}),
		vscode.commands.registerCommand('1c-platform-tools.dependencies.install', () => {
			commands.dependencies.installDependencies();
		}),
		vscode.commands.registerCommand('1c-platform-tools.dependencies.remove', () => {
			commands.dependencies.removeDependencies();
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
		registerVRunnerCommand('1c-platform-tools.test.xunit', (opts) => commands.test.runXUnit(opts)),
		registerVRunnerCommand('1c-platform-tools.test.syntaxCheck', (opts) =>
			commands.test.runSyntaxCheck(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.vanessa', (opts) =>
			commands.test.runVanessa('normal', opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.yaxunit', (opts) =>
			commands.test.runYAxUnit(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.allure', (opts) =>
			commands.test.generateAllureReport(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.buildEpf', (opts) =>
			commands.test.buildTestEpf(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.decompileEpf', (opts) =>
			commands.test.decompileTestEpf(opts)
		),
		registerVRunnerCommand('1c-platform-tools.enterprise.run', (opts) =>
			commands.test.runEnterpriseProcessor(opts)
		),
	];

	// Команды установки версий
	const setVersionCommands = [
		vscode.commands.registerCommand('1c-platform-tools.setVersion.configuration', () => {
			commands.setVersion.setVersionConfiguration();
		}),
		vscode.commands.registerCommand('1c-platform-tools.setVersion.extension', () => {
			commands.setVersion.setVersionExtension();
		}),
		vscode.commands.registerCommand('1c-platform-tools.setVersion.report', (reportName: string) => {
			commands.setVersion.setVersionReport(reportName);
		}),
		vscode.commands.registerCommand('1c-platform-tools.setVersion.processor', (processorName: string) => {
			commands.setVersion.setVersionProcessor(processorName);
		})
	];

	// Команды сборки и разбора (алиасы)
	const buildDecompileCommands = [
		registerVRunnerCommand('1c-platform-tools.build.configuration', (opts) =>
			commands.configuration.compile(opts)
		),
		registerVRunnerCommand('1c-platform-tools.build.extensions', (opts) =>
			commands.extensions.compile(opts)
		),
		registerVRunnerCommand('1c-platform-tools.build.externalProcessor', (opts) =>
			commands.externalFiles.compile('processor', opts)
		),
		registerVRunnerCommand('1c-platform-tools.build.externalReport', (opts) =>
			commands.externalFiles.compile('report', opts)
		),
		registerVRunnerCommand('1c-platform-tools.decompile.configuration', (opts) =>
			commands.configuration.decompile(opts)
		),
		registerVRunnerCommand('1c-platform-tools.decompile.externalProcessor', (opts) =>
			commands.externalFiles.decompile('processor', opts)
		),
		registerVRunnerCommand('1c-platform-tools.decompile.externalReport', (opts) =>
			commands.externalFiles.decompile('report', opts)
		),
		registerVRunnerCommand('1c-platform-tools.decompile.extension', (opts) =>
			commands.extensions.decompile(opts)
		),
	];

	const artifactCommands = [
		vscode.commands.registerCommand('1c-platform-tools.artifacts.open', (element: vscode.TreeItem) => {
			const openUri =
				(element as vscode.TreeItem & { openTargetUri?: vscode.Uri }).openTargetUri ??
				element.resourceUri;
			if (openUri) {
				void commands.artifact.open(openUri);
			}
		}),
		vscode.commands.registerCommand('1c-platform-tools.artifacts.buildConfiguration', (element: vscode.TreeItem) => {
			if (element.resourceUri) {
				void commands.artifact.buildConfiguration(element.resourceUri);
			}
		}),
		vscode.commands.registerCommand('1c-platform-tools.artifacts.decompileConfiguration', (element: vscode.TreeItem) => {
			if (element.resourceUri) {
				void commands.artifact.decompileConfiguration(element.resourceUri);
			}
		}),
		vscode.commands.registerCommand('1c-platform-tools.artifacts.buildExtension', (element: vscode.TreeItem) => {
			if (element.resourceUri) {
				void commands.artifact.buildExtension(element.resourceUri);
			}
		}),
		vscode.commands.registerCommand('1c-platform-tools.artifacts.decompileExtension', (element: vscode.TreeItem) => {
			if (element.resourceUri) {
				void commands.artifact.decompileExtension(element.resourceUri);
			}
		}),
		vscode.commands.registerCommand('1c-platform-tools.artifacts.buildProcessor', (element: vscode.TreeItem) => {
			if (element.resourceUri) {
				void commands.artifact.buildProcessor(element.resourceUri);
			}
		}),
		vscode.commands.registerCommand('1c-platform-tools.artifacts.decompileProcessor', (element: vscode.TreeItem) => {
			if (element.resourceUri) {
				void commands.artifact.decompileProcessor(element.resourceUri);
			}
		}),
		vscode.commands.registerCommand('1c-platform-tools.artifacts.buildReport', (element: vscode.TreeItem) => {
			if (element.resourceUri) {
				void commands.artifact.buildReport(element.resourceUri);
			}
		}),
		vscode.commands.registerCommand('1c-platform-tools.artifacts.decompileReport', (element: vscode.TreeItem) => {
			if (element.resourceUri) {
				void commands.artifact.decompileReport(element.resourceUri);
			}
		}),
		vscode.commands.registerCommand('1c-platform-tools.artifacts.delete', (element: vscode.TreeItem) => {
			if (element.resourceUri) {
				void commands.artifact.delete(element.resourceUri);
			}
		}),
		registerFromEditor('1c-platform-tools.artifacts.decompileConfiguration.fromEditor', (u) =>
			commands.artifact.decompileConfiguration(u)
		),
		registerFromEditor('1c-platform-tools.artifacts.decompileExtension.fromEditor', (u) =>
			commands.artifact.decompileExtension(u)
		),
		registerFromEditor('1c-platform-tools.artifacts.decompileProcessor.fromEditor', (u) =>
			commands.artifact.decompileProcessor(u)
		),
		registerFromEditor('1c-platform-tools.artifacts.decompileReport.fromEditor', (u) =>
			commands.artifact.decompileReport(u)
		),
	];

	// Команда редактирования env.json
	const vrunnerManager = VRunnerManager.getInstance();
	const envEditCommand = vscode.commands.registerCommand('1c-platform-tools.config.env.edit', async () => {
		const workspaceRoot = vrunnerManager.getWorkspaceRoot();
		if (!workspaceRoot) {
			log.warn('Команда env.edit вызвана без открытой рабочей области');
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
		...supportCommands,
		...dependenciesCommands,
		...runCommands,
		...testCommands,
		...setVersionCommands,
		...buildDecompileCommands,
		...artifactCommands,
		envEditCommand
	);

	return disposables;
}

