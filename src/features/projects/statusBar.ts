/**
 * Status Bar — текущий проект.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ProjectStorage } from './storage';
import type { OneCLocator } from './oneCLocator';
import { setCurrentProjectPath } from './decoration';

let statusItem: vscode.StatusBarItem | undefined;

/**
 * Показывает текущий проект в статусной строке и обновляет подсветку в сайдбаре.
 * @param storage — хранилище избранного
 * @param locator — локатор автообнаруженных проектов
 * @param projectName — имя проекта (если известно)
 */
export function showStatusBar(
	storage: ProjectStorage,
	locator: OneCLocator,
	projectName?: string
): void {
	const ws = vscode.workspace.workspaceFile ?? vscode.workspace.workspaceFolders?.[0]?.uri;
	const currentPath = ws?.fsPath;
	setCurrentProjectPath(currentPath ?? undefined);

	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const show = config.get<boolean>('projects.showProjectNameInStatusBar', true);
	if (!show) {return;}

	if (!currentPath) {return;}

	if (!statusItem) {
		statusItem = vscode.window.createStatusBarItem('1c-platform-tools.projects.statusBar', vscode.StatusBarAlignment.Left);
		statusItem.name = 'Проекты 1С';
	}

	statusItem.tooltip = currentPath;

	const openInNew = config.get<boolean>('projects.openInNewWindowWhenClickingInStatusBar', false);
	statusItem.command = openInNew ? '1c-platform-tools.projects.listNewWindow' : '1c-platform-tools.projects.listOpen';

	if (projectName) {
		statusItem.text = `$(folder) ${projectName}`;
		statusItem.show();
		return;
	}

	const fromStorage = storage.existsWithRootPath(currentPath, true);
	if (fromStorage) {
		statusItem.text = `$(folder) ${fromStorage.name}`;
		statusItem.show();
		return;
	}

	const norm = currentPath.toLowerCase();
	const fromLocator = locator.projectList.find((p) => p.toLowerCase() === norm);
	if (fromLocator) {
		statusItem.text = `$(folder) ${path.basename(fromLocator) || fromLocator}`;
		statusItem.show();
		return;
	}

	statusItem.text = `$(folder) ${path.basename(currentPath) || currentPath}`;
	statusItem.show();
}

/**
 * Обновляет текст в статусной строке при переименовании проекта.
 * @param oldName — предыдущее имя
 * @param _oldPath — предыдущий путь (не используется)
 * @param newName — новое имя
 */
export function updateStatusBar(oldName: string, _oldPath: string, newName: string): void {
	if (statusItem?.text === `$(folder) ${oldName}`) {
		statusItem.text = `$(folder) ${newName}`;
	}
}
