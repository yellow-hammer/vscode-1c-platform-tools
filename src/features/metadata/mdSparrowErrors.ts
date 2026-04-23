/**
 * Классификация ошибок подпроцесса md-sparrow.
 * @module mdSparrowErrors
 */

/**
 * Ошибка: установленная версия md-sparrow не знает запрошенную команду.
 * Возникает, когда кэшированный JAR старее, чем требует расширение.
 */
export class MdSparrowOutdatedError extends Error {
	constructor() {
		super('Инструменты анализа метаданных устарели и не поддерживают эту операцию.');
		this.name = 'MdSparrowOutdatedError';
	}
}

/**
 * Возвращает true, если stderr/stdout содержат признаки picocli «подкоманда не найдена».
 */
export function isMdSparrowUnknownCommandError(stderr: string, stdout: string): boolean {
	const text = `${stderr}\n${stdout}`;
	return /Unmatched arguments? from index/i.test(text) || /Did you mean:/i.test(text);
}
