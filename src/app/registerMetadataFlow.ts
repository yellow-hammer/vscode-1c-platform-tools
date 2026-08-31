import * as vscode from 'vscode';
import { registerMetadataFeature } from '../features/metadata/registerMetadataFeature';
import { registerMetadataView } from '../features/metadata/registerMetadataView';
import type { MetadataTreeDataProvider } from '../features/metadata/metadataTreeView';
import type { PropertyPaletteViewProvider } from '../features/properties/propertyPaletteView';

export interface MetadataFlow {
	metadataTreeProvider: MetadataTreeDataProvider;
}

/**
 * Инициализирует flow фичи «1С: Метаданные»: view, команды и первичное обновление.
 */
export function registerMetadataFlow(
	context: vscode.ExtensionContext,
	isProject: boolean,
	propertyPaletteProvider: PropertyPaletteViewProvider
): MetadataFlow {
	const { metadataTreeProvider, metadataTreeView, metadataSearchProvider, metadataFilterProvider } =
		registerMetadataView(context);

	const metadataFeatureDisposables = registerMetadataFeature({
		context,
		metadataTreeProvider,
		metadataTreeView,
		metadataSearchProvider,
		metadataFilterProvider,
		propertyPaletteProvider,
	});
	context.subscriptions.push(...metadataFeatureDisposables);

	if (isProject) {
		void metadataTreeProvider.refresh();
	}

	return { metadataTreeProvider };
}
