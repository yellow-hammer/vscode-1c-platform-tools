/**
 * Обход графа пайплайна: узел выполняется, ветка выбирается по его исходу.
 *
 * Модуль не знает про vscode: действие выполняет переданный исполнитель, ход
 * работы уходит в наблюдателя. Так граф можно прогнать в тестах и вызвать как
 * из редактора, так и от агента.
 *
 * Порядок обхода детерминированный: узлы берутся в порядке готовности, ветки -
 * в порядке объявления связей. Параллельно ничего не запускается: команды
 * платформы конкурируют за информационную базу.
 */

import {
	nodeLabel,
	resolveNodeParams,
	startNodes,
	Pipeline,
	PipelineEdge,
	PipelineNode,
} from './pipelineTypes';

/** Чем закончился узел */
export type NodeStatus = 'ok' | 'failed' | 'skipped' | 'notRun';

/** Результат одного узла */
export interface NodeOutcome {
	/** Порядковый номер выполнения, с единицы */
	number: number;
	nodeId: string;
	/** Подпись узла для отчёта */
	label: string;
	status: NodeStatus;
	/** Причина ошибки или пропуска */
	message?: string;
	/** Код возврата, если действие его вернуло */
	exitCode?: number;
	/** Сколько раз шаг перезапускался после ошибки */
	attempts?: number;
	durationMs: number;
}

/** Результат прогона графа */
export interface PipelineRunResult {
	pipelineId: string;
	pipelineName: string;
	success: boolean;
	nodes: NodeOutcome[];
	durationMs: number;
	/** Прогон прерван отменой */
	cancelled: boolean;
}

/** Что вернуло действие узла */
export interface NodeExecutionResult {
	success: boolean;
	exitCode?: number;
	message?: string;
}

/** Выполняет действие узла */
export type NodeExecutor = (node: PipelineNode) => Promise<NodeExecutionResult>;

/** Ход выполнения для полотна редактора и журнала */
export interface PipelineObserver {
	onNodeStart?: (node: PipelineNode, number: number) => void;
	/** Шаг упал и будет перезапущен */
	onNodeRetry?: (node: PipelineNode, attempt: number) => void;
	onNodeFinish?: (outcome: NodeOutcome) => void;
	/** Прогон прерван снаружи (отмена в панели прогресса) */
	isCancelled?: () => boolean;
}

/** Условие связи с учётом значения по умолчанию */
function edgeCondition(edge: PipelineEdge): 'success' | 'error' | 'always' {
	return edge.on ?? 'success';
}

/**
 * Прогоняет граф пайплайна.
 *
 * Узел с несколькими входящими связями по умолчанию выполняется, как только
 * пришла первая ветка; с `join: 'all'` ждёт все ветки, которые ещё могут
 * сработать. Ветка `error` продолжает прогон после падения, но сам упавший узел
 * остаётся ошибкой в отчёте: обработанное падение не делает прогон успешным.
 *
 * @param pipeline - Граф
 * @param execute - Исполнитель действия узла
 * @param observer - Наблюдатель за ходом
 * @param titleForCommand - Заголовок команды по идентификатору
 * @returns Результат прогона со сводкой по узлам
 */
export async function runPipeline(
	pipeline: Pipeline,
	execute: NodeExecutor,
	observer: PipelineObserver = {},
	titleForCommand?: (commandId: string) => string | undefined
): Promise<PipelineRunResult> {
	const startedAt = Date.now();
	const byId = new Map(pipeline.nodes.map((node) => [node.id, node]));
	const outcomes: NodeOutcome[] = [];
	const done = new Map<string, NodeStatus>();
	/** Узлы, до которых дошла хотя бы одна ветка */
	const activated = new Set(startNodes(pipeline).map((node) => node.id));
	/** Связи, которые уже точно не сработают: ветка не выбрана или узел не выполнялся */
	const deadEdges = new Set<PipelineEdge>();
	let cancelled = false;
	let number = 0;

	/** Может ли связь ещё сработать: её источник не пройден и не отброшен */
	const edgePending = (edge: PipelineEdge): boolean =>
		!deadEdges.has(edge) && !done.has(edge.from);

	/**
	 * Помечает мёртвыми связи, ведущие из узлов, до которых прогон уже не дойдёт.
	 *
	 * Без этого узел с join: all ждал бы ветку, которая никогда не придёт:
	 * её начало отброшено выше по графу.
	 */
	const propagateDead = (): void => {
		let changed = true;
		while (changed) {
			changed = false;
			for (const node of pipeline.nodes) {
				if (done.has(node.id) || activated.has(node.id)) {
					continue;
				}
				const incoming = pipeline.edges.filter((edge) => edge.to === node.id);
				if (incoming.length === 0 || incoming.some((edge) => !deadEdges.has(edge))) {
					continue;
				}
				for (const edge of pipeline.edges.filter((item) => item.from === node.id)) {
					if (!deadEdges.has(edge)) {
						deadEdges.add(edge);
						changed = true;
					}
				}
			}
		}
	};

	/** Узел готов: активирован и, при join: all, все входящие ветки уже решены */
	const isReady = (node: PipelineNode): boolean => {
		if (done.has(node.id) || !activated.has(node.id)) {
			return false;
		}
		if (node.join !== 'all') {
			return true;
		}
		return !pipeline.edges.some((edge) => edge.to === node.id && edgePending(edge));
	};

	const takeNext = (): PipelineNode | undefined => pipeline.nodes.find((node) => isReady(node));

	for (let node = takeNext(); node !== undefined; node = takeNext()) {
		if (observer.isCancelled?.() === true) {
			cancelled = true;
			break;
		}

		let outcome: NodeOutcome;
		if (node.enabled === false) {
			outcome = {
				number: 0, nodeId: node.id, label: nodeLabel(node, titleForCommand),
				status: 'skipped', message: 'узел выключен', durationMs: 0,
			};
		} else {
			number += 1;
			observer.onNodeStart?.(node, number);
			const nodeStartedAt = Date.now();
			// Повтор задают там, где шаг иногда падает не по своей вине:
			// сеть, занятая база, конкурентная сборка
			const attemptsAllowed = Math.max(1, (node.retry ?? 0) + 1);
			const prepared = resolveNodeParams(node, pipeline.params);
			let attempt = 0;
			let lastError: string | undefined;
			let lastExitCode: number | undefined;
			let success = false;
			while (attempt < attemptsAllowed && !success) {
				attempt += 1;
				try {
					const result = await execute(prepared);
					success = result.success;
					lastError = result.message;
					lastExitCode = result.exitCode;
				} catch (error) {
					success = false;
					lastError = error instanceof Error ? error.message : String(error);
					lastExitCode = undefined;
				}
				if (!success && attempt < attemptsAllowed) {
					observer.onNodeRetry?.(node, attempt);
				}
			}
			outcome = {
				number, nodeId: node.id, label: nodeLabel(node, titleForCommand),
				status: success ? 'ok' : 'failed',
				message: success ? undefined : lastError,
				exitCode: lastExitCode,
				attempts: attempt > 1 ? attempt : undefined,
				durationMs: Date.now() - nodeStartedAt,
			};
		}

		done.set(node.id, outcome.status);
		outcomes.push(outcome);
		if (outcome.status !== 'skipped') {
			observer.onNodeFinish?.(outcome);
		}

		// Выключенный узел ведёт себя как успешный: он пропущен, а не сломан
		const branch = outcome.status === 'failed' ? 'error' : 'success';
		for (const edge of pipeline.edges.filter((item) => item.from === node.id)) {
			const condition = edgeCondition(edge);
			if (condition === 'always' || condition === branch) {
				activated.add(edge.to);
			} else {
				deadEdges.add(edge);
			}
		}
		propagateDead();
	}

	// Узлы, до которых прогон не дошёл: видно, где цепочка встала
	for (const node of pipeline.nodes) {
		if (!done.has(node.id)) {
			outcomes.push({
				number: 0, nodeId: node.id, label: nodeLabel(node, titleForCommand),
				status: 'notRun', durationMs: 0,
			});
		}
	}

	const executed = outcomes.filter((outcome) => outcome.status === 'ok' || outcome.status === 'failed');
	return {
		pipelineId: pipeline.id,
		pipelineName: pipeline.name,
		success: !cancelled && executed.length > 0 && executed.every((outcome) => outcome.status === 'ok'),
		nodes: outcomes,
		durationMs: Date.now() - startedAt,
		cancelled,
	};
}

/**
 * Проверяет граф на изъяны, которые видны до запуска.
 *
 * @param pipeline - Граф
 * @returns Список замечаний; пустой, если граф пригоден к прогону
 */
export function validatePipeline(pipeline: Pipeline): string[] {
	const problems: string[] = [];
	if (pipeline.nodes.length === 0) {
		problems.push('в пайплайне нет ни одного шага');
		return problems;
	}
	if (startNodes(pipeline).length === 0) {
		problems.push('нет начального шага: каждый шаг имеет входящую связь');
	}

	// Узел в цикле никогда не станет готовым: обход остановится раньше времени
	const reachable = new Set(startNodes(pipeline).map((node) => node.id));
	let grew = true;
	while (grew) {
		grew = false;
		for (const edge of pipeline.edges) {
			if (reachable.has(edge.from) && !reachable.has(edge.to)) {
				reachable.add(edge.to);
				grew = true;
			}
		}
	}
	const unreachable = pipeline.nodes.filter((node) => !reachable.has(node.id));
	if (unreachable.length > 0) {
		problems.push(
			`шаги не выполнятся, до них нет пути: ${unreachable.map((node) => node.name ?? node.id).join(', ')}`
		);
	}

	// Блок мог остаться незаполненным: на полотно поставили, действие не задали
	const empty = pipeline.nodes.filter(
		(node) =>
			node.enabled !== false &&
			((node.type === 'command' && (node.command ?? '') === '') ||
				(node.type === 'shell' && (node.script ?? '').trim() === ''))
	);
	if (empty.length > 0) {
		problems.push(
			`у шагов не задано действие: ${empty.map((node) => node.name ?? node.id).join(', ')}`
		);
	}
	return problems;
}

/**
 * Собирает текстовую сводку прогона: по строке на выполненный узел.
 *
 * @param result - Результат прогона
 * @returns Многострочный отчёт
 */
export function formatRunSummary(result: PipelineRunResult): string {
	const marks: Record<NodeStatus, string> = {
		ok: 'выполнен',
		failed: 'ошибка',
		skipped: 'пропущен',
		notRun: 'не выполнялся',
	};
	const lines = result.nodes
		.filter((outcome) => outcome.status !== 'notRun')
		.map((outcome) => {
			const suffix = outcome.message ? `: ${outcome.message}` : '';
			const prefix = outcome.number > 0 ? `${outcome.number}. ` : '';
			const attempts = outcome.attempts ? ` (попыток: ${outcome.attempts})` : '';
			return `${prefix}${outcome.label} - ${marks[outcome.status]}${attempts}${suffix}`;
		});
	const skipped = result.nodes.filter((outcome) => outcome.status === 'notRun');
	if (skipped.length > 0) {
		lines.push(`не выполнялись: ${skipped.map((outcome) => outcome.label).join(', ')}`);
	}
	const header = result.cancelled
		? `Пайплайн «${result.pipelineName}» отменён`
		: result.success
			? `Пайплайн «${result.pipelineName}» выполнен`
			: `Пайплайн «${result.pipelineName}» завершился с ошибкой`;
	return [header, ...lines].join('\n');
}
