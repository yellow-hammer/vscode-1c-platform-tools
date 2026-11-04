/**
 * Поиск установленной 1C:EDT.
 *
 * EDT ставится своим установщиком с releases.1c.ru, поэтому расширение её не
 * загружает, а находит: настройка задаёт каталог установки, иначе EDT ищется
 * там, куда её ставят 1C:EDT Start и установщик без интернета. Установок бывает
 * несколько - они не взаимозаменяемы, старшая версия проект младшей откроет,
 * наоборот нет.
 *
 * @module edtLocator
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { envValue, subdirectoryNames, uniquePaths } from './installPaths';

/** Найденная установка EDT. */
export interface EdtInstallation {
	/** Версия: `2026.1`. */
	version: string;
	/** Каталог установки, в котором лежит исполняемый файл. */
	directory: string;
	/** Путь к `1cedtcli`. */
	cli: string;
	/** Путь к графическому клиенту, если он рядом. */
	gui?: string;
}

/** Итог поиска. */
export interface EdtLookup {
	/** Установки, отсортированные от старшей версии к младшей. */
	installations: EdtInstallation[];
	/** Каталоги, в которых шёл поиск: нужны для сообщения, когда ничего не нашлось. */
	bases: string[];
}

/** Окружение поиска: в тестах подставляется. */
export interface EdtSearchOptions {
	/** Операционная система (по умолчанию process.platform). */
	readonly platform?: NodeJS.Platform;
	/** Окружение (по умолчанию process.env). */
	readonly env?: NodeJS.ProcessEnv;
	/** Домашний каталог (по умолчанию os.homedir()). */
	readonly home?: string;
}

/** Установка из реестра 1C:EDT Start. */
export interface EdtRegisteredProduct {
	/** Путь к исполняемому файлу среды. */
	readonly location: string;
	/** Версия из реестра, если есть. */
	readonly version?: string;
}

/** Имя исполняемого файла консоли EDT. */
function cliFileName(platform: NodeJS.Platform): string {
	return platform === 'win32' ? '1cedtcli.exe' : '1cedtcli';
}

/** Имя исполняемого файла графического клиента. */
function guiFileName(platform: NodeJS.Platform): string {
	return platform === 'win32' ? '1cedt.exe' : '1cedt';
}

/**
 * Каталог данных 1C:EDT Start: настройки, реестр сред, установки, рабочие области.
 *
 * @param platform - Операционная система
 * @param env - Окружение
 * @param home - Домашний каталог
 * @returns Путь к каталогу `1cedtstart`
 */
export function edtStartDataDirectory(
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
	home: string = os.homedir()
): string {
	if (platform === 'win32') {
		const userProfile = envValue(env, 'USERPROFILE') ?? home;
		const localAppData = envValue(env, 'LOCALAPPDATA') ?? path.join(userProfile, 'AppData', 'Local');
		return path.join(localAppData, '1C', '1cedtstart');
	}
	if (platform === 'darwin') {
		return path.join(home, 'Library', 'Application Support', '1C', '1cedtstart');
	}
	return path.join(home, '.local', 'share', '1C', '1cedtstart');
}

/**
 * Каталоги компонентов установщика 1С: туда ставятся EDT без интернета и сам 1C:EDT Start.
 *
 * @param platform - Операционная система
 * @param env - Окружение
 * @returns Каталоги `1C/1CE/components`
 */
export function edtComponentRoots(
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env
): string[] {
	if (platform === 'win32') {
		const programFiles = [envValue(env, 'ProgramW6432'), envValue(env, 'ProgramFiles') ?? 'C:\\Program Files'];
		return uniquePaths(
			programFiles.filter((dir): dir is string => dir !== undefined).map((dir) => path.join(dir, '1C', '1CE', 'components')),
			platform
		);
	}
	if (platform === 'darwin') {
		return ['/Applications/1C/1CE/components'];
	}
	return ['/opt/1C/1CE/components'];
}

/**
 * Реестры установленных сред 1C:EDT Start: свой у пользователя и общий, если стартер
 * ставит среды для всех пользователей.
 *
 * @param platform - Операционная система
 * @param env - Окружение
 * @param home - Домашний каталог
 * @returns Пути к `products.json`
 */
export function edtStartRegistries(
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
	home: string = os.homedir()
): string[] {
	const own = path.join(edtStartDataDirectory(platform, env, home), 'products.json');
	const programData = platform === 'win32' ? envValue(env, 'ProgramData') ?? envValue(env, 'ALLUSERSPROFILE') : undefined;
	return programData ? [own, path.join(programData, '1C', '1CE', '1cedtstart', 'products.json')] : [own];
}

/**
 * Установки из реестра 1C:EDT Start (`products.json`).
 *
 * @param text - Содержимое реестра
 * @returns Исполняемые файлы сред с версиями; при ошибке разбора пусто
 */
export function edtProductsFromRegistry(text: string): EdtRegisteredProduct[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return [];
	}
	const data = (parsed as { data?: unknown } | null)?.data;
	if (!Array.isArray(data)) {
		return [];
	}
	const out: EdtRegisteredProduct[] = [];
	for (const item of data as unknown[]) {
		const product = item as { location?: unknown; installedVersion?: { label?: unknown; name?: unknown } } | null;
		if (typeof product?.location !== 'string' || product.location.trim() === '') {
			continue;
		}
		const label = product.installedVersion?.label;
		const name = product.installedVersion?.name;
		const version =
			(typeof label === 'string' ? edtVersionFromDirectory(label) : undefined) ??
			(typeof name === 'string' ? edtVersionFromDirectory(name) : undefined);
		out.push({ location: product.location, ...(version ? { version } : {}) });
	}
	return out;
}

/**
 * Каталог сред разработки из настроек 1C:EDT Start (поле `productsRoot`).
 *
 * @param text - Содержимое `preferences.json`
 * @param platform - Операционная система
 * @returns Путь или undefined
 */
export function productsRootFromPreferences(text: string, platform: NodeJS.Platform = process.platform): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	const root = (parsed as { productsRoot?: unknown } | null)?.productsRoot;
	return typeof root === 'string' && root.trim() !== '' ? fileUrlToPath(root.trim(), platform) : undefined;
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

/** Текст файла или undefined, если его нет. */
function readText(filePath: string): string | undefined {
	try {
		return fs.readFileSync(filePath, 'utf8');
	} catch {
		return undefined;
	}
}

/**
 * Каталоги, внутри которых лежат установки версий EDT.
 *
 * Каталог сред разработки из настроек 1C:EDT Start, его каталог по умолчанию и
 * каталоги компонентов установщика.
 *
 * @param options - Операционная система и окружение
 * @returns Каталоги без повторов
 */
export function defaultEdtBasePaths(options: EdtSearchOptions = {}): string[] {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const dataDirectory = edtStartDataDirectory(platform, env, options.home ?? os.homedir());
	const preferences = readText(path.join(dataDirectory, 'preferences.json'));
	const productsRoot = preferences === undefined ? undefined : productsRootFromPreferences(preferences, platform);
	return uniquePaths(
		[
			...(productsRoot ? [productsRoot] : []),
			path.join(dataDirectory, 'installations'),
			...edtComponentRoots(platform, env),
		],
		platform
	);
}

/**
 * Версия из имени каталога установки.
 *
 * Установщик называет каталоги по-разному: `1C_EDT 2026.1` на Windows,
 * `1c-edt-2026.1.2+2-x86_64` на Linux. Берётся первая пара «год.выпуск».
 *
 * @param name - Имя каталога установки
 * @returns Версия вида `2026.1` или undefined, если это не каталог EDT
 */
export function edtVersionFromDirectory(name: string): string | undefined {
	return name.match(/(\d{4})\.(\d+)/)?.slice(1, 3).join('.');
}

/**
 * Версия по пути к каталогу установки: у 1C:EDT Start исполняемые файлы лежат
 * в подкаталоге `1cedt`, а версия в имени каталога над ним.
 */
function versionFromPath(directory: string): string {
	return edtVersionFromDirectory(path.basename(directory)) ?? edtVersionFromDirectory(path.basename(path.dirname(directory))) ?? '';
}

/**
 * Сравнивает версии EDT: `2026.1` новее `2025.2`.
 *
 * @returns Отрицательное, если a старше b
 */
export function compareEdtVersions(a: string, b: string): number {
	const [aYear = 0, aRelease = 0] = a.split('.').map((part) => Number(part) || 0);
	const [bYear = 0, bRelease = 0] = b.split('.').map((part) => Number(part) || 0);
	return aYear !== bYear ? aYear - bYear : aRelease - bRelease;
}

/**
 * Ищет `1cedtcli` в каталоге установки.
 *
 * Исполняемый файл лежит либо в самом каталоге, либо в подкаталоге `1cedt`:
 * так раскладывает 1C:EDT Start.
 */
function cliInDirectory(directory: string, platform: NodeJS.Platform): { cli: string; gui?: string } | undefined {
	for (const candidate of [directory, path.join(directory, '1cedt')]) {
		const cli = path.join(candidate, cliFileName(platform));
		if (!fs.existsSync(cli)) {
			continue;
		}
		const gui = path.join(candidate, guiFileName(platform));
		return { cli, gui: fs.existsSync(gui) ? gui : undefined };
	}
	return undefined;
}

/**
 * Находит установленные версии EDT.
 *
 * Настроенный каталог единственный: он проверяется и как каталог одной установки,
 * и как каталог со списком версий. Без настройки сначала читаются реестры
 * 1C:EDT Start, затем каталоги установок. Установка без `1cedtcli` пропускается:
 * каталог версии переживает удаление самой EDT.
 *
 * @param configuredPath - Настройка каталога установки; пусто - стандартные места
 * @param options - Операционная система и окружение
 * @returns Найденные установки и перебранные каталоги
 */
export function findEdtInstallations(configuredPath = '', options: EdtSearchOptions = {}): EdtLookup {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const home = options.home ?? os.homedir();
	const configured = configuredPath.trim();
	const bases = configured ? [configured] : defaultEdtBasePaths({ platform, env, home });
	const found = new Map<string, EdtInstallation>();
	const add = (installation: EdtInstallation): void => {
		const key = platform === 'win32' ? installation.cli.toLowerCase() : installation.cli;
		if (!found.has(key)) {
			found.set(key, installation);
		}
	};

	const registered = configured
		? []
		: edtStartRegistries(platform, env, home).flatMap((registry) => {
				const text = readText(registry);
				return text === undefined ? [] : edtProductsFromRegistry(text);
			});
	for (const product of registered) {
		const directory = path.dirname(product.location);
		const own = cliInDirectory(directory, platform);
		if (own) {
			add({ version: product.version ?? versionFromPath(directory), directory: path.dirname(own.cli), ...own });
		}
	}

	for (const base of bases) {
		const own = cliInDirectory(base, platform);
		if (own) {
			add({ version: versionFromPath(path.dirname(own.cli)), directory: path.dirname(own.cli), ...own });
			continue;
		}

		for (const name of subdirectoryNames(base)) {
			const version = edtVersionFromDirectory(name);
			const installation = cliInDirectory(path.join(base, name), platform);
			if (version && installation) {
				add({ version, directory: path.dirname(installation.cli), ...installation });
			}
		}
	}

	const installations = [...found.values()].sort((a, b) => compareEdtVersions(b.version, a.version));
	return { installations, bases };
}

/**
 * Выбирает установку: запрошенную версию или старшую из найденных.
 *
 * @param installations - Найденные установки
 * @param requestedVersion - Версия или её начало (`2026`, `2026.1`)
 * @returns Подходящая установка или undefined
 */
export function pickEdtInstallation(
	installations: readonly EdtInstallation[],
	requestedVersion?: string
): EdtInstallation | undefined {
	const requested = requestedVersion?.trim();
	if (!requested) {
		return installations[0];
	}
	return installations.find(
		(installation) => installation.version === requested || installation.version.startsWith(`${requested}.`)
	);
}

/**
 * Порядок установок в вопросе при создании проекта.
 *
 * Текущая настройка проекта идёт первой, чтобы её было видно. Пустая настройка
 * оставляет порядок поиска: от старшей версии к младшей.
 *
 * @param installations - Найденные установки, уже отсортированные
 * @param currentVersion - `edt.version` проекта
 * @returns Тот же набор, текущая версия впереди
 */
export function edtInstallationsForChoice(
	installations: readonly EdtInstallation[],
	currentVersion: string
): EdtInstallation[] {
	const preferred = pickEdtInstallation(installations, currentVersion);
	if (preferred === undefined) {
		return [...installations];
	}
	return [preferred, ...installations.filter((installation) => installation.cli !== preferred.cli)];
}
