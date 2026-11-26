/**
 * Кэш дерева «База данных» конструктора запроса СКД на стороне хоста.
 *
 * Холодный project-metadata-tree на большой выгрузке идёт минутами, а кэш webview живёт
 * до закрытия вкладки, поэтому дерево хранит хост и сверяет его с отпечатком Configuration.xml.
 * Добавление и удаление объекта меняют Configuration.xml, и дерево строится заново. Правку синонима
 * в файле объекта отпечаток не ловит: синоним в дереве только подпись, а проверка всех файлов
 * объектов стоила бы тысяч обращений к диску.
 *
 * Модуль не зависит от vscode, его проверяют node-тесты.
 *
 * @module dcsMetadataTreeCache
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Окна редактора обычно смотрят в одну-две конфигурации. */
const DEFAULT_LIMIT = 4;

/** Итог загрузки дерева: группы или текст отказа. Отказ не кэшируется. */
export type DcsMetadataTreeLoad<T> = { groups: T } | { error: string };

interface Entry<T> {
	stamp: string;
	groups?: T;
	pending?: Promise<DcsMetadataTreeLoad<T>>;
}

export interface DcsMetadataTreeCache<T> {
	/**
	 * Дерево выгрузки из памяти, если Configuration.xml не менялся, иначе загрузкой load.
	 * Одновременные вызовы по одной выгрузке ждут одну загрузку. onCold вызывается перед загрузкой.
	 */
	get(configurationXml: string, load: () => Promise<DcsMetadataTreeLoad<T>>, onCold?: () => void): Promise<DcsMetadataTreeLoad<T>>;
}

/** На Windows регистр пути не различается: один каталог даёт один ключ. */
function keyOf(configurationXml: string): string {
	const resolved = path.resolve(configurationXml);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Размер в отпечатке ловит правку в ту же миллисекунду. */
async function stampOf(configurationXml: string): Promise<string | undefined> {
	try {
		const stat = await fs.stat(configurationXml);
		return `${stat.mtimeMs}|${stat.size}`;
	} catch {
		return undefined;
	}
}

/**
 * Создаёт кэш деревьев.
 *
 * @param limit Сколько выгрузок помнить; вытесняется давно не использованная.
 */
export function createDcsMetadataTreeCache<T>(limit: number = DEFAULT_LIMIT): DcsMetadataTreeCache<T> {
	// Map хранит порядок вставки: обращение переставляет запись в конец, вытесняется первая
	const entries = new Map<string, Entry<T>>();

	function touch(key: string, entry: Entry<T>): void {
		entries.delete(key);
		entries.set(key, entry);
		while (entries.size > Math.max(1, limit)) {
			const oldest = entries.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			entries.delete(oldest);
		}
	}

	return {
		async get(configurationXml, load, onCold) {
			const key = keyOf(configurationXml);
			const stamp = await stampOf(configurationXml);
			if (stamp === undefined) {
				return { error: `Описание конфигурации не найдено: ${configurationXml}.` };
			}
			const known = entries.get(key);
			if (known && known.stamp === stamp) {
				if (known.groups !== undefined) {
					touch(key, known);
					return { groups: known.groups };
				}
				if (known.pending) {
					return known.pending;
				}
			}
			onCold?.();
			const entry: Entry<T> = { stamp };
			// Исключение загрузки становится отказом: его ждут и другие вызовы
			const pending = Promise.resolve()
				.then(load)
				.catch(
				(error: unknown): DcsMetadataTreeLoad<T> => ({
					error: (error instanceof Error ? error.message : String(error)).slice(0, 400),
				})
			);
			entry.pending = pending;
			touch(key, entry);
			const loaded = await pending;
			if (entries.get(key) === entry) {
				if ('error' in loaded) {
					entries.delete(key);
				} else {
					entry.groups = loaded.groups;
					entry.pending = undefined;
				}
			}
			return loaded;
		},
	};
}
