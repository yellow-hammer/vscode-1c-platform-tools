/**
 * Распаковка zip-архивов загружаемых компонентов.
 *
 * Своя распаковка поверх yauzl, а не готовая библиотека: запись за пределы каталога назначения
 * недопустима, а ссылки внутри архива нам не нужны ни в одной поставке, поэтому они пропускаются.
 * @module zipExtract
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { logger } from './logger';

const log = logger.scope('releases');

/** Биты типа файла и тип «символьная ссылка» из режима записи архива. */
const FILE_TYPE_MASK = 0o170000;
const SYMLINK_TYPE = 0o120000;
/** Права на выполнение: сохраняем их, иначе бинарь из архива не запустится. */
const EXECUTE_BITS = 0o111;

/** Права записи из внешних атрибутов zip; 0 - архив собран системой без прав (например Windows). */
function entryMode(entry: Entry): number {
	return (entry.externalFileAttributes >>> 16) & 0xffff;
}

function isSymlink(entry: Entry): boolean {
	return (entryMode(entry) & FILE_TYPE_MASK) === SYMLINK_TYPE;
}

function isDirectory(entry: Entry): boolean {
	return entry.fileName.endsWith('/');
}

/**
 * Путь записи внутри каталога назначения; undefined - запись уводит наружу.
 *
 * @param outDir каталог назначения (абсолютный)
 * @param fileName имя записи из архива
 */
export function safeEntryPath(outDir: string, fileName: string): string | undefined {
	if (fileName.includes('\0')) {
		return undefined;
	}
	const root = path.resolve(outDir);
	const target = path.resolve(root, fileName.replace(/\\/g, '/'));
	const relative = path.relative(root, target);
	if (relative === '') {
		return undefined;
	}
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		return undefined;
	}
	return target;
}

async function writeEntry(zip: ZipFile, entry: Entry, target: string): Promise<void> {
	await fsp.mkdir(path.dirname(target), { recursive: true });
	const source = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
		zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)));
	});
	await pipeline(source, fs.createWriteStream(target));

	const mode = entryMode(entry) & EXECUTE_BITS;
	if (process.platform !== 'win32' && mode !== 0) {
		await fsp.chmod(target, 0o644 | mode);
	}
}

/**
 * Распаковывает zip в каталог: записи с путём наружу считаются ошибкой, ссылки пропускаются.
 *
 * @param archivePath путь к архиву
 * @param outDir каталог назначения (создаётся при необходимости)
 * @throws Error если архив повреждён или запись уводит за пределы каталога
 */
export async function extractZip(archivePath: string, outDir: string): Promise<void> {
	await fsp.mkdir(outDir, { recursive: true });
	const zip = await new Promise<ZipFile>((resolve, reject) => {
		yauzl.open(archivePath, { lazyEntries: true, autoClose: true }, (err, opened) =>
			err ? reject(err) : resolve(opened)
		);
	});

	await new Promise<void>((resolve, reject) => {
		let skippedLinks = 0;

		const fail = (error: unknown): void => {
			zip.close();
			reject(error instanceof Error ? error : new Error(String(error)));
		};

		zip.on('error', fail);
		zip.on('end', () => {
			if (skippedLinks > 0) {
				log.warn(`в архиве ${path.basename(archivePath)} пропущено ссылок: ${skippedLinks}`);
			}
			resolve();
		});
		zip.on('entry', (entry: Entry) => {
			const target = safeEntryPath(outDir, entry.fileName);
			if (!target) {
				fail(new Error(`Архив ${path.basename(archivePath)}: запись «${entry.fileName}» ведёт за пределы каталога`));
				return;
			}
			if (isSymlink(entry)) {
				skippedLinks += 1;
				zip.readEntry();
				return;
			}
			if (isDirectory(entry)) {
				fsp.mkdir(target, { recursive: true }).then(() => zip.readEntry(), fail);
				return;
			}
			writeEntry(zip, entry, target).then(() => zip.readEntry(), fail);
		});

		zip.readEntry();
	});
}
