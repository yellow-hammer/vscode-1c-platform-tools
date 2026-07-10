import * as vscode from 'vscode';
import { TREE_GROUPS } from './treeStructure';

/** Ключ хранения скрытых групп дерева команд в globalState */
const HIDDEN_GROUPS_STORAGE_KEY = '1c-platform-tools.hiddenToolGroups';

/** Контекст-ключ: есть ли скрытые группы (управляет иконкой кнопки в тулбаре) */
const HIDDEN_GROUPS_CONTEXT_KEY = '1c-platform-tools.hasHiddenToolGroups';

/** Группа дерева команд, доступная для скрытия */
export interface HideableToolGroup {
	/** Стабильный идентификатор группы (sectionType) */
	sectionType: string;
	/** Название группы для отображения */
	label: string;
}

/**
 * Возвращает список групп дерева команд, доступных для скрытия: статические из
 * TREE_GROUPS (кроме «Помощь и поддержка», вынесенной в отдельную плашку) плюс
 * динамические группы задач.
 * @returns Массив групп с идентификатором и названием
 */
export function getHideableToolGroups(): HideableToolGroup[] {
	const staticGroups = TREE_GROUPS.filter((group) => group.sectionType !== 'helpAndSupport').map(
		(group) => ({ sectionType: group.sectionType, label: group.groupLabel })
	);
	return [
		...staticGroups,
		{ sectionType: 'oscriptTasks', label: 'Задачи (oscript)' },
		{ sectionType: 'launch', label: 'Задачи (workspace)' },
	];
}

/**
 * Загружает множество скрытых групп (sectionType) из хранилища расширения.
 * @param context - Контекст расширения VS Code
 * @returns Множество идентификаторов скрытых групп
 */
export function getHiddenToolGroups(context: vscode.ExtensionContext): Set<string> {
	const raw = context.globalState.get<string[]>(HIDDEN_GROUPS_STORAGE_KEY);
	if (!Array.isArray(raw)) {
		return new Set();
	}
	return new Set(raw.filter((id): id is string => typeof id === 'string'));
}

/**
 * Сохраняет множество скрытых групп (sectionType) в хранилище расширения.
 * @param context - Контекст расширения VS Code
 * @param sectionTypes - Идентификаторы скрытых групп
 */
export async function setHiddenToolGroups(
	context: vscode.ExtensionContext,
	sectionTypes: string[]
): Promise<void> {
	await context.globalState.update(HIDDEN_GROUPS_STORAGE_KEY, sectionTypes);
}

/**
 * Синхронизирует контекст-ключ `1c-platform-tools.hasHiddenToolGroups` с
 * состоянием хранилища, чтобы в тулбаре отображалась подходящая иконка.
 * @param context - Контекст расширения VS Code
 */
export async function syncHiddenToolGroupsContext(
	context: vscode.ExtensionContext
): Promise<void> {
	const hasHidden = getHiddenToolGroups(context).size > 0;
	await vscode.commands.executeCommand('setContext', HIDDEN_GROUPS_CONTEXT_KEY, hasHidden);
}
