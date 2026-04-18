import * as vscode from 'vscode';
import { TREE_GROUPS, type TreeGroup, type TreeCommandEntry } from './treeStructure';

/** Ключ хранения избранных команд в globalState */
const FAVORITES_STORAGE_KEY = '1c-platform-tools.favorites';

/**
 * Запись избранной команды для хранения и отображения в дереве
 */
export interface FavoriteEntry {
	/** Идентификатор команды VS Code */
	command: string;
	/** Заголовок для отображения */
	title: string;
	/** Аргументы команды (для команд с параметрами) */
	arguments?: unknown[];
	/** Название группы (для префикса в дереве и иконки) */
	groupLabel?: string;
	/** Тип секции для иконки: infobase, configuration, extension и т.д. */
	sectionType?: string;
}

/** Элемент списка команд в группе (для окна настройки избранного) — из treeStructure */
export type PickableCommandInGroup = TreeCommandEntry;

/** Группа команд для окна настройки избранного — из treeStructure */
export type PickableCommandGroup = TreeGroup;

/**
 * Элемент списка команд, доступных для добавления в избранное (плоский, для обратной совместимости)
 */
export interface PickableCommand {
	command: string;
	title: string;
}

/**
 * Возвращает список команд по группам для окна настройки избранного (из единой структуры дерева)
 * @returns Массив групп с командами
 */
export function getPickableCommandsByGroup(): PickableCommandGroup[] {
	return TREE_GROUPS;
}

/**
 * Возвращает плоский список команд для обратной совместимости
 * @returns Массив команд с идентификатором и заголовком
 */
export function getPickableCommands(): PickableCommand[] {
	return TREE_GROUPS.flatMap((g) =>
		g.commands.map((c) => ({ command: c.command, title: c.title }))
	);
}

/**
 * Загружает список избранных команд из хранилища расширения
 * @param context - Контекст расширения VS Code
 * @returns Массив записей избранного
 */
export function getFavorites(context: vscode.ExtensionContext): FavoriteEntry[] {
	const raw = context.globalState.get<FavoriteEntry[]>(FAVORITES_STORAGE_KEY);
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.filter(
		(entry): entry is FavoriteEntry =>
			typeof entry === 'object' &&
			entry !== null &&
			typeof entry.command === 'string' &&
			typeof entry.title === 'string'
	);
}

/**
 * Сохраняет список избранных команд в хранилище расширения
 * @param context - Контекст расширения VS Code
 * @param entries - Массив записей избранного
 */
export async function setFavorites(
	context: vscode.ExtensionContext,
	entries: FavoriteEntry[]
): Promise<void> {
	await context.globalState.update(FAVORITES_STORAGE_KEY, entries);
}
