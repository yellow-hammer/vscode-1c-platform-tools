/**
 * Пайплайны как задачи VS Code.
 *
 * Цепочки видны в «Tasks: Run Task», их можно повесить на горячую клавишу,
 * включить в составную задачу и вызвать из `tasks.json`. Сама работа идёт той
 * же командой запуска, поэтому отчёт, подсветка на полотне и хуки не меняются.
 */

import * as vscode from 'vscode';
import { readPipelines } from '../../shared/pipelines/pipelineFile';
import { stepsWord } from '../../shared/pipelines/pipelineTypes';

/** Тип задачи в `tasks.json` */
export const PIPELINE_TASK_TYPE = '1c-pipeline';

/** Описание задачи пайплайна */
interface PipelineTaskDefinition extends vscode.TaskDefinition {
	type: typeof PIPELINE_TASK_TYPE;
	/** Идентификатор или название цепочки */
	pipeline: string;
}

/**
 * Строит задачу для цепочки.
 *
 * @param folder - Папка рабочей области
 * @param pipelineId - Идентификатор цепочки
 * @param label - Подпись задачи
 * @param detail - Пояснение в списке задач
 * @returns Задача VS Code
 */
function buildTask(
	folder: vscode.WorkspaceFolder,
	pipelineId: string,
	label: string,
	detail?: string
): vscode.Task {
	const definition: PipelineTaskDefinition = { type: PIPELINE_TASK_TYPE, pipeline: pipelineId };
	const task = new vscode.Task(
		definition,
		folder,
		label,
		'1C: Platform Tools',
		new vscode.CustomExecution(async () => new PipelineTaskTerminal(pipelineId))
	);
	task.detail = detail;
	return task;
}

/**
 * Терминал задачи: работу делает команда запуска, здесь только её вызов.
 *
 * Своего вывода у задачи нет: отчёт по шагам пишется в журнал расширения, а ход
 * прогона виден на полотне редактора.
 */
class PipelineTaskTerminal implements vscode.Pseudoterminal {
	private readonly writeEmitter = new vscode.EventEmitter<string>();
	private readonly closeEmitter = new vscode.EventEmitter<number>();

	readonly onDidWrite = this.writeEmitter.event;
	readonly onDidClose = this.closeEmitter.event;

	constructor(private readonly pipelineId: string) {}

	/**
	 * Запускает цепочку и закрывает задачу по её итогу.
	 */
	async open(): Promise<void> {
		this.writeEmitter.fire(`Пайплайн «${this.pipelineId}»\r\n`);
		const result = (await vscode.commands.executeCommand('1c-platform-tools.pipelines.run', {
			pipeline: this.pipelineId,
			wait: true,
		})) as { success?: boolean; stdout?: string; stderr?: string } | undefined;

		const report = (result?.stdout ?? '').split('\n').join('\r\n');
		if (report !== '') {
			this.writeEmitter.fire(`${report}\r\n`);
		}
		if (result?.stderr) {
			this.writeEmitter.fire(`${result.stderr}\r\n`);
		}
		this.closeEmitter.fire(result?.success === true ? 0 : 1);
	}

	/** Закрытие терминала пользователем: прогон продолжается в панели прогресса. */
	close(): void {
		this.closeEmitter.fire(0);
	}
}

export class PipelineTaskProvider implements vscode.TaskProvider {
	/**
	 * Регистрирует поставщика задач пайплайнов.
	 *
	 * @returns Disposable регистрации
	 */
	static register(): vscode.Disposable {
		return vscode.tasks.registerTaskProvider(PIPELINE_TASK_TYPE, new PipelineTaskProvider());
	}

	/**
	 * Отдаёт задачу на каждую сохранённую цепочку.
	 *
	 * @returns Список задач
	 */
	async provideTasks(): Promise<vscode.Task[]> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return [];
		}
		const pipelines = await readPipelines(folder.uri.fsPath);
		return pipelines.map((pipeline) =>
			buildTask(
				folder,
				pipeline.id,
				pipeline.name,
				pipeline.description ?? `${pipeline.nodes.length} ${stepsWord(pipeline.nodes.length)}`
			)
		);
	}

	/**
	 * Дополняет задачу, описанную в `tasks.json` вручную.
	 *
	 * @param task - Задача из файла
	 * @returns Готовая к запуску задача или undefined, если цепочка не указана
	 */
	resolveTask(task: vscode.Task): vscode.Task | undefined {
		const definition = task.definition as PipelineTaskDefinition;
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder || typeof definition.pipeline !== 'string' || definition.pipeline === '') {
			return undefined;
		}
		return buildTask(folder, definition.pipeline, task.name, task.detail);
	}
}
