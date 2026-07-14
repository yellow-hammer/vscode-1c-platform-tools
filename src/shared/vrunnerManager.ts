import * as vscode from 'vscode';
import { exec } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import {
	escapeCommandArgs,
	buildCommand,
	joinCommands,
	detectShellType,
	ShellType,
	normalizeArgForShell,
	buildDockerCommand,
	buildDockerCommandSequence,
	normalizeIbPathForDocker,
} from '../utils/commandUtils';
import { logger } from './logger';
import { runCancellableCommand, CancellableProcessResult } from './cancellableProcess';
import { DEFAULT_PATHS, DEFAULT_VRUNNER, DEFAULT_ENV } from './pathDefaults';
import { getOvmBinaryPath, getOvmBinDir, getOvmRootDir, getOpmBinaryCandidates, getOpmScriptPath } from './ovmPaths';
import {
	ACTIVE_ENV_PROFILE_KEY,
	ACTIVE_ENV_OVERRIDES_KEY,
	BASE_ENV_FILE,
	SettingsSchema,
	baseSettingsFileName,
	DEFAULT_PROFILE_ID,
	EnvProfile,
	EnvOverrides,
	buildEnvProfiles,
	buildOverrideArgs,
	hasOverrides,
	resolveActiveEnvFileName,
} from './envProfiles';
import {
	VRunnerVersion,
	VRunnerFeature,
	parseVRunnerVersion,
	parseVRunnerVersionFromOpmMetadata,
	supportsFeature,
	isAtLeast,
	VRUNNER_FEATURES,
} from './vrunnerVersion';
import { selectCliAdapter, VRunnerIntent } from './vrunnerCli';
import { translateArgsToV3 } from './vrunnerCommandMap';
import { createVRunnerTask } from '../features/tasks/vrunnerTask';

/**
 * Имя оболочки, через которую исполняется команда задачи (`spawn` с shell: true):
 * на Windows это cmd.exe, на остальных ОС — /bin/sh. Используется для корректного
 * экранирования и склейки команд в задачах, в отличие от интегрированного терминала.
 */
const TASK_HOST_SHELL: ShellType = process.platform === 'win32' ? 'cmd' : 'sh';

const log = logger.scope('vrunner');

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
	private memento: vscode.Memento | undefined;
	/**
	 * Кэш определённой версии vrunner.
	 * undefined — ещё не определяли; null — определить не удалось.
	 */
	private vrunnerVersionCache: VRunnerVersion | null | undefined = undefined;
	/**
	 * Разрешённый путь к oscript: имя для PATH, абсолютный путь установки OVM или
	 * undefined, пока проверка не выполнялась. Обновляется в checkOscriptAvailable
	 * и используется синхронными getOnescriptPath/исполнением.
	 */
	private resolvedOscriptPath: string | undefined = undefined;
	/**
	 * Разрешённый способ запуска opm: путь к запускаемому файлу и ведущие
	 * аргументы. Для обёртки из PATH/bin аргументы пусты; если обёртки нет,
	 * opm запускается через oscript со скриптом opm.os из установки OneScript.
	 */
	private resolvedOpm: { path: string; leadingArgs: string[] } | undefined = undefined;

	/** Событие смены активного env-профиля (id в workspaceState) */
	private readonly _onDidChangeActiveEnvProfile = new vscode.EventEmitter<void>();
	/** Срабатывает при выборе другого env-профиля запуска */
	public readonly onDidChangeActiveEnvProfile = this._onDidChangeActiveEnvProfile.event;

	/** Событие смены определённой версии vrunner (после переустановки/обновления) */
	private readonly _onDidChangeVRunnerVersion = new vscode.EventEmitter<VRunnerVersion | undefined>();
	/** Срабатывает, когда повторный детект версии vrunner дал другой результат */
	public readonly onDidChangeVRunnerVersion = this._onDidChangeVRunnerVersion.event;

	private constructor(context?: vscode.ExtensionContext) {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			this.workspaceRoot = workspaceFolders[0].uri.fsPath;
		}
		if (context) {
			this.extensionPath = context.extensionPath;
			this.memento = context.workspaceState;
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
		} else if (context) {
			if (!VRunnerManager.instance.extensionPath) {
				VRunnerManager.instance.extensionPath = context.extensionPath;
			}
			if (!VRunnerManager.instance.memento) {
				VRunnerManager.instance.memento = context.workspaceState;
			}
		}
		return VRunnerManager.instance;
	}

	/**
	 * Возвращает локальное workspace-хранилище состояния (не коммитится).
	 *
	 * @returns workspaceState или undefined вне контекста VS Code
	 */
	public getWorkspaceMemento(): vscode.Memento | undefined {
		return this.memento;
	}

	/**
	 * Получает путь к vrunner
	 *
	 * Ищет локальный бинарь в oscript_modules/bin/ в workspace: на Windows —
	 * `vrunner.bat`, на остальных ОС — `vrunner`. Если не найден, возвращает
	 * 'vrunner' для поиска в PATH.
	 *
	 * @returns Относительный путь к локальному бинарю vrunner
	 *          или 'vrunner' для поиска в PATH
	 */
	public getVRunnerPath(): string {
		// Имя локального бинаря зависит от ОС: на Windows — vrunner.bat, иначе vrunner.
		const binaryName = process.platform === 'win32' ? 'vrunner.bat' : 'vrunner';
		if (this.workspaceRoot) {
			const vrunnerPath = path.join(this.workspaceRoot, 'oscript_modules', 'bin', binaryName);
			if (fsSync.existsSync(vrunnerPath)) {
				return path.join('oscript_modules', 'bin', binaryName);
			}
		}

		return 'vrunner';
	}

	/**
	 * Получает путь к файлу настроек инициализации vrunner
	 *
	 * Путь берется из настроек VS Code (1c-platform-tools.vrunner.initSettingsPath).
	 * По умолчанию: 'tools/vrunner.init.json'
	 *
	 * ВАЖНО: использовать только для команды инициализации ИБ данными
	 * («Инициализировать данные»). Для остальных команд (тесты, запуск feature)
	 * применяются батч-настройки из env.json — см. getSettingsParam().
	 *
	 * @returns Путь к файлу настроек инициализации (относительно workspace)
	 */
	public getVRunnerInitSettingsPath(): string {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<string>('vrunner.initSettingsPath', DEFAULT_VRUNNER.initSettingsPath);
	}

	/**
	 * Путь к файлу сценария Vanessa для инициализации данных (VAParams).
	 *
	 * Значение читается из vanessasettings файла инициализации (vrunner.init.json),
	 * чтобы уважать конвенцию проекта и jenkins-lib; при отсутствии — дефолт
	 * `tools/VAParams.init.json`. Подставляется как `--vanessasettings` поверх
	 * активного профиля: ИБ и путь к VA берутся из профиля, отличается только
	 * сценарий. Так инициализация работает и на v2, и на v3 (файл init формата
	 * 2.x как `--settings` на v3 не передаётся).
	 *
	 * Путь возвращается как есть (относительный от корня проекта) — канонически
	 * правильная форма. На v3 относительный `--vanessasettings` временно не
	 * резолвится от проекта (баг vanessa-runner #725); после его фикса код готов
	 * без изменений.
	 *
	 * @returns Путь к файлу сценария VA относительно корня проекта
	 */
	public getInitVanessaSettingsPath(): string {
		const fallback = 'tools/VAParams.init.json';
		const root = this.workspaceRoot;
		if (!root) {
			return fallback;
		}
		const initFile = path.join(root, this.getVRunnerInitSettingsPath());
		try {
			const parsed = JSON.parse(fsSync.readFileSync(initFile, 'utf8'));
			const value = parsed?.vanessa?.['--vanessasettings']
				?? parsed?.vrunner?.test?.vanessa?.vanessasettings;
			if (typeof value === 'string' && value.trim()) {
				return value.trim();
			}
		} catch {
			// файла инициализации нет — используем дефолт
		}
		return fallback;
	}

	/**
	 * Получает путь к opm (OneScript Package Manager)
	 *
	 * Возвращает путь, разрешённый последней проверкой checkOpmAvailable (имя для
	 * PATH или абсолютный путь установки OVM). До первой проверки — имя 'opm'.
	 *
	 * @returns Имя команды для PATH или абсолютный путь к opm
	 */
	private getOpmInvocation(): { path: string; leadingArgs: string[] } {
		return this.resolvedOpm ?? { path: 'opm', leadingArgs: [] };
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
		return config.get<string>('paths.cf', DEFAULT_PATHS.cf);
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
		return config.get<string>('paths.out', DEFAULT_PATHS.out);
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
		return config.get<string>('paths.dist', DEFAULT_PATHS.dist);
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
		return config.get<string>('paths.epf', DEFAULT_PATHS.epf);
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
		return config.get<string>('paths.erf', DEFAULT_PATHS.erf);
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
		return config.get<string>('paths.cfe', DEFAULT_PATHS.cfe);
	}

	/**
	 * Получает путь к исходникам тестовых обработок (xUnit/Vanessa-ADD)
	 *
	 * Путь берется из настроек VS Code (1c-platform-tools.paths.testsSrc).
	 * По умолчанию: 'src/tests'
	 *
	 * @returns Путь к исходникам тестовых обработок (относительно workspace)
	 */
	public getTestsSrcPath(): string {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<string>('paths.testsSrc', DEFAULT_PATHS.testsSrc);
	}

	/**
	 * Получает путь к каталогу исполняемых тестов (*.os и собранные *.epf)
	 *
	 * Путь берется из настроек VS Code (1c-platform-tools.paths.tests).
	 * По умолчанию: 'tests'
	 *
	 * @returns Путь к каталогу тестов (относительно workspace)
	 */
	public getTestsPath(): string {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<string>('paths.tests', DEFAULT_PATHS.tests);
	}

	// ibcmd — настройка проекта: задаётся пользователем в файле настроек
	// vanessa-runner («--ibcmd» в env.json, vrunner.ibcmd в
	// autumn-properties.json). Расширение флаг не добавляет.

	/**
	 * Проверяет, доступен ли oscript: сначала в PATH, затем в установке OVM.
	 *
	 * Найденный путь запоминается и используется при последующем выполнении,
	 * чтобы детекция и реальный запуск работали с одним и тем же бинарём.
	 *
	 * @returns Промис, который разрешается true, если oscript доступен, иначе false
	 */
	public async checkOscriptAvailable(): Promise<boolean> {
		this.resolvedOscriptPath = await this.resolveBinaryPath('oscript', '-version');
		return this.resolvedOscriptPath !== undefined;
	}

	/**
	 * Проверяет, доступен ли opm: в PATH, затем обёртка в bin установки OVM,
	 * затем запуск скрипта opm.os через oscript.
	 *
	 * В дистрибутиве OneScript opm — обёртка (opm.bat на Windows, шелл-скрипт
	 * на остальных ОС) над `oscript <корень>/lib/opm/src/cmd/opm.os`. В части
	 * установок (OVM на Linux) обёртки в bin нет, при этом сам opm.os в lib
	 * присутствует — тогда opm запускается напрямую через найденный oscript.
	 *
	 * @returns Промис, который разрешается true, если opm доступен, иначе false
	 */
	public async checkOpmAvailable(): Promise<boolean> {
		this.resolvedOpm = await this.resolveOpmInvocation();
		return this.resolvedOpm !== undefined;
	}

	/**
	 * Разрешает способ запуска opm (см. {@link checkOpmAvailable}).
	 *
	 * @returns Инвокация opm или undefined, если opm недоступен
	 */
	private async resolveOpmInvocation(): Promise<{ path: string; leadingArgs: string[] } | undefined> {
		if (await this.runCommandForCheck('opm', ['--version'])) {
			return { path: 'opm', leadingArgs: [] };
		}

		for (const candidate of getOpmBinaryCandidates(getOvmBinDir())) {
			if (fsSync.existsSync(candidate) && await this.runCommandForCheck(candidate, ['--version'])) {
				log.info(`opm не найден в PATH, используется установка OVM: ${candidate}`);
				return { path: candidate, leadingArgs: [] };
			}
		}

		// Обёртки opm нет: пробуем запустить opm.os через oscript из тех же установок
		if (this.resolvedOscriptPath === undefined) {
			await this.checkOscriptAvailable();
		}
		const oscriptPath = this.resolvedOscriptPath;
		if (oscriptPath !== undefined) {
			const installRoots: string[] = [];
			if (path.isAbsolute(oscriptPath)) {
				installRoots.push(path.dirname(path.dirname(oscriptPath)));
			}
			installRoots.push(getOvmRootDir());
			for (const root of new Set(installRoots)) {
				const opmScript = getOpmScriptPath(root);
				if (fsSync.existsSync(opmScript) && await this.runCommandForCheck(oscriptPath, [opmScript, '--version'])) {
					log.info(`opm запускается через oscript: ${opmScript}`);
					return { path: oscriptPath, leadingArgs: [opmScript] };
				}
			}
		}

		log.warn('opm не найден ни в PATH, ни в установке OVM, ни как opm.os в lib установки OneScript');
		return undefined;
	}

	/**
	 * Разрешает исполняемый путь инструмента OneScript.
	 *
	 * Порядок: имя в PATH (нативная установка или настроенный PATH), затем
	 * известный путь установки OVM. Путь OVM детерминирован, поэтому отдельная
	 * настройка не нужна. Возвращает рабочий путь или undefined, если бинарь
	 * недоступен ни одним способом.
	 *
	 * @param name - Имя бинаря (oscript/opm)
	 * @param versionArg - Аргумент проверки версии (-version / --version)
	 * @returns Имя для PATH, абсолютный путь OVM или undefined
	 */
	private async resolveBinaryPath(name: string, versionArg: string): Promise<string | undefined> {
		if (await this.runCommandForCheck(name, [versionArg])) {
			return name;
		}
		const ovmPath = getOvmBinaryPath(name);
		if (fsSync.existsSync(ovmPath) && await this.runCommandForCheck(ovmPath, [versionArg])) {
			log.info(`${name} не найден в PATH, используется установка OVM: ${ovmPath}`);
			return ovmPath;
		}
		log.warn(`${name} не найден ни в PATH, ни в установке OVM: ${ovmPath}`);
		return undefined;
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
	 * @returns Промис, который разрешается true, если vrunner установлен и доступен, иначе false
	 */
	public async checkVRunnerInstalled(): Promise<boolean> {
		const version = await this.detectVRunnerVersionFromCli();
		return version !== undefined;
	}

	/**
	 * Определяет версию vrunner через CLI, пробуя оба способа вывода версии.
	 *
	 * В vrunner 2.x работает подкоманда `vrunner version` (а `--version` падает
	 * с «Неизвестный параметр»), в vrunner 3.x — наоборот: подкоманда удалена,
	 * версия выводится флагом `--version`. Пробуем оба варианта и берём первый,
	 * из вывода которого удалось разобрать semver.
	 *
	 * @returns Разобранная версия или undefined, если ни один способ не сработал
	 */
	private async detectVRunnerVersionFromCli(): Promise<VRunnerVersion | undefined> {
		for (const versionArgs of [['--version'], ['version']]) {
			try {
				const result = await this.executeVRunnerRaw(versionArgs);
				if (!result.success) {
					continue;
				}
				const parsed = parseVRunnerVersion(result.stdout);
				if (parsed) {
					return parsed;
				}
			} catch {
				// пробуем следующий способ
			}
		}
		return undefined;
	}

	/**
	 * Определяет версию vrunner (vanessa-runner).
	 *
	 * Основной источник — CLI: в 2.x версию печатает подкоманда `vrunner version`,
	 * в 3.x — флаг `vrunner --version` (подкоманда в 3.x удалена); пробуются оба
	 * способа. Если ни один не сработал, выполняется запасное чтение
	 * `opm-metadata.xml` из `oscript_modules/vanessa-runner` в корне workspace.
	 *
	 * Результат кэшируется на время сессии; используйте forceRefresh для
	 * принудительного повторного определения (например, после переустановки).
	 *
	 * @param forceRefresh - Игнорировать кэш и определить версию заново
	 * @returns Разобранная версия или undefined, если определить не удалось
	 */
	public async getVRunnerVersion(forceRefresh = false): Promise<VRunnerVersion | undefined> {
		if (!forceRefresh && this.vrunnerVersionCache !== undefined) {
			return this.vrunnerVersionCache ?? undefined;
		}

		let version = await this.detectVRunnerVersionFromCli();

		if (!version) {
			version = await this.readVRunnerVersionFromOpmMetadata();
		}

		if (version) {
			log.debug(`Определена версия vrunner: ${version.raw}`);
		} else {
			log.warn('Не удалось определить версию vrunner');
		}

		const previous = this.vrunnerVersionCache;
		this.vrunnerVersionCache = version ?? null;
		if (previous !== undefined && (previous?.raw ?? null) !== (version?.raw ?? null)) {
			log.info(`Версия vrunner изменилась: ${previous?.raw ?? 'не определена'} -> ${version?.raw ?? 'не определена'}`);
			this._onDidChangeVRunnerVersion.fire(version);
		}
		return version;
	}

	/**
	 * Следит за установкой vanessa-runner в workspace и при её изменении
	 * (переустановка через opm, смена версии) заново определяет версию.
	 *
	 * Без этого кэш версии живёт всю сессию, и после `opm install` панель
	 * и команды продолжают работать со старой схемой.
	 *
	 * @returns Disposable наблюдателя
	 */
	public watchVRunnerInstallation(): vscode.Disposable {
		if (!this.workspaceRoot) {
			return new vscode.Disposable(() => undefined);
		}
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(this.workspaceRoot, 'oscript_modules/vanessa-runner/opm-metadata.xml')
		);
		let timer: NodeJS.Timeout | undefined;
		const redetect = (): void => {
			// установка идёт пакетно — детектим после паузы, одним вызовом
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(() => {
				void this.getVRunnerVersion(true);
			}, 1500);
		};
		watcher.onDidCreate(redetect);
		watcher.onDidChange(redetect);
		watcher.onDidDelete(redetect);
		return watcher;
	}

	/**
	 * Запасное определение версии vrunner по opm-metadata.xml в workspace.
	 *
	 * Проверяется только локальный путь `oscript_modules/vanessa-runner`
	 * (детерминирован относительно проекта). Системную папку lib OneScript
	 * не угадываем — там путь зависит от установки и может не совпадать с
	 * реально вызываемым бинарём.
	 *
	 * @returns Разобранная версия или undefined
	 */
	private async readVRunnerVersionFromOpmMetadata(): Promise<VRunnerVersion | undefined> {
		if (!this.workspaceRoot) {
			return undefined;
		}

		const metadataPath = path.join(
			this.workspaceRoot,
			'oscript_modules',
			'vanessa-runner',
			'opm-metadata.xml'
		);

		try {
			const content = await fs.readFile(metadataPath, 'utf8');
			return parseVRunnerVersionFromOpmMetadata(content);
		} catch {
			return undefined;
		}
	}

	/**
	 * Поддерживает ли установленный vrunner указанную возможность.
	 *
	 * Используется для гейтинга возможностей, доступных только в vrunner 3.x
	 * (новый CLI, флаги автономного сервера `--ibsrv*`). Если версию определить
	 * не удалось, считаем возможность недоступной (консервативно).
	 *
	 * @param feature - Идентификатор возможности (см. VRUNNER_FEATURES)
	 * @returns true, если возможность доступна
	 */
	public async supportsVRunnerFeature(feature: VRunnerFeature): Promise<boolean> {
		const version = await this.getVRunnerVersion();
		return version ? supportsFeature(version, feature) : false;
	}

	/**
	 * Синхронная проверка «установлен vrunner 3.x» по кэшу версии.
	 *
	 * Версия прогревается в planIntents/публичных методах выполнения; если она
	 * ещё не определена — консервативно считаем, что установлен 2.x.
	 *
	 * @returns true, если установлен vrunner >= 3.0.0
	 */
	private isCli3(): boolean {
		const cached = this.vrunnerVersionCache;
		return cached ? isAtLeast(cached, VRUNNER_FEATURES.cli3) : false;
	}

	/**
	 * Схема файлов настроек установленного vrunner: 2.x читает env.json,
	 * 3.x — autumn-properties.json (оба из корня проекта автоматически).
	 *
	 * @returns Схема настроек по кэшу версии (консервативно 2.x)
	 */
	private activeSettingsSchema(): SettingsSchema {
		return this.isCli3() ? 'v3' : 'v2';
	}

	/**
	 * Публичная схема настроек установленного vrunner (для UI: дерево, служебные файлы).
	 *
	 * @returns 'v2' (env.json) или 'v3' (autumn-properties.json)
	 */
	public getActiveSettingsSchema(): SettingsSchema {
		return this.activeSettingsSchema();
	}

	/**
	 * Версия vrunner из кэша детекта (для отображения в UI без ожидания).
	 *
	 * @returns Строка версии (например '3.0.0_beta') или undefined
	 */
	public getCachedVRunnerVersionLabel(): string | undefined {
		return this.vrunnerVersionCache?.raw;
	}

	/**
	 * Синхронное чтение опции активного профиля (для узлов дерева).
	 * Семантика как у readActiveProfileSetting, но без await.
	 *
	 * @param option - Имя опции без префикса (например 'ibconnection')
	 * @returns Значение опции или undefined
	 */
	public readActiveProfileSettingSync(option: string): string | undefined {
		if (!this.workspaceRoot) {
			return undefined;
		}
		const settingsFile = this.getActiveEnvFile();
		const absolutePath = path.isAbsolute(settingsFile)
			? settingsFile
			: path.join(this.workspaceRoot, settingsFile);
		try {
			const parsed = JSON.parse(fsSync.readFileSync(absolutePath, 'utf8'));
			const value = this.activeSettingsSchema() === 'v3'
				? parsed?.vrunner?.[option]
				: parsed?.default?.[`--${option}`];
			if (typeof value === 'string' && value.trim()) {
				return value.trim();
			}
		} catch {
			// файл недоступен или не JSON
		}
		return undefined;
	}

	/**
	 * Строит план выполнения для семантических намерений.
	 *
	 * Единственная точка, где намерение превращается в аргументы CLI: адаптер
	 * выбирается по установленной версии vrunner (2.x/3.x), временные параметры
	 * активного профиля добавляются в зону сквозных опций (в 3.x они обязаны
	 * стоять перед позиционными аргументами), решение про `--ibcmd` принимает
	 * адаптер по-шагово. Для 3.x файл `--settings` формата 2.x не передаётся —
	 * пользователю подсвечивается, что vrunner 3 использует другой формат
	 * настроек (см. handleV3SettingsArg).
	 *
	 * Полученные шаги — финальные аргументы: исполнительные методы вызываются
	 * с `appendOverrides: false`, чтобы не дописывать параметры повторно.
	 *
	 * @param intents - Намерения (каждое может развернуться в несколько команд)
	 * @returns Список команд vrunner (каждая — массив аргументов)
	 */
	public async planIntents(intents: VRunnerIntent[]): Promise<string[][]> {
		const version = await this.getVRunnerVersion();
		const adapter = selectCliAdapter(version);
		const cli3 = version !== undefined && isAtLeast(version, VRUNNER_FEATURES.cli3);
		const overrides = this.getActiveEnvOverrideArgs();
		// Именованный профиль подставляется во ВСЕ команды через --settings; для
		// базового профиля параметр пустой (vrunner читает env.json сам).
		const settingsParam = this.getActiveSettingsParamIfExists();

		const steps: string[][] = [];
		for (const intent of intents) {
			const base = intent.common ?? [];
			const extra = [
				// не дублируем --settings, если он уже задан в намерении
				...(settingsParam.length > 0 && !base.includes('--settings') ? settingsParam : []),
				...overrides,
			];
			const merged: VRunnerIntent = extra.length > 0
				? { ...intent, common: [...base, ...extra] }
				: intent;
			for (const step of adapter.plan(merged)) {
				steps.push(cli3 ? this.handleV3SettingsArg(step) : step);
			}
		}
		return steps;
	}

	/**
	 * План одного намерения (см. {@link planIntents}).
	 */
	public async planIntent(intent: VRunnerIntent): Promise<string[][]> {
		return this.planIntents([intent]);
	}

	/**
	 * Приводит «сырые» аргументы к синтаксису установленного vrunner.
	 *
	 * Применяется ТОЛЬКО к аргументам, которые расширение не строило само:
	 * задачи пользователя из tasks.json (тип 1c-vrunner). Для vrunner 3.x
	 * аргументы в синтаксисе 2.x транслируются (см. translateArgsToV3),
	 * записанные в синтаксисе 3.x — не изменяются (трансляция идемпотентна);
	 * значение `--settings` при необходимости переписывается на файл
	 * autumn-properties.
	 *
	 * @param args - Аргументы команды vrunner
	 * @returns Аргументы под установленную версию vrunner
	 */
	private toCliArgs(args: string[]): string[] {
		if (!this.isCli3()) {
			return args;
		}
		// Пользовательские args из tasks.json не редактируются — только трансляция
		// синтаксиса; о формате настроек пользователь заботится сам.
		return translateArgsToV3(args);
	}

	/** Спецификация служебного файла настроек по схеме (для гейта и кнопки создания). */
	private settingsServiceFileId(schema: SettingsSchema): string {
		return schema === 'v3' ? 'autumnProperties' : 'env';
	}

	/**
	 * Проверяет, что файл настроек активного профиля существует и соответствует
	 * формату установленного vanessa-runner; иначе команда блокируется.
	 *
	 * Настройки — единственный источник параметров подключения и опций команд
	 * (расширение их в CLI не дублирует), поэтому без файла настроек команды не
	 * выполняются: в интерактивном режиме показывается предложение создать файл
	 * через «Служебные файлы».
	 *
	 * @param interactive - Показывать ли предложение создать файл
	 * @returns true, если файл настроек пригоден и команду можно выполнять
	 */
	public async ensureProfileSettingsFile(interactive: boolean): Promise<boolean> {
		await this.getVRunnerVersion();
		if (!this.workspaceRoot) {
			return true;
		}
		const schema = this.activeSettingsSchema();
		const fileName = this.getActiveEnvFile();
		const absolutePath = path.isAbsolute(fileName)
			? fileName
			: path.join(this.workspaceRoot, fileName);

		let suitable = false;
		try {
			const parsed = JSON.parse(fsSync.readFileSync(absolutePath, 'utf8'));
			const isObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
			suitable = isObject && (schema === 'v3' ? 'vrunner' in parsed : !('vrunner' in parsed));
		} catch {
			suitable = false;
		}
		if (suitable) {
			return true;
		}

		log.warn(`Нет подходящего файла настроек: ${fileName}`);
		if (interactive) {
			const createAction = 'Создать профиль запуска';
			void vscode.window
				.showWarningMessage(
					'Профиль запуска не создан. Создайте его и повторите команду.',
					createAction
				)
				.then((action) => {
					if (action === createAction) {
						void vscode.commands.executeCommand('1c-platform-tools.serviceFiles.ensure', this.settingsServiceFileId(schema));
					}
				});
		}
		return false;
	}

	/**
	 * Обрабатывает `--settings` в плане команды для vrunner 3.x.
	 *
	 * vanessa-runner 3 — другой инструмент с другим форматом настроек
	 * (`autumn-properties.json`): файлы env.json формата 2.x он не понимает,
	 * а расширение их НЕ конвертирует автоматически. Если активный профиль
	 * указывает на файл формата 2.x, пара `--settings <файл>` из команды
	 * убирается (иначе она перекрыла бы каскад vrunner и занулила настройки
	 * из autumn-properties.json в корне проекта), а пользователю показывается
	 * предупреждение с предложением создать файл настроек vrunner 3 через
	 * «Служебные файлы». Файлы уже в формате 3.0 передаются без изменений.
	 *
	 * @param args - Аргументы команды (в синтаксисе 3.x)
	 * @returns Аргументы без `--settings` формата 2.x (или те же)
	 */
	private handleV3SettingsArg(args: string[]): string[] {
		const idx = args.indexOf('--settings');
		if (idx === -1 || idx + 1 >= args.length) {
			return args;
		}
		const settingsFile = args[idx + 1];
		if (!this.isSettingsFileV2Format(settingsFile)) {
			return args;
		}

		this.warnV2SettingsOnCli3(settingsFile);
		const copy = [...args];
		copy.splice(idx, 2);
		return copy;
	}

	/**
	 * Проверяет, что файл настроек в формате 2.x (плоские секции, без корневого
	 * ключа `vrunner`). Нечитаемый файл или не-объект форматом 2.x не считается.
	 *
	 * @param settingsFile - Путь к файлу (абсолютный или от корня workspace)
	 * @returns true, если файл в формате 2.x
	 */
	private isSettingsFileV2Format(settingsFile: string): boolean {
		if (!this.workspaceRoot) {
			return false;
		}
		const absolutePath = path.isAbsolute(settingsFile)
			? settingsFile
			: path.join(this.workspaceRoot, settingsFile);
		try {
			const parsed = JSON.parse(fsSync.readFileSync(absolutePath, 'utf8'));
			return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && !('vrunner' in parsed);
		} catch {
			return false;
		}
	}

	/** Файлы настроек 2.x, о которых предупреждение уже показано (раз за сессию). */
	private readonly warnedV2SettingsFiles = new Set<string>();

	/**
	 * Предупреждает, что файл настроек в формате 2.x не подходит для vrunner 3.
	 * Показывается один раз за сессию для каждого файла; кнопка создаёт
	 * autumn-properties.json через служебные файлы.
	 *
	 * @param settingsFile - Путь файла настроек формата 2.x
	 */
	private warnV2SettingsOnCli3(settingsFile: string): void {
		if (this.warnedV2SettingsFiles.has(settingsFile)) {
			return;
		}
		this.warnedV2SettingsFiles.add(settingsFile);
		log.warn(`Файл настроек ${settingsFile} в старом формате, параметр --settings не передан`);
		const createAction = 'Создать профиль запуска';
		void vscode.window
			.showWarningMessage(
				'Профиль запуска в другом формате и не применяется. Создайте его заново.',
				createAction
			)
			.then((action) => {
				if (action === createAction) {
					void vscode.commands.executeCommand('1c-platform-tools.serviceFiles.ensure', 'autumnProperties');
				}
			});
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
	 * - Операции с расширениями: compileext, decompileext, unloadext, compileexttocfe, updateext
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
			'compileexttocfe',
			'updateext'
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

		const osTerminalName = options?.name || '1C: Platform Tools';
		const osTerminal =
			vscode.window.terminals.find((t) => t.name === osTerminalName) ??
			vscode.window.createTerminal({
				name: osTerminalName,
				cwd: cwd,
				env: options?.env ? { ...process.env, ...options.env } : undefined,
			});
		osTerminal.sendText(command);
		osTerminal.show();
	}

	/**
	 * Получает путь к OneScript
	 *
	 * Возвращает путь, разрешённый последней проверкой checkOscriptAvailable (имя
	 * для PATH или абсолютный путь установки OVM). До первой проверки — имя 'oscript'.
	 *
	 * @returns Имя команды для PATH или абсолютный путь к oscript
	 */
	private getOnescriptPath(): string {
		return this.resolvedOscriptPath ?? 'oscript';
	}

	/**
	 * Запускать ли команды vrunner как задачи VS Code (Tasks).
	 *
	 * По умолчанию включено: доступен «Rerun Last Task», команды видны в списке
	 * задач, прогон можно остановить. При `false` сохраняется прежний запуск
	 * в интерактивном терминале.
	 *
	 * @returns true, если использовать задачи; false — интерактивный терминал
	 */
	private shouldUseTasks(): boolean {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<boolean>('execution.useTasks', true);
	}

	/**
	 * Запрашивает подтверждение запуска в Docker для команды без поддержки --ibcmd.
	 *
	 * @param args - Аргументы команды vrunner (первый — имя команды)
	 * @returns true, если можно продолжать (команда поддерживает --ibcmd или пользователь согласился)
	 */
	private async confirmDockerIbcmd(args: string[]): Promise<boolean> {
		if (this.supportsIbcmd(args)) {
			return true;
		}
		const commandName = args[0] || 'команда';
		log.warn(`Команда "${commandName}" не поддерживает --ibcmd, необходимый для Docker`);
		const action = await vscode.window.showWarningMessage(
			`Команда "${commandName}" не поддерживает параметр --ibcmd, который необходим для работы в Docker. ` +
			'Эта команда может не работать корректно в Docker-контейнере без графического интерфейса. ' +
			'Продолжить выполнение?',
			'Да',
			'Нет'
		);
		return action === 'Да';
	}

	/**
	 * Строит задачу VS Code для одиночной команды vrunner.
	 *
	 * Учитывает активные временные параметры профиля, режим Docker и построение
	 * команды так же, как синхронный путь (executeVRunner). Используется как для
	 * ad-hoc запуска из команд расширения, так и для разрешения задач из tasks.json.
	 *
	 * @param args - Аргументы команды vrunner
	 * @param options - Опции (cwd, env, name, appendOverrides)
	 * @returns Готовая задача или undefined, если подготовка не удалась/отменена
	 */
	public async createVRunnerTaskFromArgs(
		args: string[],
		options?: {
			cwd?: string;
			env?: NodeJS.ProcessEnv;
			name?: string;
			appendOverrides?: boolean;
			/** true — «сырые» аргументы пользователя (tasks.json): транслировать под установленный vrunner */
			translateRaw?: boolean;
			definition?: vscode.TaskDefinition;
			exitCallback?: (exitCode: number) => void;
		}
	): Promise<vscode.Task | undefined> {
		await this.getVRunnerVersion();
		const finalArgs = options?.appendOverrides === false ? args : this.appendActiveOverrides(args);
		const cwd = options?.cwd || this.workspaceRoot || os.homedir();
		const useDocker = await this.shouldUseDocker();

		if (useDocker) {
			if (!this.workspaceRoot) {
				log.error('Для использования Docker необходимо открыть рабочую область');
				vscode.window.showErrorMessage('Для использования Docker необходимо открыть рабочую область');
				return undefined;
			}
			if (!(await this.confirmDockerIbcmd(finalArgs))) {
				return undefined;
			}
		}

		const built = this.buildExecCommand(finalArgs, useDocker, options?.translateRaw === true);
		if ('error' in built) {
			log.error(`Ошибка при подготовке команды: ${built.error}`);
			vscode.window.showErrorMessage(built.error);
			return undefined;
		}

		return createVRunnerTask({
			name: options?.name || '1C: Platform Tools',
			command: built.command,
			cwd,
			env: options?.env,
			definition: options?.definition,
			exitCallback: options?.exitCallback,
		});
	}

	/**
	 * Выполняет команду vrunner как задачу VS Code.
	 *
	 * Задача становится «последней» для команды «Rerun Last Task».
	 * Аналог executeVRunnerInTerminal, но через Task API.
	 *
	 * @param args - Аргументы команды vrunner
	 * @param options - Опции выполнения (cwd, env, name)
	 */
	public async executeVRunnerTask(
		args: string[],
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; appendOverrides?: boolean }
	): Promise<void> {
		const task = await this.createVRunnerTaskFromArgs(args, options);
		if (task) {
			await vscode.tasks.executeTask(task);
		}
	}

	/**
	 * Запускает команду vrunner как задачу VS Code и ожидает её завершения.
	 *
	 * @returns Промис с exit code задачи (0 — успех).
	 */
	public async executeVRunnerTaskAndWait(
		args: string[],
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; appendOverrides?: boolean }
	): Promise<number> {
		let resolveExit!: (exitCode: number) => void;
		const exitPromise = new Promise<number>((resolve) => {
			resolveExit = resolve;
		});
		const task = await this.createVRunnerTaskFromArgs(args, {
			...options,
			exitCallback: resolveExit,
		});
		if (!task) {
			return 1;
		}
		await vscode.tasks.executeTask(task);
		return exitPromise;
	}

	/**
	 * Выполняет несколько команд vrunner последовательно как одну задачу VS Code.
	 *
	 * Команды объединяются в одну строку (через `&&`, в Docker — через
	 * buildDockerCommandSequence), что гарантирует запуск следующей только после
	 * фактического завершения предыдущей.
	 *
	 * @param argsArray - Массив наборов аргументов (каждый — одна команда vrunner)
	 * @param options - Опции выполнения (cwd, env, name)
	 */
	public async executeVRunnerTaskSequence(
		argsArray: string[][],
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; appendOverrides?: boolean }
	): Promise<void> {
		if (argsArray.length === 0) {
			return;
		}
		if (argsArray.length === 1) {
			await this.executeVRunnerTask(argsArray[0], options);
			return;
		}

		const finalArgsArray = options?.appendOverrides === false
			? argsArray
			: argsArray.map((args) => this.appendActiveOverrides(args));
		const cwd = options?.cwd || this.workspaceRoot || os.homedir();
		const useDocker = await this.shouldUseDocker();
		let command: string;

		if (useDocker) {
			if (!this.workspaceRoot) {
				log.error('Для использования Docker необходимо открыть рабочую область');
				vscode.window.showErrorMessage('Для использования Docker необходимо открыть рабочую область');
				return;
			}
			if (!(await this.confirmDockerIbcmd(finalArgsArray[0]))) {
				return;
			}
			try {
				const dockerImage = this.getDockerImage();
				const processedArgsArray = finalArgsArray.map((args) => this.processCommandArgsForDocker(args));
				command = buildDockerCommandSequence(dockerImage, processedArgsArray, this.workspaceRoot, TASK_HOST_SHELL);
			} catch (error) {
				const errMsg = (error as Error).message;
				log.error(`Ошибка при подготовке команды Docker: ${errMsg}`);
				vscode.window.showErrorMessage(errMsg);
				return;
			}
		} else {
			const parts: string[] = [];
			for (const args of finalArgsArray) {
				const built = this.buildExecCommand(args, false);
				if ('error' in built) {
					log.error(`Ошибка при подготовке команды: ${built.error}`);
					vscode.window.showErrorMessage(built.error);
					return;
				}
				parts.push(built.command);
			}
			// && одинаково работает в cmd и sh (оболочки spawn для задач)
			command = parts.join(' && ');
		}

		const task = createVRunnerTask({
			name: options?.name || '1C: Platform Tools',
			command,
			cwd,
			env: options?.env,
		});
		await vscode.tasks.executeTask(task);
	}

	/**
	 * Запускает последовательность команд vrunner как одну задачу VS Code и ожидает завершения.
	 *
	 * @returns Промис с exit code задачи (0 — успех).
	 */
	public async executeVRunnerTaskSequenceAndWait(
		argsArray: string[][],
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; appendOverrides?: boolean }
	): Promise<number> {
		if (argsArray.length === 0) {
			return 0;
		}
		if (argsArray.length === 1) {
			return this.executeVRunnerTaskAndWait(argsArray[0], options);
		}

		const finalArgsArray = options?.appendOverrides === false
			? argsArray
			: argsArray.map((args) => this.appendActiveOverrides(args));
		const cwd = options?.cwd || this.workspaceRoot || os.homedir();
		const useDocker = await this.shouldUseDocker();
		let command: string;

		if (useDocker) {
			if (!this.workspaceRoot) {
				log.error('Для использования Docker необходимо открыть рабочую область');
				vscode.window.showErrorMessage('Для использования Docker необходимо открыть рабочую область');
				return 1;
			}
			if (!(await this.confirmDockerIbcmd(finalArgsArray[0]))) {
				return 1;
			}
			try {
				const dockerImage = this.getDockerImage();
				const processedArgsArray = finalArgsArray.map((args) => this.processCommandArgsForDocker(args));
				command = buildDockerCommandSequence(dockerImage, processedArgsArray, this.workspaceRoot, TASK_HOST_SHELL);
			} catch (error) {
				const errMsg = (error as Error).message;
				log.error(`Ошибка при подготовке команды Docker: ${errMsg}`);
				vscode.window.showErrorMessage(errMsg);
				return 1;
			}
		} else {
			const parts: string[] = [];
			for (const args of finalArgsArray) {
				const built = this.buildExecCommand(args, false);
				if ('error' in built) {
					log.error(`Ошибка при подготовке команды: ${built.error}`);
					vscode.window.showErrorMessage(built.error);
					return 1;
				}
				parts.push(built.command);
			}
			command = parts.join(' && ');
		}

		let resolveExit!: (exitCode: number) => void;
		const exitPromise = new Promise<number>((resolve) => {
			resolveExit = resolve;
		});
		const task = createVRunnerTask({
			name: options?.name || '1C: Platform Tools',
			command,
			cwd,
			env: options?.env,
			exitCallback: resolveExit,
		});
		await vscode.tasks.executeTask(task);
		return exitPromise;
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
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; shellType?: ShellType; appendOverrides?: boolean }
	): Promise<void> {
		await this.getVRunnerVersion();
		// По умолчанию команды идут как задачи VS Code (Rerun, список задач).
		// Сырой терминал остаётся опцией (настройка execution.useTasks).
		if (this.shouldUseTasks()) {
			await this.executeVRunnerTask(args, options);
			return;
		}
		if (options?.appendOverrides !== false) {
			args = this.appendActiveOverrides(args);
		}
		const cwd = options?.cwd || this.workspaceRoot || os.homedir();
		const shellType = options?.shellType || detectShellType();

		const useDocker = await this.shouldUseDocker();
		
		let command: string;
		
		if (useDocker) {
			if (!this.workspaceRoot) {
				log.error('Для использования Docker необходимо открыть рабочую область');
				vscode.window.showErrorMessage('Для использования Docker необходимо открыть рабочую область');
				return;
			}

			// Проверяем, поддерживает ли команда --ibcmd
			if (!this.supportsIbcmd(args)) {
				const commandName = args[0] || 'команда';
				log.warn(`Команда "${commandName}" не поддерживает --ibcmd, необходимый для Docker`);
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
				log.debug(`Docker: образ=${dockerImage}, args=${processedArgs.join(' ')}`);
			} catch (error) {
				const errMsg = (error as Error).message;
				log.error(`Ошибка при подготовке команды Docker: ${errMsg}`);
				vscode.window.showErrorMessage(errMsg);
				return;
			}
		} else {
			const vrunnerPath = this.getVRunnerPath();
			const processedArgs = this.processCommandArgs(args, cwd, shellType);
			command = buildCommand(vrunnerPath, processedArgs, shellType);
		}

		const terminalName = options?.name || '1C: Platform Tools';
		const terminal =
			vscode.window.terminals.find((t) => t.name === terminalName) ??
			vscode.window.createTerminal({
				name: terminalName,
				cwd: cwd,
				env: options?.env ? { ...process.env, ...options.env } : undefined,
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
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; shellType?: ShellType; appendOverrides?: boolean }
	): Promise<void> {
		if (argsArray.length === 0) {
			return;
		}
		await this.getVRunnerVersion();
		// По умолчанию — как задача VS Code; сырой терминал остаётся опцией.
		if (this.shouldUseTasks()) {
			await this.executeVRunnerTaskSequence(argsArray, options);
			return;
		}
		if (argsArray.length === 1) {
			await this.executeVRunnerInTerminal(argsArray[0], options);
			return;
		}

		if (options?.appendOverrides !== false) {
			argsArray = argsArray.map((args) => this.appendActiveOverrides(args));
		}

		const cwd = options?.cwd || this.workspaceRoot || os.homedir();
		const shellType = options?.shellType || detectShellType();
		const useDocker = await this.shouldUseDocker();
		let command: string;

		if (useDocker) {
			if (!this.workspaceRoot) {
				log.error('Для использования Docker необходимо открыть рабочую область');
				vscode.window.showErrorMessage('Для использования Docker необходимо открыть рабочую область');
				return;
			}
			if (!this.supportsIbcmd(argsArray[0])) {
				const commandName = argsArray[0][0] || 'команда';
				log.warn(`Команда "${commandName}" не поддерживает --ibcmd, необходимый для Docker`);
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
				log.debug(`Docker (последовательно): образ=${dockerImage}, команд=${processedArgsArray.length}`);
			} catch (error) {
				const errMsg = (error as Error).message;
				log.error(`Ошибка при подготовке команды Docker: ${errMsg}`);
				vscode.window.showErrorMessage(errMsg);
				return;
			}
			const dockerTerminalName = options?.name || '1C: Platform Tools';
			const dockerTerminal =
				vscode.window.terminals.find((t) => t.name === dockerTerminalName) ??
				vscode.window.createTerminal({
					name: dockerTerminalName,
					cwd: cwd,
					env: options?.env ? { ...process.env, ...options.env } : undefined,
				});
			dockerTerminal.sendText(command);
			dockerTerminal.show();
			return;
		}

		const vrunnerPath = this.getVRunnerPath();
		const commands = argsArray.map((args) => {
			const processedArgs = this.processCommandArgs(args, cwd, shellType);
			return buildCommand(vrunnerPath, processedArgs, shellType);
		});
		const fullCommand = joinCommands(commands, shellType);

		const seqTerminalName = options?.name || '1C: Platform Tools';
		const seqTerminal =
			vscode.window.terminals.find((t) => t.name === seqTerminalName) ??
			vscode.window.createTerminal({
				name: seqTerminalName,
				cwd: cwd,
				env: options?.env ? { ...process.env, ...options.env } : undefined,
			});
		seqTerminal.sendText(fullCommand);
		seqTerminal.show();
	}

	/**
	 * Строит полную строку команды vrunner для выполнения в child process
	 *
	 * Учитывает режим Docker (docker.enabled): в этом случае команда оборачивается
	 * в docker run, а пути нормализуются для контейнера.
	 *
	 * @param args - Аргументы команды vrunner
	 * @returns Объект с командой либо с текстом ошибки подготовки
	 */
	private buildExecCommand(args: string[], useDocker: boolean, translateRaw = false): { command: string } | { error: string } {
		// Трансляция синтаксиса применяется ТОЛЬКО к «сырым» аргументам задач
		// пользователя из tasks.json. Планы интентов уже финальные — повторная
		// обработка недопустима (парсер шима не обязан понимать синтаксис 3.x).
		if (translateRaw) {
			args = this.toCliArgs(args);
		}
		if (useDocker) {
			if (!this.workspaceRoot) {
				return { error: 'Для использования Docker необходимо открыть рабочую область' };
			}

			try {
				const dockerImage = this.getDockerImage();
				const processedArgs = this.processCommandArgsForDocker(args);
				const shellType = detectShellType();
				return { command: buildDockerCommand(dockerImage, processedArgs, this.workspaceRoot, shellType) };
			} catch (error) {
				return { error: (error as Error).message };
			}
		}

		const vrunnerPath = this.getVRunnerPath();
		const argsString = escapeCommandArgs(args);
		const quotedPath = vrunnerPath.includes(' ') ? `"${vrunnerPath}"` : vrunnerPath;
		// Задачи выполняются дочерним процессом через cmd (spawn shell:true) независимо от
		// профиля терминала: без chcp oscript выводит кириллицу в OEM-кодировке.
		const encodingPrefix = process.platform === 'win32' ? 'chcp 65001 >nul && ' : '';
		return { command: `${encodingPrefix}${quotedPath} ${argsString}` };
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
		// Прогреваем версию: синхронная адаптация «сырых» аргументов в
		// buildExecCommand должна знать про 3.x. Детект версии зовёт
		// executeVRunnerRaw (минуя прогрев), поэтому рекурсии нет.
		await this.getVRunnerVersion();
		return this.executeVRunnerRaw(args, options);
	}

	/**
	 * Низкоуровневое синхронное выполнение vrunner без прогрева версии.
	 *
	 * Используется детектом версии (чтобы избежать рекурсии) и публичным
	 * {@link executeVRunner}.
	 */
	private async executeVRunnerRaw(
		args: string[],
		options?: { cwd?: string; env?: NodeJS.ProcessEnv }
	): Promise<VRunnerExecutionResult> {
		const useDocker = await this.shouldUseDocker();
		const cwd = options?.cwd || this.workspaceRoot;

		return new Promise((resolve) => {
			const built = this.buildExecCommand(args, useDocker);
			if ('error' in built) {
				resolve({
					success: false,
					stdout: '',
					stderr: built.error,
					exitCode: 1
				});
				return;
			}
			const command = built.command;

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
	 * Выполняет команду vrunner как отменяемый процесс с живым выводом
	 *
	 * Используется панелью тестирования (Testing API): позволяет прервать прогон
	 * по CancellationToken (с завершением всего дерева процессов cmd → oscript → 1cv8)
	 * и транслировать stdout/stderr по мере выполнения.
	 *
	 * Поддерживает Docker-режим так же, как executeVRunner.
	 *
	 * @param args - Аргументы команды vrunner
	 * @param options - Опции выполнения (cwd, env, token, onOutput)
	 * @returns Промис с результатом выполнения (включая признак отмены)
	 */
	public async executeVRunnerCancellable(
		args: string[],
		options?: {
			cwd?: string;
			env?: NodeJS.ProcessEnv;
			token?: vscode.CancellationToken;
			onOutput?: (chunk: string) => void;
			/** false — аргументы финальные (план интента), параметры профиля не дописывать */
			appendOverrides?: boolean;
		}
	): Promise<CancellableProcessResult> {
		await this.getVRunnerVersion();
		if (options?.appendOverrides !== false) {
			args = this.appendActiveOverrides(args);
		}
		const useDocker = await this.shouldUseDocker();
		const built = this.buildExecCommand(args, useDocker);
		if ('error' in built) {
			return {
				success: false,
				stdout: '',
				stderr: built.error,
				exitCode: 1,
				cancelled: false
			};
		}

		return runCancellableCommand(built.command, {
			cwd: options?.cwd || this.workspaceRoot,
			env: options?.env,
			token: options?.token,
			onOutput: options?.onOutput
		});
	}

	/**
	 * Выполняет команду opm как задачу VS Code.
	 *
	 * Аналог executeOpmInTerminal через Task API: «Rerun Last Task», список задач,
	 * остановка прогона. opm — host-инструмент, Docker здесь не применяется.
	 *
	 * @param args - Аргументы команды opm
	 * @param options - Опции выполнения (cwd, env, name)
	 */
	public async executeOpmTask(
		args: string[],
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string }
	): Promise<void> {
		const { path: opmPath, leadingArgs } = this.getOpmInvocation();
		const cwd = options?.cwd || this.workspaceRoot || os.homedir();
		const quotedPath = opmPath.includes(' ') ? `"${opmPath}"` : opmPath;
		const command = `${quotedPath} ${escapeCommandArgs([...leadingArgs, ...args])}`;
		const task = createVRunnerTask({
			name: options?.name || '1C: Platform Tools',
			command,
			cwd,
			env: options?.env,
		});
		await vscode.tasks.executeTask(task);
	}

	/**
	 * Выполняет команду opm в терминале VS Code
	 *
	 * Создает терминал и выполняет команду opm (OneScript Package Manager).
	 * Используется для установки и управления зависимостями проекта.
	 *
	 * @param args - Аргументы команды opm (например, ['install', '--dev', '-l'])
	 * @param options - Опции выполнения
	 * @param options.cwd - Рабочая директория (по умолчанию workspace root)
	 * @param options.name - Имя терминала (по умолчанию '1C: Platform Tools')
	 * @param options.shellType - Тип оболочки (опционально, определяется автоматически)
	 */
	public executeOpmInTerminal(
		args: string[],
		options?: { cwd?: string; name?: string; shellType?: ShellType }
	): void {
		// По умолчанию команды идут как задачи VS Code; сырой терминал остаётся опцией.
		if (this.shouldUseTasks()) {
			void this.executeOpmTask(args, options);
			return;
		}
		const { path: opmPath, leadingArgs } = this.getOpmInvocation();
		const shellType = options?.shellType || detectShellType();
		const cwd = options?.cwd || this.workspaceRoot || os.homedir();
		const processedArgs = this.processCommandArgs([...leadingArgs, ...args], cwd, shellType);
		const command = buildCommand(opmPath, processedArgs, shellType);

		const opmTerminalName = options?.name || '1C: Platform Tools';
		const opmTerminal =
			vscode.window.terminals.find((t) => t.name === opmTerminalName) ??
			vscode.window.createTerminal({ name: opmTerminalName, cwd: cwd });
		opmTerminal.sendText(command);
		opmTerminal.show();
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
			const { path: opmPath, leadingArgs } = this.getOpmInvocation();
			const argsString = escapeCommandArgs([...leadingArgs, ...args]);
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

		const allureTerminalName = options?.name || '1C: Platform Tools';
		const allureTerminal =
			vscode.window.terminals.find((t) => t.name === allureTerminalName) ??
			vscode.window.createTerminal({ name: allureTerminalName, cwd: cwd });
		allureTerminal.sendText(command);
		allureTerminal.show();
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
	 * Читает и парсит env-файл из корня workspace
	 *
	 * Файл env.json используется для хранения параметров подключения к ИБ
	 * и других настроек проекта. Для чтения активного профиля запуска
	 * (env.<id>.json) передайте его имя из {@link getActiveEnvFile}.
	 *
	 * @param fileName - Имя env-файла относительно корня (по умолчанию env.json)
	 * @returns Промис, который разрешается содержимым файла или пустым объектом при ошибке
	 * @throws {Error} Если рабочая область не открыта
	 */
	/**
	 * Читает файл настроек активного профиля и возвращает его вместе со схемой.
	 *
	 * Схема определяется по установленной версии vrunner: env.json (2.x) или
	 * autumn-properties.json (3.x). Значения опций внутри читаются с учётом
	 * схемы (см. settingValue в projectTestConfig).
	 *
	 * @returns Разобранное содержимое (пустой объект при ошибке) и схема
	 */
	public async readActiveSettings(): Promise<{ settings: Record<string, unknown>; schema: SettingsSchema }> {
		await this.getVRunnerVersion();
		const schema = this.activeSettingsSchema();
		const settings = (await this.readEnvJson(this.getActiveEnvFile())) as Record<string, unknown>;
		return { settings, schema };
	}

	public async readEnvJson(fileName: string = BASE_ENV_FILE): Promise<any> {
		if (!this.workspaceRoot) {
			throw new Error('Рабочая область не открыта');
		}

		const envPath = path.join(this.workspaceRoot, fileName);
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
	 * Возвращает id активного env-профиля.
	 *
	 * Базовый файл настроек (env.json / autumn-properties.json) vanessa-runner
	 * читает из корня проекта всегда, поэтому «запуска без профиля» не бывает:
	 * при отсутствии явного выбора активен базовый профиль. Пустое значение из
	 * прежних версий приводится к базовому профилю.
	 *
	 * @returns Идентификатор профиля (никогда не пустой)
	 */
	public getActiveEnvProfileId(): string {
		const fromState = this.memento?.get<string>(ACTIVE_ENV_PROFILE_KEY);
		if (typeof fromState === 'string' && fromState) {
			return fromState;
		}
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const configured = config.get<string>('defaultEnvProfile', DEFAULT_ENV.defaultProfile);
		if (configured) {
			return configured;
		}
		return DEFAULT_PROFILE_ID;
	}

	/**
	 * Сохраняет id активного env-профиля в workspaceState (локально, не коммитится)
	 *
	 * @param profileId - Идентификатор профиля (пустая строка — базовый env.json)
	 * @returns Промис завершения записи
	 */
	public async setActiveEnvProfileId(profileId: string): Promise<void> {
		await this.memento?.update(ACTIVE_ENV_PROFILE_KEY, profileId);
		this._onDidChangeActiveEnvProfile.fire();
	}

	/**
	 * Находит доступные env-профили в корне workspace
	 *
	 * Базовый профиль (`env.json`) присутствует всегда, даже если файл ещё не создан.
	 *
	 * @returns Список профилей (см. {@link EnvProfile})
	 */
	public discoverEnvProfiles(): EnvProfile[] {
		let fileNames: string[] = [];
		if (this.workspaceRoot) {
			try {
				fileNames = fsSync
					.readdirSync(this.workspaceRoot, { withFileTypes: true })
					.filter((entry) => entry.isFile())
					.map((entry) => entry.name);
			} catch {
				fileNames = [];
			}
		}
		return buildEnvProfiles(fileNames, this.activeSettingsSchema());
	}

	/**
	 * Возвращает временные параметры активного профиля.
	 *
	 * @returns Временные параметры из workspaceState или undefined
	 */
	public getActiveEnvOverrides(): EnvOverrides | undefined {
		const raw = this.memento?.get<EnvOverrides>(ACTIVE_ENV_OVERRIDES_KEY);
		return raw && hasOverrides(raw) ? raw : undefined;
	}

	/**
	 * Сохраняет временные параметры активного профиля (локально, не коммитится)
	 *
	 * @param overrides - Временные параметры или undefined для сброса
	 * @returns Промис завершения записи
	 */
	public async setActiveEnvOverrides(overrides: EnvOverrides | undefined): Promise<void> {
		const value = overrides && hasOverrides(overrides) ? overrides : undefined;
		await this.memento?.update(ACTIVE_ENV_OVERRIDES_KEY, value);
	}

	/**
	 * Признак наличия активных временных параметров
	 *
	 * @returns true, если задан хотя бы один временный параметр
	 */
	public hasActiveEnvOverrides(): boolean {
		return hasOverrides(this.getActiveEnvOverrides());
	}

	/**
	 * Возвращает флаги vrunner для активных временных параметров
	 *
	 * @returns Массив аргументов (может быть пустым)
	 */
	public getActiveEnvOverrideArgs(): string[] {
		return buildOverrideArgs(this.getActiveEnvOverrides());
	}

	/**
	 * Добавляет к аргументам команды активные временные параметры.
	 *
	 * Отдельные флаги дописываются в конец и перекрывают значения файла профиля.
	 * Если временных параметров нет — массив возвращается без изменений.
	 *
	 * @param args - Исходные аргументы команды vrunner
	 * @returns Аргументы с добавленными параметрами (или те же, если их нет)
	 */
	private appendActiveOverrides(args: string[]): string[] {
		const overrides = this.getActiveEnvOverrideArgs();
		return overrides.length > 0 ? [...args, ...overrides] : args;
	}

	/**
	 * Возвращает имя файла активного env-профиля (относительно workspace)
	 *
	 * Если выбранный профиль не найден среди файлов — возвращается базовый
	 * `env.json` (полная обратная совместимость).
	 *
	 * @returns Имя файла env-профиля (например 'env.json' или 'env.dev.json')
	 */
	public getActiveEnvFile(): string {
		const schema = this.activeSettingsSchema();
		const activeId = this.getActiveEnvProfileId();
		if (!activeId) {
			return baseSettingsFileName(schema);
		}
		return resolveActiveEnvFileName(activeId, this.discoverEnvProfiles(), schema);
	}

	/**
	 * Возвращает параметр --settings выбранного env-профиля.
	 *
	 * Базовый профиль (env.json / autumn-properties.json) параметр не требует:
	 * vanessa-runner сам читает свой файл настроек из корня проекта. `--settings`
	 * возвращается только для именованного профиля (env.<id>.json /
	 * autumn-properties.<id>.json), и только если файл существует.
	 *
	 * @returns Массив ['--settings', файл] или пустой массив
	 */
	public getActiveSettingsParamIfExists(): string[] {
		const activeId = this.getActiveEnvProfileId();
		const profile = this.discoverEnvProfiles().find((p) => p.id === activeId);
		if (!profile || profile.isBase) {
			return [];
		}
		return ['--settings', profile.fileName];
	}

	/**
	 * Получает параметр --settings для команды vrunner
	 *
	 * Без явного файла используется активный env-профиль: для именованного —
	 * `--settings <файл>`, для базового параметр не нужен (vrunner сам читает
	 * env.json / autumn-properties.json из корня проекта).
	 *
	 * @param settingsFile - Путь к файлу настроек (относительно workspace), опционально
	 * @returns Массив ['--settings', 'путь_к_файлу'] или пустой массив
	 */
	public getSettingsParam(settingsFile?: string): string[] {
		return settingsFile ? ['--settings', settingsFile] : this.getActiveSettingsParamIfExists();
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
	 * @param settingsFile - Путь к файлу настроек (относительно workspace).
	 *                        По умолчанию — активный env-профиль
	 * @returns Промис, который разрешается массивом параметров ['--ibconnection', 'строка_подключения']
	 */
	public async getIbConnectionParam(ibConnection?: string): Promise<string[]> {
		// Значения из файла настроек в командную строку не дублируются:
		// vanessa-runner сам читает свой файл (env.json / autumn-properties.json)
		// из корня проекта, а CLI-аргумент перекрыл бы его каскад. Флаг
		// добавляется только для явно заданной строки подключения (например,
		// из вызова MCP или временных параметров профиля).
		if (ibConnection) {
			return ['--ibconnection', ibConnection];
		}
		return [];
	}

	/**
	 * Читает значение опции из файла настроек активного профиля с учётом схемы:
	 * `default["--<опция>"]` в env.json (2.x) или `vrunner.<опция>` в
	 * autumn-properties.json (3.x).
	 *
	 * Для собственных нужд расширения (автономный сервер, подбор платформы) —
	 * в команды vrunner эти значения не пробрасываются.
	 *
	 * @param option - Имя опции без префикса (например 'ibconnection')
	 * @returns Значение опции или undefined
	 */
	private async readActiveProfileSetting(option: string): Promise<string | undefined> {
		if (!this.workspaceRoot) {
			return undefined;
		}
		const settingsFile = this.getActiveEnvFile();
		const absolutePath = path.isAbsolute(settingsFile)
			? settingsFile
			: path.join(this.workspaceRoot, settingsFile);
		try {
			const content = await fs.readFile(absolutePath, 'utf8');
			const parsed = JSON.parse(content);
			const value = this.activeSettingsSchema() === 'v3'
				? parsed?.vrunner?.[option]
				: parsed?.default?.[`--${option}`];
			if (typeof value === 'string' && value.trim()) {
				return value.trim();
			}
		} catch {
			// файл недоступен или не JSON — значение не определено
		}
		return undefined;
	}

	/**
	 * Строка подключения к ИБ активного профиля: временный параметр либо значение
	 * из файла настроек; по умолчанию — файловая ИБ build/ib (как у vanessa-runner).
	 *
	 * @returns Строка подключения (например '/F./build/ib')
	 */
	public async getActiveIbConnectionValue(): Promise<string> {
		const override = this.getActiveEnvOverrides()?.ibConnection;
		if (override) {
			return override;
		}
		return (await this.readActiveProfileSetting('ibconnection')) ?? '/F./build/ib';
	}

	/**
	 * Возвращает версию платформы 1С активного профиля (`--v8version`).
	 *
	 * Единый источник версии платформы для команд расширения: сначала временный
	 * параметр (override), затем `default["--v8version"]` активного env-профиля.
	 *
	 * @returns Версия платформы или undefined, если не задана
	 */
	public async getActiveV8Version(): Promise<string | undefined> {
		const override = this.getActiveEnvOverrides()?.v8version;
		if (override) {
			return override;
		}
		return this.readActiveProfileSetting('v8version');
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
