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
import { currentRoot, runWithProject, workspaceFolderOf } from '../../shared/workspaceProjects';
import { taskProjectRoot } from '../tasks/vrunnerTask';

/** Тип задачи в `tasks.json` */
export const PIPELINE_TASK_TYPE = '1c-pipeline';

/** Описание задачи пайплайна */
export interface PipelineTaskDefinition extends vscode.TaskDefinition {
	type: typeof PIPELINE_TASK_TYPE;
	/** Идентификатор или название цепочки */
	pipeline: string;
	/** Профиль запуска на этот прогон вместо выбранного в редакторе */
	profile?: string;
	/** Окружение на этот прогон вместо выбранного в редакторе; пустая строка — по умолчанию */
	environment?: string;
	/** Корень проекта: абсолютный путь или путь от папки рабочей области задачи */
	project?: string;
}

/**
 * Строит задачу для цепочки.
 *
 * @param root - Корень проекта, в котором идёт цепочка
 * @param pipelineId - Идентификатор цепочки
 * @param label - Подпись задачи
 * @param detail - Пояснение в списке задач
 * @param definition - Определение из tasks.json; без него строится своё
 * @returns Задача VS Code
 */
export function buildPipelineTask(
	root: string,
	pipelineId: string,
	label: string,
	detail?: string,
	definition?: PipelineTaskDefinition
): vscode.Task {
	const task = new vscode.Task(
		definition ?? { type: PIPELINE_TASK_TYPE, pipeline: pipelineId, project: root },
		workspaceFolderOf(root) ?? vscode.TaskScope.Workspace,
		label,
		'1C: Platform Tools',
		new vscode.CustomExecution(async () => new PipelineTaskTerminal(pipelineId, root, definition))
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

	constructor(
		private readonly pipelineId: string,
		private readonly root: string,
		private readonly definition?: PipelineTaskDefinition
	) {}

	/**
	 * Запускает цепочку и закрывает задачу по её итогу.
	 */
	async open(): Promise<void> {
		this.writeEmitter.fire(`Пайплайн «${this.pipelineId}»\r\n`);
		const result = (await runWithProject(this.root, () =>
			vscode.commands.executeCommand('1c-platform-tools.pipelines.run', {
				pipeline: this.pipelineId,
				profile: this.definition?.profile,
				environment: this.definition?.environment,
				wait: true,
			})
		)) as { success?: boolean; stdout?: string; stderr?: string } | undefined;

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
	 * Отдаёт задачу на каждую сохранённую цепочку текущего проекта.
	 *
	 * @returns Список задач
	 */
	async provideTasks(): Promise<vscode.Task[]> {
		const root = currentRoot();
		if (root === undefined) {
			return [];
		}
		const pipelines = await readPipelines(root);
		return pipelines.map((pipeline) =>
			buildPipelineTask(
				root,
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
		const root = taskProjectRoot(task.scope, definition.project);
		if (root === undefined || typeof definition.pipeline !== 'string' || definition.pipeline === '') {
			return undefined;
		}
		return buildPipelineTask(root, definition.pipeline, task.name, task.detail, definition);
	}
}
