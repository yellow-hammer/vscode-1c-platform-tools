/**
 * Команды консоли администрирования кластера.
 *
 * Команды не работают с rac напрямую: они спрашивают у пользователя параметры,
 * вызывают операцию сервиса и обновляют дерево. Необратимые действия —
 * завершение сеанса, разрыв соединения, блокировка базы — по умолчанию
 * подтверждаются: администратор чаще всего работает в живом кластере.
 */

import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { notifyQuiet } from '../../shared/notify';
import type { ClusterService } from './clusterService';
import type { AdminInfo, ClusterConnection } from './model';
import type { ConnectionStore } from './connectionStore';
import type { ClusterCredentialStore } from './credentials';
import type { ClustersAutoRefresh } from './autoRefresh';
import type { ClusterActivityPanel } from './activityPanel';
import type { ClusterConnectionsEditor } from './connectionsEditor';
import type { PropertiesPanel } from './propertiesPanel';
import { CLUSTER_SECTIONS, buildClusterChange, toClusterForm, validateClusterForm } from './clusterProperties';
import {
	SERVER_SECTIONS,
	buildServerChange,
	toServerForm,
	validateServerForm,
} from './serverProperties';
import {
	readonlySections,
	toReadonlyValues,
	type ReadonlyCardKind,
} from './objectCards';
import {
	adminSections,
	toAdminForm,
	toAdminRegistration,
	validateAdminForm,
} from './adminProperties';
import {
	INFOBASE_SECTIONS,
	buildInfobaseChange,
	isEmptyInfobaseChange,
	toInfobaseForm,
	validateInfobaseForm,
} from './infobaseProperties';
import type { ClustersProvider } from './clustersProvider';
import type { RacFailure, RacRecord } from './racOutput';
import { CLUSTERS_CONFIG_SECTION } from './constants';
import { formatRacDate } from './racArgs';
import {
	AdminNode,
	ClusterNode,
	ClusterTreeNode,
	ConnectionItemNode,
	ConnectionNode,
	ManagerNode,
	GroupNode,
	InfobaseNode,
	ProcessNode,
	ServerNode,
	SessionNode,
} from './nodes';
import { confirmAction, confirmSessionAction, promptSessionLock } from './prompts';
import { readClustersSettings } from './settings';

/** Зависимости команд. */
export interface ClustersCommandsDeps {
	store: ConnectionStore;
	provider: ClustersProvider;
	service: ClusterService;
	credentials: ClusterCredentialStore;
	editor: ClusterConnectionsEditor;
	activity: ClusterActivityPanel;
	/** Карточка свойств: одна вкладка на все объекты дерева. */
	objectProperties: PropertiesPanel;
	adminProperties: PropertiesPanel;
	autoRefresh: ClustersAutoRefresh;
}

/** Подпись кнопки журнала в сообщении об ошибке. */
const SHOW_LOG_ACTION = 'Показать журнал';

/**
 * Показывает причину неудачи с возможностью открыть журнал.
 *
 * @param failure - Разобранная неудача
 */
async function reportFailure(failure: RacFailure): Promise<void> {
	const choice = await vscode.window.showErrorMessage(failure.message, SHOW_LOG_ACTION);
	if (choice === SHOW_LOG_ACTION) {
		logger.show();
	}
}

/**
 * Выполняет действие, показывая ход работы в строке состояния.
 *
 * @param title - Что происходит
 * @param task - Действие
 * @returns Итог действия
 */
function withProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
	return Promise.resolve(
		vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title }, task)
	);
}

/**
 * Сообщает, что команда вызвана вне дерева.
 *
 * Команды объектов кластера получают узел аргументом, поэтому из палитры они
 * скрыты; сообщение остаётся страховкой на случай вызова из привязки клавиш.
 */
function requireNode(node: unknown): node is ClusterTreeNode {
	if (node instanceof ClusterTreeNode) {
		return true;
	}
	void vscode.window.showInformationMessage(
		'Команда вызывается из контекстного меню панели «Управление кластерами 1С».'
	);
	return false;
}

/**
 * Регистрирует команды консоли кластера.
 *
 * @param deps - Хранилище, дерево, сервис и вспомогательные объекты
 * @returns Подписки команд
 */
export function registerClustersCommands(deps: ClustersCommandsDeps): vscode.Disposable[] {
	const {
		store,
		provider,
		service,
		credentials,
		editor,
		activity,
		objectProperties,
		adminProperties,
		autoRefresh,
	} = deps;

	/** Описание подключения для подзаголовка документа подробностей. */
	const connectionSubtitle = (node: { connection: { name: string; host: string; port: number } }) =>
		`${node.connection.name} · ${node.connection.host}:${node.connection.port}`;

	/**
	 * Открывает карточку администратора.
	 *
	 * Создание и правка идут одной командой платформы: запись с существующим
	 * именем перезаписывается. Поэтому форма одна, а различается лишь тем, можно
	 * ли менять имя.
	 *
	 * @param connection - Подключение
	 * @param clusterId - Кластер; пусто для администратора центрального сервера
	 * @param admin - Существующая запись; пусто при создании
	 */
	const openAdminCard = async (
		connection: ClusterConnection,
		clusterId: string | undefined,
		admin: AdminInfo | undefined
	): Promise<void> => {
		const level = clusterId === undefined ? 'центрального сервера' : 'кластера';
		await adminProperties.open({
			key: admin ? `admin:${clusterId ?? 'agent'}:${admin.name}` : `admin-new:${clusterId ?? 'agent'}`,
			title: admin ? `Администратор ${level}: ${admin.name}` : `Новый администратор ${level}`,
			subtitle: `${connection.name} · ${connection.host}:${connection.port}`,
			sections: adminSections(admin !== undefined),
			validate: validateAdminForm,
			load: () => Promise.resolve({ ok: true as const, values: toAdminForm(admin) }),
			save: async (_before, after) => {
				const registration = toAdminRegistration(after);
				const result =
					clusterId === undefined
						? await service.registerAgentAdmin(connection, registration)
						: await service.registerClusterAdmin(connection, clusterId, registration);
				if (!result.ok) {
					return { ok: false as const, message: result.failure.message };
				}
				provider.refresh();
				// Перечитывать нечего: пароль платформа не отдаёт, а остальное уже в форме.
				return { ok: true as const, changed: false };
			},
		});
	};

	/** Карточка кластера: читается всеми, правится администратором сервера. */
	const openClusterCard = async (node: ClusterNode): Promise<void> => {
		const { connection, cluster } = node;
		await objectProperties.open({
			key: node.cacheKey,
			title: `Кластер: ${cluster.name || cluster.host}`,
			subtitle: connectionSubtitle(node),
			sections: CLUSTER_SECTIONS,
			validate: validateClusterForm,
			load: async () => {
				const result = await service.clusterDetails(connection, cluster.id);
				return result.ok
					? { ok: true as const, values: toClusterForm(result.value) }
					: { ok: false as const, message: result.failure.message };
			},
			save: async (before, after) => {
				const change = buildClusterChange(before, after);
				if (Object.keys(change).length === 0) {
					return { ok: true as const, changed: false };
				}
				if (!connection.agentUser) {
					return {
						ok: false as const,
						message: 'Правка кластера требует администратора центрального сервера: укажите его в подключении',
					};
				}
				const result = await service.updateCluster(connection, cluster.id, change);
				if (!result.ok) {
					return { ok: false as const, message: result.failure.message };
				}
				provider.refreshNode(node);
				return { ok: true as const, changed: true };
			},
		});
	};

	/** Карточка информационной базы. */
	const openInfobaseCard = async (node: InfobaseNode): Promise<void> => {
		const { connection, clusterId, infobase } = node;
		await objectProperties.open({
			key: node.cacheKey,
			title: `База: ${infobase.name}`,
			subtitle: connectionSubtitle(node),
			sections: INFOBASE_SECTIONS,
			validate: validateInfobaseForm,
			load: async () => {
				const result = await service.infobaseDetails(connection, clusterId, infobase.id, infobase.name);
				return result.ok
					? { ok: true as const, values: toInfobaseForm(result.value) }
					: { ok: false as const, message: result.failure.message };
			},
			save: async (before, after) => {
				const change = buildInfobaseChange(before, after);
				if (isEmptyInfobaseChange(change)) {
					return { ok: true as const, changed: false };
				}
				const result = await service.updateInfobase(
					connection,
					clusterId,
					{ id: infobase.id, name: infobase.name },
					change
				);
				if (!result.ok) {
					return { ok: false as const, message: result.failure.message };
				}
				provider.refreshCluster(node);
				return { ok: true as const, changed: true };
			},
		});
	};

	/** Карточка рабочего сервера. */
	const openServerCard = async (node: ServerNode): Promise<void> => {
		const { connection, clusterId, server } = node;
		await objectProperties.open({
			key: node.cacheKey,
			title: `Рабочий сервер: ${server.name || server.host}`,
			subtitle: connectionSubtitle(node),
			sections: SERVER_SECTIONS,
			validate: validateServerForm,
			load: async () => {
				const result = await service.serverDetails(connection, clusterId, server.id);
				return result.ok
					? { ok: true as const, values: toServerForm(result.value) }
					: { ok: false as const, message: result.failure.message };
			},
			save: async (before, after) => {
				const change = buildServerChange(before, after);
				if (Object.keys(change).length === 0) {
					return { ok: true as const, changed: false };
				}
				const result = await service.updateServer(connection, clusterId, server.id, change);
				if (!result.ok) {
					return { ok: false as const, message: result.failure.message };
				}
				provider.refreshCluster(node);
				return { ok: true as const, changed: true };
			},
		});
	};

	/**
	 * Карточка объекта, который платформа менять не даёт.
	 *
	 * @param node - Узел дерева
	 * @param kind - Вид объекта
	 * @param title - Заголовок вкладки
	 * @param load - Запрос полей объекта
	 */
	const openReadonlyCard = async (
		node: { cacheKey: string; connection: { name: string; host: string; port: number } },
		kind: ReadonlyCardKind,
		title: string,
		load: () => Promise<{ ok: true; value: RacRecord } | { ok: false; failure: RacFailure }>
	): Promise<void> => {
		const key = node.cacheKey;
		await objectProperties.open({
			key,
			title,
			subtitle: connectionSubtitle(node),
			sections: readonlySections(kind),
			validate: () => [],
			load: async () => {
				const result = await load();
				return result.ok
					? { ok: true as const, values: toReadonlyValues(kind, result.value) }
					: { ok: false as const, message: result.failure.message };
			},
			save: () => Promise.resolve({ ok: true as const, changed: false }),
		});
	};

	// Подключение заводится и правится в форме: полей полдесятка, и видеть их
	// вместе удобнее, чем отвечать на вопросы по одному.
	const addConnection = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.addConnection',
		() => editor.open('new')
	);

	const removeConnection = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.removeConnection',
		async (node: unknown) => {
			if (!requireNode(node) || !(node instanceof ConnectionNode)) {
				return;
			}
			// Подтверждения нет: удаляется запись в списке, сам кластер и его базы
			// остаются нетронутыми — переспрашивать не о чем.
			await store.remove(node.connection.id);
			await credentials.forgetConnection(node.connection.id);
			provider.refresh();
			notifyQuiet(`Подключение «${node.connection.name}» удалено`);
		}
	);

	const refresh = vscode.commands.registerCommand('1c-platform-tools.clusters.refresh', () => {
		provider.refresh();
	});

	const refreshNode = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.refreshNode',
		(node: unknown) => {
			if (!requireNode(node)) {
				return;
			}
			provider.refreshNode(node);
		}
	);

	// Две команды вместо переключателя: значок кнопки показывает текущее
	// состояние, а один значок на оба состояния не сменить.
	const setAutoRefresh = async (enabled: boolean): Promise<void> => {
		await autoRefresh.set(enabled);
		const interval = readClustersSettings().autoRefreshIntervalMs / 1000;
		notifyQuiet(
			enabled
				? `Автообновление кластеров включено: каждые ${interval} с`
				: 'Автообновление кластеров выключено'
		);
	};

	const enableAutoRefresh = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.enableAutoRefresh',
		() => setAutoRefresh(true)
	);

	const disableAutoRefresh = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.disableAutoRefresh',
		() => setAutoRefresh(false)
	);

	// Таблица отвечает на вопрос «кто нагружает кластер»: значения сравнивают
	// между собой, а в дереве каждый сеанс виден по отдельности.
	const showActivity = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.showActivity',
		async (node: unknown) => {
			if (!requireNode(node)) {
				return;
			}
			if (node instanceof ClusterNode) {
				await activity.open(
					{
						connection: node.connection,
						clusterId: node.cluster.id,
						title: node.cluster.name || node.cluster.host,
					},
					'sessions'
				);
				return;
			}
			if (node instanceof InfobaseNode) {
				await activity.open(
					{
						connection: node.connection,
						clusterId: node.clusterId,
						infobaseId: node.infobase.id,
						title: node.infobase.name,
					},
					'sessions'
				);
			}
		}
	);

	const addAdmin = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.addAdmin',
		async (node: unknown) => {
			if (!requireNode(node) || !(node instanceof GroupNode)) {
				return;
			}
			if (node.kind !== 'clusterAdmins' && node.kind !== 'agentAdmins') {
				return;
			}
			await openAdminCard(
				node.connection,
				node.kind === 'agentAdmins' ? undefined : node.clusterId,
				undefined
			);
		}
	);

	const removeAdmin = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.removeAdmin',
		async (node: unknown) => {
			if (!requireNode(node) || !(node instanceof AdminNode)) {
				return;
			}
			const agentLevel = node.clusterId === undefined;
			const confirmed = await confirmAction(
				`Удалить администратора «${node.admin.name}»?`,
				agentLevel
					? 'Учётная запись перестанет открывать доступ к центральному серверу. Если это последний администратор, сервером сможет управлять кто угодно.'
					: 'Учётная запись перестанет открывать доступ к кластеру. Если это последний администратор, кластером сможет управлять кто угодно.',
				'Удалить'
			);
			if (!confirmed) {
				return;
			}
			const result = await withProgress('Удаляю администратора', () =>
				agentLevel
					? service.removeAgentAdmin(node.connection, node.admin.name)
					: service.removeClusterAdmin(node.connection, node.clusterId as string, node.admin.name)
			);
			if (!result.ok) {
				await reportFailure(result.failure);
				return;
			}
			provider.refresh();
			notifyQuiet(`Администратор «${node.admin.name}» удалён`);
		}
	);

	/**
	 * Открывает карточку свойств объекта дерева.
	 *
	 * Кнопка одна на все объекты: администратору незачем помнить, у чего есть
	 * «подробности», у чего «параметры», а у чего правка. Что именно показать и
	 * можно ли это менять, решает вид узла.
	 */
	const properties = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.properties',
		async (node: unknown) => {
			if (!requireNode(node)) {
				return;
			}
			if (node instanceof ConnectionNode) {
				await editor.open(node.connection.id);
				return;
			}
			if (node instanceof AdminNode) {
				await openAdminCard(node.connection, node.clusterId, node.admin);
				return;
			}
			if (node instanceof ClusterNode) {
				await openClusterCard(node);
				return;
			}
			if (node instanceof InfobaseNode) {
				await openInfobaseCard(node);
				return;
			}
			if (node instanceof ServerNode) {
				await openServerCard(node);
				return;
			}
			if (node instanceof ProcessNode) {
				await openReadonlyCard(node, 'process', `Рабочий процесс ${node.process.host}:${node.process.port}`, () =>
					service.processDetails(node.connection, node.clusterId, node.process.id)
				);
				return;
			}
			if (node instanceof ManagerNode) {
				await openReadonlyCard(node, 'manager', node.manager.descr || 'Менеджер кластера', () =>
					service.managerDetails(node.connection, node.clusterId, node.manager.id)
				);
				return;
			}
			if (node instanceof SessionNode) {
				await openReadonlyCard(node, 'session', `Сеанс № ${node.session.number}`, () =>
					service.sessionDetails(node.connection, node.clusterId, node.session.id)
				);
				return;
			}
			if (node instanceof ConnectionItemNode) {
				await openReadonlyCard(node, 'connection', `Соединение № ${node.item.connId}`, () =>
					service.connectionDetails(node.connection, node.clusterId, node.item.id)
				);
			}
		}
	);

	const openSettings = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.openSettings',
		async () => {
			await vscode.commands.executeCommand('workbench.action.openSettings', CLUSTERS_CONFIG_SECTION);
		}
	);

	const terminateSession = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.terminateSession',
		async (node: unknown) => {
			if (!requireNode(node) || !(node instanceof SessionNode)) {
				return;
			}
			const user = node.session.userName || 'пользователь не указан';
			let errorMessage: string | undefined;
			if (readClustersSettings().confirmDestructiveActions) {
				const choice = await confirmSessionAction(
					`Завершить сеанс № ${node.session.number}?`,
					`Пользователь: ${user}. Компьютер: ${node.session.host || 'нет данных'}. Несохранённые данные сеанса будут потеряны.`
				);
				if (!choice.confirmed) {
					return;
				}
				errorMessage = choice.errorMessage;
			}
			const result = await withProgress(`Завершаю сеанс № ${node.session.number}`, () =>
				service.terminateSession(node.connection, node.clusterId, node.session.id, errorMessage)
			);
			if (!result.ok) {
				await reportFailure(result.failure);
				return;
			}
			provider.refreshCluster(node);
			notifyQuiet(`Сеанс № ${node.session.number} завершён`);
		}
	);

	// Прерывание вызова мягче завершения: сеанс остаётся, обрывается только
	// затянувшийся серверный вызов — зависший отчёт или обработка.
	const interruptSessionCall = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.interruptSessionCall',
		async (node: unknown) => {
			if (!requireNode(node) || !(node instanceof SessionNode)) {
				return;
			}
			let errorMessage: string | undefined;
			if (readClustersSettings().confirmDestructiveActions) {
				const choice = await confirmSessionAction(
					`Прервать текущий вызов сеанса № ${node.session.number}?`,
					'Сеанс продолжит работу, прервётся только выполняемый сейчас серверный вызов.'
				);
				if (!choice.confirmed) {
					return;
				}
				errorMessage = choice.errorMessage;
			}
			const result = await withProgress(`Прерываю вызов сеанса № ${node.session.number}`, () =>
				service.interruptSessionCall(node.connection, node.clusterId, node.session.id, errorMessage)
			);
			if (!result.ok) {
				await reportFailure(result.failure);
				return;
			}
			provider.refreshCluster(node);
			notifyQuiet(`Вызов сеанса № ${node.session.number} прерван`);
		}
	);

	const turnOffProcess = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.turnOffProcess',
		async (node: unknown) => {
			if (!requireNode(node) || !(node instanceof ProcessNode)) {
				return;
			}
			// Подтверждение здесь всегда: процесс обслуживает чужие соединения, и его
			// выключение затрагивает не одного пользователя.
			const confirmed = await confirmAction(
				`Выключить рабочий процесс ${node.process.host}:${node.process.port}?`,
				`Соединений: ${node.process.connections || 'нет данных'}. Процесс перестанет принимать новые соединения и завершится, когда отпустит текущие; кластер поднимет замену.`,
				'Выключить'
			);
			if (!confirmed) {
				return;
			}
			const result = await withProgress('Выключаю рабочий процесс', () =>
				service.turnOffProcess(node.connection, node.clusterId, node.process.id)
			);
			if (!result.ok) {
				await reportFailure(result.failure);
				return;
			}
			provider.refreshCluster(node);
			notifyQuiet(`Рабочий процесс ${node.process.host}:${node.process.port} выключен`);
		}
	);

	const disconnect = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.disconnectConnection',
		async (node: unknown) => {
			if (!requireNode(node) || !(node instanceof ConnectionItemNode)) {
				return;
			}
			if (!node.item.processId) {
				void vscode.window.showErrorMessage(
					'Утилита rac не сообщила рабочий процесс соединения — разорвать его нельзя.'
				);
				return;
			}
			const settings = readClustersSettings();
			if (settings.confirmDestructiveActions) {
				const confirmed = await confirmAction(
					`Разорвать соединение № ${node.item.connId}?`,
					`Приложение: ${node.item.application || 'нет данных'}. Компьютер: ${node.item.host || 'нет данных'}.`,
					'Разорвать'
				);
				if (!confirmed) {
					return;
				}
			}
			const result = await withProgress(`Разрываю соединение № ${node.item.connId}`, () =>
				service.disconnectConnection(node.connection, node.clusterId, {
					processId: node.item.processId,
					connectionId: node.item.id,
					infobaseId: node.item.infobaseId,
				})
			);
			if (!result.ok) {
				await reportFailure(result.failure);
				return;
			}
			provider.refreshCluster(node);
			notifyQuiet(`Соединение № ${node.item.connId} разорвано`);
		}
	);

	const lockSessions = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.lockSessions',
		async (node: unknown) => {
			if (!requireNode(node) || !(node instanceof InfobaseNode)) {
				return;
			}
			const lock = await promptSessionLock(node.infobase.name);
			if (!lock) {
				return;
			}
			const result = await withProgress(`Включаю блокировку сеансов: ${node.infobase.name}`, () =>
				service.updateInfobase(
					node.connection,
					node.clusterId,
					{ id: node.infobase.id, name: node.infobase.name },
					{
						sessionsDeny: true,
						deniedMessage: lock.deniedMessage,
						permissionCode: lock.permissionCode,
						// Начало блокировки задаётся явно: в базе мог остаться интервал от
						// прошлого раза, и с датой в прошлом запрет включился бы «задним
						// числом» — сеансы продолжали бы начинаться.
						deniedFrom: formatRacDate(new Date()),
					}
				)
			);
			if (!result.ok) {
				await reportFailure(result.failure);
				return;
			}
			provider.refreshCluster(node);
			notifyQuiet(`Начало сеансов базы «${node.infobase.name}» запрещено`);
		}
	);

	const unlockSessions = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.unlockSessions',
		async (node: unknown) => {
			if (!requireNode(node) || !(node instanceof InfobaseNode)) {
				return;
			}
			const result = await withProgress(`Снимаю блокировку сеансов: ${node.infobase.name}`, () =>
				service.updateInfobase(
					node.connection,
					node.clusterId,
					{ id: node.infobase.id, name: node.infobase.name },
					{ sessionsDeny: false }
				)
			);
			if (!result.ok) {
				await reportFailure(result.failure);
				return;
			}
			provider.refreshCluster(node);
			notifyQuiet(`Начало сеансов базы «${node.infobase.name}» разрешено`);
		}
	);

	const lockScheduledJobs = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.lockScheduledJobs',
		async (node: unknown) => {
			if (!requireNode(node) || !(node instanceof InfobaseNode)) {
				return;
			}
			const result = await withProgress(`Запрещаю регламентные задания: ${node.infobase.name}`, () =>
				service.updateInfobase(
					node.connection,
					node.clusterId,
					{ id: node.infobase.id, name: node.infobase.name },
					{ scheduledJobsDeny: true }
				)
			);
			if (!result.ok) {
				await reportFailure(result.failure);
				return;
			}
			provider.refreshCluster(node);
			notifyQuiet(`Регламентные задания базы «${node.infobase.name}» запрещены`);
		}
	);

	const unlockScheduledJobs = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.unlockScheduledJobs',
		async (node: unknown) => {
			if (!requireNode(node) || !(node instanceof InfobaseNode)) {
				return;
			}
			const result = await withProgress(`Разрешаю регламентные задания: ${node.infobase.name}`, () =>
				service.updateInfobase(
					node.connection,
					node.clusterId,
					{ id: node.infobase.id, name: node.infobase.name },
					{ scheduledJobsDeny: false }
				)
			);
			if (!result.ok) {
				await reportFailure(result.failure);
				return;
			}
			provider.refreshCluster(node);
			notifyQuiet(`Регламентные задания базы «${node.infobase.name}» разрешены`);
		}
	);

	const terminateInfobaseSessions = vscode.commands.registerCommand(
		'1c-platform-tools.clusters.terminateInfobaseSessions',
		async (node: unknown) => {
			if (!requireNode(node) || !(node instanceof InfobaseNode)) {
				return;
			}
			const sessions = await withProgress(`Читаю сеансы базы «${node.infobase.name}»`, () =>
				service.listSessions(node.connection, node.clusterId, node.infobase.id)
			);
			if (!sessions.ok) {
				await reportFailure(sessions.failure);
				return;
			}
			if (sessions.value.length === 0) {
				notifyQuiet(`У базы «${node.infobase.name}» нет активных сеансов`);
				return;
			}
			const confirmed = await confirmAction(
				`Завершить все сеансы базы «${node.infobase.name}»?`,
				`Будет завершено сеансов: ${sessions.value.length}. Несохранённые данные пользователей будут потеряны. ` +
					'Чтобы сеансы не открывались заново, сначала запретите начало сеансов.',
				'Завершить все'
			);
			if (!confirmed) {
				return;
			}

			let terminated = 0;
			const failures: string[] = [];
			await withProgress(`Завершаю сеансы базы «${node.infobase.name}»`, async () => {
				for (const session of sessions.value) {
					const result = await service.terminateSession(
						node.connection,
						node.clusterId,
						session.id
					);
					if (result.ok) {
						terminated += 1;
					} else {
						failures.push(`№ ${session.number}: ${result.failure.message}`);
					}
				}
			});
			provider.refreshCluster(node);
			if (failures.length === 0) {
				notifyQuiet(`Завершено сеансов: ${terminated}`);
				return;
			}
			const choice = await vscode.window.showWarningMessage(
				`Завершено сеансов: ${terminated}, не удалось: ${failures.length}.`,
				SHOW_LOG_ACTION
			);
			if (choice === SHOW_LOG_ACTION) {
				logger.show();
			}
		}
	);

	return [
		addConnection,
		removeConnection,
		refresh,
		refreshNode,
		enableAutoRefresh,
		disableAutoRefresh,
		openSettings,
		showActivity,
		properties,
		addAdmin,
		removeAdmin,
		terminateSession,
		interruptSessionCall,
		turnOffProcess,
		disconnect,
		lockSessions,
		unlockSessions,
		lockScheduledJobs,
		unlockScheduledJobs,
		terminateInfobaseSessions,
	];
}

/**
 * Идентификатор объекта, стоящего за узлом.
 *
 * @param node - Узел дерева
 * @returns Идентификатор или undefined, если у узла его нет
 */
function identifierOf(node: ClusterTreeNode): string | undefined {
	if (node instanceof ClusterNode) {
		return node.cluster.id;
	}
	if (node instanceof ServerNode) {
		return node.server.id;
	}
	if (node instanceof ProcessNode) {
		return node.process.id;
	}
	if (node instanceof InfobaseNode) {
		return node.infobase.id;
	}
	if (node instanceof SessionNode) {
		return node.session.id;
	}
	if (node instanceof ConnectionItemNode) {
		return node.item.id;
	}
	return undefined;
}
