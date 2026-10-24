/**
 * Status Bar — окружение запуска: файлы `.env`, переменные которых получают
 * запуски проекта. Клик открывает выбор окружения.
 */

import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { environmentLabel } from '../../shared/environments';

let statusItem: vscode.StatusBarItem | undefined;

/**
 * Создаёт (однократно) элемент статусной строки для окружения запуска
 *
 * @returns Элемент статусной строки
 */
export function ensureEnvironmentStatusBar(): vscode.StatusBarItem {
	if (!statusItem) {
		// Правее профиля запуска (priority 2), левее автономного сервера (priority 1)
		statusItem = vscode.window.createStatusBarItem(
			'1c-platform-tools.env.environment',
			vscode.StatusBarAlignment.Left,
			1.5
		);
		statusItem.name = '1С: Окружение';
		statusItem.command = '1c-platform-tools.env.selectEnvironment';
	}
	return statusItem;
}

/**
 * Обновляет содержимое статусной строки по выбранному окружению
 *
 * @param visible - Показывать ли элемент: выбран проект, открытый файл в проекте
 */
export function refreshEnvironmentStatusBar(visible: boolean): void {
	const item = ensureEnvironmentStatusBar();
	const vrunner = VRunnerManager.getInstance();

	if (!visible || !vrunner.getWorkspaceRoot()) {
		item.hide();
		return;
	}

	const environment = vrunner.activeEnvironment();
	const problem = vrunner.environmentProblem();
	const label = environmentLabel(environment.id, environment.files);
	const names = Object.keys(environment.variables);
	item.text = `$(variable-group) ${label}`;
	// Подсвечивается только отказ запуска; окружение по умолчанию и без файлов — обычное состояние
	item.backgroundColor = problem ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
	item.tooltip = new vscode.MarkdownString(
		[
			`**1С: Окружение:** ${label}`,
			environment.files.length > 0 ? `Файлы: ${environment.files.join(', ')}` : '',
			names.length > 0 ? `Переменные: ${names.map((name) => `\`${name}\``).join(', ')}` : '',
			problem ? `⚠ ${problem}` : '',
		].filter(Boolean).join('\n\n')
	);
	item.show();
}

/**
 * Освобождает элемент статусной строки
 */
export function disposeEnvironmentStatusBar(): void {
	statusItem?.dispose();
	statusItem = undefined;
}
