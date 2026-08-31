/**
 * Узлы дерева «Кластеры».
 *
 * Каждый узел несёт подключение и идентификаторы, которых достаточно для его
 * команд: контекстное меню кластера не должно искать родителя, чтобы узнать
 * адрес сервера администрирования.
 *
 * `cacheKey` задаёт путь узла в дереве и служит ключом кэша дочерних элементов:
 * ключи иерархичны, поэтому обновление ветки сбрасывает только её (см.
 * ClustersProvider).
 */

import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import type {
	AdminInfo,
	ClusterConnection,
	ConnectionInfo,
	InfobaseInfo,
	InfobaseState,
	LockInfo,
	ProcessInfo,
	ServerInfo,
	SessionInfo,
	ManagerInfo,
} from './model';
import {
	adminPresentation,
	clusterPresentation,
	connectionInfoPresentation,
	connectionPresentation,
	infobasePresentation,
	managerPresentation,
	lockPresentation,
	processPresentation,
	serverPresentation,
	sessionPresentation,
	type NodePresentation,
} from './presentation';
import type { ClusterInfo } from './model';
import type { ActivityKind } from './activityTable';

/** Вид группы: определяет, что загружается внутри и какая иконка у узла. */
export type GroupKind =
	| 'clusterAdmins'
	| 'agentAdmins'
	| 'infobases'
	| 'servers'
	| 'processes'
	| 'managers'
	| 'sessions'
	| 'connections'
	| 'locks';

/** Общий предок узлов дерева кластеров. */
export abstract class ClusterTreeNode extends TreeItem {
	/** Путь узла в дереве; служит ключом кэша. */
	abstract readonly cacheKey: string;

	/**
	 * Оформляет узел подписью и подсказкой.
	 *
	 * @param presentation - Подпись, описание и строки подсказки
	 */
	protected applyPresentation(presentation: NodePresentation): void {
		this.description = presentation.description;
		const tooltip = new MarkdownString(undefined, true);
		presentation.tooltip.forEach((line, index) => {
			tooltip.appendMarkdown(index === 0 ? `**${line}**\n\n` : `${line}\n\n`);
		});
		this.tooltip = tooltip;
	}
}

/** Подключение к серверу администрирования. */
export class ConnectionNode extends ClusterTreeNode {
	readonly cacheKey: string;

	constructor(readonly connection: ClusterConnection) {
		super(connection.name, TreeItemCollapsibleState.Collapsed);
		this.cacheKey = `conn:${connection.id}`;
		this.contextValue = 'clusterConnection';
		this.iconPath = new ThemeIcon('server-environment');
		this.applyPresentation(connectionPresentation(connection));
	}
}

/** Кластер серверов. */
export class ClusterNode extends ClusterTreeNode {
	readonly cacheKey: string;

	constructor(
		readonly connection: ClusterConnection,
		readonly cluster: ClusterInfo
	) {
		super(cluster.name || cluster.host, TreeItemCollapsibleState.Collapsed);
		this.cacheKey = `conn:${connection.id}/cluster:${cluster.id}`;
		this.contextValue = 'clusterNode';
		this.iconPath = new ThemeIcon('server');
		this.applyPresentation(clusterPresentation(cluster));
	}
}

/** Иконки групп. */
const GROUP_ICONS: Record<GroupKind, string> = {
	infobases: 'database',
	servers: 'vm',
	processes: 'server-process',
	managers: 'settings-gear',
	clusterAdmins: 'organization',
	agentAdmins: 'organization',
	sessions: 'account',
	connections: 'plug',
	locks: 'lock',
};

/** Названия групп. */
const GROUP_LABELS: Record<GroupKind, string> = {
	infobases: 'Информационные базы',
	servers: 'Рабочие серверы',
	processes: 'Рабочие процессы',
	managers: 'Менеджеры кластера',
	clusterAdmins: 'Администраторы',
	agentAdmins: 'Администраторы центрального сервера',
	sessions: 'Сеансы',
	connections: 'Соединения',
	locks: 'Блокировки',
};

/**
 * Группы, которые открываются таблицей.
 *
 * У остальных групп — серверов, процессов, менеджеров, администраторов —
 * значений для сравнения нет: их читают по одному узлу, а не списком.
 */
const TABLE_KINDS: GroupKind[] = ['infobases', 'sessions', 'connections', 'locks'];

/**
 * Признак группы, которую открывает кнопка списков.
 *
 * Вид группы условие меню не различает: группа «Соединения» под рабочим
 * процессом таблицей не открывается — таблица отбирает по кластеру и базе, но не
 * по процессу. Поэтому пригодность выражена отдельным признаком узла.
 */
export const GROUP_TABLE_CONTEXT = 'clusterGroupTable';

/**
 * Сообщает, открывается ли группа таблицей.
 *
 * Вид такой группы совпадает с видом списка, поэтому проверка заодно сужает тип:
 * второго перечисления в панели списков не нужно.
 *
 * @param kind - Вид группы
 * @param scope - Область группы
 * @returns true, если у группы есть список
 */
export function groupOpensTable(
	kind: GroupKind,
	scope: { serverId?: string; processId?: string }
): kind is GroupKind & ActivityKind {
	return TABLE_KINDS.includes(kind) && !scope.serverId && !scope.processId;
}

/**
 * Группа однотипных объектов внутри кластера.
 *
 * Область (`serverId`, `infobaseId`, `processId`) сужает запрос: та же группа
 * «Соединения» под процессом показывает соединения процесса, а под базой —
 * соединения базы. Имена кластера и базы в области нужны заголовку панели
 * списков: группа открывается таблицей той же области, что и её родитель.
 */
export class GroupNode extends ClusterTreeNode {
	readonly cacheKey: string;

	constructor(
		readonly connection: ClusterConnection,
		readonly clusterId: string,
		readonly kind: GroupKind,
		readonly scope: {
			serverId?: string;
			infobaseId?: string;
			infobaseName?: string;
			clusterName?: string;
			processId?: string;
		} = {},
		parentKey?: string,
		count?: number
	) {
		super(GROUP_LABELS[kind], TreeItemCollapsibleState.Collapsed);
		const base = parentKey ?? `conn:${connection.id}/cluster:${clusterId}`;
		this.cacheKey = `${base}/group:${kind}`;
		// Клик по узлу ничего не открывает — как у остальных узлов дерева; списки
		// открывает кнопка, и её видимость задаёт признак в contextValue.
		this.contextValue = groupOpensTable(kind, scope)
			? `clusterGroup.${kind} ${GROUP_TABLE_CONTEXT}`
			: `clusterGroup.${kind}`;
		this.iconPath = new ThemeIcon(GROUP_ICONS[kind]);
		if (count !== undefined) {
			this.description = String(count);
		}
	}
}

/** Рабочий сервер кластера. */
export class ServerNode extends ClusterTreeNode {
	readonly cacheKey: string;

	constructor(
		readonly connection: ClusterConnection,
		readonly clusterId: string,
		readonly server: ServerInfo
	) {
		super(server.name || server.host, TreeItemCollapsibleState.Collapsed);
		this.cacheKey = `conn:${connection.id}/cluster:${clusterId}/server:${server.id}`;
		this.contextValue = 'clusterServer';
		this.iconPath = new ThemeIcon('vm');
		this.applyPresentation(serverPresentation(server));
	}
}

/** Рабочий процесс. */
export class ProcessNode extends ClusterTreeNode {
	readonly cacheKey: string;

	constructor(
		readonly connection: ClusterConnection,
		readonly clusterId: string,
		readonly process: ProcessInfo
	) {
		super(`${process.host}:${process.port}`, TreeItemCollapsibleState.Collapsed);
		this.cacheKey = `conn:${connection.id}/cluster:${clusterId}/process:${process.id}`;
		this.contextValue = 'clusterProcess';
		this.iconPath = process.running
			? new ThemeIcon('server-process', new ThemeColor('charts.green'))
			: new ThemeIcon('server-process', new ThemeColor('charts.red'));
		this.applyPresentation(processPresentation(process));
	}
}

/** Каталог расширения: нужен для значков-файлов. */
let iconRoot: Uri | undefined;

/**
 * Сообщает узлам, где лежат значки расширения.
 *
 * @param extensionUri - Корень расширения
 */
export function initClusterIcons(extensionUri: Uri): void {
	iconRoot = extensionUri;
}

/**
 * Значок информационной базы по её режиму работы.
 *
 * Значок тот же, меняется только цвет: красный — начало сеансов запрещено,
 * жёлтый — запрещены только регламентные задания. Цвета — значения
 * `list.errorForeground` и `list.warningForeground` из тем по умолчанию: метка
 * заметна, но не кричит.
 *
 * Цвет лежит в самой картинке, а не в codicon с `ThemeColor`: выделенную строку
 * VS Code перекрашивает целиком, и цвет пропадал бы как раз при щелчке по базе.
 *
 * @param state - Режим работы базы; пусто, пока он не прочитан
 * @returns Значок узла
 */
function infobaseIcon(state: InfobaseState | undefined): ThemeIcon | { light: Uri; dark: Uri } {
	let file: string | undefined;
	if (state?.sessionsDeny) {
		file = 'infobase-sessions-denied.svg';
	} else if (state?.scheduledJobsDeny) {
		file = 'infobase-jobs-denied.svg';
	}
	if (!file || !iconRoot) {
		return new ThemeIcon('database');
	}
	return {
		light: Uri.joinPath(iconRoot, 'resources', 'cluster-icons', file),
		dark: Uri.joinPath(iconRoot, 'resources', 'cluster-icons', 'dark', file),
	};
}

/** Информационная база. */
export class InfobaseNode extends ClusterTreeNode {
	readonly cacheKey: string;

	/** Режим работы базы; пусто, пока состояние не прочитано. */
	state: InfobaseState | undefined;

	/** Название привязанного набора учётных данных; пусто — не привязан. */
	credentialSetName: string | undefined;

	constructor(
		readonly connection: ClusterConnection,
		readonly clusterId: string,
		readonly infobase: InfobaseInfo,
		credentialSetName?: string
	) {
		super(infobase.name, TreeItemCollapsibleState.Collapsed);
		this.cacheKey = `conn:${connection.id}/cluster:${clusterId}/infobase:${infobase.id}`;
		this.credentialSetName = credentialSetName;
		this.contextValue = credentialSetName ? 'clusterInfobaseBound' : 'clusterInfobase';
		this.iconPath = infobaseIcon(undefined);
		this.applyPresentation(infobasePresentation(infobase, undefined, credentialSetName));
	}

	/**
	 * Показывает режим работы базы значком и подписью.
	 *
	 * @param state - Прочитанный режим работы
	 */
	applyState(state: InfobaseState): void {
		this.state = state;
		this.iconPath = infobaseIcon(state);
		this.applyPresentation(infobasePresentation(this.infobase, state, this.credentialSetName));
	}
}

/** Сеанс информационной базы. */
export class SessionNode extends ClusterTreeNode {
	readonly cacheKey: string;

	constructor(
		readonly connection: ClusterConnection,
		readonly clusterId: string,
		readonly session: SessionInfo
	) {
		super(`№ ${session.number}`, TreeItemCollapsibleState.None);
		this.cacheKey = `conn:${connection.id}/cluster:${clusterId}/session:${session.id}`;
		this.contextValue = 'clusterSession';
		const blocked = session.blockedByDbms || session.blockedByLs;
		this.iconPath = blocked
			? new ThemeIcon('account', new ThemeColor('charts.yellow'))
			: new ThemeIcon('account');
		const presentation = sessionPresentation(session);
		this.label = presentation.label;
		this.applyPresentation(presentation);
	}
}

/** Соединение с информационной базой. */
export class ConnectionItemNode extends ClusterTreeNode {
	readonly cacheKey: string;

	constructor(
		readonly connection: ClusterConnection,
		readonly clusterId: string,
		readonly item: ConnectionInfo
	) {
		super(`№ ${item.connId}`, TreeItemCollapsibleState.None);
		this.cacheKey = `conn:${connection.id}/cluster:${clusterId}/connection:${item.id}`;
		this.contextValue = 'clusterConnectionItem';
		this.iconPath = new ThemeIcon('plug');
		const presentation = connectionInfoPresentation(item);
		this.label = presentation.label;
		this.applyPresentation(presentation);
	}
}

/** Блокировка. */
export class LockNode extends ClusterTreeNode {
	readonly cacheKey: string;

	constructor(
		readonly connection: ClusterConnection,
		readonly clusterId: string,
		readonly lock: LockInfo
	) {
		super(lock.descr || 'Блокировка', TreeItemCollapsibleState.None);
		this.cacheKey =
			`conn:${connection.id}/cluster:${clusterId}/lock:${lock.connectionId}:${lock.sessionId}:${lock.object}`;
		this.contextValue = 'clusterLock';
		this.iconPath = new ThemeIcon('lock');
		this.applyPresentation(lockPresentation(lock));
	}
}

/**
 * Администратор кластера или центрального сервера.
 *
 * Кластер знает своих администраторов, центральный сервер — своих: это разные
 * списки, и в дереве они висят на разных узлах, как в консоли кластера.
 */
export class AdminNode extends ClusterTreeNode {
	readonly cacheKey: string;

	constructor(
		readonly connection: ClusterConnection,
		/** Кластер, если это администратор кластера; пусто у администратора сервера. */
		readonly clusterId: string | undefined,
		readonly admin: AdminInfo
	) {
		super(admin.name || 'Администратор', TreeItemCollapsibleState.None);
		this.cacheKey = `conn:${connection.id}/${clusterId ? `cluster:${clusterId}/` : ''}admin:${admin.name}`;
		this.contextValue = clusterId ? 'clusterAdmin' : 'clusterAgentAdmin';
		this.iconPath = new ThemeIcon('account');
		this.applyPresentation(adminPresentation(admin));
	}
}

/** Менеджер кластера: главный менеджер и менеджеры сервисов. */
export class ManagerNode extends ClusterTreeNode {
	readonly cacheKey: string;

	constructor(
		readonly connection: ClusterConnection,
		readonly clusterId: string,
		readonly manager: ManagerInfo
	) {
		super(manager.descr || `Менеджер ${manager.host}:${manager.port}`, TreeItemCollapsibleState.None);
		this.cacheKey = `conn:${connection.id}/cluster:${clusterId}/manager:${manager.id}`;
		this.contextValue = 'clusterManager';
		this.iconPath = new ThemeIcon('settings-gear');
		this.applyPresentation(managerPresentation(manager));
	}
}

/**
 * Сообщение вместо списка: причина неудачи или пустой результат.
 *
 * Неудача показывается узлом, а не всплывающим окном: дерево остаётся открытым,
 * и видно, какая именно ветка не отвечает.
 */
export class MessageNode extends ClusterTreeNode {
	readonly cacheKey: string;

	constructor(parentKey: string, message: string, hint?: string, severity: 'error' | 'info' = 'info') {
		super(message, TreeItemCollapsibleState.None);
		this.cacheKey = `${parentKey}/message`;
		this.contextValue = 'clusterMessage';
		this.iconPath =
			severity === 'error'
				? new ThemeIcon('error', new ThemeColor('charts.red'))
				: new ThemeIcon('info');
		this.description = hint;
		const tooltip = new MarkdownString(undefined, true);
		tooltip.appendMarkdown(`${message}\n\n`);
		if (hint) {
			tooltip.appendMarkdown(hint);
		}
		this.tooltip = tooltip;
	}
}

/** Узлы, у которых есть кластер: у них работают команды уровня кластера. */
export type ClusterScopedNode =
	| ClusterNode
	| GroupNode
	| ServerNode
	| ProcessNode
	| InfobaseNode
	| SessionNode
	| ConnectionItemNode
	| LockNode;
