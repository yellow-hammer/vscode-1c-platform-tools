import type { SyntaxCheckError } from '../../shared/commandExecutionTypes';
import { resolveBslPathFromMetadata } from './metadataPathResolver';
import { parseJUnitXml, JUnitCase } from '../testing/parsers/junitParser';

/**
 * Разбор jUnit-отчёта синтаксического контроля (vrunner syntax-check) в плоский
 * список находок для DiagnosticCollection.
 *
 * Форматы двух версий (проверено живыми прогонами на ssl_3_1):
 *   - 2.x: корень <testsuites name="CheckConfig.<режим>">, classname вида
 *     `CheckConfig.<режим>.Ошибка`, в name только путь по метаданным;
 *   - 3.x: classname `syntax-check`, в name путь и текст ошибки склеены
 *     через пробел, message повторяет ту же строку целиком;
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

/** Признак пути по метаданным: не меньше трёх сегментов через точку. */
function looksLikeMetadataPath(token: string): boolean {
	return token.split('.').length >= 3;
}

/**
 * Делит name элемента testcase на путь по метаданным и остаток.
 *
 * В 2.x в name лежит только путь. В 3.x путь и текст ошибки склеены через
 * пробел, поэтому путём считается первое слово, если оно похоже на путь.
 *
 * @param name - Значение атрибута name
 * @returns Путь по метаданным и остаток строки
 */
function splitCaseName(name: string): { metadataPath: string; rest: string } {
	const trimmed = (name ?? '').trim();
	const spaceAt = trimmed.search(/\s/);
	if (spaceAt <= 0) {
		return { metadataPath: trimmed, rest: '' };
	}
	const head = trimmed.slice(0, spaceAt);
	if (!looksLikeMetadataPath(head)) {
		return { metadataPath: trimmed, rest: '' };
	}
	return { metadataPath: head, rest: trimmed.slice(spaceAt + 1).trim() };
}

/** Убирает путь по метаданным из начала текста ошибки (запись 3.x). */
function stripMetadataPrefix(line: string, metadataPath: string): string {
	const trimmed = line.trim();
	return trimmed.startsWith(`${metadataPath} `)
		? trimmed.slice(metadataPath.length + 1).trim()
		: trimmed;
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
		const { metadataPath, rest } = splitCaseName(testCase.name);
		if (!metadataPath) {
			continue;
		}
		const severity = severityFromCase(testCase);
		const lines = splitMessages(testCase.message ?? testCase.details)
			.map((line) => stripMetadataPrefix(line, metadataPath))
			.filter((line) => line.length > 0);
		if (lines.length === 0 && rest) {
			lines.push(rest);
		}
		// Если message пуст — оставляем одну находку с обобщённым текстом
		const messages = lines.length > 0 ? lines : ['Ошибка синтаксического контроля'];
		for (const message of messages) {
			findings.push({ metadataPath, message, severity });
		}
	}

	return findings;
}

/**
 * Переводит находки в ошибки для синхронного ответа команды.
 *
 * Агенту нужен путь к файлу, а не путь по метаданным: он правит .bsl.
 * Там, где тип метаданных не раскладывается в модуль, остаётся исходный путь.
 *
 * @param findings - Находки из jUnit-отчёта
 * @param cfRel - Каталог исходников конфигурации относительно корня проекта
 * @returns Ошибки с адресом файла и текстом сообщения
 */
export function toSyntaxCheckErrors(
	findings: SyntaxCheckFinding[],
	cfRel: string
): SyntaxCheckError[] {
	return findings.map((finding) => {
		const bslRel = resolveBslPathFromMetadata(finding.metadataPath);
		return {
			filepath: bslRel ? `${cfRel}/${bslRel}` : finding.metadataPath,
			metadataPath: finding.metadataPath,
			severity: finding.severity,
			message: finding.message,
		};
	});
}
