import * as fsSync from 'node:fs';
import * as path from 'node:path';

/**
 * Поиск исполняемых файлов платформы 1С:Предприятие (ibsrv, ibcmd).
 *
 * Раскладка бинарей зависит от ОС и способа установки:
 *
 * - Windows: `<база>/<версия>/bin/<имя>` (например `C:/Program Files/1cv8/8.3.27.1936/bin/ibsrv.exe`);
 * - Linux (.deb-пакеты): `<база>/<версия>/<имя>` без каталога `bin`
 *   (например `/opt/1cv8/x86_64/8.5.1.1343/ibsrv`);
 * - Linux (.run-инсталлятор): `<база>/<имя>` — бинарь прямо в каталоге установки,
 *   без подкаталога версии (например `/opt/1C/v8.3/x86_64/ibsrv`).
 *
 * Поэтому резолвер проверяет и `bin/<имя>`, и `<имя>` в каждом каталоге версии,
 * а если каталогов версий нет — ищет бинарь прямо в базе.
 *
 * Чистая логика (разбор/сравнение версий, выбор) вынесена отдельно и покрыта
 * тестами; файловый резолвер {@link resolvePlatformBinary} — тонкая обёртка.
 */

/** Инструмент платформы, который ищем. */
export type PlatformTool = 'ibsrv' | 'ibcmd';

/** Каталог версии платформы: ровно четыре числовых сегмента (8.3.27.1936). */
const VERSION_DIR_RE = /^\d+\.\d+\.\d+\.\d+$/;

/**
 * Является ли имя каталога версией платформы (например, '8.3.27.1936').
 *
 * Отсекает служебные каталоги установки (common, conf, srvinfo и т.п.).
 *
 * @param name - Имя каталога
 * @returns true, если это каталог версии платформы
 */
export function is1cVersionDir(name: string): boolean {
	return VERSION_DIR_RE.test(name);
}

/**
 * Сравнивает две версии платформы посегментно (числовое сравнение).
 *
 * @returns -1 если a < b, 0 если равны, 1 если a > b
 */
export function compare1cVersions(a: string, b: string): number {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const da = pa[i] ?? 0;
		const db = pb[i] ?? 0;
		if (da !== db) {
			return da < db ? -1 : 1;
		}
	}
	return 0;
}

/**
 * Имя исполняемого файла инструмента с учётом ОС.
 *
 * @param tool - Инструмент платформы
 * @param platform - Платформа ОС (process.platform)
 * @returns Имя файла (например, 'ibsrv.exe' на Windows, 'ibsrv' иначе)
 */
export function platformBinaryFileName(tool: PlatformTool, platform: NodeJS.Platform): string {
	return platform === 'win32' ? `${tool}.exe` : tool;
}

/**
 * Выбирает версию платформы из доступных.
 *
 * Если запрошена конкретная версия и она есть — возвращается она. Если запрос
 * задан как префикс (например, '8.3.27'), берётся наибольшая подходящая версия.
 * Если запрос не задан — наибольшая из доступных.
 *
 * @param versions - Доступные версии (имена каталогов)
 * @param requested - Запрошенная версия или её префикс (опционально)
 * @returns Выбранная версия или undefined, если подходящей нет
 */
export function pickPlatformVersion(versions: string[], requested?: string): string | undefined {
	const valid = versions.filter(is1cVersionDir);
	if (valid.length === 0) {
		return undefined;
	}

	const sortedDesc = [...valid].sort((a, b) => compare1cVersions(b, a));

	if (requested && requested.trim()) {
		const target = requested.trim();
		if (sortedDesc.includes(target)) {
			return target;
		}
		// Префиксный запрос: '8.3.27' → наибольшая 8.3.27.*
		const prefix = target.endsWith('.') ? target : `${target}.`;
		const prefixed = sortedDesc.find((v) => v.startsWith(prefix));
		return prefixed;
	}

	return sortedDesc[0];
}

/**
 * Разворачивает `${env:NAME}` в пути каталога установки платформы.
 *
 * VS Code подставляет переменные конфигурации отладки уже после
 * resolveDebugConfiguration, поэтому для чтения каталога версий раскрываем
 * `${env:PROGRAMFILES}` и подобные самостоятельно.
 *
 * @param dir - Путь, возможно содержащий `${env:NAME}`
 * @returns Путь с раскрытыми переменными окружения
 */
export function expandEnvPlaceholders(dir: string): string {
	return dir.replace(/\$\{env:([^}]+)\}/g, (_match, name: string) => process.env[name] ?? '');
}

/**
 * Выбирает конкретную версию платформы (каталог `8.3.27.1936`) в каталоге
 * установки, учитывая запрошенную версию или её префикс.
 *
 * В отличие от {@link resolvePlatformBinary} не проверяет наличие бинаря —
 * нужен просто выбор версии (например, для поля `platformVersion` отладчика).
 *
 * @param baseDir - Каталог с версиями платформ (может содержать `${env:NAME}`)
 * @param requested - Запрошенная версия или префикс (опционально)
 * @returns Конкретная версия или undefined, если каталог недоступен/пуст
 */
export function resolvePlatformVersion(baseDir: string, requested?: string): string | undefined {
	let entries: fsSync.Dirent[];
	try {
		entries = fsSync.readdirSync(expandEnvPlaceholders(baseDir), { withFileTypes: true });
	} catch {
		return undefined;
	}
	const available = entries
		.filter((e) => e.isDirectory() && is1cVersionDir(e.name))
		.map((e) => e.name);
	return pickPlatformVersion(available, requested);
}

/**
 * Каталоги установки платформы по умолчанию (перебираются по порядку).
 *
 * На Linux раскладка зависит от способа установки, поэтому кандидатов несколько:
 * `/opt/1cv8/x86_64` (.deb-пакеты, версии подкаталогами) и
 * `/opt/1C/v8.3/x86_64` (.run-инсталлятор, бинари прямо в каталоге).
 *
 * @param platform - Платформа ОС (по умолчанию process.platform)
 * @returns Список каталогов-кандидатов
 */
export function defaultPlatformBasePaths(platform: NodeJS.Platform = process.platform): string[] {
	if (platform === 'win32') {
		const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
		return [path.join(programFiles, '1cv8')];
	}
	return ['/opt/1cv8/x86_64', '/opt/1C/v8.3/x86_64'];
}

/**
 * Ищет бинарь в конкретном каталоге, учитывая опциональный подкаталог `bin`.
 *
 * @param dir - Каталог (базовый или версии)
 * @param fileName - Имя файла бинаря
 * @returns Полный путь или undefined
 */
function binaryInDir(dir: string, fileName: string): string | undefined {
	const withBin = path.join(dir, 'bin', fileName);
	if (fsSync.existsSync(withBin)) {
		return withBin;
	}
	const direct = path.join(dir, fileName);
	if (fsSync.existsSync(direct)) {
		return direct;
	}
	return undefined;
}

/** Опции поиска бинаря платформы. */
export interface ResolvePlatformBinaryOptions {
	/** Запрошенная версия платформы или её префикс (пусто — наибольшая доступная). */
	requestedVersion?: string;
	/** Платформа ОС (по умолчанию process.platform). */
	platform?: NodeJS.Platform;
}

/**
 * Находит путь к исполняемому файлу платформы в каталоге установки.
 *
 * Сначала перебирает каталоги версий (у которых реально присутствует нужный
 * бинарь — в `bin/` или напрямую) и выбирает версию через
 * {@link pickPlatformVersion}. Если каталогов версий нет, ищет бинарь прямо в
 * базе (раскладка .run-инсталлятора на Linux, где версия из пути не читается).
 *
 * @param baseDir - Каталог установки платформы (например, `C:\Program Files\1cv8`)
 * @param tool - Инструмент платформы (ibsrv/ibcmd)
 * @param options - Опции (версия, ОС)
 * @returns Полный путь к бинарю или undefined, если не найден
 */
export function resolvePlatformBinary(
	baseDir: string,
	tool: PlatformTool,
	options: ResolvePlatformBinaryOptions = {}
): string | undefined {
	const platform = options.platform ?? process.platform;
	const fileName = platformBinaryFileName(tool, platform);

	let entries: fsSync.Dirent[];
	try {
		entries = fsSync.readdirSync(baseDir, { withFileTypes: true });
	} catch {
		return undefined;
	}

	// Версии, у которых бинарь реально на месте (в `bin/` или напрямую).
	const byVersion = new Map<string, string>();
	for (const e of entries) {
		if (!e.isDirectory() || !is1cVersionDir(e.name)) {
			continue;
		}
		const found = binaryInDir(path.join(baseDir, e.name), fileName);
		if (found) {
			byVersion.set(e.name, found);
		}
	}

	const version = pickPlatformVersion([...byVersion.keys()], options.requestedVersion);
	if (version) {
		return byVersion.get(version);
	}

	// Нет каталогов версий с бинарём — раскладка без подкаталога версии
	// (.run-инсталлятор: `/opt/1C/v8.3/x86_64/ibsrv`).
	return binaryInDir(baseDir, fileName);
}
