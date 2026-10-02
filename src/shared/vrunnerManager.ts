import * as vscode from 'vscode';
import { exec, execFile, type ExecException } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
	buildCommand,
	joinCommands,
	detectShellType,
	buildProcessCommand,
	PROCESS_HOST_SHELL,
	ShellType,
	normalizeArgForShell,
	buildDockerCommand,
	buildDockerCommandSequence,
	dockerRunArgs,
	normalizeIbPathForDocker,
	withoutPublishedPorts,
	type DockerRunOptions,
} from '../utils/commandUtils';
import {
	CONTAINER_WORKSPACE,
	containerPath,
	containerPathsInText,
	dockerMountSource,
	fileInfobaseOutside,
	hostPathOutside,
	isInsideDir,
	textTokens,
	type DockerMount,
} from './dockerPaths';
import { edtTemporaryDir } from './edtStaging';
import { isEdtProject } from './projectLayout';
import { logger } from './logger';
import { setTerminalOscriptBinDir } from './terminalEnv';
import { dockerCommandRun, dockerContainerName, startWindowContainer, windowContainerLogsRun } from './dockerRun';
import { runCancellableCommand, CancellableProcessResult, type CommandRun } from './cancellableProcess';
import { DEFAULT_PATHS, DEFAULT_VRUNNER, DEFAULT_ENV } from './pathDefaults';
import { getOvmBinaryPath, getOvmBinDir, getOvmRootDir, getOpmBinaryCandidates, getOpmScriptPath, withSelectedEngine } from './ovmPaths';
import {
	BASE_AUTUMN_FILE,
	BASE_ENV_FILE,
	LOCAL_OVERRIDES_FILE,
	SettingsSchema,
	baseSettingsFileName,
	DEFAULT_PROFILE_ID,
	EnvProfile,
	EnvOverrides,
	buildEnvProfiles,
	buildOverrideArgs,
	hasOverrides,
	mergeEnvOverrides,
	parseLocalOverrides,
	resolveActiveEnvFileName,
	detectSettingsFormat,
} from './envProfiles';
import { DEFAULT_IB_CONNECTION } from './ibConnectionPath';
import { containsGitBranchVariable, GIT_BRANCH_VARIABLE, substituteGitBranch } from './launchVariables';
import { readGitBranchDirName } from './gitHead';
import {
	VRunnerVersion,
	VRunnerFeature,
	parseVRunnerVersion,
	parseVRunnerVersionFromOpmMetadata,
	supportsFeature,
	isAtLeast,
	VRUNNER_FEATURES,
} from './vrunnerVersion';
import { VRunnerIntent } from './vrunnerCli';
import { planIntents, SettingsFileFormat } from './vrunnerCli/planner';
import { overlaySettings, parseSettingsJson, readSettingsJson, readSettingsJsonSync } from './settingsJson';
import { translateArgsToV3 } from './vrunnerCommandMap';
import { createVRunnerTask, VRUNNER_TASK_TYPE, type TaskOutputChain } from '../features/tasks/vrunnerTask';
import { decodeProcessOutput } from './processOutput';
import { ACTIVE_ENV_OVERRIDES_STATE, ACTIVE_ENV_PROFILE_STATE, projectMemento } from './projectState';
import { currentRoot, projectRootKey, runWithProject } from './workspaceProjects';
import { projectConfiguration } from './projectConfiguration';
import { projectTerminal } from '../features/tasks/terminalProjects';
import { untrustedWorkspaceBlocks, WORKSPACE_TRUST_REQUIRED } from './workspaceTrust';

const log = logger.scope('vrunner');

/** Запуск на этой машине в обход Docker: см. VRunnerManager.runOnThisMachine. */
const onThisMachine = new AsyncLocalStorage<boolean>();

/** Запуск клиента 1С с окном: см. VRunnerManager.runWithWindow. */
const withWindow = new AsyncLocalStorage<boolean>();

/** Временный каталог проекта EDT в контейнере. */
const EDT_STAGING_IN_CONTAINER = '/edt-staging';

/** Команды, которым база не нужна. */
const NO_INFOBASE_COMMANDS = new Set(['version', '--version', 'help', '--help']);

/**
 * Значения аргументов команды: строка `--additional` разбирается на пути и слова.
 *
 * @param args - Аргументы команды vrunner
 */
function argumentValues(args: readonly string[]): string[] {
	return args.flatMap((arg, index) => (index > 0 && args[index - 1] === '--additional' ? textTokens(arg) : [arg]));
}

/** Запуск в контейнере, подготовленный для всех способов выполнения. */
interface DockerPlan {
	/** Docker-образ */
	image: string;
	/** Аргументы команд с путями контейнера */
	argsArray: string[][];
	/** Каталог проекта для тома */
	root: string;
	/** Тома сверх проекта и параметры docker run */
	options: DockerRunOptions;
}

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

/** Исход команды, которую не запустили из недоверенной папки. */
function untrustedExecutionResult(): VRunnerExecutionResult {
	return { success: false, stdout: '', stderr: WORKSPACE_TRUST_REQUIRED, exitCode: 1 };
}

/** Состояние файла настроек активного профиля. */
export interface SettingsFileState {
	schema: SettingsSchema;
	/** Имя файла активного профиля относительно корня проекта */
	fileName: string;
	/** Имя базового файла схемы установленного vanessa-runner */
	expectedFileName: string;
	exists: boolean;
	/** Файл другой схемы: env.json при vanessa-runner 3 или наоборот */
	formatMismatch: boolean;
	/** Причина, по которой файл не разобран */
	readError?: string;
	/** Файл найден, разобран и нужного формата: команды выполняются */
	ready: boolean;
}

/** Разобранный файл настроек: секции произвольной вложенности. */
type SettingsDocument = any;

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
	private extensionPath: string | undefined;
	private memento: vscode.Memento | undefined;

	/** Кэш версии vrunner по корню проекта: undefined - ещё не определяли, null - прошлая попытка не удалась, следующий вызов её повторит. */
	private readonly vrunnerVersionCacheByRoot = new Map<string, VRunnerVersion | null>();

	/** Идущие сейчас проверки oscript по значению components.path.oscript: гасят параллельные запуски. */
	private readonly oscriptChecksInFlight = new Map<string, Promise<boolean>>();

	/** Идущие сейчас проверки opm по значению components.path.oscript. */
	private readonly opmChecksInFlight = new Map<string, Promise<boolean>>();

	/** Идущий сейчас детект версии по корню: гасит параллельные запуски vrunner. */
	private readonly vrunnerVersionInFlight = new Map<string, Promise<VRunnerVersion | undefined>>();

	/** Показанные замечания о формате файла настроек: не повторяем за сессию. */
	private readonly warnedV2SettingsFiles = new Set<string>();

	/** Корни, где уже предупредили про `${gitBranch}` вне репозитория git. */
	private readonly warnedGitBranchRoots = new Set<string>();

	/** Файлы перекрытий, о неподдержанных ключах которых уже писали в журнал. */
	private readonly warnedLocalOverrideKeys = new Set<string>();

	/** Замечания последнего планирования (применённые/отброшенные временные параметры). */
	private planNotices: string[] = [];
	/**
	 * Разрешённые пути к oscript по значению components.path.oscript: имя для PATH или
	 * абсолютный путь установки. Заполняются в checkOscriptAvailable и используются
	 * синхронными getOnescriptPath/исполнением.
	 */
	private readonly resolvedOscriptPaths = new Map<string, string>();
	/**
	 * Разрешённые способы запуска opm по значению components.path.oscript: путь к
	 * запускаемому файлу и ведущие аргументы. Для обёртки из PATH/bin аргументы пусты;
	 * если обёртки нет, opm запускается через oscript со скриптом opm.os из установки OneScript.
	 */
	private readonly resolvedOpms = new Map<string, { path: string; leadingArgs: string[] }>();

	/** Событие смены активного env-профиля (id в workspaceState) */
	private readonly _onDidChangeActiveEnvProfile = new vscode.EventEmitter<void>();
	/** Срабатывает при выборе другого env-профиля запуска */
	public readonly onDidChangeActiveEnvProfile = this._onDidChangeActiveEnvProfile.event;

	/** Событие смены временных параметров активного профиля */
	private readonly _onDidChangeEnvOverrides = new vscode.EventEmitter<void>();
	/** Срабатывает, когда временные параметры заданы или сброшены */
	public readonly onDidChangeEnvOverrides = this._onDidChangeEnvOverrides.event;

	/** Событие смены определённой версии vrunner (после переустановки/обновления) */
	private readonly _onDidChangeVRunnerVersion = new vscode.EventEmitter<VRunnerVersion | undefined>();
	/** Срабатывает, когда повторный детект версии vrunner дал другой результат */
	public readonly onDidChangeVRunnerVersion = this._onDidChangeVRunnerVersion.event;

	private constructor(context?: vscode.ExtensionContext) {
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
	/**
	 * Выполняет fn с корнем проекта: бинарь vrunner, версия, схема настроек и
	 * файлы профилей резолвятся от root.
	 *
	 * @param root - Абсолютный путь к корню проекта 1С
	 * @param fn - Действие в контексте корня
	 * @returns Результат fn
	 */
	public runWithProjectRoot<T>(root: string, fn: () => Promise<T>): Promise<T> {
		return runWithProject(root, fn);
	}

	/**
	 * Корень текущего проекта с учётом корня вызова.
	 *
	 * @returns Абсолютный путь либо undefined без проекта
	 */
	private getEffectiveRoot(): string | undefined {
		return currentRoot();
	}

	/** Значение components.path.oscript в проекте вызова. */
	private configuredOscriptPath(): string {
		return projectConfiguration(this.getEffectiveRoot()).get<string>('components.path.oscript', '').trim();
	}

	/** Путь oscript, разрешённый для настройки проекта вызова. */
	private get resolvedOscriptPath(): string | undefined {
		return this.resolvedOscriptPaths.get(this.configuredOscriptPath());
	}

	/** Ключ кэша версии для активного корня. */
	private versionCacheKey(): string {
		const root = this.getEffectiveRoot();
		if (root === undefined) {
			return '';
		}
		if (!this.dockerEnabled()) {
			return projectRootKey(root);
		}
		// У каждого образа и у этой машины vrunner свой
		const image = projectConfiguration(root).get<string>('docker.image', '').trim();
		return `${projectRootKey(root)}|docker|${image}`;
	}

	public getVRunnerPath(): string {
		// Имя локального бинаря зависит от ОС: на Windows — vrunner.bat, иначе vrunner.
		const binaryName = process.platform === 'win32' ? 'vrunner.bat' : 'vrunner';
		const root = this.getEffectiveRoot();
		if (root) {
			const vrunnerPath = path.join(root, 'oscript_modules', 'bin', binaryName);
			if (fsSync.existsSync(vrunnerPath)) {
				return path.join('oscript_modules', 'bin', binaryName);
			}
		}

		return 'vrunner';
	}

	/**
	 * Получает путь к файлу настроек инициализации vrunner
	 *
	 * Путь берется из настроек VS Code (1c-platform-tools.vrunner.path.initSettings).
	 * По умолчанию: 'tools/vrunner.init.json'
	 *
	 * ВАЖНО: использовать только для команды инициализации ИБ данными
	 * («Инициализировать данные»). Для остальных команд (тесты, запуск feature)
	 * применяются батч-настройки из env.json — см. getSettingsParam().
	 *
	 * @returns Путь к файлу настроек инициализации (относительно workspace)
	 */
	public getVRunnerInitSettingsPath(): string {
		return projectConfiguration(this.getEffectiveRoot()).get<string>('vrunner.path.initSettings', DEFAULT_VRUNNER.initSettingsPath);
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
		const root = this.getEffectiveRoot();
		if (!root) {
			return fallback;
		}
		const initFile = path.join(root, this.getVRunnerInitSettingsPath());
		try {
			const parsed = readSettingsJsonSync(initFile) as SettingsDocument;
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
		return this.resolvedOpms.get(this.configuredOscriptPath()) ?? { path: 'opm', leadingArgs: [] };
	}

	/**
	 * Получает путь к allure
	 * 
	 * Путь берется из настроек VS Code (1c-platform-tools.components.path.allure).
	 * По умолчанию: 'allure'
	 * 
	 * @returns Путь к allure (для поиска в PATH или абсолютный путь)
	 */
	public getAllurePath(): string {
		return projectConfiguration(this.getEffectiveRoot()).get<string>('components.path.allure', '').trim() || 'allure';
	}


	/**
	 * Получает путь к результатам сборки
	 * 
	 * Путь берется из настроек VS Code (1c-platform-tools.path.out).
	 * По умолчанию: 'build/out'
	 * 
	 * @returns Путь к результатам сборки (относительно workspace)
	 */
	public getOutPath(): string {
		return projectConfiguration(this.getEffectiveRoot()).get<string>('path.out', DEFAULT_PATHS.out);
	}

	/**
	 * Получает путь к каталогу хранения шаблонов (cf, cfu, настройки объединения и т.д.)
	 *
	 * Путь берётся из настроек VS Code (1c-platform-tools.path.dist).
	 * По умолчанию: 'build/dist'
	 *
	 * @returns Путь к каталогу шаблонов (относительно workspace)
	 */
	public getDistPath(): string {
		return projectConfiguration(this.getEffectiveRoot()).get<string>('path.dist', DEFAULT_PATHS.dist);
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
		// Найденное держим до конца сессии: проверка зовётся перед каждой командой.
		// Ненайденное перепроверяем: инструмент могли поставить рядом, мимо расширения.
		const configured = this.configuredOscriptPath();
		if (this.resolvedOscriptPaths.has(configured)) {
			return true;
		}
		let check = this.oscriptChecksInFlight.get(configured);
		if (check === undefined) {
			check = (async () => {
				const resolved = await this.resolveBinaryPath('oscript', '-version', configured);
				if (resolved !== undefined) {
					this.resolvedOscriptPaths.set(configured, resolved);
				}
				setTerminalOscriptBinDir(this.oscriptBinDir(resolved));
				return resolved !== undefined;
			})().finally(() => {
				this.oscriptChecksInFlight.delete(configured);
			});
			this.oscriptChecksInFlight.set(configured, check);
		}
		return check;
	}

	/**
	 * Заново определяет установку OneScript: oscript, opm и версию vrunner.
	 *
	 * Нужен после установки OneScript: без этого до конца сессии используется
	 * установка, найденная при активации.
	 */
	public async refreshOneScriptResolution(): Promise<void> {
		this.resolvedOscriptPaths.clear();
		this.resolvedOpms.clear();
		await this.checkOscriptAvailable();
		await this.checkOpmAvailable();
		await this.getVRunnerVersion(true);
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
		const configured = this.configuredOscriptPath();
		if (this.resolvedOpms.has(configured)) {
			return true;
		}
		let check = this.opmChecksInFlight.get(configured);
		if (check === undefined) {
			check = (async () => {
				const resolved = await this.resolveOpmInvocation();
				if (resolved !== undefined) {
					this.resolvedOpms.set(configured, resolved);
				}
				return resolved !== undefined;
			})().finally(() => {
				this.opmChecksInFlight.delete(configured);
			});
			this.opmChecksInFlight.set(configured, check);
		}
		return check;
	}

	/**
	 * Разрешает способ запуска opm (см. {@link checkOpmAvailable}).
	 *
	 * @returns Инвокация opm или undefined, если opm недоступен
	 */
	private async resolveOpmInvocation(): Promise<{ path: string; leadingArgs: string[] } | undefined> {
		// Порядок тот же, что у oscript: сначала установка OVM, потом PATH
		for (const candidate of getOpmBinaryCandidates(getOvmBinDir())) {
			if (fsSync.existsSync(candidate) && await this.runCommandForCheck(candidate, ['--version'], getOvmBinDir())) {
				log.info(`opm: используется установка OVM: ${candidate}`);
				return { path: candidate, leadingArgs: [] };
			}
		}

		if (await this.runCommandForCheck('opm', ['--version'])) {
			log.info('opm: используется установка из PATH');
			return { path: 'opm', leadingArgs: [] };
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
	 * @param configured - Значение components.path.oscript проекта
	 * @returns Имя для PATH, абсолютный путь OVM или undefined
	 */
	private async resolveBinaryPath(name: string, versionArg: string, configured: string): Promise<string | undefined> {
		if (name === 'oscript' && configured !== '') {
			if (await this.runCommandForCheck(configured, [versionArg])) {
				log.info(`oscript: указан настройкой components.path.oscript: ${configured}`);
				return configured;
			}
			log.warn(`components.path.oscript не запускается: ${configured}`);
		}

		// Установка OVM идёт перед PATH: её ставит сам пользователь командой
		// «Установить OneScript», а системный каталог другой установки может
		// стоять в PATH раньше, потому что системная часть склеивается первой.
		const ovmPath = getOvmBinaryPath(name);
		if (fsSync.existsSync(ovmPath) && await this.runCommandForCheck(ovmPath, [versionArg], getOvmBinDir())) {
			log.info(`${name}: используется установка OVM: ${ovmPath}`);
			return ovmPath;
		}

		if (await this.runCommandForCheck(name, [versionArg])) {
			log.info(`${name}: используется установка из PATH`);
			return name;
		}

		log.warn(`${name} не найден ни в установке OVM (${ovmPath}), ни в PATH`);
		return undefined;
	}

	/**
	 * Выполняет команду для проверки доступности (exit code 0 = успех).
	 *
	 * @param commandPath - Путь к исполняемому файлу (или имя для поиска в PATH)
	 * @param args - Аргументы команды
	 * @returns Промис, который разрешается true при exit code 0
	 */
	private runCommandForCheck(commandPath: string, args: string[], binDir?: string): Promise<boolean> {
		return new Promise((resolve) => {
			// Проверка запускает найденный бинарь, в том числе из oscript_modules проекта
			if (untrustedWorkspaceBlocks(`проверка ${commandPath}`)) {
				resolve(false);
				return;
			}
			const command = buildProcessCommand(commandPath, args);
			const options = { maxBuffer: 1024 * 1024, timeout: 10000, env: this.childEnv(undefined, binDir) };
			exec(command, options, (error) => {
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
	 * Найденная версия кэшируется на время сессии, неудача нет: vrunner могли
	 * поставить мимо расширения, Docker мог ещё не запуститься, а в недоверенной
	 * папке vrunner не запускается вовсе. forceRefresh определяет заново и
	 * найденную версию (например, после переустановки).
	 *
	 * @param forceRefresh - Игнорировать кэш и определить версию заново
	 * @returns Разобранная версия или undefined, если определить не удалось
	 */
	public async getVRunnerVersion(forceRefresh = false): Promise<VRunnerVersion | undefined> {
		const cacheKey = this.versionCacheKey();
		const cachedVersion = this.vrunnerVersionCacheByRoot.get(cacheKey);
		if (!forceRefresh && cachedVersion) {
			return cachedVersion;
		}

		// Кэш наполняется только по завершении, а на активации детект зовут
		// несколько панелей разом: без этого каждая запускала бы vrunner заново
		const running = this.vrunnerVersionInFlight.get(cacheKey);
		if (running !== undefined) {
			return running;
		}
		// Определение версии идёт без портов клиента с окном
		const detection = withWindow.exit(() => this.detectVRunnerVersion(cacheKey));
		this.vrunnerVersionInFlight.set(cacheKey, detection);
		try {
			return await detection;
		} finally {
			this.vrunnerVersionInFlight.delete(cacheKey);
		}
	}

	/**
	 * Определяет версию vrunner и обновляет кэш.
	 *
	 * @param cacheKey - Ключ кэша версии для текущего корня
	 * @returns Разобранная версия или undefined
	 */
	private async detectVRunnerVersion(cacheKey: string): Promise<VRunnerVersion | undefined> {
		const inDocker = this.dockerEnabled();
		let version = await this.detectVRunnerVersionFromCli();

		// Установка в проекте описывает vrunner этой машины, а не образа
		if (!version && !inDocker) {
			version = await this.readVRunnerVersionFromOpmMetadata();
		}

		const previous = this.vrunnerVersionCacheByRoot.get(cacheKey);
		if (version) {
			log.debug(`Определена версия vrunner: ${version.raw}`);
		} else if (previous !== null) {
			log.warn('Не удалось определить версию vrunner');
		}

		this.vrunnerVersionCacheByRoot.set(cacheKey, version ?? null);
		if (previous !== undefined && (previous?.raw ?? null) !== (version?.raw ?? null)) {
			log.info(`Версия vrunner изменилась: ${previous?.raw ?? 'не определена'} -> ${version?.raw ?? 'не определена'}`);
		}
		// Первое определение тоже событие: до него схема настроек считается 2.x,
		// и построенные раньше панели не видят autumn-properties.json
		if (previous === undefined || (previous?.raw ?? null) !== (version?.raw ?? null)) {
			this._onDidChangeVRunnerVersion.fire(version);
		}
		return version;
	}

	/**
	 * Следит за установкой vanessa-runner во всех папках рабочей области и при её
	 * изменении (переустановка через opm, смена версии) заново определяет версию
	 * того корня, где установка изменилась.
	 *
	 * Без этого кэш версии живёт всю сессию, и после `opm install` панель
	 * и команды продолжают работать со старой схемой.
	 *
	 * Настройки Docker выбирают, чей vrunner выполняет команды: после их смены
	 * подписчики получают версию vrunner образа или этой машины.
	 *
	 * @returns Disposable наблюдателя
	 */
	public watchVRunnerInstallation(): vscode.Disposable {
		const watcher = vscode.workspace.createFileSystemWatcher('**/oscript_modules/vanessa-runner/opm-metadata.xml');
		const timers = new Map<string, NodeJS.Timeout>();
		const redetect = (uri: vscode.Uri): void => {
			const root = path.resolve(uri.fsPath, '..', '..', '..');
			const key = projectRootKey(root);
			// установка идёт пакетно — детектим после паузы, одним вызовом
			clearTimeout(timers.get(key));
			timers.set(
				key,
				setTimeout(() => {
					timers.delete(key);
					void this.refreshVRunnerVersion(root);
				}, 1500)
			);
		};
		return vscode.Disposable.from(
			watcher,
			watcher.onDidCreate(redetect),
			watcher.onDidChange(redetect),
			watcher.onDidDelete(redetect),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration('1c-platform-tools.docker')) {
					this._onDidChangeVRunnerVersion.fire(this.vrunnerVersionCacheByRoot.get(this.versionCacheKey()) ?? undefined);
					void this.getVRunnerVersion();
				}
			}),
			new vscode.Disposable(() => {
				for (const timer of timers.values()) {
					clearTimeout(timer);
				}
				timers.clear();
			})
		);
	}

	/**
	 * Заново определяет версию vrunner корня, если она для него уже определялась.
	 *
	 * @param root - Корень, в `oscript_modules` которого изменилась установка
	 */
	public async refreshVRunnerVersion(root: string): Promise<void> {
		if (!this.vrunnerVersionCacheByRoot.has(projectRootKey(root))) {
			return;
		}
		await runWithProject(root, () => this.runOnThisMachine(() => this.getVRunnerVersion(true)));
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
		const root = this.getEffectiveRoot();
		if (!root) {
			return undefined;
		}

		const metadataPath = path.join(
			root,
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
		const cached = this.vrunnerVersionCacheByRoot.get(this.versionCacheKey());
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
		return this.vrunnerVersionCacheByRoot.get(this.versionCacheKey())?.raw;
	}

	/**
	 * Синхронное чтение опции активного профиля (для узлов дерева).
	 * Семантика как у readActiveProfileSetting, но без await.
	 *
	 * @param option - Имя опции без префикса (например 'ibconnection')
	 * @returns Значение опции или undefined
	 */
	public readActiveProfileSettingSync(option: string): string | undefined {
		const root = this.getEffectiveRoot();
		if (!root) {
			return undefined;
		}
		const schema = this.activeSettingsSchema();
		return this.profileOptionValue(this.readSettingsLayersSync(root, this.getActiveEnvFile(), schema), schema, option);
	}

	/**
	 * Значение опции общего уровня из настроек с подстановкой `${gitBranch}`:
	 * `default["--<опция>"]` в env.json (2.x) или `vrunner.<опция>` в
	 * autumn-properties.json (3.x).
	 *
	 * @param settings - Настройки профиля
	 * @param schema - Схема настроек
	 * @param option - Имя опции без префикса (например 'ibconnection')
	 * @returns Значение опции или undefined
	 */
	private profileOptionValue(settings: SettingsDocument, schema: SettingsSchema, option: string): string | undefined {
		const value = schema === 'v3' ? settings.vrunner?.[option] : settings.default?.[`--${option}`];
		return typeof value === 'string' && value.trim() ? this.substituteLaunchValue(value.trim()) : undefined;
	}

	/**
	 * Файлы, из которых vanessa-runner складывает настройки при запуске с этим
	 * файлом, от важного к общему: 3.x накладывает его на autumn-properties.json
	 * проекта, 2.x читает только его.
	 *
	 * @param settingsFile - Файл настроек: абсолютный путь или путь от корня проекта
	 * @param schema - Схема настроек
	 * @returns Сам файл и, для 3.x, файл проекта, в том виде, как их передавать от корня
	 */
	public settingsLayerFiles(settingsFile: string, schema: SettingsSchema = this.activeSettingsSchema()): string[] {
		const root = this.getEffectiveRoot();
		if (schema !== 'v3' || !root) {
			return [settingsFile];
		}
		const own = path.resolve(root, settingsFile);
		return path.relative(own, path.join(root, BASE_AUTUMN_FILE)) === ''
			? [settingsFile]
			: [settingsFile, BASE_AUTUMN_FILE];
	}

	private readSettingsLayersSync(root: string, settingsFile: string, schema: SettingsSchema): SettingsDocument {
		return overlaySettings(
			this.settingsLayerFiles(settingsFile, schema).map((file) => {
				try {
					return readSettingsJsonSync(path.resolve(root, file));
				} catch {
					return undefined;
				}
			})
		) as SettingsDocument;
	}

	/**
	 * Настройки, которые vanessa-runner видит при запуске с этим файлом (см.
	 * {@link settingsLayerFiles}). Непрочитанные файлы пропускаются.
	 *
	 * @param settingsFile - Файл настроек: абсолютный путь или путь от корня проекта
	 * @param schema - Схема настроек; без неё берётся по самому файлу
	 * @returns Слитые настройки (пустой объект, если ничего не прочитано) и схема
	 * @throws {Error} Если рабочая область не открыта
	 */
	public async readSettingsLayers(
		settingsFile: string,
		schema?: SettingsSchema
	): Promise<{ settings: Record<string, unknown>; schema: SettingsSchema }> {
		const root = this.getEffectiveRoot();
		if (!root) {
			throw new Error('Рабочая область не открыта');
		}
		const read = (file: string) => readSettingsJson(path.resolve(root, file)).catch(() => undefined);
		const own = await read(settingsFile);
		const fileSchema: SettingsSchema = schema ?? (detectSettingsFormat(own) === 'v3' ? 'v3' : 'v2');
		const lower = await Promise.all(this.settingsLayerFiles(settingsFile, fileSchema).slice(1).map(read));
		return { settings: overlaySettings([own, ...lower]), schema: fileSchema };
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
	 * @param settingsFile - Явный файл настроек; без него берётся активный профиль
	 * @returns Список команд vrunner (каждая — массив аргументов)
	 */
	public async planIntents(
		intents: VRunnerIntent[],
		settingsFile?: string,
		explicitIbConnection?: string
	): Promise<string[][]> {
		const version = await this.getVRunnerVersion();
		const { steps, notices } = planIntents(await this.runnableIntents(intents), {
			version,
			overrideArgs: this.getActiveEnvOverrideArgs(),
			activeSettingsFile: this.getActiveSettingsParamIfExists()[1],
			settingsFile,
			explicitIbConnection,
			settingsFormat: (file) => this.settingsFileFormat(file),
		});

		this.planNotices = notices;
		for (const notice of notices) {
			log.info(`план: ${notice}`);
			if (notice.startsWith('Файл настроек ')) {
				this.notifySettingsFormatProblem(notice);
			}
		}
		return steps;
	}

	/**
	 * Формат файла настроек по его содержимому.
	 *
	 * @param settingsFile - Путь к файлу (абсолютный или от корня проекта)
	 * @returns 'v3' (корневой ключ vrunner), 'v2' (плоские секции) либо 'unknown'
	 */
	private settingsFileFormat(settingsFile: string): SettingsFileFormat {
		const root = this.getEffectiveRoot();
		if (!root) {
			return 'unknown';
		}
		const absolutePath = path.isAbsolute(settingsFile)
			? settingsFile
			: path.join(root, settingsFile);
		try {
			return detectSettingsFormat(readSettingsJsonSync(absolutePath));
		} catch {
			return 'unknown';
		}
	}

	/**
	 * Намерения в том виде, в каком их выполнит vrunner. В контейнере `--no-wait`
	 * не передаётся: контейнер завершается вместе с vrunner и закрыл бы клиент 1С.
	 *
	 * @param intents - Намерения команды
	 * @returns Намерения для выполнения
	 */
	public async runnableIntents(intents: readonly VRunnerIntent[]): Promise<VRunnerIntent[]> {
		if (!(await this.shouldUseDocker())) {
			return [...intents];
		}
		return intents.map((intent) => ('noWait' in intent && intent.noWait ? { ...intent, noWait: false } : intent));
	}

	/**
	 * План одного намерения (см. {@link planIntents}).
	 */
	public async planIntent(
		intent: VRunnerIntent,
		settingsFile?: string,
		explicitIbConnection?: string
	): Promise<string[][]> {
		return this.planIntents([intent], settingsFile, explicitIbConnection);
	}

	/**
	 * Забирает замечания последнего планирования (список очищается).
	 *
	 * @returns Замечания о применённых/отброшенных временных параметрах
	 */
	public consumePlanNotices(): string[] {
		const notices = this.planNotices;
		this.planNotices = [];
		return notices;
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
	 * Состояние файла настроек активного профиля: одно на панель, статус-бар и команды.
	 *
	 * @returns Схема, имя файла и почему он не годится: не найден, не читается,
	 *   другого формата; ready - файл пригоден для команд
	 */
	public describeSettingsState(): SettingsFileState {
		const schema = this.activeSettingsSchema();
		const fileName = this.getActiveEnvFile();
		const expectedFileName = baseSettingsFileName(schema);
		const absolutePath = this.settingsAbsolutePath(fileName);
		const exists = fsSync.existsSync(absolutePath);
		let formatMismatch = false;
		let readError: string | undefined;
		if (exists) {
			try {
				formatMismatch = detectSettingsFormat(readSettingsJsonSync(absolutePath)) !== schema;
			} catch (error) {
				readError = error instanceof Error ? error.message : String(error);
			}
		}
		return {
			schema,
			fileName,
			expectedFileName,
			exists,
			formatMismatch,
			readError,
			ready: exists && !formatMismatch && readError === undefined,
		};
	}

	/**
	 * Сообщение о непригодном файле настроек: что нашли и что ожидалось.
	 *
	 * @param state - Состояние файла; по умолчанию текущее
	 * @returns Текст с именем файла, причиной и версией vanessa-runner
	 */
	public settingsProblemMessage(state: SettingsFileState = this.describeSettingsState()): string {
		const version = this.getCachedVRunnerVersionLabel() ?? 'версия не определена';
		if (state.readError) {
			return `Файл настроек ${state.fileName} не прочитан: ${state.readError}. Исправьте файл и повторите команду.`;
		}
		if (state.formatMismatch) {
			const actual = state.schema === 'v3' ? '2.x' : '3.x';
			return (
				`Файл настроек ${state.fileName} в формате vanessa-runner ${actual}, ` +
				`а установлен vanessa-runner ${version}: нужен формат ${state.expectedFileName}. ` +
				'Создайте файл настроек командой «Служебные файлы».'
			);
		}
		return (
			`Файл настроек ${state.fileName} не найден. ` +
			`Для vanessa-runner ${version} нужен ${state.expectedFileName} в корне проекта: ` +
			'создайте его командой «Служебные файлы».'
		);
	}

	/**
	 * Проверяет, что файл настроек активного профиля читается и соответствует
	 * формату установленного vanessa-runner; иначе команда блокируется.
	 *
	 * Настройки — единственный источник параметров подключения и опций команд
	 * (расширение их в CLI не дублирует), поэтому без файла настроек команды не
	 * выполняются: в интерактивном режиме показывается предложение создать или
	 * открыть файл.
	 *
	 * @param interactive - Показывать ли предложение поправить файл
	 * @returns true, если файл настроек пригоден и команду можно выполнять
	 */
	public async ensureProfileSettingsFile(interactive: boolean): Promise<boolean> {
		await this.getVRunnerVersion();
		if (!this.getEffectiveRoot()) {
			return true;
		}
		const state = this.describeSettingsState();
		if (state.ready) {
			return true;
		}
		log.warn(
			`Файл настроек ${state.fileName} не годится: ` +
			(state.readError ?? (state.formatMismatch ? 'формат другой версии vanessa-runner' : 'не найден'))
		);
		if (interactive) {
			this.offerSettingsFix(state);
		}
		return false;
	}

	/** Предлагает открыть нечитаемый файл настроек либо создать файл нужного формата. */
	private offerSettingsFix(state: SettingsFileState): void {
		if (state.readError) {
			const openAction = 'Открыть файл';
			void vscode.window.showWarningMessage(this.settingsProblemMessage(state), openAction).then((action) => {
				if (action === openAction) {
					void vscode.window.showTextDocument(vscode.Uri.file(this.settingsAbsolutePath(state.fileName)));
				}
			});
			return;
		}
		const createAction = 'Создать профиль запуска';
		const message = state.exists
			? this.settingsProblemMessage(state)
			: 'Профиль запуска не создан. Создайте его и повторите команду.';
		void vscode.window.showWarningMessage(message, createAction).then((action) => {
			if (action === createAction) {
				void vscode.commands.executeCommand('1c-platform-tools.serviceFiles.ensure', this.settingsServiceFileId(state.schema));
			}
		});
	}

	/** Абсолютный путь файла настроек: относительный берётся от корня активного контекста. */
	private settingsAbsolutePath(fileName: string): string {
		const root = this.getEffectiveRoot();
		return root && !path.isAbsolute(fileName) ? path.join(root, fileName) : fileName;
	}

	/**
	 * Показывает замечание планирования о непригодном файле настроек.
	 *
	 * Одно и то же замечание показывается один раз за сессию; кнопка создаёт
	 * файл настроек нужного формата через служебные файлы.
	 *
	 * @param notice - Текст замечания планирования
	 */
	private notifySettingsFormatProblem(notice: string): void {
		if (this.warnedV2SettingsFiles.has(notice)) {
			return;
		}
		this.warnedV2SettingsFiles.add(notice);
		const createAction = 'Создать профиль запуска';
		void vscode.window
			.showWarningMessage(notice, createAction)
			.then((action) => {
				if (action === createAction) {
					void vscode.commands.executeCommand(
						'1c-platform-tools.serviceFiles.ensure',
						this.settingsServiceFileId(this.activeSettingsSchema())
					);
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
			if (untrustedWorkspaceBlocks('проверка Docker')) {
				resolve(false);
				return;
			}
			exec('docker --version', { maxBuffer: 1024 * 1024 }, (error) => {
				resolve(!error);
			});
		});
	}

	/**
	 * Выполнять ли команды vrunner в Docker: настройка `docker.enabled` проекта.
	 *
	 * Внутри {@link runOnThisMachine} ответ всегда отрицательный.
	 *
	 * @returns true, если команды идут в контейнер
	 */
	public async shouldUseDocker(): Promise<boolean> {
		return this.dockerEnabled();
	}

	private dockerEnabled(): boolean {
		return onThisMachine.getStore() !== true
			&& projectConfiguration(this.getEffectiveRoot()).get<boolean>('docker.enabled', false);
	}

	/**
	 * Выполняет команды vrunner на этой машине в обход Docker: у клиента 1С
	 * с окном в контейнере нет экрана.
	 *
	 * @param action - Запуск команды
	 * @returns Результат запуска
	 */
	public runOnThisMachine<T>(action: () => T): T {
		return onThisMachine.run(true, action);
	}

	/**
	 * Запускает клиент 1С с окном: в контейнере порты из `docker.runArgs`
	 * публикуются только такому запуску.
	 *
	 * @param action - Запуск клиента
	 * @returns Результат запуска
	 */
	public runWithWindow<T>(action: () => T): T {
		return withWindow.run(true, action);
	}

	/**
	 * Запускает клиент 1С с окном в отсоединённом контейнере: команда завершается, как
	 * только контейнер запущен. Вывод клиента показывает задача, остановка которой
	 * закрывает клиент.
	 *
	 * @param args - Итоговые аргументы vrunner
	 * @param options - Каталог и имя задачи с выводом
	 * @returns Имя контейнера и код его выхода после остановки либо причина отказа
	 */
	public async startClientInContainer(
		args: string[],
		options: { cwd?: string; name: string }
	): Promise<{ container: string; exited: Promise<number | undefined> } | { error: string }> {
		const plan = this.dockerPlan([args]);
		if ('error' in plan) {
			return plan;
		}
		const container = dockerContainerName();
		const runArgs = dockerRunArgs(plan.image, plan.argsArray[0], plan.root, {
			...plan.options,
			containerName: container,
			detached: true,
		});
		const started = await startWindowContainer(runArgs, container);
		if ('error' in started) {
			return started;
		}
		// У каждого окна своя задача: повторный запуск той же задачи VS Code предложил бы перезапустить прежнюю
		const root = this.getEffectiveRoot();
		const task = createVRunnerTask({
			name: options.name,
			command: () => windowContainerLogsRun(container),
			cwd: options.cwd || root || os.homedir(),
			env: this.childEnv(),
			definition: {
				type: VRUNNER_TASK_TYPE,
				command: options.name,
				args: [container],
				...(root === undefined ? {} : { project: root }),
			},
		});
		try {
			await vscode.tasks.executeTask(task);
		} catch (error) {
			log.error(`Задача с выводом контейнера ${container} не запустилась: ${(error as Error).message}`);
		}
		return { container, exited: started.exited };
	}

	/**
	 * Docker-образ проекта из настройки `docker.image`.
	 *
	 * @returns Docker-образ для выполнения команд
	 * @throws {Error} Если образ не указан
	 */
	public getDockerImage(): string {
		const image = projectConfiguration(this.getEffectiveRoot()).get<string>('docker.image', '').trim();
		if (!image) {
			throw new Error(
				'Docker-образ не указан в настройках. Укажите образ в настройках расширения ' +
				'(1c-platform-tools.docker.image), например "ghcr.io/yellow-hammer/1c-nest/vrunner:8.3.27". ' +
				'В образе должны быть платформа 1С:Предприятие и vanessa-runner.'
			);
		}
		return image;
	}

	/**
	 * Переносит пути аргументов в контейнер: путь внутри проекта становится
	 * относительным от `/workspace`, путь в смонтированном каталоге получает его путь
	 * в контейнере. Пути внутри `--additional` переводятся в пути контейнера.
	 *
	 * @param args - Аргументы команды vrunner
	 * @param mounts - Каталоги хоста сверх каталога проекта
	 * @returns Аргументы с путями контейнера
	 */
	public processCommandArgsForDocker(args: string[], mounts: readonly DockerMount[] = []): string[] {
		const workspaceRoot = this.getEffectiveRoot();
		if (!workspaceRoot) {
			return args;
		}
		return args.map((arg, index) => {
			if (index > 0 && args[index - 1] === '--ibconnection') {
				return normalizeIbPathForDocker(arg, workspaceRoot);
			}
			if (index > 0 && args[index - 1] === '--additional') {
				return containerPathsInText(arg, [{ host: workspaceRoot, container: CONTAINER_WORKSPACE }, ...mounts]);
			}
			if (!path.isAbsolute(arg)) {
				return arg;
			}
			if (isInsideDir(workspaceRoot, arg)) {
				return `./${path.relative(workspaceRoot, arg).replaceAll('\\', '/')}`;
			}
			return containerPath(arg, mounts) ?? arg;
		});
	}

	/**
	 * Путь файла проекта так, как его видит раннер.
	 *
	 * В Docker проект смонтирован в `/workspace`: путь, который уходит внутрь файлов
	 * настроек и составных аргументов, должен быть путём контейнера.
	 *
	 * @param hostPath - Абсолютный путь на этой машине
	 * @returns Путь для раннера
	 */
	public async runnerPath(hostPath: string): Promise<string> {
		const root = this.getEffectiveRoot();
		if (!root || !(await this.shouldUseDocker())) {
			return hostPath;
		}
		return containerPath(hostPath, [{ host: root, container: CONTAINER_WORKSPACE }]) ?? hostPath;
	}

	/**
	 * Готовит запуск команд vrunner в контейнере.
	 *
	 * Контейнеру видны каталог проекта и временный каталог проекта EDT: путь или
	 * файловая база вне них отклоняют запуск до старта контейнера.
	 *
	 * @param argsArray - Наборы аргументов команд vrunner
	 * @returns Подготовленный запуск либо причина отказа
	 */
	private dockerPlan(argsArray: readonly string[][]): DockerPlan | { error: string } {
		const root = this.getEffectiveRoot();
		if (!root) {
			return { error: 'Для использования Docker необходимо открыть рабочую область' };
		}
		let image: string;
		try {
			image = this.getDockerImage();
		} catch (error) {
			return { error: (error as Error).message };
		}
		const extra: DockerMount[] = isEdtProject(root)
			? [{ host: edtTemporaryDir(root), container: EDT_STAGING_IN_CONTAINER }]
			: [];
		const visible: DockerMount[] = [{ host: root, container: CONTAINER_WORKSPACE }, ...extra];
		const processed = argsArray.map((args) => this.processCommandArgsForDocker([...args], extra));
		for (const args of processed) {
			const outside = argumentValues(args)
				.map((value) => hostPathOutside(value, visible, fsSync.existsSync))
				.find((found) => found !== undefined);
			if (outside !== undefined) {
				return { error: `В Docker раннеру виден только каталог проекта, а ${outside} лежит вне его` };
			}
			const infobase = this.dockerInfobaseOutside(args, root);
			if (infobase !== undefined) {
				return { error: `В Docker раннеру виден только каталог проекта, а база ${infobase} лежит вне его` };
			}
		}
		const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root))?.uri.fsPath;
		const used = (mount: DockerMount): boolean =>
			processed.some((args) =>
				argumentValues(args).some((value) => value === mount.container || value.startsWith(`${mount.container}/`))
			);
		const runArgs = this.dockerRunArgsSetting(root);
		return {
			image,
			argsArray: processed,
			root: dockerMountSource(root, folder, process.env.LOCAL_WORKSPACE_FOLDER),
			options: {
				mounts: extra.filter(used),
				runArgs: withWindow.getStore() === true ? runArgs : withoutPublishedPorts(runArgs),
			},
		};
	}

	/**
	 * Файловая база вне каталога проекта: из `--ibconnection` команды, иначе из файла
	 * настроек (`--settings` команды или активного профиля).
	 *
	 * @param args - Аргументы команды с путями контейнера
	 * @param root - Каталог проекта
	 * @returns Путь базы из строки подключения или undefined
	 */
	private dockerInfobaseOutside(args: readonly string[], root: string): string | undefined {
		if (args.length === 0 || NO_INFOBASE_COMMANDS.has(args[0])) {
			return undefined;
		}
		const connectionAt = args.indexOf('--ibconnection');
		if (connectionAt >= 0) {
			const connection = args[connectionAt + 1];
			return connection === undefined ? undefined : fileInfobaseOutside(connection, root);
		}
		const settingsAt = args.indexOf('--settings');
		const settingsFile = settingsAt >= 0 ? args[settingsAt + 1] : this.getActiveEnvFile();
		if (settingsFile === undefined) {
			return undefined;
		}
		try {
			const schema = this.activeSettingsSchema();
			const layers = this.readSettingsLayersSync(root, settingsFile, schema);
			const connection = this.profileOptionValue(layers, schema, 'ibconnection');
			return connection === undefined ? undefined : fileInfobaseOutside(connection, root);
		} catch {
			return undefined;
		}
	}

	/**
	 * Параметры `docker run` проекта из настройки `docker.runArgs`.
	 *
	 * @param root - Каталог проекта
	 */
	private dockerRunArgsSetting(root: string): string[] {
		const value = projectConfiguration(root).get<unknown>('docker.runArgs', []);
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [];
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
		const root = this.getEffectiveRoot();
		return args.map((arg) => {
			// Преобразуем абсолютные пути в относительные, если они внутри workspace
			if (root && path.isAbsolute(arg)) {
				if (fsSync.existsSync(arg) && arg.startsWith(root)) {
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
	 * Путь oscript после {@link checkOscriptAvailable}.
	 *
	 * @returns Абсолютный путь, имя из PATH или undefined, если oscript не найден
	 */
	public getResolvedOscriptPath(): string | undefined {
		return this.resolvedOscriptPath;
	}

	/**
	 * Каталог bin выбранной установки OneScript, если она найдена по абсолютному пути.
	 *
	 * @param resolved - Путь oscript
	 * @returns Путь к каталогу bin или undefined, когда используется PATH
	 */
	private oscriptBinDir(resolved = this.resolvedOscriptPath): string | undefined {
		return resolved !== undefined && path.isAbsolute(resolved) ? path.dirname(resolved) : undefined;
	}

	/**
	 * Окружение дочернего процесса: каталог выбранной установки OneScript идёт
	 * в PATH первым и ставится в OVM_OSCRIPTBIN.
	 *
	 * Обёртки `opm.bat` и `vrunner.bat` запускают `oscript` по имени, поэтому без
	 * этого движок взялся бы из той установки, что стоит в PATH раньше, а это не
	 * обязательно выбранная.
	 *
	 * @param extra - Дополнительные переменные окружения
	 * @param binDir - Каталог bin вместо выбранной установки (для проверок при поиске)
	 * @returns Окружение для exec, spawn и задач
	 */
	private childEnv(extra?: NodeJS.ProcessEnv, binDir = this.oscriptBinDir()): NodeJS.ProcessEnv {
		return withSelectedEngine({ ...process.env, ...extra }, binDir);
	}

	/**
	 * Окружение процесса, который запускает инструменты OneScript по имени, с
	 * тем же движком, что у команд vrunner и opm.
	 *
	 * @param extra - Дополнительные переменные окружения
	 * @returns Окружение для spawn и задач
	 */
	public async oneScriptEnv(extra?: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
		await this.checkOscriptAvailable();
		return this.childEnv(extra);
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
	public shouldUseTasks(): boolean {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<boolean>('execution.useTasks', true);
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
			/** Общий терминал шагов одной команды: без него задача очищает терминал */
			output?: TaskOutputChain;
		}
	): Promise<vscode.Task | undefined> {
		await this.getVRunnerVersion();
		const finalArgs = options?.appendOverrides === false ? args : this.appendActiveOverrides(args);
		const cwd = options?.cwd || this.getEffectiveRoot() || os.homedir();
		const useDocker = await this.shouldUseDocker();

		const built = this.buildExecRun(finalArgs, useDocker, options?.translateRaw === true);
		if ('error' in built) {
			log.error(`Ошибка при подготовке команды: ${built.error}`);
			vscode.window.showErrorMessage(built.error);
			return undefined;
		}

		return createVRunnerTask({
			name: options?.name || '1C: Platform Tools',
			command: built.run,
			cwd,
			env: this.childEnv(options?.env),
			definition: options?.definition,
			exitCallback: options?.exitCallback,
			appendOutput: options?.output?.append(),
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
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; appendOverrides?: boolean; output?: TaskOutputChain }
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
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; appendOverrides?: boolean; output?: TaskOutputChain }
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
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; appendOverrides?: boolean; output?: TaskOutputChain }
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
		const cwd = options?.cwd || this.getEffectiveRoot() || os.homedir();
		const useDocker = await this.shouldUseDocker();
		let command: string | (() => CommandRun);

		if (useDocker) {
			const docker = this.dockerSequenceRun(finalArgsArray);
			if ('error' in docker) {
				log.error(`Ошибка при подготовке команды Docker: ${docker.error}`);
				vscode.window.showErrorMessage(docker.error);
				return;
			}
			command = docker.run;
		} else {
			// && одинаково работает в cmd и sh (оболочки spawn для задач)
			command = finalArgsArray.map((args) => buildProcessCommand(this.getVRunnerPath(), args)).join(' && ');
		}

		const task = createVRunnerTask({
			name: options?.name || '1C: Platform Tools',
			command,
			cwd,
			env: this.childEnv(options?.env),
			appendOutput: options?.output?.append(),
		});
		await vscode.tasks.executeTask(task);
	}

	/**
	 * Запуск последовательности команд vrunner в одном контейнере.
	 *
	 * @param argsArray - Наборы аргументов команд vrunner
	 * @returns Построитель запуска для задачи (новое имя контейнера на каждый запуск) либо причина отказа
	 */
	private dockerSequenceRun(argsArray: readonly string[][]): { run: () => CommandRun } | { error: string } {
		const plan = this.dockerPlan(argsArray);
		if ('error' in plan) {
			return plan;
		}
		return {
			run: () => dockerCommandRun((containerName) =>
				buildDockerCommandSequence(plan.image, plan.argsArray, plan.root, PROCESS_HOST_SHELL, { ...plan.options, containerName })
			),
		};
	}

	/**
	 * Запускает последовательность команд vrunner как одну задачу VS Code и ожидает завершения.
	 *
	 * @returns Промис с exit code задачи (0 — успех).
	 */
	public async executeVRunnerTaskSequenceAndWait(
		argsArray: string[][],
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; appendOverrides?: boolean; output?: TaskOutputChain }
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
		const cwd = options?.cwd || this.getEffectiveRoot() || os.homedir();
		const useDocker = await this.shouldUseDocker();
		let command: string | (() => CommandRun);

		if (useDocker) {
			const docker = this.dockerSequenceRun(finalArgsArray);
			if ('error' in docker) {
				log.error(`Ошибка при подготовке команды Docker: ${docker.error}`);
				vscode.window.showErrorMessage(docker.error);
				return 1;
			}
			command = docker.run;
		} else {
			command = finalArgsArray.map((args) => buildProcessCommand(this.getVRunnerPath(), args)).join(' && ');
		}

		let resolveExit!: (exitCode: number) => void;
		const exitPromise = new Promise<number>((resolve) => {
			resolveExit = resolve;
		});
		const task = createVRunnerTask({
			name: options?.name || '1C: Platform Tools',
			command,
			cwd,
			env: this.childEnv(options?.env),
			exitCallback: resolveExit,
			appendOutput: options?.output?.append(),
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
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; shellType?: ShellType; appendOverrides?: boolean; output?: TaskOutputChain }
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
		const cwd = options?.cwd || this.getEffectiveRoot() || os.homedir();
		const shellType = options?.shellType || detectShellType();

		const useDocker = await this.shouldUseDocker();
		
		let command: string;
		
		if (useDocker) {
			const plan = this.dockerPlan([args]);
			if ('error' in plan) {
				log.error(`Ошибка при подготовке команды Docker: ${plan.error}`);
				vscode.window.showErrorMessage(plan.error);
				return;
			}
			command = buildDockerCommand(plan.image, plan.argsArray[0], plan.root, shellType, plan.options);
			log.debug(`Docker: образ=${plan.image}, args=${plan.argsArray[0].join(' ')}`);
		} else {
			const vrunnerPath = this.getVRunnerPath();
			const processedArgs = this.processCommandArgs(args, cwd, shellType);
			command = buildCommand(vrunnerPath, processedArgs, shellType);
		}

		const terminal = projectTerminal({ name: options?.name || '1C: Platform Tools', cwd, env: options?.env, root: this.getEffectiveRoot() });
		if (!terminal) {
			return;
		}
		// eslint-disable-next-line no-restricted-syntax -- execution.useTasks === false: терминал выбран пользователем
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
		options?: { cwd?: string; env?: NodeJS.ProcessEnv; name?: string; shellType?: ShellType; appendOverrides?: boolean; output?: TaskOutputChain }
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

		const cwd = options?.cwd || this.getEffectiveRoot() || os.homedir();
		const shellType = options?.shellType || detectShellType();
		const useDocker = await this.shouldUseDocker();
		let command: string;

		if (useDocker) {
			const plan = this.dockerPlan(argsArray);
			if ('error' in plan) {
				log.error(`Ошибка при подготовке команды Docker: ${plan.error}`);
				vscode.window.showErrorMessage(plan.error);
				return;
			}
			command = buildDockerCommandSequence(plan.image, plan.argsArray, plan.root, shellType, plan.options);
			log.debug(`Docker (последовательно): образ=${plan.image}, команд=${plan.argsArray.length}`);
			const dockerTerminal = projectTerminal({ name: options?.name || '1C: Platform Tools', cwd, env: options?.env, root: this.getEffectiveRoot() });
			if (!dockerTerminal) {
				return;
			}
			// eslint-disable-next-line no-restricted-syntax -- execution.useTasks === false: терминал выбран пользователем
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

		const seqTerminal = projectTerminal({ name: options?.name || '1C: Platform Tools', cwd, env: options?.env, root: this.getEffectiveRoot() });
		if (!seqTerminal) {
			return;
		}
		// eslint-disable-next-line no-restricted-syntax -- execution.useTasks === false: терминал выбран пользователем
		seqTerminal.sendText(fullCommand);
		seqTerminal.show();
	}

	/**
	 * Строит запуск vrunner в child process
	 *
	 * Учитывает режим Docker (docker.enabled): в этом случае команда оборачивается
	 * в docker run, а пути нормализуются для контейнера.
	 *
	 * @param args - Аргументы команды vrunner
	 * @returns Построитель запуска (в Docker каждый вызов даёт новое имя контейнера
	 * и его остановку при отмене) либо текст ошибки подготовки
	 */
	private buildExecRun(args: string[], useDocker: boolean, translateRaw = false): { run: () => CommandRun } | { error: string } {
		// Трансляция синтаксиса применяется ТОЛЬКО к «сырым» аргументам задач
		// пользователя из tasks.json. Планы интентов уже финальные — повторная
		// обработка недопустима (парсер шима не обязан понимать синтаксис 3.x).
		if (translateRaw) {
			args = this.toCliArgs(args);
		}
		if (useDocker) {
			const plan = this.dockerPlan([args]);
			if ('error' in plan) {
				return plan;
			}
			return {
				run: () => dockerCommandRun((containerName) =>
					buildDockerCommand(plan.image, plan.argsArray[0], plan.root, PROCESS_HOST_SHELL, { ...plan.options, containerName })
				),
			};
		}

		const command = buildProcessCommand(this.getVRunnerPath(), args);
		return { run: () => ({ command }) };
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
		// Прогреваем версию: синхронные адаптации аргументов должны знать про 3.x.
		// Детект версии зовёт executeVRunnerRaw (минуя прогрев), поэтому рекурсии нет.
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
		if (untrustedWorkspaceBlocks(`vrunner ${args[0] ?? ''}`.trim())) {
			return untrustedExecutionResult();
		}
		const useDocker = await this.shouldUseDocker();
		const cwd = options?.cwd || this.getEffectiveRoot();

		return new Promise((resolve) => {
			const execOptions = {
				cwd: cwd,
				env: this.childEnv(options?.env),
				maxBuffer: MAX_EXEC_BUFFER_SIZE,
				encoding: 'buffer' as const
			};
			const finish = (error: ExecException | null, stdout: Buffer, stderr: Buffer): void => {
				const errorOutput = decodeProcessOutput(stderr);
				// процесс, который не удалось запустить, ничего не пишет в stderr: причина только в ошибке
				const notStarted = error !== null && typeof error.code !== 'number';
				resolve({
					success: !error,
					stdout: decodeProcessOutput(stdout),
					stderr: notStarted && errorOutput === '' ? error.message : errorOutput,
					exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0
				});
			};
			// фактическая команда и cwd в логе: без этого не разобрать, какой
			// vrunner исполнился (локальный из oscript_modules или из PATH)
			const logCommand = (command: string): void => log.info(`exec: ${command} (cwd: ${cwd ?? 'не задан'})`);

			if (useDocker) {
				const plan = this.dockerPlan([args]);
				if ('error' in plan) {
					resolve({ success: false, stdout: '', stderr: plan.error, exitCode: 1 });
					return;
				}
				const options = { ...plan.options, containerName: dockerContainerName() };
				logCommand(buildDockerCommand(plan.image, plan.argsArray[0], plan.root, PROCESS_HOST_SHELL, options));
				// docker получает аргументы списком, без оболочки
				execFile('docker', dockerRunArgs(plan.image, plan.argsArray[0], plan.root, options), execOptions, finish);
				return;
			}

			// vrunner.bat запускается только через cmd, и oscript нужен chcp 65001 для кириллицы
			const command = buildProcessCommand(this.getVRunnerPath(), args);
			logCommand(command);
			exec(command, execOptions, finish);
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
		const built = this.buildExecRun(args, useDocker);
		if ('error' in built) {
			return {
				success: false,
				stdout: '',
				stderr: built.error,
				exitCode: 1,
				cancelled: false
			};
		}

		const run = built.run();
		return runCancellableCommand(run.command, {
			cwd: options?.cwd || this.getEffectiveRoot(),
			env: this.childEnv({ ...options?.env, ...run.env }),
			token: options?.token,
			onOutput: options?.onOutput,
			onCancel: run.onCancel,
			onCancelled: run.onCancelled,
			onExit: run.onExit
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
		const cwd = options?.cwd || this.getEffectiveRoot() || os.homedir();
		const command = buildProcessCommand(opmPath, [...leadingArgs, ...args]);
		const task = createVRunnerTask({
			name: options?.name || '1C: Platform Tools',
			command,
			cwd,
			env: this.childEnv(options?.env),
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
		const cwd = options?.cwd || this.getEffectiveRoot() || os.homedir();
		const processedArgs = this.processCommandArgs([...leadingArgs, ...args], cwd, shellType);
		const command = buildCommand(opmPath, processedArgs, shellType);

		const opmTerminal = projectTerminal({ name: options?.name || '1C: Platform Tools', cwd, root: this.getEffectiveRoot() });
		if (!opmTerminal) {
			return;
		}
		// eslint-disable-next-line no-restricted-syntax -- execution.useTasks === false: терминал выбран пользователем
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
		if (untrustedWorkspaceBlocks(`opm ${args[0] ?? ''}`.trim())) {
			return untrustedExecutionResult();
		}
		return new Promise((resolve) => {
			const { path: opmPath, leadingArgs } = this.getOpmInvocation();
			const command = buildProcessCommand(opmPath, [...leadingArgs, ...args]);

			const execOptions = {
				cwd: options?.cwd || this.getEffectiveRoot(),
				maxBuffer: MAX_EXEC_BUFFER_SIZE,
				encoding: 'buffer' as const
			};

			exec(command, execOptions, (error, stdout, stderr) => {
				const result: VRunnerExecutionResult = {
					success: !error,
					stdout: decodeProcessOutput(stdout),
					stderr: decodeProcessOutput(stderr),
					exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0
				};

				resolve(result);
			});
		});
	}

	/**
	 * Выполняет команду allure синхронно (для проверок)
	 * 
	 * Используется для проверок и валидации, а не для выполнения команд пользователю.
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
		if (untrustedWorkspaceBlocks(`allure ${args[0] ?? ''}`.trim())) {
			return untrustedExecutionResult();
		}
		return new Promise((resolve) => {
			const command = buildProcessCommand(this.getAllurePath(), args);

			const execOptions = {
				cwd: options?.cwd || this.getEffectiveRoot(),
				maxBuffer: MAX_EXEC_BUFFER_SIZE,
				encoding: 'buffer' as const
			};

			exec(command, execOptions, (error, stdout, stderr) => {
				const result: VRunnerExecutionResult = {
					success: !error,
					stdout: decodeProcessOutput(stdout),
					stderr: decodeProcessOutput(stderr),
					exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0
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
	 * Настройки активного профиля вместе со схемой.
	 *
	 * Схема определяется по установленной версии vrunner: env.json (2.x) или
	 * autumn-properties.json (3.x). Значения опций внутри читаются с учётом
	 * схемы (см. settingValue в projectTestConfig).
	 *
	 * @returns Настройки, как их видит vanessa-runner (см. {@link readSettingsLayers}), и схема
	 */
	public async readActiveSettings(): Promise<{ settings: Record<string, unknown>; schema: SettingsSchema }> {
		await this.getVRunnerVersion();
		return this.readSettingsLayers(this.getActiveEnvFile(), this.activeSettingsSchema());
	}

	public async readEnvJson(fileName: string = BASE_ENV_FILE): Promise<any> {
		const root = this.getEffectiveRoot();
		if (!root) {
			throw new Error('Рабочая область не открыта');
		}

		const envPath = path.join(root, fileName);
		try {
			return await readSettingsJson(envPath);
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
		const root = this.getEffectiveRoot();
		if (!root) {
			throw new Error('Рабочая область не открыта');
		}

		const envPath = path.join(root, 'env.json');
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
		const fromState = projectMemento().get<string>(ACTIVE_ENV_PROFILE_STATE);
		if (typeof fromState === 'string' && fromState) {
			return fromState;
		}
		const configured = projectConfiguration(this.getEffectiveRoot()).get<string>('env.defaultProfile', DEFAULT_ENV.defaultProfile);
		if (configured) {
			return configured;
		}
		return DEFAULT_PROFILE_ID;
	}

	/**
	 * Сохраняет id активного env-профиля в состоянии текущего проекта (локально, не коммитится)
	 *
	 * @param profileId - Идентификатор профиля (пустая строка — базовый env.json)
	 * @returns Промис завершения записи
	 */
	public async setActiveEnvProfileId(profileId: string): Promise<void> {
		await projectMemento().update(ACTIVE_ENV_PROFILE_STATE, profileId);
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
		const root = this.getEffectiveRoot();
		if (root) {
			try {
				fileNames = fsSync
					.readdirSync(root, { withFileTypes: true })
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
	 * @returns Временные параметры из состояния текущего проекта или undefined
	 */
	public getActiveEnvOverrides(): EnvOverrides | undefined {
		const raw = projectMemento().get<EnvOverrides>(ACTIVE_ENV_OVERRIDES_STATE);
		return raw && hasOverrides(raw) ? raw : undefined;
	}

	/**
	 * Сохраняет временные параметры активного профиля в состоянии текущего проекта (локально, не коммитится)
	 *
	 * @param overrides - Временные параметры или undefined для сброса
	 * @returns Промис завершения записи
	 */
	public async setActiveEnvOverrides(overrides: EnvOverrides | undefined): Promise<void> {
		const value = overrides && hasOverrides(overrides) ? overrides : undefined;
		await projectMemento().update(ACTIVE_ENV_OVERRIDES_STATE, value);
		this._onDidChangeEnvOverrides.fire();
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
	 * Имя каталога текущей ветки git для подстановки `${gitBranch}`.
	 *
	 * Читается по `.git/HEAD` на момент вызова: переключение ветки подхватывает
	 * следующая команда, без перезагрузки окна и слежения за HEAD.
	 *
	 * @returns Нормализованное имя ветки или undefined вне репозитория git
	 */
	public getGitBranchDirName(): string | undefined {
		const root = this.getEffectiveRoot();
		return root ? readGitBranchDirName(root) : undefined;
	}

	/**
	 * Имя ветки для подстановки; вне репозитория git — однократное предупреждение.
	 *
	 * Команду отсутствие ветки не роняет: значение остаётся как есть, литеральный
	 * путь виден в журнале и легко диагностируется.
	 *
	 * @returns Имя каталога ветки или undefined вне репозитория git
	 */
	private resolveGitBranchForSubstitution(): string | undefined {
		const branch = this.getGitBranchDirName();
		if (branch === undefined) {
			const root = this.getEffectiveRoot() ?? '';
			if (!this.warnedGitBranchRoots.has(root)) {
				this.warnedGitBranchRoots.add(root);
				const message = `В профиле запуска используется ${GIT_BRANCH_VARIABLE}, но проект не в репозитории git: подстановка пропущена.`;
				log.warn(message);
				void vscode.window.showWarningMessage(message);
			}
		}
		return branch;
	}

	/**
	 * Подставляет `${gitBranch}` в значение опции запуска.
	 *
	 * @param value - Значение опции
	 * @returns Значение с подставленной веткой (или исходное вне репозитория)
	 */
	private substituteLaunchValue(value: string): string {
		if (!containsGitBranchVariable(value)) {
			return value;
		}
		const branch = this.resolveGitBranchForSubstitution();
		return branch === undefined ? value : substituteGitBranch(value, branch);
	}

	/**
	 * Подставляет `${gitBranch}` во все заданные поля перекрытий.
	 *
	 * Ветка читается из `.git/HEAD` один раз на весь набор, а не на каждое поле.
	 *
	 * @param overrides - Перекрытия с возможными переменными
	 * @returns Перекрытия с подставленными значениями
	 */
	private substituteOverrideValues(overrides: EnvOverrides): EnvOverrides {
		const entries = Object.entries(overrides) as [keyof EnvOverrides, string][];
		if (!entries.some(([, value]) => containsGitBranchVariable(value))) {
			return overrides;
		}
		const branch = this.resolveGitBranchForSubstitution();
		if (branch === undefined) {
			return overrides;
		}
		const result: EnvOverrides = {};
		for (const [field, value] of entries) {
			result[field] = substituteGitBranch(value, branch);
		}
		return result;
	}

	/**
	 * Читает перекрытия из файла env.local.json в корне проекта.
	 *
	 * Файл читается на лету при каждом обращении (запуск команды, статус-бар):
	 * правка скриптом или git-хуком подхватывается без перезагрузки окна.
	 * Неподдержанные ключи отмечаются в журнале — один раз на содержимое.
	 *
	 * @returns Перекрытия из файла или undefined, если файла нет или он не JSON
	 */
	public readLocalEnvOverrides(): EnvOverrides | undefined {
		const root = this.getEffectiveRoot();
		if (!root) {
			return undefined;
		}
		const localPath = path.join(root, LOCAL_OVERRIDES_FILE);
		let content: string;
		try {
			content = fsSync.readFileSync(localPath, 'utf8');
		} catch {
			return undefined;
		}
		let parsed: unknown;
		try {
			parsed = parseSettingsJson(content);
		} catch {
			const warnKey = `${localPath}::parse`;
			if (!this.warnedLocalOverrideKeys.has(warnKey)) {
				this.warnedLocalOverrideKeys.add(warnKey);
				log.warn(`${LOCAL_OVERRIDES_FILE}: файл не разобран как JSON, перекрытия не применяются`);
			}
			return undefined;
		}
		const { overrides, ignoredKeys } = parseLocalOverrides(parsed);
		if (ignoredKeys.length > 0) {
			const warnKey = `${localPath}::${ignoredKeys.join(',')}`;
			if (!this.warnedLocalOverrideKeys.has(warnKey)) {
				this.warnedLocalOverrideKeys.add(warnKey);
				log.warn(
					`${LOCAL_OVERRIDES_FILE}: ключи не поддержаны и пропущены: ${ignoredKeys.join(', ')}. ` +
					'Флагами передаются --ibconnection, --db-user, --db-pwd, --v8version, --additional.'
				);
			}
		}
		return hasOverrides(overrides) ? overrides : undefined;
	}

	/**
	 * Признак действующих перекрытий из env.local.json
	 *
	 * @returns true, если файл существует и содержит поддержанные значения
	 */
	public hasLocalEnvOverrides(): boolean {
		return this.readLocalEnvOverrides() !== undefined;
	}

	/**
	 * Значения активного профиля, содержащие `${gitBranch}` (без подстановки).
	 *
	 * vanessa-runner сам читает файл настроек и переменных не понимает, поэтому
	 * такие значения расширение материализует флагами поверх профиля. Значения
	 * без переменных флагами не дублируются — каскад настроек vrunner остаётся
	 * за файлом.
	 *
	 * @returns Перекрытия из значений профиля с переменными (может быть пусто)
	 */
	private readProfileVariableOverrides(): EnvOverrides {
		const root = this.getEffectiveRoot();
		if (!root) {
			return {};
		}
		const settings = this.readSettingsLayersSync(root, this.getActiveEnvFile(), this.activeSettingsSchema());
		// секции default (2.x) / vrunner (3.x) разбирает parseLocalOverrides
		const { overrides } = parseLocalOverrides(settings);
		const withVariables: EnvOverrides = {};
		for (const [field, value] of Object.entries(overrides) as [keyof EnvOverrides, string][]) {
			if (containsGitBranchVariable(value)) {
				withVariables[field] = value;
			}
		}
		return withVariables;
	}

	/**
	 * Эффективные перекрытия активного профиля с подстановкой `${gitBranch}`.
	 *
	 * Слои по приоритету (выше — важнее):
	 * 1. временные параметры из интерфейса;
	 * 2. файл env.local.json;
	 * 3. значения активного профиля, содержащие переменные.
	 *
	 * @returns Слитые перекрытия или undefined, если перекрытий нет
	 */
	public getEffectiveEnvOverrides(): EnvOverrides | undefined {
		const merged = mergeEnvOverrides(
			mergeEnvOverrides(this.readProfileVariableOverrides(), this.readLocalEnvOverrides()),
			this.getActiveEnvOverrides()
		);
		return merged ? this.substituteOverrideValues(merged) : undefined;
	}

	/**
	 * Возвращает флаги vrunner для действующих перекрытий: временные параметры,
	 * env.local.json и значения профиля с `${gitBranch}` — уже подставленные.
	 *
	 * @returns Массив аргументов (может быть пустым)
	 */
	public getActiveEnvOverrideArgs(): string[] {
		return buildOverrideArgs(this.getEffectiveEnvOverrides());
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
	 * Читает значение опции из настроек активного профиля с учётом схемы:
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
		return this.readSettingsFileOption(this.getActiveEnvFile(), option);
	}

	/**
	 * Читает значение опции из настроек, которые vanessa-runner видит с этим
	 * файлом, по схеме установленного vrunner.
	 *
	 * @param settingsFile - Файл настроек: абсолютный путь или путь от корня проекта
	 * @param option - Имя опции без префикса (например 'ibconnection')
	 * @returns Значение опции или undefined
	 */
	private async readSettingsFileOption(settingsFile: string, option: string): Promise<string | undefined> {
		if (!this.getEffectiveRoot()) {
			return undefined;
		}
		const { settings, schema } = await this.readSettingsLayers(settingsFile, this.activeSettingsSchema());
		return this.profileOptionValue(settings, schema, option);
	}

	/**
	 * Строка подключения к ИБ активного профиля: перекрытие (временный параметр,
	 * env.local.json) либо значение из файла настроек — с подстановкой
	 * `${gitBranch}`; по умолчанию — файловая ИБ build/ib (как у vanessa-runner).
	 *
	 * @returns Строка подключения (например '/F./build/ib')
	 */
	public async getActiveIbConnectionValue(): Promise<string> {
		return (await this.getConfiguredIbConnection()) ?? DEFAULT_IB_CONNECTION;
	}

	/**
	 * Строка подключения к ИБ, с которой выполнится команда. С явным файлом
	 * настроек вызова значение берётся из этого файла без перекрытий активного
	 * профиля, как в плане команды; без файла это {@link getActiveIbConnectionValue}.
	 *
	 * @param settingsFile - Файл настроек вызова
	 * @returns Строка подключения (например '/F./build/ib')
	 */
	public async getIbConnectionValue(settingsFile?: string): Promise<string> {
		return (await this.getConfiguredIbConnection(settingsFile)) ?? DEFAULT_IB_CONNECTION;
	}

	/**
	 * Строка подключения к ИБ, заданная для команды, без значения по умолчанию:
	 * без неё vanessa-runner собирает и разбирает файлы во временной базе.
	 *
	 * @param settingsFile - Файл настроек вызова
	 * @returns Строка подключения или undefined, если её не задают ни перекрытия, ни файл настроек
	 */
	public async getConfiguredIbConnection(settingsFile?: string): Promise<string | undefined> {
		if (settingsFile) {
			return this.readSettingsFileOption(settingsFile, 'ibconnection');
		}
		return this.getEffectiveEnvOverrides()?.ibConnection || (await this.readActiveProfileSetting('ibconnection'));
	}

	/**
	 * Учётная запись пользователя ИБ, с которой работают команды профиля.
	 *
	 * Для собственных запросов расширения к базе (стандартный интерфейс OData):
	 * секрет берётся из профиля, а не передаётся в вызове. С явным файлом
	 * настроек значения берутся из него, иначе перекрытия активного профиля
	 * (временные параметры, env.local.json) идут поверх его файла.
	 *
	 * @param settingsFile - Файл настроек вызова
	 * @returns Имя и пароль (пустые строки, если не заданы)
	 */
	public async getIbCredentials(settingsFile?: string): Promise<{ user: string; password: string }> {
		if (settingsFile) {
			return {
				user: (await this.readSettingsFileOption(settingsFile, 'db-user')) ?? '',
				password: (await this.readSettingsFileOption(settingsFile, 'db-pwd')) ?? '',
			};
		}
		const overrides = this.getEffectiveEnvOverrides();
		return {
			user: overrides?.dbUser || (await this.readActiveProfileSetting('db-user')) || '',
			password: overrides?.dbPwd || (await this.readActiveProfileSetting('db-pwd')) || '',
		};
	}

	/**
	 * Возвращает версию платформы 1С активного профиля (`--v8version`).
	 *
	 * Единый источник версии платформы для команд расширения: сначала перекрытие
	 * (временный параметр, env.local.json), затем `default["--v8version"]`
	 * активного env-профиля.
	 *
	 * @returns Версия платформы или undefined, если не задана
	 */
	public async getActiveV8Version(): Promise<string | undefined> {
		const override = this.getEffectiveEnvOverrides()?.v8version;
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
		return this.getEffectiveRoot();
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


