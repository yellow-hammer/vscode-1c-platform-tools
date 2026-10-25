/**
 * Профиль и окружение одного запуска вместо выбранных в редакторе: шаг пайплайна
 * идёт со своими, а строка состояния, панели команд и тестов — с выбранными в
 * редакторе.
 * @module launchSelection
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** Выбор запуска; незаданное поле берётся из редактора. */
export interface LaunchSelection {
	/** Профиль; 'default' — «По умолчанию» */
	profile?: string;
	/** Окружение; null — по умолчанию, только общие файлы */
	environment?: string | null;
}

const selectionStorage = new AsyncLocalStorage<LaunchSelection>();

/**
 * Выполняет fn с профилем и окружением запуска: внутри fn и во всём, что fn
 * запускает асинхронно, они заменяют выбранные в редакторе.
 *
 * @param selection - Выбор запуска
 * @param fn - Действие
 */
export function runWithLaunchSelection<T>(selection: LaunchSelection, fn: () => T): T {
	return selectionStorage.run(selection, fn);
}

/** Выбор запуска из {@link runWithLaunchSelection}. */
export function launchSelectionOverride(): LaunchSelection | undefined {
	return selectionStorage.getStore();
}

/** Выполняет fn с выбором редактора: так его видят строка состояния и панели. */
export function outsideLaunchSelection<T>(fn: () => T): T {
	return selectionStorage.exit(fn);
}
