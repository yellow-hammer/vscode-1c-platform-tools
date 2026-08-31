/**
 * Разбор вывода `vrunner infobase extensions list`.
 *
 * vanessa-runner 3 печатает JSON-массив (`--json`) с полем `имя` у каждой
 * записи; без флага — по одному имени на строку. Вокруг может быть журнал
 * запуска Предприятия, поэтому массив вырезается из смешанного текста.
 */

const EMPTY_LIST_MARK = /установленных расширений нет/i;

/** Строка похожа на имя расширения в базе, а не на строку журнала. */
const EXTENSION_NAME_LINE = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/;

/** Однословные уровни лога vanessa-runner / oscript, если попали отдельной строкой. */
const LOG_LEVEL_LINE = /^(INFOS|DEBUG|ERROR|WARN|TRACE|INFO)$/i;

/**
 * Извлекает имена установленных расширений из stdout/stderr vanessa-runner.
 *
 * @param output - Вывод команды list (stdout и при необходимости stderr)
 * @returns Имена в порядке вывода; пустой список, если расширений нет
 */
export function parseInfobaseExtensionsList(output: string): string[] {
	const text = output.trim();
	if (text === '') {
		return [];
	}

	const parsed = extractJsonArray(text);
	if (parsed !== undefined) {
		return namesFromJson(parsed);
	}

	const names: string[] = [];
	const seen = new Set<string>();
	for (const line of text.split(/\r?\n/)) {
		const name = line.trim();
		if (
			!EXTENSION_NAME_LINE.test(name) ||
			LOG_LEVEL_LINE.test(name) ||
			seen.has(name.toLowerCase())
		) {
			continue;
		}
		seen.add(name.toLowerCase());
		names.push(name);
	}
	if (names.length === 0 && EMPTY_LIST_MARK.test(text)) {
		return [];
	}
	return names;
}

/**
 * Ищет JSON-массив в смешанном выводе.
 *
 * Логгер vanessa-runner печатает JSON одним сообщением с текстом вокруг, а
 * квадратная скобка встречается и в обычных строках журнала, поэтому
 * перебираются все открывающие скобки.
 *
 * @param text - Смешанный вывод
 * @returns Массив или undefined, если JSON-массива в выводе нет
 */
function extractJsonArray(text: string): unknown[] | undefined {
	for (let start = text.indexOf('['); start >= 0; start = text.indexOf('[', start + 1)) {
		for (let end = text.lastIndexOf(']'); end > start; end = text.lastIndexOf(']', end - 1)) {
			try {
				const parsed: unknown = JSON.parse(text.slice(start, end + 1));
				if (Array.isArray(parsed)) {
					return parsed;
				}
			} catch {
				// пробуем более короткий хвост: после массива мог оказаться ещё один `]`
			}
		}
	}
	return undefined;
}

/**
 * Достаёт имена из элементов JSON: строка или объект с полем `имя` / `name`.
 *
 * @param items - Разобранный массив
 * @returns Уникальные непустые имена
 */
function namesFromJson(items: unknown[]): string[] {
	const names: string[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		const name = nameFromJsonItem(item);
		if (name === undefined) {
			continue;
		}
		const key = name.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		names.push(name);
	}
	return names;
}

/**
 * Имя расширения из элемента JSON-списка vanessa-runner.
 *
 * @param item - Строка или объект записи
 * @returns Имя или undefined
 */
function nameFromJsonItem(item: unknown): string | undefined {
	if (typeof item === 'string') {
		const trimmed = item.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	if (item === null || typeof item !== 'object') {
		return undefined;
	}
	const record = item as Record<string, unknown>;
	const raw = record['имя'] ?? record['name'] ?? record['Имя'] ?? record['Name'];
	if (typeof raw !== 'string' && typeof raw !== 'number') {
		return undefined;
	}
	const trimmed = String(raw).trim();
	return trimmed.length > 0 ? trimmed : undefined;
}
