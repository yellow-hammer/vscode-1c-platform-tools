import * as vscode from 'vscode';
import { logger } from '../shared/logger';
import { bootstrapApp } from './bootstrapApp';

export async function activate(context: vscode.ExtensionContext) {
	await bootstrapApp(context);
}

export function deactivate() {
	logger.dispose();
}
