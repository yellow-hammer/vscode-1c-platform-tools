/**
 * Запуск базы в 1С:EDT через 1cedtstart, как это делает окно запуска платформы.
 *
 * Кнопка «1C:EDT» платформы открывает ссылку `e1cedt://start/open`, а обработчик
 * схемы, 1cedtstart, находит или заводит рабочую область под базу и запускает
 * в ней EDT. 1cedtstart собран на Equinox и без явного `-vm` берёт первую Java
 * из PATH, а без JavaFX в ней падает ещё до разбора ссылки. Поэтому запуск идёт
 * не через системный обработчик, а прямо: стартер и его JVM берутся из его же
 * файлов.
 *
 * @module edtStart
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { spawnDetached } from './cestart';

/** Имя исполняемого файла стартера. */
export function edtStartFileName(platform: NodeJS.Platform = process.platform): string {
	return platform === 'win32' ? '1cedtstart.exe' : '1cedtstart';
}

/** Имя Java без консоли: с ней у стартера не висело бы чёрное окно. */
function javaFileName(platform: NodeJS.Platform): string {
	return platform === 'win32' ? 'javaw.exe' : 'java';
}

/** Каталог данных 1cedtstart: настройки, установки, рабочие области. */
export function edtStartDataDirectory(platform: NodeJS.Platform = process.platform): string {
	if (platform === 'win32') {
		const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
		return path.join(localAppData, '1C', '1cedtstart');
	}
	return path.join(process.env.HOME || '', '.local', 'share', '1C', '1cedtstart');
}

/** Каталоги, куда установщик кладёт компоненты 1С, среди них и стартер. */
export function edtStartComponentRoots(platform: NodeJS.Platform = process.platform): string[] {
	if (platform === 'win32') {
		const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
		return [path.join(programFiles, '1C', '1CE', 'components')];
	}
	return ['/opt/1C/1CE/components'];
}

/**
 * Путь стартера из команды обработчика схемы `e1cedt` в реестре Windows.
 *
 * @param output - Вывод `reg query HKCR\e1cedt\shell\open\command /ve`
 * @returns Путь к exe или undefined, если схема не зарегистрирована
 */
export function edtStartFromRegistryOutput(output: string): string | undefined {
	const match = output.match(/REG_SZ\s+"([^"]+1cedtstart\.exe)"/i);
	return match?.[1];
}

/**
 * Стартер в каталогах компонентов: `1c-edt-start-<версия>/1cedtstart`.
 *
 * @param roots - Каталоги компонентов
 * @param platform - Операционная система
 * @param exists - Проверка файла (в тестах подменяется)
 * @returns Пути найденных стартеров, старшая версия первой
 */
export function edtStartInComponents(
	roots: readonly string[],
	platform: NodeJS.Platform = process.platform,
	exists: (filePath: string) => boolean = fs.existsSync
): string[] {
	const found: string[] = [];
	for (const root of roots) {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(root, { withFileTypes: true });
		} catch {
			continue;
		}
		const candidates = entries
			.filter((entry) => entry.isDirectory() && entry.name.startsWith('1c-edt-start-'))
			.map((entry) => path.join(root, entry.name, edtStartFileName(platform)))
			.filter((candidate) => exists(candidate))
			.sort((left, right) => right.localeCompare(left, 'en'));
		found.push(...candidates);
	}
	return found;
}

/**
 * JVM, которую 1cedtstart записал в своих настройках.
 *
 * В `preferences.json` стартер держит `jvmInfo` по версиям Java; это JVM с JavaFX,
 * на которых он запускает EDT, и на ней же он поднимается сам. Берётся старшая
 * версия.
 *
 * @param preferencesJson - Содержимое `preferences.json`
 * @param platform - Операционная система
 * @param exists - Проверка файла (в тестах подменяется)
 * @returns Путь к Java без консоли или undefined
 */
export function jvmFromPreferences(
	preferencesJson: string,
	platform: NodeJS.Platform = process.platform,
	exists: (filePath: string) => boolean = fs.existsSync
): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(preferencesJson);
	} catch {
		return undefined;
	}
	const info = (parsed as { jvmInfo?: unknown } | null)?.jvmInfo;
	if (typeof info !== 'object' || info === null) {
		return undefined;
	}
	const candidates: { feature: number; java: string }[] = [];
	const joiner = platform === 'win32' ? path.win32 : path.posix;
	for (const [key, value] of Object.entries(info as Record<string, unknown>)) {
		const jvmPath = (value as { jvmPath?: unknown } | null)?.jvmPath;
		if (typeof jvmPath !== 'string') {
			continue;
		}
		const java = joiner.join(fileUrlToPath(jvmPath, platform), javaFileName(platform));
		if (exists(java)) {
			candidates.push({ feature: Number.parseInt(key, 10) || 0, java });
		}
	}
	candidates.sort((left, right) => right.feature - left.feature);
	return candidates[0]?.java;
}

/**
 * Путь из ссылки `file:` в записи целевой платформы, а не той, где идёт код.
 *
 * @param url - `file:///C:/Program%20Files/Java/bin/` либо уже путь
 * @param platform - Операционная система
 */
export function fileUrlToPath(url: string, platform: NodeJS.Platform): string {
	if (!url.startsWith('file:')) {
		return url;
	}
	const decoded = decodeURIComponent(url.replace(/^file:\/\/\/?/, ''));
	if (platform === 'win32') {
		return decoded.replace(/\//g, '\\');
	}
	return `/${decoded.replace(/^\/+/, '')}`;
}

/**
 * Аргументы стартера: своя JVM и ссылка.
 *
 * На Windows запуск идёт через `cmd /c start`, поэтому путь и ссылка берутся в
 * кавычки сами: амперсанды ссылки иначе разрезали бы команду.
 *
 * @param url - Ссылка `e1cedt://start/open?...`
 * @param jvm - Путь к Java стартера; без неё стартер ищет Java сам
 * @param platform - Операционная система
 */
export function edtStartArgs(url: string, jvm: string | undefined, platform: NodeJS.Platform = process.platform): string[] {
	const quote = (value: string): string => (platform === 'win32' ? `"${value}"` : value);
	return [...(jvm ? ['-vm', quote(jvm)] : []), quote(url)];
}

/** Зависимости запуска: в тестах подменяются. */
export interface LaunchEdtStartDeps {
	readonly platform?: NodeJS.Platform;
	readonly registryQuery?: () => string;
	readonly componentRoots?: readonly string[];
	readonly preferencesPath?: string;
	readonly readFile?: (filePath: string) => string | undefined;
	readonly exists?: (filePath: string) => boolean;
	readonly spawn?: (command: string, args: readonly string[]) => void;
}

/** Исход запуска стартера. */
export type LaunchEdtStartResult =
	| { readonly ok: true; readonly binary: string; readonly args: readonly string[] }
	| { readonly ok: false; readonly message: string };

function queryRegistry(): string {
	try {
		return execFileSync('reg', ['query', 'HKCR\\e1cedt\\shell\\open\\command', '/ve'], {
			encoding: 'utf8',
			windowsHide: true,
		});
	} catch {
		return '';
	}
}

function readText(filePath: string): string | undefined {
	try {
		return fs.readFileSync(filePath, 'utf8');
	} catch {
		return undefined;
	}
}

/**
 * Находит стартер: на Windows по обработчику схемы в реестре, иначе по каталогам компонентов.
 *
 * @param deps - Зависимости поиска
 * @returns Путь к стартеру или undefined
 */
export function findEdtStart(deps: LaunchEdtStartDeps = {}): string | undefined {
	const platform = deps.platform ?? process.platform;
	const exists = deps.exists ?? fs.existsSync;
	if (platform === 'win32') {
		const fromRegistry = edtStartFromRegistryOutput((deps.registryQuery ?? queryRegistry)());
		if (fromRegistry && exists(fromRegistry)) {
			return fromRegistry;
		}
	}
	return edtStartInComponents(deps.componentRoots ?? edtStartComponentRoots(platform), platform, exists)[0];
}

/**
 * Запускает 1cedtstart по ссылке базы.
 *
 * @param url - Ссылка `e1cedt://start/open?...`
 * @param deps - Поиск стартера и запуск процесса
 * @returns Успех с командой либо сообщение, почему не вышло
 */
export function launchEdtStart(url: string, deps: LaunchEdtStartDeps = {}): LaunchEdtStartResult {
	const platform = deps.platform ?? process.platform;
	const exists = deps.exists ?? fs.existsSync;
	const binary = findEdtStart(deps);
	if (!binary) {
		return {
			ok: false,
			message: '1cedtstart не найден: установите 1С:EDT через него, кнопка 1С:EDT открывает базы только им.',
		};
	}
	const preferences = (deps.readFile ?? readText)(
		deps.preferencesPath ?? path.join(edtStartDataDirectory(platform), 'preferences.json')
	);
	const jvm = preferences === undefined ? undefined : jvmFromPreferences(preferences, platform, exists);
	const args = edtStartArgs(url, jvm, platform);
	(deps.spawn ?? ((command, spawnArgs) => spawnDetached(command, spawnArgs, undefined, platform)))(binary, args);
	return { ok: true, binary, args };
}
