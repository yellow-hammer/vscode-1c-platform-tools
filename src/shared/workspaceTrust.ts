/**
 * Доверие к папке: расширение не запускает процессы в недоверенной рабочей области.
 *
 * Расширение выполняет vrunner и rac, ставит OneScript и компоненты, поднимает
 * Docker и автономный сервер. Всё это запускает чужой код из открытой папки,
 * поэтому в режиме ограниченной функциональности такие действия не выполняются.
 * После того как папке доверили, проверка проходит и команды работают обычным
 * образом: состояние читается на каждый вызов.
 *
 * @module workspaceTrust
 */

import * as vscode from 'vscode';
import { logger } from './logger';

const log = logger.scope('trust');

/** Показывать предупреждение не чаще раза в этот интервал. */
const NOTICE_INTERVAL_MS = 10_000;

let lastNoticeAt = 0;

/**
 * Проверяет доверие к рабочей области перед запуском процесса.
 *
 * @param action - Что собирались сделать, в именительном падеже
 * @returns true, если папке доверяют и действие можно выполнять
 */
export function ensureWorkspaceTrusted(action: string): boolean {
	if (vscode.workspace.isTrusted) {
		return true;
	}

	log.warn(`папка не доверена, действие не выполнено: ${action}`);
	const now = Date.now();
	if (now - lastNoticeAt > NOTICE_INTERVAL_MS) {
		lastNoticeAt = now;
		void vscode.window.showWarningMessage(
			`В режиме ограниченной функциональности расширение не выполняет: ${action}. ` +
			'Доверьте папку в строке состояния VS Code.'
		);
	}
	return false;
}

/**
 * Подписывается на выдачу доверия рабочей области.
 *
 * @param onGranted - Что сделать, когда папке доверили
 * @returns Подписка
 */
export function onWorkspaceTrustGranted(onGranted: () => void): vscode.Disposable {
	return vscode.workspace.onDidGrantWorkspaceTrust(() => {
		log.info('папке выдано доверие');
		onGranted();
	});
}
