/**
 * События прогона пайплайна.
 *
 * Через них полотно редактора подсвечивает узлы по ходу выполнения, не зная,
 * откуда цепочку запустили: из дерева, палитры, редактора или от агента.
 */

import * as vscode from 'vscode';
import type { NodeOutcome } from './pipelineRunner';

/** Что происходит с прогоном */
export type PipelineRunEvent =
	| { kind: 'start'; pipelineId: string }
	| { kind: 'nodeStart'; pipelineId: string; nodeId: string; number: number }
	| { kind: 'nodeFinish'; pipelineId: string; outcome: NodeOutcome }
	| {
			kind: 'finish';
			pipelineId: string;
			success: boolean;
			cancelled: boolean;
			/** Пошаговый отчёт: редактор показывает его таблицей */
			nodes: NodeOutcome[];
			durationMs: number;
	  };

const emitter = new vscode.EventEmitter<PipelineRunEvent>();

/** Событие хода прогона пайплайна */
export const onPipelineRunEvent = emitter.event;

/**
 * Сообщает о ходе прогона подписчикам.
 *
 * @param event - Событие прогона
 */
export function emitPipelineRunEvent(event: PipelineRunEvent): void {
	emitter.fire(event);
}
