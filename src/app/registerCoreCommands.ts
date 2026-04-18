import * as vscode from 'vscode';
import { registerCommands } from '../commands/commandRegistry';
import { InfobaseCommands } from '../commands/infobaseCommands';
import { ConfigurationCommands } from '../commands/configurationCommands';
import { ExtensionsCommands } from '../commands/extensionsCommands';
import { ExternalFilesCommands } from '../commands/externalFilesCommands';
import { SupportCommands } from '../commands/supportCommands';
import { DependenciesCommands } from '../commands/dependenciesCommands';
import { RunCommands } from '../commands/runCommands';
import { TestCommands } from '../commands/testCommands';
import { SetVersionCommands } from '../commands/setVersionCommands';
import { WorkspaceTasksCommands } from '../commands/workspaceTasksCommands';
import { ArtifactCommands } from '../commands/artifactCommands';
import { OscriptTasksCommands } from '../commands/oscriptTasksCommands';
import { SkillsCommands } from '../commands/skillsCommands';

export interface CoreCommands {
	dependencies: DependenciesCommands;
	setVersion: SetVersionCommands;
	oscriptTasks: OscriptTasksCommands;
	workspaceTasks: WorkspaceTasksCommands;
}

export interface CoreCommandsRegistration {
	commands: CoreCommands;
	commandDisposables: vscode.Disposable[];
}

/**
 * Создаёт основные объекты команд и регистрирует команды расширения.
 */
export function registerCoreCommands(
	context: vscode.ExtensionContext
): CoreCommandsRegistration {
	const commandObjects = {
		infobase: new InfobaseCommands(),
		configuration: new ConfigurationCommands(),
		extensions: new ExtensionsCommands(),
		artifact: new ArtifactCommands(),
		externalFiles: new ExternalFilesCommands(),
		support: new SupportCommands(),
		dependencies: new DependenciesCommands(),
		run: new RunCommands(),
		test: new TestCommands(),
		setVersion: new SetVersionCommands(),
		oscriptTasks: new OscriptTasksCommands(),
		workspaceTasks: new WorkspaceTasksCommands(),
		skills: new SkillsCommands(),
	};
	const commandDisposables = registerCommands(context, commandObjects);

	return {
		commands: {
			dependencies: commandObjects.dependencies,
			setVersion: commandObjects.setVersion,
			oscriptTasks: commandObjects.oscriptTasks,
			workspaceTasks: commandObjects.workspaceTasks,
		},
		commandDisposables,
	};
}
