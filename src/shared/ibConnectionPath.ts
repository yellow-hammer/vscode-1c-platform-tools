import * as path from 'node:path';

/**
 * Абсолютный путь к каталогу файловой ИБ из строки подключения `/F…`.
 * Кавычки вокруг пути (формат vanessa-runner) снимаются; относительный путь
 * достраивается от корня проекта.
 */
export function resolveFileIbAbsolutePath(fileConnectionString: string, workspaceRoot: string): string {
	const trimmed = fileConnectionString.trim();
	const pathPart = trimmed.slice(2).trim().replace(/^["']|["']$/g, '');
	return path.resolve(workspaceRoot, pathPart);
}

/**
 * Нормализует строку подключения к файловой ИБ: снимает кавычки и приводит путь к абсолютному.
 * Строки `/S…` возвращаются без изменений.
 */
export function resolveFileIbConnectionString(connectionString: string, workspaceRoot: string): string {
	const trimmed = connectionString.trim();
	if (!trimmed.startsWith('/F')) {
		return trimmed;
	}

	return '/F' + resolveFileIbAbsolutePath(trimmed, workspaceRoot);
}
