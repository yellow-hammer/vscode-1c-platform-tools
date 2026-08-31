/**
 * Запуск клиента 1С через штатный стартер платформы.
 *
 * 1cestart сам читает запись списка по имени и применяет Version, App, WA
 * и дополнительные параметры. Собирать командную строку 1cv8 из полей v8i
 * не нужно — и опасно расходиться с тем, как базу открывает сама платформа.
 */

import { spawn, type SpawnOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { defaultPlatformBasePaths } from '../../shared/platformBinary';

/** Режим запуска стартера. */
export type CestartMode = 'ENTERPRISE' | 'DESIGNER';

/** Итог поиска 1cestart. */
export interface CestartLookup {
	/** Путь к найденному файлу. */
	readonly binary?: string;
	/** Каталоги, в которых искали (для журнала). */
	readonly bases: readonly string[];
}

/** Опции поиска 1cestart. */
export interface FindCestartOptions {
	/** Дополнительные корни установки (например `clusters.path.platform`). */
	readonly extraRoots?: readonly string[];
	/** Платформа ОС. */
	readonly platform?: NodeJS.Platform;
	/** Проверка файла: в тестах подставляется, чтобы не трогать диск. */
	readonly exists?: (filePath: string) => boolean;
	/** Корни установки по умолчанию. */
	readonly defaultRoots?: readonly string[];
}

/** Процесс, которому достаточно отпустить родительский. */
export interface DetachedChild {
	unref(): void;
}

/** Функция запуска процесса в стиле `spawn`. */
export type SpawnDetachedFn = (
	command: string,
	args: readonly string[],
	options: SpawnOptions
) => DetachedChild;

/**
 * Имя файла стартера платформы.
 *
 * @param platform - Платформа ОС
 * @returns `1cestart.exe` на Windows, иначе `1cestart`
 */
export function cestartFileName(platform: NodeJS.Platform = process.platform): string {
	return platform === 'win32' ? '1cestart.exe' : '1cestart';
}

/** Дополнительные поля для командной строки стартера. */
export interface CestartArgsOptions {
	/** Строка Connect из v8i: даёт `/F` или `/S`, если имя в списке не уникально. */
	readonly connect?: string;
	/** Передавать `/IBName`. Выключено для одноимённых записей и имён со слешем. */
	readonly useIbName?: boolean;
}

/**
 * Кавычки в значении ключа 1С: `"Текст"` , внутренние кавычки удваиваются.
 *
 * @param value - Имя базы или путь
 * @returns Значение в кавычках платформы
 */
export function quote1cValue(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Ключ `/F` или `/S` из поля Connect записи v8i.
 *
 * @param connect - Сырое `File="…";` или `Srvr="…";Ref="…";`
 * @returns Аргумент стартера или undefined
 */
export function cestartConnectionArg(connect: string): string | undefined {
	const file = /File\s*=\s*"([^"]*)"/i.exec(connect);
	if (file?.[1]) {
		return `/F${quote1cValue(file[1])}`;
	}
	const server = /Srvr\s*=\s*"([^"]*)"/i.exec(connect);
	const ref = /Ref\s*=\s*"([^"]*)"/i.exec(connect);
	if (server?.[1] && ref?.[1]) {
		const address = server[1] + '\\' + ref[1];
		return `/S${quote1cValue(address)}`;
	}
	return undefined;
}

/**
 * Аргументы стартера. Ключи 1С пишутся слитно: `/IBName"База"`, не `/IBName База`.
 *
 * @param mode - Предприятие или Конфигуратор
 * @param ibName - Имя секции в v8i
 * @param options - Строка подключения и нужно ли имя
 * @returns Аргументы для CreateProcess / argv
 */
export function cestartArgs(mode: CestartMode, ibName: string, options: CestartArgsOptions = {}): string[] {
	const connection = options.connect ? cestartConnectionArg(options.connect) : undefined;
	const useIbName = (options.useIbName ?? true) || !connection;
	const args: string[] = [mode];
	if (useIbName && ibName) {
		args.push(`/IBName${quote1cValue(ibName)}`);
	}
	if (connection) {
		args.push(connection);
	}
	args.push('/AppAutoCheckVersion');
	return args;
}

/**
 * Нужен ли ключ `/IBName`: по нему стартер читает запись списка целиком.
 * Имя со слешем он принимает за путь, одноимённые записи неоднозначны.
 *
 * @param name - Имя базы в v8i
 * @param names - Имена всех записей текущего списка
 * @returns `false`, если открывать только по строке подключения
 */
export function shouldPassIbName(name: string, names: readonly string[]): boolean {
	if (/[\\/]/.test(name)) {
		return false;
	}
	return names.filter((item) => item === name).length <= 1;
}

/**
 * Корни установки, в которых лежит `common/1cestart`.
 *
 * @param options - Корни и ОС
 * @returns Уникальные каталоги в порядке проверки
 */
function searchRoots(options: FindCestartOptions): string[] {
	const platform = options.platform ?? process.platform;
	const configured = (options.extraRoots ?? []).map((root) => root.trim()).filter(Boolean);
	const defaults = options.defaultRoots ?? defaultPlatformBasePaths(platform);
	const extra: string[] = [];
	if (platform === 'win32') {
		const x86 = process.env['ProgramFiles(x86)'];
		if (x86) {
			extra.push(path.join(x86, '1cv8'));
		}
	}
	return [...new Set([...configured, ...defaults, ...extra])];
}

/**
 * Кандидаты пути к 1cestart для одного корня установки.
 *
 * Стартер живёт в `common` рядом с каталогами версий. Если в настройке указали
 * саму версию или её `bin`, поднимаемся к корню установки.
 *
 * @param root - Каталог установки, версии или bin
 * @param fileName - Имя файла стартера
 * @returns Возможные пути
 */
export function cestartCandidates(root: string, fileName: string): string[] {
	const trimmed = root.trim();
	if (!trimmed) {
		return [];
	}
	const parents = [trimmed, path.dirname(trimmed), path.dirname(path.dirname(trimmed))];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const dir of parents) {
		for (const candidate of [path.join(dir, 'common', fileName), path.join(dir, fileName)]) {
			if (seen.has(candidate)) {
				continue;
			}
			seen.add(candidate);
			out.push(candidate);
		}
	}
	return out;
}

/**
 * Ищет 1cestart в каталогах установки платформы.
 *
 * @param options - Корни, ОС, проверка файла
 * @returns Найденный путь и перебранные корни
 */
export function findCestart(options: FindCestartOptions = {}): CestartLookup {
	const platform = options.platform ?? process.platform;
	const fileName = cestartFileName(platform);
	const exists = options.exists ?? ((filePath: string) => fs.existsSync(filePath));
	const bases = searchRoots(options);
	for (const base of bases) {
		for (const candidate of cestartCandidates(base, fileName)) {
			if (exists(candidate)) {
				return { binary: candidate, bases };
			}
		}
	}
	return { binary: undefined, bases };
}

/**
 * Каталог файловой ИБ из Connect, если его нет на диске.
 *
 * @param connect - Поле Connect записи v8i
 * @param exists - Проверка пути
 * @returns Путь или undefined
 */
export function missingFileInfobase(
	connect: string | undefined,
	exists?: (filePath: string) => boolean
): string | undefined {
	if (!connect) {
		return undefined;
	}
	const file = /File\s*=\s*"([^"]*)"/i.exec(connect);
	if (!file?.[1]) {
		return undefined;
	}
	const present = exists ?? ((filePath: string) => fs.existsSync(filePath));
	return present(file[1]) ? undefined : file[1];
}

/**
 * Аргументы `cmd /c start` для Windows: пустой заголовок и путь к exe в кавычках.
 *
 * @param exe - Полный путь к 1cestart
 * @param args - Аргументы стартера
 * @returns Команда и аргументы для spawn
 */
export function windowsStartInvocation(
	exe: string,
	args: readonly string[]
): { readonly command: string; readonly args: string[] } {
	return {
		command: process.env.ComSpec || 'cmd.exe',
		args: ['/c', 'start', '""', `"${exe}"`, ...args],
	};
}

/**
 * Запускает 1cestart так, чтобы окно клиента было видно.
 *
 * На Windows — через `cmd /c start`: путь с пробелами и ключи `/F"…"` доходят
 * до платформы. Прямой spawn без кавычек вокруг exe стартер не разбирает.
 *
 * @param command - Путь к 1cestart
 * @param args - Аргументы стартера
 * @param spawnFn - Функция запуска (в тестах подменяется)
 * @param platform - Платформа ОС
 */
export function spawnDetached(
	command: string,
	args: readonly string[],
	spawnFn: SpawnDetachedFn = spawn as SpawnDetachedFn,
	platform: NodeJS.Platform = process.platform
): void {
	if (platform === 'win32') {
		const invocation = windowsStartInvocation(command, args);
		spawnFn(invocation.command, invocation.args, {
			stdio: 'ignore',
			windowsHide: false,
			windowsVerbatimArguments: true,
		});
		return;
	}
	const child = spawnFn(command, [...args], { detached: true, stdio: 'ignore' });
	child.unref();
}

/** Исход запуска базы. */
export type LaunchInfobaseResult =
	| { readonly ok: true; readonly binary: string; readonly args: readonly string[] }
	| { readonly ok: false; readonly message: string };

/** Зависимости запуска — чтобы команда не ходила в файловую систему в тестах. */
export interface LaunchInfobaseDeps {
	readonly extraRoots?: readonly string[];
	readonly find?: (options: FindCestartOptions) => CestartLookup;
	readonly spawn?: (command: string, args: readonly string[]) => void;
	readonly connect?: string;
	readonly useIbName?: boolean;
	readonly exists?: (filePath: string) => boolean;
}

/**
 * Запускает базу из списка платформы через 1cestart.
 *
 * @param name - Имя базы в v8i
 * @param mode - Предприятие или Конфигуратор
 * @param deps - Поиск стартера и запуск процесса
 * @returns Успех или короткое сообщение, почему не вышло
 */
export function launchInfobase(
	name: string,
	mode: CestartMode,
	deps: LaunchInfobaseDeps = {}
): LaunchInfobaseResult {
	const ibName = name.trim();
	if (!ibName) {
		return { ok: false, message: 'Не выбрана информационная база.' };
	}
	const find = deps.find ?? findCestart;
	const lookup = find({ extraRoots: deps.extraRoots });
	if (!lookup.binary) {
		return {
			ok: false,
			message: 'Не найден 1cestart. Укажите каталог установки платформы в настройках.',
		};
	}
	const missingIb = missingFileInfobase(deps.connect, deps.exists);
	if (missingIb) {
		return { ok: false, message: `Каталог базы не найден: ${missingIb}` };
	}
	try {
		const args = cestartArgs(mode, ibName, {
			connect: deps.connect,
			useIbName: deps.useIbName,
		});
		const run = deps.spawn ?? ((command: string, spawnArgs: readonly string[]) => spawnDetached(command, spawnArgs));
		run(lookup.binary, args);
		return { ok: true, binary: lookup.binary, args };
	} catch {
		return { ok: false, message: 'Не удалось запустить 1С.' };
	}
}
