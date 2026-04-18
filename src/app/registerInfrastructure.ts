import * as vscode from 'vscode';
import { registerRunCommandFileWatcher } from '../shared/runCommandFromFileWatcher';
import { startIpcServer } from '../shared/ipcServer';

/**
 * Регистрирует инфраструктурные сервисы расширения.
 */
export function registerInfrastructure(context: vscode.ExtensionContext): void {
	registerRunCommandFileWatcher(context);
	startIpcServer(context);
}
