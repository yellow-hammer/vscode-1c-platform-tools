/**
 * Окружение терминалов расширения.
 *
 * Дочерние процессы расширения получают каталог выбранной установки OneScript
 * через окружение вызова, но терминалы, которые открывает пользователь, о нём не
 * знают. `EnvironmentVariableCollection` правит окружение новых терминалов и
 * задач VS Code, поэтому после установки OneScript перезапуск окна не нужен.
 *
 * @module terminalEnv
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { logger } from './logger';

const log = logger.scope('vrunner');

/** Коллекция окружения расширения, доступна после {@link initTerminalEnv}. */
let collection: vscode.EnvironmentVariableCollection | undefined = undefined;

/** Каталог, добавленный в PATH последним: чтобы не писать в журнал одно и то же. */
let appliedBinDir: string | undefined = undefined;

/**
 * Подключает коллекцию окружения расширения.
 *
 * @param target - Коллекция из контекста расширения
 */
export function initTerminalEnv(target: vscode.EnvironmentVariableCollection): void {
	collection = target;
	collection.description = 'Каталог выбранной установки OneScript в PATH';
}

/**
 * Ставит каталог установки OneScript первым в PATH новых терминалов и задач.
 *
 * Уже открытых терминалов правка не касается: их окружение задано при запуске.
 *
 * @param binDir - Каталог bin установки или undefined, чтобы убрать правку
 */
export function setTerminalOscriptBinDir(binDir: string | undefined): void {
	if (collection === undefined || binDir === appliedBinDir) {
		return;
	}
	appliedBinDir = binDir;

	if (binDir === undefined) {
		collection.clear();
		return;
	}
	collection.prepend('PATH', `${binDir}${path.delimiter}`);
	log.info(`PATH новых терминалов дополнен каталогом OneScript: ${binDir}`);
}
