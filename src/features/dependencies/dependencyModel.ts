/**
 * Дерево зависимостей проекта OneScript.
 *
 * Прямые зависимости берутся из `packagedef`, связи — из `opm-metadata.xml`
 * установленных пакетов: дочерний пакет стоит под тем, кто его затянул.
 * Версии и замечания приходят из отчётов depos и накладываются сверху.
 * @module dependencyModel
 */

import type { PackageDependency } from '../../shared/packagedef';
import type { InstalledPackage } from './installedPackages';
import { notInstalledProblem, type DeposPackageDiagnosis, type DeposPackageProblem, type DeposVersionUpdate } from './deposReport';

/** Узел дерева зависимостей. */
export interface DependencyNode {
	name: string;
	/** Прямая зависимость `packagedef`. */
	direct: boolean;
	/** Зависимость для разработки. */
	dev: boolean;
	/** Минимум из `packagedef`. */
	required?: string;
	/** Версия установленного пакета. */
	installed?: string;
	/** Более новая версия из `depos check`. */
	available?: string;
	/** В хабе есть версия новее минимума из `packagedef`. */
	outdated: boolean;
	/** Прямые зависимости, из-за которых пакет оказался в проекте. */
	via: string[];
	problems: DeposPackageProblem[];
	children: DependencyNode[];
}

/** Прямые зависимости, прочие установленные и замечания без пакета в дереве. */
export interface DependencyForest {
	packages: DependencyNode[];
	extra: DependencyNode[];
	notes: DependencyNode[];
}

/** Что уже спрашивали у depos. */
export interface DependencyInsightState {
	checked: boolean;
	diagnosed: boolean;
}

const NOT_INSTALLED = notInstalledProblem();

/**
 * Собирает дерево: прямые зависимости, пакеты под тем, кто их затянул,
 * остальные установленные и замечания depos о пакетах вне дерева.
 *
 * @param declared - Зависимости из `packagedef`
 * @param installed - Пакеты из `oscript_modules`
 * @param updates - Отчёт `depos check`; пустая карта, если проверки не было
 * @param problems - Отчёт `depos doctor`; пустая карта, если диагностики не было
 */
export function buildDependencyForest(
	declared: readonly PackageDependency[],
	installed: readonly InstalledPackage[],
	updates: ReadonlyMap<string, DeposVersionUpdate>,
	problems: ReadonlyMap<string, DeposPackageDiagnosis>,
): DependencyForest {
	const declaredByKey = new Map<string, PackageDependency>();
	for (const dependency of declared) {
		declaredByKey.set(dependency.name.toLowerCase(), dependency);
	}
	const installedByKey = new Map<string, InstalledPackage>();
	for (const pkg of installed) {
		installedByKey.set(pkg.name.toLowerCase(), pkg);
	}
	const parents = parentIndex(installedByKey);
	const displayName = new Map<string, string>();
	for (const [key, dependency] of declaredByKey) {
		displayName.set(key, dependency.name);
	}
	for (const [key, pkg] of installedByKey) {
		if (!displayName.has(key)) {
			displayName.set(key, pkg.name);
		}
	}

	const placed = new Map<string, DependencyNode>();
	const packages: DependencyNode[] = [];
	const declaredOrder = [...declared].sort((left, right) => {
		if (left.dev !== right.dev) {
			return left.dev ? 1 : -1;
		}
		return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
	});
	for (const dependency of declaredOrder) {
		const key = dependency.name.toLowerCase();
		if (placed.has(key)) {
			continue;
		}
		const node = makeNode(key, true, dependency.dev, declaredByKey, installedByKey, updates, problems, []);
		placed.set(key, node);
		packages.push(node);
	}

	let progressed = true;
	while (progressed) {
		progressed = false;
		for (const [key] of installedByKey) {
			if (placed.has(key)) {
				continue;
			}
			const parentKey = chooseParent(key, parents, placed, declaredByKey);
			if (parentKey === undefined) {
				continue;
			}
			const parentPackage = installedByKey.get(parentKey);
			const edge = parentPackage?.dependencies.find((item) => item.name.toLowerCase() === key);
			const node = makeNode(
				key,
				false,
				edge?.dev ?? false,
				declaredByKey,
				installedByKey,
				updates,
				problems,
				reachingDirects(key, parents, declaredByKey, displayName),
			);
			placed.get(parentKey)?.children.push(node);
			placed.set(key, node);
			progressed = true;
		}
	}
	for (const node of placed.values()) {
		node.children.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
	}

	const extra: DependencyNode[] = [];
	for (const [key, pkg] of installedByKey) {
		if (placed.has(key)) {
			continue;
		}
		extra.push(makeNode(key, false, false, declaredByKey, installedByKey, updates, problems, reachingDirects(key, parents, declaredByKey, displayName), pkg.name));
	}
	extra.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));

	const notes: DependencyNode[] = [];
	for (const [key, diagnosis] of problems) {
		if (placed.has(key) || extra.some((node) => node.name.toLowerCase() === key)) {
			continue;
		}
		notes.push({
			name: diagnosis.name,
			direct: false,
			dev: false,
			outdated: false,
			via: [],
			problems: [...diagnosis.problems],
			children: [],
		});
	}
	notes.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
	return { packages, extra, notes };
}

/**
 * Подпись версии для строки дерева.
 *
 * @param node - Узел
 */
export function dependencyVersionLabel(node: DependencyNode): string {
	const parts: string[] = [];
	if (node.direct && node.dev) {
		parts.push('для разработки');
	}
	const current = node.installed ?? node.required;
	if (node.outdated && node.available !== undefined) {
		parts.push(`${current !== undefined && current !== '' ? current : '*'} → ${node.available}`);
	} else if (node.installed !== undefined) {
		parts.push(node.installed);
	}
	if (node.direct && node.installed === undefined) {
		parts.push(NOT_INSTALLED.text);
	}
	const problem = node.problems.find((item) => item.severity === 'problem' && item.code !== NOT_INSTALLED.code);
	if (problem !== undefined) {
		parts.push(problem.text);
	}
	return parts.join(' · ');
}

/**
 * Подсказка узла: версии, откуда пришёл пакет и замечания.
 *
 * @param node - Узел
 */
export function dependencyTooltip(node: DependencyNode): string {
	const lines = [node.name];
	if (node.direct && node.dev) {
		lines.push('для разработки');
	}
	if (node.required !== undefined) {
		lines.push(`в packagedef: ${node.required}`);
	}
	if (node.installed !== undefined) {
		lines.push(`установлено: ${node.installed}`);
	} else if (node.direct) {
		lines.push(NOT_INSTALLED.text);
	}
	if (node.available !== undefined) {
		lines.push(`доступно: ${node.available}`);
	}
	if (node.via.length > 0) {
		lines.push(`пришёл через: ${node.via.join(', ')}`);
	}
	for (const problem of node.problems) {
		if (problem.code === NOT_INSTALLED.code && node.direct && node.installed === undefined) {
			continue;
		}
		lines.push('');
		lines.push(problem.text);
		if (problem.detail !== undefined) {
			lines.push(problem.detail);
		}
	}
	return lines.join('\n');
}

/**
 * Краткая сводка для папки пакетов.
 *
 * @param nodes - Все узлы дерева
 * @param state - Были ли уже проверка и диагностика
 */
export function dependencySummary(nodes: readonly DependencyNode[], state: DependencyInsightState): string {
	if (nodes.length === 0) {
		return 'нет';
	}
	const parts: string[] = [];
	const problemCount = nodes.filter((node) => node.problems.some((item) => item.severity === 'problem')).length;
	if (problemCount > 0) {
		parts.push(countLabel(problemCount, 'проблема', 'проблемы', 'проблем'));
	}
	const outdated = nodes.filter((node) => node.outdated).length;
	if (outdated > 0) {
		parts.push(`можно обновить: ${outdated}`);
	}
	if (parts.length > 0) {
		return parts.join(' · ');
	}
	if (state.checked) {
		return 'актуальны';
	}
	if (state.diagnosed) {
		return 'проблем нет';
	}
	return countLabel(nodes.length, 'пакет', 'пакета', 'пакетов');
}

/** Узлы леса в порядке обхода. */
export function flattenDependencyNodes(forest: DependencyForest): DependencyNode[] {
	const nodes: DependencyNode[] = [];
	const walk = (list: readonly DependencyNode[]): void => {
		for (const node of list) {
			nodes.push(node);
			walk(node.children);
		}
	};
	walk(forest.packages);
	walk(forest.extra);
	walk(forest.notes);
	return nodes;
}

/** Пакет для ответа агенту. */
export interface DependencyReportPackage {
	name: string;
	dev: boolean;
	direct: boolean;
	required?: string;
	installed?: string;
	available?: string;
	via: string[];
	problems: string[];
	hints: string[];
}

/**
 * Плоский список для ответа команды.
 *
 * @param forest - Дерево
 */
export function dependencyReport(forest: DependencyForest): DependencyReportPackage[] {
	return flattenDependencyNodes(forest).map((node) => ({
		name: node.name,
		dev: node.dev,
		direct: node.direct,
		...(node.required !== undefined ? { required: node.required } : {}),
		...(node.installed !== undefined ? { installed: node.installed } : {}),
		...(node.available !== undefined ? { available: node.available } : {}),
		via: node.via,
		problems: node.problems.filter((item) => item.severity === 'problem').map((item) => item.text),
		hints: node.problems.filter((item) => item.severity === 'hint').map((item) => item.text),
	}));
}

function makeNode(
	key: string,
	direct: boolean,
	dev: boolean,
	declaredByKey: ReadonlyMap<string, PackageDependency>,
	installedByKey: ReadonlyMap<string, InstalledPackage>,
	updates: ReadonlyMap<string, DeposVersionUpdate>,
	problems: ReadonlyMap<string, DeposPackageDiagnosis>,
	via: string[],
	fallbackName?: string,
): DependencyNode {
	const declared = declaredByKey.get(key);
	const installed = installedByKey.get(key);
	const update = updates.get(key);
	const available = update !== undefined && update.targetMin !== '' && update.targetMin !== update.currentMin
		? update.targetMin
		: undefined;
	const shown = installed?.version ?? declared?.version ?? (update !== undefined && update.currentMin !== '' ? update.currentMin : undefined);
	const outdated = available !== undefined && available !== shown;
	const nodeProblems = [...(problems.get(key)?.problems ?? [])];
	if (direct && installed === undefined && !nodeProblems.some((item) => item.code === NOT_INSTALLED.code)) {
		nodeProblems.unshift(NOT_INSTALLED);
	}
	return {
		name: declared?.name ?? installed?.name ?? fallbackName ?? key,
		direct,
		dev,
		...(declared?.version !== undefined ? { required: declared.version } : {}),
		...(installed?.version !== undefined ? { installed: installed.version } : {}),
		...(available !== undefined ? { available } : {}),
		outdated,
		via,
		problems: nodeProblems,
		children: [],
	};
}

function parentIndex(installedByKey: ReadonlyMap<string, InstalledPackage>): Map<string, string[]> {
	const parents = new Map<string, string[]>();
	for (const [parentKey, pkg] of installedByKey) {
		for (const dependency of pkg.dependencies) {
			const child = dependency.name.toLowerCase();
			const list = parents.get(child) ?? [];
			if (!list.includes(parentKey)) {
				list.push(parentKey);
			}
			parents.set(child, list);
		}
	}
	return parents;
}

function chooseParent(
	key: string,
	parents: ReadonlyMap<string, readonly string[]>,
	placed: ReadonlyMap<string, DependencyNode>,
	declaredByKey: ReadonlyMap<string, PackageDependency>,
): string | undefined {
	const options = (parents.get(key) ?? []).filter((parent) => placed.has(parent));
	return options.find((parent) => declaredByKey.has(parent)) ?? options[0];
}

function reachingDirects(
	key: string,
	parents: ReadonlyMap<string, readonly string[]>,
	declaredByKey: ReadonlyMap<string, PackageDependency>,
	displayName: ReadonlyMap<string, string>,
): string[] {
	const found: string[] = [];
	const seen = new Set<string>();
	const queue = [...(parents.get(key) ?? [])];
	while (queue.length > 0) {
		const parent = queue.shift();
		if (parent === undefined || seen.has(parent)) {
			continue;
		}
		seen.add(parent);
		if (declaredByKey.has(parent)) {
			found.push(displayName.get(parent) ?? parent);
			continue;
		}
		for (const higher of parents.get(parent) ?? []) {
			queue.push(higher);
		}
	}
	return found;
}

function countLabel(count: number, one: string, few: string, many: string): string {
	const mod10 = count % 10;
	const mod100 = count % 100;
	const word = mod10 === 1 && mod100 !== 11
		? one
		: mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
			? few
			: many;
	return `${count} ${word}`;
}
