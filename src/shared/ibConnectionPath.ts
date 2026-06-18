import * as path from 'node:path';

const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[/\\]/;

function isWindowsStylePath(p: string): boolean {
	return WINDOWS_DRIVE_PATH.test(p) || /^[a-zA-Z]:$/.test(p);
}

function isCrossPlatformAbsolute(p: string): boolean {
	return path.isAbsolute(p) || isWindowsStylePath(p) || p.startsWith('\\\\');
}

function formatResolvedPath(p: string): string {
	if (process.platform === 'win32') {
		return path.win32.normalize(p);
	}
	if (isWindowsStylePath(p) || p.startsWith('\\\\')) {
		return path.win32.normalize(p).replaceAll('\\', '/');
	}
	return path.normalize(p);
}

function resolvePathAgainstRoot(root: string, segment: string): string {
	if (isWindowsStylePath(root) || root.startsWith('\\\\')) {
		return formatResolvedPath(path.win32.resolve(root, segment));
	}
	return formatResolvedPath(path.resolve(root, segment));
}

/**
 * Абсолютный путь к каталогу файловой ИБ из строки подключения `/F…`.
 * Кавычки вокруг пути (формат vanessa-runner) снимаются; относительный путь
 * достраивается от корня проекта.
 */
export function resolveFileIbAbsolutePath(fileConnectionString: string, workspaceRoot: string): string {
	const trimmed = fileConnectionString.trim();
	const pathPart = trimmed.slice(2).trim().replace(/^["']|["']$/g, '');
	if (isCrossPlatformAbsolute(pathPart)) {
		return formatResolvedPath(pathPart);
	}
	return resolvePathAgainstRoot(workspaceRoot, pathPart);
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
