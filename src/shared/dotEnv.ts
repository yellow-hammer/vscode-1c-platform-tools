/**
 * Разбор файлов `.env`.
 *
 * Правила те же, что у библиотеки dotenv для OneScript (oscript-library/dotenv):
 * файл, который прочитает приложение на OneScript, Docker Compose или CI, здесь
 * разбирается так же. Ключ — буквы (в том числе кириллица), цифры, `_`, `.`, `-`;
 * строки без `=` и с недопустимым ключом пропускаются. В двойных кавычках и
 * без кавычек раскрываются `${ИМЯ}` и `${ИМЯ:-запасное}`, в одинарных и обратных
 * значение буквальное.
 *
 * Модуль чистый (без vscode/fs).
 * @module dotEnv
 */

const KEY = /^[\p{L}\p{N}_.-]+$/u;

/** Ссылка `${ИМЯ}` или `${ИМЯ:-запасное}`; обратный слэш перед ней оставляет её буквальной. */
const REFERENCE = /(\\?)\$\{([\p{L}\p{N}_.-]+)(?::-([^}]*))?\}/gu;

const ESCAPES: Readonly<Record<string, string>> = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"' };

/**
 * Позиция закрывающей кавычки: в двойных кавычках обратный слэш экранирует следующий символ.
 *
 * @param body - Текст после открывающей кавычки
 * @param quote - Кавычка
 * @returns Индекс или -1, если кавычка не закрыта
 */
function closingQuote(body: string, quote: string): number {
	if (quote !== '"') {
		return body.indexOf(quote);
	}
	for (let index = 0; index < body.length; index++) {
		if (body[index] === '\\') {
			index++;
		} else if (body[index] === '"') {
			return index;
		}
	}
	return -1;
}

function expand(value: string, resolve: (name: string) => string | undefined): string {
	return value.replace(REFERENCE, (whole: string, escaped: string, name: string, fallback: string | undefined) => {
		if (escaped) {
			return whole.slice(1);
		}
		const found = resolve(name);
		if (fallback !== undefined) {
			return found === undefined || found === '' ? fallback : found;
		}
		return found ?? '';
	});
}

/**
 * Разбирает текст файла `.env`.
 *
 * Ссылки ищутся сначала среди переменных, разобранных выше в этом же тексте,
 * затем через `lookup`. Незакрытая кавычка забирает строки до такой же кавычки
 * или до конца текста. Повторный ключ перекрывает прежнее значение.
 *
 * @param text - Содержимое файла
 * @param lookup - Значения вне файла: предыдущие слои и окружение процесса
 * @returns Переменные в порядке появления
 */
export function parseDotEnv(text: string, lookup: (name: string) => string | undefined = () => undefined): Map<string, string> {
	const result = new Map<string, string>();
	const resolve = (name: string): string | undefined => result.get(name) ?? lookup(name);
	const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index].replace(/^\s*export\s+/, '');
		const trimmed = line.trim();
		if (trimmed === '' || trimmed.startsWith('#')) {
			continue;
		}
		const equals = line.indexOf('=');
		const key = equals < 0 ? '' : line.slice(0, equals).trim();
		if (!KEY.test(key)) {
			continue;
		}
		const rest = line.slice(equals + 1).replace(/^[ \t]+/, '');
		const quote = rest[0];
		if (quote === '"' || quote === "'" || quote === '`') {
			let body = rest.slice(1);
			let close = closingQuote(body, quote);
			while (close < 0 && index + 1 < lines.length) {
				index++;
				body += `\n${lines[index]}`;
				close = closingQuote(body, quote);
			}
			const raw = close < 0 ? body : body.slice(0, close);
			result.set(key, quote === '"' ? expand(raw.replace(/\\([nrt\\"])/g, (_, char: string) => ESCAPES[char]), resolve) : raw);
			continue;
		}
		const comment = rest.search(/\s#/);
		result.set(key, expand((comment < 0 ? rest : rest.slice(0, comment)).trim(), resolve));
	}
	return result;
}
