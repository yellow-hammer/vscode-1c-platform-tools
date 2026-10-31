/**
 * Лексемы текста OneScript: имена, строковые литералы и знаки без комментариев
 * и инструкций препроцессора.
 *
 * Модуль чистый (без vscode/fs).
 * @module oneScriptLexer
 */

/** Вид лексемы: многострочная строка и прочие литералы идут как `other`. */
export type TokenKind = 'name' | 'string' | 'punct' | 'other';

/** Лексема. */
export interface Token {
	kind: TokenKind;
	value: string;
}

const NAME_START = /[\p{L}_]/u;
const NAME_PART = /[\p{L}\p{N}_]/u;

function lineEnd(text: string, from: number): number {
	const end = text.indexOf('\n', from);
	return end < 0 ? text.length : end;
}

function skipBlanks(text: string, from: number): number {
	let index = from;
	while (index < text.length && (text[index] === ' ' || text[index] === '\t' || text[index] === '\r')) {
		index += 1;
	}
	return index;
}

/**
 * Строковый литерал с открывающей кавычки: `""` — кавычка внутри строки, строка
 * продолжается на следующей строке после `|`, комментарии между её строками
 * пропускаются.
 *
 * @returns Значение, позиция после литерала и признак многострочного литерала
 */
function readString(text: string, start: number): { value: string; end: number; multiline: boolean } {
	let value = '';
	let multiline = false;
	let index = start + 1;
	while (index < text.length) {
		const char = text[index];
		if (char === '"') {
			if (text[index + 1] === '"') {
				value += '"';
				index += 2;
				continue;
			}
			return { value, end: index + 1, multiline };
		}
		if (char === '\n') {
			let next = skipBlanks(text, index + 1);
			while (text.startsWith('//', next) || text[next] === '\n') {
				next = skipBlanks(text, lineEnd(text, next) + 1);
			}
			if (text[next] !== '|') {
				// Незакрытая строка кончается вместе со строкой файла
				return { value, end: index, multiline };
			}
			multiline = true;
			value += '\n';
			index = next + 1;
			continue;
		}
		value += char;
		index += 1;
	}
	return { value, end: index, multiline };
}

/**
 * Лексемы модуля без комментариев и инструкций препроцессора.
 *
 * @param text - Текст модуля
 */
export function tokenize(text: string): Token[] {
	const tokens: Token[] = [];
	let lineStart = true;
	let index = 0;
	while (index < text.length) {
		const char = text[index];
		if (char === '\n') {
			lineStart = true;
			index += 1;
			continue;
		}
		if (char === ' ' || char === '\t' || char === '\r' || char === '﻿') {
			index += 1;
			continue;
		}
		if (text.startsWith('//', index) || (char === '#' && lineStart)) {
			index = lineEnd(text, index);
			continue;
		}
		lineStart = false;
		if (char === '"') {
			const literal = readString(text, index);
			tokens.push({ kind: literal.multiline ? 'other' : 'string', value: literal.value });
			index = literal.end;
			continue;
		}
		if (char === "'") {
			const close = text.indexOf("'", index + 1);
			const end = close < 0 || close > lineEnd(text, index) ? lineEnd(text, index) : close + 1;
			tokens.push({ kind: 'other', value: text.slice(index, end) });
			index = end;
			continue;
		}
		if (NAME_START.test(char)) {
			let end = index + 1;
			while (end < text.length && NAME_PART.test(text[end])) {
				end += 1;
			}
			tokens.push({ kind: 'name', value: text.slice(index, end) });
			index = end;
			continue;
		}
		if (char >= '0' && char <= '9') {
			let end = index + 1;
			while (end < text.length && ((text[end] >= '0' && text[end] <= '9') || text[end] === '.')) {
				end += 1;
			}
			tokens.push({ kind: 'other', value: text.slice(index, end) });
			index = end;
			continue;
		}
		tokens.push({ kind: 'punct', value: char });
		index += 1;
	}
	return tokens;
}

/** Лексема — этот знак. */
export function isPunct(token: Token | undefined, value: string): boolean {
	return token?.kind === 'punct' && token.value === value;
}

/** Имя в нижнем регистре; у лексемы другого вида undefined. */
export function lowerName(token: Token | undefined): string | undefined {
	return token?.kind === 'name' ? token.value.toLowerCase() : undefined;
}

/**
 * Список в скобках: элементы через запятую верхнего уровня до парной скобки.
 *
 * @param tokens - Лексемы
 * @param start - Позиция сразу после открывающей скобки
 * @returns Элементы списка и позиция закрывающей скобки
 */
export function readList(tokens: Token[], start: number): { items: Token[][]; end: number } {
	const items: Token[][] = [];
	let item: Token[] = [];
	let depth = 0;
	let index = start;
	for (; index < tokens.length; index++) {
		const token = tokens[index];
		if (token.kind === 'punct' && (token.value === '(' || token.value === '[')) {
			depth += 1;
		} else if (token.kind === 'punct' && (token.value === ')' || token.value === ']')) {
			if (depth === 0) {
				break;
			}
			depth -= 1;
		} else if (depth === 0 && isPunct(token, ',')) {
			items.push(item);
			item = [];
			continue;
		}
		item.push(token);
	}
	if (item.length > 0 || items.length > 0) {
		items.push(item);
	}
	return { items, end: index };
}
