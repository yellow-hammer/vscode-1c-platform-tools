/**
 * Утилиты путей для projects.json.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

const homeDir = os.homedir();
const HOME_VAR = '$home';
const HOME_TILDE = '~';

/**
 * Путь к файлу projects.json.
 * @param projectsLocation — папка из настройки; при пустой — globalStorage расширения
 * @param context — контекст расширения VS Code
 * @returns полный путь к projects.json
 */
export function getProjectsFilePath(projectsLocation: string, context: vscode.ExtensionContext): string {
	if (projectsLocation && projectsLocation.trim() !== '') {
		return path.join(expandHomePath(projectsLocation.trim()), 'projects.json');
	}
	return path.join(context.globalStoragePath, 'projects.json');
}

/**
 * Раскрывает ~ и $home в начале пути.
 * @param inputPath — путь с возможными префиксами ~ или $home
 * @returns абсолютный путь
 */
export function expandHomePath(inputPath: string): string {
	if (inputPath.startsWith(HOME_VAR)) {
		return path.normalize(path.join(homeDir, inputPath.slice(HOME_VAR.length)));
	}
	if (inputPath.startsWith(HOME_TILDE)) {
		return path.normalize(path.join(homeDir, inputPath.slice(HOME_TILDE.length)));
	}
	return inputPath;
}

/**
 * Приводит разделители пути к нативным для ОС.
 * @param item — путь
 * @returns путь с нативными разделителями
 */
export function updateWithPathSeparatorStr(item: string): string {
	return path.sep === '\\' ? item.replaceAll('/', '\\') : item.replaceAll('\\', '/');
}

/**
 * Нормализует путь (разделители, . и ..).
 * @param p — входной путь
 * @returns нормализованный путь
 */
export function normalizePath(p: string): string {
	return path.normalize(p);
}
