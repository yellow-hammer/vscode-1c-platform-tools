/**
 * Кэш дерева «База данных» конструктора запроса СКД на стороне хоста.
 *
 * Холодный project-metadata-tree на большой выгрузке идёт минутами, а кэш webview живёт только
 * до закрытия вкладки. Поэтому ответ держит хост: по выгрузке (её
 * Configuration.xml) и времени изменения этого файла. Добавление и удаление объекта переписывает
 * состав в Configuration.xml — время меняется, и следующий вызов строит дерево заново; webview
 * сверяется с хостом при каждом открытии конструктора, так что новый объект виден и в открытой
 * вкладке. Синоним объекта лежит в его собственном файле, и его правку отпечаток не ловит: дерево
 * показывает прежний синоним до перезапуска окна VS Code. Отпечаток по всем файлам объектов стоил бы
 * тысяч обращений к диску на каждое открытие, а синоним в дереве — только подпись (имена и пути,
 * которые пишутся в запрос, меняются только вместе с Configuration.xml).
 *
 * Модуль без зависимости от vscode: его проверяют node-тесты на временных файлах.
 *
 * @module dcsMetadataTreeCache
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Сколько выгрузок помнить: окна редактора СКД обычно смотрят в одну-две конфигурации. */
const DEFAULT_LIMIT = 4;

/** Итог загрузки дерева: группы либо текст отказа (отказ не кэшируется — следующий вызов повторит). */
export type DcsMetadataTreeLoad<T> = { groups: T } | { error: string };

interface Entry<T> {
	stamp: string;
	groups?: T;
	pending?: Promise<DcsMetadataTreeLoad<T>>;
}

export interface DcsMetadataTreeCache<T> {
	/**
	 * Дерево выгрузки: из памяти, если Configuration.xml не менялся, иначе — загрузкой load.
	 * Одновременные вызовы по одной выгрузке ждут одну загрузку. onCold зовётся до загрузки,
	 * когда дерева в памяти нет: панель показывает «Загрузка метаданных…» только в этом случае.
	 */
	get(configurationXml: string, load: () => Promise<DcsMetadataTreeLoad<T>>, onCold?: () => void): Promise<DcsMetadataTreeLoad<T>>;
}

/** Ключ выгрузки: регистр путей Windows не различает, а один каталог не должен давать две записи. */
function keyOf(configurationXml: string): string {
	const resolved = path.resolve(configurationXml);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Отпечаток Configuration.xml: время изменения и размер — размер ловит правку в ту же миллисекунду. */
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
 * @param limit Сколько выгрузок помнить; старейшая по последнему обращению вытесняется.
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
			// Исключение загрузки — тоже отказ: его ждут и другие вызовы, а падать им не за что
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
