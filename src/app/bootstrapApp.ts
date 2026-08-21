import * as vscode from 'vscode';
import { ProfileEditorProvider } from '../features/profileEditor/profileEditorProvider';
import { PipelineEditorProvider } from '../features/pipelines/pipelineEditorProvider';
import { PipelineTaskProvider } from '../features/pipelines/pipelineTaskProvider';
import { registerFormSaveCommand } from '../features/editors/formPanels';
import { HooksEditorProvider } from '../features/hooks/hooksEditorProvider';
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
import { registerProjectsFlow } from './registerProjectsFlow';
import { registerMetadataFlow } from './registerMetadataFlow';
import { registerPropertiesFlow } from './registerPropertiesFlow';
import { checkMdSparrowUpdateInBackground } from '../features/metadata/mdSparrowBootstrap';
import { registerArtifactsFlow } from './registerArtifactsFlow';
import { registerTodoFlow } from './registerTodoFlow';
import { registerMainTreeFlow } from './registerMainTreeFlow';
import { registerTestingFlow } from './registerTestingFlow';
import { registerLaunchFeature } from '../features/launch/launchFeature';
import { registerPlatformServerFeature } from '../features/launch/platformServerFeature';
import { registerDiagnosticsFeature } from '../features/diagnostics/registerDiagnosticsFeature';
import { registerTasksFeature } from '../features/tasks/registerTasksFeature';
import { registerClustersFeature } from '../features/clusters/registerClustersFeature';
import { registerIbasesFeature } from '../features/ibases/registerIbasesFeature';
import { initGithubToken } from '../shared/githubToken';

/**
 * Выполняет полную инициализацию расширения.
 */
export async function bootstrapApp(context: vscode.ExtensionContext): Promise<void> {
	// До первой загрузки компонентов: иначе первые запросы уйдут анонимными
	await initGithubToken(context.secrets);

	const { registerRuntime: registerProjectsRuntime } = registerProjectsFlow(context);

	// Панель «Администрирование 1С» не зависит от открытого проекта: список баз
	// и консоль кластера нужны и без исходников в рабочей области.
	const clustersFeatureDisposables = registerClustersFeature(context);
	const ibasesFeatureDisposables = registerIbasesFeature();

	registerDebugFeature(context);
	context.subscriptions.push(ProfileEditorProvider.register(context));
	context.subscriptions.push(PipelineEditorProvider.register());
	context.subscriptions.push(PipelineTaskProvider.register());
	context.subscriptions.push(registerFormSaveCommand());
	context.subscriptions.push(HooksEditorProvider.register());
	const isProject = await detectAndSetInitialProjectContext();
	const propertyPaletteProvider = registerPropertiesFlow(context);
	const { metadataTreeProvider } = registerMetadataFlow(context, isProject, propertyPaletteProvider);
	checkMdSparrowUpdateInBackground(context, () => void metadataTreeProvider.refresh());

	// Инициализируем VRunnerManager с контекстом расширения для доступа к extensionPath
	VRunnerManager.getInstance(context);

	const { commands, commandDisposables } = registerCoreCommands(context);

	// Изменяемая ссылка: после создания packagedef из палитры станет true, команды будут работать без перезагрузки
	const isProjectRef = { current: isProject };

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
	const launchFeatureDisposables = registerLaunchFeature(context, isProjectRef);
	const platformServerDisposables = registerPlatformServerFeature(context, isProjectRef);
	const diagnosticsFeatureDisposables = registerDiagnosticsFeature();
	const tasksFeatureDisposables = registerTasksFeature();

	registerProjectCreatedHandler({
		isProjectRef,
		treeDataProvider,
		artifactsProvider,
		metadataTreeProvider,
		rebuildTesting,
	});

	registerWelcomeFlow(context);
	const helpAndSettingsDisposables = registerHelpAndSettingsCommands();
	const {
		projectsCommandDisposables,
		onProjectsConfigChange,
	} = await registerProjectsRuntime(onArtifactsExcludeChanged);
	registerInfrastructure(context);
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
		...launchFeatureDisposables,
		...platformServerDisposables,
		...diagnosticsFeatureDisposables,
		...tasksFeatureDisposables,
		...clustersFeatureDisposables,
		...ibasesFeatureDisposables,
		...commandDisposables
	);
}
