/**
 * Когда строка состояния показывает профиль запуска и автономный сервер: профиль
 * есть у проекта любого вида, сервер — только у проекта 1С.
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
export function showsLaunchStatus(current: KindOf | undefined, settingsReady: boolean, activeFile: ActiveFilePlace): boolean {
	if (!current || !(current.kind ? isOneCProjectKind(current.kind) : settingsReady)) {
		return false;
	}
	if (activeFile === 'none') {
		return true;
	}
	return activeFile !== 'outside' && (activeFile.kind === undefined || isOneCProjectKind(activeFile.kind));
}

/**
 * Показывать ли профиль запуска.
 *
 * Профиль есть у проекта любого вида; пока вид не известен, нужен годный файл
 * настроек vanessa-runner. Открытый файл, если он есть, должен лежать в проекте.
 *
 * @param current - Выбранный проект
 * @param settingsReady - Файл настроек выбранного проекта годен
 * @param activeFile - Где открытый файл
 */
export function showsProfileStatus(current: KindOf | undefined, settingsReady: boolean, activeFile: ActiveFilePlace): boolean {
	if (!current || (current.kind === undefined && !settingsReady)) {
		return false;
	}
	return activeFile !== 'outside';
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
export function launchStatusVisible(vrunner: VRunnerManager): boolean {
	return outsideProject(() => {
		const project = currentProject();
		const settingsReady = project !== undefined && project.kind === undefined && vrunner.describeSettingsState().ready;
		return showsLaunchStatus(project, settingsReady, activeFilePlace());
	});
}

/**
 * Показывать ли профиль запуска выбранного проекта при открытом сейчас файле.
 *
 * @param vrunner - Менеджер vrunner
 */
export function profileStatusVisible(vrunner: VRunnerManager): boolean {
	return outsideProject(() => {
		const project = currentProject();
		const settingsReady = project !== undefined && project.kind === undefined && vrunner.describeSettingsState().ready;
		return showsProfileStatus(project, settingsReady, activeFilePlace());
	});
}
