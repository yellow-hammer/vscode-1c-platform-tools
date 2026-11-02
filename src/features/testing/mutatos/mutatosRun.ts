/**
 * Запуск мутационного тестирования mutatos: пути, аргументы и окружение.
 *
 * mutatos ставится зависимостью проекта и запускается своей точкой входа
 * выбранным движком OneScript, без обёртки из oscript_modules/bin.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProgramCall } from '../../../shared/cancellableProcess';
import { envName, withSelectedEngine } from '../../../shared/ovmPaths';

/** Наименьшая версия движка, на которой работает mutatos. */
export const MUTATOS_MIN_ENGINE: readonly [number, number, number] = [2, 0, 0];

/** Каталоги из умолчаний mutatos, которые не мутируются и не копируются: зависимости, репозиторий, out. */
const ALWAYS_EXCLUDED = ['oscript_modules', '.git', 'out'];

/** Точка входа mutatos в зависимостях проекта. */
export function mutatosEntry(root: string): string {
	return path.join(root, 'oscript_modules', 'mutatos', 'src', 'cli', 'main.os');
}

/** Отчёты одного прогона. */
export interface MutatosReports {
	json: string;
	html: string;
	xml: string;
}

/**
 * Файлы отчётов в каталоге отчётов mutatos.
 *
 * @param reportsDir - Абсолютный каталог отчётов
 */
export function mutatosReports(reportsDir: string): MutatosReports {
	return {
		json: path.join(reportsDir, 'mutations.json'),
		html: path.join(reportsDir, 'mutations.html'),
		xml: path.join(reportsDir, 'mutations.xml'),
	};
}

/**
 * Движок, который запускается не собственным исполняемым файлом, а через dotnet:
 * сборка FDD. На Windows у неё вместо oscript.exe пакетный файл, на остальных
 * ОС сценарий оболочки.
 *
 * @param file - Абсолютный путь к исполняемому файлу движка
 * @param platform - Платформа
 */
export function isFrameworkDependentEngine(file: string, platform: NodeJS.Platform = process.platform): boolean {
	if (platform === 'win32') {
		return path.extname(file).toLowerCase() !== '.exe';
	}
	const head = Buffer.alloc(2);
	let read = 0;
	let fd: number | undefined;
	try {
		fd = fs.openSync(file, 'r');
		read = fs.readSync(fd, head, 0, 2, 0);
	} catch {
		return false;
	} finally {
		if (fd !== undefined) {
			fs.closeSync(fd);
		}
	}
	return read === 2 && head.toString('latin1') === '#!';
}

/** Путь от корня проекта через прямые слэши. */
function projectRelative(root: string, dir: string): string {
	return path.relative(root, dir).split(path.sep).join('/');
}

/** Первый сегмент пути внутри проекта; undefined для самого корня и путей вне его. */
function topSegment(root: string, dir: string): string | undefined {
	const relative = projectRelative(root, dir);
	if (relative === '' || relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) {
		return undefined;
	}
	return relative.split('/')[0];
}

/** Лежит ли каталог внутри другого. */
function isInside(parent: string, dir: string): boolean {
	const relative = path.relative(parent, dir);
	return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Значение детальки mutatos.ИсключаемыеКаталоги.
 *
 * Одна и та же деталька задаёт и каталоги, которые сканер исходников пропускает,
 * встретив `/<имя>/` в пути файла, и имена верхнего уровня, которые не копируются
 * в рабочие копии. Каталоги результатов сборки и верхнего уровня без файлов `.os`
 * из копий убираются, каталог тестов внутри исходников убирается из сканера.
 * Имя, которое встречается в пути самих исходников, сканер отбросил бы вместе со
 * всеми файлами, поэтому оно не передаётся.
 *
 * @param options.root - Корень проекта
 * @param options.sourcesDirs - Абсолютные каталоги исходников
 * @param options.testsDirs - Абсолютные каталоги тестов
 * @param options.outputDirs - Абсолютные каталоги результатов сборки
 * @param options.topLevelWithoutOs - Имена каталогов верхнего уровня без `.os`
 * @param options.hasTopLevel - Есть ли в корне проекта элемент с таким именем
 * @returns Имена каталогов
 */
export function excludedDirectories(options: {
	root: string;
	sourcesDirs: readonly string[];
	testsDirs: readonly string[];
	outputDirs: readonly string[];
	topLevelWithoutOs?: readonly string[];
	hasTopLevel: (name: string) => boolean;
}): string[] {
	const { root, sourcesDirs, testsDirs } = options;
	const kept = new Set(
		[...sourcesDirs, ...testsDirs].map((dir) => topSegment(root, dir)).filter((name): name is string => name !== undefined)
	);
	const names = [...ALWAYS_EXCLUDED];
	for (const dir of options.outputDirs) {
		const top = topSegment(root, dir);
		if (top !== undefined && !kept.has(top)) {
			names.push(top);
		}
	}
	for (const name of options.topLevelWithoutOs ?? []) {
		if (!kept.has(name)) {
			names.push(name);
		}
	}
	for (const dir of testsDirs) {
		const name = path.basename(dir);
		if (sourcesDirs.some((sources) => isInside(sources, dir)) && !options.hasTopLevel(name)) {
			names.push(name);
		}
	}
	const sourcePaths = sourcesDirs.map((dir) => `${dir.split(path.sep).join('/')}/`);
	const unique = new Map<string, string>();
	for (const name of names) {
		const key = process.platform === 'win32' ? name.toLowerCase() : name;
		if (!unique.has(key) && !sourcePaths.some((sources) => sources.includes(`/${name}/`))) {
			unique.set(key, name);
		}
	}
	return [...unique.values()];
}

/** Отбор тестов прогона: набор и метод OneUnit. */
export interface TestSelection {
	/** Файл тестового набора */
	file: string;
	/** Метод теста */
	method?: string;
}

/**
 * Имя тестового набора OneUnit: имя файла без расширения, где символы, которых
 * не бывает в идентификаторе, и не буква в начале заменены подчёркиванием.
 *
 * @param file - Путь к файлу набора
 */
export function oneUnitSuiteName(file: string): string {
	return path.parse(file).name
		.replace(/^[^a-zA-Z_а-яА-ЯёЁ]/, '_')
		.replace(/[^a-zA-Z0-9_а-яА-ЯёЁ]/g, '_');
}

/**
 * Отбор в том виде, в каком его печатает OneUnit: набор или набор с методом.
 *
 * @param selection - Отбор тестов
 */
export function selectionLabel(selection: TestSelection): string {
	const suite = oneUnitSuiteName(selection.file);
	return selection.method ? `${suite}.${selection.method}` : suite;
}

/** Регулярное выражение, которое совпадает только с самим значением. */
function exactPattern(value: string): string {
	return `^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

/**
 * Фильтры OneUnit для отбора: набор файла и, для кейса, его метод.
 *
 * @param selection - Отбор тестов
 */
export function selectionFilters(selection: TestSelection): string[] {
	const filters = ['-s', exactPattern(oneUnitSuiteName(selection.file))];
	if (selection.method) {
		filters.push('-m', exactPattern(selection.method));
	}
	return filters;
}

/**
 * Запуск mutatos: точка входа выбранным движком, вывод в UTF-8.
 *
 * @param options.oscript - Абсолютный путь к исполняемому файлу движка
 * @param options.root - Корень проекта
 * @param options.sourcesDirs - Абсолютные каталоги исходников
 * @param options.reports - Файлы отчётов
 * @param options.selection - Отбор тестов; без него прогон всеми тестами
 */
export function mutatosCall(options: {
	oscript: string;
	root: string;
	sourcesDirs: readonly string[];
	reports: MutatosReports;
	selection?: TestSelection;
}): ProgramCall {
	const { reports } = options;
	return {
		file: options.oscript,
		args: [
			'-encoding=utf-8',
			mutatosEntry(options.root),
			'run',
			'-p', options.root,
			...options.sourcesDirs.flatMap((dir) => ['-d', dir]),
			'--json', reports.json,
			'--html', reports.html,
			'--xml', reports.xml,
			...(options.selection ? selectionFilters(options.selection) : []),
		],
	};
}

/**
 * Окружение прогона.
 *
 * Исходный прогон mutatos запускает `oscript` по имени через `cmd /c`, поэтому
 * движок задаётся так же, как остальным инструментам OneScript. CI заменяет
 * полосу прогресса отметками: в канал вывода задачи полосу mutatos не рисует.
 *
 * @param base - Исходное окружение
 * @param options.binDir - Каталог выбранного движка
 * @param options.testsDirs - Каталоги тестов от корня проекта
 * @param options.excluded - Значение детальки mutatos.ИсключаемыеКаталоги
 */
export function mutatosEnv(
	base: NodeJS.ProcessEnv,
	options: { binDir: string; testsDirs: readonly string[]; excluded: readonly string[] }
): NodeJS.ProcessEnv {
	const env = withSelectedEngine({ ...base }, options.binDir);
	const values: Record<string, string> = {
		CI: '1',
		'mutatos_КаталогиТестов': options.testsDirs.join(','),
		'mutatos_ИсключаемыеКаталоги': options.excluded.join(','),
	};
	for (const [name, value] of Object.entries(values)) {
		env[envName(env, name)] = value;
	}
	return env;
}

/**
 * Временный каталог запуска: в нём mutatos создаёт рабочие копии проекта.
 *
 * @param base - Окружение задачи
 * @param tempDir - Каталог запуска
 * @returns Переменные запуска поверх окружения задачи
 */
export function mutatosTempEnv(base: NodeJS.ProcessEnv, tempDir: string): NodeJS.ProcessEnv {
	return { [envName(base, 'TEMP')]: tempDir, [envName(base, 'TMP')]: tempDir };
}


/**
 * Каталоги тестов в том виде, в каком их ждёт mutatos: от корня проекта.
 *
 * @param root - Корень проекта
 * @param testsDirs - Абсолютные каталоги тестов
 */
export function relativeTestsDirs(root: string, testsDirs: readonly string[]): string[] {
	return testsDirs.map((dir) => projectRelative(root, dir) || '.');
}
