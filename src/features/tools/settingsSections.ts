/**
 * Открытие настроек расширения.
 *
 * Раньше каждая панель открывала настройки своим запросом с отбором по разделу,
 * и запросы разошлись: где-то префикс заканчивался точкой, где-то нет, а две
 * команды открывали одно и то же разными фильтрами. Отбор по разделу убран:
 * шестерёнка в любой панели показывает один и тот же список настроек
 * расширения, дальше его сужает поиск самого VS Code.
 *
 * @module settingsSections
 */

import * as vscode from 'vscode';

/** Идентификатор расширения для фильтра настроек VS Code. */
export const SETTINGS_EXT = '@ext:yellow-hammer.1c-platform-tools';

/** Открывает настройки расширения без отбора по разделу. */
export async function openExtensionSettings(): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.openSettings', SETTINGS_EXT);
}
