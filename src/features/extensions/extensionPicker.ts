import * as vscode from 'vscode';
import {
	getStoredExtensionSelection,
	setStoredExtensionSelection,
	filterExtensionsBySelection,
	matchesExtension,
	normalizeConfiguredExtensions,
	selectionKey,
	type ExtensionNames,
	type ExtensionScope
} from './extensionSelection';

/** Элемент quickpick для выбора расширения. */
interface ExtensionPickItem<T extends ExtensionNames> extends vscode.QuickPickItem {
	extension: T;
	/** Под этим ключом выбор запоминается. */
	key: string;
}

/**
 * Показывает выбор расширений с чекбоксами и запоминает его для проекта.
 *
 * Приоритет источников выбора:
 * 1. Явный список в опциях вызова (агент, MCP) — используется без окна выбора
 *    и не меняет сохранённый выбор проекта.
 * 2. Настройка области в settings.json (`1c-platform-tools.cfe.selected`
 *    для расширений решения, `1c-platform-tools.test.cfe.selected` для
 *    тестовых) — если задана, используется без окна выбора.
 * 3. Режим wait (MCP) — применяется сохранённый выбор (или все).
 * 4. Иначе — quickpick с чекбоксами: изначально отмечены все (либо ранее
 *    сохранённое подмножество). Выбор сохраняется в workspaceState (локально,
 *    не коммитится). Если отмечены все — фильтр сбрасывается, чтобы новые
 *    расширения подхватывались автоматически.
 *
 * Имя из любого источника подходит расширению по каталогу, пути к нему или
 * имени из метаданных; в окне расширение подписано именем каталога, рядом имя
 * из метаданных.
 *
 * @param extensions - Все доступные расширения
 * @param memento - workspaceState для хранения выбора
 * @param opts - Параметры выполнения (режим wait, явный список расширений)
 * @returns Выбранное подмножество, либо undefined при отмене quickpick
 */
export async function pickExtensions<T extends ExtensionNames>(
	extensions: readonly T[],
	memento: vscode.Memento | undefined,
	opts?: { wait?: boolean; extensions?: string[] },
	scope: ExtensionScope = 'solution'
): Promise<T[] | undefined> {
	if (Array.isArray(opts?.extensions) && opts.extensions.length > 0) {
		return filterExtensionsBySelection(extensions, normalizeConfiguredExtensions(opts.extensions));
	}

	// У каждой области свой список в настройках: cfe.selected — решение,
	// test.cfe.selected — тестовые. Заданный список работает без окна выбора.
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const configured = normalizeConfiguredExtensions(
		config.get(scope === 'tests' ? 'test.cfe.selected' : 'cfe.selected')
	);
	if (configured.length > 0) {
		return filterExtensionsBySelection(extensions, configured);
	}

	const stored = getStoredExtensionSelection(memento, scope);

	// Агентный вызов и шаг цепочки (объект опций передан) не открывают quickpick независимо
	// от wait: применяется сохранённый выбор проекта. Если от него ничего не осталось (выбор
	// пуст или сделан для другого состава), берём все расширения: остановить прогон нечем,
	// а «ни одного» здесь всегда означает недосмотр, а не намерение.
	if (opts !== undefined) {
		const selected = filterExtensionsBySelection(extensions, stored);
		return selected.length > 0 ? selected : [...extensions];
	}

	const items: ExtensionPickItem<T>[] = extensions.map((extension) => {
		const key = selectionKey(extension, extensions);
		return {
			label: key,
			description: extension.name !== key ? extension.name : undefined,
			picked: stored === undefined || stored.some((wanted) => matchesExtension(extension, wanted)),
			extension,
			key,
		};
	});
	const picked = await vscode.window.showQuickPick(items, {
		canPickMany: true,
		title: scope === 'tests' ? 'Тестовые расширения' : 'Расширения',
		placeHolder: 'Отметьте расширения, с которыми выполнить команду'
	});
	if (!picked) {
		return undefined;
	}

	await setStoredExtensionSelection(
		memento,
		picked.length === extensions.length ? undefined : picked.map((item) => item.key),
		scope
	);
	return picked.map((item) => item.extension);
}
