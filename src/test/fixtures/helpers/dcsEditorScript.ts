/**
 * Текст скрипта редактора СКД для node-тестов: ядро dcs-editor.js и модули закладок, которые ядро создаёт в конце
 * своего запуска. Тесты вырезают из него функции по сигнатуре и исполняют их как есть, с заглушками соседей.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fixturePath } from './fixturePath';

// Корень проекта ищет fixturePath: путь не зависит от того, в какой каталог out esbuild положил тест
const WEBVIEW = path.resolve(fixturePath(), '../../../resources/webview');

/** Части скрипта редактора в порядке подключения в dcs-editor.html: модули закладок, затем ядро. */
export const DCS_EDITOR_PARTS = ['dcs-editor-schema.js', 'dcs-editor-settings-panels.js', 'dcs-editor-settings.js', 'dcs-editor.js'];

/**
 * Текст одной части скрипта редактора.
 *
 * @param name - Имя файла части в resources/webview (из {@link DCS_EDITOR_PARTS})
 * @returns Текст части с переводами строк LF
 */
export function readEditorPart(name: string): string {
	return fs.readFileSync(path.join(WEBVIEW, name), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Все части скрипта одним текстом. Объявления верхнего уровня у всех частей с одним табом отступа, а имена не
 * повторяются: поиск функции по сигнатуре находит её, в какой бы части она ни была.
 *
 * @returns Части в порядке {@link DCS_EDITOR_PARTS} через перевод строки, с переводами строк LF
 */
export function readEditorScript(): string {
	return DCS_EDITOR_PARTS.map(readEditorPart).join('\n');
}

/**
 * Объект ядра для вырезанного кода закладки: поля-аксессоры читают и пишут переменные теста с теми же именами
 * (core.model это переменная model теста). Закладки берут изменяемое общее состояние только так.
 *
 * @param names - Имена полей ядра, к которым обращается вырезанный код
 * @returns Объявление `const core = {…};` с геттером и сеттером на каждое имя
 */
export function coreAccessors(names: string[]): string {
	const fields = names.map((name) => `get ${name}() { return ${name}; }, set ${name}(value) { ${name} = value; }`);
	return `const core = { ${fields.join(', ')} };\n`;
}

/**
 * Вырезанный код с объектом ядра в начале: поля-аксессоры для тех имён, к которым код обращается как core.ИМЯ.
 * Переменные с этими именами объявляет сам тест (let в коде или параметр new Function), как раньше для кода ядра.
 *
 * @param code - Вырезанный код закладки
 * @returns Код с объявлением core перед ним; код без обращений к core возвращается как есть
 */
export function withCoreAccessors(code: string): string {
	const names = [...new Set([...code.matchAll(/\bcore\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]))];
	return names.length > 0 ? coreAccessors(names) + code : code;
}
