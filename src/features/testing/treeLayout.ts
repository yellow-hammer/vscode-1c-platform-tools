import * as path from 'node:path';
import { TestFrameworkId } from './frameworkAdapter';

/**
 * Чистые вычисления раскладки дерева тестов (без vscode.*)
 *
 * Вынесены отдельно, чтобы покрыть юнит-тестами хрупкую арифметику путей
 * и дедупликацию идентификаторов — именно там легко ошибиться.
 */

/**
 * ID узла-каталога в дереве
 *
 * @param adapterId - Идентификатор фреймворка
 * @param segments - Сегменты пути от корня фреймворка до этого каталога включительно
 */
export function directoryNodeId(adapterId: TestFrameworkId, segments: string[]): string {
	return `${adapterId}|dir|${segments.join('/')}`;
}

/**
 * Абсолютный путь каталога-узла дерева на файловой системе
 *
 * Узлы-каталоги строятся от каталога файла вверх: последний сегмент — это
 * каталог самого файла, каждый предыдущий — на уровень выше. Так клик по узлу
 * открывает соответствующий каталог в проводнике.
 *
 * @param fileFsPath - Абсолютный путь к тестовому файлу
 * @param segmentCount - Сколько всего сегментов-каталогов между корнем и файлом
 * @param index - Индекс сегмента (0 — самый верхний, segmentCount-1 — каталог файла)
 * @returns Абсолютный путь каталога этого сегмента
 */
export function directoryNodeFsPath(
	fileFsPath: string,
	segmentCount: number,
	index: number
): string {
	const fileDirParts = fileFsPath.split(/[\\/]/).slice(0, -1);
	const cut = fileDirParts.length - (segmentCount - 1 - index);
	return fileDirParts.slice(0, cut).join(path.sep);
}

/**
 * Возвращает уникальный ID кейса, разводя дубли имён в одном файле
 *
 * Одинаковые имена сценариев в одном .feature допустимы; чтобы коллекция
 * TestItem не отвергла повторный ID, к дублю добавляется номер строки.
 *
 * @param baseId - Базовый ID кейса (caseItemId по имени)
 * @param line - Строка объявления кейса (0-based)
 * @param seen - Множество уже выданных ID (мутируется)
 * @returns Уникальный ID
 */
export function dedupedCaseId(baseId: string, line: number, seen: Set<string>): string {
	const id = seen.has(baseId) ? `${baseId}@${line}` : baseId;
	seen.add(id);
	return id;
}

/** Тип сегмента в ключе сортировки: каталоги идут перед файлами в одном родителе */
const DIR_SORT_TYPE = '0';
const FILE_SORT_TYPE = '1';

/**
 * Ключ сортировки узла-каталога по его пути от корня фреймворка
 *
 * Каждый сегмент кодируется как `0<имя>` и склеивается через `/`. Низкий код `/`
 * (меньше цифр и букв) гарантирует, что всё поддерево каталога идёт перед любым
 * соседом, чьё имя продолжает имя каталога: обход остаётся в глубину.
 *
 * @param segments - Полный путь сегментов от корня до каталога включительно
 */
export function directorySortKey(segments: string[]): string {
	return segments.map((segment) => `${DIR_SORT_TYPE}${segment}`).join('/');
}

/**
 * Ключ сортировки узла-файла по его пути от корня фреймворка
 *
 * Каталоги-предки кодируются как `0<имя>`, сам файл — как `1<имя>`: внутри одного
 * каталога файлы идут после подкаталогов, а между собой — по имени (числовые
 * префиксы файлов сохраняют порядок запуска). Глобальная сортировка такого ключа
 * в плоском списке Test Explorer совпадает с обходом дерева в глубину, поэтому
 * вид «список» и вид «дерево» больше не расходятся.
 *
 * @param dirSegments - Сегменты каталогов между корнем и файлом
 * @param fileName - Отображаемое имя узла-файла
 */
export function fileSortKey(dirSegments: string[], fileName: string): string {
	const dirKeys = dirSegments.map((segment) => `${DIR_SORT_TYPE}${segment}`);
	return [...dirKeys, `${FILE_SORT_TYPE}${fileName}`].join('/');
}

/**
 * Ключ сортировки кейса: ключ файла-родителя плюс локальный ключ кейса
 *
 * Префикс ключом файла ставит сам узел-файл прямо перед своими кейсами, а кейсы
 * разных файлов не перемешиваются в плоском списке.
 *
 * @param fileKey - Ключ сортировки файла-родителя (fileSortKey)
 * @param caseKey - Локальный ключ кейса в файле (по номеру строки)
 */
export function caseSortKey(fileKey: string, caseKey: string): string {
	return `${fileKey}/${caseKey}`;
}
