/**
 * Подключение команд 1C:EDT.
 *
 * @module registerEdtFeature
 */

import * as vscode from 'vscode';
import { inCurrentProject } from '../../commands/projectScope';
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
		vscode.commands.registerCommand('1c-platform-tools.edt.import', inCurrentProject(importToEdt)),
		vscode.commands.registerCommand('1c-platform-tools.edt.export', inCurrentProject(exportFromEdt)),
		vscode.commands.registerCommand('1c-platform-tools.edt.validate', inCurrentProject(validateEdtProject)),
		vscode.commands.registerCommand('1c-platform-tools.edt.formatModules', inCurrentProject(formatEdtModules)),
		vscode.commands.registerCommand('1c-platform-tools.edt.sortProject', inCurrentProject(sortEdtProject)),
		vscode.commands.registerCommand('1c-platform-tools.edt.projectInfo', inCurrentProject(showEdtProjectInfo)),
		vscode.commands.registerCommand('1c-platform-tools.run.edt', inCurrentProject(openInEdt)),
	];
}
