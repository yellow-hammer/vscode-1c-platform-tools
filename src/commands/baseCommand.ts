import * as path from 'node:path';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { VRunnerManager, type VRunnerExecutionResult } from '../shared/vrunnerManager';
import type { VRunnerIntent } from '../shared/vrunnerCli';
import { logger } from '../shared/logger';
import { runWithHooks, runHooksAroundTerminalTask } from '../shared/commandHooks';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';

const log = logger.scope('commands');

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
	 * Проверяет наличие OneScript (oscript и opm). При отсутствии предлагает установить через OVM.
	 *
	 * @returns Промис, который разрешается true, если oscript и opm доступны или пользователь запустил установку; false при отмене
	 */
	protected async ensureOscriptAvailable(): Promise<boolean> {
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
		if (opts?.wait === true) {
			const oscriptOk = await this.vrunner.checkOscriptAvailable();
			const opmOk = await this.vrunner.checkOpmAvailable();
			return oscriptOk && opmOk;
		}
		return this.ensureOscriptAvailable();
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
			return this.executionError(
				'Профиль запуска не создан. Создайте его через «Служебные файлы».'
			);
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
		commandId?: string
	): Promise<StructuredCommandResult | void> {
		const gate = await this.settingsGate(opts);
		if (gate) {
			return gate === 'blocked' ? undefined : gate;
		}
		const steps = await this.vrunner.planIntent(intent);
		if (steps.length === 1) {
			return this.runVRunner(steps[0], opts, terminalName, artifact, commandId, true);
		}
		return this.runVRunnerSequential(steps, opts, terminalName, commandId, true);
	}

	/**
	 * Последовательный запуск нескольких намерений vrunner одной цепочкой.
	 */
	protected async runIntentsSequential(
		intents: VRunnerIntent[],
		opts: CommandExecutionOptions | undefined,
		terminalName: string,
		commandId?: string
	): Promise<StructuredCommandResult | void> {
		const gate = await this.settingsGate(opts);
		if (gate) {
			return gate === 'blocked' ? undefined : gate;
		}
		const steps = await this.vrunner.planIntents(intents);
		return this.runVRunnerSequential(steps, opts, terminalName, commandId, true);
	}

	/**
	 * Универсальный запуск vrunner с поддержкой режимов wait: false (терминал) и wait: true (sync).
	 *
	 * @param planned - true, если args — финальный план интента (параметры
	 *                  профиля уже добавлены адаптером, повторно не дописывать)
	 */
	protected async runVRunner(
		args: string[],
		opts: CommandExecutionOptions | undefined,
		terminalName: string,
		artifact?: string,
		commandId?: string,
		planned = false
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

		const workspaceRoot = this.vrunner.getWorkspaceRoot() ?? cwd;
		const appendOverrides = planned ? false : undefined;

		if (opts?.wait === true) {
			const execute = async (): Promise<StructuredCommandResult> => {
				const result = await this.vrunner.executeVRunner(args, { cwd });
				return this.vrunnerResultToStructured(result, artifact) as StructuredCommandResult;
			};
			if (!commandId) {
				return execute();
			}
			return runWithHooks({ commandId, cwd, args, workspaceRoot, run: execute });
		}

		if (commandId) {
			void runHooksAroundTerminalTask({
				commandId, cwd, args, workspaceRoot,
				runTracked: () => this.vrunner.executeVRunnerTaskAndWait(args, { cwd, name: terminalName, appendOverrides }),
				runUntracked: () => this.vrunner.executeVRunnerInTerminal(args, { cwd, name: terminalName, appendOverrides }),
			}).catch((err) => log.error(`Ошибка хуков команды: ${(err as Error).message}`));
		} else {
			this.vrunner.executeVRunnerInTerminal(args, { cwd, name: terminalName, appendOverrides });
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
		planned = false
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

		const workspaceRoot = this.vrunner.getWorkspaceRoot() ?? cwd;
		const flatArgs = argsList.flat();
		const appendOverrides = planned ? false : undefined;

		if (opts?.wait === true) {
			const execute = async (): Promise<StructuredCommandResult> => {
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
				return { success, exitCode, stdout, stderr };
			};
			if (!commandId) {
				return execute();
			}
			return runWithHooks({ commandId, cwd, args: flatArgs, workspaceRoot, run: execute });
		}

		// Объединяем в одну цепочку (&& / ; — в зависимости от оболочки),
		// чтобы каждая следующая команда стартовала после реального завершения
		// предыдущей, а не по факту попадания в input-буфер терминала.
		if (commandId) {
			void runHooksAroundTerminalTask({
				commandId, cwd, args: flatArgs, workspaceRoot,
				runTracked: () => this.vrunner.executeVRunnerTaskSequenceAndWait(argsList, { cwd, name: terminalName, appendOverrides }),
				runUntracked: () => this.vrunner.executeVRunnerCommandsInSequence(argsList, { cwd, name: terminalName, appendOverrides }),
			}).catch((err) => log.error(`Ошибка хуков команды: ${(err as Error).message}`));
		} else {
			await this.vrunner.executeVRunnerCommandsInSequence(argsList, { cwd, name: terminalName, appendOverrides });
		}
	}
}
