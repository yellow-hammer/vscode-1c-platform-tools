import * as vscode from 'vscode';
import { runCancellableCommand } from '../../shared/cancellableProcess';
import { logger } from '../../shared/logger';
import { signalTaskFinished } from './taskFinishSignal';

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
	/** Вызывается с exit code при завершении задачи (для отслеживания результата). */
	exitCallback?: (exitCode: number) => void;
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
		private readonly command: string,
		private readonly cwd: string,
		private readonly env?: NodeJS.ProcessEnv,
		private readonly exitCallback?: (exitCode: number) => void
	) {}

	public open(): void {
		log.debug(`запуск задачи: ${this.command}`);
		this.startedAt = Date.now();
		// Эхо исходной команды в начале вывода (как у штатных задач VS Code),
		// чтобы было видно, что именно запущено. Служебный префикс кодировки прячем.
		const displayCommand = this.command.replaceAll('chcp 65001 >nul && ', '');
		this.writeEmitter.fire(`[90m> ${displayCommand}[0m\r\n\r\n`);
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
	return new VRunnerPseudoterminal(params.name, params.command, params.cwd, params.env, params.exitCallback);
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

	const execution = new vscode.CustomExecution(async () => createVRunnerTaskTerminal(params));

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
