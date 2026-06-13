/**
 * Общие утилиты адаптеров тестовых фреймворков
 */
import * as path from 'node:path';

/**
 * Нормализует базовый каталог из настройки для использования в glob-паттерне
 *
 * Убирает ведущие './', завершающие '/' и приводит разделители к '/'.
 * Пустое значение или '.' означают корень workspace — возвращается '**'-совместимая база.
 *
 * @param configured - Значение настройки пути (например './features')
 * @returns База для glob (например 'features')
 */
export function normalizeGlobBase(configured: string): string {
	let base = configured.trim().replaceAll('\\', '/');
	while (base.startsWith('./')) {
		base = base.slice(2);
	}
	base = base.replace(/\/+$/, '');
	if (base === '' || base === '.') {
		return '*';
	}
	return base;
}

/**
 * Вычисляет сегменты каталогов между базовым каталогом тестов и файлом
 *
 * Используется для построения иерархии каталогов в дереве Test Explorer:
 * features/init/Файл.feature → ['init'].
 *
 * @param fileFsPath - Абсолютный путь к файлу
 * @param baseSetting - Базовый каталог из настройки (например './features')
 * @param workspaceRoot - Абсолютный путь к корню workspace
 * @returns Сегменты подкаталогов (пусто, если файл лежит прямо в базе или вне её)
 */
export function directorySegments(
	fileFsPath: string,
	baseSetting: string,
	workspaceRoot: string
): string[] {
	const base = normalizeGlobBase(baseSetting);
	const baseFsPath = base === '*' ? workspaceRoot : path.join(workspaceRoot, base);
	const relative = path.relative(baseFsPath, path.dirname(fileFsPath));
	if (relative === '' || relative === '.' || relative.startsWith('..') || path.isAbsolute(relative)) {
		return [];
	}
	return relative.split(/[\\/]/).filter((segment) => segment.length > 0);
}
