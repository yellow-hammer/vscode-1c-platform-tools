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
import { SessionCommands } from './sessionCommands';
import { PipelineCommands } from './pipelineCommands';
import { HooksCommands } from './hooksCommands';
import { SetVersionCommands } from './setVersionCommands';
import { WorkspaceTasksCommands } from './workspaceTasksCommands';
import { ArtifactCommands } from './artifactCommands';
import { SkillsCommands } from './skillsCommands';
import { ServiceFilesCommands } from './serviceFilesCommands';
import { ODataCommands } from './odataCommands';
import { VRunnerManager } from '../shared/vrunnerManager';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';
import { isAgentOptions, agentInteractiveError, uiOnlyHandler } from '../shared/agentGate';
import { askGithubToken, forgetGithubToken } from '../shared/githubToken';
import { withWorkspaceTrust } from '../shared/workspaceTrust';
import { inCurrentProject, inProjectOf } from './projectScope';

const log = logger.scope('commands');

/** Команда, которая выполняется в проекте, текущем на момент вызова. */
function registerProjectCommand<A extends unknown[], R>(id: string, handler: (...args: A) => R): vscode.Disposable {
	return vscode.commands.registerCommand(id, inCurrentProject(handler));
}

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
	session: SessionCommands;
	pipelines: PipelineCommands;
	hooks: HooksCommands;
	odata: ODataCommands;
}

function getActiveEditorResourceUri(): vscode.Uri | undefined {
	return (
		vscode.window.activeTextEditor?.document.uri ??
		(vscode.window.tabGroups.activeTabGroup?.activeTab?.input as { uri?: vscode.Uri })?.uri
	);
}

/** Команда над файлом активного редактора: разборка артефакта запускает платформу. */
function registerFromEditor(
	id: string,
	handler: (uri: vscode.Uri) => void | Promise<void>
): vscode.Disposable {
	return vscode.commands.registerCommand(id, withWorkspaceTrust(id, async () => {
		const uri = getActiveEditorResourceUri();
		if (uri) {
			await inProjectOf(uri, () => handler(uri));
		}
	}));
}

/**
 * Регистрация vrunner-команды с поддержкой CommandExecutionOptions (MCP wait: true).
 */
function registerVRunnerCommand(
	id: string,
	handler: (opts?: CommandExecutionOptions) => Promise<StructuredCommandResult | void>
): vscode.Disposable {
	return registerProjectCommand(id, withWorkspaceTrust(id, handler));
}

/**
 * Команда проекта, которая запускает платформу или vrunner мимо
 * {@link registerVRunnerCommand}: мастера установки версии.
 */
function registerRunningCommand<A extends unknown[]>(
	id: string,
	handler: (...args: A) => unknown
): vscode.Disposable {
	return registerProjectCommand(id, withWorkspaceTrust(id, handler));
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
		registerProjectCommand('1c-platform-tools.mcp.configureCursor', async () => {
			// Команда живёт в расширении 1C: Platform Tools MCP: оно пишет
			// .cursor/mcp.json с актуальным путём к своему серверу
			const mcpExtension = vscode.extensions.getExtension('yellow-hammer.mcp-1c-platform-tools');
			if (!mcpExtension) {
				const install = 'Установить расширение';
				const action = await vscode.window.showWarningMessage(
					'Расширение «1C: Platform Tools MCP» не установлено: оно предоставляет MCP-сервер и настраивает его для Cursor.',
					install
				);
				if (action === install) {
					await vscode.commands.executeCommand(
						'workbench.extensions.search',
						'yellow-hammer.mcp-1c-platform-tools'
					);
				}
				return;
			}
			await mcpExtension.activate();
			await vscode.commands.executeCommand('mcp-1c-platform-tools.configureCursor');
		}),
		registerProjectCommand('1c-platform-tools.skills.addDevSkills', (destination?: unknown) => {
			if (isAgentOptions(destination)) {
				return agentInteractiveError('Передайте назначение строкой: claude, cursor, copilot или путь к папке.');
			}
			void commands.skills.addDevSkills(context, typeof destination === 'string' ? destination : undefined);
		}),
		registerProjectCommand('1c-platform-tools.skills.add1cpt', (destination?: unknown) => {
			if (isAgentOptions(destination)) {
				return agentInteractiveError('Передайте назначение строкой: claude, cursor, copilot или путь к папке.');
			}
			void commands.skills.add1cptSkills(context, typeof destination === 'string' ? destination : undefined);
		}),
		registerProjectCommand('1c-platform-tools.skills.addOnescript', (destination?: unknown) => {
			if (isAgentOptions(destination)) {
				return agentInteractiveError('Передайте назначение строкой: claude, cursor, copilot или путь к папке.');
			}
			void commands.skills.addOnescriptSkills(context, typeof destination === 'string' ? destination : undefined);
		}),
		registerProjectCommand('1c-platform-tools.skills.addVanessaAutomation', (destination?: unknown) => {
			if (isAgentOptions(destination)) {
				return agentInteractiveError('Передайте назначение строкой: claude, cursor, copilot или путь к папке.');
			}
			void commands.skills.addVanessaAutomationSkills(context, typeof destination === 'string' ? destination : undefined);
		}),
		registerProjectCommand('1c-platform-tools.skills.addYaxunit', (destination?: unknown) => {
			if (isAgentOptions(destination)) {
				return agentInteractiveError('Передайте назначение строкой: claude, cursor, copilot или путь к папке.');
			}
			void commands.skills.addYaxunitSkills(context, typeof destination === 'string' ? destination : undefined);
		}),
		registerProjectCommand('1c-platform-tools.skills.addXunit', (destination?: unknown) => {
			if (isAgentOptions(destination)) {
				return agentInteractiveError('Передайте назначение строкой: claude, cursor, copilot или путь к папке.');
			}
			void commands.skills.addXunitSkills(context, typeof destination === 'string' ? destination : undefined);
		}),
	];
	disposables.push(...skillsCommands);

	// Команды служебных файлов
	const serviceFilesCommands = [
		registerProjectCommand('1c-platform-tools.serviceFiles.create', uiOnlyHandler(
			'Используйте serviceFiles.createRecommendedSet, createGitignore, createGitattributes, createEnvJson или serviceFiles.ensure с id файла.',
			() => commands.serviceFiles.pickAndCreate()
		)),
		registerProjectCommand('1c-platform-tools.serviceFiles.ensure', (specId?: unknown, opts?: unknown) => {
			if (typeof specId === 'string') {
				// второй аргумент-объект — агентный вызов: без окна выбора секций
				return commands.serviceFiles.ensure(specId, isAgentOptions(opts));
			}
			if (isAgentOptions(specId)) {
				return agentInteractiveError('Передайте id служебного файла строкой (например, launchProfile).');
			}
			return commands.serviceFiles.pickAndCreate();
		}),
		registerProjectCommand('1c-platform-tools.serviceFiles.createGitignore', () =>
			commands.serviceFiles.createGitignore()
		),
		registerProjectCommand('1c-platform-tools.serviceFiles.createGitattributes', () =>
			commands.serviceFiles.createGitattributes()
		),
		registerProjectCommand('1c-platform-tools.serviceFiles.createEnvJson', () =>
			commands.serviceFiles.createEnvJson()
		),
		registerProjectCommand('1c-platform-tools.serviceFiles.createRecommendedSet', () =>
			commands.serviceFiles.createRecommendedSet()
		),
	];
	disposables.push(...serviceFilesCommands);

	// Команды информационных баз
	const infobaseCommands = [
		registerVRunnerCommand('1c-platform-tools.infobase.create', (opts) =>
			commands.infobase.createEmptyInfobase(opts)
		),
		registerVRunnerCommand('1c-platform-tools.infobase.updateDb', (opts) =>
			commands.infobase.updateInfobase(opts)
		),
		registerVRunnerCommand('1c-platform-tools.infobase.runUpdateHandlers', (opts) =>
			commands.infobase.updateDatabase(opts)
		),
		registerVRunnerCommand('1c-platform-tools.infobase.blockExternalResources', (opts) =>
			commands.infobase.blockExternalResources(opts)
		),
		registerVRunnerCommand('1c-platform-tools.infobase.initialize', (opts) =>
			commands.infobase.initialize(opts)
		),
		registerVRunnerCommand('1c-platform-tools.infobase.dumpDt', (opts) =>
			commands.infobase.dumpToDt(opts)
		),
		registerVRunnerCommand('1c-platform-tools.infobase.restoreDt', (opts) =>
			commands.infobase.loadFromDt(opts)
		),
	];

	// Команды сеансов информационной базы (через rac и ras)
	const sessionCommands = [
		registerVRunnerCommand('1c-platform-tools.session.lock', (opts) =>
			commands.session.lock(opts)
		),
		registerVRunnerCommand('1c-platform-tools.session.unlock', (opts) =>
			commands.session.unlock(opts)
		),
		registerVRunnerCommand('1c-platform-tools.session.kill', (opts) =>
			commands.session.kill(opts)
		),
		registerVRunnerCommand('1c-platform-tools.session.list', (opts) =>
			commands.session.list(opts)
		),
		registerVRunnerCommand('1c-platform-tools.session.checkClosed', (opts) =>
			commands.session.checkClosed(opts)
		),
		registerVRunnerCommand('1c-platform-tools.session.lockJobs', (opts) =>
			commands.session.lockScheduledJobs(opts)
		),
		registerVRunnerCommand('1c-platform-tools.session.unlockJobs', (opts) =>
			commands.session.unlockScheduledJobs(opts)
		),
	];

	// Пайплайны и хуки: автоматизация вокруг команд расширения
	const pipelineCommands = [
		registerVRunnerCommand('1c-platform-tools.pipelines.run', (opts) =>
			commands.pipelines.run(opts)
		),
		registerRunningCommand('1c-platform-tools.pipelines.runWith', uiOnlyHandler(
			'Профиль и окружение прогона выбираются в окне VS Code; агенту — pipelines.run с параметрами profile и environment.',
			(source?: unknown) => commands.pipelines.runWith(source as { pipelineId?: string } | undefined)
		)),
		registerProjectCommand('1c-platform-tools.pipelines.openEditor', (pipelineId?: string) =>
			commands.pipelines.openEditor(typeof pipelineId === 'string' ? pipelineId : undefined)
		),
		registerProjectCommand('1c-platform-tools.pipelines.addTemplates', () =>
			commands.pipelines.addTemplates()
		),
		registerProjectCommand('1c-platform-tools.hooks.openEditor', (commandId?: string) =>
			commands.hooks.openEditor(typeof commandId === 'string' ? commandId : undefined)
		),
	];

	// Команды конфигурации
	const configurationCommands = [
		registerVRunnerCommand('1c-platform-tools.cf.load', (opts) =>
			commands.configuration.loadFromSrc('load', opts)
		),
		registerVRunnerCommand('1c-platform-tools.infobase.initFromSrc', (opts) =>
			commands.configuration.loadFromSrc('init', opts)
		),
		registerVRunnerCommand('1c-platform-tools.cf.loadIncrement', (opts) =>
			commands.configuration.loadIncrementFromSrc(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cf.loadByList', (opts) =>
			commands.configuration.loadFromFilesByList(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cf.loadFile', (opts) =>
			commands.configuration.loadFromCf(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cf.dump', (opts) =>
			commands.configuration.dumpToSrc(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cf.dumpIncrement', (opts) =>
			commands.configuration.dumpIncrementToSrc(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cf.unload', (opts) =>
			commands.configuration.dumpToCf(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cf.makeDist', (opts) =>
			commands.configuration.dumpToDist(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cf.compile', (opts) =>
			commands.configuration.compile(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cf.decompile', (opts) =>
			commands.configuration.decompile(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cf.convert', (opts) =>
			commands.configuration.convertSources(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cfe.convert', (opts) =>
			commands.extensions.convertExtensionSources(opts)
		),
	];

	// Команды расширений
	const extensionsCommands = [
		registerVRunnerCommand('1c-platform-tools.cfe.load', (opts) =>
			commands.extensions.loadFromSrc(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cfe.loadByList', (opts) =>
			commands.extensions.loadFromFilesByList(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cfe.loadFile', (opts) =>
			commands.extensions.loadFromCfe(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cfe.dump', (opts) =>
			commands.extensions.dumpToSrc(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cfe.unload', (opts) =>
			commands.extensions.dumpToCfe(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cfe.compile', (opts) =>
			commands.extensions.compile(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cfe.decompile', (opts) =>
			commands.extensions.decompile(opts)
		),
		registerVRunnerCommand('1c-platform-tools.cfe.updateDb', (opts) =>
			commands.extensions.updateInInfobase(opts)
		),
	];

	// Команды внешних файлов
	const externalFilesCommands = [
		registerVRunnerCommand('1c-platform-tools.epf.compileProcessor', (opts) =>
			commands.externalFiles.compile('processor', opts)
		),
		registerVRunnerCommand('1c-platform-tools.epf.decompileProcessor', (opts) =>
			commands.externalFiles.decompile('processor', opts)
		),
		registerVRunnerCommand('1c-platform-tools.epf.compileReport', (opts) =>
			commands.externalFiles.compile('report', opts)
		),
		registerVRunnerCommand('1c-platform-tools.epf.decompileReport', (opts) =>
			commands.externalFiles.decompile('report', opts)
		),
		registerVRunnerCommand('1c-platform-tools.epf.clearCache', (opts) =>
			commands.externalFiles.clearCache(opts)
		),
	];

	// Команды поддержки и поставки: мастера с выбором файлов и параметров,
	// агентный вызов отклоняется гейтом до открытия окон
	const supportUiHint = 'Мастер поддержки/поставки выполняется пользователем в VS Code.';
	const supportCommands = [
		registerProjectCommand('1c-platform-tools.support.updateCfg', uiOnlyHandler(supportUiHint, () => {
			commands.support.updateCfg();
		})),
		registerProjectCommand('1c-platform-tools.support.disableCfgSupport', uiOnlyHandler(supportUiHint, () => {
			commands.support.disableCfgSupport();
		})),
		registerProjectCommand('1c-platform-tools.support.createDeliveryDescriptionFile', uiOnlyHandler(supportUiHint, () => {
			commands.support.createDeliveryDescriptionFile();
		})),
		registerProjectCommand('1c-platform-tools.support.createTemplateListFile', uiOnlyHandler(supportUiHint, () => {
			commands.support.createTemplateListFile();
		})),
		registerProjectCommand('1c-platform-tools.support.createDistributivePackage', uiOnlyHandler(supportUiHint, () => {
			commands.support.createDistributivePackage();
		})),
		registerProjectCommand('1c-platform-tools.support.createDistributionFiles', uiOnlyHandler(supportUiHint, () => {
			commands.support.createDistributionFiles();
		}))
	];

	// Команды зависимостей
	const dependenciesCommands = [
		// Создают проект и делают его текущим: корень вызова не закрепляется
		vscode.commands.registerCommand('1c-platform-tools.dependencies.initializeProjectStructure', () => {
			commands.dependencies.initializeProjectStructure();
		}),
		vscode.commands.registerCommand('1c-platform-tools.dependencies.initializePackagedef', (arg?: unknown, opts?: unknown) =>
			commands.dependencies.initializePackagedef(arg, opts)
		),
		vscode.commands.registerCommand('1c-platform-tools.projects.create', () => {
			commands.dependencies.createProjectFromWelcome(context);
		}),
		registerProjectCommand('1c-platform-tools.dependencies.setupGit', uiOnlyHandler('Мастер настройки git выполняется пользователем; для агента настройте git командами git config.', () => {
			commands.dependencies.setupGit();
		})),
		registerProjectCommand('1c-platform-tools.dependencies.installOscript', () => {
			commands.dependencies.installOscript();
		}),
		registerProjectCommand('1c-platform-tools.dependencies.updateOpm', () => {
			commands.dependencies.updateOpm();
		}),
		registerProjectCommand('1c-platform-tools.dependencies.install', () => {
			commands.dependencies.installDependencies();
		}),
		registerProjectCommand('1c-platform-tools.dependencies.remove', () => {
			commands.dependencies.removeDependencies();
		}),
		registerProjectCommand('1c-platform-tools.components.setGithubToken', uiOnlyHandler(
			'Токен вводит пользователь в поле с маскировкой; агенту секрет не передаётся.',
			() => askGithubToken()
		)),
		registerProjectCommand('1c-platform-tools.components.forgetGithubToken', () => {
			void forgetGithubToken();
		})
	];

	// Команды запуска
	const runCommands = [
		registerVRunnerCommand('1c-platform-tools.run.enterprise', (opts) =>
			commands.run.runEnterprise(opts)
		),
		registerVRunnerCommand('1c-platform-tools.run.designer', (opts) =>
			commands.run.runDesigner(opts)
		)
	];

	// Стандартный интерфейс OData: запросы к данным и состав интерфейса
	const odataCommands = [
		registerVRunnerCommand('1c-platform-tools.odata.query', (opts) => commands.odata.query(opts)),
		registerVRunnerCommand('1c-platform-tools.odata.setup', (opts) => commands.odata.setup(opts)),
	];

	// Команды тестирования
	const testCommands = [
		registerVRunnerCommand('1c-platform-tools.test.xunit', (opts) => commands.test.runXUnit(opts)),
		registerVRunnerCommand('1c-platform-tools.syntaxCheck.run', (opts) =>
			commands.test.runSyntaxCheck(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.validateEdt', (opts) =>
			commands.test.runEdtValidate(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.vanessa', (opts) =>
			commands.test.runVanessa('normal', opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.yaxunit', (opts) =>
			commands.test.runYAxUnit(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.mutatos', (opts) =>
			commands.test.runMutationTesting(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.mutatosReport', () =>
			commands.test.openMutationReport()
		),
		registerVRunnerCommand('1c-platform-tools.test.allure', (opts) =>
			commands.test.generateAllureReport(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.loadExtensions', (opts) =>
			commands.extensions.loadTestsFromSrc(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.compileExtensions', (opts) =>
			commands.extensions.buildTests(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.dumpExtensions', (opts) =>
			commands.extensions.dumpTestsToSrc(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.decompileExtensions', (opts) =>
			commands.extensions.decompileTests(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.addYaxunit', (opts) =>
			commands.extensions.addYaxunit(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.compileEpf', (opts) =>
			commands.test.buildTestEpf(opts)
		),
		registerVRunnerCommand('1c-platform-tools.test.decompileEpf', (opts) =>
			commands.test.decompileTestEpf(opts)
		),
		registerVRunnerCommand('1c-platform-tools.epf.run', (opts) =>
			commands.test.runEnterpriseProcessor(opts)
		),
	];

	// Команды установки версий: версия и объект запрашиваются в UI,
	// агентный вызов отклоняется гейтом
	const setVersionUiHint = 'Версия запрашивается в окне VS Code; выполняется пользователем.';
	const setVersionCommands = [
		registerRunningCommand('1c-platform-tools.cf.setVersion', uiOnlyHandler(setVersionUiHint, () => {
			commands.setVersion.setVersionConfiguration();
		})),
		registerRunningCommand('1c-platform-tools.cfe.setVersion', uiOnlyHandler(setVersionUiHint, () => {
			commands.setVersion.setVersionExtension();
		})),
		registerRunningCommand('1c-platform-tools.epf.setVersionReport', uiOnlyHandler(setVersionUiHint, (reportName?: unknown) => {
			commands.setVersion.setVersionReport(typeof reportName === 'string' ? reportName : undefined);
		})),
		registerRunningCommand('1c-platform-tools.epf.setVersionProcessor', uiOnlyHandler(setVersionUiHint, (processorName?: unknown) => {
			commands.setVersion.setVersionProcessor(typeof processorName === 'string' ? processorName : undefined);
		}))
	];


	// Узел артефакта выполняется в проекте своего файла, выбор проекта не меняется
	const onArtifactNode = (handler: (uri: vscode.Uri) => Promise<void>) => (element: vscode.TreeItem): void => {
		const uri = element.resourceUri;
		if (uri) {
			void inProjectOf(uri, () => handler(uri));
		}
	};
	/** Узел артефакта: сборка и разборка запускают платформу. */
	const registerArtifactCommand = (id: string, handler: (uri: vscode.Uri) => Promise<void>): vscode.Disposable =>
		vscode.commands.registerCommand(id, withWorkspaceTrust(id, onArtifactNode(handler)));
	const artifactCommands = [
		vscode.commands.registerCommand('1c-platform-tools.artifacts.open', (element: vscode.TreeItem) => {
			const openUri =
				(element as vscode.TreeItem & { openTargetUri?: vscode.Uri }).openTargetUri ??
				element.resourceUri;
			if (openUri) {
				void inProjectOf(openUri, () => commands.artifact.open(openUri));
			}
		}),
		registerArtifactCommand('1c-platform-tools.artifacts.compileConfiguration', (uri) => commands.artifact.buildConfiguration(uri)),
		registerArtifactCommand('1c-platform-tools.artifacts.decompileConfiguration', (uri) => commands.artifact.decompileConfiguration(uri)),
		registerArtifactCommand('1c-platform-tools.artifacts.compileExtension', (uri) => commands.artifact.buildExtension(uri)),
		registerArtifactCommand('1c-platform-tools.artifacts.decompileExtension', (uri) => commands.artifact.decompileExtension(uri)),
		registerArtifactCommand('1c-platform-tools.artifacts.compileProcessor', (uri) => commands.artifact.buildProcessor(uri)),
		registerArtifactCommand('1c-platform-tools.artifacts.decompileProcessor', (uri) => commands.artifact.decompileProcessor(uri)),
		registerArtifactCommand('1c-platform-tools.artifacts.compileReport', (uri) => commands.artifact.buildReport(uri)),
		registerArtifactCommand('1c-platform-tools.artifacts.decompileReport', (uri) => commands.artifact.decompileReport(uri)),
		// Удаление файла сборки процессов не запускает
		vscode.commands.registerCommand(
			'1c-platform-tools.artifacts.delete',
			onArtifactNode((uri) => commands.artifact.delete(uri))
		),
		registerFromEditor('1c-platform-tools.artifacts.decompileConfigurationFromEditor', (u) =>
			commands.artifact.decompileConfiguration(u)
		),
		registerFromEditor('1c-platform-tools.artifacts.decompileExtensionFromEditor', (u) =>
			commands.artifact.decompileExtension(u)
		),
		registerFromEditor('1c-platform-tools.artifacts.decompileProcessorFromEditor', (u) =>
			commands.artifact.decompileProcessor(u)
		),
		registerFromEditor('1c-platform-tools.artifacts.decompileReportFromEditor', (u) =>
			commands.artifact.decompileReport(u)
		),
	];

	// Команда редактирования env.json
	const vrunnerManager = VRunnerManager.getInstance();
	const envEditCommand = registerProjectCommand('1c-platform-tools.env.editSettingsFile', async () => {
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
		...sessionCommands,
		...pipelineCommands,
		...configurationCommands,
		...extensionsCommands,
		...externalFilesCommands,
		...supportCommands,
		...dependenciesCommands,
		...runCommands,
		...odataCommands,
		...testCommands,
		...setVersionCommands,
		...artifactCommands,
		envEditCommand
	);

	return disposables;
}

