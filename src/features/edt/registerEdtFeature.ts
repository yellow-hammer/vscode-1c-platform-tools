/**
 * Подключение команд 1С:EDT.
 *
 * @module registerEdtFeature
 */

import * as vscode from 'vscode';
import {
	exportFromEdt,
	formatEdtModules,
	importToEdt,
	openInEdt,
	showEdtProjectInfo,
	sortEdtProject,
	validateEdtProject,
} from './edtCommands';
import { disposeEdtDiagnostics } from './edtDiagnostics';

/**
 * Регистрирует команды EDT.
 *
 * @returns Подписки фичи
 */
export function registerEdtFeature(): vscode.Disposable[] {
	return [
		new vscode.Disposable(disposeEdtDiagnostics),
		vscode.commands.registerCommand('1c-platform-tools.edt.import', importToEdt),
		vscode.commands.registerCommand('1c-platform-tools.edt.export', exportFromEdt),
		vscode.commands.registerCommand('1c-platform-tools.edt.validate', validateEdtProject),
		vscode.commands.registerCommand('1c-platform-tools.edt.formatModules', formatEdtModules),
		vscode.commands.registerCommand('1c-platform-tools.edt.sortProject', sortEdtProject),
		vscode.commands.registerCommand('1c-platform-tools.edt.projectInfo', showEdtProjectInfo),
		vscode.commands.registerCommand('1c-platform-tools.edt.open', openInEdt),
	];
}
