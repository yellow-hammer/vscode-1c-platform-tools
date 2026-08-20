/**
 * Наблюдение за файлами списка информационных баз платформы.
 *
 * Каталог лежит вне рабочей области, поэтому FileSystemWatcher VS Code его
 * не видит. Следим через `fs.watch` и сжимаем пачку событий в одно обновление.
 */

import * as fs from 'node:fs';
import type { Disposable } from 'vscode';

/** Пауза, за которую несколько записей в v8i считаются одним изменением. */
const DEBOUNCE_MS = 200;

/**
 * Подписывается на изменения каталога списка платформы.
 *
 * @param onChange - Что сделать после паузы
 * @param directory - Каталог `1CEStart` / `.1cestart`
 * @returns Подписка
 */
export function watchInfobaseList(onChange: () => void, directory: string): Disposable {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const schedule = (): void => {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			timer = undefined;
			onChange();
		}, DEBOUNCE_MS);
	};

	let watcher: fs.FSWatcher | undefined;
	try {
		watcher = fs.watch(directory, { persistent: false }, schedule);
	} catch {
		// Каталога платформы может не быть — список пустой, обновит кнопка.
	}

	return {
		dispose(): void {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
			watcher?.close();
		},
	};
}
