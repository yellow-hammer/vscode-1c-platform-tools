/**
 * Что открыть в панели списков.
 *
 * Панель открывается одинаково от любого узла дерева: область задаёт набор
 * вкладок — кластер целиком или одна база, — а узел выбирает вкладку, с которой
 * панель открывается. Правило одно: показываем то, по чему нажали. Группа
 * «Сеансы» открывает сеансы, группа «Информационные базы» — список баз, сама
 * база — свои сеансы, кластер — первую свою вкладку, список баз.
 *
 * Модуль чистый: ни webview, ни rac — только выбор области и вкладки.
 */

import type { ActivityKind } from './activityTable';
import type { ClusterConnection } from './model';
import {
	ClusterNode,
	GroupNode,
	InfobaseNode,
	groupOpensTable,
	type ClusterTreeNode,
} from './nodes';

/** Область панели: кластер целиком или одна его база. */
export interface ActivityTarget {
	connection: ClusterConnection;
	clusterId: string;
	/** Информационная база, если открыли списки одной базы. */
	infobaseId?: string;
	/** Название для заголовка вкладки. */
	title: string;
}

/** Что открыть: область и вкладка, с которой начинаем. */
export interface ActivityRequest {
	target: ActivityTarget;
	kind: ActivityKind;
}

/**
 * Вкладки области.
 *
 * У одной базы вкладки «Информационные базы» нет: база уже выбрана.
 *
 * @param target - Область панели
 * @returns Списки в порядке вкладок; первый — стартовый
 */
export function activityKinds(target: ActivityTarget): ActivityKind[] {
	return target.infobaseId
		? ['sessions', 'connections', 'locks']
		: ['infobases', 'sessions', 'connections', 'locks'];
}

/**
 * Собирает запрос панели по узлу дерева.
 *
 * @param node - Узел, с которого вызвали списки
 * @returns Область и вкладка либо undefined, если узел таблицей не открывается
 */
export function activityRequest(node: ClusterTreeNode): ActivityRequest | undefined {
	if (node instanceof ClusterNode) {
		const target: ActivityTarget = {
			connection: node.connection,
			clusterId: node.cluster.id,
			title: node.cluster.name || node.cluster.host,
		};
		return { target, kind: activityKinds(target)[0] };
	}
	if (node instanceof InfobaseNode) {
		const target: ActivityTarget = {
			connection: node.connection,
			clusterId: node.clusterId,
			infobaseId: node.infobase.id,
			title: node.infobase.name,
		};
		return { target, kind: activityKinds(target)[0] };
	}
	if (node instanceof GroupNode) {
		if (!groupOpensTable(node.kind, node.scope)) {
			return undefined;
		}
		return {
			target: {
				connection: node.connection,
				clusterId: node.clusterId,
				infobaseId: node.scope.infobaseId,
				// Заголовок — та же область, что и у родителя группы: панель, открытая
				// от кластера и от его группы, называется одинаково.
				title: node.scope.infobaseName ?? node.scope.clusterName ?? node.connection.name,
			},
			kind: node.kind,
		};
	}
	return undefined;
}
