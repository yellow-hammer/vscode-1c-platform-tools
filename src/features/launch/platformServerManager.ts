/**
 * Менеджер автономного сервера 1С (ibsrv).
 *
 * Поднимает долгоживущий процесс `ibsrv` для файловой ИБ проекта: находит бинарь
 * платформы, генерирует конфиг публикации, следит за жизненным циклом процесса и
 * готовностью HTTP-эндпоинта. Параметры сервера (порт, путь данных, версия
 * платформы) берутся из настроек расширения — env.json регламентирован vanessa-runner
 * и здесь не используется как источник порта.
 *
 * Стабильный порт делает сервер attach-совместимым с vanessa-runner 3
 * (`--ibsrv-attach --ibsrv-port`).
 */

import * as vscode from 'vscode';
import { spawn, exec, ChildProcess } from 'node:child_process';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { resolveFileIbAbsolutePath } from '../../shared/ibConnectionPath';
import { logger, revealOutputChannel } from '../../shared/logger';
import { notifyQuiet } from '../../shared/notify';
import { ProcessOutputDecoder } from '../../shared/processOutput';
import { PLATFORM_PATH_SETTING_TITLE, resolvePlatformBinaryInRoots } from '../../shared/platformBinary';
import { projectPlatformRoots } from '../../shared/platformSettings';
import {
	PublicationOptions,
	PublishedService,
	ServerUrls,
	buildServerConfigYaml,
	buildServerUrls,
	parseServerConfigParams,
} from '../../shared/ibsrvPublication';
import { loadProjectMetadataTree } from '../metadata/metadataTreeService';
import { extractPublishableServices, readHttpServiceRoots, PublishableService, PublishableServices } from './serverServices';
import type { InfobaseHolder } from '../../shared/exclusiveInfobase';
import { projectConfiguration } from '../../shared/projectConfiguration';
import { projectMemento, SERVER_PUBLICATION_STATE } from '../../shared/projectState';
import { currentRoot, runWithProject, sameProjectRoot } from '../../shared/workspaceProjects';
import { projectLabel } from '../../commands/projectScope';
import { ensureWorkspaceTrusted } from '../../shared/workspaceTrust';
import {
	childExit,
	pidSignalSender,
	settlesWithin,
	signalUntilExit,
	waitProcessGone,
	type ExitWaiter,
	type StopSignal,
} from '../../shared/processTermination';
import { findDataDirHolder } from '../../shared/ibsrvDataLock';

const log = logger.scope('server');

/** Имя информационной базы автономного сервера. */
const INFOBASE_NAME = 'DefAlias';

/** Кнопка перезапуска сервера для другого проекта. */
export const SWITCH_SERVER_PROJECT_ACTION = 'Остановить и запустить';

/**
 * Вопрос перед запуском сервера, когда он уже работает для другого проекта.
 *
 * @param owner - Имя проекта, для которого сервер запущен
 * @param target - Имя проекта, для которого его запускают
 */
export function serverProjectSwitchQuestion(owner: string, target: string): string {
	return `Автономный сервер проекта ${owner} запущен. Остановить его и запустить для ${target}?`;
}

/** Кнопка завершения ibsrv, который держит каталог данных сервера. */
export const STOP_DATA_DIR_HOLDER_ACTION = 'Завершить и запустить';

/**
 * Вопрос перед запуском сервера, когда его каталог данных держит другой процесс ibsrv.
 *
 * @param pid - Процесс, который держит каталог данных
 */
export function dataDirHolderQuestion(pid: number): string {
	return `Каталог данных автономного сервера занят процессом ibsrv (pid ${pid}). Завершить его и запустить сервер?`;
}

/**
 * Сообщение, когда процесс сервера не завершился.
 *
 * @param pid - Процесс ibsrv
 */
export function serverStopFailedMessage(pid: number | undefined): string {
	return `Автономный сервер не остановился: процесс ibsrv${pid === undefined ? '' : ` (pid ${pid})`} не завершается. Подробности в журнале сервера.`;
}

/**
 * Сохранённый выбор публикации (состояние проекта).
 *
 * `webAll`/`httpAll` — публиковать все сервисы категории; иначе публикуются
 * только перечисленные в `web`/`http`.
 */
export interface PublicationSelection {
	odata: boolean;
	webAll: boolean;
	web: string[];
	httpAll: boolean;
	/** HTTP-сервисы с корневыми URL: по ним ibsrv публикует пути `/hs/<root>`. */
	http: PublishedService[];
}

/** Состояние автономного сервера. */
export type ServerState = 'stopped' | 'starting' | 'running' | 'error';

/**
 * Настройки, влияющие на аргументы командной строки ibsrv.
 *
 * Пустые `directRegPort`/`directRange` означают умолчания платформы: аргумент не
 * передаётся вовсе.
 */
export interface ServerArgsSettings {
	debug: boolean;
	debugPort: number;
	directRegPort: string;
	directRange: string;
}

/** Разобранные настройки сервера. */
interface ServerSettings extends ServerArgsSettings {
	platformVersion: string;
	host: string;
	port: number;
	httpBase: string;
	dataPath: string;
	distributeLicenses: boolean;
	publication: PublicationOptions;
}

/** Таймаут ожидания готовности HTTP-эндпоинта, мс. */
const READINESS_TIMEOUT_MS = 60_000;
/** Интервал опроса готовности, мс. */
const READINESS_POLL_INTERVAL_MS = 500;
/** Таймаут ожидания фактического завершения процесса при остановке, мс. */
const STOP_EXIT_TIMEOUT_MS = 8_000;
/** Таймаут ожидания завершения после повторного сигнала, мс. */
const STOP_REPEAT_TIMEOUT_MS = 3_000;
/** Таймаут ожидания освобождения порта при остановке, мс. */
const STOP_PORT_TIMEOUT_MS = 8_000;

/**
 * Сигналы остановки ibsrv на macOS и Linux.
 *
 * На macOS ibsrv после первого SIGTERM останавливает сервер, но сам процесс
 * может не выйти и продолжать держать каталог данных. Повторный SIGTERM его
 * завершает, SIGKILL остаётся крайней мерой.
 */
const STOP_SIGNALS: readonly StopSignal[] = [
	{ signal: 'SIGTERM', waitMs: STOP_EXIT_TIMEOUT_MS },
	{ signal: 'SIGTERM', waitMs: STOP_REPEAT_TIMEOUT_MS },
	{ signal: 'SIGKILL', waitMs: STOP_REPEAT_TIMEOUT_MS },
];

/**
 * Собирает аргументы запуска ibsrv.
 *
 * Параметры сервера и публикации берутся из конфига; командной строкой передаём
 * каталог данных, конфиг, порты прямого соединения и (опционально) отладку.
 * Порты прямого соединения конфиг не поддерживает, поэтому только аргументы;
 * пустая настройка означает умолчание платформы и аргумент не добавляет.
 *
 * @param dataDir - Каталог данных сервера
 * @param configPath - Путь к конфигу публикации
 * @param settings - Настройки, влияющие на командную строку
 * @returns Аргументы запуска
 */
export function buildServerArgs(
	dataDir: string,
	configPath: string,
	settings: ServerArgsSettings
): string[] {
	const args = [`--data=${dataDir}`, `--config=${configPath}`];
	if (settings.directRegPort) {
		args.push(`--direct-regport=${settings.directRegPort}`);
	}
	if (settings.directRange) {
		args.push(`--direct-range=${settings.directRange}`);
	}
	if (settings.debug) {
		args.push('--debug=http', `--debug-port=${settings.debugPort}`);
	}
	return args;
}

export class PlatformServerManager {
	private child: ChildProcess | undefined;
	private _state: ServerState = 'stopped';
	/** Каталог ИБ, с которым сервер реально запущен (для детекта смены профиля). */
	private runningIbPath: string | undefined;
	/** Корень проекта, для которого сервер запущен. */
	private owner: string | undefined;
	private readonly output: vscode.OutputChannel;
	private readonly stateEmitter = new vscode.EventEmitter<ServerState>();
	private currentUrls: ServerUrls | undefined;
	private publicationConfigPath: string | undefined;
	/** Параметры (host/port/base), на которых реально поднят текущий процесс. */
	private activeConfig: { host: string; port: number; base: string } | undefined;
	/** Публикует ли текущий процесс стандартный интерфейс OData: по конфигу на момент запуска. */
	private activeODataPublished = false;
	/** Порт отладки текущего процесса, если сервер запущен с отладкой. */
	private activeDebugPort: number | undefined;
	private readonly willStopHooks = new Set<() => Promise<void>>();
	/** Идущая остановка: повторный вызов дожидается её, а не останавливает процесс второй раз. */
	private stopping: Promise<boolean> | undefined;

	/** Событие смены состояния сервера. */
	public readonly onDidChangeState = this.stateEmitter.event;

	constructor(
		private readonly vrunner: VRunnerManager,
		private readonly context: vscode.ExtensionContext
	) {
		this.output = vscode.window.createOutputChannel('1С: Автономный сервер');
	}

	/** Текущее состояние сервера. */
	public get state(): ServerState {
		return this._state;
	}

	/** Корень проекта, для которого сервер запущен или запускается. */
	public get ownerRoot(): string | undefined {
		return this._state === 'running' || this._state === 'starting' ? this.owner : undefined;
	}

	/**
	 * Держатель файловой базы для команд с монопольным доступом: возвращает
	 * сервер тому проекту, для которого он работал.
	 */
	public infobaseHolder(): InfobaseHolder {
		let released: string | undefined;
		return {
			label: 'Автономный сервер',
			heldInfobase: () => (this.ownerRoot === undefined ? undefined : this.runningIbPath),
			release: () => {
				released = this.owner;
				// Сообщение о неудаче показывает команда, которой нужна база
				return this.shutdown();
			},
			restore: () => this.start(released),
		};
	}

	/** Адреса опубликованной ИБ (доступны при running). */
	public getUrls(): ServerUrls | undefined {
		return this.currentUrls;
	}

	/**
	 * Адреса публикации (без требования запущенного сервера).
	 *
	 * Если конфиг публикации уже существует, параметры берутся из него (учитывая
	 * ручные правки порта); иначе — из настроек расширения.
	 *
	 * @param workspaceRoot - Корень проекта
	 * @returns Набор URL, как они будут выглядеть при запуске
	 */
	public async previewUrls(workspaceRoot: string | undefined = currentRoot()): Promise<ServerUrls> {
		const settings = this.readSettings(workspaceRoot);
		if (workspaceRoot) {
			const params = await this.readConfigParams(this.getConfigPath(workspaceRoot, settings), settings);
			return buildServerUrls(params.host, params.port, params.base);
		}
		return buildServerUrls(settings.host, settings.port, settings.httpBase);
	}

	/**
	 * Публикует ли запущенный сервер стандартный интерфейс OData.
	 *
	 * Решает конфиг, с которым процесс запущен: выбор сервисов после запуска
	 * вступает в силу только с перезапуском.
	 */
	public get publishesOData(): boolean {
		return this._state === 'running' && this.activeODataPublished;
	}

	/** HTTP-порт текущего/последнего запуска. */
	public get port(): number | undefined {
		return this.activeConfig?.port;
	}

	/** Порт отладки запущенного сервера; без отладки не задан. */
	public get debugPort(): number | undefined {
		return this.ownerRoot === undefined ? undefined : this.activeDebugPort;
	}

	/**
	 * Действие перед остановкой процесса сервера, пока он ещё отвечает.
	 *
	 * @param hook - Действие; остановка ждёт его завершения
	 */
	public onWillStop(hook: () => Promise<void>): vscode.Disposable {
		this.willStopHooks.add(hook);
		return new vscode.Disposable(() => this.willStopHooks.delete(hook));
	}

	/**
	 * Запускает автономный сервер для проекта.
	 *
	 * Идемпотентно для того же проекта. Сервер другого проекта останавливается
	 * только после согласия пользователя.
	 *
	 * @param workspaceRoot - Корень проекта; по умолчанию текущий
	 */
	public async start(workspaceRoot: string | undefined = currentRoot()): Promise<void> {
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('Откройте рабочую область проекта 1С.');
			return;
		}

		// Сервер публикует базу и конфиг проекта, а версию платформы берёт из его настроек
		if (!ensureWorkspaceTrusted('запуск автономного сервера')) {
			return;
		}

		// Новый процесс запускается только после выхода прежнего;
		// о неудаче остановки сообщает тот, кто её начал
		if (this.stopping && !(await this.shutdown())) {
			return;
		}

		if (this._state === 'running' || this._state === 'starting') {
			const owner = this.owner;
			if (owner === undefined || sameProjectRoot(owner, workspaceRoot)) {
				notifyQuiet('Автономный сервер уже запущен');
				return;
			}
			const action = await vscode.window.showWarningMessage(
				serverProjectSwitchQuestion(projectLabel(owner), projectLabel(workspaceRoot)),
				SWITCH_SERVER_PROJECT_ACTION
			);
			if (action !== SWITCH_SERVER_PROJECT_ACTION) {
				return;
			}
			if (!(await this.stop())) {
				return;
			}
		} else if (this.child && !(await this.stop())) {
			// Процесс, который не удалось остановить раньше: пока он жив,
			// новый ibsrv на том же каталоге данных не стартует
			return;
		}

		await runWithProject(workspaceRoot, () => this.startIn(workspaceRoot));
	}

	/**
	 * Поднимает процесс ibsrv для проекта.
	 *
	 * @param workspaceRoot - Корень проекта
	 */
	private async startIn(workspaceRoot: string): Promise<void> {
		if (!this.vrunner.ensureLaunchReady()) {
			return;
		}
		const settings = this.readSettings(workspaceRoot);

		// Версия платформы: настройка сервера → --v8version активного профиля → наибольшая.
		const requestedVersion = settings.platformVersion || (await this.vrunner.getActiveV8Version()) || '';

		const bases = projectPlatformRoots(workspaceRoot);
		const binary = resolvePlatformBinaryInRoots(bases, 'ibsrv', { requestedVersion: requestedVersion || undefined });
		if (!binary) {
			const version = requestedVersion ? ` версии ${requestedVersion}` : '';
			vscode.window.showErrorMessage(
				`Не найден ibsrv${version}. Проверены каталоги: ${bases.join(', ')}. ` +
				`Укажите каталог установки платформы в настройке ${PLATFORM_PATH_SETTING_TITLE}.`
			);
			return;
		}

		const ibPath = await this.resolveFileInfobasePath(workspaceRoot);
		if (!ibPath) {
			return;
		}
		const dataDir = this.getDataDir(workspaceRoot, settings);
		if (!(await this.freeDataDir(dataDir))) {
			return;
		}
		this.runningIbPath = ibPath;
		this.owner = workspaceRoot;

		this.setState('starting');
		this.output.show(true);
		this.output.appendLine(`[${new Date().toLocaleTimeString()}] Запуск ibsrv: ${binary}`);

		const configPath = path.join(dataDir, 'publication.yaml');
		let params: { host: string; port: number; base: string; odata: boolean };
		try {
			await fs.mkdir(dataDir, { recursive: true });
			// Конфиг создаётся, только если его ещё нет — ручные правки сохраняются.
			if (!(await fileExists(configPath))) {
				await this.writeConfigFile(
					configPath,
					{ host: settings.host, port: settings.port, base: settings.httpBase, distributeLicenses: settings.distributeLicenses },
					ibPath,
					settings.publication
				);
			}
			params = await this.readConfigParams(configPath, settings);
		} catch (error) {
			this.fail(`Не удалось подготовить данные сервера: ${(error as Error).message}`);
			return;
		}
		this.publicationConfigPath = configPath;

		const args = buildServerArgs(dataDir, configPath, settings);
		this.output.appendLine(`Аргументы: ${args.join(' ')}`);

		const child = spawn(binary, args, { windowsHide: true, env: this.vrunner.launchEnv() });
		this.child = child;

		const stdoutDecoder = new ProcessOutputDecoder();
		const stderrDecoder = new ProcessOutputDecoder();
		child.stdout?.on('data', (chunk: Buffer) => this.output.append(stdoutDecoder.push(chunk)));
		child.stderr?.on('data', (chunk: Buffer) => this.output.append(stderrDecoder.push(chunk)));

		child.on('error', (error) => {
			this.fail(`Ошибка запуска ibsrv: ${error.message}`);
		});
		child.on('exit', (code, signal) => {
			// Остановленный нами или уже заменённый процесс состояние сервера не меняет
			if (this.child !== child) {
				return;
			}
			this.child = undefined;
			if (this._state === 'starting' || this._state === 'running') {
				// Незапланированное завершение
				this.output.appendLine(`ibsrv завершился (code=${code}, signal=${signal})`);
				this.currentUrls = undefined;
				this.activeConfig = undefined;
				this.setState(this._state === 'starting' ? 'error' : 'stopped');
			}
		});

		this.activeConfig = { host: params.host, port: params.port, base: params.base };
		this.activeODataPublished = params.odata;
		this.activeDebugPort = settings.debug ? settings.debugPort : undefined;
		this.currentUrls = buildServerUrls(params.host, params.port, params.base);

		const ready = await this.waitForReady(child);
		if (!ready) {
			return;
		}

		this.setState('running');
		this.output.appendLine(`Сервер готов: ${this.currentUrls.root}`);
		notifyQuiet(`1С: Автономный сервер запущен: ${this.currentUrls.root}`);
	}

	/**
	 * Останавливает автономный сервер (вместе с дочерними процессами).
	 *
	 * Если процесс так и не завершился, показывает ошибку. Процесс остаётся
	 * под присмотром менеджера: повторная остановка и запуск попробуют
	 * завершить его снова.
	 *
	 * @returns true, если сервер остановлен
	 */
	public async stop(): Promise<boolean> {
		if (await this.shutdown()) {
			return true;
		}
		void vscode.window.showErrorMessage(serverStopFailedMessage(this.child?.pid));
		return false;
	}

	/**
	 * Останавливает сервер без сообщений пользователю.
	 *
	 * Одновременные вызовы дожидаются одной и той же остановки.
	 *
	 * @returns true, если процесса сервера больше нет
	 */
	private shutdown(): Promise<boolean> {
		this.stopping ??= this.stopProcess().finally(() => {
			this.stopping = undefined;
		});
		return this.stopping;
	}

	/**
	 * Останавливает процесс сервера.
	 *
	 * Дожидается фактического завершения процесса и освобождения порта, чтобы
	 * последующий запуск (в т.ч. перезапуск) не наткнулся на занятый каталог
	 * данных или порт.
	 *
	 * @returns true, если процесса сервера больше нет
	 */
	private async stopProcess(): Promise<boolean> {
		const child = this.child;
		if (!child || child.pid === undefined) {
			this.setState('stopped');
			this.currentUrls = undefined;
			this.activeConfig = undefined;
			this.runningIbPath = undefined;
			this.owner = undefined;
			return true;
		}

		await Promise.all([...this.willStopHooks].map((hook) => hook().catch((error: unknown) => {
			log.warn(`перед остановкой сервера: ${(error as Error).message}`);
		})));
		if (this.child !== child) {
			// Процесс вышел сам, пока шли действия перед остановкой
			return true;
		}

		const active = this.activeConfig;
		const pid = child.pid;
		this.output.appendLine(`[${new Date().toLocaleTimeString()}] Остановка ibsrv (pid ${pid})`);
		// Состояние выставляем до kill, чтобы обработчик exit не счёл завершение аварийным.
		this.child = undefined;
		this.setState('stopped');
		this.currentUrls = undefined;

		if (!(await this.terminate(child))) {
			// Процесс жив и держит каталог данных: остаётся за менеджером, чтобы его видели
			// повторная остановка и запуск, а команды не открывали базу вслепую
			this.child = child;
			const message = `ibsrv (pid ${pid}) не завершился.`;
			log.error(message);
			this.output.appendLine(message);
			this.setState('error');
			return false;
		}
		if (active) {
			const freed = await this.waitPortFree(active.host, active.port, STOP_PORT_TIMEOUT_MS);
			if (!freed) {
				this.output.appendLine(`Порт ${active.port} всё ещё занят после остановки.`);
			}
		}
		this.activeConfig = undefined;
		this.runningIbPath = undefined;
		this.owner = undefined;
		return true;
	}

	/**
	 * Перезапускает сервер (корректно завершает текущий процесс перед стартом).
	 *
	 * Запущенный сервер перезапускается для своего проекта, остановленный
	 * запускается для текущего. Если процесс не остановился, новый не запускается.
	 */
	public async restart(): Promise<void> {
		const root = this.ownerRoot ?? currentRoot();
		if (await this.stop()) {
			await this.start(root);
		}
	}

	/** Показывает журнал сервера. */
	public showLogs(): void {
		revealOutputChannel(this.output);
	}

	/**
	 * Открывает конфиг публикации в редакторе, создавая его при отсутствии.
	 */
	public async openPublicationConfig(workspaceRoot: string | undefined = currentRoot()): Promise<void> {
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('Откройте рабочую область проекта 1С.');
			return;
		}
		const settings = this.readSettings(workspaceRoot);
		const configPath = this.getConfigPath(workspaceRoot, settings);

		if (!(await fileExists(configPath))) {
			const ibPath = await this.resolveFileInfobasePath(workspaceRoot, true);
			if (!ibPath) {
				vscode.window.showInformationMessage(
					'Конфиг публикации создаётся при запуске сервера. Для файловой ИБ укажите /F в профиле запуска.'
				);
				return;
			}
			await fs.mkdir(path.dirname(configPath), { recursive: true });
			await this.writeConfigFile(
				configPath,
				{ host: settings.host, port: settings.port, base: settings.httpBase, distributeLicenses: settings.distributeLicenses },
				ibPath,
				settings.publication
			);
		}
		this.publicationConfigPath = configPath;
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
		await vscode.window.showTextDocument(doc);
	}

	/**
	 * Освобождает ресурсы и останавливает сервер.
	 *
	 * Окно закрывается или перезагружается: дождаться выхода процесса и писать в
	 * журнал уже нельзя, поэтому сигнал остановки уходит сразу. Процесс, который
	 * после него не выйдет, следующий запуск сервера найдёт по `lock.pid`.
	 */
	public dispose(): void {
		const child = this.child;
		this.child = undefined;
		if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
			if (process.platform === 'win32') {
				void killWindowsProcessTree(child.pid);
			} else {
				child.kill('SIGTERM');
			}
		}
		this.stateEmitter.dispose();
		this.output.dispose();
	}

	private setState(state: ServerState): void {
		this._state = state;
		this.stateEmitter.fire(state);
	}

	private fail(message: string): void {
		log.error(message);
		this.output.appendLine(message);
		vscode.window.showErrorMessage(message);
		this.setState('error');
		this.currentUrls = undefined;
	}

	/**
	 * Читает настройки сервера проекта.
	 *
	 * @param workspaceRoot - Корень проекта
	 */
	private readSettings(workspaceRoot: string | undefined): ServerSettings {
		const config = projectConfiguration(workspaceRoot);
		return {
			platformVersion: config.get<string>('server.platformVersion', ''),
			host: config.get<string>('server.host', 'localhost'),
			port: config.get<number>('server.port', 8314),
			httpBase: config.get<string>('server.httpBase', 'ib'),
			dataPath: config.get<string>('server.path.data', ''),
			distributeLicenses: config.get<boolean>('server.distributeLicenses', true),
			debug: config.get<boolean>('server.debug', false),
			debugPort: config.get<number>('server.debugPort', 1550),
			directRegPort: config.get<string>('server.directRegPort', '').trim(),
			directRange: config.get<string>('server.directRange', '').trim(),
			publication: this.resolvePublication(workspaceRoot),
		};
	}

	/**
	 * Выбор публикуемых сервисов проекта.
	 *
	 * Если выбор ещё не сохранён, берётся из настроек `server.publish*`
	 * (по умолчанию — публиковать все категории).
	 *
	 * @param workspaceRoot - Корень проекта; по умолчанию текущий
	 * @returns Сохранённый или дефолтный выбор публикации
	 */
	public getPublicationSelection(workspaceRoot: string | undefined = currentRoot()): PublicationSelection {
		const stored = projectMemento(workspaceRoot).get<PublicationSelection>(SERVER_PUBLICATION_STATE);
		if (stored) {
			// Прежний выбор хранил одни имена сервисов: корневой URL допишется при следующем выборе
			return { ...stored, http: stored.http.map((service) => (typeof service === 'string' ? { name: service } : service)) };
		}
		const config = projectConfiguration(workspaceRoot);
		return {
			odata: config.get<boolean>('server.publishOData', true),
			webAll: config.get<boolean>('server.publishWebServices', true),
			web: [],
			httpAll: config.get<boolean>('server.publishHttpServices', true),
			http: [],
		};
	}

	/**
	 * Сохраняет выбор публикуемых сервисов проекта и перегенерирует его конфиг публикации.
	 *
	 * Серверные параметры (порт/хост/база/лицензии) при перегенерации берутся из
	 * существующего файла (сохраняя ручные правки), иначе — из настроек.
	 *
	 * @param selection - Новый выбор публикации
	 * @param workspaceRoot - Корень проекта; по умолчанию текущий
	 */
	public async setPublicationSelection(
		selection: PublicationSelection,
		workspaceRoot: string | undefined = currentRoot()
	): Promise<void> {
		await projectMemento(workspaceRoot).update(SERVER_PUBLICATION_STATE, selection);
		await this.regeneratePublicationConfig(workspaceRoot);
	}

	/**
	 * Реакция на смену активного профиля запуска.
	 *
	 * Профиль задаёт строку подключения к ИБ (`--ibconnection`), а автономный
	 * сервер публикует именно её каталог. Конфиг публикации проекта, который
	 * публикует другую базу, перегенерируется под ИБ профиля; если сервер этого
	 * проекта уже запущен на другой базе — пользователю предлагается перезапуск.
	 */
	public async onActiveProfileChanged(): Promise<void> {
		const workspaceRoot = currentRoot();
		if (!workspaceRoot) {
			return;
		}
		await this.regeneratePublicationConfig(workspaceRoot, true);
		this.setState(this._state); // обновить панель/статус под новый профиль

		const owner = this.ownerRoot;
		if (this._state !== 'running' || owner === undefined || !sameProjectRoot(owner, workspaceRoot)) {
			return;
		}
		const currentIbPath = await this.resolveFileInfobasePath(workspaceRoot, true);
		if (currentIbPath && this.runningIbPath && currentIbPath !== this.runningIbPath) {
			const restart = 'Перезапустить сервер';
			const action = await vscode.window.showWarningMessage(
				'Профиль запуска сменил информационную базу, а автономный сервер публикует прежнюю. ' +
				'Перезапустите сервер, чтобы опубликовать базу нового профиля.',
				restart
			);
			if (action === restart) {
				await this.restart();
			}
		}
	}

	/**
	 * Перегенерирует существующий конфиг публикации под текущий выбор сервисов.
	 *
	 * Конфига нет, пока сервер не запускали и конфиг не открывали: его создаст
	 * запуск. Серверные параметры сохраняются из существующего файла; путь к ИБ
	 * берётся из активного env-профиля. Если файловой ИБ нет — перегенерация
	 * пропускается.
	 *
	 * @param workspaceRoot - Корень проекта
	 * @param onlyOtherInfobase - Перегенерировать, только когда конфиг публикует не базу профиля
	 */
	private async regeneratePublicationConfig(workspaceRoot: string | undefined, onlyOtherInfobase = false): Promise<void> {
		if (!workspaceRoot) {
			return;
		}
		const settings = this.readSettings(workspaceRoot);
		const configPath = this.getConfigPath(workspaceRoot, settings);
		const published = await fs.readFile(configPath, 'utf8').then(parseServerConfigParams, () => undefined);
		if (!published) {
			return;
		}
		const ibPath = await this.resolveFileInfobasePath(workspaceRoot, true);
		if (!ibPath) {
			return;
		}
		if (onlyOtherInfobase && published.dbPath !== undefined && sameProjectRoot(published.dbPath, ibPath)) {
			return;
		}
		const params = await this.readConfigParams(configPath, settings);
		await this.writeConfigFile(
			configPath,
			{ host: params.host, port: params.port, base: params.base, distributeLicenses: params.distributeLicenses },
			ibPath,
			settings.publication
		);
	}

	/**
	 * Преобразует сохранённый выбор в параметры публикации для конфига.
	 */
	private resolvePublication(workspaceRoot: string | undefined): PublicationOptions {
		const selection = this.getPublicationSelection(workspaceRoot);
		return {
			odata: selection.odata,
			webServices: {
				publishByDefault: selection.webAll,
				services: selection.webAll ? [] : selection.web.map((name) => ({ name })),
			},
			httpServices: {
				publishByDefault: selection.httpAll,
				services: selection.httpAll ? [] : selection.http,
			},
		};
	}

	/**
	 * Загружает списки HTTP- и Web-сервisов из метаданных проекта (md-sparrow).
	 *
	 * @returns Имена сервисов по категориям или undefined при ошибке чтения
	 */
	public async loadServices(workspaceRoot: string | undefined = currentRoot()): Promise<PublishableServices | undefined> {
		if (!workspaceRoot) {
			return undefined;
		}
		try {
			const tree = await loadProjectMetadataTree(this.context, workspaceRoot);
			return extractPublishableServices(tree);
		} catch (error) {
			log.warn(`Не удалось прочитать дерево метаданных: ${(error as Error).message}`);
			return undefined;
		}
	}

	/**
	 * Читает корневые URL выбранных HTTP-сервисов: без них ibsrv не публикует
	 * путь сервиса.
	 *
	 * @param services - Сервисы проекта из {@link loadServices}
	 * @param names - Имена выбранных сервисов
	 * @param workspaceRoot - Корень проекта; по умолчанию текущий
	 * @returns Выбранные сервисы с корневыми URL
	 */
	public async resolveHttpServices(
		services: readonly PublishableService[],
		names: readonly string[],
		workspaceRoot: string | undefined = currentRoot()
	): Promise<PublishedService[]> {
		const selected = names
			.map((name) => services.find((service) => service.name === name))
			.filter((service): service is PublishableService => service !== undefined);
		if (!workspaceRoot || selected.length === 0) {
			return names.map((name) => ({ name }));
		}
		const roots = await readHttpServiceRoots(this.context, workspaceRoot, selected);
		return names.map((name) => ({ name, root: roots.get(name) }));
	}

	/**
	 * Определяет абсолютный путь к каталогу файловой ИБ из активного env-профиля.
	 *
	 * Поддерживается только файловая ИБ (/F). Для серверной (/S) выводит ошибку.
	 *
	 * @param workspaceRoot - Корень рабочей области
	 * @returns Абсолютный путь к каталогу ИБ или undefined при ошибке
	 */
	private async resolveFileInfobasePath(workspaceRoot: string, silent = false): Promise<string | undefined> {
		const connection = await runWithProject(workspaceRoot, () => this.vrunner.getActiveIbConnectionValue());
		const trimmed = connection.trim();

		if (!trimmed.startsWith('/F')) {
			if (!silent) {
				vscode.window.showErrorMessage(
					'Автономный сервер поддерживает только файловую ИБ (/F). ' +
					`Текущее подключение: ${trimmed.slice(0, 24) || '(пусто)'}…`
				);
			}
			return undefined;
		}

		return resolveFileIbAbsolutePath(trimmed, workspaceRoot);
	}

	/**
	 * Каталог данных сервера: настройка `server.dataPath` либо `build/ibsrv`
	 * в корне проекта (по умолчанию, попадает в .gitignore вместе с build/).
	 */
	private getDataDir(workspaceRoot: string, settings: ServerSettings): string {
		return settings.dataPath
			? path.resolve(workspaceRoot, settings.dataPath)
			: path.join(workspaceRoot, 'build', 'ibsrv');
	}

	/** Путь к файлу конфига публикации. */
	private getConfigPath(workspaceRoot: string, settings: ServerSettings): string {
		return path.join(this.getDataDir(workspaceRoot, settings), 'publication.yaml');
	}

	/**
	 * Записывает YAML-конфиг сервера (сервер + база + публикация) в файл.
	 */
	private async writeConfigFile(
		configPath: string,
		serverParams: { host: string; port: number; base: string; distributeLicenses: boolean },
		ibPath: string,
		publication: PublicationOptions
	): Promise<void> {
		const yaml = buildServerConfigYaml({
			host: serverParams.host,
			port: serverParams.port,
			dbPath: ibPath,
			infobaseName: INFOBASE_NAME,
			distributeLicenses: serverParams.distributeLicenses,
			base: serverParams.base,
			publication,
		});
		await fs.writeFile(configPath, yaml, 'utf8');
	}

	/**
	 * Читает серверные параметры из конфига (с подстановкой значений настроек).
	 *
	 * @returns host/port/base/distributeLicenses/odata — из файла, иначе из настроек
	 */
	private async readConfigParams(
		configPath: string,
		settings: ServerSettings
	): Promise<{ host: string; port: number; base: string; distributeLicenses: boolean; odata: boolean }> {
		let parsed: ReturnType<typeof parseServerConfigParams> = {};
		try {
			parsed = parseServerConfigParams(await fs.readFile(configPath, 'utf8'));
		} catch {
			// файла нет или не прочитался — используем настройки
		}
		return {
			host: parsed.host ?? settings.host,
			port: parsed.port ?? settings.port,
			base: parsed.base ?? settings.httpBase,
			distributeLicenses: parsed.distributeLicenses ?? settings.distributeLicenses,
			odata: parsed.odata ?? settings.publication.odata,
		};
	}

	/**
	 * Ожидает готовности HTTP-эндпоинта (любой ответ сервера) либо завершения процесса.
	 *
	 * @returns true, если сервер ответил; false при таймауте/падении (состояние уже выставлено)
	 */
	private async waitForReady(child: ChildProcess): Promise<boolean> {
		const urls = this.currentUrls;
		if (!urls) {
			return false;
		}
		const deadline = Date.now() + READINESS_TIMEOUT_MS;

		while (Date.now() < deadline) {
			if (child.exitCode !== null || this.child !== child) {
				this.fail('ibsrv завершился до готовности. Подробности в журнале сервера.');
				return false;
			}
			if (await this.probe(urls.root)) {
				return true;
			}
			await delay(READINESS_POLL_INTERVAL_MS);
		}

		this.fail(`Сервер не ответил за ${READINESS_TIMEOUT_MS / 1000} с (${urls.root}).`);
		await this.terminate(child);
		return false;
	}

	/**
	 * Одиночная HTTP-проба готовности: любой ответ считается «жив».
	 */
	private probe(url: string): Promise<boolean> {
		return new Promise((resolve) => {
			const request = http.get(url, { timeout: READINESS_POLL_INTERVAL_MS }, (response) => {
				response.resume();
				resolve(true);
			});
			request.on('error', () => resolve(false));
			request.on('timeout', () => {
				request.destroy();
				resolve(false);
			});
		});
	}

	/**
	 * Ждёт освобождения порта (после остановки сервера).
	 *
	 * @returns true, если порт освободился до таймаута
	 */
	private async waitPortFree(host: string, port: number, timeoutMs: number): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (await isPortFree(host, port)) {
				return true;
			}
			await delay(200);
		}
		return isPortFree(host, port);
	}

	/**
	 * Завершает процесс сервера и дожидается его выхода.
	 *
	 * На Windows ibsrv может порождать дочерние процессы — используем taskkill /t.
	 * На macOS и Linux сигналы идут по очереди ({@link STOP_SIGNALS}), пока процесс
	 * не выйдет.
	 *
	 * @param child - Процесс сервера
	 * @returns true, если процесс вышел
	 */
	private async terminate(child: ChildProcess): Promise<boolean> {
		const exit = childExit(child);
		const waitExit: ExitWaiter = (timeoutMs) => settlesWithin(exit, timeoutMs);
		if (process.platform === 'win32') {
			if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
				await killWindowsProcessTree(child.pid);
			}
			return waitExit(STOP_EXIT_TIMEOUT_MS);
		}
		return signalUntilExit((signal) => child.kill(signal), STOP_SIGNALS, waitExit, (next, previous) =>
			this.reportRepeatedSignal(next, previous)
		);
	}

	/**
	 * Освобождает каталог данных сервера от процесса ibsrv, который его держит.
	 *
	 * ibsrv не стартует, пока жив процесс из `lock.pid` каталога данных. Такой
	 * процесс остаётся, например, после перезагрузки окна, если расширение не
	 * дождалось его выхода. Завершается он только с согласия пользователя:
	 * каталог может держать и сервер, запущенный в другом окне.
	 *
	 * @param dataDir - Каталог данных сервера
	 * @returns true, если каталог свободен
	 */
	private async freeDataDir(dataDir: string): Promise<boolean> {
		const pid = await findDataDirHolder(dataDir);
		if (pid === undefined) {
			return true;
		}
		const action = await vscode.window.showWarningMessage(dataDirHolderQuestion(pid), STOP_DATA_DIR_HOLDER_ACTION);
		if (action !== STOP_DATA_DIR_HOLDER_ACTION) {
			return false;
		}

		this.output.appendLine(`[${new Date().toLocaleTimeString()}] Остановка ibsrv (pid ${pid}), который держит каталог данных`);
		let stopped: boolean;
		try {
			if (process.platform === 'win32') {
				await killWindowsProcessTree(pid);
				stopped = await waitProcessGone(pid, STOP_EXIT_TIMEOUT_MS);
			} else {
				stopped = await signalUntilExit(
					pidSignalSender(pid),
					STOP_SIGNALS,
					(timeoutMs) => waitProcessGone(pid, timeoutMs),
					(next, previous) => this.reportRepeatedSignal(next, previous)
				);
			}
		} catch (error) {
			log.warn(`Не удалось завершить процесс ${pid}: ${(error as Error).message}`);
			stopped = false;
		}
		if (!stopped) {
			const message = `Не удалось завершить ibsrv (pid ${pid}). Завершите процесс вручную и запустите сервер снова.`;
			this.output.appendLine(message);
			vscode.window.showErrorMessage(message);
		}
		return stopped;
	}

	/**
	 * Пишет в журнал сервера, что процесс не вышел и ему отправляется следующий сигнал.
	 *
	 * @param next - Следующий сигнал
	 * @param previous - Сигнал, после которого процесс не вышел
	 */
	private reportRepeatedSignal(next: StopSignal, previous: StopSignal): void {
		this.output.appendLine(
			`[${new Date().toLocaleTimeString()}] ibsrv не завершился за ${previous.waitMs / 1000} с после ${previous.signal}, отправка ${next.signal}`
		);
	}
}

/**
 * Принудительно завершает дерево процессов на Windows.
 *
 * @param pid - Корневой процесс
 */
function killWindowsProcessTree(pid: number): Promise<void> {
	return new Promise((resolve) => {
		exec(`taskkill /pid ${pid} /t /f`, (error) => {
			if (error) {
				log.warn(`taskkill для pid ${pid}: ${error.message}`);
			}
			resolve();
		});
	});
}

/**
 * Пауза.
 *
 * @param ms - Длительность в миллисекундах
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Проверяет существование файла.
 *
 * @param filePath - Путь к файлу
 * @returns true, если файл существует
 */
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Свободен ли TCP-порт (можно ли на нём слушать).
 *
 * @param host - Сетевой интерфейс (localhost/any/IP)
 * @param port - Проверяемый порт
 * @returns true, если порт свободен
 */
function isPortFree(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.once('error', () => resolve(false));
		server.once('listening', () => server.close(() => resolve(true)));
		server.listen(port, host === 'any' ? undefined : host);
	});
}
