/**
 * Реестр открытых форм расширения и сохранение по Ctrl+S.
 *
 * Внутри webview обработчик Ctrl+S не помогает: сочетание перехватывает сам
 * VS Code до страницы. Поэтому клавиша объявлена в манифесте и приходит
 * командой, а команда просит активную форму сохранить себя.
 */

import * as vscode from 'vscode';

/** Сообщение формам: пользователь нажал сохранить */
export const SAVE_REQUEST_MESSAGE = { type: 'saveRequested' } as const;

/** Открытые формы: и custom editor, и панели свойств */
const panels = new Set<vscode.WebviewPanel>();

/**
 * Ставит форму на учёт и снимает её при закрытии.
 *
 * @param panel - Панель формы
 */
export function registerFormPanel(panel: vscode.WebviewPanel): void {
	panels.add(panel);
	panel.onDidDispose(() => panels.delete(panel));
}

/**
 * Просит активную форму сохранить изменения.
 *
 * Активной считается видимая форма в фокусе: именно её пользователь имел в
 * виду, нажимая Ctrl+S.
 */
export function requestSaveInActiveForm(): void {
	for (const panel of panels) {
		if (panel.active) {
			void panel.webview.postMessage(SAVE_REQUEST_MESSAGE);
			return;
		}
	}
}

/**
 * Регистрирует команду сохранения формы.
 *
 * @returns Disposable регистрации
 */
export function registerFormSaveCommand(): vscode.Disposable {
	return vscode.commands.registerCommand('1c-platform-tools.editors.save', () => requestSaveInActiveForm());
}
