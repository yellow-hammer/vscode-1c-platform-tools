/**
 * Объявление процедуры и функции в модуле.
 *
 * Объявление бывает асинхронным и пишется на обоих языках встроенного языка.
 * Распознаватель один на всех потребителей: переход к обработчику, расстановка
 * точек останова и поиск тестов должны видеть одни и те же объявления.
 *
 * @module bslDeclaration
 */

/** Имя метода: латиница, кириллица, цифры и подчёркивание. */
const NAME = '[\\wа-яёА-ЯЁ]+';

/** Начало объявления; «Асинх» перед словом «Процедура» необязательно. */
const HEAD = '^\\s*(?:Асинх|Async)?\\s*(?:Процедура|Функция|Procedure|Function)\\s+';

/** Объявление метода с любым именем; первая группа - имя. */
export const METHOD_DECLARATION = new RegExp(`${HEAD}(${NAME})\\s*\\(`, 'i');

/**
 * Строка объявляет процедуру или функцию.
 *
 * @param line - Строка модуля
 */
export function isMethodDeclaration(line: string): boolean {
	return METHOD_DECLARATION.test(line);
}

/**
 * Имя метода из строки объявления.
 *
 * @param line - Строка модуля
 * @returns Имя либо undefined, если строка объявлением не является
 */
export function declaredMethodName(line: string): string | undefined {
	return METHOD_DECLARATION.exec(line)?.[1];
}

/**
 * Строка объявляет метод с этим именем.
 *
 * @param line - Строка модуля
 * @param name - Имя метода
 */
export function declaresMethod(line: string, name: string): boolean {
	const declared = declaredMethodName(line);
	return declared !== undefined && declared.toLowerCase() === name.toLowerCase();
}
