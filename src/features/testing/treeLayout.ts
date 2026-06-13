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
