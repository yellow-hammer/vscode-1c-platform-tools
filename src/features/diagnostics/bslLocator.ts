/**
 * Поиск позиции ошибки синтаксического контроля в тексте .bsl
 *
 * vrunner syntax-check не выдаёт номера строк, но в тексте ошибки обычно есть
 * имя метода в кавычках («Использование синхронного вызова: "Существует"»,
 * «Возможно ошибочный метод: "УдалитьЗапись"»). Идентификатор ищется в модуле —
 * каждое вхождение даёт строку для squiggle. Эвристика: вхождения в комментариях/
 * строках тоже совпадут, но это лучше, чем всё на первой строке.
 *
 * Чистый модуль — тестируется без vscode.
 */

/** Позиция в тексте (0-based, как vscode.Position) */
export interface TextPosition {
	line: number;
	character: number;
}

/** Символы, образующие идентификатор 1С (кириллица/латиница/цифры/подчёркивание) */
const IDENTIFIER_CHAR = /[A-Za-zА-Яа-яЁё0-9_]/;

/**
 * Извлекает идентификатор в кавычках из текста ошибки
 *
 * Поддерживает прямые кавычки (после раскрытия &quot;) и ёлочки «».
 *
 * @param message - Текст одной ошибки
 * @returns Идентификатор без кавычек или undefined
 */
export function extractQuotedIdentifier(message: string): string | undefined {
	const match = /"([^"]+)"|«([^»]+)»/.exec(message);
	if (!match) {
		return undefined;
	}
	const value = (match[1] ?? match[2] ?? '').trim();
	return value.length > 0 ? value : undefined;
}

/**
 * Преобразователь смещения в строку/столбец по предрассчитанным началам строк
 */
export class LineMap {
	/** Смещения начала каждой строки */
	private readonly lineStarts: number[];

	constructor(text: string) {
		this.lineStarts = [0];
		for (let i = 0; i < text.length; i++) {
			if (text[i] === '\n') {
				this.lineStarts.push(i + 1);
			}
		}
	}

	/**
	 * Возвращает строку/столбец для смещения (бинарный поиск по началам строк)
	 */
	public positionAt(offset: number): TextPosition {
		let low = 0;
		let high = this.lineStarts.length - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if (this.lineStarts[mid] <= offset) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}
		return { line: low, character: offset - this.lineStarts[low] };
	}
}

/**
 * Находит смещения вхождений идентификатора как отдельного слова
 *
 * Совпадение засчитывается, только если по обе стороны нет символов идентификатора
 * (ручная проверка границ — JS \b не работает с кириллицей).
 *
 * @param text - Текст модуля (без BOM)
 * @param identifier - Искомый идентификатор
 * @returns Смещения начала вхождений в порядке появления
 */
export function findIdentifierOffsets(text: string, identifier: string): number[] {
	const offsets: number[] = [];
	if (!identifier) {
		return offsets;
	}
	let from = 0;
	for (;;) {
		const index = text.indexOf(identifier, from);
		if (index < 0) {
			break;
		}
		const before = index > 0 ? text[index - 1] : '';
		const after = index + identifier.length < text.length ? text[index + identifier.length] : '';
		if (!IDENTIFIER_CHAR.test(before) && !IDENTIFIER_CHAR.test(after)) {
			offsets.push(index);
		}
		from = index + identifier.length;
	}
	return offsets;
}
