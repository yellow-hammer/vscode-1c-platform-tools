/**
 * Извлечение пары «ожидаемое/фактическое» из текста падения теста
 *
 * jUnit/Cucumber-отчёты 1С (YAxUnit, xUnitFor1C, Vanessa Automation) и xUnit-движки
 * часто пишут ожидаемое и фактическое значения прямо в текст сообщения об ошибке,
 * не выделяя их отдельными полями. Распознаём распространённые форматы ассертов,
 * чтобы показать нативный diff в VS Code (vscode.TestMessage.diff).
 *
 * Это эвристика «по возможности»: не распознали — вызывающий код откатывается
 * на обычное текстовое сообщение.
 */

/**
 * Пара значений для diff-представления падения
 */
export interface ExpectedActual {
	/** Ожидаемое значение */
	expected: string;
	/** Фактическое значение */
	actual: string;
}

/** Метка ожидаемого значения (рус./англ.) */
const EXPECTED = '(?:ожидаемое(?:\\s+значение)?|ожидаемый(?:\\s+результат)?|ожида(?:ется|ем|ли)|expected)';

/** Сильные метки фактического значения — однозначны даже без знака-разделителя */
const ACTUAL_STRONG =
	'(?:фактическое(?:\\s+значение)?|фактический(?:\\s+результат)?|фактически|получено|получили|but\\s+was|but\\s+got|actual(?:\\s+value)?)';

/** Любые метки фактического (включая короткие «was»/«got») — только со знаком-разделителем */
const ACTUAL_ANY = `(?:${ACTUAL_STRONG}|was|got)`;

/**
 * Шаблоны распознавания, от строгих к свободным. Группа 1 — ожидаемое, группа 2 — фактическое.
 */
const PATTERNS: RegExp[] = [
	// Классический JUnit assertEquals: expected:<4> but was:<5>
	new RegExp(`${EXPECTED}\\s*:?\\s*<([\\s\\S]*?)>\\s*${ACTUAL_ANY}\\s*:?\\s*<([\\s\\S]*?)>`, 'i'),
	// Метка-значение, знак-разделитель (перевод строки/«,»/«.»/«;»), метка-значение:
	//   «Ожидали: 4, получили: 5», «Expected: 4\nActual: 5», «Ожидаемое значение: 4. Фактическое: 5»
	new RegExp(`${EXPECTED}\\s*:?\\s*([\\s\\S]+?)\\s*[\\r\\n;,.]+\\s*${ACTUAL_ANY}\\s*:?\\s*([\\s\\S]+)`, 'i'),
	// Без знака-разделителя, только сильные метки: «Expected: 4 but was: 5»
	new RegExp(`${EXPECTED}\\s*:?\\s*([\\s\\S]+?)\\s+${ACTUAL_STRONG}\\s*:?\\s*([\\s\\S]+)`, 'i')
];

/**
 * Снимает обрамляющие кавычки/угловые скобки и пробелы с захваченного значения
 */
function clean(value: string): string {
	const trimmed = value.trim();
	const wrapped = /^<([\s\S]*)>$|^"([\s\S]*)"$|^'([\s\S]*)'$|^«([\s\S]*)»$/.exec(trimmed);
	if (wrapped) {
		return (wrapped[1] ?? wrapped[2] ?? wrapped[3] ?? wrapped[4]).trim();
	}
	return trimmed;
}

/**
 * Пытается извлечь пару «ожидаемое/фактическое» из переданных текстов
 *
 * Тексты проверяются по порядку (например, сначала message, затем details);
 * берётся первое распознанное вхождение. Diff бессмыслен, если значения
 * совпали или оба пусты — в этом случае возвращается undefined.
 *
 * @param texts - Куски текста падения в порядке приоритета
 * @returns Пара значений либо undefined, если ничего не распознано
 */
export function extractExpectedActual(...texts: (string | undefined)[]): ExpectedActual | undefined {
	for (const text of texts) {
		if (!text) {
			continue;
		}
		for (const pattern of PATTERNS) {
			const match = pattern.exec(text);
			if (!match) {
				continue;
			}
			const expected = clean(match[1]);
			const actual = clean(match[2]);
			if (expected === actual || (expected === '' && actual === '')) {
				continue;
			}
			return { expected, actual };
		}
	}
	return undefined;
}
