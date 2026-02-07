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

/**
 * Тип оболочки терминала
 * 
 * Поддерживаемые типы:
 * - `cmd` - Windows Command Prompt
 * - `powershell` - PowerShell (Windows)
 * - `bash` - Bash shell (Windows Git Bash, Linux, macOS)
 * - `sh` - POSIX shell (Linux, macOS)
 * - `zsh` - Z shell (macOS по умолчанию, Linux)
 */
export type ShellType = 'cmd' | 'powershell' | 'bash' | 'sh' | 'zsh';

/**
 * Проверяет, является ли оболочка bash-подобной на Windows
 * 
 * Bash-подобные оболочки на Windows (Git Bash, WSL, Cygwin) требуют
 * преобразования обратных слэшей в прямые для корректной работы с путями.
 * 
 * @param shellType - Тип оболочки терминала
 * @returns true, если это bash/sh/zsh на Windows, иначе false
 */
function isBashLikeOnWindows(shellType: ShellType): boolean {
	return process.platform === 'win32' && (shellType === 'bash' || shellType === 'sh' || shellType === 'zsh');
}

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
 * Экранирует аргумент команды для PowerShell
 * 
 * Использует одинарные кавычки с удвоением апострофов для экранирования.
 * Экранирует аргументы, содержащие пробелы, $, обратные кавычки или точку с запятой.
 * Точка с запятой экранируется, так как в PowerShell она является разделителем команд.
 * 
 * @param arg - Аргумент команды
 * @returns Экранированный аргумент (в одинарных кавычках, если содержит пробелы или спецсимволы)
 */
function escapeArgForPowerShell(arg: string): string {
	// Экранируем аргументы, содержащие пробелы, $, обратные кавычки или точку с запятой
	// Точка с запятой - это разделитель команд в PowerShell, поэтому её нужно экранировать
	if (arg.includes(' ') || arg.includes('$') || arg.includes('`') || arg.includes(';')) {
		return `'${arg.replaceAll("'", "''")}'`;
	}
	return arg;
}

/**
 * Экранирует аргумент команды для cmd и bash
 * 
 * Использует двойные кавычки для аргументов, содержащих пробелы.
 * 
 * @param arg - Аргумент команды
 * @returns Экранированный аргумент (в двойных кавычках, если содержит пробелы)
 */
function escapeArgForCmdBash(arg: string): string {
	if (arg.includes(' ') && !arg.startsWith('"') && !arg.startsWith("'")) {
		return `"${arg}"`;
	}
	return arg;
}

/**
 * Экранирует аргументы команды для безопасной передачи в терминал
 * 
 * Автоматически нормализует пути для bash оболочек на Windows.
 * Использует разные стратегии экранирования в зависимости от оболочки:
 * - PowerShell: одинарные кавычки с удвоением апострофов
 * - cmd/bash: двойные кавычки для аргументов с пробелами
 * 
 * @param args - Массив аргументов команды
 * @param shellType - Тип оболочки (опционально, определяется автоматически)
 * @returns Строка с экранированными аргументами, разделенными пробелами
 */
export function escapeCommandArgs(args: string[], shellType?: ShellType): string {
	const shell = shellType || detectShellType();
	
	return args.map((arg) => {
		const normalizedArg = normalizeArgForShell(arg, shell);
		
		if (shell === 'powershell') {
			return escapeArgForPowerShell(normalizedArg);
		}
		
		return escapeArgForCmdBash(normalizedArg);
	}).join(' ');
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
 * Нормализует аргумент команды для указанной оболочки
 * 
 * Преобразует пути с обратными слэшами в прямые для bash оболочек на Windows.
 * Параметры команд (начинающиеся с `-` или `--`) не нормализуются.
 * 
 * @param arg - Аргумент команды
 * @param shellType - Тип оболочки
 * @returns Нормализованный аргумент
 */
export function normalizeArgForShell(arg: string, shellType: ShellType): string {
	if (isBashLikeOnWindows(shellType)) {
		// Преобразуем обратные слэши в прямые только в путях (не в параметрах команд)
		if (arg.includes('\\') && !arg.startsWith('-') && !arg.startsWith('--')) {
			return arg.replaceAll('\\', '/');
		}
	}
	return arg;
}

/**
 * Формирует префикс команды для установки кодировки UTF-8 в зависимости от оболочки
 * 
 * Для Windows:
 * - PowerShell: использует [Console]::OutputEncoding
 * - cmd: использует chcp 65001
 * - bash: кодировка обычно уже настроена, префикс не нужен
 * 
 * Для Unix-систем: кодировка обычно уже настроена, префикс не нужен
 * 
 * @param shellType - Тип оболочки терминала
 * @returns Префикс команды для установки кодировки или пустая строка
 */
function getEncodingPrefix(shellType: ShellType): string {
	if (process.platform !== 'win32') {
		return '';
	}
	
	if (shellType === 'powershell') {
		// В PowerShell используем [Console]::OutputEncoding для UTF-8
		return '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
	}
	
	if (shellType === 'cmd') {
		// В cmd используем chcp для установки кодировки UTF-8
		return 'chcp 65001 >nul && ';
	}
	
	// Для bash и других оболочек на Windows (Git Bash, WSL) кодировка обычно уже настроена
	return '';
}

/**
 * Формирует команду для выполнения в терминале с учетом типа оболочки
 * 
 * Автоматически:
 * - Нормализует пути для bash оболочек на Windows
 * - Устанавливает кодировку UTF-8 для Windows (chcp для cmd, [Console]::OutputEncoding для PowerShell)
 * - Экранирует аргументы в соответствии с синтаксисом оболочки
 * 
 * @param executablePath - Путь к исполняемому файлу
 * @param args - Аргументы команды
 * @param shellType - Тип оболочки (опционально, определяется автоматически через detectShellType())
 * @returns Строка команды для выполнения в терминале
 */
export function buildCommand(executablePath: string, args: string[], shellType?: ShellType): string {
	const shell = shellType || detectShellType();
	const normalizedPath = normalizePathForShell(executablePath, shell);
	const quotedPath = normalizedPath.includes(' ') ? `"${normalizedPath}"` : normalizedPath;
	const argsString = escapeCommandArgs(args, shell);
	const encodingPrefix = getEncodingPrefix(shell);
	
	return `${encodingPrefix}${quotedPath} ${argsString}`;
}

/**
 * Получает разделитель команд для указанной оболочки
 * 
 * - PowerShell: `;` (последовательное выполнение, ошибки не останавливают)
 * - cmd/bash: `&&` (условное выполнение, останавливается при ошибке)
 * 
 * @param shellType - Тип оболочки терминала
 * @returns Разделитель команд ('; ' для PowerShell, ' && ' для остальных)
 */
function getCommandSeparator(shellType: ShellType): string {
	if (shellType === 'powershell') {
		// В PowerShell используем ; для последовательного выполнения
		// Каждая команда выполняется независимо, ошибки не останавливают выполнение
		return '; ';
	}
	// В cmd и bash используем && для условного выполнения (останавливается при ошибке)
	return ' && ';
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
	const shell = shellType || detectShellType();
	return commands.join(getCommandSeparator(shell));
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
 * @returns Строка команды Docker для выполнения в терминале
 */
export function buildDockerCommand(
	dockerImage: string,
	vrunnerArgs: string[],
	workspaceRoot: string,
	shellType?: ShellType
): string {
	const shell = shellType || detectShellType();
	const normalizedWorkspace = normalizePathForShell(workspaceRoot, shell);
	const volumeMount = `-v "${normalizedWorkspace}:/workspace"`;
	const workDir = `-w /workspace`;
	const normalizedArgs = vrunnerArgs.map((arg) => normalizeArgForShell(arg, shell));
	const argsString = escapeCommandArgs(normalizedArgs, 'bash');
	const dockerCmd = `docker run --rm ${volumeMount} ${workDir} ${dockerImage} ${argsString}`;
	
	return dockerCmd;
}

/**
 * Экранирует строку для передачи как один аргумент в двойных кавычках на хосте.
 * Нужно для формирования -c "..." в docker run --entrypoint /bin/sh.
 */
function escapeForHostDoubleQuoted(inner: string, shellType: ShellType): string {
	if (shellType === 'powershell') {
		return inner.replaceAll('`', '``').replaceAll('"', '`"');
	}
	// cmd, bash, sh, zsh: внутри "..." экранируем \ и "
	const backslash = '\\';
	return inner.replaceAll(backslash, backslash + backslash).replaceAll('"', backslash + '"');
}

/**
 * Формирует команду Docker для последовательного выполнения нескольких команд vrunner в контейнере.
 * Запускает sh -c "vrunner args1 && vrunner args2 && ..." в одном контейнере.
 *
 * @param dockerImage - Docker-образ с ENTRYPOINT vrunner
 * @param vrunnerArgsArray - Массив наборов аргументов (каждый набор — одна команда vrunner)
 * @param workspaceRoot - Корневая директория workspace
 * @param shellType - Тип оболочки терминала хоста
 */
export function buildDockerCommandSequence(
	dockerImage: string,
	vrunnerArgsArray: string[][],
	workspaceRoot: string,
	shellType?: ShellType
): string {
	const shell = shellType || detectShellType();
	const normalizedWorkspace = normalizePathForShell(workspaceRoot, shell);
	const volumeMount = `-v "${normalizedWorkspace}:/workspace"`;
	const workDir = `-w /workspace`;
	const innerParts = vrunnerArgsArray.map((args) => {
		const normalizedArgs = args.map((arg) => normalizeArgForShell(arg, shell));
		return 'vrunner ' + escapeCommandArgs(normalizedArgs, 'bash');
	});
	const innerCommand = innerParts.join(' && ');
	const escapedInner = escapeForHostDoubleQuoted(innerCommand, shell);
	return `docker run --rm ${volumeMount} ${workDir} --entrypoint /bin/sh ${dockerImage} -c "${escapedInner}"`;
}

/**
 * Нормализует путь к информационной базе для работы в Docker-контейнере
 * 
 * Преобразует пути в формат, понятный внутри контейнера:
 * - Формат 1С `/F./path` **не** изменяется, так как `.` уже указывает на рабочую директорию контейнера (`/workspace`)
 * - Абсолютные пути workspace преобразуются в относительные от рабочей директории (например, `./build/ib`)
 * - Относительные пути остаются без изменений
 * 
 * @param ibPath - Путь к информационной базе (может быть в формате `/F./build/ib` или `./build/ib`)
 * @param workspaceRoot - Корневая директория workspace
 * @returns Нормализованный путь для использования в Docker-контейнере
 */
export function normalizeIbPathForDocker(ibPath: string, workspaceRoot: string): string {
	if (ibPath.startsWith('/F.')) {
		// Формат /F./path уже относительный от рабочей директории (`.` → /workspace),
		// поэтому для Docker его менять не нужно
		return ibPath;
	}
	
	if (path.isAbsolute(ibPath) && ibPath.startsWith(workspaceRoot)) {
		const relativePath = path.relative(workspaceRoot, ibPath);
		const unixPath = relativePath.replaceAll('\\', '/');
		return `./${unixPath}`;
	}
	
	return ibPath;
}