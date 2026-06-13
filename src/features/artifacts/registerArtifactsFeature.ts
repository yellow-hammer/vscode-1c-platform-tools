import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import {
	ProjectArtifactsTreeDataProvider,
	type ArtifactsViewMode,
} from './projectArtifactsView';

const log = logger.scope('artifacts');

export interface RegisterArtifactsFeatureParams {
	artifactsProvider: ProjectArtifactsTreeDataProvider;
	isProjectRef: { current: boolean };
	showNot1CProjectMessage: () => void;
}

export interface RegisterArtifactsFeatureResult {
	disposables: vscode.Disposable[];
	refreshFromSettingsChange: () => void;
}

/**
 * Регистрирует команды и автообновление фичи «Артефакты проекта».
 */
export function registerArtifactsFeature(
	params: RegisterArtifactsFeatureParams
): RegisterArtifactsFeatureResult {
	const { artifactsProvider, isProjectRef, showNot1CProjectMessage } = params;

	const artifactsRefreshDebounce = {
		timer: undefined as ReturnType<typeof setTimeout> | undefined,
	};
	const scheduleArtifactsRefresh = (): void => {
		if (!isProjectRef.current) {
			return;
		}
		if (artifactsRefreshDebounce.timer) {
			clearTimeout(artifactsRefreshDebounce.timer);
		}
		artifactsRefreshDebounce.timer = setTimeout(() => {
			artifactsRefreshDebounce.timer = undefined;
			void artifactsProvider.refresh();
		}, 1000);
	};

	const artifactPatterns = [
		'**/*.cf',
		'**/*.cfe',
		'**/*.epf',
		'**/*.erf',
		'**/Configuration.xml',
	];
	const artifactWatchers = artifactPatterns.flatMap((pattern) => {
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);
		return [
			watcher.onDidCreate(scheduleArtifactsRefresh),
			watcher.onDidDelete(scheduleArtifactsRefresh),
			watcher,
		];
	});

	const artifactsRefreshCommand = vscode.commands.registerCommand(
		'1c-platform-tools.artifacts.refresh',
		async () => {
			if (!isProjectRef.current) {
				showNot1CProjectMessage();
				return;
			}
			await artifactsProvider.refresh();
			log.debug('Дерево артефактов обновлено');
			vscode.window.showInformationMessage('Дерево артефактов обновлено');
		}
	);

	const updateArtifactsViewContext = (): void => {
		const mode = artifactsProvider.getViewMode();
		void vscode.commands.executeCommand(
			'setContext',
			'1c-platform-tools.artifacts.viewAsList',
			mode === 'list'
		);
	};
	updateArtifactsViewContext();

	const artifactsViewAsListCommand = vscode.commands.registerCommand(
		'1c-platform-tools.artifacts._viewAsList',
		async () => {
			await artifactsProvider.setViewMode('list' as ArtifactsViewMode);
		}
	);

	const artifactsViewByFolderCommand = vscode.commands.registerCommand(
		'1c-platform-tools.artifacts._viewByFolder',
		async () => {
			await artifactsProvider.setViewMode('folder' as ArtifactsViewMode);
		}
	);

	const debounceDispose: vscode.Disposable = {
		dispose: () => {
			if (artifactsRefreshDebounce.timer) {
				clearTimeout(artifactsRefreshDebounce.timer);
			}
		},
	};

	return {
		disposables: [
			...artifactWatchers,
			debounceDispose,
			artifactsRefreshCommand,
			artifactsViewAsListCommand,
			artifactsViewByFolderCommand,
		],
		refreshFromSettingsChange: () => {
			void artifactsProvider.refresh();
		},
	};
}
