/**
 * Строки дерева установленных пакетов OneScript.
 * @module dependencyTree
 */

import { readPackageManifest } from '../../shared/oneScriptLayout';
import { dependencyInsight } from './dependencyInsight';
import {
	buildDependencyForest,
	dependencyReport,
	dependencySummary,
	dependencyTooltip,
	dependencyVersionLabel,
	flattenDependencyNodes,
	type DependencyForest,
	type DependencyNode,
	type DependencyReportPackage,
} from './dependencyModel';
import { readInstalledPackages } from './installedPackages';

/** Какая иконка у строки. */
export type DependencyRowIcon = 'folder' | 'warning' | 'update' | 'hint' | 'dev' | 'package' | 'extra';

/** Строка дерева пакетов, без типов VS Code. */
export interface DependencyTreeRow {
	label: string;
	description?: string;
	tooltip?: string;
	icon: DependencyRowIcon;
	/** Имя пакета для команды обновления одной зависимости. */
	packageName?: string;
	children: DependencyTreeRow[];
}

/**
 * Строка над списком: сколько пакетов, что можно обновить, какие проблемы.
 *
 * @param root - Корень проекта OneScript
 */
export function dependencyTreeMessage(root: string): string {
	const nodes = flattenDependencyNodes(forestOf(root));
	if (nodes.length === 0) {
		return '';
	}
	const insight = dependencyInsight(root);
	return dependencySummary(nodes, {
		checked: insight?.checked ?? false,
		diagnosed: insight?.diagnosed ?? false,
	});
}

/**
 * Прямые зависимости, отдельно стоящие установки и замечания.
 * Пустой список — одна строка «Нет зависимостей».
 *
 * @param root - Корень проекта OneScript
 */
export function dependencyTreeRows(root: string): DependencyTreeRow[] {
	const forest = forestOf(root);
	if (flattenDependencyNodes(forest).length === 0) {
		return [{ label: 'Нет зависимостей', icon: 'hint', children: [] }];
	}
	return [
		...forest.packages.map(rowOf),
		...(forest.extra.length > 0
			? [{
				label: 'Ещё установленные',
				icon: 'extra' as const,
				children: forest.extra.map(rowOf),
			}]
			: []),
		...forest.notes.map(rowOf),
	];
}

/**
 * Плоский список для ответа команды и сводка строки «Пакеты».
 *
 * @param root - Корень проекта
 */
export function dependencySnapshot(root: string): { packages: DependencyReportPackage[]; summary: string } {
	const forest = forestOf(root);
	const insight = dependencyInsight(root);
	return {
		packages: dependencyReport(forest),
		summary: dependencySummary(flattenDependencyNodes(forest), {
			checked: insight?.checked ?? false,
			diagnosed: insight?.diagnosed ?? false,
		}),
	};
}

function forestOf(root: string): DependencyForest {
	const insight = dependencyInsight(root);
	return buildDependencyForest(
		readPackageManifest(root)?.dependencies ?? [],
		readInstalledPackages(root),
		insight?.updates ?? new Map(),
		insight?.problems ?? new Map(),
	);
}

function rowOf(node: DependencyNode): DependencyTreeRow {
	const problem = node.problems.some((item) => item.severity === 'problem');
	const hint = node.problems.some((item) => item.severity === 'hint');
	let icon: DependencyRowIcon = 'package';
	if (problem) {
		icon = 'warning';
	} else if (node.outdated) {
		icon = 'update';
	} else if (hint) {
		icon = 'hint';
	} else if (node.direct && node.dev) {
		icon = 'dev';
	}
	const description = dependencyVersionLabel(node);
	return {
		label: node.name,
		...(description !== '' ? { description } : {}),
		tooltip: dependencyTooltip(node),
		icon,
		...(node.direct ? { packageName: node.name } : {}),
		children: node.children.map(rowOf),
	};
}
