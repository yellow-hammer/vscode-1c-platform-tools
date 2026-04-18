import * as vscode from 'vscode';
import { registerMetadataFeature } from '../features/metadata/registerMetadataFeature';
import { registerMetadataView } from '../features/metadata/registerMetadataView';
import type { MetadataTreeDataProvider } from '../features/metadata/metadataTreeView';

export interface MetadataFlow {
	metadataTreeProvider: MetadataTreeDataProvider;
}

/**
 * Инициализирует flow фичи «Метаданные 1С»: view, команды и первичное обновление.
 */
export function registerMetadataFlow(
	context: vscode.ExtensionContext,
	isProject: boolean
): MetadataFlow {
	const { metadataTreeProvider, metadataTreeView } = registerMetadataView(context);

	const metadataFeatureDisposables = registerMetadataFeature({
		context,
		metadataTreeProvider,
		metadataTreeView,
	});
	context.subscriptions.push(...metadataFeatureDisposables);

	if (isProject) {
		void metadataTreeProvider.refresh();
	}

	return { metadataTreeProvider };
}
