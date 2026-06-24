import { parseJUnitXml, JUnitCase } from '../testing/parsers/junitParser';

/**
 * Разбор jUnit-отчёта синтаксического контроля (vrunner syntax-check) в плоский
 * список находок для DiagnosticCollection.
 *
 * Особенности формата (проверено на ssl_3_1, см. [[ssl31-reference-test-config]]):
 *   - корень <testsuites name="CheckConfig.<режим>">, classname вида
 *     `CheckConfig.<режим>.Ошибка`;
 *   - в одном testcase атрибут message элемента <failure> содержит НЕСКОЛЬКО
 *     ошибок, разделённых переводом строки (&#xA;) — каждую разворачиваем в
 *     отдельную находку;
 *   - номера строк vrunner не выдаёт (только путь по метаданным в name).
 *
 * Чистый модуль — тестируется без vscode.
 */

/** Уровень находки синтаксического контроля */
export type SyntaxCheckSeverity = 'error' | 'warning';

/** Одна ошибка синтаксического контроля */
export interface SyntaxCheckFinding {
	/** Путь по метаданным из testcase name (`ОбщийМодуль.Имя.Модуль`) */
	metadataPath: string;
	/** Текст одной ошибки (одна строка исходного message) */
	message: string;
	/** Уровень для DiagnosticSeverity */
	severity: SyntaxCheckSeverity;
}

/**
 * Определяет уровень находки по classname/типу testcase
 *
 * vrunner помечает большинство проблем как ERROR (classname `...Ошибка`).
 * Предупреждения, если появятся, распознаём по «Предупреждени» в classname.
 */
function severityFromCase(testCase: JUnitCase): SyntaxCheckSeverity {
	const marker = `${testCase.className}`.toLowerCase();
	if (marker.includes('предупрежд') || marker.includes('warning')) {
		return 'warning';
	}
	return 'error';
}

/**
 * Разбивает message элемента failure на отдельные ошибки
 *
 * vrunner разделяет ошибки переводом строки, но в атрибуте он закодирован
 * числовой сущностью (&#xA;), а fast-xml-parser числовые сущности в атрибутах
 * НЕ раскрывает (именованные — &quot; и т.п. — раскрывает). Поэтому делим как по
 * сырым переводам строки, так и по литеральным сущностям LF/CR (hex и dec, с
 * возможными ведущими нулями). Пустые строки отбрасываются.
 */
const LINE_BREAK = /&#x0*a;|&#0*10;|&#x0*d;|&#0*13;|\r\n|\r|\n/gi;

function splitMessages(message: string | undefined): string[] {
	if (!message) {
		return [];
	}
	return message
		.split(LINE_BREAK)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * Разбирает XML jUnit-отчёта syntax-check в список находок
 *
 * @param xml - Содержимое junit.xml
 * @returns Плоский список находок (по одной на строку ошибки)
 * @throws {Error} Если XML повреждён или не содержит testsuite/testsuites
 */
export function parseSyntaxCheckFindings(xml: string): SyntaxCheckFinding[] {
	const cases = parseJUnitXml(xml);
	const findings: SyntaxCheckFinding[] = [];

	for (const testCase of cases) {
		if (testCase.status !== 'failed' && testCase.status !== 'error') {
			continue;
		}
		const metadataPath = testCase.name.trim();
		if (!metadataPath) {
			continue;
		}
		const severity = severityFromCase(testCase);
		const lines = splitMessages(testCase.message ?? testCase.details);
		// Если message пуст — оставляем одну находку с обобщённым текстом
		const messages = lines.length > 0 ? lines : ['Ошибка синтаксического контроля'];
		for (const message of messages) {
			findings.push({ metadataPath, message, severity });
		}
	}

	return findings;
}
