/**
 * Список информационных баз платформы в панели «1С: Администрирование».
 *
 * Панель доступна всегда: запускают базы и без открытого проекта 1С.
 */

import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { startupDirectory } from '../../shared/infobaseList';
import { IBASES_VIEW_ID } from './constants';
import { registerIbasesCommands } from './ibasesCommands';
import { IbasesProvider } from './ibasesProvider';
import { watchInfobaseList } from './watchInfobaseList';

const log = logger.scope('ibases');

/**
 * Регистрирует представление списка информационных баз и его команды.
 *
 * @returns Подписки фичи
 */
export function registerIbasesFeature(): vscode.Disposable[] {
	const provider = new IbasesProvider();
	const treeView = vscode.window.createTreeView(IBASES_VIEW_ID, {
		treeDataProvider: provider,
		showCollapseAll: true,
	});
	const watch = watchInfobaseList(() => provider.refresh(), startupDirectory());
	const visibility = treeView.onDidChangeVisibility((event) => {
		if (event.visible) {
			provider.refresh();
		}
	});
	log.info('список информационных баз готов');
	return [treeView, watch, visibility, provider, ...registerIbasesCommands(provider)];
}
