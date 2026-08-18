/**
 * Дерево «Управление кластерами 1С».
 *
 * Ветки загружаются по требованию: обращение к серверу администрирования стоит
 * сетевого вызова, и строить всё дерево целиком при открытии панели было бы
 * расточительно. Загруженные ветки кэшируются, поэтому повторная отрисовка
 * (например, при показе счётчика объектов) новых вызовов rac не делает — кэш
 * сбрасывается обновлением ветки или всего дерева.
 */

import * as vscode from 'vscode';
import type { ClusterService, ServiceResult } from './clusterService';
import type { ConnectionStore } from './connectionStore';
import {
	sortConnections,
	sortAdmins,
	sortInfobases,
	sortManagers,
	sortProcesses,
	sortServers,
	sortSessions,
} from './model';
import {
	ClusterNode,
	ClusterTreeNode,
	ConnectionItemNode,
	ConnectionNode,
	GroupNode,
	InfobaseNode,
	AdminNode,
	LockNode,
	ManagerNode,
	MessageNode,
	ProcessNode,
	ServerNode,
	SessionNode,
	type GroupKind,
} from './nodes';

/** Ключ кэша для корня дерева. */
const ROOT_KEY = 'root';

export class ClustersProvider implements vscode.TreeDataProvider<ClusterTreeNode> {
	private readonly emitter = new vscode.EventEmitter<ClusterTreeNode | undefined>();
	readonly onDidChangeTreeData = this.emitter.event;

	/** Загруженные дочерние узлы: ключ узла → его дети. */
	private readonly cache = new Map<string, ClusterTreeNode[]>();

	constructor(
		private readonly store: ConnectionStore,
		private readonly service: ClusterService
	) {}

	getTreeItem(element: ClusterTreeNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ClusterTreeNode): Promise<ClusterTreeNode[]> {
		const key = element?.cacheKey ?? ROOT_KEY;
		const cached = this.cache.get(key);
		if (cached) {
			return cached;
		}
		const children = await this.load(element);
		this.cache.set(key, children);
		if (element instanceof GroupNode) {
			this.updateGroupCount(element, children);
		}
		return children;
	}

	/** Сбрасывает всё дерево. */
	refresh(): void {
		this.cache.clear();
		this.emitter.fire(undefined);
	}

	/**
	 * Обновляет ветку узла.
	 *
	 * @param node - Узел, ветку которого нужно перечитать
	 */
	refreshNode(node: ClusterTreeNode): void {
		this.invalidate(node.cacheKey);
		this.emitter.fire(node);
	}

	/**
	 * Обновляет ветку кластера, к которому относится узел.
	 *
	 * После завершения сеанса или снятия блокировки меняются сразу несколько
	 * списков кластера — сеансы, соединения, блокировки, — поэтому обновляется
	 * весь кластер, а не только список, из которого пришло действие.
	 *
	 * @param node - Узел внутри кластера
	 */
	refreshCluster(node: ClusterTreeNode): void {
		const clusterKey = /^(conn:[^/]+\/cluster:[^/]+)/.exec(node.cacheKey)?.[1];
		if (!clusterKey) {
			this.refresh();
			return;
		}
		this.invalidate(clusterKey);
		this.emitter.fire(undefined);
	}

	/**
	 * Убирает из кэша узел и всё его поддерево.
	 *
	 * @param prefix - Ключ узла
	 */
	private invalidate(prefix: string): void {
		for (const key of [...this.cache.keys()]) {
			if (key === prefix || key.startsWith(`${prefix}/`)) {
				this.cache.delete(key);
			}
		}
	}

	/**
	 * Показывает в подписи группы количество объектов.
	 *
	 * Счётчик известен только после загрузки, поэтому узел обновляется повторно.
	 * Второй проход берёт детей из кэша: сеть при этом не задействуется, а
	 * совпавший счётчик события не вызывает — обновление не зацикливается.
	 *
	 * @param group - Группа
	 * @param children - Загруженные дочерние узлы
	 */
	private updateGroupCount(group: GroupNode, children: ClusterTreeNode[]): void {
		const count = children.filter((child) => !(child instanceof MessageNode)).length;
		const description = String(count);
		if (group.description !== description) {
			group.description = description;
			this.emitter.fire(group);
		}
	}

	/**
	 * Загружает дочерние узлы.
	 *
	 * @param element - Узел или undefined для корня
	 * @returns Дочерние узлы
	 */
	private async load(element?: ClusterTreeNode): Promise<ClusterTreeNode[]> {
		if (!element) {
			return this.store.list().map((connection) => new ConnectionNode(connection));
		}
		if (element instanceof ConnectionNode) {
			return this.loadClusters(element);
		}
		if (element instanceof ClusterNode) {
			return this.clusterGroups(element);
		}
		if (element instanceof ServerNode) {
			return [
				new GroupNode(
					element.connection,
					element.clusterId,
					'processes',
					{ serverId: element.server.id },
					element.cacheKey
				),
			];
		}
		if (element instanceof ProcessNode) {
			return [
				new GroupNode(
					element.connection,
					element.clusterId,
					'connections',
					{ processId: element.process.id },
					element.cacheKey
				),
			];
		}
		if (element instanceof InfobaseNode) {
			const scope = { infobaseId: element.infobase.id, infobaseName: element.infobase.name };
			return (['sessions', 'connections', 'locks'] as GroupKind[]).map(
				(kind) =>
					new GroupNode(element.connection, element.clusterId, kind, scope, element.cacheKey)
			);
		}
		if (element instanceof GroupNode) {
			return this.loadGroup(element);
		}
		return [];
	}

	/**
	 * Загружает кластеры подключения.
	 *
	 * @param node - Узел подключения
	 * @returns Узлы кластеров либо сообщение о причине неудачи
	 */
	private async loadClusters(node: ConnectionNode): Promise<ClusterTreeNode[]> {
		const result = await this.service.listClusters(node.connection);
		// Администраторы центрального сервера висят рядом с кластерами, как в
		// консоли кластера: это список самого сервера, а не какого-то кластера.
		const admins = new GroupNode(node.connection, '', 'agentAdmins', {}, node.cacheKey);
		return this.materialize(node.cacheKey, result, 'На сервере администрирования нет кластеров', (clusters) => [
			...clusters.map((cluster) => new ClusterNode(node.connection, cluster)),
			admins,
		]);
	}

	/**
	 * Строит группы кластера.
	 *
	 * @param node - Узел кластера
	 * @returns Группы объектов кластера
	 */
	private clusterGroups(node: ClusterNode): ClusterTreeNode[] {
		const kinds: GroupKind[] = [
			'infobases',
			'clusterAdmins',
			'servers',
			'processes',
			'managers',
			'sessions',
			'connections',
			'locks',
		];
		return kinds.map((kind) => new GroupNode(node.connection, node.cluster.id, kind, {}, node.cacheKey));
	}

	/**
	 * Загружает содержимое группы с учётом её области.
	 *
	 * @param group - Группа
	 * @returns Узлы объектов либо сообщение
	 */
	private async loadGroup(group: GroupNode): Promise<ClusterTreeNode[]> {
		const { connection, clusterId, scope } = group;
		switch (group.kind) {
			case 'infobases': {
				const result = await this.service.listInfobases(connection, clusterId);
				return this.materialize(group.cacheKey, result, 'Информационных баз нет', (items) =>
					sortInfobases(items).map((item) => new InfobaseNode(connection, clusterId, item))
				);
			}
			case 'servers': {
				const result = await this.service.listServers(connection, clusterId);
				return this.materialize(group.cacheKey, result, 'Рабочих серверов нет', (items) =>
					sortServers(items).map((item) => new ServerNode(connection, clusterId, item))
				);
			}
			case 'processes': {
				const result = await this.service.listProcesses(connection, clusterId, scope.serverId);
				return this.materialize(group.cacheKey, result, 'Рабочих процессов нет', (items) =>
					sortProcesses(items).map((item) => new ProcessNode(connection, clusterId, item))
				);
			}
			case 'clusterAdmins': {
				const result = await this.service.listClusterAdmins(connection, clusterId);
				return this.materialize(group.cacheKey, result, 'Администраторов нет', (items) =>
					sortAdmins(items).map((item) => new AdminNode(connection, clusterId, item))
				);
			}
			case 'agentAdmins': {
				const result = await this.service.listAgentAdmins(connection);
				return this.materialize(group.cacheKey, result, 'Администраторов нет', (items) =>
					sortAdmins(items).map((item) => new AdminNode(connection, undefined, item))
				);
			}
			case 'managers': {
				const result = await this.service.listManagers(connection, clusterId);
				return this.materialize(group.cacheKey, result, 'Менеджеров нет', (items) =>
					sortManagers(items).map((item) => new ManagerNode(connection, clusterId, item))
				);
			}
			case 'sessions': {
				const result = await this.service.listSessions(connection, clusterId, scope.infobaseId);
				return this.materialize(group.cacheKey, result, 'Активных сеансов нет', (items) =>
					sortSessions(items).map((item) => new SessionNode(connection, clusterId, item))
				);
			}
			case 'connections': {
				const result = await this.service.listConnections(connection, clusterId, {
					processId: scope.processId,
					infobaseId: scope.infobaseId,
				});
				return this.materialize(group.cacheKey, result, 'Соединений нет', (items) =>
					sortConnections(items).map((item) => new ConnectionItemNode(connection, clusterId, item))
				);
			}
			case 'locks': {
				const result = await this.service.listLocks(connection, clusterId, scope.infobaseId);
				return this.materialize(group.cacheKey, result, 'Блокировок нет', (items) =>
					items.map((item) => new LockNode(connection, clusterId, item))
				);
			}
		}
	}

	/**
	 * Превращает итог операции в узлы: список, сообщение о пустоте или об ошибке.
	 *
	 * @param parentKey - Ключ родительского узла
	 * @param result - Итог обращения к кластеру
	 * @param emptyMessage - Текст, если список пуст
	 * @param build - Построение узлов по объектам
	 * @returns Узлы для показа
	 */
	private materialize<T>(
		parentKey: string,
		result: ServiceResult<T[]>,
		emptyMessage: string,
		build: (items: T[]) => ClusterTreeNode[]
	): ClusterTreeNode[] {
		if (!result.ok) {
			return [new MessageNode(parentKey, result.failure.message, undefined, 'error')];
		}
		if (result.value.length === 0) {
			return [new MessageNode(parentKey, emptyMessage)];
		}
		return build(result.value);
	}

	dispose(): void {
		this.emitter.dispose();
	}
}
