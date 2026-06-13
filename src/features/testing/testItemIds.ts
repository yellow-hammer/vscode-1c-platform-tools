import { TestFrameworkId } from './frameworkAdapter';

/**
 * Стабильные идентификаторы элементов дерева тестов
 *
 * Формат:
 * - корень фреймворка: `framework:<adapterId>`
 * - файл: `<adapterId>|<uri>`
 * - кейс: `<adapterId>|<uri>#<нормализованное имя>`
 *
 * Стабильность ID важна: VS Code сохраняет по ним состояние
 * (последние результаты, развёрнутость узлов) между сессиями.
 */

/**
 * Нормализует имя теста для использования в ID и сопоставления с отчётом
 *
 * Триммирует, схлопывает последовательности пробельных символов в один пробел
 * и приводит Unicode к NFC (русские буквы могут приходить в разных формах
 * нормализации из разных инструментов). Регистр сохраняется.
 *
 * @param name - Имя сценария или тест-метода
 * @returns Нормализованное имя
 */
export function normalizeTestName(name: string): string {
	return name.normalize('NFC').replaceAll(/\s+/g, ' ').trim();
}

/**
 * ID корневого узла фреймворка
 */
export function frameworkRootId(adapterId: TestFrameworkId): string {
	return `framework:${adapterId}`;
}

/**
 * ID элемента файла
 *
 * @param adapterId - Идентификатор фреймворка
 * @param uriString - uri.toString() файла
 */
export function fileItemId(adapterId: TestFrameworkId, uriString: string): string {
	return `${adapterId}|${uriString}`;
}

/**
 * ID элемента кейса (сценария / тест-метода)
 *
 * @param adapterId - Идентификатор фреймворка
 * @param uriString - uri.toString() файла
 * @param caseName - Имя кейса (нормализуется)
 */
export function caseItemId(adapterId: TestFrameworkId, uriString: string, caseName: string): string {
	return `${fileItemId(adapterId, uriString)}#${normalizeTestName(caseName)}`;
}
