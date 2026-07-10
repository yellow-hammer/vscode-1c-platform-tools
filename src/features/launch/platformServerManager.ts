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
import { logger } from '../../shared/logger';
import { resolvePlatformBinary, defaultPlatformBasePaths } from '../../shared/platformBinary';
import {
	PublicationOptions,
	ServerUrls,
	buildServerConfigYaml,
	buildServerUrls,
	parseServerConfigParams,
} from '../../shared/ibsrvPublication';
import { loadProjectMetadataTree } from '../metadata/metadataTreeService';
import { extractPublishableServices, PublishableServices } from './serverServices';

const log = logger.scope('server');

/** Имя информационной базы автономного сервера. */
const INFOBASE_NAME = 'DefAlias';

/** Ключ хранения выбора публикуемых сервисов в workspaceState. */
const PUBLICATION_SELECTION_KEY = '1c-platform-tools.server.publicationSelection';

/**
 * Сохранённый выбор публикации (workspaceState).
 *
 * `webAll`/`httpAll` — публиковать все сервисы категории; иначе публикуются
 * только перечисленные в `web`/`http`.
 */
export interface PublicationSelection {
	odata: boolean;
	webAll: boolean;
	web: string[];
	httpAll: boolean;
	http: string[];
}

/** Состояние автономного сервера. */
export type ServerState = 'stopped' | 'starting' | 'running' | 'error';

/** Разобранные настройки сервера. */
interface ServerSettings {
	platformPath: string;
	platformVersion: string;
	host: string;
	port: number;
	httpBase: string;
	dataPath: string;
	distributeLicenses: boolean;
	debug: boolean;
	debugPort: number;
	publication: PublicationOptions;
}

/** Таймаут ожидания готовности HTTP-эндпоинта, мс. */
const READINESS_TIMEOUT_MS = 60_000;
/** Интервал опроса готовности, мс. */
const READINESS_POLL_INTERVAL_MS = 500;
/** Таймаут ожидания фактического завершения процесса при остановке, мс. */
const STOP_EXIT_TIMEOUT_MS = 8_000;
/** Таймаут ожидания освобождения порта при остановке, мс. */
const STOP_PORT_TIMEOUT_MS = 8_000;

/**
 * Находит ibsrv в настроенном каталоге либо в каталогах установки по умолчанию.
 *
 * Возвращает найденный путь к бинарю и перебранные базовые каталоги (для
 * сообщения об ошибке).
 *
 * @param platformPath - Значение настройки `server.platformPath` (пусто — автоопределение)
 * @param requestedVersion - Запрошенная версия или её префикс
 * @returns Путь к ibsrv (или undefined) и список проверенных каталогов
 */
function findServerBinary(
	platformPath: string,
	requestedVersion: string
): { binary: string | undefined; bases: string[] } {
	const configured = platformPath.trim();
	const bases = configured ? [configured] : defaultPlatformBasePaths();
	for (const base of bases) {
		const binary = resolvePlatformBinary(base, 'ibsrv', {
			requestedVersion: requestedVersion || undefined,
		});
		if (binary) {
			return { binary, bases };
		}
	}
	return { binary: undefined, bases };
}

export class PlatformServerManager {
	private child: ChildProcess | undefined;
	private _state: ServerState = 'stopped';
	/** Каталог ИБ, с которым сервер реально запущен (для детекта смены профиля). */
	private runningIbPath: string | undefined;
	private readonly output: vscode.OutputChannel;
	private readonly stateEmitter = new vscode.EventEmitter<ServerState>();
	private currentUrls: ServerUrls | undefined;
	private publicationConfigPath: string | undefined;
	/** Параметры (host/port/base), на которых реально поднят текущий процесс. */
	private activeConfig: { host: string; port: number; base: string } | undefined;
	/** Резолвер промиса фактического завершения текущего процесса. */
	private exitResolve: (() => void) | undefined;
	/** Промис, который разрешается, когда текущий процесс полностью завершился. */
	private exitPromise: Promise<void> | undefined;

	/** Событие смены состояния сервера. */
	public readonly onDidChangeState = this.stateEmitter.event;

	constructor(
		private readonly vrunner: VRunnerManager,
		private readonly context: vscode.ExtensionContext
	) {
		this.output = vscode.window.createOutputChannel('1C: Автономный сервер');
	}

	/** Текущее состояние сервера. */
	public get state(): ServerState {
		return this._state;
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
	 * @returns Набор URL, как они будут выглядеть при запуске
	 */
	public async previewUrls(): Promise<ServerUrls> {
		const settings = this.readSettings();
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (workspaceRoot) {
			const params = await this.readConfigParams(this.getConfigPath(workspaceRoot, settings), settings);
			return buildServerUrls(params.host, params.port, params.base);
		}
		return buildServerUrls(settings.host, settings.port, settings.httpBase);
	}

	/** HTTP-порт текущего/последнего запуска. */
	public get port(): number | undefined {
		return this.activeConfig?.port;
	}

	/**
	 * Запускает автономный сервер.
	 *
	 * Идемпотентно: если сервер уже запущен или запускается — повторно не стартует.
	 */
	public async start(): Promise<void> {
		if (this._state === 'running' || this._state === 'starting') {
			vscode.window.showInformationMessage('Автономный сервер уже запущен.');
			return;
		}

		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('Откройте рабочую область проекта 1С.');
			return;
		}

		const settings = this.readSettings();

		// Версия платформы: настройка сервера → --v8version активного профиля → наибольшая.
		const requestedVersion = settings.platformVersion || (await this.vrunner.getActiveV8Version()) || '';

		const { binary, bases } = findServerBinary(settings.platformPath, requestedVersion);
		if (!binary) {
			vscode.window.showErrorMessage(
				`Не найден ibsrv. Проверьте настройку «server.platformPath» (проверены: ${bases.join(', ')})` +
				`${requestedVersion ? ` и версию «${requestedVersion}»` : ''}.`
			);
			return;
		}

		const ibPath = await this.resolveFileInfobasePath(workspaceRoot);
		if (!ibPath) {
			return;
		}
		this.runningIbPath = ibPath;

		this.setState('starting');
		this.output.show(true);
		this.output.appendLine(`[${new Date().toLocaleTimeString()}] Запуск ibsrv: ${binary}`);

		const dataDir = this.getDataDir(workspaceRoot, settings);
		const configPath = path.join(dataDir, 'publication.yaml');
		let params: { host: string; port: number; base: string };
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

		const args = this.buildArgs(dataDir, configPath, settings);
		this.output.appendLine(`Аргументы: ${args.join(' ')}`);

		const child = spawn(binary, args, { windowsHide: true });
		this.child = child;
		this.exitPromise = new Promise<void>((resolve) => { this.exitResolve = resolve; });

		child.stdout?.setEncoding('utf8');
		child.stderr?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => this.output.append(chunk));
		child.stderr?.on('data', (chunk: string) => this.output.append(chunk));

		child.on('error', (error) => {
			this.fail(`Ошибка запуска ibsrv: ${error.message}`);
		});
		child.on('exit', (code, signal) => {
			this.child = undefined;
			this.exitResolve?.();
			this.exitResolve = undefined;
			if (this._state === 'starting' || this._state === 'running') {
				// Незапланированное завершение
				this.output.appendLine(`ibsrv завершился (code=${code}, signal=${signal})`);
				this.setState(this._state === 'starting' ? 'error' : 'stopped');
				this.currentUrls = undefined;
				this.activeConfig = undefined;
			}
		});

		this.activeConfig = params;
		this.currentUrls = buildServerUrls(params.host, params.port, params.base);

		const ready = await this.waitForReady(child);
		if (!ready) {
			return;
		}

		this.setState('running');
		this.output.appendLine(`Сервер готов: ${this.currentUrls.root}`);
		vscode.window.showInformationMessage(`Автономный сервер 1С запущен: ${this.currentUrls.root}`);
	}

	/**
	 * Останавливает автономный сервер (вместе с дочерними процессами).
	 *
	 * Дожидается фактического завершения процесса и освобождения порта, чтобы
	 * последующий запуск (в т.ч. перезапуск) не наткнулся на занятый порт.
	 */
	public async stop(): Promise<void> {
		const child = this.child;
		if (!child || child.pid === undefined) {
			this.setState('stopped');
			this.currentUrls = undefined;
			this.activeConfig = undefined;
			this.runningIbPath = undefined;
			return;
		}

		const active = this.activeConfig;
		const pid = child.pid;
		this.output.appendLine(`[${new Date().toLocaleTimeString()}] Остановка ibsrv (pid ${pid})`);
		// Состояние выставляем до kill, чтобы обработчик exit не счёл завершение аварийным.
		this.child = undefined;
		this.setState('stopped');
		this.currentUrls = undefined;

		await this.killProcessTree(pid);
		// Ждём реального выхода процесса, затем освобождения порта.
		await Promise.race([this.exitPromise ?? Promise.resolve(), delay(STOP_EXIT_TIMEOUT_MS)]);
		if (active) {
			const freed = await this.waitPortFree(active.host, active.port, STOP_PORT_TIMEOUT_MS);
			if (!freed) {
				this.output.appendLine(`Порт ${active.port} всё ещё занят после остановки.`);
			}
		}
		this.activeConfig = undefined;
		this.exitPromise = undefined;
		this.runningIbPath = undefined;
	}

	/**
	 * Перезапускает сервер (корректно завершает текущий процесс перед стартом).
	 */
	public async restart(): Promise<void> {
		await this.stop();
		await this.start();
	}

	/** Показывает журнал сервера. */
	public showLogs(): void {
		this.output.show(true);
	}

	/**
	 * Открывает конфиг публикации в редакторе, создавая его при отсутствии.
	 */
	public async openPublicationConfig(): Promise<void> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('Откройте рабочую область проекта 1С.');
			return;
		}
		const settings = this.readSettings();
		const configPath = this.getConfigPath(workspaceRoot, settings);

		if (!(await fileExists(configPath))) {
			const ibPath = await this.resolveFileInfobasePath(workspaceRoot, true);
			if (!ibPath) {
				vscode.window.showInformationMessage(
					'Конфиг публикации создаётся при запуске сервера. Для файловой ИБ укажите /F в env.json.'
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

	/** Освобождает ресурсы и останавливает сервер. */
	public dispose(): void {
		void this.stop();
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
	 * Читает настройки сервера из конфигурации расширения.
	 */
	private readSettings(): ServerSettings {
		const config = vscode.workspace.getConfiguration('1c-platform-tools.server');
		return {
			platformPath: config.get<string>('platformPath', ''),
			platformVersion: config.get<string>('platformVersion', ''),
			host: config.get<string>('host', 'localhost'),
			port: config.get<number>('port', 8314),
			httpBase: config.get<string>('httpBase', 'ib'),
			dataPath: config.get<string>('dataPath', ''),
			distributeLicenses: config.get<boolean>('distributeLicenses', true),
			debug: config.get<boolean>('debug', false),
			debugPort: config.get<number>('debugPort', 1550),
			publication: this.resolvePublication(),
		};
	}

	/**
	 * Текущий выбор публикуемых сервисов.
	 *
	 * Если выбор ещё не сохранён, берётся из настроек `server.publish*`
	 * (по умолчанию — публиковать все категории).
	 *
	 * @returns Сохранённый или дефолтный выбор публикации
	 */
	public getPublicationSelection(): PublicationSelection {
		const stored = this.context.workspaceState.get<PublicationSelection>(PUBLICATION_SELECTION_KEY);
		if (stored) {
			return stored;
		}
		const config = vscode.workspace.getConfiguration('1c-platform-tools.server');
		return {
			odata: config.get<boolean>('publishOData', true),
			webAll: config.get<boolean>('publishWebServices', true),
			web: [],
			httpAll: config.get<boolean>('publishHttpServices', true),
			http: [],
		};
	}

	/**
	 * Сохраняет выбор публикуемых сервисов и перегенерирует конфиг публикации.
	 *
	 * Серверные параметры (порт/хост/база/лицензии) при перегенерации берутся из
	 * существующего файла (сохраняя ручные правки), иначе — из настроек.
	 *
	 * @param selection - Новый выбор публикации
	 */
	public async setPublicationSelection(selection: PublicationSelection): Promise<void> {
		await this.context.workspaceState.update(PUBLICATION_SELECTION_KEY, selection);
		await this.regeneratePublicationConfig();
	}

	/**
	 * Реакция на смену активного профиля запуска.
	 *
	 * Профиль задаёт строку подключения к ИБ (`--ibconnection`), а автономный
	 * сервер публикует именно её каталог. При смене профиля конфиг публикации
	 * перегенерируется под новую ИБ; если сервер уже запущен на другой базе —
	 * пользователю предлагается перезапуск.
	 */
	public async onActiveProfileChanged(): Promise<void> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return;
		}
		await this.regeneratePublicationConfig();
		this.setState(this._state); // обновить панель/статус под новый профиль

		if (this._state !== 'running') {
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
	 * Перегенерирует файл конфига публикации под текущий выбор сервисов.
	 *
	 * Серверные параметры сохраняются из существующего файла; путь к ИБ берётся из
	 * активного env-профиля. Если файловой ИБ нет — перегенерация пропускается
	 * (файл будет создан при следующем запуске).
	 */
	private async regeneratePublicationConfig(): Promise<void> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return;
		}
		const ibPath = await this.resolveFileInfobasePath(workspaceRoot, true);
		if (!ibPath) {
			return;
		}
		const settings = this.readSettings();
		const dataDir = this.getDataDir(workspaceRoot, settings);
		const configPath = path.join(dataDir, 'publication.yaml');
		const params = await this.readConfigParams(configPath, settings);
		await fs.mkdir(dataDir, { recursive: true });
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
	private resolvePublication(): PublicationOptions {
		const selection = this.getPublicationSelection();
		return {
			odata: selection.odata,
			webServices: {
				publishByDefault: selection.webAll,
				services: selection.webAll ? [] : selection.web,
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
	public async loadServices(): Promise<PublishableServices | undefined> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
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
	 * Определяет абсолютный путь к каталогу файловой ИБ из активного env-профиля.
	 *
	 * Поддерживается только файловая ИБ (/F). Для серверной (/S) выводит ошибку.
	 *
	 * @param workspaceRoot - Корень рабочей области
	 * @returns Абсолютный путь к каталогу ИБ или undefined при ошибке
	 */
	private async resolveFileInfobasePath(workspaceRoot: string, silent = false): Promise<string | undefined> {
		const connection = await this.vrunner.getActiveIbConnectionValue();
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
	 * @returns host/port/base/distributeLicenses — из файла, иначе из настроек
	 */
	private async readConfigParams(
		configPath: string,
		settings: ServerSettings
	): Promise<{ host: string; port: number; base: string; distributeLicenses: boolean }> {
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
		};
	}

	/**
	 * Собирает аргументы запуска ibsrv.
	 *
	 * Параметры сервера и публикации берутся из конфига; командной строкой
	 * передаём только каталог данных, конфиг и (опционально) отладку.
	 */
	private buildArgs(dataDir: string, configPath: string, settings: ServerSettings): string[] {
		const args = [`--data=${dataDir}`, `--config=${configPath}`];
		if (settings.debug) {
			args.push('--debug=http', `--debug-port=${settings.debugPort}`);
		}
		return args;
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
				this.fail('ibsrv завершился до готовности. Подробности — в журнале сервера.');
				return false;
			}
			if (await this.probe(urls.root)) {
				return true;
			}
			await delay(READINESS_POLL_INTERVAL_MS);
		}

		this.fail(`Сервер не ответил за ${READINESS_TIMEOUT_MS / 1000} с (${urls.root}).`);
		await this.killProcessTree(child.pid);
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
	 * Принудительно завершает дерево процессов сервера.
	 *
	 * На Windows ibsrv может порождать дочерние процессы — используем taskkill /t.
	 */
	private killProcessTree(pid: number | undefined): Promise<void> {
		if (pid === undefined) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			if (process.platform === 'win32') {
				exec(`taskkill /pid ${pid} /t /f`, (error) => {
					if (error) {
						log.warn(`taskkill для pid ${pid}: ${error.message}`);
					}
					resolve();
				});
			} else {
				try {
					process.kill(pid, 'SIGTERM');
				} catch (error) {
					log.warn(`Не удалось завершить процесс ${pid}: ${(error as Error).message}`);
				}
				resolve();
			}
		});
	}
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
