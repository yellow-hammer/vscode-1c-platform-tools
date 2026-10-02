/**
 * Утилиты для работы с командами терминала
 * 
 * Предоставляет функции для определения типа оболочки терминала,
 * нормализации путей, экранирования аргументов и формирования команд
 * с учетом особенностей различных оболочек (cmd, PowerShell, bash, sh, zsh).
 * 
 * Поддерживаемые оболочки:
 * - Windows: cmd, PowerShell, Git Bash, WSL bash
 * - Linux: bash, sh, zsh
 * - macOS: bash, sh, zsh
 * 
 * @module commandUtils
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import {
	commandPrefix,
	escapeCommandArg,
	escapeCommandArgs,
	isBashLikeOnWindows,
	joinShellCommands,
	normalizeArgForShell,
	pathConversionPrefix,
	PROCESS_HOST_SHELL,
	quoteExecutable,
	type ShellType,
} from './shellEscape';
import { CONTAINER_WORKSPACE, isInsideDir, type DockerMount } from '../shared/dockerPaths';
import { WINDOW_CONTAINER_LABEL } from '../shared/dockerRun';

export {
	escapeCommandArg,
	escapeCommandArgs,
	normalizeArgForShell,
	PROCESS_HOST_SHELL,
	quoteExecutable,
	type ShellType,
};

/**
 * Определяет тип оболочки из профиля терминала VS Code
 * 
 * Анализирует имя профиля терминала и определяет тип оболочки по ключевым словам.
 * 
 * @param profileName - Имя профиля терминала (например, 'PowerShell', 'Git Bash', 'Command Prompt')
 * @returns Тип оболочки или undefined, если не удалось определить
 */
function detectShellFromProfile(profileName: string): ShellType | undefined {
	const profileLower = profileName.toLowerCase();
	if (profileLower.includes('powershell') || profileLower.includes('pwsh')) {
		return 'powershell';
	}
	if (profileLower.includes('cmd') || profileLower.includes('command prompt') || profileLower.includes('command')) {
		return 'cmd';
	}
	// Git Bash и другие bash оболочки на Windows
	if (profileLower.includes('git bash') || (profileLower.includes('bash') && process.platform === 'win32')) {
		return 'bash';
	}
	if (profileLower.includes('bash')) {
		return 'bash';
	}
	if (profileLower.includes('zsh')) {
		return 'zsh';
	}
	return undefined;
}

/**
 * Определяет тип оболочки из настроек VS Code для Windows
 * 
 * Проверяет настройки terminal.integrated.defaultProfile.windows и активный терминал.
 * Также проверяет переменные окружения для более точного определения.
 * 
 * @returns Тип оболочки или undefined, если не удалось определить
 */
function detectShellFromVSCodeWindows(): ShellType | undefined {
	try {
		// Сначала проверяем активный терминал (более точное определение)
		const activeTerminal = vscode.window.activeTerminal;
		if (activeTerminal) {
			const shellType = detectShellFromProfile(activeTerminal.name);
			if (shellType) {
				return shellType;
			}
		}
		
		// Затем проверяем настройки VS Code
		const config = vscode.workspace.getConfiguration('terminal.integrated');
		const defaultProfile = config.get<string>('defaultProfile.windows');
		
		if (defaultProfile) {
			const shellType = detectShellFromProfile(defaultProfile);
			if (shellType) {
				return shellType;
			}
		}
		
		// Дополнительная проверка переменных окружения для PowerShell
		// Это помогает определить тип оболочки, даже если имя терминала не содержит информацию
		if (process.env.PSModulePath || process.env.PSExecutionPolicyPreference) {
			return 'powershell';
		}
	} catch {
		// Если не удалось определить через настройки
	}
	return undefined;
}

/**
 * Определяет тип оболочки из переменных окружения для Windows
 * 
 * Проверяет переменные окружения:
 * - SHELL - указывает на bash оболочки (Git Bash, WSL, Cygwin)
 * - COMSPEC - указывает на cmd.exe
 * - PSModulePath, PSExecutionPolicyPreference - указывают на PowerShell
 * - TERM_PROGRAM - может указывать на тип терминала
 * 
 * @returns Тип оболочки или undefined, если не удалось определить
 */
function detectShellFromEnvWindows(): ShellType | undefined {
	// SHELL указывает на bash оболочки (Git Bash, WSL, Cygwin)
	if (process.env.SHELL) {
		const shell = process.env.SHELL.toLowerCase();
		if (shell.includes('bash')) {
			return 'bash';
		}
		if (shell.includes('zsh')) {
			return 'zsh';
		}
	}
	
	// Проверяем переменные окружения PowerShell
	// PSModulePath обычно присутствует в PowerShell сессиях
	if (process.env.PSModulePath || process.env.PSExecutionPolicyPreference) {
		return 'powershell';
	}
	
	// COMSPEC указывает на cmd.exe
	if (process.env.COMSPEC) {
		const comspec = process.env.COMSPEC.toLowerCase();
		if (comspec.includes('cmd.exe')) {
			return 'cmd';
		}
		// Если COMSPEC указывает на PowerShell
		if (comspec.includes('powershell.exe') || comspec.includes('pwsh.exe')) {
			return 'powershell';
		}
	}
	
	return undefined;
}

/**
 * Определяет тип оболочки из настроек VS Code для Unix-систем
 * 
 * Проверяет настройки terminal.integrated.defaultProfile.osx (macOS)
 * или terminal.integrated.defaultProfile.linux (Linux).
 * 
 * @returns Тип оболочки или undefined, если не удалось определить
 */
function detectShellFromVSCodeUnix(): ShellType | undefined {
	try {
		const config = vscode.workspace.getConfiguration('terminal.integrated');
		const defaultProfile = process.platform === 'darwin' 
			? config.get<string>('defaultProfile.osx')
			: config.get<string>('defaultProfile.linux');
		
		if (defaultProfile) {
			return detectShellFromProfile(defaultProfile);
		}
	} catch {
		// Если не удалось определить через настройки
	}
	return undefined;
}

/**
 * Определяет тип оболочки из переменных окружения для Unix-систем
 * 
 * Проверяет переменную окружения SHELL и определяет тип по пути к оболочке.
 * 
 * @returns Тип оболочки (по умолчанию 'bash', если не удалось определить)
 */
function detectShellFromEnvUnix(): ShellType {
	const shell = process.env.SHELL || '/bin/bash';
	if (shell.includes('zsh')) {
		return 'zsh';
	}
	if (shell.includes('bash')) {
		return 'bash';
	}
	return 'sh';
}

/**
 * Определяет тип оболочки терминала на основе настроек VS Code и платформы
 * 
 * Порядок определения:
 * 1. Настройки VS Code (terminal.integrated.defaultProfile)
 * 2. Активный терминал VS Code
 * 3. Переменные окружения (SHELL, COMSPEC)
 * 4. Значение по умолчанию (PowerShell для Windows, bash для Unix)
 * 
 * @returns Тип оболочки терминала
 */
export function detectShellType(): ShellType {
	if (process.platform === 'win32') {
		// Пытаемся определить через настройки VS Code
		const vsCodeShell = detectShellFromVSCodeWindows();
		if (vsCodeShell) {
			return vsCodeShell;
		}
		
		// Проверяем переменные окружения
		const envShell = detectShellFromEnvWindows();
		if (envShell) {
			return envShell;
		}
		
		// По умолчанию для Windows - PowerShell (более современный)
		return 'powershell';
	}
	
	// Для Unix-подобных систем (Linux, macOS)
	const vsCodeShell = detectShellFromVSCodeUnix();
	if (vsCodeShell) {
		return vsCodeShell;
	}
	
	return detectShellFromEnvUnix();
}

/**
 * Нормализует путь к файлу для указанной оболочки
 * 
 * Для bash оболочек на Windows преобразует обратные слэши в прямые.
 * Для PowerShell и cmd оставляет путь без изменений (они поддерживают оба формата).
 * 
 * @param filePath - Путь к файлу
 * @param shellType - Тип оболочки терминала
 * @returns Нормализованный путь (с прямыми слэшами для bash на Windows)
 */
function normalizePathForShell(filePath: string, shellType: ShellType): string {
	if (isBashLikeOnWindows(shellType)) {
		return filePath.replaceAll('\\', '/');
	}
	// Для PowerShell и cmd оставляем как есть (они поддерживают оба формата)
	return filePath;
}

/**
 * Формирует команду для выполнения в терминале с учетом типа оболочки
 *
 * Автоматически:
 * - Нормализует пути для bash оболочек на Windows
 * - Ставит префикс команды: кодировку UTF-8 на Windows, отключение конвертации путей MSYS
 * - Экранирует аргументы в соответствии с синтаксисом оболочки
 * 
 * @param executablePath - Путь к исполняемому файлу
 * @param args - Аргументы команды
 * @param shellType - Тип оболочки (опционально, определяется автоматически через detectShellType())
 * @returns Строка команды для выполнения в терминале
 */
export function buildCommand(executablePath: string, args: string[], shellType?: ShellType): string {
	const shell = shellType || detectShellType();
	const quotedPath = quoteExecutable(normalizePathForShell(executablePath, shell), shell);
	const argsString = escapeCommandArgs(args, shell);

	return `${commandPrefix(shell)}${quotedPath} ${argsString}`;
}

/**
 * Формирует команду для запуска дочерним процессом (`exec`, `spawn` с shell).
 *
 * Отличается от {@link buildCommand} тем, что оболочка здесь не профиль
 * интегрированного терминала, а cmd/sh. Префикс кодовой страницы обязателен:
 * без него oscript пишет кириллицу в OEM-кодировке.
 *
 * @param executablePath - Путь к исполняемому файлу
 * @param args - Аргументы команды
 * @returns Строка команды для дочернего процесса
 */
export function buildProcessCommand(executablePath: string, args: string[]): string {
	const quotedPath = quoteExecutable(executablePath, PROCESS_HOST_SHELL);
	const argsString = escapeCommandArgs(args, PROCESS_HOST_SHELL);
	return `${commandPrefix(PROCESS_HOST_SHELL)}${quotedPath} ${argsString}`;
}

/**
 * Формирует последовательность команд для выполнения с учетом типа оболочки
 * 
 * Использует разные разделители в зависимости от оболочки:
 * - PowerShell: `;` (последовательное выполнение, ошибки не останавливают)
 * - cmd/bash: `&&` (условное выполнение, останавливается при ошибке)
 * 
 * @param commands - Массив команд для объединения
 * @param shellType - Тип оболочки (опционально, определяется автоматически через detectShellType())
 * @returns Объединенная строка команд с соответствующими разделителями
 */
export function joinCommands(commands: string[], shellType?: ShellType): string {
	return joinShellCommands(commands, shellType || detectShellType());
}

/** Параметры запуска контейнера сверх образа и аргументов vrunner. */
export interface DockerRunOptions {
	/** Имя контейнера, чтобы остановить его при отмене */
	containerName?: string;
	/** Каталоги хоста сверх каталога проекта */
	mounts?: readonly DockerMount[];
	/** Параметры `docker run` из настройки docker.runArgs */
	runArgs?: readonly string[];
	/**
	 * Клиент 1С с окном: контейнер запускается отсоединённым, с меткой
	 * {@link WINDOW_CONTAINER_LABEL}, и после выхода остаётся, пока его не уберут
	 */
	detached?: boolean;
}

/**
 * Параметры `docker run` без публикации портов: `-p`, `--publish`, `-P`, `--publish-all`.
 *
 * @param runArgs - Параметры из настройки docker.runArgs
 * @returns Те же параметры без портов
 */
export function withoutPublishedPorts(runArgs: readonly string[]): string[] {
	const result: string[] = [];
	for (let index = 0; index < runArgs.length; index++) {
		const arg = runArgs[index];
		if (arg === '-p' || arg === '--publish') {
			index++;
		} else if (!/^(-p.|-P$|--publish=|--publish-all(=|$))/.test(arg)) {
			result.push(arg);
		}
	}
	return result;
}

/**
 * Начало аргументов `docker run`: тома, рабочий каталог и параметры пользователя.
 *
 * @param workspaceRoot - Каталог проекта на хосте
 * @param options - Параметры запуска
 * @param hostPath - Запись пути хоста для оболочки
 */
function dockerRunPrefix(workspaceRoot: string, options: DockerRunOptions, hostPath: (value: string) => string): string[] {
	return [
		'run',
		...(options.detached ? ['-d', '--label', WINDOW_CONTAINER_LABEL] : ['--rm']),
		...(options.containerName ? ['--name', options.containerName] : []),
		'-v',
		`${hostPath(workspaceRoot)}:${CONTAINER_WORKSPACE}`,
		...(options.mounts ?? []).flatMap((mount) => ['-v', `${hostPath(mount.host)}:${mount.container}`]),
		'-w',
		CONTAINER_WORKSPACE,
		...(options.runArgs ?? []),
	];
}

/**
 * Аргументы `docker run` для запуска vrunner в контейнере: проект монтируется в `/workspace`.
 *
 * @param dockerImage - Docker-образ с ENTRYPOINT vrunner
 * @param vrunnerArgs - Аргументы команды vrunner
 * @param workspaceRoot - Каталог проекта на хосте
 * @param options - Имя контейнера, дополнительные тома и параметры docker run
 * @returns Аргументы программы `docker`
 */
export function dockerRunArgs(
	dockerImage: string,
	vrunnerArgs: string[],
	workspaceRoot: string,
	options: DockerRunOptions = {}
): string[] {
	return [...dockerRunPrefix(workspaceRoot, options, (value) => value), dockerImage, ...vrunnerArgs];
}

/**
 * Формирует команду Docker для выполнения vrunner в контейнере
 *
 * Создает команду `docker run` с монтированием workspace и выполнением vrunner внутри контейнера.
 * Автоматически нормализует пути для указанной оболочки. В контейнере всегда используется bash (Linux),
 * поэтому аргументы экранируются для bash, а не для оболочки хоста.
 * 
 * **Важно:** Предполагается, что Docker-образ имеет `ENTRYPOINT ["vrunner"]`, поэтому команда `vrunner`
 * не добавляется в аргументы. Если образ не имеет ENTRYPOINT, можно использовать `--entrypoint vrunner`
 * или указать `vrunner` явно в аргументах.
 * 
 * @param dockerImage - Docker-образ для выполнения команд (например, 'yellow-hammer/vrunner:8.3.27.1786')
 * @param vrunnerArgs - Аргументы команды vrunner (без префикса 'vrunner')
 * @param workspaceRoot - Корневая директория workspace (будет смонтирована в /workspace)
 * @param shellType - Тип оболочки терминала хоста (опционально, определяется автоматически)
 * @param options - Имя контейнера, дополнительные тома и параметры docker run
 * @returns Строка команды Docker для выполнения в терминале
 */
export function buildDockerCommand(
	dockerImage: string,
	vrunnerArgs: string[],
	workspaceRoot: string,
	shellType?: ShellType,
	options: DockerRunOptions = {}
): string {
	const shell = shellType || detectShellType();
	// ENTRYPOINT задан exec-формой: оболочки в контейнере нет, аргументы docker
	// получает как argv, поэтому экранируем их для оболочки хоста.
	const dockerArgs = [
		...dockerRunPrefix(workspaceRoot, options, (value) => normalizePathForShell(value, shell)),
		dockerImage,
		...vrunnerArgs,
	];

	return `${pathConversionPrefix(shell)}docker ${escapeCommandArgs(dockerArgs, shell)}`;
}

/**
 * Формирует команду Docker для последовательного выполнения нескольких команд vrunner в контейнере.
 * Запускает sh -c "vrunner args1 && vrunner args2 && ..." в одном контейнере под tini.
 *
 * @param dockerImage - Docker-образ с ENTRYPOINT vrunner
 * @param vrunnerArgsArray - Массив наборов аргументов (каждый набор — одна команда vrunner)
 * @param workspaceRoot - Корневая директория workspace
 * @param shellType - Тип оболочки терминала хоста
 * @param options - Имя контейнера, дополнительные тома и параметры docker run
 */
export function buildDockerCommandSequence(
	dockerImage: string,
	vrunnerArgsArray: string[][],
	workspaceRoot: string,
	shellType?: ShellType,
	options: DockerRunOptions = {}
): string {
	const shell = shellType || detectShellType();
	// Внутреннюю строку разбирает sh контейнера, поэтому она собирается по правилам sh.
	// Наружу она уходит одним аргументом docker и экранируется для оболочки хоста.
	// Ловушку sh выполняет после выхода текущей команды: остановка дожидается vrunner
	// и не даёт начаться следующей команде.
	const innerCommand = `trap 'exit 143' TERM; trap 'exit 130' INT; ${vrunnerArgsArray
		.map((args) => `vrunner ${escapeCommandArgs(args, 'sh')}`)
		.join(' && ')}`;
	const dockerArgs = [
		...dockerRunPrefix(workspaceRoot, options, (value) => normalizePathForShell(value, shell)),
		// sh не передаёт сигнал остановки vrunner: его всей группе процессов раздаёт tini
		'--init',
		'-e',
		'TINI_KILL_PROCESS_GROUP=1',
		'--entrypoint',
		'/bin/sh',
		dockerImage,
		'-c',
	];

	// Готовая строка sh нормализации слэшей не подлежит: обратный слэш в ней —
	// часть экранирования апострофа ('\''), а не путь.
	return `${pathConversionPrefix(shell)}docker ${escapeCommandArgs(dockerArgs, shell)} ${escapeCommandArg(innerCommand, shell)}`;
}

/**
 * Нормализует путь к информационной базе для работы в Docker-контейнере
 *
 * Абсолютный путь внутри каталога проекта становится относительным от рабочего
 * каталога контейнера (`/workspace`): `/FC:\proj\build\ib` → `/F./build/ib`.
 * Относительные пути и базы на сервере не меняются.
 *
 * @param ibPath - Строка подключения (`/F./build/ib`, `/F<абсолютный путь>`) или путь к базе
 * @param workspaceRoot - Корневая директория workspace
 * @returns Нормализованный путь для использования в Docker-контейнере
 */
export function normalizeIbPathForDocker(ibPath: string, workspaceRoot: string): string {
	const fileBase = /^\/F/i.test(ibPath);
	const location = fileBase ? ibPath.slice(2).replace(/^"|"$/g, '') : ibPath;
	if (!path.isAbsolute(location) || !isInsideDir(workspaceRoot, location)) {
		return ibPath;
	}
	const relative = `./${path.relative(workspaceRoot, location).replaceAll('\\', '/')}`;
	return fileBase ? `/F${relative}` : relative;
}