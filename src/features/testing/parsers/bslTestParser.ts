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

/** Аннотация параметризованного теста (OneUnit): &ПараметризованныйТест[("шаблон имени")] */
const PARAMETERIZED_ANNOTATION_REGEX =
	/^\s*&(?:ПараметризованныйТест|ParameterizedTest)\s*(?:\(\s*"((?:[^"]|"")*)"\s*\))?\s*(?:\/\/.*)?$/i;

/** Источник значений параметров (OneUnit, повторяемый): &ИсточникЗначение(литералы) */
const VALUE_SOURCE_ANNOTATION_REGEX =
	/^\s*&(?:ИсточникЗначение|ValueSource)\s*\((.*)\)\s*(?:\/\/.*)?$/i;

/** Отображаемое имя теста (OneUnit): &ОтображаемоеИмя("имя") */
const DISPLAY_NAME_ANNOTATION_REGEX =
	/^\s*&(?:ОтображаемоеИмя|DisplayName)\s*\(\s*"((?:[^"]|"")*)"\s*\)\s*(?:\/\/.*)?$/i;

/** Любая аннотация (строка, начинающаяся с &) — для обхода блока аннотаций над процедурой */
const ANY_ANNOTATION_REGEX = /^\s*&/;

/** Шаблон имени параметризованного теста по умолчанию (как в OneUnit) */
const DEFAULT_PARAM_NAME_TEMPLATE = '{Параметры}';

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
	// &Тест / &ПараметризованныйТест — аннотационный стиль 1testrunner/OneUnit.
	// Отрицательный lookahead на букву отсекает &ТестовыйНабор, не задевая &Тест.
	return (
		/ИсполняемыеСценарии|ЗаполнитьНаборТестов|ПолучитьСписокТестов/i.test(content) ||
		/^\s*&(?:Тест|Test|ПараметризованныйТест|ParameterizedTest)(?![\wа-яёА-ЯЁ])/im.test(content)
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
 * Разбитый на аргументы список литералов из аннотации-источника значений
 *
 * Делит по запятым верхнего уровня, не задевая запятые внутри строк ("...")
 * и дат ('...'). Экранированная кавычка внутри строки — "".
 *
 * @param argsText - Содержимое скобок аннотации (без самих скобок)
 * @returns Массив токенов-аргументов в исходном виде (с кавычками)
 */
function splitAnnotationArgs(argsText: string): string[] {
	const args: string[] = [];
	let current = '';
	let quote: '"' | "'" | undefined;

	for (let i = 0; i < argsText.length; i++) {
		const ch = argsText[i];
		if (quote) {
			current += ch;
			if (ch === quote) {
				// Удвоенная кавычка того же типа — экранирование, не конец строки
				if (argsText[i + 1] === quote) {
					current += argsText[++i];
				} else {
					quote = undefined;
				}
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			current += ch;
		} else if (ch === ',') {
			args.push(current.trim());
			current = '';
		} else {
			current += ch;
		}
	}
	if (current.trim().length > 0 || args.length > 0) {
		args.push(current.trim());
	}
	return args;
}

/**
 * Представление одного значения параметра, как его показывает OneUnit
 *
 * Строковый литерал — без кавычек ("ibcmd" → ibcmd), остальное (числа, булево,
 * даты) — как записано в аннотации. Точное совпадение с jUnit гарантировано
 * для строк и чисел; экзотические типы (дата/булево) могут не совпасть.
 *
 * @param token - Токен-аргумент из splitAnnotationArgs
 */
function renderParamValue(token: string): string {
	if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
		return token.slice(1, -1).replaceAll('""', '"');
	}
	return token;
}

/**
 * Формирует отображаемое имя параметризованного кейса по шаблону OneUnit
 *
 * `{Параметры}` → `[знач1, знач2]`, `{ОтображаемоеИмя}` → имя метода/аннотации.
 * Совпадает с `Тест.Имя()` в jUnit-отчёте OneUnit.
 *
 * @param template - Шаблон имени (по умолчанию `{Параметры}`)
 * @param displayName - Отображаемое имя метода
 * @param valueTokens - Токены значений набора параметров
 */
function renderParameterizedName(
	template: string,
	displayName: string,
	valueTokens: string[]
): string {
	const params = `[${valueTokens.map(renderParamValue).join(', ')}]`;
	return template.replaceAll('{ОтображаемоеИмя}', displayName).replaceAll('{Параметры}', params);
}

/** Описание блока аннотаций, стоящего над объявлением процедуры */
interface AnnotationBlock {
	isTest: boolean;
	isParameterized: boolean;
	/** Шаблон имени из &ПараметризованныйТест или дефолт */
	template: string;
	/** Отображаемое имя из &ОтображаемоеИмя, если задано */
	displayName?: string;
	/** Наборы значений из каждой &ИсточникЗначение (по одному кейсу на набор) */
	valueSets: string[][];
}

/**
 * Собирает блок аннотаций непосредственно над строкой объявления процедуры
 *
 * Идём вверх, пока строки — аннотации (&...), комментарии или пустые. Первая
 * «обычная» строка (код, КонецПроцедуры) завершает блок.
 *
 * @param lines - Строки модуля
 * @param declLine - Индекс строки объявления процедуры
 */
function collectAnnotationBlock(lines: string[], declLine: number): AnnotationBlock {
	const block: AnnotationBlock = {
		isTest: false,
		isParameterized: false,
		template: DEFAULT_PARAM_NAME_TEMPLATE,
		valueSets: []
	};

	for (let i = declLine - 1; i >= 0; i--) {
		const trimmed = lines[i].trim();
		if (trimmed.length === 0 || trimmed.startsWith('//')) {
			continue;
		}
		if (!ANY_ANNOTATION_REGEX.test(lines[i])) {
			break;
		}

		if (TEST_ANNOTATION_REGEX.test(lines[i])) {
			block.isTest = true;
			continue;
		}
		const param = PARAMETERIZED_ANNOTATION_REGEX.exec(lines[i]);
		if (param) {
			block.isParameterized = true;
			if (param[1] !== undefined) {
				block.template = param[1].replaceAll('""', '"');
			}
			continue;
		}
		const source = VALUE_SOURCE_ANNOTATION_REGEX.exec(lines[i]);
		if (source) {
			// Аннотации идут снизу вверх — восстанавливаем исходный порядок ниже
			block.valueSets.push(splitAnnotationArgs(source[1]));
			continue;
		}
		const display = DISPLAY_NAME_ANNOTATION_REGEX.exec(lines[i]);
		if (display) {
			block.displayName = display[1].replaceAll('""', '"');
		}
	}

	block.valueSets.reverse();
	return block;
}

/**
 * Собирает тесты аннотационного стиля: &Тест и &ПараметризованныйТест
 *
 * Обычный &Тест даёт один кейс (имя = отображаемое имя или имя метода).
 * &ПараметризованныйТест с &ИсточникЗначение разворачивается в кейс на каждый
 * набор значений (имя = отображаемое имя набора, напр. «[ibcmd]»), а methodName
 * несёт имя процедуры для точечного запуска. Параметризованный тест с иными
 * источниками (JSON/Выражение/Перечисление — значения известны лишь в рантайме)
 * даёт один кейс по имени метода, чтобы он был хотя бы виден и запускаем.
 *
 * @param lines - Строки модуля
 * @returns Кейсы в порядке следования по файлу
 */
function collectAnnotatedTests(lines: string[]): DiscoveredCase[] {
	const cases: DiscoveredCase[] = [];

	for (let i = 0; i < lines.length; i++) {
		const decl = METHOD_DECLARATION_REGEX.exec(lines[i]);
		if (!decl) {
			continue;
		}

		const methodName = decl[1];
		const block = collectAnnotationBlock(lines, i);
		if (!block.isTest && !block.isParameterized) {
			continue;
		}

		const displayName = block.displayName ?? methodName;

		if (block.isParameterized && block.valueSets.length > 0) {
			for (const valueSet of block.valueSets) {
				cases.push({
					name: renderParameterizedName(block.template, displayName, valueSet),
					line: i,
					methodName
				});
			}
			continue;
		}

		// Обычный &Тест либо параметризованный без статических источников значений
		cases.push({ name: displayName, line: i, methodName });
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
