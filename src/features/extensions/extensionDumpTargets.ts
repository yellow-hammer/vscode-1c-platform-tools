/**
 * Куда выгружать расширение из ИБ: имя в базе и каталог исходников.
 *
 * Каталог на диске может называться иначе, чем расширение в метаданных
 * (`yaxunit-test` / «Тесты»). Если подходящего каталога нет, выгрузка
 * создаёт папку с именем из базы.
 */

import { findExtension, type ExtensionNames } from './extensionSelection';

/** Цель выгрузки одного расширения. */
export interface ExtensionDumpTarget {
	/** Каталог исходников относительно рабочей области; его нет, пока расширение не выгружено впервые. */
	dir?: string;
	/** Имя каталога: им зовётся собранный `*.cfe`; у нового расширения совпадает с именем из базы. */
	folder: string;
	/** Имя расширения для vanessa-runner. */
	extensionName: string;
}

/**
 * Сопоставляет выбранные имена с расширениями на диске.
 *
 * Совпадение — по имени каталога, пути к нему или имени из метаданных, без
 * учёта регистра. Нет пары — каталог будет назван как выбранное имя.
 *
 * @param disk - Уже существующие расширения
 * @param selectedNames - Имена из выбора, настройки или списка ИБ
 * @returns Цели выгрузки в порядке выбора
 */
export function resolveDumpTargets(
	disk: readonly ExtensionNames[],
	selectedNames: readonly string[]
): ExtensionDumpTarget[] {
	return selectedNames.map((selected) => {
		const match = findExtension(disk, selected);
		if (match === undefined) {
			return { folder: selected, extensionName: selected };
		}
		return {
			dir: match.dir,
			folder: match.folder,
			extensionName: match.name
		};
	});
}

/**
 * Имя годится как каталог исходников: не пустое и без запрещённых в пути знаков.
 *
 * @param name - Имя расширения или каталога
 * @returns true, если из имени можно сделать папку
 */
export function isUsableExtensionFolderName(name: string): boolean {
	const trimmed = name.trim();
	if (trimmed.length === 0 || trimmed === '.' || trimmed === '..') {
		return false;
	}
	return !/[<>:"/\\|?*]/.test(trimmed);
}
