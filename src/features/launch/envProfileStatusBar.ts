/**
 * Status Bar — активный env-профиль запуска.
 *
 * Показывает выбранный профиль и признак временных параметров; клик открывает
 * выбор профиля.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fsSync from 'node:fs';
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
		// Левее автономного сервера (priority 1) и «Проектов 1С» (priority 0)
		statusItem = vscode.window.createStatusBarItem(
			'1c-platform-tools.env.profile',
			vscode.StatusBarAlignment.Left,
			2
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
	const versionLabel = vrunner.getCachedVRunnerVersionLabel();
	const settingsFile = vrunner.getActiveEnvFile();
	const workspaceRoot = vrunner.getWorkspaceRoot();
	const settingsExists = workspaceRoot
		? fsSync.existsSync(path.isAbsolute(settingsFile) ? settingsFile : path.join(workspaceRoot, settingsFile))
		: false;

	const overrides = vrunner.getActiveEnvOverrides();
	item.text = `$(rocket) ${label}${overrides ? ' *' : ''}`;
	// Предупреждаем, когда команды заблокированы отсутствием файла настроек
	item.backgroundColor = settingsExists
		? undefined
		: new vscode.ThemeColor('statusBarItem.warningBackground');
	item.tooltip = new vscode.MarkdownString(
		[
			`**Профиль запуска 1С:** ${label}`,
			`vanessa-runner: ${versionLabel ?? 'версия не определена'}`,
			settingsExists
				? `Файл настроек: ${settingsFile}`
				: '⚠ Профиль запуска не создан, команды заблокированы',
			overrides ? 'Заданы временные параметры' : '',
		].filter(Boolean).join('\n\n')
	);
	item.show();
}

/**
 * Освобождает элемент статусной строки
 */
export function disposeEnvProfileStatusBar(): void {
	statusItem?.dispose();
	statusItem = undefined;
}
