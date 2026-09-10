import * as vscode from 'vscode';
import { registerRunCommandFileWatcher } from '../shared/runCommandFromFileWatcher';
import { registerProjectLayoutWatch } from '../shared/projectLayoutWatch';
import { startIpcServer } from '../shared/ipcServer';

/**
 * Регистрирует инфраструктурные сервисы расширения.
 */
export function registerInfrastructure(context: vscode.ExtensionContext): void {
	registerRunCommandFileWatcher(context);
	registerProjectLayoutWatch(context);
	startIpcServer(context);
}
