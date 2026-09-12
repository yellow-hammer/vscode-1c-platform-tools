/**
 * Расширения раскладки, как их называют команды.
 *
 * У выгрузки конфигуратора каталог расширения лежит в общем каталоге расширений,
 * у проекта EDT это сам проект рядом с проектом конфигурации. Команда получает
 * каталог относительно рабочей области, имя каталога и имя из метаданных.
 * Собранный `*.cfe` зовётся по имени каталога, поэтому по нему же файл
 * приводится обратно к расширению.
 * @module extensionRoots
 */

import * as path from 'node:path';
import { sameOrUnder, type SourceFormat } from '../../shared/projectLayout';
import { CONVENTIONAL_PATHS, type ProjectPaths, type RelativeRoot } from '../../shared/projectPaths';
import { cfeStem, findExtension, type ExtensionNames, type ExtensionScope } from './extensionSelection';

/** Проект EDT конфигурации открыт как рабочая область: класть проект расширения рядом некуда. */
export const NO_PLACE_FOR_EDT_EXTENSION =
	'Проект расширения кладётся рядом с проектом конфигурации: откройте каталог с проектами 1С:EDT.';

/** Расширение из раскладки. */
export interface ExtensionEntry extends ExtensionNames {
	dir: string;
	format: SourceFormat;
}

/**
 * Расширение по корню раскладки.
 *
 * @param root - Корень относительно рабочей области
 */
export function extensionEntry(root: RelativeRoot): ExtensionEntry {
	const base = path.posix.basename(root.dir);
	// Расширение в корне рабочей области каталога не имеет: файлы зовутся по имени из метаданных
	const folder = base === '.' || base === '' ? root.name : base;
	return { dir: root.dir, folder, name: root.name || folder, format: root.format };
}

/**
 * Расширения области: решения, тестовые или все вместе.
 *
 * @param paths - Пути раскладки; без них список пуст
 * @param scope - Область
 */
export function extensionEntries(paths: ProjectPaths | undefined, scope: ExtensionScope | 'all'): ExtensionEntry[] {
	if (!paths) {
		return [];
	}
	const roots =
		scope === 'solution'
			? paths.extensions
			: scope === 'tests'
				? paths.testExtensions
				: [...paths.extensions, ...paths.testExtensions];
	return roots.map(extensionEntry);
}

/**
 * Расширение, в каталоге которого лежит путь: из вложенных самое глубокое.
 *
 * @param entries - Где искать
 * @param workspaceRoot - Корень рабочей области
 * @param absolute - Абсолютный путь файла или каталога
 */
export function extensionContaining(
	entries: readonly ExtensionEntry[],
	workspaceRoot: string,
	absolute: string
): ExtensionEntry | undefined {
	let found: ExtensionEntry | undefined;
	for (const entry of entries) {
		if (sameOrUnder(absolute, path.resolve(workspaceRoot, entry.dir)) && (!found || entry.dir.length > found.dir.length)) {
			found = entry;
		}
	}
	return found;
}

/**
 * Куда положить расширение, которого в исходниках ещё нет.
 *
 * У выгрузки конфигуратора это общий каталог расширений; проект EDT кладётся
 * рядом с проектом конфигурации под именем `<конфигурация>.<расширение>`.
 * Тестовые в обоих форматах идут в каталог тестовых расширений.
 *
 * @param paths - Пути раскладки
 * @param name - Имя расширения
 * @param scope - Область
 * @returns Каталог относительно рабочей области; undefined, когда проект
 *          конфигурации EDT сам является рабочей областью и класть проект некуда
 */
export function newExtensionDir(paths: ProjectPaths | undefined, name: string, scope: ExtensionScope): string | undefined {
	if (scope === 'tests') {
		return path.posix.join(paths?.testExtensionsContainer ?? CONVENTIONAL_PATHS.testsCfe, name);
	}
	const configuration = paths?.configuration;
	if (configuration?.format === 'edt') {
		if (configuration.dir === '.') {
			return undefined;
		}
		return path.posix.join(path.posix.dirname(configuration.dir), `${path.posix.basename(configuration.dir)}.${name}`);
	}
	return path.posix.join(paths?.extensionsContainer ?? CONVENTIONAL_PATHS.cfe, name);
}

/** Файл `*.cfe` и расширение раскладки, к которому он относится. */
export interface CfeFileEntry extends ExtensionNames {
	/** Расширение исходников; undefined, когда файл ни к одному не относится. */
	root?: ExtensionEntry;
}

/**
 * Файлы `*.cfe` как расширения для окна выбора.
 *
 * Ключ выбора у файла свой, имя без `.cfe`, а имя из метаданных и каталог
 * приходят от расширения раскладки, если оно нашлось по любому из имён.
 *
 * @param cfeFiles - Имена файлов
 * @param roots - Расширения раскладки
 */
export function cfeFileEntries(cfeFiles: readonly string[], roots: readonly ExtensionEntry[]): CfeFileEntry[] {
	const stems = [...new Set(cfeFiles.map(cfeStem))];
	return stems.map((stem) => {
		const root = findExtension(roots, stem);
		return { folder: stem, name: root?.name ?? stem, dir: root?.dir, root };
	});
}
