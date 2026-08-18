/**
 * Доменные операции над кластером серверов.
 *
 * Здесь собраны действия администратора — список кластеров, сеансы, блокировки,
 * завершение сеанса — поверх трёх слоёв: сборки аргументов (racArgs), запуска
 * утилиты (racClient) и разбора объектов (model). Дерево и команды обращаются
 * только к этому слою и не знают ни об аргументах rac, ни о процессах.
 *
 * Пароль администратора информационной базы утилита требует только у части
 * операций и только если в базе есть администраторы. Заранее спрашивать его у
 * каждой базы было бы навязчиво, поэтому операция выполняется без пароля, а при
 * отказе по аутентификации пароль запрашивается и вызов повторяется — см.
 * {@link ClusterService.withInfobaseAuth}.
 */

import {
	buildAgentAdminListArgs,
	buildAgentAdminRegisterArgs,
	buildAgentAdminRemoveArgs,
	buildAgentVersionArgs,
	buildClusterAdminListArgs,
	buildClusterAdminRegisterArgs,
	buildClusterAdminRemoveArgs,
	buildClusterInfoArgs,
	buildClusterListArgs,
	buildClusterUpdateArgs,
	buildConnectionDisconnectArgs,
	buildConnectionInfoArgs,
	buildConnectionListArgs,
	buildInfobaseInfoArgs,
	buildInfobaseListArgs,
	buildInfobaseUpdateArgs,
	buildLockListArgs,
	buildManagerInfoArgs,
	buildManagerListArgs,
	buildProcessInfoArgs,
	buildProcessListArgs,
	buildProcessTurnOffArgs,
	buildServerInfoArgs,
	buildServerListArgs,
	buildServerUpdateArgs,
	buildSessionInfoArgs,
	buildSessionInterruptArgs,
	buildSessionListArgs,
	buildSessionTerminateArgs,
	racAddress,
	type ClusterScope,
	type AdminRegistration,
	type ClusterUpdate,
	type InfobaseUpdate,
	type RacCredentials,
	type RacScope,
} from './racArgs';
import type { ClusterCredentialStore } from './credentials';
import type { RacClient, RacResult } from './racClient';
import {
	toAdminInfo,
	toClusterInfo,
	toConnectionInfo,
	toInfobaseInfo,
	toLockInfo,
	toManagerInfo,
	toProcessInfo,
	toServerInfo,
	toSessionInfo,
	type ClusterConnection,
	type AdminInfo,
	type ClusterInfo,
	type ConnectionInfo,
	type InfobaseInfo,
	type LockInfo,
	type ManagerInfo,
	type ProcessInfo,
	type ServerInfo,
	type SessionInfo,
} from './model';
import type { RacFailure, RacRecord } from './racOutput';

/** Итог проверки подключения. */
export interface ConnectionCheck {
	/** Кластеры сервера администрирования. */
	clusters: ClusterInfo[];
	/** Проверялся ли администратор кластера: без него проверять нечего. */
	adminChecked: boolean;
}

/** Итог доменной операции. */
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; failure: RacFailure };

/**
 * Запрос учётных данных администратора информационной базы.
 *
 * Возвращает undefined, если пользователь отказался вводить пароль.
 */
export type InfobaseAuthPrompt = (infobaseName: string) => Promise<RacCredentials | undefined>;

/** Операции администрирования кластера. */
export class ClusterService {
	constructor(
		private readonly client: RacClient,
		private readonly credentials: ClusterCredentialStore,
		private readonly promptInfobaseAuth: InfobaseAuthPrompt
	) {}

	/**
	 * Собирает общую часть вызова: адрес и администратора кластера.
	 *
	 * @param connection - Подключение к серверу администрирования
	 * @returns Адрес и учётные данные администратора кластера
	 */
	private async scope(connection: ClusterConnection): Promise<RacScope> {
		const password = connection.clusterUser
			? await this.credentials.clusterPassword(connection.id)
			: undefined;
		const agentPassword = connection.agentUser
			? await this.credentials.agentPassword(connection.id)
			: undefined;
		return {
			address: racAddress(connection.host, connection.port),
			cluster: connection.clusterUser
				? { user: connection.clusterUser, password: password ?? '' }
				: undefined,
			agent: connection.agentUser
				? { user: connection.agentUser, password: agentPassword ?? '' }
				: undefined,
		};
	}

	/**
	 * Собирает часть вызова для операций внутри кластера.
	 *
	 * @param connection - Подключение
	 * @param clusterId - Идентификатор кластера
	 * @returns Область вызова с кластером
	 */
	private async clusterScope(
		connection: ClusterConnection,
		clusterId: string
	): Promise<ClusterScope> {
		return { ...(await this.scope(connection)), clusterId };
	}

	/**
	 * Выполняет вызов и превращает объекты вывода в типизированные.
	 *
	 * @param connection - Подключение (задаёт версию платформы)
	 * @param args - Аргументы вызова
	 * @param map - Преобразование объекта вывода
	 * @returns Список объектов или причина неудачи
	 */
	private async collect<T>(
		connection: ClusterConnection,
		args: string[],
		map: (record: RacRecord) => T
	): Promise<ServiceResult<T[]>> {
		const result = await this.client.run(args, { platformVersion: connection.platformVersion });
		return result.ok
			? { ok: true, value: result.records.map(map) }
			: { ok: false, failure: result.failure };
	}

	/**
	 * Выполняет вызов, ожидая один объект.
	 *
	 * @param connection - Подключение
	 * @param args - Аргументы вызова
	 * @returns Поля объекта или причина неудачи
	 */
	private async single(
		connection: ClusterConnection,
		args: string[]
	): Promise<ServiceResult<RacRecord>> {
		const result = await this.client.run(args, { platformVersion: connection.platformVersion });
		if (!result.ok) {
			return { ok: false, failure: result.failure };
		}
		const record = result.records[0];
		if (!record) {
			return {
				ok: false,
				failure: { kind: 'notFound', message: 'Утилита rac не вернула данных об объекте' },
			};
		}
		return { ok: true, value: record };
	}

	/**
	 * Выполняет операцию над информационной базой, добирая пароль администратора
	 * базы при отказе по аутентификации.
	 *
	 * Первая попытка идёт с тем, что уже известно: обычно ничего, и большинству
	 * баз без администраторов этого достаточно. Пароль, введённый после отказа,
	 * запоминается на время работы окна, чтобы не спрашивать его при каждом
	 * действии с той же базой.
	 *
	 * @param connection - Подключение
	 * @param infobaseId - Идентификатор информационной базы
	 * @param infobaseName - Имя базы для окна ввода
	 * @param call - Вызов rac, принимающий учётные данные базы
	 * @returns Итог вызова
	 */
	private async withInfobaseAuth(
		connection: ClusterConnection,
		infobaseId: string,
		infobaseName: string,
		call: (infobase?: RacCredentials) => Promise<RacResult>
	): Promise<RacResult> {
		const known = this.credentials.infobase(connection.id, infobaseId);
		const first = await call(known);
		if (first.ok || first.failure.kind !== 'auth') {
			return first;
		}

		const entered = await this.promptInfobaseAuth(infobaseName);
		if (!entered) {
			return first;
		}
		const second = await call(entered);
		if (second.ok) {
			this.credentials.rememberInfobase(connection.id, infobaseId, entered);
		}
		return second;
	}

	/** Список кластеров сервера администрирования. */
	async listClusters(connection: ClusterConnection): Promise<ServiceResult<ClusterInfo[]>> {
		const scope = await this.scope(connection);
		return this.collect(connection, buildClusterListArgs(scope), toClusterInfo);
	}

	/**
	 * Проверяет подключение: найдена ли утилита, отвечает ли сервер
	 * администрирования и принимает ли он администратора кластера.
	 *
	 * Одного `cluster list` мало: список кластеров платформа отдаёт без
	 * аутентификации даже на защищённом кластере, поэтому с неверным паролем
	 * проверка сказала бы «сервер отвечает», а всё остальное потом отказывало бы.
	 * Если администратор задан, проверка дополнительно запрашивает базы первого
	 * кластера — этот вызов уже требует прав.
	 *
	 * Проверку запускают из формы подключения, где пароль ещё не сохранён,
	 * поэтому его можно передать явно. Если пароль не передан, берётся
	 * сохранённый: в форме поле оставляют пустым, когда менять его не собирались.
	 *
	 * @param connection - Проверяемое подключение (возможно, ещё не сохранённое)
	 * @param password - Введённый пароль администратора кластера
	 * @returns Найденные кластеры и признак проверки администратора
	 */
	async checkConnection(
		connection: ClusterConnection,
		password?: string
	): Promise<ServiceResult<ConnectionCheck>> {
		const scope =
			password === undefined
				? await this.scope(connection)
				: {
						address: racAddress(connection.host, connection.port),
						cluster: connection.clusterUser
							? { user: connection.clusterUser, password }
							: undefined,
					};

		const clusters = await this.collect(
			connection,
			buildClusterListArgs(scope),
			toClusterInfo
		);
		if (!clusters.ok) {
			return { ok: false, failure: clusters.failure };
		}

		const first = clusters.value[0];
		if (!connection.clusterUser || !first) {
			return { ok: true, value: { clusters: clusters.value, adminChecked: false } };
		}

		const probe = await this.client.run(
			buildInfobaseListArgs({ ...scope, clusterId: first.id }),
			{ platformVersion: connection.platformVersion }
		);
		if (!probe.ok) {
			return { ok: false, failure: probe.failure };
		}
		return { ok: true, value: { clusters: clusters.value, adminChecked: true } };
	}

	/**
	 * Меняет параметры кластера.
	 *
	 * Требует администратора центрального сервера: кластер — объект уровня агента,
	 * и администратор кластера его свойства менять не вправе.
	 *
	 * @param connection - Подключение
	 * @param clusterId - Идентификатор кластера
	 * @param update - Изменённые параметры
	 * @returns Итог операции
	 */
	async updateCluster(
		connection: ClusterConnection,
		clusterId: string,
		update: ClusterUpdate
	): Promise<ServiceResult<void>> {
		const scope = await this.scope(connection);
		const result = await this.client.run(
			buildClusterUpdateArgs({ ...scope, clusterId, update }),
			{ platformVersion: connection.platformVersion }
		);
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
	}

	/**
	 * Версия агента кластера.
	 *
	 * Аутентификации не требует: пригодна как первичная диагностика связи и как
	 * подсказка, какую версию платформы указывать в подключении.
	 *
	 * @param connection - Подключение
	 * @returns Версия вида 8.5.1.1343
	 */
	async agentVersion(connection: ClusterConnection): Promise<ServiceResult<string>> {
		const scope = await this.scope(connection);
		const result = await this.client.run(buildAgentVersionArgs(scope), {
			platformVersion: connection.platformVersion,
		});
		return result.ok
			? { ok: true, value: result.stdout.trim().split(/\r?\n/)[0] ?? '' }
			: { ok: false, failure: result.failure };
	}

	/**
	 * Меняет параметры рабочего сервера.
	 *
	 * @param connection - Подключение
	 * @param clusterId - Идентификатор кластера
	 * @param serverId - Идентификатор рабочего сервера
	 * @param update - Изменённые параметры
	 * @returns Итог операции
	 */
	async updateServer(
		connection: ClusterConnection,
		clusterId: string,
		serverId: string,
		update: Record<string, string>
	): Promise<ServiceResult<void>> {
		const scope = await this.clusterScope(connection, clusterId);
		const result = await this.client.run(buildServerUpdateArgs({ ...scope, serverId, update }), {
			platformVersion: connection.platformVersion,
		});
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
	}

	/** Сведения о соединении. */
	async connectionDetails(
		connection: ClusterConnection,
		clusterId: string,
		connectionId: string
	): Promise<ServiceResult<RacRecord>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.single(connection, buildConnectionInfoArgs({ ...scope, connectionId }));
	}

	/** Сведения о менеджере кластера. */
	async managerDetails(
		connection: ClusterConnection,
		clusterId: string,
		managerId: string
	): Promise<ServiceResult<RacRecord>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.single(connection, buildManagerInfoArgs({ ...scope, managerId }));
	}

	/** Список администраторов кластера. */
	async listClusterAdmins(
		connection: ClusterConnection,
		clusterId: string
	): Promise<ServiceResult<AdminInfo[]>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.collect(connection, buildClusterAdminListArgs(scope), toAdminInfo);
	}

	/** Список администраторов центрального сервера. */
	async listAgentAdmins(connection: ClusterConnection): Promise<ServiceResult<AdminInfo[]>> {
		const scope = await this.scope(connection);
		return this.collect(connection, buildAgentAdminListArgs(scope), toAdminInfo);
	}

	/**
	 * Заводит администратора кластера.
	 *
	 * @param connection - Подключение
	 * @param clusterId - Идентификатор кластера
	 * @param registration - Данные администратора
	 * @returns Итог операции
	 */
	async registerClusterAdmin(
		connection: ClusterConnection,
		clusterId: string,
		registration: AdminRegistration
	): Promise<ServiceResult<void>> {
		const scope = await this.clusterScope(connection, clusterId);
		const result = await this.client.run(
			buildClusterAdminRegisterArgs({ ...scope, registration }),
			{ platformVersion: connection.platformVersion }
		);
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
	}

	/**
	 * Удаляет администратора кластера.
	 *
	 * @param connection - Подключение
	 * @param clusterId - Идентификатор кластера
	 * @param name - Имя администратора
	 * @returns Итог операции
	 */
	async removeClusterAdmin(
		connection: ClusterConnection,
		clusterId: string,
		name: string
	): Promise<ServiceResult<void>> {
		const scope = await this.clusterScope(connection, clusterId);
		const result = await this.client.run(buildClusterAdminRemoveArgs({ ...scope, name }), {
			platformVersion: connection.platformVersion,
		});
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
	}

	/**
	 * Заводит администратора центрального сервера.
	 *
	 * @param connection - Подключение
	 * @param registration - Данные администратора
	 * @returns Итог операции
	 */
	async registerAgentAdmin(
		connection: ClusterConnection,
		registration: AdminRegistration
	): Promise<ServiceResult<void>> {
		const scope = await this.scope(connection);
		const result = await this.client.run(buildAgentAdminRegisterArgs({ ...scope, registration }), {
			platformVersion: connection.platformVersion,
		});
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
	}

	/**
	 * Удаляет администратора центрального сервера.
	 *
	 * @param connection - Подключение
	 * @param name - Имя администратора
	 * @returns Итог операции
	 */
	async removeAgentAdmin(
		connection: ClusterConnection,
		name: string
	): Promise<ServiceResult<void>> {
		const scope = await this.scope(connection);
		const result = await this.client.run(buildAgentAdminRemoveArgs({ ...scope, name }), {
			platformVersion: connection.platformVersion,
		});
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
	}

	/** Список менеджеров кластера. */
	async listManagers(
		connection: ClusterConnection,
		clusterId: string
	): Promise<ServiceResult<ManagerInfo[]>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.collect(connection, buildManagerListArgs(scope), toManagerInfo);
	}

	/** Список рабочих серверов кластера. */
	async listServers(
		connection: ClusterConnection,
		clusterId: string
	): Promise<ServiceResult<ServerInfo[]>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.collect(connection, buildServerListArgs(scope), toServerInfo);
	}

	/** Список рабочих процессов кластера или одного сервера. */
	async listProcesses(
		connection: ClusterConnection,
		clusterId: string,
		serverId?: string
	): Promise<ServiceResult<ProcessInfo[]>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.collect(connection, buildProcessListArgs({ ...scope, serverId }), toProcessInfo);
	}

	/** Список информационных баз кластера. */
	async listInfobases(
		connection: ClusterConnection,
		clusterId: string
	): Promise<ServiceResult<InfobaseInfo[]>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.collect(connection, buildInfobaseListArgs(scope), toInfobaseInfo);
	}

	/** Список сеансов кластера или одной информационной базы. */
	async listSessions(
		connection: ClusterConnection,
		clusterId: string,
		infobaseId?: string
	): Promise<ServiceResult<SessionInfo[]>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.collect(connection, buildSessionListArgs({ ...scope, infobaseId }), toSessionInfo);
	}

	/** Список соединений кластера, процесса или информационной базы. */
	async listConnections(
		connection: ClusterConnection,
		clusterId: string,
		filter: { processId?: string; infobaseId?: string } = {}
	): Promise<ServiceResult<ConnectionInfo[]>> {
		const scope = await this.clusterScope(connection, clusterId);
		// Платформа принимает --process только вместе с --infobase и без второй
		// опции отвечает «Ошибка разбора параметра: infobase». Поэтому отбор по
		// процессу без базы делается на нашей стороне: список соединений кластера
		// и так содержит идентификатор рабочего процесса.
		const platformFilters = filter.processId !== undefined && filter.infobaseId !== undefined;
		const result = await this.collect(
			connection,
			buildConnectionListArgs({
				...scope,
				infobaseId: filter.infobaseId,
				processId: platformFilters ? filter.processId : undefined,
			}),
			toConnectionInfo
		);
		if (!result.ok || platformFilters || filter.processId === undefined) {
			return result;
		}
		return { ok: true, value: result.value.filter((item) => item.processId === filter.processId) };
	}

	/** Список блокировок кластера или информационной базы. */
	async listLocks(
		connection: ClusterConnection,
		clusterId: string,
		infobaseId?: string
	): Promise<ServiceResult<LockInfo[]>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.collect(connection, buildLockListArgs({ ...scope, infobaseId }), toLockInfo);
	}

	/** Подробности кластера. */
	async clusterDetails(
		connection: ClusterConnection,
		clusterId: string
	): Promise<ServiceResult<RacRecord>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.single(connection, buildClusterInfoArgs(scope));
	}

	/** Подробности рабочего сервера. */
	async serverDetails(
		connection: ClusterConnection,
		clusterId: string,
		serverId: string
	): Promise<ServiceResult<RacRecord>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.single(connection, buildServerInfoArgs({ ...scope, serverId }));
	}

	/** Подробности рабочего процесса. */
	async processDetails(
		connection: ClusterConnection,
		clusterId: string,
		processId: string
	): Promise<ServiceResult<RacRecord>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.single(connection, buildProcessInfoArgs({ ...scope, processId }));
	}

	/** Подробности сеанса. */
	async sessionDetails(
		connection: ClusterConnection,
		clusterId: string,
		sessionId: string
	): Promise<ServiceResult<RacRecord>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.single(connection, buildSessionInfoArgs({ ...scope, sessionId }));
	}

	/**
	 * Подробности информационной базы.
	 *
	 * Полная информация закрыта паролем администратора базы, поэтому вызов идёт
	 * через {@link withInfobaseAuth}.
	 */
	async infobaseDetails(
		connection: ClusterConnection,
		clusterId: string,
		infobaseId: string,
		infobaseName: string
	): Promise<ServiceResult<RacRecord>> {
		const scope = await this.clusterScope(connection, clusterId);
		const result = await this.withInfobaseAuth(connection, infobaseId, infobaseName, (infobase) =>
			this.client.run(buildInfobaseInfoArgs({ ...scope, infobaseId, infobase }), {
				platformVersion: connection.platformVersion,
			})
		);
		if (!result.ok) {
			return { ok: false, failure: result.failure };
		}
		const record = result.records[0];
		return record
			? { ok: true, value: record }
			: {
					ok: false,
					failure: { kind: 'notFound', message: 'Утилита rac не вернула данных об информационной базе' },
				};
	}

	/** Принудительно завершает сеанс. */
	async terminateSession(
		connection: ClusterConnection,
		clusterId: string,
		sessionId: string,
		errorMessage?: string
	): Promise<ServiceResult<void>> {
		const scope = await this.clusterScope(connection, clusterId);
		const result = await this.client.run(
			buildSessionTerminateArgs({ ...scope, sessionId, errorMessage }),
			{ platformVersion: connection.platformVersion }
		);
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
	}

	/**
	 * Прерывает текущий серверный вызов сеанса.
	 *
	 * @param connection - Подключение
	 * @param clusterId - Идентификатор кластера
	 * @param sessionId - Идентификатор сеанса
	 * @param errorMessage - Сообщение пользователю
	 * @returns Итог операции
	 */
	async interruptSessionCall(
		connection: ClusterConnection,
		clusterId: string,
		sessionId: string,
		errorMessage?: string
	): Promise<ServiceResult<void>> {
		const scope = await this.clusterScope(connection, clusterId);
		const result = await this.client.run(
			buildSessionInterruptArgs({ ...scope, sessionId, errorMessage }),
			{ platformVersion: connection.platformVersion }
		);
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
	}

	/**
	 * Выключает рабочий процесс.
	 *
	 * @param connection - Подключение
	 * @param clusterId - Идентификатор кластера
	 * @param processId - Идентификатор рабочего процесса
	 * @returns Итог операции
	 */
	async turnOffProcess(
		connection: ClusterConnection,
		clusterId: string,
		processId: string
	): Promise<ServiceResult<void>> {
		const scope = await this.clusterScope(connection, clusterId);
		const result = await this.client.run(buildProcessTurnOffArgs({ ...scope, processId }), {
			platformVersion: connection.platformVersion,
		});
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
	}

	/** Разрывает соединение. */
	async disconnectConnection(
		connection: ClusterConnection,
		clusterId: string,
		target: { processId: string; connectionId: string; infobaseId?: string; infobaseName?: string }
	): Promise<ServiceResult<void>> {
		const scope = await this.clusterScope(connection, clusterId);
		const call = (infobase?: RacCredentials) =>
			this.client.run(
				buildConnectionDisconnectArgs({
					...scope,
					processId: target.processId,
					connectionId: target.connectionId,
					infobase,
				}),
				{ platformVersion: connection.platformVersion }
			);
		const result = target.infobaseId
			? await this.withInfobaseAuth(
					connection,
					target.infobaseId,
					target.infobaseName ?? 'информационная база',
					call
				)
			: await call();
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
	}

	/** Изменяет параметры информационной базы: блокировки сеансов и заданий. */
	async updateInfobase(
		connection: ClusterConnection,
		clusterId: string,
		infobase: { id: string; name: string },
		update: InfobaseUpdate
	): Promise<ServiceResult<void>> {
		const scope = await this.clusterScope(connection, clusterId);
		const result = await this.withInfobaseAuth(
			connection,
			infobase.id,
			infobase.name,
			(infobaseCredentials) =>
				this.client.run(
					buildInfobaseUpdateArgs({
						...scope,
						infobaseId: infobase.id,
						infobase: infobaseCredentials,
						update,
					}),
					{ platformVersion: connection.platformVersion }
				)
		);
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
	}
}
