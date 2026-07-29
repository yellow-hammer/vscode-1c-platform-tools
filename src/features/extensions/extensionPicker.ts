import * as vscode from 'vscode';
import {
	getStoredExtensionSelection,
	setStoredExtensionSelection,
	filterExtensionsBySelection,
	normalizeConfiguredExtensions,
	filterByConfiguredNames
} from './extensionSelection';

/** Элемент quickpick для выбора расширения. */
interface ExtensionPickItem extends vscode.QuickPickItem {
	/** Имя расширения (каталог в src/cfe) */
	name: string;
}

/**
 * Показывает выбор расширений с чекбоксами и запоминает его для проекта.
 *
 * Приоритет источников выбора:
 * 1. Явный список в опциях вызова (агент, MCP) — используется без окна выбора
 *    и не меняет сохранённый выбор проекта.
 * 2. Настройка `1c-platform-tools.extensions.selected` (settings.json) — если
 *    задана, используется без окна выбора.
 * 3. Режим wait (MCP) — применяется сохранённый выбор (или все).
 * 4. Иначе — quickpick с чекбоксами: изначально отмечены все (либо ранее
 *    сохранённое подмножество). Выбор сохраняется в workspaceState (локально,
 *    не коммитится). Если отмечены все — фильтр сбрасывается, чтобы новые
 *    расширения подхватывались автоматически.
 *
 * @param allNames - Все доступные имена расширений
 * @param memento - workspaceState для хранения выбора
 * @param opts - Параметры выполнения (режим wait, явный список расширений)
 * @returns Выбранное подмножество, либо undefined при отмене quickpick
 */
export async function pickExtensions(
	allNames: string[],
	memento: vscode.Memento | undefined,
	opts?: { wait?: boolean; extensions?: string[] }
): Promise<string[] | undefined> {
	if (Array.isArray(opts?.extensions) && opts.extensions.length > 0) {
		return filterByConfiguredNames(allNames, normalizeConfiguredExtensions(opts.extensions));
	}

	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const configured = normalizeConfiguredExtensions(config.get('extensions.selected'));
	if (configured.length > 0) {
		return filterByConfiguredNames(allNames, configured);
	}

	const stored = getStoredExtensionSelection(memento);

	// Агентный вызов (объект опций передан) не открывает quickpick независимо
	// от wait: применяется сохранённый выбор проекта (или все расширения)
	if (opts !== undefined) {
		return filterExtensionsBySelection(allNames, stored);
	}

	const isChecked = (name: string): boolean => stored === undefined || stored.includes(name);
	const items: ExtensionPickItem[] = allNames.map((name) => ({ label: name, name, picked: isChecked(name) }));
	const picked = await vscode.window.showQuickPick(items, {
		canPickMany: true,
		title: 'Расширения',
		placeHolder: 'Отметьте расширения, с которыми выполнить команду'
	});
	if (!picked) {
		return undefined;
	}

	const pickedNames = picked.map((item) => item.name);
	await setStoredExtensionSelection(
		memento,
		pickedNames.length === allNames.length ? undefined : pickedNames
	);
	return pickedNames;
}
