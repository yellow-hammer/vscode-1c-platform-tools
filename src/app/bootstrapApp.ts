import * as vscode from 'vscode';
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
import { registerArtifactsFlow } from './registerArtifactsFlow';
import { registerTodoFlow } from './registerTodoFlow';
import { registerMainTreeFlow } from './registerMainTreeFlow';

/**
 * Выполняет полную инициализацию расширения.
 */
export async function bootstrapApp(context: vscode.ExtensionContext): Promise<void> {
	const { registerRuntime: registerProjectsRuntime } = registerProjectsFlow(context);

	registerDebugFeature(context);
	const isProject = await detectAndSetInitialProjectContext();
	const { metadataTreeProvider } = registerMetadataFlow(context, isProject);

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

	registerProjectCreatedHandler({
		isProjectRef,
		treeDataProvider,
		artifactsProvider,
		metadataTreeProvider,
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
		...commandDisposables
	);
}
