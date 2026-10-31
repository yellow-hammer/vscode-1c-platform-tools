import * as vscode from 'vscode';
import { ProfileEditorProvider } from '../features/profileEditor/profileEditorProvider';
import { PipelineEditorProvider } from '../features/pipelines/pipelineEditorProvider';
import { PipelineTaskProvider } from '../features/pipelines/pipelineTaskProvider';
import { registerFormSaveCommand } from '../features/editors/formPanels';
import { HooksEditorProvider } from '../features/hooks/hooksEditorProvider';
import { ArtifactPreviewProvider } from '../features/artifacts/artifactPreviewProvider';
import { SpreadsheetEditorProvider } from '../features/spreadsheet/spreadsheetEditorProvider';
import { VRunnerManager } from '../shared/vrunnerManager';
import { registerHelpAndSettingsCommands } from '../features/tools/registerHelpAndSettingsCommands';
import { registerDebugFeature } from '../features/debug/registerDebugFeature';
import {
	detectAndSetInitialProjectContext,
	registerProjectCreatedHandler,
	runPostOpenProjectWorkflow,
} from './projectLifecycle';
import { registerCoreCommands } from './registerCoreCommands';
import { createShowNot1CProjectMessage } from './projectUi';
import { registerWelcomeFlow } from './registerWelcomeFlow';
import { registerInfrastructure } from './registerInfrastructure';
import { createExtensionApi, type PlatformToolsApi } from './extensionApi';
import { registerProjectsFlow } from './registerProjectsFlow';
import { registerMetadataFlow } from './registerMetadataFlow';
import { registerPropertiesFlow } from './registerPropertiesFlow';
import { checkMdSparrowUpdateInBackground } from '../features/metadata/mdSparrowBootstrap';
import { registerArtifactsFlow } from './registerArtifactsFlow';
import { registerTodoFlow } from './registerTodoFlow';
import { registerMainTreeFlow } from './registerMainTreeFlow';
import { registerTestingFlow } from './registerTestingFlow';
import { registerEdtFeature } from '../features/edt/registerEdtFeature';
import { registerLaunchFeature } from '../features/launch/launchFeature';
import { registerPlatformServerFeature } from '../features/launch/platformServerFeature';
import { registerDiagnosticsFeature } from '../features/diagnostics/registerDiagnosticsFeature';
import { SourceTerminalLinkProvider } from '../features/tools/terminalLinks';
import { registerTasksFeature } from '../features/tasks/registerTasksFeature';
import { registerClustersFeature } from '../features/clusters/registerClustersFeature';
import { registerIbasesFeature } from '../features/ibases/registerIbasesFeature';
import { initGithubToken } from '../shared/githubToken';
import { initTerminalEnv } from '../shared/terminalEnv';
import { onWorkspaceTrustGranted } from '../shared/workspaceTrust';
import { registerProjectLayoutWatch } from '../shared/projectLayoutWatch';
import { hasProjects, initWorkspaceProjects, onDidChangeCurrentProject } from '../shared/workspaceProjects';

/**
 * Выполняет полную инициализацию расширения.
 *
 * @returns API расширения для других расширений
 */
export async function bootstrapApp(context: vscode.ExtensionContext): Promise<PlatformToolsApi> {
	// До первой загрузки компонентов: иначе первые запросы уйдут анонимными
	await initGithubToken(context);
	initTerminalEnv(context.environmentVariableCollection);

	// Раньше всего, что читает корень проекта или раскладку
	registerProjectLayoutWatch(context);
	context.subscriptions.push(initWorkspaceProjects(context));

	const { registerRuntime: registerProjectsRuntime } = registerProjectsFlow(context);

	// Панель «1С: Администрирование» не зависит от открытого проекта: список баз
	// и консоль кластера нужны и без исходников в рабочей области.
	const clustersFeatureDisposables = registerClustersFeature(context);
	const ibasesFeatureDisposables = registerIbasesFeature();

	registerDebugFeature(context);
	context.subscriptions.push(ProfileEditorProvider.register(context));
	context.subscriptions.push(PipelineEditorProvider.register(context.extensionUri));
	context.subscriptions.push(PipelineTaskProvider.register());
	context.subscriptions.push(registerFormSaveCommand());
	context.subscriptions.push(HooksEditorProvider.register(context.extensionUri));
	context.subscriptions.push(ArtifactPreviewProvider.register(context));
	context.subscriptions.push(SpreadsheetEditorProvider.register(context));
	const isProject = await detectAndSetInitialProjectContext();
	const propertyPaletteProvider = registerPropertiesFlow(context);
	const { metadataTreeProvider } = registerMetadataFlow(context, isProject, propertyPaletteProvider);
	checkMdSparrowUpdateInBackground(context, () => void metadataTreeProvider.refresh());

	// Инициализируем VRunnerManager с контекстом расширения для доступа к extensionPath
	VRunnerManager.getInstance(context);
	// Новые терминалы получают движок OneScript выбранного проекта: он свой у каждого проекта
	const showProjectEngine = (): void => void VRunnerManager.getInstance().checkOscriptAvailable();
	context.subscriptions.push(
		onDidChangeCurrentProject(showProjectEngine),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('1c-platform-tools.components.path.oscript')) {
				showProjectEngine();
			}
		})
	);

	const { commands, commandDisposables } = registerCoreCommands(context);

	// Признак читается при каждом обращении: проект появляется и пропадает без перезагрузки окна
	const isProjectRef = {
		get current(): boolean {
			return hasProjects();
		},
	};

	const showNot1CProjectMessage = createShowNot1CProjectMessage();
	const {
		artifactsProvider,
		artifactsFeatureDisposables,
		onArtifactsExcludeChanged,
	} = registerArtifactsFlow(context, isProjectRef, showNot1CProjectMessage);
	const { treeDataProvider, mainTreeCommandDisposables } = registerMainTreeFlow({
		context,
		isProjectRef,
		showNot1CProjectMessage,
		setVersionCommands: commands.setVersion,
		oscriptTasksCommands: commands.oscriptTasks,
		workspaceTasksCommands: commands.workspaceTasks,
	});

	const { testingFeatureDisposables, rebuildTesting } = registerTestingFlow(isProjectRef);
	const edtDisposables = registerEdtFeature();
	const launchFeatureDisposables = registerLaunchFeature(context, isProjectRef);
	const platformServerDisposables = registerPlatformServerFeature(context);
	const diagnosticsFeatureDisposables = registerDiagnosticsFeature();
	context.subscriptions.push(
		vscode.window.registerTerminalLinkProvider(
			new SourceTerminalLinkProvider(VRunnerManager.getInstance())
		)
	);
	const tasksFeatureDisposables = registerTasksFeature();

	context.subscriptions.push(
		registerProjectCreatedHandler({
			treeDataProvider,
			artifactsProvider,
			metadataTreeProvider,
			rebuildTesting,
			hadProjects: isProject,
		})
	);

	// В недоверенной папке команды не выполнялись, поэтому после выдачи
	// доверия деревья перечитываются
	context.subscriptions.push(
		onWorkspaceTrustGranted(() => {
			treeDataProvider.refresh();
			artifactsProvider.refresh();
			metadataTreeProvider.refresh();
			rebuildTesting?.();
		})
	);

	registerWelcomeFlow(context);
	const helpAndSettingsDisposables = registerHelpAndSettingsCommands(context);
	const {
		projectsCommandDisposables,
		onProjectsConfigChange,
	} = await registerProjectsRuntime(onArtifactsExcludeChanged);
	const windowRegistration = registerInfrastructure(context);
	runPostOpenProjectWorkflow(context, () => commands.dependencies.installDependencies());

	const { todoFeatureDisposables } = registerTodoFlow(context, isProjectRef);

	context.subscriptions.push(
		...helpAndSettingsDisposables,
		...artifactsFeatureDisposables,
		...projectsCommandDisposables,
		onProjectsConfigChange,
		...mainTreeCommandDisposables,
		...todoFeatureDisposables,
		...testingFeatureDisposables,
		...edtDisposables,
		...launchFeatureDisposables,
		...platformServerDisposables,
		...diagnosticsFeatureDisposables,
		...tasksFeatureDisposables,
		...clustersFeatureDisposables,
		...ibasesFeatureDisposables,
		...commandDisposables
	);

	return createExtensionApi(windowRegistration);
}
