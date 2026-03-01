import * as vscode from 'vscode';
import { exec } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import { escapeCommandArgs, buildCommand, joinCommands, detectShellType, ShellType, normalizeArgForShell, buildDockerCommand, buildDockerCommandSequence, normalizeIbPathForDocker } from './utils/commandUtils';
import { logger } from './logger';

/**
 * Максимальный размер буфера для выполнения команд (10 МБ)
 * 
 * Используется для ограничения размера вывода команд, чтобы избежать
 * проблем с памятью при выполнении команд с большим выводом.
 */
const MAX_EXEC_BUFFER_SIZE = 10 * 1024 * 1024;

/**
 * Результат выполнения команды vrunner
 * 
 * Используется для синхронного выполнения команд через executeVRunner()
 */
export interface VRunnerExecutionResult {
	/** Успешность выполнения команды (true, если exitCode === 0) */
	success: boolean;
	/** Стандартный вывод команды */
	stdout: string;
	/** Поток ошибок команды */
	stderr: string;
	/** Код возврата команды (0 - успех, иначе - ошибка) */
	exitCode: number;
}

/**
 * Менеджер для работы с vrunner (vanessa-runner)
 * 
 * Синглтон, который управляет:
 * - Путями к vrunner, OneScript, OPM, Allure
 * - Настройками из конфигурации VS Code
 * - Выполнением команд в терминале и синхронно
 * - Работой с env.json для параметров подключения к ИБ
 * 
 * Все команды расширения используют этот менеджер для доступа к vrunner.
 */
export class VRunnerManager {
	private static instance: VRunnerManager;
	private readonly workspaceRoot: string | undefined;
	private extensionPath: string | undefined;

	private constructor(context?: vscode.ExtensionContext) {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			this.workspaceRoot = workspaceFolders[0].uri.fsPath;
		}
		if (context) {
			this.extensionPath = context.extensionPath;
		}
	}

	/**
	 * Получает экземпляр VRunnerManager (синглтон)
	 * 
	 * При первом вызове создает экземпляр, при последующих возвращает существующий.
	 * Если передан context и путь к расширению еще не установлен, обновляет его.
	 * 
 * @param context - Контекст расширения VS Code (опционально, используется для установки пути к расширению)
 * @returns Экземпляр VRunnerManager
 */
	public static getInstance(context?: vscode.ExtensionContext): VRunnerManager {
		if (!VRunnerManager.instance) {
			VRunnerManager.instance = new VRunnerManager(context);
		} else if (context && !VRunnerManager.instance.extensionPath) {
			VRunnerManager.instance.extensionPath = context.extensionPath;
		}
		return VRunnerManager.instance;
	}

	/**
	 * Получает путь к vrunner
	 * 
	 * Ищет vrunner.bat в oscript_modules/bin/ в workspace.
	 * Если не найден, возвращает 'vrunner' для поиска в PATH.
	 * 
	 * @returns Относительный путь к vrunner.bat (например, 'oscript_modules/bin/vrunner.bat')
	 *          или 'vrunner' для поиска в PATH
	 */
	public getVRunnerPath(): string {
		if (this.workspaceRoot) {
			const vrunnerPath = path.join(this.workspaceRoot, 'oscript_modules', 'bin', 'vrunner.bat');
			if (fsSync.existsSync(vrunnerPath)) {
				return path.join('oscript_modules', 'bin', 'vrunner.bat');
			}
		}
		
		return 'vrunner';
	}

	/**
	 * Получает путь к файлу настроек инициализации vrunner
	 * 
	 * Путь берется из настроек VS Code (1c-platform-tools.vrunner.initSettingsPath).
	 * По умолчанию: './tools/vrunner.init.json'
	 * 
	 * @returns Путь к файлу настроек инициализации (относительно workspace)
	 */
	public getVRunnerInitSettingsPath(): string {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<string>('vrunner.initSettingsPath', './tools/vrunner.init.json');
	}

	/**
	 * Получает путь к opm (OneScript Package Manager)
	 *
	 * @returns Имя команды для поиска в PATH
	 */
	private getOpmPath(): string {
		return 'opm';
	}

	/**
	 * Получает путь к allure
	 * 
	 * Путь берется из настроек VS Code (1c-platform-tools.allure.path).
	 * По умолчанию: 'allure'
	 * 
	 * @returns Путь к allure (для поиска в PATH или абсолютный путь)
	 */
	public getAllurePath(): string {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<string>('allure.path', 'allure');
	}

	/**
	 * Получает путь к исходному коду конфигурации
	 * 
	 * Путь берется из настроек VS Code (1c-platform-tools.paths.cf).
	 * По умолчанию: 'src/cf'
	 * 
	 * @returns Путь к исходному коду конфигурации (относительно workspace)
	 */
	public getCfPath(): string {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<string>('paths.cf', 'src/cf');
	}

	/**
	 * Получает путь к результатам сборки
	 * 
	 * Путь берется из настроек VS Code (1c-platform-tools.paths.out).
	 * По умолчанию: 'build/out'
	 * 
	 * @returns Путь к результатам сборки (относительно workspace)
	 */
	public getOutPath(): string {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<string>('paths.out', 'build/out');
	}

	/**
	 * Получает путь к каталогу хранения шаблонов (cf, cfu, настройки объединения и т.д.)
	 *
	 * Путь берётся из настроек VS Code (1c-platform-tools.paths.dist).
	 * По умолчанию: 'build/dist'
	 *
	 * @returns Путь к каталогу шаблонов (относительно workspace)
	 */
	public getDistPath(): string {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<string>('paths.dist', 'build/dist');
	}

	/**
	 * Получает путь к исходникам внешних обработок
	 * 
	 * Путь берется из настроек VS Code (1c-platform-tools.paths.epf).
	 * По умолчанию: 'src/epf'
	 * 
	 * @returns Путь к исходникам внешних обработок (относительно workspace)
	 */
	public getEpfPath(): string {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<string>('paths.epf', 'src/epf');
	}

	/**
	 * Получает путь к исходникам внешних отчетов
	 * 
	 * Путь берется из настроек VS Code (1c-platform-tools.paths.erf).
	 * По умолчанию: 'src/erf'
	 * 
	 * @returns Путь к исходникам внешних отчетов (относительно workspace)
	 */
	public getErfPath(): string {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<string>('paths.erf', 'src/erf');
	}

	/**
	 * Получает путь к исходникам расширений
	 * 
	 * Путь берется из настроек VS Code (1c-platform-tools.paths.cfe).
	 * По умолчанию: 'src/cfe'
	 * 
	 * @returns Путь к исходникам расширений (относительно workspace)
	 */
	public getCfePath(): string {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<string>('paths.cfe', 'src/cfe');
	}

	/**
	 * Проверяет, нужно ли использовать ibcmd
	 * 
	 * Логика определения:
	 * 1. Если настройка useIbcmd = true, всегда использовать ibcmd
	 * 2. Если используется Docker (docker.enabled = true), автоматически использовать ibcmd
	 *    (так как в Docker нет GUI, ibcmd - это правильный выбор)
	 * 3. Иначе - не использовать ibcmd
	 * 
	 * ibcmd - это утилита командной строки платформы 1С:Предприятие,
	 * которая позволяет выполнять операции с конфигурацией без запуска
	 * графического интерфейса Конфигуратора. Использование ibcmd ускоряет
	 * выполнение операций и удобно для автоматизации процессов разработки.
	 * 
	 * @returns true, если нужно использовать ibcmd, иначе false
	 */
	public getUseIbcmd(): boolean {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const useIbcmdSetting = config.get<boolean>('useIbcmd', false);
		
		if (useIbcmdSetting) {
			return true;
		}
		
		const dockerEnabled = config.get<boolean>('docker.enabled', false);
		if (dockerEnabled) {
			return true;
		}
		
		return false;
	}

	/**
	 * Проверяет, доступны ли oscript и opm (по настройкам путей или PATH).
	 *
	 * @returns Промис, который разрешается true, если обе утилиты доступны, иначе false
	 */
	public async checkOscriptAvailable(): Promise<boolean> {
		return this.runCommandForCheck(this.getOnescriptPath(), ['-version']);
	}

	/**
	 * Проверяет, доступен ли opm (по настройкам путей или PATH).
	 *
	 * @returns Промис, который разрешается true, если opm доступен, иначе false
	 */
	public async checkOpmAvailable(): Promise<boolean> {
		return this.runCommandForCheck(this.getOpmPath(), ['--version']);
	}

	/**
	 * Выполняет команду для проверки доступности (exit code 0 = успех).
	 *
	 * @param commandPath - Путь к исполняемому файлу (или имя для поиска в PATH)
	 * @param args - Аргументы команды
	 * @returns Промис, который разрешается true при exit code 0
	 */
	private runCommandForCheck(commandPath: string, args: string[]): Promise<boolean> {
		return new Promise((resolve) => {
			const quotedPath = commandPath.includes(' ') ? `"${commandPath}"` : commandPath;
			const command = `${quotedPath} ${escapeCommandArgs(args)}`;
			exec(command, { maxBuffer: 1024 * 1024, timeout: 10000 }, (error) => {
				resolve(!error);
			});
		});
	}

	/**
	 * Проверяет, установлен ли vrunner и доступен ли он для выполнения
	 * 
	 * Выполняет команду `vrunner version` для проверки доступности.
	 * 
	 * @returns Промис, который разрешается true, если vrunner установлен и доступен, иначе false
	 */
	public async checkVRunnerInstalled(): Promise<boolean> {
		try {
			const result = await this.executeVRunner(['version']);
			return result.success && result.exitCode === 0;
		} catch {
			return false;
		}
	}

	/**
	 * Проверяет, доступен ли Docker для выполнения команд
	 * 
	 * Выполняет команду `docker --version` для проверки доступности Docker.
	 * 
	 * @returns Промис, который разрешается true, если Docker доступен, иначе false
	 */
	public async checkDockerAvailable(): Promise<boolean> {
		return new Promise((resolve) => {
			exec('docker --version', { maxBuffer: 1024 * 1024 }, (error) => {
				resolve(!error);
			});
		});
	}

	/**
	 * Проверяет, нужно ли использовать Docker для выполнения команд
	 * 
	 * Docker используется только если пользователь явно включил настройку `docker.enabled = true`.
	 * Автоматическое определение отключено - пользователь должен сам решить, использовать Docker или нет.
	 * 
	 * @returns Промис, который разрешается `true`, если нужно использовать Docker, иначе `false`
	 */
	public async shouldUseDocker(): Promise<boolean> {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const dockerEnabled = config.get<boolean>('docker.enabled', false);
		
		return dockerEnabled;
	}

	/**
	 * Проверяет, поддерживает ли команда vrunner параметр --ibcmd
	 * 
	 * Команды, которые поддерживают --ibcmd:
	 * - Операции с информационными базами: init-dev, update-dev, updatedb, dump, restore, dump-dt, load-dt
	 * - Операции с конфигурацией: load, dump, dumpcf, compile, decompile
	 * - Операции с расширениями: compileext, decompileext, unloadext, compileexttocfe
	 * - Операции с внешними файлами: compileepf, decompileepf
	 * 
	 * Команды, которые НЕ поддерживают --ibcmd:
	 * - run, designer (запуск GUI приложений)
	 * - xunit, syntax-check, vanessa (тесты)
	 * 
	 * @param args - Аргументы команды vrunner (первый аргумент - имя команды)
	 * @returns true, если команда поддерживает --ibcmd, иначе false
	 */
	public supportsIbcmd(args: string[]): boolean {
		if (args.length === 0) {
			return false;
		}

		const command = args[0];
		
		// Команды, которые поддерживают --ibcmd
		const ibcmdSupportedCommands = [
			// Информационные базы
			'init-dev',
			'update-dev',
			'updatedb',
			'dump',
			'restore',

			// Конфигурация
			'load',       
			'unload',     
			'compile',    
			'decompile',  

			// Расширения
			'compileext',      
			'decompileext',    
			'unloadext',       
			'compileexttocfe'  
		];

		return ibcmdSupportedCommands.includes(command);
	}

	/**
	 * Получает Docker-образ из настроек VS Code
	 * 
	 * Настройка берется из `1c-platform-tools.docker.image`.
	 * Образ должен содержать установленную платформу 1С:Предприятие и vanessa-runner.
	 * 
	 * @returns Docker-образ для выполнения команд
	 * @throws {Error} Если образ не указан в настройках (пустая строка)
	 */
	public getDockerImage(): string {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const image = config.get<string>('docker.image', '');
		
		if (!image) {
			throw new Error(
				'Docker-образ не указан в настройках. Укажите образ в настройках расширения ' +
				'(1c-platform-tools.docker.image). Пример: "myregistry/onec-image:8.3.25" или ' +
				'"localhost/onec-image:latest". Образ должен содержать установленную платформу 1С:Предприятие и vanessa-runner.'
			);
		}
		
		return image;
	}

	/**
	 * Нормализует аргументы команды для работы в Docker-контейнере
	 * 
	 * Преобразует пути к информационной базе и другим файлам в формат, понятный внутри контейнера.
	 * Выполняет следующие преобразования:
	 * - Пути в формате 1С `/F./path` не изменяются (`.` уже указывает на `/workspace` внутри контейнера)
	 * - Абсолютные пути workspace преобразуются в относительные от рабочей директории (например, `./build/ib`)
	 * - Параметры команд (например, `--ibconnection`) остаются без изменений
	 * 
	 * @param args - Массив аргументов команды
	 * @returns Массив нормализованных аргументов для Docker
	 */
	public processCommandArgsForDocker(args: string[]): string[] {
		if (!this.workspaceRoot) {
			return args;
		}
		
		const workspaceRoot = this.workspaceRoot;
		
		return args.map((arg, index) => {
			if (arg === '--ibconnection' && index + 1 < args.length) {
				return arg;
			}
			
			if (index > 0 && args[index - 1] === '--ibconnection') {
				return normalizeIbPathForDocker(arg, workspaceRoot);
			}
			
			if (path.isAbsolute(arg) && arg.startsWith(workspaceRoot)) {
				const relativePath = path.relative(workspaceRoot, arg);
				const unixPath = relativePath.replaceAll('\\', '/');
				return `./${unixPath}`;
			}
			
			return arg;
		});
	}

	/**
	 * Обрабатывает аргументы команды: преобразует абсолютные пути в относительные
	 * и нормализует пути для указанной оболочки
	 * 
	 * Выполняет следующие преобразования:
	 * 1. Преобразует абсолютные пути внутри workspace в относительные
	 * 2. Нормализует пути для bash оболочек на Windows (обратные слэши → прямые)
	 * 3. Сохраняет параметры команд без изменений
	 * 
	 * @param args - Массив аргументов команды
	 * @param cwd - Текущая рабочая директория для вычисления относительных путей
	 * @param shellType - Тип оболочки терминала
	 * @returns Массив обработанных аргументов с нормализованными путями
	 */
	private processCommandArgs(args: string[], cwd: string, shellType: ShellType): string[] {
		return args.map((arg) => {
			// Преобразуем абсолютные пути в относительные, если они внутри workspace
			if (this.workspaceRoot && path.isAbsolute(arg)) {
				if (fsSync.existsSync(arg) && arg.startsWith(this.workspaceRoot)) {
					let relativeArg = path.relative(cwd, arg);
					// Нормализуем путь для bash оболочек на Windows
					relativeArg = normalizeArgForShell(relativeArg, shellType);
					if (!relativeArg.startsWith('..')) {
						return relativeArg;
					}
				}
			}
			// Нормализуем аргумент для указанной оболочки
			return normalizeArgForShell(arg, shellType);
		});
	}

	/**
	 * Выполняет скрипт OneScript в терминале VS Code
	 * 
	 * Загружает скрипт из папки scripts расширения и выполняет его через OneScript.
	 * Автоматически нормализует пути для указанной оболочки.
	 * 
	 * @param scriptName - Имя скрипта в папке scripts расширения (например, 'myscript.os')
	 * @param args - Аргументы команды для передачи в скрипт
	 * @param options - Опции выполнения
	 * @param options.cwd - Рабочая директория (по умолчанию workspace root)
	 * @param options.env - Дополнительные переменные окружения
	 * @param options.name - Имя терминала (по умолчанию '1C: Platform Tools')
	 * @param options.shellType - Тип оболочки (опционально, определяется автоматически)
	 * @throws {Error} Если путь к расширению не установлен (расширение не активировано)
	 */
	public executeOneScriptInTerminal(
		scriptName: string,
		args: string[],
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; shellType?: ShellType }
	): void {
		if (!this.extensionPath) {
			throw new Error('Путь к расширению не установлен. Убедитесь, что расширение активировано.');
		}

		const cwd = options?.cwd || this.workspaceRoot || process.cwd();
		const shellType = options?.shellType || detectShellType();
		const scriptPath = path.join(this.extensionPath, 'scripts', scriptName);
		const onescriptPath = this.getOnescriptPath();
		
		const processedArgs = this.processCommandArgs(args, cwd, shellType);
		const normalizedScriptPath = normalizeArgForShell(scriptPath, shellType);
		const fullArgs = [normalizedScriptPath, ...processedArgs];
		const command = buildCommand(onescriptPath, fullArgs, shellType);

		const terminal = vscode.window.createTerminal({
			name: options?.name || '1C: Platform Tools',
			cwd: cwd,
			env: options?.env ? { ...process.env, ...options.env } : undefined
		});

		terminal.sendText(command);
		terminal.show();
	}

	/**
	 * Получает путь к OneScript
	 *
	 * @returns Имя команды для поиска в PATH
	 */
	private getOnescriptPath(): string {
		return 'oscript';
	}

	/**
	 * Выполняет команду vrunner в терминале VS Code
	 * 
	 * Создает новый терминал или использует существующий, отправляет команду
	 * и показывает терминал пользователю. Автоматически обрабатывает пути
	 * и нормализует их для указанной оболочки. Поддерживает выполнение через Docker,
	 * если включена настройка `docker.enabled = true`.
	 * 
	 * При использовании Docker:
	 * - Workspace монтируется в `/workspace` внутри контейнера
	 * - Пути автоматически нормализуются для Docker-окружения
	 * - Параметр `--ibcmd` используется автоматически (так как в Docker нет GUI)
	 * 
	 * @param args - Аргументы команды vrunner (например, ['init-dev', '--ibconnection', '/F./build/ib'])
	 * @param options - Опции выполнения
	 * @param options.cwd - Рабочая директория (по умолчанию workspace root)
	 * @param options.env - Дополнительные переменные окружения
	 * @param options.name - Имя терминала (по умолчанию '1C: Platform Tools')
	 * @param options.shellType - Тип оболочки (опционально, определяется автоматически)
	 */
	public async executeVRunnerInTerminal(
		args: string[],
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; shellType?: ShellType }
	): Promise<void> {
		const cwd = options?.cwd || this.workspaceRoot || os.homedir();
		const shellType = options?.shellType || detectShellType();
		
		const useDocker = await this.shouldUseDocker();
		
		let command: string;
		
		if (useDocker) {
			if (!this.workspaceRoot) {
				logger.error('Для использования Docker необходимо открыть рабочую область');
				vscode.window.showErrorMessage('Для использования Docker необходимо открыть рабочую область');
				return;
			}

			// Проверяем, поддерживает ли команда --ibcmd
			if (!this.supportsIbcmd(args)) {
				const commandName = args[0] || 'команда';
				logger.warn(`Команда "${commandName}" не поддерживает --ibcmd, необходимый для Docker`);
				const action = await vscode.window.showWarningMessage(
					`Команда "${commandName}" не поддерживает параметр --ibcmd, который необходим для работы в Docker. ` +
					'Эта команда может не работать корректно в Docker-контейнере без графического интерфейса. ' +
					'Продолжить выполнение?',
					'Да',
					'Нет'
				);
				
				if (action !== 'Да') {
					return;
				}
			}
			
			try {
				const dockerImage = this.getDockerImage();
				const processedArgs = this.processCommandArgsForDocker(args);
				command = buildDockerCommand(dockerImage, processedArgs, this.workspaceRoot, shellType);
				logger.debug(`VRunner в Docker: образ=${dockerImage}, args=${processedArgs.join(' ')}`);
			} catch (error) {
				const errMsg = (error as Error).message;
				logger.error(`Ошибка при подготовке команды Docker: ${errMsg}`);
				vscode.window.showErrorMessage(errMsg);
				return;
			}
		} else {
			const vrunnerPath = this.getVRunnerPath();
			const processedArgs = this.processCommandArgs(args, cwd, shellType);
			command = buildCommand(vrunnerPath, processedArgs, shellType);
		}

		const terminal = vscode.window.createTerminal({
			name: options?.name || '1C: Platform Tools',
			cwd: cwd,
			env: options?.env ? { ...process.env, ...options.env } : undefined
		});

		terminal.sendText(command);
		terminal.show();
	}

	/**
	 * Выполняет несколько команд vrunner последовательно в одном терминале (без Docker)
	 * или в отдельных терминалах (при использовании Docker).
	 * Используется, когда после основной операции нужно выполнить updatedb и т.п.
	 *
	 * @param argsArray - Массив наборов аргументов (каждый набор — одна команда vrunner)
	 * @param options - Опции выполнения (cwd, name, shellType)
	 */
	public async executeVRunnerCommandsInSequence(
		argsArray: string[][],
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; shellType?: ShellType }
	): Promise<void> {
		if (argsArray.length === 0) {
			return;
		}
		if (argsArray.length === 1) {
			await this.executeVRunnerInTerminal(argsArray[0], options);
			return;
		}

		const cwd = options?.cwd || this.workspaceRoot || os.homedir();
		const shellType = options?.shellType || detectShellType();
		const useDocker = await this.shouldUseDocker();
		let command: string;

		if (useDocker) {
			if (!this.workspaceRoot) {
				logger.error('Для использования Docker необходимо открыть рабочую область');
				vscode.window.showErrorMessage('Для использования Docker необходимо открыть рабочую область');
				return;
			}
			if (!this.supportsIbcmd(argsArray[0])) {
				const commandName = argsArray[0][0] || 'команда';
				logger.warn(`Команда "${commandName}" не поддерживает --ibcmd, необходимый для Docker`);
				const action = await vscode.window.showWarningMessage(
					`Команда "${commandName}" не поддерживает параметр --ibcmd, который необходим для работы в Docker. ` +
					'Продолжить выполнение?',
					'Да',
					'Нет'
				);
				if (action !== 'Да') {
					return;
				}
			}
			try {
				const dockerImage = this.getDockerImage();
				const processedArgsArray = argsArray.map((args) => this.processCommandArgsForDocker(args));
				command = buildDockerCommandSequence(dockerImage, processedArgsArray, this.workspaceRoot, shellType);
				logger.debug(`VRunner в Docker (последовательно): образ=${dockerImage}, команд=${processedArgsArray.length}`);
			} catch (error) {
				const errMsg = (error as Error).message;
				logger.error(`Ошибка при подготовке команды Docker: ${errMsg}`);
				vscode.window.showErrorMessage(errMsg);
				return;
			}
			const terminal = vscode.window.createTerminal({
				name: options?.name || '1C: Platform Tools',
				cwd: cwd,
				env: options?.env ? { ...process.env, ...options.env } : undefined
			});
			terminal.sendText(command);
			terminal.show();
			return;
		}

		const vrunnerPath = this.getVRunnerPath();
		const commands = argsArray.map((args) => {
			const processedArgs = this.processCommandArgs(args, cwd, shellType);
			return buildCommand(vrunnerPath, processedArgs, shellType);
		});
		const fullCommand = joinCommands(commands, shellType);

		const terminal = vscode.window.createTerminal({
			name: options?.name || '1C: Platform Tools',
			cwd: cwd,
			env: options?.env ? { ...process.env, ...options.env } : undefined
		});
		terminal.sendText(fullCommand);
		terminal.show();
	}

	/**
	 * Выполняет команду vrunner синхронно (для проверок)
	 * 
	 * Используется для проверок и валидации, а не для выполнения команд пользователю.
	 * Для выполнения команд пользователю используйте `executeVRunnerInTerminal()`.
	 * 
	 * Поддерживает выполнение через Docker, если включена настройка `docker.enabled = true`.
	 * При использовании Docker пути автоматически нормализуются для Docker-окружения.
	 * 
	 * @param args - Аргументы команды vrunner
	 * @param options - Опции выполнения
	 * @param options.cwd - Рабочая директория (по умолчанию workspace root)
	 * @param options.env - Дополнительные переменные окружения
	 * @returns Промис, который разрешается результатом выполнения команды
	 */
	public async executeVRunner(
		args: string[],
		options?: { cwd?: string; env?: NodeJS.ProcessEnv }
	): Promise<VRunnerExecutionResult> {
		const useDocker = await this.shouldUseDocker();
		const cwd = options?.cwd || this.workspaceRoot;
		
		return new Promise((resolve) => {
			let command: string;
			
			if (useDocker) {
				if (!this.workspaceRoot) {
					resolve({
						success: false,
						stdout: '',
						stderr: 'Для использования Docker необходимо открыть рабочую область',
						exitCode: 1
					});
					return;
				}
				
				try {
					const dockerImage = this.getDockerImage();
					const processedArgs = this.processCommandArgsForDocker(args);
					const shellType = detectShellType();
					command = buildDockerCommand(dockerImage, processedArgs, this.workspaceRoot, shellType);
				} catch (error) {
					resolve({
						success: false,
						stdout: '',
						stderr: (error as Error).message,
						exitCode: 1
					});
					return;
				}
			} else {
				const vrunnerPath = this.getVRunnerPath();
				const argsString = escapeCommandArgs(args);
				const quotedPath = vrunnerPath.includes(' ') ? `"${vrunnerPath}"` : vrunnerPath;
				command = `${quotedPath} ${argsString}`;
			}

			const execOptions = {
				cwd: cwd,
				env: { ...process.env, ...options?.env },
				maxBuffer: MAX_EXEC_BUFFER_SIZE,
				encoding: 'utf8' as BufferEncoding
			};

			exec(command, execOptions, (error, stdout, stderr) => {
				const result: VRunnerExecutionResult = {
					success: !error,
					stdout: stdout.toString(),
					stderr: stderr.toString(),
					exitCode: error ? (error.code || 1) : 0
				};

				resolve(result);
			});
		});
	}

	/**
	 * Выполняет команду opm в терминале VS Code
	 * 
	 * Создает терминал и выполняет команду opm (OneScript Package Manager).
	 * Используется для установки и управления зависимостями проекта.
	 * 
	 * @param args - Аргументы команды opm (например, ['install', '-l'])
	 * @param options - Опции выполнения
	 * @param options.cwd - Рабочая директория (по умолчанию workspace root)
	 * @param options.name - Имя терминала (по умолчанию '1C: Platform Tools')
	 * @param options.shellType - Тип оболочки (опционально, определяется автоматически)
	 */
	public executeOpmInTerminal(
		args: string[],
		options?: { cwd?: string; name?: string; shellType?: ShellType }
	): void {
		const opmPath = this.getOpmPath();
		const shellType = options?.shellType || detectShellType();
		const cwd = options?.cwd || this.workspaceRoot || os.homedir();
		const processedArgs = this.processCommandArgs(args, cwd, shellType);
		const command = buildCommand(opmPath, processedArgs, shellType);

		const terminal = vscode.window.createTerminal({
			name: options?.name || '1C: Platform Tools',
			cwd: cwd
		});

		terminal.sendText(command);
		terminal.show();
	}

	/**
	 * Выполняет команду opm синхронно (для проверок)
	 * 
	 * Используется для проверок и валидации, а не для выполнения команд пользователю.
	 * Для выполнения команд пользователю используйте executeOpmInTerminal().
	 * 
	 * @param args - Аргументы команды opm
	 * @param options - Опции выполнения
	 * @param options.cwd - Рабочая директория (по умолчанию workspace root)
	 * @returns Промис, который разрешается результатом выполнения команды
	 */
	public async executeOpm(
		args: string[],
		options?: { cwd?: string }
	): Promise<VRunnerExecutionResult> {
		return new Promise((resolve) => {
			const opmPath = this.getOpmPath();
			const argsString = escapeCommandArgs(args);
			const quotedPath = opmPath.includes(' ') ? `"${opmPath}"` : opmPath;
			const command = `${quotedPath} ${argsString}`;

			const execOptions = {
				cwd: options?.cwd || this.workspaceRoot,
				maxBuffer: MAX_EXEC_BUFFER_SIZE,
				encoding: 'utf8' as BufferEncoding
			};

			exec(command, execOptions, (error, stdout, stderr) => {
				const result: VRunnerExecutionResult = {
					success: !error,
					stdout: stdout.toString(),
					stderr: stderr.toString(),
					exitCode: error ? (error.code || 1) : 0
				};

				resolve(result);
			});
		});
	}

	/**
	 * Выполняет команду allure в терминале VS Code
	 * 
	 * Создает терминал и выполняет команду allure для генерации и просмотра отчетов.
	 * Автоматически обрабатывает пути и нормализует их для указанной оболочки.
	 * 
	 * @param args - Аргументы команды allure (например, ['generate', '-c', '-o', 'build/allure-report'])
	 * @param options - Опции выполнения
	 * @param options.cwd - Рабочая директория (по умолчанию workspace root)
	 * @param options.name - Имя терминала (по умолчанию '1C: Platform Tools')
	 * @param options.shellType - Тип оболочки (опционально, определяется автоматически)
	 */
	public executeAllureInTerminal(
		args: string[],
		options?: { cwd?: string; name?: string; shellType?: ShellType }
	): void {
		const allurePath = this.getAllurePath();
		const shellType = options?.shellType || detectShellType();
		const processedArgs = this.processCommandArgs(args, options?.cwd || this.workspaceRoot || os.homedir(), shellType);
		const command = buildCommand(allurePath, processedArgs, shellType);
		const cwd = options?.cwd || this.workspaceRoot || os.homedir();

		const terminal = vscode.window.createTerminal({
			name: options?.name || '1C: Platform Tools',
			cwd: cwd
		});

		terminal.sendText(command);
		terminal.show();
	}

	/**
	 * Выполняет команду allure синхронно (для проверок)
	 * 
	 * Используется для проверок и валидации, а не для выполнения команд пользователю.
	 * Для выполнения команд пользователю используйте executeAllureInTerminal().
	 * 
	 * @param args - Аргументы команды allure
	 * @param options - Опции выполнения
	 * @param options.cwd - Рабочая директория (по умолчанию workspace root)
	 * @returns Промис, который разрешается результатом выполнения команды
	 */
	public async executeAllure(
		args: string[],
		options?: { cwd?: string }
	): Promise<VRunnerExecutionResult> {
		return new Promise((resolve) => {
			const allurePath = this.getAllurePath();
			const argsString = escapeCommandArgs(args);
			const quotedPath = allurePath.includes(' ') ? `"${allurePath}"` : allurePath;
			const command = `${quotedPath} ${argsString}`;

			const execOptions = {
				cwd: options?.cwd || this.workspaceRoot,
				maxBuffer: MAX_EXEC_BUFFER_SIZE,
				encoding: 'utf8' as BufferEncoding
			};

			exec(command, execOptions, (error, stdout, stderr) => {
				const result: VRunnerExecutionResult = {
					success: !error,
					stdout: stdout.toString(),
					stderr: stderr.toString(),
					exitCode: error ? (error.code || 1) : 0
				};

				resolve(result);
			});
		});
	}

	/**
	 * Читает и парсит env.json из корня workspace
	 * 
	 * Файл env.json используется для хранения параметров подключения к ИБ
	 * и других настроек проекта.
	 * 
	 * @returns Промис, который разрешается содержимым env.json или пустым объектом при ошибке
	 * @throws {Error} Если рабочая область не открыта
	 */
	public async readEnvJson(): Promise<any> {
		if (!this.workspaceRoot) {
			throw new Error('Рабочая область не открыта');
		}

		const envPath = path.join(this.workspaceRoot, 'env.json');
		try {
			const content = await fs.readFile(envPath, 'utf8');
			return JSON.parse(content);
		} catch {
			return {};
		}
	}

	/**
	 * Записывает данные в файл env.json в корне workspace
	 * 
	 * Данные записываются в формате JSON с отступами (2 пробела).
	 * Существующий файл будет перезаписан.
	 * 
	 * @param data - Данные для записи (объект, который будет сериализован в JSON)
	 * @returns Промис, который разрешается после записи файла
	 * @throws {Error} Если рабочая область не открыта
	 */
	public async writeEnvJson(data: any): Promise<void> {
		if (!this.workspaceRoot) {
			throw new Error('Рабочая область не открыта');
		}

		const envPath = path.join(this.workspaceRoot, 'env.json');
		const content = JSON.stringify(data, null, 2);
		await fs.writeFile(envPath, content, 'utf8');
	}

	/**
	 * Получает параметр --settings для команды vrunner
	 * 
	 * Используется для указания файла настроек при выполнении команд vrunner.
	 * 
	 * @param settingsFile - Путь к файлу настроек (относительно workspace). По умолчанию 'env.json'
	 * @returns Массив параметров ['--settings', 'путь_к_файлу']
	 */
	public getSettingsParam(settingsFile: string = 'env.json'): string[] {
		return ['--settings', settingsFile];
	}

	/**
	 * Получает параметр --ibconnection для команды vrunner
	 * 
	 * Порядок определения значения:
	 * 1. Если передан ibConnection, используется он
	 * 2. Ищет в env.json в секции default['--ibconnection']
	 * 3. Использует значение по умолчанию '/F./build/ib'
	 * 
	 * @param ibConnection - Строка подключения к ИБ. Если указана, используется напрямую
	 * @param settingsFile - Путь к файлу настроек (относительно workspace). По умолчанию 'env.json'
	 * @returns Промис, который разрешается массивом параметров ['--ibconnection', 'строка_подключения']
	 */
	public async getIbConnectionParam(ibConnection?: string, settingsFile: string = 'env.json'): Promise<string[]> {
		if (ibConnection) {
			return ['--ibconnection', ibConnection];
		}

		if (this.workspaceRoot) {
			const absoluteSettingsPath = path.isAbsolute(settingsFile)
				? settingsFile
				: path.join(this.workspaceRoot, settingsFile);

			try {
				const content = await fs.readFile(absoluteSettingsPath, 'utf8');
				const env = JSON.parse(content);
				
				if (env.default && typeof env.default['--ibconnection'] === 'string') {
					return ['--ibconnection', env.default['--ibconnection']];
				}
			} catch {
			}
		}

		return ['--ibconnection', '/F./build/ib'];
	}

	/**
	 * Получает путь к корню workspace
	 * 
	 * @returns Путь к workspace или undefined, если workspace не открыт
	 */
	public getWorkspaceRoot(): string | undefined {
		return this.workspaceRoot;
	}

	/**
	 * Получает путь к директории расширения
	 * 
	 * Используется для доступа к ресурсам расширения (скрипты, шаблоны, иконки).
	 * 
	 * @returns Путь к расширению или undefined, если расширение не активировано
	 */
	public getExtensionPath(): string | undefined {
		return this.extensionPath;
	}
}
