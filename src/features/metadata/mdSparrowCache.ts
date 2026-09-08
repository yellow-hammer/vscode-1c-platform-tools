/**
 * Кэш ответов md-sparrow по отпечатку исходного кода.
 *
 * Отпечаток складывается из описаний объектов во всех корнях раскладки:
 * изменился хоть один файл, и ответ читается у md-sparrow заново. Файлы кэша
 * лежат в хранилище рабочей области VS Code, а не в проекте.
 *
 * @module mdSparrowCache
 */

import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { externalDirectory, resolveProjectLayout } from '../../shared/projectLayout';
import { sourceDirectory } from '../../shared/objectPaths';
import type { MdSparrowRuntime } from './mdSparrowBootstrap';

const log = logger.scope('md-sparrow');

/** Версия формата кэша: меняется вместе с формой ответа. */
const CACHE_FORMAT_VERSION = 2;

/** Файлы, по которым меняется ответ: описания объектов, форм, схем компоновки и правил поддержки обеих раскладок. */
const DESCRIPTOR_EXTENSIONS = new Set([
	'.xml',
	'.mdo',
	'.form',
	'.dcs',
	'.distr',
	'.bin',
	// Проект EDT держит права роли и командный интерфейс подсистемы отдельными файлами
	'.rights',
	'.cmi',
]);

/** Сколько каталогов читается одновременно: обход конфигурации иначе занимает секунды. */
const WALK_WIDTH = 32;

/** Сколько ответов на объекты держим в памяти: панель ходит по дереву туда-сюда. */
const MEMORY_LIMIT = 100;

/** Ответы на файлы объектов: живут в памяти сеанса, проверяются отпечатком файлов. */
const memory = new Map<string, { fingerprint: string; value: unknown }>();

interface CacheEntry<T> {
	readonly version: number;
	readonly fingerprint: string;
	readonly payload: T;
}

/**
 * Корни исходного кода рабочей области: конфигурации, расширения и внешние объекты, тестовые тоже.
 *
 * @param workspaceRoot - Корень рабочей области
 */
export async function sourceRoots(workspaceRoot: string): Promise<string[]> {
	const layout = await resolveProjectLayout(workspaceRoot);
	const sources = [
		...(layout.configuration ? [layout.configuration] : []),
		...layout.others,
		...layout.extensions,
		...layout.testExtensions,
	].map(sourceDirectory);
	const externals = [...layout.processors, ...layout.reports, ...layout.testProcessors].map(externalDirectory);
	return [...new Set([...sources, ...externals])];
}

/** Описание на диске: путь, размер и время изменения. */
type Descriptor = readonly [file: string, size: number, mtimeMs: number];

/**
 * Описания в каталоге и ниже: каталоги читаются пачками, порядок в ответе не важен.
 *
 * @param root - Каталог исходного кода
 */
async function descriptorsIn(root: string): Promise<Descriptor[]> {
	const found: Descriptor[] = [];
	let level = [root];
	while (level.length > 0) {
		const next: string[] = [];
		for (let start = 0; start < level.length; start += WALK_WIDTH) {
			await Promise.all(
				level.slice(start, start + WALK_WIDTH).map(async (directory) => {
					let entries: Dirent[];
					try {
						entries = await fs.readdir(directory, { withFileTypes: true });
					} catch {
						return;
					}
					const files: string[] = [];
					for (const entry of entries) {
						const file = path.join(directory, entry.name);
						if (entry.isDirectory()) {
							next.push(file);
						} else if (entry.isFile() && DESCRIPTOR_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
							files.push(file);
						}
					}
					await Promise.all(
						files.map(async (file) => {
							try {
								const stat = await fs.stat(file);
								found.push([file, stat.size, stat.mtimeMs]);
							} catch {
								/* файл исчез между обходом и чтением: отпечаток изменится при следующем обходе */
							}
						})
					);
				})
			);
		}
		level = next;
	}
	return found;
}

/**
 * Отпечаток исходного кода: пути, размеры и время изменения описаний плюс соль.
 *
 * @param workspaceRoot - Корень рабочей области
 * @param salt - Что ещё меняет ответ: версия md-sparrow, параметры запроса
 */
export async function sourceFingerprint(workspaceRoot: string, salt: readonly string[]): Promise<string> {
	const hash = createHash('sha256');
	hash.update(`v${CACHE_FORMAT_VERSION}`);
	for (const item of salt) {
		hash.update(`\n${item}`);
	}
	const roots = await sourceRoots(workspaceRoot);
	const descriptors = (await Promise.all(roots.map(descriptorsIn))).flat();
	const lines = descriptors.map(
		([file, size, mtimeMs]) => `${path.relative(workspaceRoot, file).split(path.sep).join('/')}|${size}|${mtimeMs}`
	);
	// Порядок обхода зависит от планировщика, а отпечаток от него зависеть не должен
	lines.sort();
	for (const line of lines) {
		hash.update(`\n${line}`);
	}
	return hash.digest('hex');
}

/**
 * Отметка сборки md-sparrow для отпечатка.
 *
 * Локальный jar живёт по одному пути и меняется при пересборке, поэтому одного
 * пути мало: берётся ещё размер и время изменения файла.
 *
 * @param runtime - Найденная сборка md-sparrow
 */
export async function runtimeSalt(runtime: MdSparrowRuntime): Promise<string> {
	if (runtime.releaseTag) {
		return runtime.releaseTag;
	}
	try {
		const stat = await fs.stat(runtime.jarPath);
		return `${runtime.jarPath}|${stat.size}|${stat.mtimeMs}`;
	} catch {
		return runtime.jarPath;
	}
}

/**
 * Отпечаток заданных файлов: чего нет на диске, то входит в отпечаток отсутствием.
 *
 * @param files - Файлы, от которых зависит ответ
 * @param salt - Что ещё меняет ответ: версия сборки, параметры запроса
 */
export async function fileFingerprint(
	files: readonly string[],
	salt: readonly string[],
	directories: readonly string[] = []
): Promise<string> {
	const hash = createHash('sha256');
	hash.update(`v${CACHE_FORMAT_VERSION}`);
	for (const item of salt) {
		hash.update(`\n${item}`);
	}
	const stats = await Promise.all(
		files.map(async (file) => {
			try {
				const stat = await fs.stat(file);
				return `${file}|${stat.size}|${stat.mtimeMs}`;
			} catch {
				return `${file}|нет`;
			}
		})
	);
	for (const directory of await Promise.all(directories.map(descriptorsIn))) {
		for (const [file, size, mtimeMs] of directory) {
			stats.push(`${file}|${size}|${mtimeMs}`);
		}
	}
	// Каталоги обходятся параллельно, а отпечаток от порядка зависеть не должен
	stats.sort();
	for (const line of stats) {
		hash.update(`\n${line}`);
	}
	return hash.digest('hex');
}

/**
 * Ответ из памяти сеанса, пока файлы не менялись.
 *
 * Ответы на объекты в хранилище не пишутся: их много, а перечитываются они
 * дешевле, чем дерево целиком.
 *
 * @param key - Что запрашивали: операция и файл
 * @param files - Файлы, от которых зависит ответ
 * @param salt - Что ещё меняет ответ
 * @param read - Чтение у md-sparrow
 * @param cacheable - Стоит ли запоминать ответ
 * @param directories - Каталоги, описания в которых тоже меняют ответ
 */
export async function cachedByFiles<T>(
	key: string,
	files: readonly string[],
	salt: readonly string[],
	read: () => Promise<T>,
	cacheable: (value: T) => boolean,
	directories: readonly string[] = []
): Promise<T> {
	const fingerprint = await fileFingerprint(files, salt, directories);
	const known = memory.get(key);
	if (known && known.fingerprint === fingerprint) {
		return known.value as T;
	}
	const value = await read();
	if (!cacheable(value)) {
		memory.delete(key);
		return value;
	}
	if (memory.size >= MEMORY_LIMIT) {
		const oldest = memory.keys().next();
		if (!oldest.done) {
			memory.delete(oldest.value);
		}
	}
	memory.set(key, { fingerprint, value });
	return value;
}

/** Забывает ответы сеанса: после правки объекта его файл читается заново. */
export function forgetCachedReads(): void {
	memory.clear();
}

/**
 * Файл кэша в хранилище рабочей области VS Code.
 *
 * @param context - Контекст расширения
 * @param name - Имя ответа, например `project-metadata-tree`
 * @param workspaceRoot - Корень: у рабочей области из нескольких папок свой файл на каждую
 */
export function cacheFilePath(context: vscode.ExtensionContext, name: string, workspaceRoot: string): string {
	const storage = context.storageUri ?? context.globalStorageUri;
	const key = createHash('sha1').update(path.resolve(workspaceRoot)).digest('hex').slice(0, 8);
	return path.join(storage.fsPath, 'md-sparrow-cache', `${name}-${key}.json`);
}

/**
 * Записанный ответ и отпечаток, при котором он получен.
 *
 * Отпечаток отдаётся вместе с ответом, поэтому считать его на пустом кэше не
 * нужно: первое чтение идёт к md-sparrow без ожидания обхода.
 *
 * @param file - Файл кэша
 * @param valid - Проверка формы ответа
 */
export async function readCachedEntry<T>(
	file: string,
	valid: (payload: unknown) => payload is T
): Promise<{ fingerprint: string; payload: T } | undefined> {
	try {
		const entry = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<CacheEntry<unknown>>;
		if (entry.version === CACHE_FORMAT_VERSION && typeof entry.fingerprint === 'string' && valid(entry.payload)) {
			return { fingerprint: entry.fingerprint, payload: entry.payload };
		}
	} catch {
		/* кэша нет или он не читается: ответ берётся у md-sparrow */
	}
	return undefined;
}

/**
 * Записывает ответ в кэш; неудача записи ответ не отменяет.
 *
 * @param file - Файл кэша
 * @param fingerprint - Отпечаток исходного кода
 * @param payload - Ответ md-sparrow
 */
export async function writeCached<T>(file: string, fingerprint: string, payload: T): Promise<void> {
	try {
		await fs.mkdir(path.dirname(file), { recursive: true });
		const entry: CacheEntry<T> = { version: CACHE_FORMAT_VERSION, fingerprint, payload };
		await fs.writeFile(file, JSON.stringify(entry), 'utf8');
	} catch (error) {
		log.warn(`кэш не записан ${file}: ${error instanceof Error ? error.message : String(error)}`);
	}
}
