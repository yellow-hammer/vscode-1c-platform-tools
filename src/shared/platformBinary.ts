import * as fsSync from 'node:fs';
import * as path from 'node:path';

/**
 * Поиск исполняемых файлов платформы 1С:Предприятие (ibsrv, ibcmd).
 *
 * Бинарь живёт в `<база>/<версия>/bin/<имя>`, где база — каталог установки
 * платформы (по умолчанию `%PROGRAMFILES%/1cv8` на Windows,
 * `/opt/1C/v8.3/x86_64` на Linux), а `<версия>` — каталог вида `8.3.27.1936`.
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
 * Перебирает каталоги версий, у которых реально присутствует нужный бинарь,
 * и выбирает версию через {@link pickPlatformVersion}.
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

	// Версии, у которых бинарь реально на месте.
	const available = entries
		.filter((e) => e.isDirectory() && is1cVersionDir(e.name))
		.map((e) => e.name)
		.filter((name) => fsSync.existsSync(path.join(baseDir, name, 'bin', fileName)));

	const version = pickPlatformVersion(available, options.requestedVersion);
	if (!version) {
		return undefined;
	}

	return path.join(baseDir, version, 'bin', fileName);
}
