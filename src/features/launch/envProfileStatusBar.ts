/**
 * Status Bar — активный профиль запуска.
 *
 * Показывает выбранный профиль и признак временных параметров; клик открывает
 * выбор профиля.
 */

import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { LOCAL_OVERRIDES_FILE } from '../../shared/envProfiles';

let statusItem: vscode.StatusBarItem | undefined;

/**
 * Создаёт (однократно) элемент статусной строки для профиля запуска
 *
 * @returns Элемент статусной строки
 */
export function ensureEnvProfileStatusBar(): vscode.StatusBarItem {
	if (!statusItem) {
		// Левее окружения, автономного сервера (priority 1) и «Проектов 1С» (priority 0)
		statusItem = vscode.window.createStatusBarItem(
			'1c-platform-tools.env.profile',
			vscode.StatusBarAlignment.Left,
			2
		);
		statusItem.name = '1С: Профиль запуска';
		statusItem.command = '1c-platform-tools.env.selectProfile';
	}
	return statusItem;
}

/**
 * Обновляет содержимое статусной строки по текущему состоянию профиля
 *
 * @param visible - Показывать ли элемент: выбранный проект и открытый файл в проекте
 */
export function refreshEnvProfileStatusBar(visible: boolean): void {
	const item = ensureEnvProfileStatusBar();
	const vrunner = VRunnerManager.getInstance();

	if (!visible || !vrunner.getWorkspaceRoot()) {
		item.hide();
		return;
	}

	const { profile } = vrunner.launchSummary();
	const label = profile.label;
	// У проекта OneScript нет команд vanessa-runner: отсутствие файла настроек ничего не блокирует
	if (!vrunner.usesVanessaRunner()) {
		item.text = `$(rocket) ${label}`;
		item.backgroundColor = undefined;
		item.tooltip = new vscode.MarkdownString(
			[`**1С: Профиль запуска:** ${label}`, ...profile.settingsFiles.map((file) => `Файл настроек: ${file}`)].join('\n\n')
		);
		item.show();
		return;
	}

	const versionLabel = vrunner.getCachedVRunnerVersionLabel();
	const settings = vrunner.describeSettingsState();
	const profileProblem = vrunner.profileProblem();

	const overrides = vrunner.getActiveEnvOverrides();
	const hasLocalOverrides = vrunner.hasLocalEnvOverrides();
	item.text = `$(rocket) ${label}${overrides || hasLocalOverrides ? ' *' : ''}`;
	// Предупреждаем, когда команды блокирует профиль; отказ из-за окружения показывает элемент окружения
	const blocked = !settings.fileReady || profileProblem !== undefined;
	item.backgroundColor = blocked ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
	item.tooltip = new vscode.MarkdownString(
		[
			`**1С: Профиль запуска:** ${label}`,
			`vanessa-runner: ${versionLabel ?? 'версия не определена'}`,
			profileProblem
				? `⚠ Команды заблокированы. ${profileProblem}`
				: settings.fileReady
					? `Файл настроек: ${settings.fileName}`
					: settings.exists
						? `⚠ Команды заблокированы. ${vrunner.settingsFileProblemMessage(settings)}`
						: '⚠ Профиль запуска не создан, команды заблокированы',
			overrides ? 'Заданы временные параметры' : '',
			hasLocalOverrides ? `Действуют локальные перекрытия (${LOCAL_OVERRIDES_FILE})` : '',
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
