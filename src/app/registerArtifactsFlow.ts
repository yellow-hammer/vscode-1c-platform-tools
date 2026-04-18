import * as vscode from 'vscode';
import { registerArtifactsFeature } from '../features/artifacts/registerArtifactsFeature';
import { registerArtifactsView } from '../features/artifacts/registerArtifactsView';
import type { ProjectArtifactsTreeDataProvider } from '../features/artifacts/projectArtifactsView';

export interface ArtifactsFlow {
	artifactsProvider: ProjectArtifactsTreeDataProvider;
	artifactsFeatureDisposables: vscode.Disposable[];
	onArtifactsExcludeChanged: () => void;
}

/**
 * Инициализирует flow фичи «Артефакты проекта»: view и runtime-команды.
 */
export function registerArtifactsFlow(
	context: vscode.ExtensionContext,
	isProjectRef: { current: boolean },
	showNot1CProjectMessage: () => void
): ArtifactsFlow {
	const { artifactsProvider } = registerArtifactsView(context);
	const artifactsFeature = registerArtifactsFeature({
		artifactsProvider,
		isProjectRef,
		showNot1CProjectMessage,
	});

	return {
		artifactsProvider,
		artifactsFeatureDisposables: artifactsFeature.disposables,
		onArtifactsExcludeChanged: artifactsFeature.refreshFromSettingsChange,
	};
}
