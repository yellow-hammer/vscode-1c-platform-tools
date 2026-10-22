/**
 * Блокировка каталога данных автономного сервера.
 *
 * ibsrv записывает свой pid в `lock.pid` каталога данных и не стартует, пока
 * процесс из этого файла жив: «Ошибка блокировки каталога данных сервера».
 * Такой процесс может остаться от прежнего запуска, например после
 * перезагрузки окна, когда расширение не дождалось его выхода.
 *
 * @module ibsrvDataLock
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { processAlive } from './cacheDir';

/** Файл блокировки в каталоге данных сервера. */
export const DATA_LOCK_FILE = 'lock.pid';

/**
 * Pid из содержимого `lock.pid`.
 *
 * @param text - Содержимое файла
 * @returns Pid или undefined, если в файле не pid
 */
export function parseLockPid(text: string): number | undefined {
	const value = text.replace(/^﻿/, '').trim();
	if (!/^\d+$/.test(value)) {
		return undefined;
	}
	const pid = Number(value);
	return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

/**
 * Запущен ли процесс как ibsrv с этим каталогом данных.
 *
 * Сравнивается аргумент `--data` в том виде, в каком его передаёт расширение:
 * сервер, запущенный вручную с другим написанием пути, сюда не попадает.
 *
 * @param commandLine - Командная строка процесса, аргументы через пробел
 * @param dataDir - Каталог данных сервера
 * @returns true, если это ibsrv с этим каталогом данных
 */
export function isIbsrvCommandFor(commandLine: string, dataDir: string): boolean {
	// Путь программы может содержать пробелы и кавычки (Windows), аргументы ibsrv — с «--»
	const executable = commandLine.split(' --', 1)[0].trim().replace(/^"(.*)"$/, '$1');
	return /(?:^|[\\/])ibsrv(?:\.exe)?$/i.test(executable) && hasArgument(commandLine, `--data=${dataDir}`);
}

/**
 * Есть ли в командной строке аргумент целиком, а не как часть другого.
 *
 * @param commandLine - Аргументы через пробел
 * @param argument - Искомый аргумент
 */
function hasArgument(commandLine: string, argument: string): boolean {
	for (let index = commandLine.indexOf(argument); index !== -1; index = commandLine.indexOf(argument, index + 1)) {
		const before = index === 0 ? ' ' : commandLine[index - 1];
		const after = commandLine[index + argument.length] ?? ' ';
		if (/\s/.test(before) && /\s/.test(after)) {
			return true;
		}
	}
	return false;
}

/**
 * Командная строка процесса.
 *
 * Linux — `/proc`, macOS — `ps`, Windows — `Win32_Process.CommandLine`.
 *
 * @param pid - Процесс
 * @returns Аргументы через пробел или undefined, если строку не прочитать
 */
export async function readProcessCommandLine(pid: number): Promise<string | undefined> {
	if (process.platform === 'linux') {
		const raw = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
		const args = raw.split('\0').filter((arg) => arg !== '');
		return args.length === 0 ? undefined : args.join(' ');
	}
	if (process.platform === 'win32') {
		return readWindowsProcessCommandLine(pid);
	}
	return new Promise((resolve) => {
		execFile('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }, (error, stdout) => {
			const line = stdout.trim();
			resolve(error || line === '' ? undefined : line);
		});
	});
}

/**
 * Командная строка процесса на Windows через CIM.
 * На CI Get-CimInstance иногда падает/таймаутит — до трёх попыток с паузой.
 * Пустой CommandLine — штатный ответ (другой процесс), без ретрая.
 *
 * @param pid - Процесс
 * @returns Аргументы через пробел или undefined, если строку не прочитать
 */
async function readWindowsProcessCommandLine(pid: number): Promise<string | undefined> {
	for (let attempt = 0; attempt < 3; attempt++) {
		if (attempt > 0) {
			await new Promise((r) => setTimeout(r, 200));
		}
		const result = await readWindowsProcessCommandLineOnce(pid);
		if (result.ok) {
			return result.line;
		}
	}
	return undefined;
}

/**
 * Один вызов Get-CimInstance для командной строки процесса.
 *
 * @param pid - Процесс
 * @returns ok:true и строка (или undefined при пустом CommandLine); ok:false при ошибке/таймауте execFile
 */
function readWindowsProcessCommandLineOnce(
	pid: number
): Promise<{ ok: true; line: string | undefined } | { ok: false }> {
	return new Promise((resolve) => {
		execFile(
			'powershell.exe',
			[
				'-NoProfile',
				'-NonInteractive',
				'-Command',
				`(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
			],
			{ encoding: 'utf8', windowsHide: true, timeout: 10_000 },
			(error, stdout) => {
				if (error) {
					resolve({ ok: false });
					return;
				}
				const line = stdout.trim();
				resolve({ ok: true, line: line === '' ? undefined : line });
			}
		);
	});
}

/**
 * Процесс ibsrv, который держит каталог данных сервера.
 *
 * @param dataDir - Каталог данных сервера, как он передаётся в `--data`
 * @returns Pid живого ibsrv с этим каталогом данных или undefined
 */
export async function findDataDirHolder(dataDir: string): Promise<number | undefined> {
	const text = await fs.readFile(path.join(dataDir, DATA_LOCK_FILE), 'utf8').catch(() => undefined);
	const pid = text === undefined ? undefined : parseLockPid(text);
	if (pid === undefined || pid === process.pid || !processAlive(pid)) {
		return undefined;
	}
	const commandLine = await readProcessCommandLine(pid);
	return commandLine !== undefined && isIbsrvCommandFor(commandLine, dataDir) ? pid : undefined;
}
