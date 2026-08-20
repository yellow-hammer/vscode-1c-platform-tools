/**
 * Список информационных баз платформы 1С (`ibases.v8i`).
 *
 * Файл ведёт сама платформа: там же, где 1С показывает список баз при запуске. Расширение его
 * только читает: подставить строку в профиль запуска или показать список для запуска клиента.
 *
 * @module infobaseList
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Запись списка: база либо папка, в которой базы лежат. */
export interface InfobaseEntry {
	/** Имя базы, как его показывает платформа. */
	readonly name: string;
	/** Строка подключения из файла: `File="…";` либо `Srvr="…";Ref="…";`. */
	readonly connect: string;
	/** Папка списка: `/`, `/Демо`, вложенные - через слэш. */
	readonly folder: string;
	/** Порядок в плоском списке платформы; нет поля — 0. */
	readonly orderInList: number;
	/** Порядок в дереве списка платформы; нет поля — 0. */
	readonly orderInTree: number;
}

/**
 * Разбирает содержимое `ibases.v8i`.
 *
 * Секция без `Connect` - это папка списка, а не база: иерархию платформа задаёт полем `Folder`
 * у самой базы, а не вложенностью секций.
 *
 * @param text Содержимое файла без BOM.
 */
export function parseInfobaseList(text: string): InfobaseEntry[] {
	const out: InfobaseEntry[] = [];
	let name: string | undefined;
	let connect = '';
	let folder = '/';
	let orderInList = 0;
	let orderInTree = 0;

	const flush = (): void => {
		if (name && connect) {
			out.push({ name, connect, folder, orderInList, orderInTree });
		}
	};

	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith('[') && line.endsWith(']')) {
			flush();
			name = line.slice(1, -1);
			connect = '';
			folder = '/';
			orderInList = 0;
			orderInTree = 0;
			continue;
		}
		const eq = line.indexOf('=');
		if (eq < 0 || !name) {
			continue;
		}
		const key = line.slice(0, eq).trim().toLowerCase();
		const value = line.slice(eq + 1).trim();
		if (key === 'connect') {
			connect = value;
		} else if (key === 'folder') {
			folder = normalizeFolder(value);
		} else if (key === 'orderinlist') {
			orderInList = parseOrder(value);
		} else if (key === 'orderintree') {
			orderInTree = parseOrder(value);
		}
	}
	flush();
	return out;
}

/**
 * Папка списка в каноническом виде: `/`, `/Демо`, `/Демо/Вложенная`.
 *
 * @param value Значение поля `Folder` из v8i.
 * @returns Нормализованный путь.
 */
export function normalizeFolder(value: string): string {
	const trimmed = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
	if (trimmed === '' || trimmed === '/') {
		return '/';
	}
	return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Число порядка из v8i: нечисловое значение не ломает разбор записи.
 *
 * @param value Текст после `=`.
 * @returns Число или 0.
 */
function parseOrder(value: string): number {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Строка подключения для vanessa-runner: `/F<путь>` у файловой, `/S<сервер>\<база>` у серверной.
 *
 * @returns Пусто, если строку разобрать не удалось: подставлять сырое значение из файла нельзя.
 */
export function infobaseConnectionString(connect: string): string | undefined {
	const file = /File\s*=\s*"([^"]*)"/i.exec(connect);
	if (file) {
		return file[1] ? `/F${file[1]}` : undefined;
	}
	const server = /Srvr\s*=\s*"([^"]*)"/i.exec(connect);
	const ref = /Ref\s*=\s*"([^"]*)"/i.exec(connect);
	if (server && ref && server[1] && ref[1]) {
		return `/S${server[1]}\\${ref[1]}`;
	}
	return undefined;
}

/** Каталог, в котором платформа держит список баз и настройки запуска. */
export function startupDirectory(platform: NodeJS.Platform = process.platform, home = os.homedir()): string {
	if (platform === 'win32') {
		const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
		return path.join(appData, '1C', '1CEStart');
	}
	// На Linux и macOS платформа хранит список в домашнем каталоге пользователя.
	return path.join(home, '.1C', '1cestart');
}

/** Читает текст файла платформы: список в UTF-8 с BOM, настройки запуска рядом - в UTF-16. */
export function readPlatformText(filePath: string): string | undefined {
	let raw: Buffer;
	try {
		raw = fs.readFileSync(filePath);
	} catch {
		return undefined;
	}
	if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
		return raw.subarray(2).toString('utf16le');
	}
	if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
		return raw.subarray(3).toString('utf8');
	}
	return raw.toString('utf8');
}

/**
 * Общие списки баз из `1cestart.cfg`: организация раздаёт их одним файлом на всех.
 *
 * @param text Содержимое `1cestart.cfg`.
 */
export function commonListPaths(text: string): string[] {
	const out: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		const eq = line.indexOf('=');
		if (eq > 0 && line.slice(0, eq).trim().toLowerCase() === 'commoninfobases') {
			const value = line.slice(eq + 1).trim();
			if (value) {
				out.push(...value.split(';').map((part) => part.trim()).filter(Boolean));
			}
		}
	}
	return out;
}

/**
 * Все базы пользователя: личный список платформы и общие списки организации.
 *
 * Одна и та же база может быть в нескольких списках, поэтому повторы по имени и строке
 * подключения отбрасываются.
 */
export function readInfobases(directory = startupDirectory()): InfobaseEntry[] {
	const files = [path.join(directory, 'ibases.v8i')];
	const config = readPlatformText(path.join(directory, '1cestart.cfg'));
	if (config) {
		// Общий список задают и абсолютным путём, и относительным - относительный считаем от каталога платформы.
		files.push(...commonListPaths(config).map((file) => path.resolve(directory, file)));
	}
	const seen = new Set<string>();
	const out: InfobaseEntry[] = [];
	for (const file of files) {
		const text = readPlatformText(file);
		if (!text) {
			continue;
		}
		for (const entry of parseInfobaseList(text)) {
			const key = `${entry.name}|${entry.connect}`;
			if (!seen.has(key)) {
				seen.add(key);
				out.push(entry);
			}
		}
	}
	return out;
}
