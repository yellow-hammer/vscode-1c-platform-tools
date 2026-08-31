/**
 * Куда выгружать расширение из ИБ: имя в базе и каталог исходников.
 *
 * Каталог на диске может называться иначе, чем расширение в метаданных
 * (`yaxunit-test` / «Тесты»). Если подходящего каталога нет, выгрузка
 * создаёт папку с именем из базы.
 */

/** Расширение, уже лежащее в исходниках. */
export interface DiskExtension {
	/** Имя каталога в src/cfe (или tests/cfe). */
	folder: string;
	/** Имя из Configuration.xml или имя каталога, если XML нет. */
	extensionName: string;
}

/** Цель выгрузки одного расширения. */
export interface ExtensionDumpTarget {
	/** Каталог исходников относительно корня расширений. */
	folder: string;
	/** Имя расширения для vanessa-runner. */
	extensionName: string;
}

/**
 * Сопоставляет выбранные имена с каталогами на диске.
 *
 * Совпадение — по имени каталога или по имени из метаданных, без учёта
 * регистра. Нет пары — каталог будет назван как выбранное имя.
 *
 * @param disk - Уже существующие каталоги
 * @param selectedNames - Имена из выбора, настройки или списка ИБ
 * @returns Цели выгрузки в порядке выбора
 */
export function resolveDumpTargets(
	disk: readonly DiskExtension[],
	selectedNames: readonly string[]
): ExtensionDumpTarget[] {
	return selectedNames.map((selected) => {
		const match = disk.find(
			(item) =>
				equalsIgnoreCase(item.folder, selected) ||
				equalsIgnoreCase(item.extensionName, selected)
		);
		if (match === undefined) {
			return { folder: selected, extensionName: selected };
		}
		return {
			folder: match.folder,
			extensionName: match.extensionName
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

function equalsIgnoreCase(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase();
}
