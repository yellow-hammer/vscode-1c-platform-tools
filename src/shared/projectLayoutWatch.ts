/**
 * Слежение за тем, из чего собрана раскладка проекта.
 *
 * Раскладка кэшируется на рабочую область, поэтому её нужно забывать, когда
 * появляется, исчезает или меняется маркерный файл, меняются пути в настройках
 * или состав папок рабочей области.
 * @module projectLayoutWatch
 */

import * as vscode from 'vscode';
import { invalidateProjectLayout } from './projectLayout';

/** Маркеры формата исходного кода: выгрузка конфигуратора и EDT. */
const MARKERS = '**/Configuration.{xml,mdo}';

/** Раздел настроек с путями проекта. */
const PATH_SECTION = '1c-platform-tools.path';

const changed = new vscode.EventEmitter<void>();

/** Срабатывает, когда раскладку проекта нужно перечитать. */
export const onDidChangeProjectLayout = changed.event;

/**
 * Подписывается на изменения, после которых раскладку нужно перечитать.
 *
 * @param context - Контекст расширения
 */
export function registerProjectLayoutWatch(context: vscode.ExtensionContext): void {
	const forget = () => {
		invalidateProjectLayout();
		changed.fire();
	};
	const watcher = vscode.workspace.createFileSystemWatcher(MARKERS);

	context.subscriptions.push(
		watcher,
		watcher.onDidCreate(forget),
		watcher.onDidDelete(forget),
		watcher.onDidChange(forget),
		vscode.workspace.onDidChangeWorkspaceFolders(forget),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(PATH_SECTION)) {
				forget();
			}
		})
	);
}
