import * as path from 'node:path';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { VRunnerManager, type VRunnerExecutionResult } from '../shared/vrunnerManager';
import type { VRunnerIntent } from '../shared/vrunnerCli';
import { enclosingEdtProject, resolveProjectLayout, rootOfDirectory, type SourceFormat } from '../shared/projectLayout';
import { logger } from '../shared/logger';
import { runWithHooks, runHooksAroundTerminalTask } from '../shared/commandHooks';
import {
	anyNeedsExclusiveInfobase,
	exclusiveInfobaseLogLine,
	infobaseHolder,
	keepsInfobaseAfterRun,
} from '../shared/exclusiveInfobase';
import { DEFAULT_IB_CONNECTION, resolveFileIbAbsolutePath } from '../shared/ibConnectionPath';
import { currentRoot, runWithProject } from '../shared/workspaceProjects';
import { projectLabel, projectRelativePath } from './projectScope';
import { configurationScope } from '../shared/activeConfiguration';
import { CONVENTIONAL_PATHS, projectPaths, type ProjectPaths } from '../shared/projectPaths';
import {
	edtBaseProjectOf,
	edtExternalProjectsOf,
	intentSourcePath,
	planEdtBridge,
	sourceFormatOfDirectory,
	type EdtBaseLookup,
	type EdtExportStep,
	type EdtImportStep,
} from '../features/edt/edtSourceBridge';
import { runEdtExports, runEdtImports, type EdtBridgeContext } from '../features/edt/edtBridgeRunner';
import { TaskOutputChain } from '../features/tasks/vrunnerTask';
import {
	EDT_NOT_FOUND_MESSAGE,
	edtExitMessage,
	edtFailureMessage,
	edtProjectName,
	edtStagingRoot,
	readEdtSettings,
	resolveEdt,
	type EdtRunResult,
} from '../features/edt/edtRunner';
import { notifyQuiet } from '../shared/notify';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';
import {
	buildOutputVariables,
	resolveBuildOutputs,
	type BuildOutputTarget,
	type BuildOutputVariable,
} from '../shared/buildOutput';

/** Ответ команд, которым нужен исходный код конфигурации, а его в рабочей области нет. */
export const NO_CONFIGURATION_SOURCES =
	'Исходный код конфигурации в рабочей области не найден: нужен Configuration.xml выгрузки конфигуратора или проект EDT.';

const log = logger.scope('commands');

/** Команда есть только у выгрузки конфигуратора: дерево команд её у проекта EDT не показывает. */
const DESIGNER_ONLY_COMMAND =
	'Команда работает только с выгрузкой конфигуратора, а активная конфигурация в формате 1С:EDT.';

/** Команда не начинается, пока базу держит чужой процесс. */
export const INFOBASE_BUSY = 'Информационная база занята: команда не запущена.';

/**
 * Шаг после раннера, часть самой команды: хуки `post` и вызывающий видят уже его итог.
 *
 * @param succeeded - Раннер завершился успешно
 * @returns Собранные файлы и ошибка шага
 */
export type FinishStep = (succeeded: boolean) => Promise<{ artifacts?: string[]; error?: string }>;

/** Что добавить к запуску раннера. */
export interface RunExtras {
	/** Файлы результата для ответа вызывающему. */
	artifacts?: string[];
	finish?: FinishStep;
}

/** Собираемый объект. */
export interface OutputTarget extends BuildOutputTarget {
	/** Значения, которые дорого читать: читаются, только если нужны шаблону. */
	lazy?: Partial<Record<BuildOutputVariable, () => Promise<{ value: string } | { error: string }>>>;
}

/**
 * Сводит завершения в одно: сначала база возвращается держателю, затем результат
 * уходит в проект EDT.
 */
function composeCompletion(
	restore: (() => Promise<void>) | undefined,
	after: (() => Promise<void>) | undefined
): (() => Promise<void>) | undefined {
	if (!restore && !after) {
		return undefined;
	}
	return async () => {
		await restore?.();
		await after?.();
	};
}

/**
 * Добавляет к ответу собранные файлы; список шага после раннера точнее и остаётся.
 */
function withArtifacts(
	result: StructuredCommandResult | void,
	artifacts: string[] | undefined
): StructuredCommandResult | void {
	if (result === undefined || artifacts === undefined || result.artifacts !== undefined) {
		return result;
	}
	return { ...result, artifacts, artifact: result.artifact ?? (artifacts.length === 1 ? artifacts[0] : undefined) };
}

/**
 * Итог шага после раннера в ответе: его ошибка делает команду неуспешной.
 */
async function applyFinish(result: StructuredCommandResult, finish: FinishStep | undefined): Promise<StructuredCommandResult> {
	if (!finish) {
		return result;
	}
	const outcome = await finish(result.success);
	const artifacts = outcome.artifacts ?? result.artifacts;
	const merged: StructuredCommandResult = {
		...result,
		artifacts,
		artifact: artifacts?.length === 1 ? artifacts[0] : result.artifact,
	};
	if (outcome.error === undefined) {
		return merged;
	}
	return {
		...merged,
		success: false,
		exitCode: result.exitCode === 0 ? 1 : result.exitCode,
		stderr: [result.stderr, outcome.error].filter(Boolean).join('\n'),
	};
}

/**
 * Код возврата задачи с учётом шага после раннера; об ошибке шага говорит окно.
 */
async function finishTracked(exitCode: number, finish: FinishStep | undefined): Promise<number> {
	if (!finish) {
		return exitCode;
	}
	const outcome = await finish(exitCode === 0);
	if (outcome.error === undefined) {
		return exitCode;
	}
	log.error(outcome.error);
	void vscode.window.showErrorMessage(outcome.error);
	return exitCode === 0 ? 1 : exitCode;
}

/**
 * Спрашивает каталог проекта: по умолчанию или выбранный вручную.
 *
 * @param root - Корень проекта
 * @param defaultPath - Каталог по умолчанию относительно корня
 * @param title - Заголовок выбора
 * @param placeHolder - Подсказка в поле выбора
 * @returns Путь относительно корня, вне проекта абсолютный; undefined, если выбор отменён
 */
export async function pickProjectDirectory(
	root: string,
	defaultPath: string,
	title: string,
	placeHolder: string
): Promise<string | undefined> {
	const DEFAULT_LABEL = '$(folder-opened) По умолчанию';
	const picked = await vscode.window.showQuickPick(
		[
			{ label: DEFAULT_LABEL, description: defaultPath },
			{ label: '$(file-directory) Выбрать каталог...', description: '' },
		],
		{ title, placeHolder }
	);
	if (!picked) {
		return undefined;
	}
	if (picked.label === DEFAULT_LABEL) {
		return defaultPath;
	}
	const uris = await vscode.window.showOpenDialog({
		canSelectFolders: true,
		canSelectMany: false,
		defaultUri: vscode.Uri.file(root),
		title,
	});
	return uris?.length ? projectRelativePath(root, uris[0].fsPath) : undefined;
}

/**
 * Базовый класс для всех команд
 * Предоставляет общие методы для проверки workspace и работы с файловой системой
 */
export abstract class BaseCommand {
	protected readonly vrunner: VRunnerManager;

	constructor() {
		this.vrunner = VRunnerManager.getInstance();
	}

	/**
	 * Проверяет наличие workspace и показывает ошибку, если его нет
	 * @returns workspaceRoot или undefined, если workspace не открыт
	 */
	protected ensureWorkspace(): string | undefined {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			log.warn('Команда вызвана без открытой рабочей области (workspaceFolders пуст или отсутствует)');
			vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
		}
		return workspaceRoot;
	}

	/**
	 * Проверяет OneScript для команд vrunner: в режиме Docker он берётся из образа.
	 *
	 * @returns true, если команду можно запускать
	 */
	protected async ensureOscriptAvailable(): Promise<boolean> {
		if (await this.vrunner.shouldUseDocker()) {
			return true;
		}
		return this.ensureLocalOscriptAvailable();
	}

	/**
	 * Проверяет OneScript (oscript и opm) на этой машине. При отсутствии предлагает установить через OVM.
	 *
	 * Нужен командам, которые запускают opm и oscript сами, в обход Docker.
	 *
	 * @returns Промис, который разрешается true, если oscript и opm доступны; false, если нет
	 */
	protected async ensureLocalOscriptAvailable(): Promise<boolean> {
		const oscriptOk = await this.vrunner.checkOscriptAvailable();
		const opmOk = await this.vrunner.checkOpmAvailable();
		if (oscriptOk && opmOk) {
			return true;
		}
		const action = await vscode.window.showWarningMessage(
			'OneScript не найден. Установить через OVM?',
			'Установить OneScript',
			'Отмена'
		);
		if (action === 'Установить OneScript') {
			await vscode.commands.executeCommand('1c-platform-tools.dependencies.installOscript');
		}
		return false;
	}

	/**
	 * Проверяет существование директории
	 * @param dirPath - Путь к директории
	 * @param errorMessage - Сообщение об ошибке, если директория не существует
	 * @returns Промис, который разрешается true, если директория существует и является директорией, иначе false
	 */
	protected async checkDirectoryExists(dirPath: string, errorMessage?: string): Promise<boolean> {
		try {
			const stats = await fs.stat(dirPath);
			if (!stats.isDirectory()) {
				const message = errorMessage || `Папка ${dirPath} не является директорией`;
				log.error(message);
				vscode.window.showErrorMessage(message);
				return false;
			}
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				const message = errorMessage || `Папка ${dirPath} не найдена`;
				log.warn(message);
				vscode.window.showErrorMessage(message);
				return false;
			}
			const message = errorMessage || `Ошибка при проверке папки ${dirPath}: ${(error as Error).message}`;
			log.error(message);
			vscode.window.showErrorMessage(message);
			return false;
		}
	}

	/**
	 * Получает список директорий в указанной папке
	 * @param dirPath - Путь к папке
	 * @param errorMessage - Сообщение об ошибке при чтении
	 * @returns Промис, который разрешается массивом имен директорий
	 */
	protected async getDirectories(dirPath: string, errorMessage?: string): Promise<string[]> {
		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });
			return entries
				.filter(entry => entry.isDirectory())
				.map(entry => entry.name);
		} catch (error) {
			const message = errorMessage || `Ошибка при чтении папки ${dirPath}: ${(error as Error).message}`;
			log.error(message);
			vscode.window.showErrorMessage(message);
			return [];
		}
	}

	/**
	 * Получает список файлов с указанным расширением в папке
	 * @param dirPath - Путь к папке
	 * @param extension - Расширение файлов (например, '.cfe')
	 * @param errorMessage - Сообщение об ошибке при чтении
	 * @returns Промис, который разрешается массивом имен файлов
	 */
	protected async getFilesByExtension(dirPath: string, extension: string, errorMessage?: string): Promise<string[]> {
		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });
			return entries
				.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(extension.toLowerCase()))
				.map(entry => entry.name);
		} catch (error) {
			const message = errorMessage || `Ошибка при чтении папки ${dirPath}: ${(error as Error).message}`;
			log.error(message);
			vscode.window.showErrorMessage(message);
			return [];
		}
	}

	/**
	 * Создает директорию, если она не существует
	 * @param dirPath - Путь к директории
	 * @param errorMessage - Сообщение об ошибке при создании
	 * @returns Промис, который разрешается true, если директория существует или была создана, иначе false
	 */
	protected async ensureDirectoryExists(dirPath: string, errorMessage?: string): Promise<boolean> {
		try {
			await fs.mkdir(dirPath, { recursive: true });
			return true;
		} catch (error) {
			const message = errorMessage || `Ошибка при создании папки ${dirPath}: ${(error as Error).message}`;
			log.error(message);
			vscode.window.showErrorMessage(message);
			return false;
		}
	}

	/**
	 * Проверяет, что fullPath лежит в basePath (или совпадает с ним). На Windows — без учёта регистра.
	 */
	protected pathUnderBase(basePath: string, fullPath: string): boolean {
		const base = path.resolve(basePath);
		const full = path.resolve(fullPath);
		if (process.platform === 'win32') {
			const baseLower = base.toLowerCase();
			const fullLower = full.toLowerCase();
			return fullLower === baseLower || fullLower.startsWith(baseLower + path.sep);
		}
		return full === base || full.startsWith(base + path.sep);
	}

	/** Строки objlist (без пустых). */
	protected parseObjlistLines(content: string): string[] {
		return content.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
	}

	/** Полный путь: line — абсолютный или относительно workspaceRoot. */
	protected resolveObjlistLine(workspaceRoot: string, line: string): string {
		return path.isAbsolute(line) ? path.resolve(line) : path.resolve(workspaceRoot, line);
	}

	/** Относительный путь basePath → fullPath с прямыми слэшами. */
	protected relativePathSlash(basePath: string, fullPath: string): string {
		return path.relative(path.resolve(basePath), path.resolve(fullPath)).split(path.sep).join('/');
	}

	/** Путь для параметра команды 1С (прямые слэши). */
	protected pathForCmd(p: string): string {
		return p.replaceAll('\\', '/');
	}

	/** Записывает файл списка (строки через \n), UTF-8. При ошибке — лог и сообщение пользователю. Возвращает false при ошибке. */
	protected async writeListFile(
		filePath: string,
		lines: string[],
		errorContext?: string
	): Promise<boolean> {
		try {
			await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
			return true;
		} catch (error) {
			const errMsg = (error as Error).message;
			log.error(`${errorContext ?? 'Запись списка'}: ${errMsg}`);
			vscode.window.showErrorMessage(`Не удалось записать список файлов: ${errMsg}`);
			return false;
		}
	}

	/**
	 * Структурированная ошибка для режима wait: true (без UI-диалогов).
	 */
	protected executionError(message: string): StructuredCommandResult {
		return {
			success: false,
			exitCode: -1,
			stdout: '',
			stderr: message,
		};
	}

	/**
	 * Корень проекта для выполнения: projectPath из MCP или workspace.
	 */
	protected getExecutionCwd(opts?: CommandExecutionOptions): string | undefined {
		const fromOpts = opts?.projectPath?.trim();
		if (fromOpts) {
			return path.resolve(fromOpts);
		}
		return this.vrunner.getWorkspaceRoot();
	}

	/**
	 * При wait: true возвращает ошибку вместо интерактивного шага; иначе undefined — продолжать.
	 */
	protected rejectIfWait(
		opts: CommandExecutionOptions | undefined,
		message: string
	): StructuredCommandResult | undefined {
		if (opts?.wait === true) {
			return this.executionError(message);
		}
		return undefined;
	}

	/**
	 * Проверка OneScript: в UI — с предложением установки; при wait — только проверка.
	 */
	protected async ensureOscriptForExecution(opts?: CommandExecutionOptions): Promise<boolean> {
		// В режиме Docker OneScript берётся из образа
		if (await this.vrunner.shouldUseDocker()) {
			return true;
		}
		if (opts?.wait === true) {
			const oscriptOk = await this.vrunner.checkOscriptAvailable();
			const opmOk = await this.vrunner.checkOpmAvailable();
			return oscriptOk && opmOk;
		}
		return this.ensureLocalOscriptAvailable();
	}

	/**
	 * Создаёт каталог: в UI — с сообщением об ошибке; при wait — без диалогов.
	 */
	protected async ensureDirectoryForExecution(
		dirPath: string,
		opts?: CommandExecutionOptions,
		errorMessage?: string
	): Promise<boolean> {
		if (opts?.wait === true) {
			try {
				await fs.mkdir(dirPath, { recursive: true });
				const stats = await fs.stat(dirPath);
				return stats.isDirectory();
			} catch (error) {
				log.error(
					`${errorMessage ?? 'Каталог'}: ${(error as Error).message}`
				);
				return false;
			}
		}
		return this.ensureDirectoryExists(dirPath, errorMessage);
	}

	protected vrunnerResultToStructured(
		result: VRunnerExecutionResult,
		artifact?: string
	): StructuredCommandResult {
		return {
			success: result.success,
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			artifact,
		};
	}

	/**
	 * Пути собранных файлов по параметрам вызова, с созданными каталогами.
	 *
	 * @param targets - Собираемые объекты
	 * @param opts - Опции выполнения с outputDirectory и outputName
	 * @param runnerWrites - Файл пишет раннер, а не расширение: в Docker ему виден только проект
	 * @returns Пути в порядке объектов, результат-ошибка агенту либо undefined после сообщения в UI
	 */
	protected async resolveOutputs(
		targets: readonly OutputTarget[],
		opts: CommandExecutionOptions | undefined,
		runnerWrites: boolean
	): Promise<string[] | StructuredCommandResult | undefined> {
		const fail = async (message: string) => (await this.reportUnavailable(message, opts)) ?? undefined;
		const cwd = this.getExecutionCwd(opts);
		if (!cwd) {
			return fail('Откройте рабочую область с проектом 1С');
		}
		const options = opts ?? {};
		const used = buildOutputVariables(options);
		if ('error' in used) {
			return fail(used.error);
		}

		const branch = used.variables.has('gitBranch') ? this.vrunner.getGitBranchDirName() : undefined;
		const withValues: BuildOutputTarget[] = [];
		for (const target of targets) {
			const variables = { ...target.variables, gitBranch: branch };
			const unavailable = { gitBranch: 'проект не в репозитории git', ...target.unavailable };
			for (const variable of used.variables) {
				const read = target.lazy?.[variable];
				if (!read) {
					continue;
				}
				const result = await read();
				if ('error' in result) {
					return fail(`Не удалось прочитать \${${variable}} для ${target.label}: ${result.error}`);
				}
				variables[variable] = result.value;
				unavailable[variable] ??= 'в свойствах значение не задано';
			}
			withValues.push({ ...target, variables, unavailable });
		}

		const resolved = resolveBuildOutputs(withValues, options);
		if ('error' in resolved) {
			return fail(resolved.error);
		}

		const docker = runnerWrites && (await this.vrunner.shouldUseDocker());
		const files: string[] = [];
		for (const file of resolved.files) {
			const absolute = path.resolve(cwd, file);
			const target = projectRelativePath(cwd, absolute);
			if (docker && path.isAbsolute(target)) {
				return fail(`В Docker раннеру виден только каталог проекта, а ${target} лежит вне его`);
			}
			const directory = path.dirname(absolute);
			if (!(await this.ensureDirectoryForExecution(directory, opts, `Ошибка при создании каталога ${directory}`))) {
				return opts?.wait === true ? this.executionError(`Не удалось создать каталог ${directory}`) : undefined;
			}
			files.push(target);
		}
		return files;
	}

	/**
	 * Гейт файла настроек vanessa-runner: без пригодного файла команды не
	 * выполняются (настройки — единственный источник параметров подключения,
	 * расширение их в CLI не дублирует).
	 *
	 * @returns undefined — можно выполнять; StructuredCommandResult — блокировка
	 *          в режиме wait; 'blocked' — блокировка в UI-режиме (диалог показан)
	 */
	protected async settingsGate(
		opts: CommandExecutionOptions | undefined
	): Promise<StructuredCommandResult | 'blocked' | undefined> {
		if (await this.vrunner.ensureProfileSettingsFile(opts?.wait !== true)) {
			return undefined;
		}
		if (opts?.wait === true) {
			return this.executionError(this.vrunner.settingsProblemMessage());
		}
		return 'blocked';
	}

	/**
	 * Запуск одного намерения vrunner (см. {@link VRunnerIntent}).
	 *
	 * План строится адаптером установленной версии vrunner (2.x/3.x); намерение
	 * может развернуться в несколько команд (например, разборка .cfe на 2.x).
	 */
	protected async runIntent(
		intent: VRunnerIntent,
		opts: CommandExecutionOptions | undefined,
		terminalName: string,
		artifact?: string,
		commandId?: string,
		extras?: RunExtras
	): Promise<StructuredCommandResult | void> {
		const gate = await this.settingsGate(opts);
		if (gate) {
			return gate === 'blocked' ? undefined : gate;
		}
		const bridged = await this.bridgeEdt([intent], opts);
		if (bridged === 'blocked') {
			return undefined;
		}
		if (!('intents' in bridged)) {
			return bridged;
		}
		const effective = bridged.intents[0];
		const window = await this.openInfobaseWindow([effective], opts);
		if (window === 'blocked') {
			return opts?.wait === true ? this.executionError(INFOBASE_BUSY) : undefined;
		}
		const onComplete = composeCompletion(window.restore, bridged.after);
		const steps = await this.vrunner.planIntent(effective, opts?.settingsFile, opts?.ibConnection);
		const notices = this.vrunner.consumePlanNotices();
		const result = steps.length === 1
			? await this.runVRunner(steps[0], opts, terminalName, artifact, commandId, true, onComplete, bridged.output, extras?.finish)
			: await this.runVRunnerSequential(steps, opts, terminalName, commandId, true, onComplete, bridged.output, extras?.finish);
		return this.appendNotices(withArtifacts(result, extras?.artifacts), notices);
	}

	/**
	 * Освобождает информационную базу на время команды, если её держит
	 * автономный сервер, а намерению нужен монопольный доступ.
	 *
	 * Держатель ищется по абсолютному пути базы команды: сервер другого проекта
	 * с другой базой не останавливается.
	 *
	 * Базу возвращает {@link InfobaseHolder.restore}: он попадает в план как
	 * `onComplete` и срабатывает после фактического завершения работы. Когда
	 * команда уходит в интерактивный терминал, о её завершении расширение не
	 * знает, поэтому сервер остаётся выключенным и об этом говорится прямо.
	 *
	 * Так же расширение поступает с интерактивным запуском конфигуратора и
	 * предприятия: vrunner завершается сразу, а базу держит само приложение.
	 *
	 * @param intents - Намерения команды
	 * @param opts - Опции выполнения
	 * @returns Возврат базы или `blocked`, если освободить не удалось
	 */
	protected async openInfobaseWindow(
		intents: readonly VRunnerIntent[],
		opts: CommandExecutionOptions | undefined
	): Promise<{ restore?: () => Promise<void> } | 'blocked'> {
		const configured =
			opts?.ibConnection?.trim() || (await this.vrunner.getConfiguredIbConnection(opts?.settingsFile));
		const run = {
			cli3: await this.vrunner.supportsVRunnerFeature('cli3'),
			connectionSet: configured !== undefined,
		};
		if (!anyNeedsExclusiveInfobase(intents, run)) {
			return {};
		}
		const root = currentRoot();
		const connection = configured ?? DEFAULT_IB_CONNECTION;
		log.info(
			exclusiveInfobaseLogLine(
				root === undefined ? '-' : projectLabel(root),
				opts?.settingsFile ?? this.vrunner.getActiveEnvFile(),
				connection
			)
		);
		const infobase = root !== undefined && connection.startsWith('/F')
			? resolveFileIbAbsolutePath(connection, root)
			: undefined;
		const holder = infobase === undefined ? undefined : infobaseHolder(infobase);
		if (!holder) {
			return {};
		}

		if (!(await holder.release())) {
			void vscode.window.showErrorMessage(
				`Не удалось остановить: ${holder.label}. Конфигуратор не откроет базу, пока её держит этот процесс.`
			);
			return 'blocked';
		}

		if (keepsInfobaseAfterRun(intents)) {
			notifyQuiet(`${holder.label}: остановлен, запустите снова после закрытия 1С`);
			return {};
		}

		const tracked =
			opts?.wait === true ||
			vscode.workspace.getConfiguration('1c-platform-tools').get<boolean>('execution.useTasks', true) !== false;
		if (!tracked) {
			notifyQuiet(`${holder.label}: остановлен, команда выполняется в терминале`);
			return {};
		}
		notifyQuiet(`${holder.label}: остановлен на время команды`);
		return {
			restore: async () => {
				try {
					await holder.restore();
				} catch (error) {
					log.error(`Не удалось вернуть базу держателю: ${(error as Error).message}`);
				}
			},
		};
	}

	/**
	 * Проводит намерения через проект 1С:EDT.
	 *
	 * Исходники проекта EDT раннер не читает: перед командой проект выгружается
	 * самой EDT в каталог сборки, а намерение получает путь этой выгрузки. Команда,
	 * пишущая исходники, пишет туда же, и после неё выгрузка импортируется в проект.
	 *
	 * @param intents - Что собирались запустить
	 * @param opts - Опции выполнения
	 * @returns Намерения над выгрузкой, импорт после команды и общий терминал
	 *          шагов; результат-ошибку в режиме wait либо 'blocked' после показа
	 *          сообщения
	 */
	private async bridgeEdt(
		intents: readonly VRunnerIntent[],
		opts?: CommandExecutionOptions
	): Promise<
		| { intents: VRunnerIntent[]; after?: () => Promise<void>; output?: TaskOutputChain }
		| StructuredCommandResult
		| 'blocked'
	> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		const buildDir = workspaceRoot ? edtStagingRoot(workspaceRoot, this.vrunner.getOutPath()) : this.vrunner.getOutPath();
		const rewritten: VRunnerIntent[] = [];
		const exports: EdtExportStep[] = [];
		const imports: EdtImportStep[] = [];
		for (const intent of intents) {
			const source = await this.activeSource(intent);
			const plan =
				workspaceRoot === undefined
					? undefined
					: planEdtBridge(intent, source, {
							buildDir,
							externalProjects:
								intent.kind === 'epf.build' && source?.dir
									? edtExternalProjectsOf(workspaceRoot, source.dir)
									: undefined,
						});
			if (!plan) {
				rewritten.push(intent);
				continue;
			}
			rewritten.push(plan.intent);
			exports.push(...plan.exports);
			imports.push(...plan.imports);
		}
		if (workspaceRoot === undefined || (exports.length === 0 && imports.length === 0)) {
			return { intents: rewritten };
		}
		// Мосту нужна EDT: без неё пишущая команда отработала бы впустую, результат не попал бы в проект
		if (!resolveEdt(readEdtSettings(workspaceRoot))) {
			return (await this.reportUnavailable(EDT_NOT_FOUND_MESSAGE, opts)) ?? 'blocked';
		}
		// Базовый проект у каждого шага свой: расширение чужой конфигурации к активной не относится
		const baseOf = await this.edtBaseProjectResolver(workspaceRoot);
		// Шаги моста и команда раннера пишут в один терминал подряд, не стирая друг друга;
		// команду, которую ждёт вызывающий, мост, как и раннер, выполняет в фоне
		const output = new TaskOutputChain(opts?.wait === true);
		const context: EdtBridgeContext = { workspaceRoot, buildDir, output };
		const withBase = exports.map((step) =>
			'projectDir' in step ? { ...step, baseProjectDir: baseOf(step.projectDir) } : step
		);
		const exported = await runEdtExports(withBase, context);
		if (exported.exitCode !== 0) {
			const reported = await this.reportUnavailable(
				edtFailureMessage('Выгрузка проекта 1С:EDT не удалась, команда не запущена.', exported),
				opts
			);
			return reported ?? 'blocked';
		}
		const owned = imports.map((step) => ({ ...step, baseProjectDir: baseOf(step.projectDir) }));
		return {
			intents: rewritten,
			after: owned.length > 0 ? () => runEdtImports(owned, context) : undefined,
			output,
		};
	}

	/**
	 * Ответ команды, которую выполняет 1С:EDT: вызывающему с ожиданием код
	 * возврата, причина неудачи и результат; остальным ход и отказ видны в
	 * терминале задачи.
	 */
	protected edtCommandResult(
		result: EdtRunResult,
		artifact: string,
		opts: CommandExecutionOptions | undefined
	): StructuredCommandResult | void {
		if (opts?.wait !== true) {
			return;
		}
		const failed = result.exitCode !== 0;
		return {
			success: !failed,
			exitCode: result.exitCode,
			stdout: '',
			stderr: failed ? (result.error ?? edtExitMessage(result.exitCode)) : '',
			artifact,
		};
	}

	/**
	 * Базовый проект для проекта EDT: по манифесту проекта или по его имени среди
	 * конфигураций рабочей области, иначе проект активной конфигурации.
	 *
	 * @returns Каталог базового проекта относительно рабочей области по каталогу проекта
	 */
	protected async edtBaseProjectResolver(workspaceRoot: string): Promise<(projectDir: string) => string | undefined> {
		const layout = await resolveProjectLayout(workspaceRoot);
		const lookup: EdtBaseLookup = {
			configurations: [...(layout.configuration ? [layout.configuration] : []), ...layout.others]
				.filter((root) => root.format === 'edt')
				.map((root) => root.dir),
			projectName: edtProjectName,
			active: await this.activeEdtProjectDir(),
		};
		const relative = (dir: string) => path.relative(workspaceRoot, dir).split(path.sep).join('/') || '.';
		return (projectDir) => {
			const base = edtBaseProjectOf(path.resolve(workspaceRoot, projectDir), lookup);
			return base === undefined ? undefined : relative(base);
		};
	}

	/** Каталог проекта активной конфигурации, если она в формате EDT. */
	private async activeEdtProjectDir(): Promise<string | undefined> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return undefined;
		}
		const scope = await configurationScope(workspaceRoot);
		return scope.configuration?.format === 'edt' ? scope.configuration.dir : undefined;
	}

	/**
	 * Формат и каталог исходников, с которыми идёт команда.
	 *
	 * Формат берётся у тех исходников, чей путь стоит в самой команде: у
	 * конфигурации и её расширений он бывает разным. Когда пути в команде нет,
	 * отвечает активная конфигурация.
	 */
	private async activeSource(intent: VRunnerIntent): Promise<{ format?: SourceFormat; dir?: string } | undefined> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return undefined;
		}
		const scope = await configurationScope(workspaceRoot);

		const relative = (dir: string) => path.relative(workspaceRoot, dir).split(path.sep).join('/');
		const wanted = intentSourcePath(intent);
		if (wanted) {
			// Путь внутри корня раскладки ведёт к самому корню: у проекта EDT команда
			// работает с каталогом проекта, а не с его src
			const absolute = path.resolve(workspaceRoot, wanted);
			const root = rootOfDirectory(await resolveProjectLayout(workspaceRoot), absolute);
			if (root) {
				return { format: root.format, dir: relative(root.dir) || undefined };
			}
			const project = enclosingEdtProject(workspaceRoot, absolute);
			if (project) {
				return { format: 'edt', dir: relative(project) || undefined };
			}
			// Путь вне корней: формат смотрим по самому каталогу. Пустой или ещё не
			// созданный каталог, куда команда только разложит результат, наследует
			// формат активной конфигурации
			const format = sourceFormatOfDirectory(absolute) ?? scope.configuration?.format;
			return format ? { format, dir: wanted } : undefined;
		}
		return scope.configuration
			? { format: scope.configuration.format, dir: relative(scope.configuration.dir) || undefined }
			: undefined;
	}

	/**
	 * Отказ команды, у которой на проекте 1С:EDT нет дела: списки объектов,
	 * приращения и файлы версий существуют только у выгрузки конфигуратора.
	 *
	 * @returns Результат-ошибку в режиме wait либо undefined после сообщения в UI;
	 *          null, когда конфигурация в формате конфигуратора и команда идёт дальше
	 */
	protected async refuseEdtConfiguration(
		opts?: CommandExecutionOptions
	): Promise<StructuredCommandResult | void | null> {
		if ((await this.paths())?.configuration?.format !== 'edt') {
			return null;
		}
		return this.reportUnavailable(DESIGNER_ONLY_COMMAND, opts);
	}

	protected async activeCfPath(): Promise<string | undefined> {
		return (await this.paths())?.configuration?.dir;
	}

	/**
	 * Исходный код активной конфигурации; без него команда отвечает сообщением.
	 *
	 * @returns Каталог относительно рабочей области, результат агенту либо undefined после сообщения в UI
	 */
	protected async requireCfPath(opts?: CommandExecutionOptions): Promise<string | StructuredCommandResult | undefined> {
		const dir = await this.activeCfPath();
		if (dir !== undefined) {
			return dir;
		}
		return (await this.reportUnavailable(NO_CONFIGURATION_SOURCES, opts)) ?? undefined;
	}

	/** Пути раскладки рабочей области; undefined без рабочей области. */
	protected async paths(): Promise<ProjectPaths | undefined> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		return workspaceRoot ? projectPaths(workspaceRoot) : undefined;
	}

	/** Каталог расширений выгрузки конфигуратора либо привычное место, когда их ещё нет. */
	protected async extensionsContainer(): Promise<string> {
		return (await this.paths())?.extensionsContainer ?? CONVENTIONAL_PATHS.cfe;
	}

	/** Каталог тестовых расширений либо привычное место, когда их ещё нет. */
	protected async testExtensionsContainer(): Promise<string> {
		return (await this.paths())?.testExtensionsContainer ?? CONVENTIONAL_PATHS.testsCfe;
	}

	/** Каталог внешних обработок либо привычное место, когда их ещё нет. */
	protected async processorsContainer(): Promise<string> {
		return (await this.paths())?.processorsContainer ?? CONVENTIONAL_PATHS.epf;
	}

	/** Каталог внешних отчётов либо привычное место, когда их ещё нет. */
	protected async reportsContainer(): Promise<string> {
		return (await this.paths())?.reportsContainer ?? CONVENTIONAL_PATHS.erf;
	}

	/** Каталог тестовых обработок либо привычное место, когда их ещё нет. */
	protected async testProcessorsContainer(): Promise<string> {
		return (await this.paths())?.testProcessorsContainer ?? CONVENTIONAL_PATHS.testsEpf;
	}

	/**
	 * Расширения конфигурации, с которой работают команды.
	 *
	 * @returns Имя из метаданных, каталог относительно рабочей области и формат
	 */
	protected async activeExtensions(): Promise<{ name: string; dir: string; format: SourceFormat }[]> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return [];
		}

		const scope = await configurationScope(workspaceRoot);
		return scope.extensions.map((extension) => ({
			name: extension.name,
			dir: path.relative(workspaceRoot, extension.dir).split(path.sep).join('/'),
			format: extension.format,
		}));
	}

	/**
	 * Сообщает, что команда недоступна: ошибкой в UI или результатом агенту.
	 *
	 * @param message - Причина, понятная пользователю
	 * @param opts - Опции выполнения
	 */
	protected reportUnavailable(
		message: string,
		opts?: CommandExecutionOptions
	): StructuredCommandResult | void {
		if (opts?.wait === true) {
			return this.executionError(message);
		}
		void vscode.window.showErrorMessage(message);
		return undefined;
	}

	/**
	 * Спрашивает каталог для результата: по умолчанию или выбранный вручную.
	 *
	 * @param defaultPath - Каталог по умолчанию (относительно рабочей области)
	 * @param title - Заголовок выбора
	 * @returns Относительный путь или undefined, если выбор отменён
	 */
	protected async pickOutputPath(
		defaultPath: string,
		title: string
	): Promise<string | undefined> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return undefined;
		}
		return pickProjectDirectory(workspaceRoot, defaultPath, title, 'Каталог для выходных файлов');
	}


	/**
	 * Запуск заранее спланированной команды vrunner с освобождением базы.
	 *
	 * Для мест, которые строят план сами через `planIntent`: базу нужно
	 * освободить по тем же намерениям, что ушли в план. Когда база свободна,
	 * команда запускается как обычно, без ожидания завершения.
	 *
	 * @param argsList - Наборы аргументов vrunner (каждый — одна команда)
	 * @param intents - Намерения, из которых построен план
	 * @param options - Каталог запуска и имя терминала
	 */
	protected async runPlanned(
		intents: readonly VRunnerIntent[],
		options: {
			cwd: string;
			name: string;
			appendOverrides?: boolean;
			settingsFile?: string;
			ibConnection?: string;
		}
	): Promise<void> {
		const bridged = await this.bridgeEdt(intents);
		if (bridged === 'blocked' || !('intents' in bridged)) {
			return;
		}
		const { ibConnection, settingsFile, ...execution } = options;
		const argsList = await this.vrunner.planIntents(bridged.intents, settingsFile, ibConnection);
		if (argsList.length === 0) {
			return;
		}
		const window = await this.openInfobaseWindow(
			bridged.intents,
			ibConnection || settingsFile ? { ibConnection, settingsFile } : undefined
		);
		if (window === 'blocked') {
			return;
		}
		const onComplete = composeCompletion(window.restore, bridged.after);
		const runOptions = { ...execution, output: bridged.output };
		if (!onComplete) {
			await this.vrunner.executeVRunnerCommandsInSequence(argsList, runOptions);
			return;
		}
		void this.vrunner.executeVRunnerTaskSequenceAndWait(argsList, runOptions)
			.catch((error) => log.error(`Ошибка запуска команды: ${(error as Error).message}`))
			.finally(() => void onComplete());
	}

	/**
	 * Последовательный запуск нескольких намерений vrunner одной цепочкой.
	 */
	protected async runIntentsSequential(
		intents: VRunnerIntent[],
		opts: CommandExecutionOptions | undefined,
		terminalName: string,
		commandId?: string,
		extras?: RunExtras
	): Promise<StructuredCommandResult | void> {
		const gate = await this.settingsGate(opts);
		if (gate) {
			return gate === 'blocked' ? undefined : gate;
		}
		const bridged = await this.bridgeEdt(intents, opts);
		if (bridged === 'blocked') {
			return undefined;
		}
		if (!('intents' in bridged)) {
			return bridged;
		}
		const window = await this.openInfobaseWindow(bridged.intents, opts);
		if (window === 'blocked') {
			return opts?.wait === true ? this.executionError(INFOBASE_BUSY) : undefined;
		}
		const onComplete = composeCompletion(window.restore, bridged.after);
		const steps = await this.vrunner.planIntents(bridged.intents, opts?.settingsFile, opts?.ibConnection);
		const notices = this.vrunner.consumePlanNotices();
		const result = await this.runVRunnerSequential(
			steps, opts, terminalName, commandId, true, onComplete, bridged.output, extras?.finish
		);
		return this.appendNotices(withArtifacts(result, extras?.artifacts), notices);
	}

	/**
	 * Приклеивает замечания планирования (временные параметры профиля)
	 * к структурированному результату, чтобы контекст выполнения был виден
	 * вызывающей стороне, а не только в статус-баре.
	 */
	protected appendNotices(
		result: StructuredCommandResult | void,
		notices: string[]
	): StructuredCommandResult | void {
		if (result === undefined || notices.length === 0) {
			return result;
		}
		const contextLines = notices.map((notice) => `[контекст] ${notice}`).join('\n');
		return {
			...result,
			stdout: [contextLines, result.stdout].filter(Boolean).join('\n'),
		};
	}

	/**
	 * Универсальный запуск vrunner с поддержкой режимов wait: false (терминал) и wait: true (sync).
	 *
	 * @param planned - true, если args — финальный план интента (параметры
	 *                  профиля уже добавлены адаптером, повторно не дописывать)
	 * @param output - Общий терминал с шагами, которые прошли до команды
	 */
	protected async runVRunner(
		args: string[],
		opts: CommandExecutionOptions | undefined,
		terminalName: string,
		artifact?: string,
		commandId?: string,
		planned = false,
		onComplete?: () => Promise<void>,
		output?: TaskOutputChain,
		finish?: FinishStep
	): Promise<StructuredCommandResult | void> {
		const cwd = this.getExecutionCwd(opts);
		if (!cwd) {
			if (opts?.wait === true) {
				return this.executionError(
					'Укажите projectPath или откройте рабочую область с проектом 1С'
				);
			}
			this.ensureWorkspace();
			return;
		}
		if (!(await this.ensureOscriptForExecution(opts))) {
			if (opts?.wait === true) {
				return this.executionError('OneScript (oscript) или opm не найдены');
			}
			return;
		}

		const root = currentRoot();
		const workspaceRoot = root ?? cwd;
		const inRoot = <T>(fn: () => T): T => runWithProject(root, fn);
		const appendOverrides = planned ? false : undefined;

		if (opts?.wait === true) {
			const execute = (): Promise<StructuredCommandResult> => inRoot(async () => {
				const result = await this.vrunner.executeVRunner(args, { cwd });
				return applyFinish(this.vrunnerResultToStructured(result, artifact), finish);
			});
			try {
				if (!commandId) {
					return await execute();
				}
				return await runWithHooks({ commandId, cwd, args, workspaceRoot, run: execute });
			} finally {
				await inRoot(async () => onComplete?.());
			}
		}

		const runOptions = { cwd, name: terminalName, appendOverrides, output };
		const runTracked = () => inRoot(async () =>
			finishTracked(await this.vrunner.executeVRunnerTaskAndWait(args, runOptions), finish)
		);
		if (commandId) {
			void runHooksAroundTerminalTask({
				commandId, cwd, args, workspaceRoot,
				trackCompletion: onComplete !== undefined || finish !== undefined,
				runTracked,
				runUntracked: () => inRoot(() => this.vrunner.executeVRunnerInTerminal(args, runOptions)),
			})
				.catch((err) => log.error(`Ошибка хуков команды: ${(err as Error).message}`))
				.finally(() => void inRoot(() => onComplete?.()));
		} else if (onComplete || finish) {
			void runTracked()
				.catch((err) => log.error(`Ошибка запуска команды: ${(err as Error).message}`))
				.finally(() => void inRoot(() => onComplete?.()));
		} else {
			this.vrunner.executeVRunnerInTerminal(args, runOptions);
		}
	}

	/**
	 * Несколько вызовов vrunner подряд (например по одному на каждое расширение).
	 * При wait: true останавливается на первой неуспешной команде.
	 */
	protected async runVRunnerSequential(
		argsList: string[][],
		opts: CommandExecutionOptions | undefined,
		terminalName: string,
		commandId?: string,
		planned = false,
		onComplete?: () => Promise<void>,
		output?: TaskOutputChain,
		finish?: FinishStep
	): Promise<StructuredCommandResult | void> {
		const cwd = this.getExecutionCwd(opts);
		if (!cwd) {
			if (opts?.wait === true) {
				return this.executionError(
					'Укажите projectPath или откройте рабочую область с проектом 1С'
				);
			}
			this.ensureWorkspace();
			return;
		}
		if (!(await this.ensureOscriptForExecution(opts))) {
			if (opts?.wait === true) {
				return this.executionError('OneScript (oscript) или opm не найдены');
			}
			return;
		}

		const root = currentRoot();
		const workspaceRoot = root ?? cwd;
		const inRoot = <T>(fn: () => T): T => runWithProject(root, fn);
		const flatArgs = argsList.flat();
		const appendOverrides = planned ? false : undefined;

		if (opts?.wait === true) {
			const execute = (): Promise<StructuredCommandResult> => inRoot(async () => {
				let stdout = '';
				let stderr = '';
				let exitCode = 0;
				let success = true;
				for (const args of argsList) {
					const result = await this.vrunner.executeVRunner(args, { cwd });
					stdout += result.stdout;
					stderr += result.stderr;
					exitCode = result.exitCode;
					if (!result.success) {
						success = false;
						break;
					}
				}
				return applyFinish({ success, exitCode, stdout, stderr }, finish);
			});
			try {
				if (!commandId) {
					return await execute();
				}
				return await runWithHooks({ commandId, cwd, args: flatArgs, workspaceRoot, run: execute });
			} finally {
				await inRoot(async () => onComplete?.());
			}
		}

		// Объединяем в одну цепочку (&& / ; — в зависимости от оболочки),
		// чтобы каждая следующая команда стартовала после реального завершения
		// предыдущей, а не по факту попадания в input-буфер терминала.
		const runOptions = { cwd, name: terminalName, appendOverrides, output };
		const runTracked = () => inRoot(async () =>
			finishTracked(await this.vrunner.executeVRunnerTaskSequenceAndWait(argsList, runOptions), finish)
		);
		if (commandId) {
			void runHooksAroundTerminalTask({
				commandId, cwd, args: flatArgs, workspaceRoot,
				trackCompletion: onComplete !== undefined || finish !== undefined,
				runTracked,
				runUntracked: () => inRoot(() => this.vrunner.executeVRunnerCommandsInSequence(argsList, runOptions)),
			})
				.catch((err) => log.error(`Ошибка хуков команды: ${(err as Error).message}`))
				.finally(() => void inRoot(() => onComplete?.()));
		} else if (onComplete || finish) {
			void runTracked()
				.catch((err) => log.error(`Ошибка запуска команды: ${(err as Error).message}`))
				.finally(() => void inRoot(() => onComplete?.()));
		} else {
			await this.vrunner.executeVRunnerCommandsInSequence(argsList, runOptions);
		}
	}
}
