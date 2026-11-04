/**
 * Проект, в котором выполняется команда.
 *
 * Команда запоминает проект при запуске: смена текущего проекта во время её
 * работы не уводит оставшиеся шаги в другой проект.
 *
 * @module projectScope
 */

import * as path from 'node:path';
import type * as vscode from 'vscode';
import { currentRoot, projectByRoot, projectDisplayName, projectOf, runWithProject } from '../shared/workspaceProjects';

/**
 * Обработчик команды, который выполняется в проекте, текущем на момент вызова.
 *
 * @param handler - Обработчик команды
 */
export function inCurrentProject<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
	return (...args: A) => runWithProject(currentRoot(), () => handler(...args));
}

/**
 * Выполняет действие над файлом или узлом в проекте этого файла; вне проектов в текущем.
 *
 * @param target - Файл, каталог или узел с путём
 * @param fn - Действие
 */
export function inProjectOf<R>(target: vscode.Uri | string | undefined, fn: () => R): R {
	const root = target === undefined ? undefined : projectOf(target);
	return runWithProject(root ?? currentRoot(), fn);
}

/**
 * Выполняет действие в указанном корне. Без корня остаётся текущий проект.
 *
 * @param root - Корень проекта узла
 * @param fn - Действие
 */
export function inProjectRoot<R>(root: string | undefined, fn: () => R): R {
	return runWithProject(root ?? currentRoot(), fn);
}

/**
 * Путь для команды: относительно корня проекта с прямыми разделителями, вне проекта абсолютный.
 *
 * @param root - Корень проекта
 * @param target - Абсолютный путь
 */
export function projectRelativePath(root: string, target: string): string {
	const relative = path.relative(root, target);
	if (relative === '') {
		return '.';
	}
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		return target;
	}
	return relative.split(path.sep).join('/');
}

/**
 * Имя проекта для сообщений: как в списке проектов, у каталога вне списка его имя.
 *
 * @param root - Корень проекта
 */
export function projectLabel(root: string): string {
	const project = projectByRoot(root);
	return project ? projectDisplayName(project) : path.basename(root);
}
