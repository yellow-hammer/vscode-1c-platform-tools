/**
 * Раскладка проекта OneScript: описание пакета, каталоги тестов, задач и зависимостей.
 *
 * Задачи и зависимости лежат там, где их ищет opm: каталог из `.Задачи(...)`,
 * иначе `tasks`, и `oscript_modules` в корне проекта. Скриптовые тесты маркеров
 * не имеют, их каталог задаёт настройка, по умолчанию это каталог тестов проекта.
 *
 * Описание читается без ожидания и запоминается до изменения файла: его
 * спрашивают перед каждой командой.
 * @module oneScriptLayout
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parsePackagedef, type PackageManifest } from './packagedef';
import { DEFAULT_TESTING } from './pathDefaults';
import { projectConfiguration } from './projectConfiguration';
import { directoryKey, PROJECT_FILE, testsDirectoryName } from './projectLayout';
import { currentRoot } from './workspaceProjects';

/** Каталог зависимостей проекта: сюда их ставит `opm install -l`. */
export const MODULES_DIRECTORY = 'oscript_modules';

/** Каталог задач `opm run`. */
export const TASKS_DIRECTORY = 'tasks';

/** Каталог исходного кода пакета по соглашению. */
const DEFAULT_SOURCES = 'src';

/** Прочитанные описания: ключ {@link directoryKey} корня. */
const manifests = new Map<string, { mtimeMs: number; size: number; manifest: PackageManifest }>();

/**
 * Описание пакета из `packagedef` корня.
 *
 * @param root - Корень проекта
 * @returns undefined, если файла нет или он не читается
 */
export function readPackageManifest(root: string): PackageManifest | undefined {
	const file = path.join(root, PROJECT_FILE);
	const key = directoryKey(root);
	let stat: fs.Stats;
	try {
		stat = fs.statSync(file);
	} catch {
		manifests.delete(key);
		return undefined;
	}
	const cached = manifests.get(key);
	if (cached?.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
		return cached.manifest;
	}
	let text: string;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch {
		return undefined;
	}
	const manifest = parsePackagedef(text);
	manifests.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, manifest });
	return manifest;
}

/**
 * Каталог тестов OneScript относительно корня проекта: настройка
 * `test.path.onescriptTests`, пустая значит каталог тестов проекта.
 *
 * @param root - Корень проекта, чьи настройки читаются
 */
export function oneScriptTestsPath(root: string | undefined = currentRoot()): string {
	const configured = projectConfiguration(root)
		.get<string>('test.path.onescriptTests', DEFAULT_TESTING.onescriptTestsPath)
		.trim();
	return configured.length > 0 ? configured : testsDirectoryName(root);
}

/**
 * Каталог задач `opm run`: `Задачи` из packagedef, иначе `tasks`.
 *
 * @param root - Корень проекта
 * @param manifest - Описание пакета; по умолчанию читается из packagedef
 */
export function oneScriptTasksDirectory(root: string, manifest: PackageManifest | undefined = readPackageManifest(root)): string {
	return path.resolve(root, manifest?.tasks ?? TASKS_DIRECTORY);
}

/** Каталоги, по которым загрузчик библиотек OneScript находит классы и модули пакета. */
const PACKAGE_LOADER_DIRECTORIES = ['src/Классы', 'src/Модули', 'Классы', 'Модули', 'src/Classes', 'src/Modules', 'Classes', 'Modules'];

/**
 * Похож ли каталог без `packagedef` на пакет OneScript: в нём есть каталоги
 * классов или модулей загрузчика библиотек либо сценарии `.os` в корне или в `src`.
 *
 * @param dir - Каталог
 */
export function looksLikeOneScriptPackage(dir: string): boolean {
	if (PACKAGE_LOADER_DIRECTORIES.some((name) => fs.existsSync(path.join(dir, name)))) {
		return true;
	}
	return ['', DEFAULT_SOURCES].some((sub) => {
		try {
			return fs.readdirSync(path.join(dir, sub)).some((name) => name.toLowerCase().endsWith('.os'));
		} catch {
			return false;
		}
	});
}
