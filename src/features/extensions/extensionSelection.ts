import type * as vscode from 'vscode';

/**
 * Выбор расширений проекта, с которыми работают команды группы «Расширения».
 *
 * Хранится локально в workspaceState (не коммитится). Значение:
 *  - `undefined` — выбор не задан: команды работают со всеми расширениями
 *    из src/cfe (включая добавленные позже);
 *  - `string[]` — явно выбранное подмножество имён каталогов. Команды работают
 *    только с этими расширениями; новые каталоги в подмножество не попадают.
 *
 * Если отмечены все доступные расширения, выбор сбрасывается в `undefined`,
 * чтобы новые расширения подхватывались автоматически.
 */

/** Ключ хранения выбора расширений в workspaceState. */
const EXTENSION_SELECTION_KEY = '1c-platform-tools.extensions.selection';

/**
 * Возвращает сохранённый выбор расширений.
 *
 * @param memento - workspaceState (undefined вне контекста VS Code)
 * @returns Массив имён каталогов или undefined, если выбор не задан
 */
export function getStoredExtensionSelection(memento: vscode.Memento | undefined): string[] | undefined {
	const stored = memento?.get<string[]>(EXTENSION_SELECTION_KEY);
	if (Array.isArray(stored)) {
		return stored;
	}
	return undefined;
}

/**
 * Сохраняет выбор расширений (локально, не коммитится).
 *
 * @param memento - workspaceState
 * @param selection - Подмножество имён каталогов или undefined для сброса
 * @returns Промис завершения записи
 */
export async function setStoredExtensionSelection(
	memento: vscode.Memento | undefined,
	selection: string[] | undefined
): Promise<void> {
	await memento?.update(EXTENSION_SELECTION_KEY, selection);
}

/**
 * Оставляет из списка каталогов расширений только выбранные.
 *
 * Порядок исходного списка сохраняется.
 *
 * @param available - Доступные каталоги расширений (src/cfe)
 * @param selection - Сохранённый выбор (undefined — без фильтра)
 * @returns Отфильтрованный список
 */
export function filterExtensionsBySelection(
	available: string[],
	selection: string[] | undefined
): string[] {
	if (selection === undefined) {
		return available;
	}
	const selected = new Set(selection);
	return available.filter((name) => selected.has(name));
}

/**
 * Приводит значение настройки `extensions.selected` к списку непустых имён.
 *
 * @param raw - Значение из конфигурации VS Code (ожидается массив строк)
 * @returns Очищенный список имён (пустой, если настройка не задана/некорректна)
 */
export function normalizeConfiguredExtensions(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw
		.filter((value): value is string => typeof value === 'string')
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

/**
 * Оставляет из доступных каталогов те, что перечислены в настройке.
 *
 * Сравнение имён без учёта регистра (каталоги на Windows регистронезависимы).
 * Порядок исходного списка сохраняется.
 *
 * @param available - Доступные каталоги расширений (src/cfe)
 * @param configured - Имена из настройки extensions.selected
 * @returns Отфильтрованный список
 */
export function filterByConfiguredNames(available: string[], configured: string[]): string[] {
	const wanted = new Set(configured.map((name) => name.toLowerCase()));
	return available.filter((name) => wanted.has(name.toLowerCase()));
}

/**
 * Оставляет из списка файлов *.cfe только относящиеся к выбранным расширениям.
 *
 * Имя расширения берётся из имени файла без расширения `.cfe`. Сравнение имён
 * без учёта регистра (для совместимости с Windows).
 *
 * @param cfeFiles - Имена файлов *.cfe
 * @param selection - Сохранённый выбор (undefined — без фильтра)
 * @returns Отфильтрованный список файлов
 */
export function filterCfeFilesBySelection(
	cfeFiles: string[],
	selection: string[] | undefined
): string[] {
	if (selection === undefined) {
		return cfeFiles;
	}
	const selected = new Set(selection.map((name) => name.toLowerCase()));
	return cfeFiles.filter((file) => selected.has(file.replace(/\.cfe$/i, '').toLowerCase()));
}
