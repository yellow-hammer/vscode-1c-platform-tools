/**
 * Поиск утилиты администрирования кластера (rac).
 *
 * rac входит в поставку платформы и лежит рядом с остальными бинарями, поэтому
 * каталоги установки и выбор версии берутся из общего резолвера платформы.
 * Настройка задаёт каталог установки платформы, а не путь к самой утилите: имя
 * бинаря и раскладку каталогов расширение знает само — так же, как для ibsrv.
 *
 * rac запускается локально и общается с сервером администрирования по сети,
 * так что для управления удалённым кластером достаточно локальной платформы.
 */

import {
	compare1cVersions,
	defaultPlatformBasePaths,
	listPlatformVersions,
	platformBinaryFileName,
	resolvePlatformBinary,
} from '../../shared/platformBinary';

/** Итог поиска rac. */
export interface RacLookup {
	/** Путь к найденному файлу или undefined. */
	binary?: string;
	/** Каталоги, в которых велся поиск (для сообщения об ошибке). */
	bases: string[];
}

/**
 * Находит rac в каталоге установки платформы.
 *
 * Если настройка пуста, перебираются каталоги установки по умолчанию для
 * текущей ОС и архитектуры.
 *
 * @param platformPath - Настройка `clusters.path.platform` (каталог установки платформы)
 * @param requestedVersion - Версия платформы или её префикс (пусто — наибольшая)
 * @returns Найденный путь и перебранные каталоги
 */
export function findRac(platformPath: string, requestedVersion?: string): RacLookup {
	const configured = platformPath.trim();
	const bases = configured ? [configured] : defaultPlatformBasePaths();
	for (const base of bases) {
		const binary = resolvePlatformBinary(base, 'rac', {
			requestedVersion: requestedVersion || undefined,
		});
		if (binary) {
			return { binary, bases };
		}
	}
	return { binary: undefined, bases };
}

/**
 * Перечисляет версии платформы, в которых есть rac.
 *
 * Список предлагается в форме подключения: администратор выбирает версию из
 * установленных, а не вспоминает номер. Каталоги те же, что и при поиске
 * утилиты, поэтому предложенная версия точно запустится.
 *
 * @param platformPath - Настройка `clusters.path.platform` (пусто — каталоги по умолчанию)
 * @returns Версии от новых к старым, без повторов
 */
export function listRacVersions(platformPath: string): string[] {
	const configured = platformPath.trim();
	const bases = configured ? [configured] : defaultPlatformBasePaths();
	const versions = new Set<string>();
	for (const base of bases) {
		for (const version of listPlatformVersions(base, 'rac')) {
			versions.add(version);
		}
	}
	return [...versions].sort((a, b) => compare1cVersions(b, a));
}

/**
 * Составляет сообщение о том, что rac не найден.
 *
 * @param lookup - Итог поиска
 * @returns Текст с перечислением проверенных каталогов
 */
export function describeRacNotFound(lookup: RacLookup): string {
	const fileName = platformBinaryFileName('rac', process.platform);
	const bases = lookup.bases.length > 0 ? lookup.bases.join(', ') : 'каталоги установки не определены';
	return (
		`Утилита ${fileName} не найдена. Проверены каталоги: ${bases}. ` +
		'Укажите каталог установки платформы настройкой «Кластеры: каталог установки платформы».'
	);
}
