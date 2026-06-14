/**
 * Status Bar — активный env-профиль запуска.
 *
 * Показывает выбранный профиль и признак временных параметров; клик открывает
 * выбор профиля.
 */

import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { activeProfileLabel } from '../../shared/envProfiles';

let statusItem: vscode.StatusBarItem | undefined;

/**
 * Создаёт (однократно) элемент статусной строки для профиля запуска
 *
 * @returns Элемент статусной строки
 */
export function ensureEnvProfileStatusBar(): vscode.StatusBarItem {
	if (!statusItem) {
		// Приоритет на 1 выше «Проектов 1С» (priority 0) — профиль встаёт вплотную перед ними
		statusItem = vscode.window.createStatusBarItem(
			'1c-platform-tools.env.profile',
			vscode.StatusBarAlignment.Left,
			1
		);
		statusItem.name = 'Профиль запуска 1С';
		statusItem.command = '1c-platform-tools.env.selectProfile';
	}
	return statusItem;
}

/**
 * Обновляет содержимое статусной строки по текущему состоянию профиля
 *
 * @param visible - Показывать ли элемент (только для проектов 1С с открытой рабочей областью)
 */
export function refreshEnvProfileStatusBar(visible: boolean): void {
	const item = ensureEnvProfileStatusBar();
	const vrunner = VRunnerManager.getInstance();

	if (!visible || !vrunner.getWorkspaceRoot()) {
		item.hide();
		return;
	}

	const label = activeProfileLabel(vrunner.getActiveEnvProfileId(), vrunner.discoverEnvProfiles());

	const overrides = vrunner.getActiveEnvOverrides();
	item.text = `$(variable-group) 1С: ${label}${overrides ? ' $(pencil)' : ''}`;
	item.tooltip = 'Активный профиль запуска 1С';
	item.show();
}

/**
 * Освобождает элемент статусной строки
 */
export function disposeEnvProfileStatusBar(): void {
	statusItem?.dispose();
	statusItem = undefined;
}
