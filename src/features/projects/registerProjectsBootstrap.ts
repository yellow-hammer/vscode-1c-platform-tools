import * as vscode from 'vscode';
import { OneCLocator } from './oneCLocator';
import {
	ProjectStorage,
	ProjectsStack,
	ProjectsProviders,
	getProjectsFilePath,
} from './index';

export interface ProjectsBootstrap {
	oneCLocator: OneCLocator;
	projectStorage: ProjectStorage;
	stack: ProjectsStack;
	providers: ProjectsProviders;
	projectFilePath: string;
}

/**
 * Инициализирует базовые зависимости фичи «Проекты 1С».
 */
export function registerProjectsBootstrap(
	context: vscode.ExtensionContext
): ProjectsBootstrap {
	const oneCLocator = new OneCLocator(context);
	const projectsConfig = vscode.workspace.getConfiguration('1c-platform-tools');
	const projectsLocation = projectsConfig.get<string>('projects.projectsLocation', '');
	const projectFilePath = getProjectsFilePath(projectsLocation, context);
	const projectStorage = new ProjectStorage(projectFilePath);
	const loadError = projectStorage.load();
	if (loadError) {
		void vscode.window
			.showErrorMessage(
				'Ошибка загрузки projects.json',
				{ modal: true, detail: loadError },
				{ title: 'Открыть файл' }
			)
			.then((choice) => {
				if (choice?.title === 'Открыть файл') {
					void vscode.commands.executeCommand('1c-platform-tools.projects.editProjects');
				}
			});
	}

	const stack = new ProjectsStack(
		(k) => context.globalState.get(k),
		(k, v) => context.globalState.update(k, v)
	);
	const providers = new ProjectsProviders(context, projectStorage, oneCLocator, stack);

	return {
		oneCLocator,
		projectStorage,
		stack,
		providers,
		projectFilePath,
	};
}
