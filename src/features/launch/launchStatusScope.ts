/**
 * Когда строка состояния показывает профиль запуска, окружение и автономный
 * сервер: профиль и окружение — у проекта любого вида, сервер — у проекта 1С.
 * @module launch/launchStatusScope
 */

import * as vscode from 'vscode';
import { isOneCProjectKind, type ProjectKind } from '../../shared/projectKind';
import type { VRunnerManager } from '../../shared/vrunnerManager';
import { currentProject, outsideProject, projectByRoot, projectOf } from '../../shared/workspaceProjects';

/** Проект с видом, известным или ещё нет. */
interface KindOf {
	kind?: ProjectKind;
}

/** Где открытый файл: нет файла, вне проектов или в проекте. */
export type ActiveFilePlace = 'none' | 'outside' | KindOf;

/**
 * Показывать ли автономный сервер.
 *
 * Выбранный проект должен работать с платформой: вид проекта 1С, а пока вид не
 * известен, годный файл настроек vanessa-runner. Открытый файл, если он есть,
 * должен лежать в проекте, который не OneScript.
 *
 * @param current - Выбранный проект
 * @param settingsReady - Файл настроек выбранного проекта годен
 * @param activeFile - Где открытый файл
 */
export function showsServerStatus(current: KindOf | undefined, settingsReady: boolean, activeFile: ActiveFilePlace): boolean {
	if (!current || !(current.kind ? isOneCProjectKind(current.kind) : settingsReady)) {
		return false;
	}
	if (activeFile === 'none') {
		return true;
	}
	return activeFile !== 'outside' && (activeFile.kind === undefined || isOneCProjectKind(activeFile.kind));
}

/**
 * Показывать ли профиль и окружение.
 *
 * Они есть у проекта любого вида, даже пока файлов настроек и окружения нет.
 * Открытый файл, если он есть, должен лежать в проекте.
 *
 * @param current - Выбранный проект
 * @param activeFile - Где открытый файл
 */
export function showsProjectStatus(current: KindOf | undefined, activeFile: ActiveFilePlace): boolean {
	return current !== undefined && activeFile !== 'outside';
}

/** Где лежит файл открытого редактора. */
function activeFilePlace(): ActiveFilePlace {
	const uri = vscode.window.activeTextEditor?.document.uri;
	if (uri?.scheme !== 'file') {
		return 'none';
	}
	const root = projectOf(uri);
	const project = root === undefined ? undefined : projectByRoot(root);
	return project ?? 'outside';
}

/**
 * Показывать ли автономный сервер выбранного проекта при открытом сейчас файле.
 *
 * @param vrunner - Менеджер vrunner
 */
export function serverStatusVisible(vrunner: VRunnerManager): boolean {
	return outsideProject(() => {
		const project = currentProject();
		const settingsReady = project !== undefined && project.kind === undefined && vrunner.describeSettingsState().fileReady;
		return showsServerStatus(project, settingsReady, activeFilePlace());
	});
}

/** Показывать ли профиль и окружение выбранного проекта при открытом сейчас файле. */
export function projectStatusVisible(): boolean {
	return outsideProject(() => showsProjectStatus(currentProject(), activeFilePlace()));
}
