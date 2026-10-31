/**
 * Окружение терминалов расширения.
 *
 * Дочерние процессы расширения получают каталог выбранной установки OneScript
 * через окружение вызова, но терминалы, которые открывает пользователь, о нём не
 * знают. `EnvironmentVariableCollection` правит окружение новых терминалов и
 * задач VS Code, поэтому после установки OneScript перезапуск окна не нужен.
 *
 * Правка та же, что у дочерних процессов, см. `withSelectedEngine`: каталог первым
 * в PATH и в `OVM_OSCRIPTBIN`, по которому автозапуск cmd после `ovm use` снова
 * ставит в PATH установку машины, и в `OSCRIPTBIN`, куда opm кладёт команды пакетов.
 * Строки, которые `ovm use` пишет в `.bashrc` на Linux и macOS, выполняются
 * после правки, поэтому с интеграцией оболочки VS Code повторяет её после них.
 * На Windows повтора нет: интеграция bash разбирает значение через `echo -e`, и
 * обратные слэши путей портятся, а автозапуск cmd и профиль PowerShell и так
 * берут каталог из `OVM_OSCRIPTBIN`.
 *
 * @module terminalEnv
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { logger } from './logger';
import { ENGINE_BIN_VARIABLES } from './ovmPaths';

const log = logger.scope('vrunner');

/** Коллекция окружения расширения, доступна после {@link initTerminalEnv}. */
let collection: vscode.EnvironmentVariableCollection | undefined = undefined;

/**
 * Каталог, добавленный в PATH последним: чтобы не писать в журнал одно и то же.
 * null — после подключения ничего не применялось: коллекция хранится между
 * сеансами, и первый вызов её обязательно обновляет или очищает.
 */
let appliedBinDir: string | undefined | null = null;

/** Правка при запуске терминала, а на Linux и macOS ещё и после файлов запуска оболочки. */
const MUTATOR_OPTIONS: vscode.EnvironmentVariableMutatorOptions = {
	applyAtProcessCreation: true,
	applyAtShellIntegration: process.platform !== 'win32',
};

/**
 * Подключает коллекцию окружения расширения.
 *
 * @param target - Коллекция из контекста расширения
 */
export function initTerminalEnv(target: vscode.EnvironmentVariableCollection): void {
	collection = target;
	appliedBinDir = null;
	collection.description = 'Движок OneScript проекта: PATH, OVM_OSCRIPTBIN, OSCRIPTBIN';
}

/**
 * Ставит установку OneScript в окружение новых терминалов и задач.
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
	collection.prepend('PATH', `${binDir}${path.delimiter}`, MUTATOR_OPTIONS);
	for (const name of ENGINE_BIN_VARIABLES) {
		collection.replace(name, binDir, MUTATOR_OPTIONS);
	}
	log.info(`Новые терминалы получают движок OneScript: ${binDir}`);
}
