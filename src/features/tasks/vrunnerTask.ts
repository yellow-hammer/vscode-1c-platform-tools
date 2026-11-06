import * as path from 'node:path';
import * as vscode from 'vscode';
import { runCancellableCommand, type CommandRun, type ProcessCommand } from '../../shared/cancellableProcess';
import { logger } from '../../shared/logger';
import { currentRoot, deepestProject, projectOf, workspaceFolderOf } from '../../shared/workspaceProjects';
import { signalTaskFinished } from './taskFinishSignal';
import { rememberTaskProject } from './terminalProjects';

const log = logger.scope('vrunner-task');

/** Тип задачи vrunner в tasks.json (contributes.taskDefinitions). */
export const VRUNNER_TASK_TYPE = '1c-vrunner';

/** Источник задач, отображаемый в списке Tasks: Run Task. */
export const VRUNNER_TASK_SOURCE = '1C: Platform Tools';

/**
 * Определение задачи vrunner для tasks.json.
 *
 * `command` — имя команды vrunner (например, `vanessa`, `compile`, `syntax-check`),
 * `args` — дополнительные аргументы. Используется при разрешении пользовательских
 * задач из tasks.json в {@link VRunnerTaskProvider}.
 */
export interface VRunnerTaskDefinition extends vscode.TaskDefinition {
	command: string;
	args?: string[];
	/** Корень проекта: абсолютный путь или путь от папки рабочей области задачи. */
	project?: string;
}

/**
 * Корень проекта задачи из tasks.json.
 *
 * Явный `project` берётся от папки задачи. Без него: текущий проект, если он в
 * папке задачи; иначе проект, в котором лежит папка, или сама папка.
 *
 * @param scope - Область задачи
 * @param project - Значение `project` из определения задачи
 * @returns Корень или undefined, когда проекта нет
 */
export function taskProjectRoot(scope: vscode.Task['scope'], project: unknown): string | undefined {
	const folder = typeof scope === 'object' && scope !== null ? scope.uri.fsPath : undefined;
	const current = currentRoot();
	if (typeof project === 'string' && project.trim() !== '') {
		const value = project.trim();
		if (path.isAbsolute(value)) {
			return value;
		}
		const base = folder ?? current;
		return base === undefined ? undefined : path.resolve(base, value);
	}
	if (folder === undefined) {
		return current;
	}
	if (current !== undefined && deepestProject([{ root: folder }], current) !== undefined) {
		return current;
	}
	return projectOf(folder) ?? folder;
}

/**
 * Параметры построения задачи vrunner для ad-hoc запуска из команд расширения.
 */
export interface VRunnerTaskParams {
	/** Имя задачи (заголовок панели и метка в списке задач). */
	name: string;
	/**
	 * Строка команды для системной оболочки либо программа с аргументами. Функция
	 * вызывается на каждый запуск задачи, включая повтор, и отдаёт команду с
	 * уборкой при остановке.
	 */
	command: ProcessCommand | (() => CommandRun);
	/** Рабочая директория выполнения. */
	cwd: string;
	/** Дополнительные переменные окружения (поверх process.env). */
	env?: NodeJS.ProcessEnv;
	/** Имена problem matcher'ов (по умолчанию пусто). */
	problemMatchers?: string[];
	/** Определение задачи (по умолчанию строится из имени). */
	definition?: vscode.TaskDefinition;
	/** Вызывается с exit code при завершении задачи (для отслеживания результата). */
	exitCallback?: (exitCode: number) => void;
	/** Дописать вывод к прошлой задаче в терминале, а не очистить его: шаги одной команды читаются подряд. */
	appendOutput?: boolean;
	/** Получает вывод процесса по мере появления. */
	onOutput?: (chunk: string) => void;
	/** Корень проекта: папка рабочей области задачи, её определение и ссылки в выводе; по умолчанию текущий проект. */
	root?: string;
}

/**
 * Вывод шагов одной команды.
 *
 * В общем терминале первая задача очищает его, остальные дописывают, иначе каждый
 * шаг стирал бы вывод предыдущего. Шаги команды, которую ждёт вызывающий (цепочка,
 * агент), идут в фоне, без терминала, как vrunner в этом режиме.
 */
export class TaskOutputChain {
	private tasks = 0;

	/** @param background - Шаги идут в фоне, без терминала */
	constructor(public readonly background = false) {}

	/** Дописывать ли вывод очередной задачи; звать при её создании. */
	public append(): boolean {
		return this.tasks++ > 0;
	}
}

/**
 * Команда в том виде, в каком её показывает эхо задачи.
 *
 * Служебный префикс кодировки не показывается. Программа с аргументами
 * показывается без экранирования под оболочку.
 *
 * @param command - Команда задачи
 * @returns Текст для эха и журнала
 */
function commandEcho(command: ProcessCommand): string {
	if (typeof command !== 'string') {
		return [command.file, ...command.args].map(quoteForEcho).join(' ');
	}
	return command.replaceAll('chcp 65001 >nul && ', '');
}

/** Аргумент с пробелом, кавычкой или пустой берётся в кавычки. */
function quoteForEcho(value: string): string {
	return value === '' || /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

/**
 * Псевдотерминал, исполняющий команду vrunner как отменяемый дочерний процесс.
 *
 * Поток вывода транслируется в панель задачи. Закрытие панели (или остановка
 * задачи) отменяет процесс с завершением всего дерева (cmd → oscript → 1cv8).
 */
class VRunnerPseudoterminal implements vscode.Pseudoterminal {
	private readonly writeEmitter = new vscode.EventEmitter<string>();
	public readonly onDidWrite = this.writeEmitter.event;

	private readonly closeEmitter = new vscode.EventEmitter<number>();
	public readonly onDidClose = this.closeEmitter.event;

	private readonly cts = new vscode.CancellationTokenSource();

	private startedAt = 0;

	constructor(
		private readonly name: string,
		private readonly run: CommandRun,
		private readonly cwd: string,
		private readonly env?: NodeJS.ProcessEnv,
		private readonly exitCallback?: (exitCode: number) => void,
		private readonly onOutput?: (chunk: string) => void,
		private readonly root?: string
	) {}

	public open(): void {
		log.debug(`запуск задачи: ${commandEcho(this.run.command)}`);
		this.startedAt = Date.now();
		if (this.root !== undefined) {
			rememberTaskProject({ name: this.name, source: VRUNNER_TASK_SOURCE }, this.root);
		}
		// Эхо исходной команды в начале вывода (как у штатных задач VS Code),
		// чтобы было видно, что именно запущено. Служебный префикс кодировки прячем.
		const displayCommand = commandEcho(this.run.command);
		this.writeEmitter.fire(`[90m> ${displayCommand}[0m\r\n\r\n`);
		runCancellableCommand(this.run.command, {
			cwd: this.cwd,
			env: this.run.env === undefined ? this.env : { ...this.env, ...this.run.env },
			token: this.cts.token,
			onCancel: this.run.onCancel,
			onCancelled: this.run.onCancelled,
			onExit: this.run.onExit,
			// Псевдотерминалу нужны переводы строки в формате \r\n.
			onOutput: (chunk) => {
				this.onOutput?.(chunk);
				this.writeEmitter.fire(chunk.replace(/\r?\n/g, '\r\n'));
			},
		}).then((result) => {
			if (result.cancelled) {
				this.writeEmitter.fire('\r\n[33mЗадача остановлена[0m\r\n');
			}
			// Код < 0 (ошибка запуска или отмена) приводим к 1, чтобы VS Code пометил задачу неуспешной.
			const exitCode = result.exitCode >= 0 ? result.exitCode : 1;
			if (!result.cancelled) {
				// Остановленная задача о себе не сообщает: пользователь остановил её сам.
				signalTaskFinished({ name: this.name, exitCode, durationMs: Date.now() - this.startedAt });
			}
			this.exitCallback?.(exitCode);
			this.closeEmitter.fire(exitCode);
		});
	}

	public close(): void {
		this.cts.cancel();
	}
}

/**
 * Строит псевдотерминал задачи: он исполняет команду и сообщает о её завершении.
 *
 * @param params - Параметры задачи (имя, команда, cwd, окружение)
 * @returns Псевдотерминал для {@link vscode.CustomExecution}
 */
export function createVRunnerTaskTerminal(params: VRunnerTaskParams): vscode.Pseudoterminal {
	return new VRunnerPseudoterminal(
		params.name,
		typeof params.command === 'function' ? params.command() : { command: params.command },
		params.cwd,
		params.env,
		params.exitCallback,
		params.onOutput,
		params.root ?? currentRoot()
	);
}

/**
 * Строит задачу VS Code для запуска готовой команды vrunner.
 *
 * Задача исполняется через {@link VRunnerPseudoterminal}, поэтому поддерживает
 * Docker, отмену и единый способ построения команды (как у синхронного пути).
 * Запуск через `vscode.tasks.executeTask` делает задачу доступной для «Rerun Last Task».
 *
 * @param params - Параметры задачи (имя, команда, cwd, окружение)
 * @returns Готовая к выполнению задача VS Code
 */
export function createVRunnerTask(params: VRunnerTaskParams): vscode.Task {
	const root = params.root ?? currentRoot();
	const scope = (root === undefined ? undefined : workspaceFolderOf(root)) ?? vscode.TaskScope.Workspace;
	const definition: vscode.TaskDefinition =
		params.definition ?? { type: VRUNNER_TASK_TYPE, command: params.name, ...(root === undefined ? {} : { project: root }) };

	const execution = new vscode.CustomExecution(async () => createVRunnerTaskTerminal({ ...params, root }));

	const task = new vscode.Task(
		definition,
		scope,
		params.name,
		VRUNNER_TASK_SOURCE,
		execution,
		params.problemMatchers ?? []
	);

	task.presentationOptions = {
		reveal: vscode.TaskRevealKind.Always,
		panel: vscode.TaskPanelKind.Shared,
		clear: params.appendOutput !== true,
		showReuseMessage: false,
	};

	return task;
}

/**
 * Задача, которая пишет готовый текст в терминал.
 *
 * @param name - Заголовок задачи
 * @param text - Текст
 * @param root - Корень проекта
 */
export async function showTextTask(name: string, text: string, root?: string): Promise<void> {
	const project = root ?? currentRoot();
	const scope = (project === undefined ? undefined : workspaceFolderOf(project)) ?? vscode.TaskScope.Workspace;
	const execution = new vscode.CustomExecution(async () => {
		const writeEmitter = new vscode.EventEmitter<string>();
		const closeEmitter = new vscode.EventEmitter<number>();
		return {
			onDidWrite: writeEmitter.event,
			onDidClose: closeEmitter.event,
			open() {
				const startedAt = Date.now();
				if (project !== undefined) {
					rememberTaskProject({ name, source: VRUNNER_TASK_SOURCE }, project);
				}
				const body = text.endsWith('\n') ? text : `${text}\n`;
				writeEmitter.fire(body.replace(/\r?\n/g, '\r\n'));
				signalTaskFinished({ name, exitCode: 0, durationMs: Date.now() - startedAt });
				closeEmitter.fire(0);
			},
			close() {},
		};
	});
	const task = new vscode.Task(
		{ type: VRUNNER_TASK_TYPE, command: name, ...(project === undefined ? {} : { project }) },
		scope,
		name,
		VRUNNER_TASK_SOURCE,
		execution
	);
	task.presentationOptions = {
		reveal: vscode.TaskRevealKind.Always,
		panel: vscode.TaskPanelKind.Shared,
		clear: true,
		showReuseMessage: false,
	};
	await vscode.tasks.executeTask(task);
}
