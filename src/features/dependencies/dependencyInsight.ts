/**
 * Последние отчёты depos по корню проекта.
 *
 * Живут в памяти окна: проверка и диагностика ходят в сеть и по исходникам,
 * дерево читает их при каждой перерисовке.
 * @module dependencyInsight
 */

import { directoryKey } from '../../shared/projectLayout';
import type { DeposPackageDiagnosis, DeposVersionUpdate } from './deposReport';

/** Что уже известно о зависимостях проекта. */
export interface DependencyInsight {
	checked: boolean;
	diagnosed: boolean;
	updates: Map<string, DeposVersionUpdate>;
	problems: Map<string, DeposPackageDiagnosis>;
}

const insights = new Map<string, DependencyInsight>();
const listeners = new Set<() => void>();

/**
 * Подписка на смену отчёта: дерево перерисовывается.
 *
 * @param listener - Что вызвать
 * @returns Отписка
 */
export function onDidChangeDependencyInsight(listener: () => void): { dispose: () => void } {
	listeners.add(listener);
	return {
		dispose: () => {
			listeners.delete(listener);
		},
	};
}

/**
 * Отчёт проекта, если проверка или диагностика уже выполнялись.
 *
 * @param root - Корень проекта
 */
export function dependencyInsight(root: string): DependencyInsight | undefined {
	return insights.get(directoryKey(root));
}

/**
 * Запоминает отчёт `depos check`. Замечания прошлой диагностики сохраняются.
 *
 * @param root - Корень проекта
 * @param updates - Версии из отчёта
 */
export function rememberDependencyCheck(root: string, updates: Map<string, DeposVersionUpdate>): void {
	const insight = ensure(root);
	insight.checked = true;
	insight.updates = updates;
	emit();
}

/**
 * Запоминает отчёт `depos doctor`. Найденные ранее версии сохраняются.
 *
 * @param root - Корень проекта
 * @param problems - Замечания из отчёта
 */
export function rememberDependencyDoctor(root: string, problems: Map<string, DeposPackageDiagnosis>): void {
	const insight = ensure(root);
	insight.diagnosed = true;
	insight.problems = problems;
	emit();
}

/**
 * Сбрасывает отчёт: манифест или установка изменились, цифры устарели.
 *
 * @param root - Корень проекта
 */
export function forgetDependencyInsight(root: string): void {
	insights.delete(directoryKey(root));
}

function ensure(root: string): DependencyInsight {
	const key = directoryKey(root);
	const existing = insights.get(key);
	if (existing !== undefined) {
		return existing;
	}
	const created: DependencyInsight = {
		checked: false,
		diagnosed: false,
		updates: new Map(),
		problems: new Map(),
	};
	insights.set(key, created);
	return created;
}

function emit(): void {
	for (const listener of listeners) {
		listener();
	}
}
