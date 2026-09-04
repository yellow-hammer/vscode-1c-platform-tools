/**
 * Разбор файлов настроек vanessa-runner: env.json, autumn-properties.json,
 * env.local.json и файлы каталога tools. BOM и комментарии разбору не мешают.
 * @module settingsJson
 */

import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as jsonc from 'jsonc-parser';

const PARSE_ERROR_TEXT: Partial<Record<jsonc.ParseErrorCode, string>> = {
	[jsonc.ParseErrorCode.InvalidSymbol]: 'недопустимый символ',
	[jsonc.ParseErrorCode.InvalidNumberFormat]: 'неверный формат числа',
	[jsonc.ParseErrorCode.PropertyNameExpected]: 'ожидалось имя свойства',
	[jsonc.ParseErrorCode.ValueExpected]: 'ожидалось значение',
	[jsonc.ParseErrorCode.ColonExpected]: 'ожидалось двоеточие',
	[jsonc.ParseErrorCode.CommaExpected]: 'ожидалась запятая',
	[jsonc.ParseErrorCode.CloseBraceExpected]: 'не закрыта фигурная скобка',
	[jsonc.ParseErrorCode.CloseBracketExpected]: 'не закрыта квадратная скобка',
	[jsonc.ParseErrorCode.EndOfFileExpected]: 'лишний текст после JSON',
	[jsonc.ParseErrorCode.UnexpectedEndOfComment]: 'не закрыт комментарий',
	[jsonc.ParseErrorCode.UnexpectedEndOfString]: 'не закрыта строка',
};

/**
 * Разбирает текст файла настроек.
 *
 * @param text - Содержимое файла
 * @returns Значение JSON
 * @throws {Error} Если текст не разбирается; в сообщении причина и строка
 */
export function parseSettingsJson(text: string): unknown {
	const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const errors: jsonc.ParseError[] = [];
	const value: unknown = jsonc.parse(source, errors, { allowTrailingComma: true });
	if (errors.length > 0) {
		const first = errors[0];
		const line = source.slice(0, first.offset).split('\n').length;
		throw new Error(`${PARSE_ERROR_TEXT[first.error] ?? 'ошибка синтаксиса'}, строка ${line}`);
	}
	return value;
}

/**
 * Читает и разбирает файл настроек.
 *
 * @param filePath - Абсолютный путь к файлу
 * @returns Значение JSON
 * @throws {Error} Если файла нет или он не разбирается
 */
export function readSettingsJsonSync(filePath: string): unknown {
	return parseSettingsJson(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Читает и разбирает файл настроек без блокировки.
 *
 * @param filePath - Абсолютный путь к файлу
 * @returns Значение JSON
 * @throws {Error} Если файла нет или он не разбирается
 */
export async function readSettingsJson(filePath: string): Promise<unknown> {
	return parseSettingsJson(await fsPromises.readFile(filePath, 'utf8'));
}
