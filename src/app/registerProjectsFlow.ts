import * as vscode from 'vscode';
import {
	registerProjectsBootstrap,
} from '../features/projects/registerProjectsBootstrap';
import {
	registerProjectsRuntime,
	type RegisterProjectsRuntimeResult,
} from '../features/projects/registerProjectsRuntime';

export interface ProjectsFlow {
	registerRuntime: (
		onArtifactsExcludeChanged?: () => void
	) => Promise<RegisterProjectsRuntimeResult>;
}

/**
 * Инициализирует flow фичи «Проекты 1С»: bootstrap сразу, runtime по требованию.
 */
export function registerProjectsFlow(
	context: vscode.ExtensionContext
): ProjectsFlow {
	const bootstrap = registerProjectsBootstrap(context);

	return {
		registerRuntime: (onArtifactsExcludeChanged?: () => void) =>
			registerProjectsRuntime({
				context,
				projectStorage: bootstrap.projectStorage,
				oneCLocator: bootstrap.oneCLocator,
				providers: bootstrap.providers,
				stack: bootstrap.stack,
				projectFilePath: bootstrap.projectFilePath,
				onArtifactsExcludeChanged,
			}),
	};
}
