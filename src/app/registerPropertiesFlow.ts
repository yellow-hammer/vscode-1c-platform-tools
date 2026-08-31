import * as vscode from 'vscode';
import { PROPERTY_PALETTE_VIEW_ID, PropertyPaletteViewProvider } from '../features/properties/propertyPaletteView';

/**
 * Регистрирует панель «1С: Свойства». Панель отдельная: её наполняют разные источники,
 * поэтому провайдер возвращается наружу и передаётся тем, кто показывает выделение.
 */
export function registerPropertiesFlow(context: vscode.ExtensionContext): PropertyPaletteViewProvider {
	const propertyPaletteProvider = new PropertyPaletteViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PROPERTY_PALETTE_VIEW_ID, propertyPaletteProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('1c-platform-tools.properties.show', () => {
			void vscode.commands.executeCommand(`${PROPERTY_PALETTE_VIEW_ID}.focus`);
		})
	);
	return propertyPaletteProvider;
}
