import { XMLParser } from 'fast-xml-parser';
import { extractExpectedActual } from './expectedActual';

/**
 * Парсер jUnit XML отчётов
 *
 * Отчёты пишут разные инструменты (vanessa-runner, Vanessa Automation, YAxUnit),
 * поэтому парсер терпим к диалектам: корень <testsuites> или одиночный <testsuite>,
 * статусы по дочерним элементам failure/error/skipped, время в секундах
 * с точкой или запятой.
 */

/**
 * Результат одного testcase из jUnit-отчёта
 */
export interface JUnitCase {
	/** Имя набора (testsuite name) */
	suiteName: string;
	/** Атрибут classname testcase */
	className: string;
	/** Атрибут name testcase */
	name: string;
	/** Статус по дочерним элементам */
	status: 'passed' | 'failed' | 'error' | 'skipped';
	/** Длительность в миллисекундах */
	timeMs?: number;
	/** Краткое сообщение об ошибке (атрибут message) */
	message?: string;
	/** Подробности падения (текст элемента failure/error) */
	details?: string;
	/** Ожидаемое значение, если распознано в тексте падения (для diff-представления) */
	expected?: string;
	/** Фактическое значение, если распознано в тексте падения (для diff-представления) */
	actual?: string;
}

/**
 * Приводит значение к массиву (fast-xml-parser возвращает объект при одном элементе)
 */
function toArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined || value === null) {
		return [];
	}
	return Array.isArray(value) ? value : [value];
}

/**
 * Извлекает текст и message из элемента failure/error/skipped
 *
 * Элемент может быть строкой ("текст ошибки"), объектом с атрибутами
 * и текстом (#text) или пустым (self-closing).
 */
function extractFailureInfo(node: unknown): { message?: string; details?: string } {
	if (node === undefined || node === null) {
		return {};
	}
	if (typeof node === 'string') {
		return { details: node.trim() || undefined };
	}
	if (typeof node === 'object') {
		const obj = node as Record<string, unknown>;
		const message = typeof obj['@_message'] === 'string' ? obj['@_message'] : undefined;
		const text = typeof obj['#text'] === 'string' ? obj['#text'].trim() : undefined;
		return { message, details: text || undefined };
	}
	return {};
}

/**
 * Преобразует атрибут time (секунды, разделитель «.» или «,») в миллисекунды
 */
function parseTimeMs(time: unknown): number | undefined {
	if (time === undefined || time === null) {
		return undefined;
	}
	const normalized = String(time).replace(',', '.');
	const seconds = Number.parseFloat(normalized);
	if (Number.isNaN(seconds)) {
		return undefined;
	}
	return Math.round(seconds * 1000);
}

/**
 * Разбирает один testcase
 */
function parseTestCase(testcase: Record<string, unknown>, suiteName: string): JUnitCase {
	const failures = toArray(testcase['failure']);
	const errors = toArray(testcase['error']);
	const skipped = toArray(testcase['skipped']);

	let status: JUnitCase['status'] = 'passed';
	let failureNode: unknown;
	if (failures.length > 0) {
		status = 'failed';
		failureNode = failures[0];
	} else if (errors.length > 0) {
		status = 'error';
		failureNode = errors[0];
	} else if (skipped.length > 0) {
		status = 'skipped';
		failureNode = skipped[0];
	} else {
		// Некоторые инструменты (1bdd) пишут статус атрибутом, без дочерних элементов
		const statusAttr = String(testcase['@_status'] ?? '').toLowerCase();
		if (statusAttr === 'skipped' || statusAttr === 'pending' || statusAttr === 'notrun') {
			status = 'skipped';
		} else if (statusAttr === 'failed' || statusAttr === 'broken') {
			status = 'failed';
		} else if (statusAttr === 'error') {
			status = 'error';
		}
	}

	const { message, details } = extractFailureInfo(failureNode);
	const diff = extractExpectedActual(message, details);

	return {
		suiteName,
		className: typeof testcase['@_classname'] === 'string' ? testcase['@_classname'] : '',
		name: typeof testcase['@_name'] === 'string' ? testcase['@_name'] : String(testcase['@_name'] ?? ''),
		status,
		timeMs: parseTimeMs(testcase['@_time']),
		message,
		details,
		expected: diff?.expected,
		actual: diff?.actual
	};
}

/**
 * Рекурсивно собирает testcase из testsuite (наборы могут быть вложенными)
 */
function collectFromSuite(suite: Record<string, unknown>, results: JUnitCase[]): void {
	const suiteName = typeof suite['@_name'] === 'string' ? suite['@_name'] : '';

	for (const testcase of toArray(suite['testcase'])) {
		if (testcase && typeof testcase === 'object') {
			results.push(parseTestCase(testcase as Record<string, unknown>, suiteName));
		}
	}

	for (const nested of toArray(suite['testsuite'])) {
		if (nested && typeof nested === 'object') {
			collectFromSuite(nested as Record<string, unknown>, results);
		}
	}
}

/**
 * Разбирает jUnit XML отчёт
 *
 * @param xml - Содержимое XML-файла
 * @returns Список testcase
 * @throws {Error} Если XML повреждён или не содержит testsuite/testsuites
 */
export function parseJUnitXml(xml: string): JUnitCase[] {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '@_',
		parseAttributeValue: false,
		parseTagValue: false,
		trimValues: false
	});

	let parsed: Record<string, unknown>;
	try {
		parsed = parser.parse(xml) as Record<string, unknown>;
	} catch (error) {
		throw new Error(`Не удалось разобрать jUnit XML: ${(error as Error).message}`);
	}

	const results: JUnitCase[] = [];
	const testsuites = parsed['testsuites'];
	const testsuite = parsed['testsuite'];

	if (testsuites && typeof testsuites === 'object') {
		for (const suite of toArray((testsuites as Record<string, unknown>)['testsuite'])) {
			if (suite && typeof suite === 'object') {
				collectFromSuite(suite as Record<string, unknown>, results);
			}
		}
	} else if (testsuite && typeof testsuite === 'object') {
		collectFromSuite(testsuite as Record<string, unknown>, results);
	} else {
		throw new Error('jUnit XML не содержит элементов testsuites/testsuite');
	}

	return results;
}
