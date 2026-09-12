import type * as vscode from 'vscode';

/**
 * Выбор расширений проекта, с которыми работают команды расширений: своя запись
 * у расширений решения и своя у тестовых.
 *
 * У расширения три имени: каталог относительно рабочей области, имя этого
 * каталога и имя из метаданных. Собранный `*.cfe` зовётся по каталогу, в базе
 * расширение живёт под именем из метаданных, а пользователь, настройка и агент
 * называют его как удобно, поэтому выбор принимает любое из трёх без учёта регистра.
 *
 * Хранится локально в workspaceState (не коммитится). Значение:
 *  - `undefined` — выбор не задан: команды работают со всеми расширениями
 *    своей области (включая добавленные позже);
 *  - `string[]` — явно выбранное подмножество ключей выбора. Команды работают
 *    только с этими расширениями; новые в подмножество не попадают.
 *
 * Если отмечены все доступные расширения, выбор сбрасывается в `undefined`,
 * чтобы новые расширения подхватывались автоматически.
 */

/** Ключ хранения выбора расширений в workspaceState. */
const EXTENSION_SELECTION_KEY = '1c-platform-tools.extensions.selection';

/**
 * Область выбора: расширения решения и тестовые лежат в разных каталогах, и
 * имена у них разные. Общий выбор на две области означал бы, что выбор тестовых
 * расширений затирает выбор рабочих и наоборот.
 */
export type ExtensionScope = 'solution' | 'tests';

/** Имена расширения, по любому из которых его выбирают. */
export interface ExtensionNames {
	/** Имя каталога: им назван собранный `*.cfe`. */
	folder: string;
	/** Имя из метаданных: под ним расширение живёт в базе. */
	name: string;
	/** Каталог относительно рабочей области, прямые разделители; его нет у расширения, которого в исходниках ещё нет. */
	dir?: string;
}

/** Ключ хранения по области выбора. */
function storageKey(scope: ExtensionScope): string {
	return scope === 'tests' ? `${EXTENSION_SELECTION_KEY}.tests` : EXTENSION_SELECTION_KEY;
}

function equalsIgnoreCase(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase();
}

/** Путь, как его записывает раскладка: прямые разделители, без хвостового. */
function normalizePath(value: string): string {
	return value.split('\\').join('/').replace(/\/+$/, '');
}

/**
 * Подходит ли имя расширению: совпадает с именем каталога, путём к нему или
 * именем из метаданных.
 *
 * @param extension - Расширение
 * @param wanted - Имя из выбора, настройки или параметра
 */
export function matchesExtension(extension: ExtensionNames, wanted: string): boolean {
	const target = normalizePath(wanted.trim());
	if (target.length === 0) {
		return false;
	}
	return (
		equalsIgnoreCase(extension.folder, target) ||
		equalsIgnoreCase(extension.name, target) ||
		(extension.dir !== undefined && equalsIgnoreCase(normalizePath(extension.dir), target))
	);
}

/**
 * Первое расширение, которому подходит имя.
 *
 * @param extensions - Где искать
 * @param wanted - Имя из выбора, настройки или параметра
 */
export function findExtension<T extends ExtensionNames>(extensions: readonly T[], wanted: string): T | undefined {
	return extensions.find((extension) => matchesExtension(extension, wanted));
}

/**
 * Ключ выбора: имя каталога, а при одноимённых каталогах путь к нему.
 *
 * Под этим ключом расширение показывается в окне выбора и запоминается.
 *
 * @param extension - Расширение
 * @param all - Все расширения окна выбора
 */
export function selectionKey(extension: ExtensionNames, all: readonly ExtensionNames[]): string {
	const twin = all.some((other) => other !== extension && equalsIgnoreCase(other.folder, extension.folder));
	return twin && extension.dir !== undefined ? extension.dir : extension.folder;
}

/**
 * Возвращает сохранённый выбор расширений.
 *
 * @param memento - workspaceState (undefined вне контекста VS Code)
 * @returns Массив ключей выбора или undefined, если выбор не задан
 */
export function getStoredExtensionSelection(
	memento: vscode.Memento | undefined,
	scope: ExtensionScope = 'solution'
): string[] | undefined {
	const stored = memento?.get<string[]>(storageKey(scope));
	if (Array.isArray(stored)) {
		return stored;
	}
	return undefined;
}

/**
 * Сохраняет выбор расширений (локально, не коммитится).
 *
 * @param memento - workspaceState
 * @param selection - Подмножество ключей выбора или undefined для сброса
 * @returns Промис завершения записи
 */
export async function setStoredExtensionSelection(
	memento: vscode.Memento | undefined,
	selection: string[] | undefined,
	scope: ExtensionScope = 'solution'
): Promise<void> {
	await memento?.update(storageKey(scope), selection);
}

/**
 * Оставляет из расширений только выбранные.
 *
 * Имя из выбора подходит расширению по любому из его имён без учёта регистра.
 * Порядок исходного списка сохраняется.
 *
 * @param available - Доступные расширения
 * @param selection - Сохранённый выбор, настройка или явный список (undefined — без фильтра)
 * @returns Отфильтрованный список
 */
export function filterExtensionsBySelection<T extends ExtensionNames>(
	available: readonly T[],
	selection: readonly string[] | undefined
): T[] {
	if (selection === undefined) {
		return [...available];
	}
	return available.filter((extension) => selection.some((wanted) => matchesExtension(extension, wanted)));
}

/**
 * Приводит значение настройки `cfe.selected` к списку непустых имён.
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
 * Имя файла `*.cfe` без расширения: так зовётся каталог, из которого файл собран.
 *
 * @param file - Имя или путь файла
 */
export function cfeStem(file: string): string {
	const name = file.split(/[\\/]/).pop() ?? file;
	return name.replace(/\.cfe$/i, '');
}

/**
 * Оставляет из списка файлов *.cfe только относящиеся к выбранным.
 *
 * Файл сравнивается по имени без `.cfe` и без учёта регистра.
 *
 * @param cfeFiles - Имена файлов *.cfe
 * @param stems - Имена выбранных файлов без `.cfe` (undefined — без фильтра)
 * @returns Отфильтрованный список файлов
 */
export function filterCfeFilesBySelection(
	cfeFiles: readonly string[],
	stems: readonly string[] | undefined
): string[] {
	if (stems === undefined) {
		return [...cfeFiles];
	}
	const selected = new Set(stems.map((stem) => stem.toLowerCase()));
	return cfeFiles.filter((file) => selected.has(cfeStem(file).toLowerCase()));
}
