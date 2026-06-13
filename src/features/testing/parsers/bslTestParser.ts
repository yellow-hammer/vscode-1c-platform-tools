import { DiscoveredCase, DiscoveredFile } from './parserTypes';

/**
 * Парсер тестовых модулей BSL/OneScript
 *
 * Поддерживает два режима:
 * - 'xunit' — модули xUnitFor1C/Vanessa-ADD и OneScript (1testrunner):
 *   тестовый файл содержит ИсполняемыеСценарии()/ЗаполнитьНаборТестов(),
 *   кейсы — экспортные процедуры/функции, кроме служебных;
 * - 'yaxunit' — общие модули тестового расширения YAxUnit:
 *   кейсы — аргументы вызовов ДобавитьТест("...") в ИсполняемыеСценарии().
 */
export type BslTestMode = 'xunit' | 'yaxunit';

/** Служебные экспортные методы фреймворков, не являющиеся тестами */
const SERVICE_METHOD_NAMES = new Set(
	[
		'ИсполняемыеСценарии',
		'ЗаполнитьНаборТестов',
		'ПолучитьСписокТестов',
		'Инициализация',
		'ПередЗапускомТеста',
		'ПослеЗапускаТеста',
		'ПередЗапускомНабораТестов',
		'ПослеЗапускаНабораТестов',
		'ПередВсемиТестами',
		'ПослеВсехТестов',
		'УстановитьКонтекст'
	].map((name) => name.toLowerCase())
);

/** Объявление процедуры/функции: Процедура ИмяМетода( */
const METHOD_DECLARATION_REGEX =
	/^\s*(?:Процедура|Функция|Procedure|Function)\s+([\wа-яёА-ЯЁ]+)\s*\(/i;

/** Признак экспортности в строке объявления (\b не работает с кириллицей — используем lookahead) */
const EXPORT_REGEX = /\)\s*(?:Экспорт|Export)(?![\wа-яёА-ЯЁ])/i;

/** Вызов регистрации теста: .ДобавитьТест("Имя") или Тесты.ДобавитьТест("Имя") */
const ADD_TEST_REGEX = /\.\s*ДобавитьТест\s*\(\s*"([^"]+)"/gi;

/** Аннотация теста (современный 1testrunner): &Тест над процедурой */
const TEST_ANNOTATION_REGEX = /^\s*&(?:Тест|Test)\s*(?:\/\/.*)?$/i;

/**
 * Проверяет, является ли содержимое тестовым модулем для заданного режима
 *
 * @param content - Содержимое модуля
 * @param mode - Режим разбора
 * @returns true, если файл следует показывать в панели тестирования
 */
export function isBslTestModule(content: string, mode: BslTestMode): boolean {
	if (mode === 'yaxunit') {
		return /ИсполняемыеСценарии/i.test(content) && /ДобавитьТест\s*\(/i.test(content);
	}
	// ПолучитьСписокТестов — альтернативное имя регистрации в новых тестах add;
	// &Тест — аннотационный стиль современного 1testrunner (OneScript)
	return (
		/ИсполняемыеСценарии|ЗаполнитьНаборТестов|ПолучитьСписокТестов/i.test(content) ||
		/^\s*&(?:Тест|Test)\s*$/im.test(content)
	);
}

/**
 * Собирает объявления экспортных методов модуля
 *
 * Многострочные сигнатуры поддерживаются частично: признак Экспорт ищется
 * в строке объявления и до трёх строк ниже (до закрывающей скобки).
 *
 * @param lines - Строки модуля
 * @returns Карта «имя метода в нижнем регистре → { имя, строка }»
 */
function collectExportedMethods(lines: string[]): Map<string, { name: string; line: number }> {
	const methods = new Map<string, { name: string; line: number }>();

	for (let i = 0; i < lines.length; i++) {
		const match = METHOD_DECLARATION_REGEX.exec(lines[i]);
		if (!match) {
			continue;
		}

		// Ищем «) Экспорт» в строке объявления или ближайших строках (длинные сигнатуры)
		let isExported = false;
		for (let j = i; j < Math.min(i + 4, lines.length); j++) {
			if (EXPORT_REGEX.test(lines[j])) {
				isExported = true;
				break;
			}
			if (j > i && METHOD_DECLARATION_REGEX.test(lines[j])) {
				break;
			}
		}

		if (isExported) {
			methods.set(match[1].toLowerCase(), { name: match[1], line: i });
		}
	}

	return methods;
}

/**
 * Собирает тесты аннотационного стиля: &Тест над объявлением процедуры
 *
 * Между аннотацией и объявлением допускаются другие аннотации и комментарии.
 *
 * @param lines - Строки модуля
 * @returns Кейсы в порядке следования по файлу
 */
function collectAnnotatedTests(lines: string[]): DiscoveredCase[] {
	const cases: DiscoveredCase[] = [];

	for (let i = 0; i < lines.length; i++) {
		if (!TEST_ANNOTATION_REGEX.test(lines[i])) {
			continue;
		}

		// Ищем объявление процедуры ниже, пропуская аннотации и комментарии
		for (let j = i + 1; j < lines.length; j++) {
			const trimmed = lines[j].trim();
			if (trimmed.length === 0 || trimmed.startsWith('&') || trimmed.startsWith('//')) {
				continue;
			}
			const match = METHOD_DECLARATION_REGEX.exec(lines[j]);
			if (match) {
				cases.push({ name: match[1], line: j });
			}
			break;
		}
	}

	return cases;
}

/**
 * Разбирает тестовый модуль BSL/OneScript
 *
 * @param content - Содержимое модуля (BOM допустим)
 * @param mode - Режим разбора ('xunit' или 'yaxunit')
 * @returns Структура файла или undefined, если файл не является тестовым модулем
 */
export function parseBslTestModule(content: string, mode: BslTestMode): DiscoveredFile | undefined {
	const text = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;

	if (!isBslTestModule(text, mode)) {
		return undefined;
	}

	const lines = text.split(/\r\n|\r|\n/);
	const exportedMethods = collectExportedMethods(lines);
	const cases: DiscoveredCase[] = [];

	if (mode === 'xunit') {
		// Аннотационный стиль (&Тест над процедурой) имеет приоритет:
		// если аннотации есть, кейсы — только помеченные ими методы
		const annotated = collectAnnotatedTests(lines);
		if (annotated.length > 0) {
			return { cases: annotated };
		}
	}

	if (mode === 'yaxunit') {
		// Кейсы — зарегистрированные через ДобавитьТест("...") имена;
		// строка — объявление одноимённого экспортного метода, иначе строка регистрации
		const seen = new Set<string>();
		for (let i = 0; i < lines.length; i++) {
			ADD_TEST_REGEX.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = ADD_TEST_REGEX.exec(lines[i])) !== null) {
				const name = match[1].trim();
				const key = name.toLowerCase();
				if (name.length === 0 || seen.has(key)) {
					continue;
				}
				seen.add(key);
				const method = exportedMethods.get(key);
				cases.push({ name: method?.name ?? name, line: method?.line ?? i });
			}
		}
	} else {
		// Кейсы — экспортные методы, кроме служебных
		for (const { name, line } of exportedMethods.values()) {
			if (!SERVICE_METHOD_NAMES.has(name.toLowerCase())) {
				cases.push({ name, line });
			}
		}
		cases.sort((a, b) => a.line - b.line);
	}

	if (cases.length === 0) {
		return undefined;
	}

	return { cases };
}
