/**
 * Экранирование аргументов для конкретной оболочки.
 *
 * Тип оболочки передаётся явно: `exec` и `spawn({ shell: true })` на Windows
 * всегда идут через cmd.exe, даже если терминал — PowerShell.
 *
 * Логика одинаковая для всех оболочек: аргумент из безопасного набора символов
 * уходит как есть, остальное берётся в кавычки. Так пробел, пустая строка,
 * табуляция, кавычка и метасимволы оболочки закрыты одним правилом, а не
 * списком исключений.
 *
 * Два предела лежат вне этого модуля:
 * - `vrunner.bat` и `opm.bat` устроены как `@call oscript "…" %*`, поэтому
 *   аргументы проходят второй разбор cmd: `%переменная%` раскрывается, каретка
 *   удваивается. Экранированием на нашей стороне это не чинится;
 * - Windows PowerShell 5.1 при вызове native-программы теряет кавычку внутри
 *   аргумента и выбрасывает пустой аргумент. PowerShell 7 отдаёт их корректно.
 *
 * @module shellEscape
 */

/** Оболочка, для которой собирается командная строка. */
export type ShellType = 'cmd' | 'powershell' | 'bash' | 'sh' | 'zsh';

/**
 * Оболочка дочернего процесса, не профиль интегрированного терминала.
 * Node берёт её из `ComSpec` (Windows) и `/bin/sh` (остальные ОС).
 */
export const PROCESS_HOST_SHELL: ShellType = process.platform === 'win32' ? 'cmd' : 'sh';

/** Git Bash / WSL / Cygwin на Windows: в путях нужны прямые слэши. */
export function isBashLikeOnWindows(shellType: ShellType): boolean {
	return process.platform === 'win32' && (shellType === 'bash' || shellType === 'sh' || shellType === 'zsh');
}

/** Символы, не требующие кавычек в POSIX-оболочке. Процент там обычный символ. */
const POSIX_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** То же для cmd: обратный слэш безопасен, процент нет (раскрывается даже в кавычках). */
const CMD_SAFE = /^[A-Za-z0-9_@+=:,./\\-]+$/;

/** То же для PowerShell: доллар и обратная кавычка раскрываются, процент нет. */
const POWERSHELL_SAFE = /^[A-Za-z0-9_@%+=:,./\\-]+$/;

/**
 * Символы, которые двойные кавычки cmd не обезвреживают:
 * `%…%` раскрывается и внутри кавычек, `"` рвёт кавычечный контекст,
 * `!` раскрывается при включённом delayed expansion.
 */
const CMD_QUOTES_NOT_ENOUGH = /["%!]/;

/** Метасимволы cmd, снимаемые кареткой. */
const CMD_META = /[()%!^"<>&|]/g;

/**
 * Берёт аргумент в двойные кавычки по правилам разбора командной строки Windows
 * (msvcrt/CommandLineToArgvW): обратные слэши перед кавычкой удваиваются.
 *
 * @param arg - Аргумент команды
 * @returns Аргумент в двойных кавычках
 */
function quoteForWindowsArgv(arg: string): string {
	let quoted = '"';
	let backslashes = 0;
	for (const char of arg) {
		if (char === '\\') {
			backslashes++;
			quoted += char;
			continue;
		}
		if (char === '"') {
			quoted += '\\'.repeat(backslashes + 1) + '"';
			backslashes = 0;
			continue;
		}
		backslashes = 0;
		quoted += char;
	}
	return `${quoted}${'\\'.repeat(backslashes)}"`;
}

/**
 * Экранирует аргумент для cmd.
 *
 * Двойных кавычек хватает почти всегда, но `%VAR%`, `"` и `!` они не закрывают.
 * Для таких аргументов каждый метасимвол дополнительно прикрывается кареткой,
 * и кавычечный контекст cmd вообще не открывается.
 *
 * @param arg - Аргумент команды
 * @returns Экранированный аргумент
 */
function escapeArgForCmd(arg: string): string {
	if (CMD_SAFE.test(arg)) {
		return arg;
	}
	const quoted = quoteForWindowsArgv(arg);
	if (!CMD_QUOTES_NOT_ENOUGH.test(arg)) {
		return quoted;
	}
	return quoted.replace(CMD_META, (char) => `^${char}`);
}

/**
 * Экранирует аргумент для bash/sh/zsh: одинарные кавычки, апостроф разрывом строки.
 *
 * @param arg - Аргумент команды
 * @returns Экранированный аргумент
 */
function escapeArgForPosix(arg: string): string {
	if (POSIX_SAFE.test(arg)) {
		return arg;
	}
	return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/**
 * Экранирует аргумент для PowerShell: одинарные кавычки с удвоением апострофа.
 *
 * @param arg - Аргумент команды
 * @returns Экранированный аргумент
 */
function escapeArgForPowerShell(arg: string): string {
	if (POWERSHELL_SAFE.test(arg)) {
		return arg;
	}
	return `'${arg.replaceAll("'", "''")}'`;
}

/**
 * На Windows в bash-подобных путях заменяет `\` на `/`. Параметры (`-`, `--`) не трогает.
 *
 * @param arg - Аргумент команды
 * @param shellType - Тип оболочки
 * @returns Нормализованный аргумент
 */
export function normalizeArgForShell(arg: string, shellType: ShellType): string {
	if (isBashLikeOnWindows(shellType) && arg.includes('\\') && !arg.startsWith('-') && !arg.startsWith('--')) {
		return arg.replaceAll('\\', '/');
	}
	return arg;
}

/**
 * Экранирует один аргумент для указанной оболочки.
 *
 * @param arg - Аргумент команды
 * @param shellType - Оболочка, которая будет разбирать строку
 * @returns Экранированный аргумент
 */
export function escapeCommandArg(arg: string, shellType: ShellType): string {
	switch (shellType) {
		case 'powershell':
			return escapeArgForPowerShell(arg);
		case 'cmd':
			return escapeArgForCmd(arg);
		case 'bash':
		case 'sh':
		case 'zsh':
			return escapeArgForPosix(arg);
		default: {
			const unknown: never = shellType;
			throw new Error(`Неизвестный тип оболочки: ${String(unknown)}`);
		}
	}
}

/**
 * Собирает аргументы в строку для указанной оболочки.
 *
 * @param args - Аргументы команды
 * @param shellType - Оболочка, которая будет разбирать строку
 * @returns Аргументы через пробел
 */
export function escapeCommandArgs(args: string[], shellType: ShellType): string {
	return args
		.map((arg) => escapeCommandArg(normalizeArgForShell(arg, shellType), shellType))
		.join(' ');
}

/**
 * Экранирует путь к исполняемому файлу.
 *
 * Отличается от аргумента только на cmd: имя команды ищется по кавычечному
 * контексту, поэтому каретка здесь неприменима. Процент в пути к программе
 * cmd раскроет — обойти это в командной строке нельзя.
 *
 * @param executablePath - Путь к исполняемому файлу
 * @param shellType - Оболочка, которая будет разбирать строку
 * @returns Экранированный путь
 */
export function quoteExecutable(executablePath: string, shellType: ShellType): string {
	if (shellType === 'cmd') {
		return CMD_SAFE.test(executablePath) ? executablePath : quoteForWindowsArgv(executablePath);
	}
	return escapeCommandArg(executablePath, shellType);
}
