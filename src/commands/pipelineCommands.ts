/**
 * Команды пайплайнов: запуск графа, создание и открытие файла.
 *
 * Пайплайн - граф шагов из `.1cpt/pipelines.json`. Узел выполняет команду
 * расширения, команду оболочки или спрашивает подтверждение, а связи выбирают
 * ветку по исходу узла. Команда расширения вызывается тем же путём, что из
 * панели, и её результат решает, куда пойдёт цепочка.
 */

import * as vscode from 'vscode';
import { withGroupedFinishSignals } from '../features/tasks/taskFinishSignal';
import { exec } from 'node:child_process';
import { BaseCommand } from './baseCommand';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';
import { logger } from '../shared/logger';
import { commandSupportsWait } from '../shared/mcpCommandPolicy';
import { commandTitle } from '../shared/commandCatalog';
import { readPipelines, writePipelines, pipelinesFilePath } from '../shared/pipelines/pipelineFile';
import {
	mergePipelineTemplates,
	mergeSummary,
	readPipelineTemplates,
} from '../shared/pipelines/pipelineTemplates';
import {
	nodeLabel,
	stepsWord,
	Pipeline,
	PipelineNode,
	PIPELINES_FILE_REL_PATH,
} from '../shared/pipelines/pipelineTypes';
import {
	formatRunSummary,
	stepErrorLine,
	stepOutputTail,
	runPipeline,
	validatePipeline,
	NodeExecutionResult,
	NodeOutcome,
	PipelineRunResult,
} from '../shared/pipelines/pipelineRunner';
import { emitPipelineRunEvent } from '../shared/pipelines/pipelineEvents';
import { PIPELINE_EDITOR_VIEW_TYPE, PipelineEditorProvider } from '../features/pipelines/pipelineEditorProvider';
import { notifyQuiet } from '../shared/notify';

const log = logger.scope('pipelines');

/** Сколько символов вывода команды оболочки оставлять в отчёте */
const SHELL_OUTPUT_LIMIT = 2_000;

/**
 * Сколько вывода шага уходит в панель «Вывод».
 *
 * Прогон конфигуратора выдаёт мегабайты, и целиком они панель забивают, поэтому
 * хвост: интересное у vanessa-runner и платформы в конце.
 */
const STEP_OUTPUT_LIMIT = 20_000;

/**
 * Префикс кодировки для команд оболочки: exec на Windows запускает cmd, где без
 * chcp вывод oscript и 1С приходит в OEM-кодировке.
 */
const SHELL_ENCODING_PREFIX = process.platform === 'win32' ? 'chcp 65001 >nul && ' : '';

export class PipelineCommands extends BaseCommand {
	/** Идентификаторы цепочек, которые сейчас выполняются: защита от вложенного самовызова */
	private readonly running = new Set<string>();

	/**
	 * Запускает пайплайн.
	 *
	 * Без идентификатора спрашивает, какой запускать; при wait: true молча
	 * отказывается выбирать за агента.
	 *
	 * @param opts - Опции выполнения: pipeline (идентификатор или название)
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async run(source?: CommandExecutionOptions | { pipelineId?: string }): Promise<StructuredCommandResult | void> {
		// Кнопка в дереве передаёт элемент, палитра и агент - опции выполнения
		const opts: CommandExecutionOptions | undefined =
			source !== undefined && 'pipelineId' in source
				? { pipeline: source.pipelineId }
				: (source as CommandExecutionOptions | undefined);
		const workspaceRoot = this.getExecutionCwd(opts);
		if (!workspaceRoot) {
			return this.rejectIfWait(opts, 'Откройте рабочую область для работы с проектом') ?? this.warnNoWorkspace();
		}

		const pipelines = await readPipelines(workspaceRoot);
		if (pipelines.length === 0) {
			const message = `Пайплайнов нет: ${PIPELINES_FILE_REL_PATH} пуст или отсутствует`;
			return this.rejectIfWait(opts, message) ?? this.showInfo(message);
		}

		const pipeline = await this.resolvePipeline(pipelines, opts);
		if (!pipeline) {
			return opts?.wait === true
				? this.executionError(
					`Пайплайн не найден. Доступны: ${pipelines.map((item) => item.id).join(', ')}`
				)
				: undefined;
		}

		const problems = validatePipeline(pipeline);
		if (problems.length > 0) {
			const message = `Пайплайн «${pipeline.name}»: ${problems.join('; ')}`;
			return this.rejectIfWait(opts, message) ?? this.showWarning(message);
		}

		if (this.running.has(pipeline.id)) {
			const message = `Пайплайн «${pipeline.name}» уже выполняется: шаг вызывает сам себя`;
			return this.rejectIfWait(opts, message) ?? this.showInfo(message);
		}

		this.running.add(pipeline.id);
		let result: PipelineRunResult;
		try {
			emitPipelineRunEvent({ kind: 'start', pipelineId: pipeline.id });
			result = await this.execute(pipeline, workspaceRoot, opts);
		} finally {
			this.running.delete(pipeline.id);
		}
		emitPipelineRunEvent({
			kind: 'finish',
			pipelineId: pipeline.id,
			success: result.success,
			cancelled: result.cancelled,
			nodes: result.nodes,
			durationMs: result.durationMs,
		});

		if (opts?.wait === true) {
			return {
				success: result.success,
				exitCode: result.success ? 0 : 1,
				stdout: formatRunSummary(result),
				stderr: result.success ? '' : this.firstFailureMessage(result),
			};
		}
		this.reportResult(result);
		return undefined;
	}

	/**
	 * Открывает файл пайплайнов в редакторе, создавая его при отсутствии.
	 *
	 * @param pipelineId - Цепочка, которую нужно выделить после открытия
	 * @returns Ничего
	 */
	async openEditor(pipelineId?: string): Promise<void> {
		const uri = await this.ensureFile();
		if (!uri) {
			return;
		}
		await vscode.commands.executeCommand('vscode.openWith', uri, PIPELINE_EDITOR_VIEW_TYPE);
		if (typeof pipelineId === 'string' && pipelineId !== '') {
			PipelineEditorProvider.revealPipeline(pipelineId);
		}
	}

	/**
	 * Ставит в проект типовые цепочки, поставляемые с расширением.
	 *
	 * Цепочку шаблона узнаём по идентификатору: повторная установка обновляет её, а остальные
	 * цепочки проекта, включая правленые руками, остаются как были.
	 *
	 * @returns Ничего
	 */
	async addTemplates(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		const extensionPath = this.vrunner.getExtensionPath();
		if (!extensionPath) {
			void vscode.window.showErrorMessage('Не удалось определить каталог расширения');
			return;
		}
		const templates = await readPipelineTemplates(extensionPath);
		if (templates.length === 0) {
			void vscode.window.showWarningMessage('Типовые пайплайны не найдены');
			return;
		}
		const existing = await readPipelines(workspaceRoot);
		const existingIds = new Set(existing.map((pipeline) => pipeline.id));
		const picked = await vscode.window.showQuickPick(
			templates.map((template) => ({
				label: template.name,
				description: existingIds.has(template.id) ? 'уже есть, будет обновлена' : undefined,
				picked: true,
				template,
			})),
			{
				canPickMany: true,
				title: 'Типовые пайплайны',
				placeHolder: 'Отметьте цепочки, которые добавить в проект',
			}
		);
		if (!picked || picked.length === 0) {
			return;
		}

		const result = mergePipelineTemplates(existing, picked.map((item) => item.template));
		await writePipelines(workspaceRoot, result.pipelines);
		const names = new Map(templates.map((template) => [template.id, template.name]));
		const summary = mergeSummary(result, names);
		log.info(summary);
		notifyQuiet(summary);
		await this.openEditor(picked[0].template.id);
	}

	/**
	 * Создаёт файл пайплайнов, если его нет.
	 *
	 * @returns Ссылка на файл или undefined без рабочей области
	 */
	private async ensureFile(): Promise<vscode.Uri | undefined> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return undefined;
		}
		const uri = vscode.Uri.file(pipelinesFilePath(workspaceRoot));
		try {
			await vscode.workspace.fs.stat(uri);
		} catch {
			await writePipelines(workspaceRoot, []);
			log.info(`Создан ${PIPELINES_FILE_REL_PATH}`);
		}
		return uri;
	}

	/**
	 * Выбирает пайплайн по идентификатору или спрашивает пользователя.
	 *
	 * @param pipelines - Доступные пайплайны
	 * @param opts - Опции выполнения
	 * @returns Пайплайн или undefined, если выбор отменён
	 */
	private async resolvePipeline(
		pipelines: Pipeline[],
		opts?: CommandExecutionOptions
	): Promise<Pipeline | undefined> {
		const requested = opts?.pipeline?.trim();
		if (requested) {
			const lowered = requested.toLowerCase();
			return pipelines.find(
				(item) => item.id.toLowerCase() === lowered || item.name.toLowerCase() === lowered
			);
		}
		if (opts?.wait === true) {
			return undefined;
		}
		const picked = await vscode.window.showQuickPick(
			pipelines.map((item) => ({
				label: item.name,
				description: `${item.nodes.length} ${stepsWord(item.nodes.length)}`,
				detail: item.description,
				pipeline: item,
			})),
			{ title: 'Запустить пайплайн', placeHolder: 'Выберите цепочку шагов' }
		);
		return picked?.pipeline;
	}

	/**
	 * Прогоняет граф, показывая ход в панели прогресса и на полотне редактора.
	 *
	 * @param pipeline - Пайплайн
	 * @param workspaceRoot - Корень проекта для команд оболочки
	 * @param opts - Опции выполнения, общие для узлов
	 * @returns Результат прогона
	 */
	private async execute(
		pipeline: Pipeline,
		workspaceRoot: string,
		opts?: CommandExecutionOptions
	): Promise<PipelineRunResult> {
		log.info(`Пайплайн «${pipeline.name}»: старт, шагов ${pipeline.nodes.length}`);
		const execute = async (node: PipelineNode): Promise<NodeExecutionResult> => {
			if (node.type === 'shell') {
				return this.runShell(node, workspaceRoot);
			}
			if (node.type === 'confirm') {
				return this.runConfirm(node, opts);
			}
			return this.runExtensionCommand(node, opts);
		};

		const observer = {
			onNodeStart: (node: PipelineNode, number: number): void => {
				emitPipelineRunEvent({ kind: 'nodeStart', pipelineId: pipeline.id, nodeId: node.id, number });
			},
			onNodeRetry: (node: PipelineNode, attempt: number): void => {
				log.warn(`Шаг «${nodeLabel(node, commandTitle)}» упал, попытка ${attempt + 1}`);
			},
			onNodeFinish: (outcome: NodeOutcome): void => {
				emitPipelineRunEvent({ kind: 'nodeFinish', pipelineId: pipeline.id, outcome });
				const statusText = outcome.status === 'ok' ? 'выполнен' : 'ошибка';
				const attemptsText = outcome.attempts ? `, попыток ${outcome.attempts}` : '';
				log.info(
					`Шаг ${outcome.number}. ${outcome.label}: ${statusText} за ${outcome.durationMs} мс${attemptsText}` +
					(outcome.message ? ` - ${outcome.message}` : '')
				);
			},
		};

		// Шаги цепочки о себе не сообщают: сигнал один, по итогу всего прогона.
		if (opts?.wait === true) {
			return withGroupedFinishSignals(
				`Пайплайн «${pipeline.name}»`,
				() => runPipeline(pipeline, execute, observer, commandTitle),
				(result) => result.success
			);
		}

		const withProgress = async (): Promise<PipelineRunResult> =>
			vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Пайплайн «${pipeline.name}»`,
					cancellable: true,
				},
				async (progress, token) =>
					runPipeline(
						pipeline,
						execute,
						{
							...observer,
							onNodeStart: (node, number) => {
								observer.onNodeStart(node, number);
								progress.report({ message: `${number}. ${nodeLabel(node, commandTitle)}` });
							},
							isCancelled: () => token.isCancellationRequested,
						},
						commandTitle
					)
			);

		return withGroupedFinishSignals(`Пайплайн «${pipeline.name}»`, withProgress, (result) => result.success);
	}

	/**
	 * Выполняет команду расширения.
	 *
	 * @param node - Узел графа
	 * @param opts - Опции выполнения, общие для узлов
	 * @returns Исход узла
	 */
	/**
	 * Пишет вывод шага в панель «Вывод».
	 *
	 * Шаги пайплайна идут захваченными, без терминала, поэтому без этого вывод
	 * vanessa-runner и команд оболочки не виден нигде: остаются только отметки
	 * «шаг выполнен» и отчёт по прогону.
	 *
	 * @param label - Название шага
	 * @param output - Собранный вывод команды
	 */
	private logStepOutput(label: string, output: string): void {
		const tail = stepOutputTail(output, STEP_OUTPUT_LIMIT);
		if (tail === undefined) {
			return;
		}
		log.info(`Вывод шага «${label}»:
${tail}`);
	}

	private async runExtensionCommand(
		node: PipelineNode,
		opts?: CommandExecutionOptions
	): Promise<NodeExecutionResult> {
		if (node.command === undefined) {
			return { success: false, message: 'у шага не задана команда' };
		}
		const nodeOptions = { ...(node.options ?? {}) } as CommandExecutionOptions;
		if (opts?.projectPath !== undefined && nodeOptions.projectPath === undefined) {
			nodeOptions.projectPath = opts.projectPath;
		}
		if (!commandSupportsWait(node.command)) {
			await vscode.commands.executeCommand(node.command, nodeOptions);
			return { success: true };
		}
		const result = (await vscode.commands.executeCommand(node.command, {
			...nodeOptions,
			wait: true,
		})) as StructuredCommandResult | undefined;
		if (!result) {
			return { success: true };
		}
		this.logStepOutput(
			nodeLabel(node, commandTitle),
			`${result.stdout ?? ''}
${result.stderr ?? ''}`
		);
		return {
			success: result.success,
			exitCode: result.exitCode,
			message: result.success ? undefined : this.shortError(result),
		};
	}

	/**
	 * Выполняет команду оболочки в корне проекта.
	 *
	 * @param node - Узел графа
	 * @param cwd - Рабочий каталог
	 * @returns Исход узла
	 */
	private async runShell(node: PipelineNode, cwd: string): Promise<NodeExecutionResult> {
		const script = node.script?.trim();
		if (!script) {
			return { success: false, message: 'у шага не задана команда оболочки' };
		}
		// Без префикса кодировки вывод oscript и 1С на Windows приходит в OEM
		const command = `${SHELL_ENCODING_PREFIX}${script}`;
		return new Promise<NodeExecutionResult>((resolve) => {
			exec(
				command,
				{
					cwd,
					windowsHide: true,
					maxBuffer: 10 * 1024 * 1024,
					...(node.timeout !== undefined ? { timeout: node.timeout * 1000 } : {}),
				},
				(error, stdout, stderr) => {
					const output = `${stdout}${stderr}`.trim();
					this.logStepOutput(nodeLabel(node, commandTitle), output);
					if (!error) {
						log.info(`Команда оболочки завершилась: ${script}`);
						resolve({ success: true, exitCode: 0 });
						return;
					}
					const exitCode = typeof error.code === 'number' ? error.code : 1;
					const tail = output.slice(-SHELL_OUTPUT_LIMIT);
					log.warn(`Команда оболочки упала (${exitCode}): ${script}\n${tail}`);
					resolve({
						success: false,
						exitCode,
						message: stepErrorLine(tail) ?? `код возврата ${exitCode}`,
					});
				}
			);
		});
	}

	/**
	 * Спрашивает подтверждение перед продолжением цепочки.
	 *
	 * @param node - Узел графа
	 * @param opts - Опции выполнения
	 * @returns Исход узла
	 */
	private async runConfirm(
		node: PipelineNode,
		opts?: CommandExecutionOptions
	): Promise<NodeExecutionResult> {
		const message = node.message ?? 'Продолжить выполнение пайплайна?';
		if (opts?.wait === true) {
			return { success: false, message: `шаг ждёт подтверждения: ${message}` };
		}
		const answer = await vscode.window.showInformationMessage(
			message,
			{ modal: true },
			'Продолжить'
		);
		return answer === 'Продолжить'
			? { success: true }
			: { success: false, message: 'продолжение не подтверждено' };
	}

	/**
	 * Показывает итог прогона: успех сообщением, ошибку с переходом в журнал.
	 *
	 * @param result - Результат прогона
	 */
	private reportResult(result: PipelineRunResult): void {
		log.info(`${formatRunSummary(result)}
Всего: ${(result.durationMs / 1000).toFixed(1)} с`);
		if (result.cancelled) {
			void vscode.window.showInformationMessage(`Пайплайн «${result.pipelineName}» отменён`);
			return;
		}
		if (result.success) {
			notifyQuiet(`Пайплайн «${result.pipelineName}» выполнен`);
			return;
		}
		const failed = result.nodes.find((node) => node.status === 'failed');
		const where = failed ? `шаг ${failed.number}. ${failed.label}` : 'прогон прерван';
		void vscode.window
			.showErrorMessage(`Пайплайн «${result.pipelineName}»: ${where}`, 'Показать журнал')
			.then((choice) => {
				if (choice === 'Показать журнал') {
					logger.show();
				}
			});
	}

	/**
	 * Первая ошибка прогона для поля stderr.
	 *
	 * @param result - Результат прогона
	 * @returns Текст ошибки
	 */
	private firstFailureMessage(result: PipelineRunResult): string {
		const failed = result.nodes.find((node) => node.status === 'failed');
		if (!failed) {
			return result.cancelled ? 'Прогон отменён' : 'Прогон прерван';
		}
		return `Шаг ${failed.number}. ${failed.label}: ${failed.message ?? 'завершился с ошибкой'}`;
	}

	/**
	 * Короткое описание ошибки шага из результата команды.
	 *
	 * @param result - Результат выполнения команды
	 * @returns Текст ошибки
	 */
	private shortError(result: StructuredCommandResult): string {
		const source = result.stderr.trim() || result.stdout.trim();
		return this.lastLine(source) ?? `код возврата ${result.exitCode}`;
	}

	/**
	 * Последняя непустая строка текста.
	 *
	 * @param text - Вывод команды
	 * @returns Строка или undefined для пустого вывода
	 */
	private lastLine(text: string): string | undefined {
		return text.split(/\r?\n/).filter((line) => line.trim() !== '').pop();
	}

	private warnNoWorkspace(): undefined {
		void vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
		return undefined;
	}

	private showInfo(message: string): undefined {
		void vscode.window.showInformationMessage(message);
		return undefined;
	}

	private showWarning(message: string): undefined {
		void vscode.window.showWarningMessage(message);
		return undefined;
	}
}
