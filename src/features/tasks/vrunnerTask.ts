import * as vscode from 'vscode';
import { runCancellableCommand } from '../../shared/cancellableProcess';
import { logger } from '../../shared/logger';

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
}

/**
 * Параметры построения задачи vrunner для ad-hoc запуска из команд расширения.
 */
export interface VRunnerTaskParams {
	/** Имя задачи (заголовок панели и метка в списке задач). */
	name: string;
	/** Готовая строка команды для выполнения через системную оболочку. */
	command: string;
	/** Рабочая директория выполнения. */
	cwd: string;
	/** Дополнительные переменные окружения (поверх process.env). */
	env?: NodeJS.ProcessEnv;
	/** Имена problem matcher'ов (по умолчанию пусто). */
	problemMatchers?: string[];
	/** Определение задачи (по умолчанию строится из имени). */
	definition?: vscode.TaskDefinition;
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

	constructor(
		private readonly command: string,
		private readonly cwd: string,
		private readonly env?: NodeJS.ProcessEnv
	) {}

	public open(): void {
		log.debug(`запуск задачи: ${this.command}`);
		// Эхо исходной команды в начале вывода (как у штатных задач VS Code),
		// чтобы было видно, что именно запущено.
		this.writeEmitter.fire(`[90m> ${this.command}[0m\r\n\r\n`);
		runCancellableCommand(this.command, {
			cwd: this.cwd,
			env: this.env,
			token: this.cts.token,
			// Псевдотерминалу нужны переводы строки в формате \r\n.
			onOutput: (chunk) => this.writeEmitter.fire(chunk.replace(/\r?\n/g, '\r\n')),
		}).then((result) => {
			if (result.cancelled) {
				this.writeEmitter.fire('\r\n[33mЗадача остановлена[0m\r\n');
			}
			// Код < 0 (ошибка запуска или отмена) приводим к 1, чтобы VS Code пометил задачу неуспешной.
			this.closeEmitter.fire(result.exitCode >= 0 ? result.exitCode : 1);
		});
	}

	public close(): void {
		this.cts.cancel();
	}
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
	const scope = vscode.workspace.workspaceFolders?.[0] ?? vscode.TaskScope.Workspace;
	const definition: vscode.TaskDefinition =
		params.definition ?? { type: VRUNNER_TASK_TYPE, command: params.name };

	const execution = new vscode.CustomExecution(
		async () => new VRunnerPseudoterminal(params.command, params.cwd, params.env)
	);

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
		clear: true,
		showReuseMessage: false,
	};

	return task;
}
