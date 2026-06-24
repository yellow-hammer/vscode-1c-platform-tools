import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { SyntaxCheckDiagnostics } from './syntaxCheckDiagnostics';

/**
 * Регистрирует диагностику синтаксического контроля (ошибки vrunner syntax-check
 * в панели Problems) и команды ручного обновления/очистки.
 *
 * @returns Disposable'ы фичи (коллекция диагностик, watcher'ы, команды)
 */
export function registerDiagnosticsFeature(): vscode.Disposable[] {
	const vrunner = VRunnerManager.getInstance();
	const diagnostics = new SyntaxCheckDiagnostics(vrunner);

	return [
		diagnostics,
		vscode.commands.registerCommand('1c-platform-tools.syntaxCheck.refreshDiagnostics', () =>
			diagnostics.refresh()
		),
		vscode.commands.registerCommand('1c-platform-tools.syntaxCheck.clearDiagnostics', () =>
			diagnostics.clear()
		),
	];
}
