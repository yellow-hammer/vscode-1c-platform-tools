/**
 * Реестр открытых вкладок расширения по предмету.
 *
 * Одному объекту соответствует одна вкладка. Без этого двойной щелчок в дереве
 * открывал вторую копию (VS Code присылает команду элемента на каждый щелчок),
 * а пункт меню рядом с щелчком - третью: три окна на один и тот же объект.
 * Другой объект - другой ключ, поэтому свойства соседней подсистемы открываются
 * своей вкладкой, а не подменяют текущую.
 *
 * @module openPanels
 */

import * as vscode from 'vscode';

/** Вид вкладки: у одного файла бывают и свойства, и форма. */
export type OpenPanelKind = 'objectProperties' | 'sourceProperties' | 'form';

/** Открытые вкладки по ключу «вид + путь». */
const panels = new Map<string, vscode.WebviewPanel>();

/**
 * Вкладки, которые ещё открываются: чтение свойств занимает секунды, и без
 * брони повторные щелчки за это время открывали копии одной вкладки.
 */
const pending = new Set<string>();

function keyOf(kind: OpenPanelKind, target: string): string {
	return `${kind} ${target.toLowerCase()}`;
}

/**
 * Бронирует открытие вкладки на время чтения данных.
 *
 * @returns {@code false}, если этот предмет уже открывается: второй вызов лишний
 */
export function beginOpenPanel(kind: OpenPanelKind, target: string): boolean {
	const key = keyOf(kind, target);
	if (pending.has(key)) {
		return false;
	}
	pending.add(key);
	return true;
}

/** Снимает бронь: вкладка открыта или открытие сорвалось. */
export function endOpenPanel(kind: OpenPanelKind, target: string): void {
	pending.delete(keyOf(kind, target));
}

/**
 * Показывает уже открытую вкладку этого предмета.
 *
 * @param kind Вид вкладки
 * @param target Путь к файлу предмета
 * @returns {@code true}, если вкладка нашлась и выведена на передний план
 */
export function revealOpenPanel(kind: OpenPanelKind, target: string): boolean {
	const panel = panels.get(keyOf(kind, target));
	if (!panel) {
		return false;
	}
	panel.reveal(panel.viewColumn ?? vscode.ViewColumn.Active);
	return true;
}

/**
 * Ставит вкладку на учёт и снимает её при закрытии.
 *
 * @param kind Вид вкладки
 * @param target Путь к файлу предмета
 * @param panel Созданная вкладка
 */
export function trackOpenPanel(kind: OpenPanelKind, target: string, panel: vscode.WebviewPanel): void {
	const key = keyOf(kind, target);
	panels.set(key, panel);
	panel.onDidDispose(() => {
		if (panels.get(key) === panel) {
			panels.delete(key);
		}
	});
}
