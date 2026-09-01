/**
 * Поиск установленной 1С:EDT.
 *
 * EDT ставится своим установщиком с releases.1c.ru, поэтому расширение её не
 * загружает, а находит: настройка задаёт каталог установки, иначе перебираются
 * стандартные каталоги. Версия читается из имени каталога, а установок бывает
 * несколько - они не взаимозаменяемы, старшая версия проект младшей откроет,
 * наоборот нет.
 *
 * @module edtLocator
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Найденная установка EDT. */
export interface EdtInstallation {
	/** Версия из имени каталога: `2026.1`. */
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

/** Имя исполняемого файла консоли EDT. */
function cliFileName(platform: NodeJS.Platform): string {
	return platform === 'win32' ? '1cedtcli.exe' : '1cedtcli';
}

/** Имя исполняемого файла графического клиента. */
function guiFileName(platform: NodeJS.Platform): string {
	return platform === 'win32' ? '1cedt.exe' : '1cedt';
}

/**
 * Каталоги, где установщик EDT размещает версии.
 *
 * @param platform - Операционная система
 * @returns Каталоги, внутри которых лежат установки версий
 */
export function defaultEdtBasePaths(platform: NodeJS.Platform = process.platform): string[] {
	if (platform === 'win32') {
		const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
		return [path.join(localAppData, '1C', '1cedtstart', 'installations')];
	}
	return ['/opt/1C/1CE/components', path.join(process.env.HOME || '', '.local', 'share', '1C', '1cedtstart', 'installations')];
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
 * Сравнивает версии EDT: `2026.1` новее `2025.2`.
 *
 * @returns Отрицательное, если a старше b
 */
export function compareEdtVersions(a: string, b: string): number {
	const [aYear, aRelease] = a.split('.').map(Number);
	const [bYear, bRelease] = b.split('.').map(Number);
	return aYear !== bYear ? aYear - bYear : (aRelease || 0) - (bRelease || 0);
}

/**
 * Ищет `1cedtcli` в каталоге установки.
 *
 * Исполняемый файл лежит либо в самом каталоге, либо в подкаталоге `1cedt`:
 * так раскладывает установщик на Windows.
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
 * Настроенный каталог главнее: он проверяется и как каталог одной установки, и
 * как каталог со списком версий. Установка без `1cedtcli` пропускается: список
 * версий у установщика переживает удаление самой EDT.
 *
 * @param configuredPath - Настройка каталога установки; пусто - стандартные каталоги
 * @param platform - Операционная система
 * @returns Найденные установки и перебранные каталоги
 */
export function findEdtInstallations(
	configuredPath = '',
	platform: NodeJS.Platform = process.platform
): EdtLookup {
	const configured = configuredPath.trim();
	const bases = configured ? [configured] : defaultEdtBasePaths(platform);
	const installations: EdtInstallation[] = [];

	for (const base of bases) {
		const own = cliInDirectory(base, platform);
		if (own) {
			installations.push({
				version: edtVersionFromDirectory(path.basename(base)) ?? '',
				directory: path.dirname(own.cli),
				...own,
			});
			continue;
		}

		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(base, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			const version = edtVersionFromDirectory(entry.name);
			const found = cliInDirectory(path.join(base, entry.name), platform);
			if (version && found) {
				installations.push({ version, directory: path.dirname(found.cli), ...found });
			}
		}
	}

	installations.sort((a, b) => compareEdtVersions(b.version, a.version));
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
