/**
 * Применение scope/фильтров к ER-графу проекта.
 *
 * @module er/erFilters
 */

import type { ErEdge, ErGraph, ErNode, ErScope, ErSubgraph } from './erTypes';

/**
 * Возвращает подграф по выбранному scope.
 *
 * Шаги:
 * 1. По seeds выбираем стартовое множество узлов; для scope=all берём все узлы.
 * 2. Раскручиваем N-hop-соседей (учитываем рёбра в обе стороны и фильтр relationKinds).
 * 3. Фильтруем рёбра: оба конца должны быть в выбранных узлах + допустимые relationKinds.
 * 4. Применяем фильтр по objectTypes.
 */
export function buildSubgraph(graph: ErGraph, scope: ErScope): ErSubgraph {
	const allowedKinds = scope.relationKinds === null ? null : new Set(scope.relationKinds);
	const allowedTypes = scope.objectTypes.length === 0 ? null : new Set(scope.objectTypes);

	const nodeByKey = new Map<string, ErNode>();
	for (const node of graph.nodes) {
		nodeByKey.set(node.key, node);
	}

	const adjacency = new Map<string, ErEdge[]>();
	for (const edge of graph.edges) {
		if (allowedKinds && !allowedKinds.has(edge.kind)) {
			continue;
		}
		const fromList = adjacency.get(edge.sourceKey) ?? [];
		fromList.push(edge);
		adjacency.set(edge.sourceKey, fromList);
		const toList = adjacency.get(edge.targetKey) ?? [];
		toList.push(edge);
		adjacency.set(edge.targetKey, toList);
	}

	const selected = new Set<string>();
	if (scope.kind === 'all' || scope.seeds.length === 0) {
		for (const node of graph.nodes) {
			selected.add(node.key);
		}
	} else {
		for (const seed of scope.seeds) {
			if (nodeByKey.has(seed)) {
				selected.add(seed);
			}
		}
		const hops = Math.max(0, scope.hops | 0);
		let frontier = new Set(selected);
		for (let depth = 0; depth < hops; depth += 1) {
			const next = new Set<string>();
			for (const key of frontier) {
				const edges = adjacency.get(key) ?? [];
				for (const edge of edges) {
					const other = edge.sourceKey === key ? edge.targetKey : edge.sourceKey;
					if (!selected.has(other) && nodeByKey.has(other)) {
						selected.add(other);
						next.add(other);
					}
				}
			}
			if (next.size === 0) {
				break;
			}
			frontier = next;
		}
	}

	const filteredNodes: ErNode[] = [];
	for (const key of selected) {
		const node = nodeByKey.get(key);
		if (!node) {
			continue;
		}
		if (allowedTypes && !allowedTypes.has(node.objectType)) {
			continue;
		}
		filteredNodes.push(node);
	}
	filteredNodes.sort((a, b) => a.key.localeCompare(b.key, 'ru'));

	const finalKeys = new Set(filteredNodes.map((n) => n.key));
	const filteredEdges: ErEdge[] = [];
	for (const edge of graph.edges) {
		if (!finalKeys.has(edge.sourceKey) || !finalKeys.has(edge.targetKey)) {
			continue;
		}
		if (allowedKinds && !allowedKinds.has(edge.kind)) {
			continue;
		}
		filteredEdges.push(edge);
	}

	return { nodes: filteredNodes, edges: filteredEdges };
}

/** Список ключей подсистем, в которые входит объект (включая его собственный ключ, если объект — Subsystem). */
export function neighboursOf(graph: ErGraph, key: string): { incoming: ErEdge[]; outgoing: ErEdge[] } {
	const incoming: ErEdge[] = [];
	const outgoing: ErEdge[] = [];
	for (const edge of graph.edges) {
		if (edge.sourceKey === key) {
			outgoing.push(edge);
		}
		if (edge.targetKey === key) {
			incoming.push(edge);
		}
	}
	return { incoming, outgoing };
}

/** Все объекты, входящие в подсистему (по {@code subsystemKeys} узла). */
export function nodesInSubsystem(graph: ErGraph, subsystemKey: string): ErNode[] {
	const out: ErNode[] = [];
	for (const node of graph.nodes) {
		if (node.subsystemKeys.includes(subsystemKey)) {
			out.push(node);
		}
	}
	return out;
}

/** Уникальные виды связи, встретившиеся в графе. */
export function listRelationKinds(graph: ErGraph): string[] {
	const set = new Set<string>();
	for (const edge of graph.edges) {
		set.add(edge.kind);
	}
	return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** Уникальные типы объектов в графе. */
export function listObjectTypes(graph: ErGraph): string[] {
	const set = new Set<string>();
	for (const node of graph.nodes) {
		set.add(node.objectType);
	}
	return Array.from(set).sort((a, b) => a.localeCompare(b));
}
