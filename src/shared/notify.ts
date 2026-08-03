/**
 * Уведомления пользователя без всплывающих окон.
 *
 * Правило расширения: рутинное подтверждение («дерево обновлено», «файл
 * создан», «свойства сохранены») показывается в строке состояния и само
 * исчезает, а след остаётся в журнале. Всплывающее окно оставлено там, где
 * без него можно пропустить важное: ошибки, предупреждения и сообщения с
 * кнопками действий.
 */

import * as vscode from 'vscode';
import { logger } from './logger';

const log = logger.scope('ui');

/** Сколько держать сообщение в строке состояния */
const STATUS_TIMEOUT_MS = 4_000;

/**
 * Сообщает об успешном рутинном действии.
 *
 * @param message - Что произошло, в прошедшем времени
 */
export function notifyQuiet(message: string): void {
	log.info(message);
	vscode.window.setStatusBarMessage(`$(check) ${message}`, STATUS_TIMEOUT_MS);
}

/**
 * Сообщает о рутинном действии, которое закончилось неудачей.
 *
 * Всплывающее окно тут не нужно: подробности уже видны там, где шла работа (панель задачи,
 * Problems, журнал), а строка состояния только отмечает исход.
 *
 * @param message - Что не получилось
 */
export function notifyQuietFailure(message: string): void {
	log.error(message);
	vscode.window.setStatusBarMessage(`$(error) ${message}`, STATUS_TIMEOUT_MS);
}

/**
 * Сообщает о действии, которое идёт прямо сейчас.
 *
 * @param message - Что происходит
 * @returns Disposable: убрать сообщение по завершении
 */
export function notifyBusy(message: string): vscode.Disposable {
	log.info(message);
	return vscode.window.setStatusBarMessage(`$(sync~spin) ${message}`);
}
