/**
 * Каталог `oscript_modules` и программы, которые opm кладёт в его `bin`.
 *
 * Модуль чистый: без vscode.
 * @module oneScriptModules
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { findExecutable } from './executableLookup';

/** Каталог зависимостей проекта: сюда их ставит `opm install -l`. */
export const MODULES_DIRECTORY = 'oscript_modules';

/**
 * Программа из `oscript_modules/bin` проекта.
 *
 * @param root - Корень проекта
 * @param name - Имя команды, как его ставит opm
 * @returns Путь к файлу или undefined, если его нет
 */
export function localPackageProgram(root: string, name: string): string | undefined {
	const file = process.platform === 'win32' ? `${name}.bat` : name;
	const local = path.join(root, MODULES_DIRECTORY, 'bin', file);
	return fs.existsSync(local) ? local : undefined;
}

/**
 * Программа пакета: `oscript_modules/bin` проекта, иначе каталоги PATH.
 *
 * PATH здесь уже с каталогом bin выбранного движка впереди, как у vrunner.
 *
 * @param root - Корень проекта
 * @param name - Имя команды, как его ставит opm
 * @param env - Окружение процесса, чей PATH просматривается
 * @returns Путь к файлу или undefined, если его нет
 */
export function packageProgram(root: string, name: string, env: NodeJS.ProcessEnv): string | undefined {
	return localPackageProgram(root, name) ?? findExecutable(name, env, root);
}
