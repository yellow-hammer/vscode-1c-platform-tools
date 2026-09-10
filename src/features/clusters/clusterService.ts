/**
 * Доменные операции над кластером серверов.
 *
 * Здесь собраны действия администратора — список кластеров, сеансы, блокировки,
 * завершение сеанса — поверх трёх слоёв: сборки аргументов (racArgs), запуска
 * утилиты (racClient) и разбора объектов (model). Дерево и команды обращаются
 * только к этому слою и не знают ни об аргументах rac, ни о процессах.
 *
 * Пароль администратора информационной базы утилита требует только у части
 * операций и только если в базе есть администраторы. Подходящий набор
 * подставляется сам; если набора нет или его не приняли — уведомление в углу,
 * без диалога. См. {@link ClusterService.withInfobaseAuth}.
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
	buildInfobaseDropArgs,
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
	type InfobaseDropMode,
	type InfobaseUpdate,
	type RacCredentials,
	type RacScope,
} from './racArgs';
import type { ClusterCredentialStore, ConnectionRole } from './credentials';
import type { MissingCredentialsEvent, MissingCredentialsKind } from './credentialsNotify';
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
import { attributeAuthFailure, type RacAuthRole, type RacFailure, type RacRecord } from './racOutput';

/** Итог проверки подключения. */
export interface ConnectionCheck {
	/** Кластеры сервера администрирования. */
	clusters: ClusterInfo[];
	/** Проверялся ли администратор кластера: без него проверять нечего. */
	adminChecked: boolean;
}

/** Итог доменной операции. */
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; failure: RacFailure };

/** Сколько информационных баз читается одновременно. */
const INFOBASE_BATCH = 4;

/**
 * Превращает итог вызова в список типизированных объектов.
 *
 * @param result - Итог вызова rac
 * @param map - Преобразование объекта вывода
 * @returns Список объектов или причина неудачи
 */
function toList<T>(result: RacResult, map: (record: RacRecord) => T): ServiceResult<T[]> {
	return result.ok
		? { ok: true, value: result.records.map(map) }
		: { ok: false, failure: result.failure };
}

/** Операции администрирования кластера. */
export class ClusterService {
	constructor(
		private readonly client: RacClient,
		private readonly credentials: ClusterCredentialStore,
		private readonly notifyMissing: (event: MissingCredentialsEvent) => void = () => undefined
	) {}

	/**
	 * Собирает общую часть вызова: адрес и администраторов из наборов.
	 *
	 * @param connection - Подключение к серверу администрирования
	 * @returns Адрес и учётные данные администраторов кластера и агента
	 */
	private async scope(connection: ClusterConnection): Promise<RacScope> {
		return {
			address: racAddress(connection.host, connection.port),
			cluster: await this.credentials.resolveRole('cluster', connection.id),
			agent: await this.credentials.resolveRole('agent', connection.id),
		};
	}

	/** Запускает rac с версией платформы подключения. */
	private run(connection: ClusterConnection, args: string[]): Promise<RacResult> {
		return this.client.run(args, { platformVersion: connection.platformVersion });
	}

	/**
	 * Приписывает отказ роли и сообщает, что её набора нет или его не приняли.
	 *
	 * Прочие неудачи возвращаются как есть.
	 *
	 * @param failure - Разобранная неудача
	 * @param role - Чьи учётные данные передавал вызов
	 * @param hadSet - Уходил ли набор этой роли в вызов
	 * @param infobaseName - Имя базы для уведомления об администраторе базы
	 * @returns Неудача с ролью и сообщением про неё
	 */
	private rejected(
		failure: RacFailure,
		role: RacAuthRole,
		hadSet: boolean,
		infobaseName?: string
	): RacFailure {
		if (failure.kind !== 'auth') {
			return failure;
		}
		const kind: MissingCredentialsKind = `${role}${hadSet ? 'Rejected' : 'Missing'}`;
		this.notifyMissing(role === 'infobase' ? { kind, infobaseName } : { kind });
		return attributeAuthFailure(failure, role);
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
		return {
			address: racAddress(connection.host, connection.port),
			// Внутри кластера набор ищется точнее: сначала привязка к кластеру
			cluster: await this.credentials.resolveClusterAdmin(connection.id, clusterId),
			agent: await this.credentials.resolveRole('agent', connection.id),
			clusterId,
		};
	}

	/**
	 * Выполняет вызов и превращает объекты вывода в типизированные.
	 *
	 * @param connection - Подключение (задаёт версию платформы)
	 * @param scope - Область вызова: по ней видно, уходил ли набор роли
	 * @param args - Аргументы вызова
	 * @param map - Преобразование объекта вывода
	 * @param role - Чьи учётные данные защищают вызов
	 * @returns Список объектов или причина неудачи
	 */
	private async collect<T>(
		connection: ClusterConnection,
		scope: RacScope,
		args: string[],
		map: (record: RacRecord) => T,
		role: ConnectionRole = 'cluster'
	): Promise<ServiceResult<T[]>> {
		const result = await this.run(connection, args);
		if (!result.ok) {
			return { ok: false, failure: this.rejected(result.failure, role, scope[role] !== undefined) };
		}
		return { ok: true, value: result.records.map(map) };
	}

	/**
	 * Выполняет вызов, ожидая один объект.
	 *
	 * @param connection - Подключение
	 * @param scope - Область вызова
	 * @param args - Аргументы вызова
	 * @returns Поля объекта или причина неудачи
	 */
	private async single(
		connection: ClusterConnection,
		scope: RacScope,
		args: string[]
	): Promise<ServiceResult<RacRecord>> {
		const result = await this.run(connection, args);
		if (!result.ok) {
			return {
				ok: false,
				failure: this.rejected(result.failure, 'cluster', scope.cluster !== undefined),
			};
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
	 * Выполняет операцию над информационной базой с подходящим набором.
	 *
	 * Вызов идёт с привязанным набором администратора базы; базе без
	 * пользователей он не нужен. Отказ по аутентификации приписывается той
	 * роли, которую назвала платформа: закрытый кластер отвечает про своего
	 * администратора и при верном наборе базы.
	 *
	 * @param connection - Подключение
	 * @param scope - Область вызова с кластером
	 * @param infobaseId - Идентификатор информационной базы
	 * @param infobaseName - Имя базы для уведомления
	 * @param call - Вызов rac, принимающий учётные данные базы
	 * @returns Итог вызова
	 */
	private async withInfobaseAuth(
		connection: ClusterConnection,
		scope: ClusterScope,
		infobaseId: string,
		infobaseName: string,
		call: (infobase?: RacCredentials) => Promise<RacResult>
	): Promise<RacResult> {
		const known = await this.credentials.resolveInfobase(connection.id, infobaseId);
		const first = await call(known);
		if (first.ok || first.failure.kind !== 'auth') {
			return first;
		}
		const { role } = first.failure;
		if (role === 'cluster' || role === 'agent') {
			return { ok: false, failure: this.rejected(first.failure, role, scope[role] !== undefined) };
		}
		return {
			ok: false,
			failure: this.rejected(first.failure, 'infobase', known !== undefined, infobaseName),
		};
	}

	/** Список кластеров сервера администрирования. */
	async listClusters(connection: ClusterConnection): Promise<ServiceResult<ClusterInfo[]>> {
		const scope = await this.scope(connection);
		return this.collect(connection, scope, buildClusterListArgs(scope), toClusterInfo);
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
	 * Проверку запускают из формы подключения или набора. Администратора кластера
	 * можно передать явно — в форме набора пароль ещё не сохранён. Иначе берётся
	 * набор, привязанный к подключению.
	 *
	 * @param connection - Проверяемое подключение (возможно, ещё не сохранённое)
	 * @param clusterAuth - Явные учётные данные администратора кластера
	 * @returns Найденные кластеры и признак проверки администратора
	 */
	async checkConnection(
		connection: ClusterConnection,
		clusterAuth?: RacCredentials
	): Promise<ServiceResult<ConnectionCheck>> {
		const resolved = clusterAuth ?? (await this.credentials.resolveRole('cluster', connection.id));
		const scope: RacScope = {
			address: racAddress(connection.host, connection.port),
			cluster: resolved,
		};

		const listed = await this.client.run(buildClusterListArgs(scope), {
			platformVersion: connection.platformVersion,
		});
		if (!listed.ok) {
			return { ok: false, failure: listed.failure };
		}
		const clusters = listed.records.map(toClusterInfo);

		const first = clusters[0];
		if (!resolved?.user || !first) {
			return { ok: true, value: { clusters, adminChecked: false } };
		}

		const probe = await this.client.run(
			buildInfobaseListArgs({ ...scope, clusterId: first.id }),
			{ platformVersion: connection.platformVersion }
		);
		if (!probe.ok) {
			return { ok: false, failure: probe.failure };
		}
		return { ok: true, value: { clusters, adminChecked: true } };
	}

	/**
	 * Проверяет учётные данные администратора конкретного кластера.
	 *
	 * Список баз кластера закрыт его администратором, поэтому годится как проба.
	 *
	 * @param connection - Подключение
	 * @param clusterId - Идентификатор кластера
	 * @param clusterAuth - Проверяемые учётные данные
	 * @returns Итог проверки
	 */
	async checkClusterAdmin(
		connection: ClusterConnection,
		clusterId: string,
		clusterAuth: RacCredentials
	): Promise<ServiceResult<void>> {
		const result = await this.client.run(
			buildInfobaseListArgs({
				address: racAddress(connection.host, connection.port),
				cluster: clusterAuth,
				clusterId,
			}),
			{ platformVersion: connection.platformVersion }
		);
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
	}

	/**
	 * Проверяет учётные данные администратора центрального сервера.
	 *
	 * Список администраторов агента закрыт этой ролью, поэтому годится как
	 * проба: на сервере без администраторов вызов проходит с любыми данными —
	 * тогда и доступ открыт любым.
	 *
	 * @param connection - Подключение
	 * @param agentAuth - Проверяемые учётные данные
	 * @returns Итог проверки
	 */
	async checkAgentAdmin(
		connection: ClusterConnection,
		agentAuth: RacCredentials
	): Promise<ServiceResult<void>> {
		const scope: RacScope = {
			address: racAddress(connection.host, connection.port),
			agent: agentAuth,
		};
		const result = await this.client.run(buildAgentAdminListArgs(scope), {
			platformVersion: connection.platformVersion,
		});
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
	}

	/**
	 * Проверяет учётные данные администратора информационной базы.
	 *
	 * Полные сведения базы закрыты её администратором, поэтому чтение — честная
	 * проба. Администратор кластера для области вызова берётся из наборов: без
	 * него платформа не пустит и к базе.
	 *
	 * @param connection - Подключение
	 * @param clusterId - Кластер привязанной базы
	 * @param infobaseId - Идентификатор базы
	 * @param infobaseAuth - Проверяемые учётные данные
	 * @returns Итог проверки
	 */
	async checkInfobaseAdmin(
		connection: ClusterConnection,
		clusterId: string,
		infobaseId: string,
		infobaseAuth: RacCredentials
	): Promise<ServiceResult<void>> {
		const scope = await this.clusterScope(connection, clusterId);
		const result = await this.client.run(
			buildInfobaseInfoArgs({ ...scope, infobaseId, infobase: infobaseAuth }),
			{ platformVersion: connection.platformVersion }
		);
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
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
		const result = await this.run(connection, buildClusterUpdateArgs({ ...scope, clusterId, update }));
		if (!result.ok) {
			return {
				ok: false,
				failure: this.rejected(result.failure, 'agent', scope.agent !== undefined),
			};
		}
		return { ok: true, value: undefined };
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
		return this.single(connection, scope, buildConnectionInfoArgs({ ...scope, connectionId }));
	}

	/** Сведения о менеджере кластера. */
	async managerDetails(
		connection: ClusterConnection,
		clusterId: string,
		managerId: string
	): Promise<ServiceResult<RacRecord>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.single(connection, scope, buildManagerInfoArgs({ ...scope, managerId }));
	}

	/** Список администраторов кластера. */
	async listClusterAdmins(
		connection: ClusterConnection,
		clusterId: string
	): Promise<ServiceResult<AdminInfo[]>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.collect(connection, scope, buildClusterAdminListArgs(scope), toAdminInfo);
	}

	/** Список администраторов центрального сервера. */
	async listAgentAdmins(connection: ClusterConnection): Promise<ServiceResult<AdminInfo[]>> {
		const scope = await this.scope(connection);
		return this.collect(connection, scope, buildAgentAdminListArgs(scope), toAdminInfo, 'agent');
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
		return this.collect(connection, scope, buildManagerListArgs(scope), toManagerInfo);
	}

	/** Список рабочих серверов кластера. */
	async listServers(
		connection: ClusterConnection,
		clusterId: string
	): Promise<ServiceResult<ServerInfo[]>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.collect(connection, scope, buildServerListArgs(scope), toServerInfo);
	}

	/** Список рабочих процессов кластера или одного сервера. */
	async listProcesses(
		connection: ClusterConnection,
		clusterId: string,
		serverId?: string
	): Promise<ServiceResult<ProcessInfo[]>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.collect(connection, scope, buildProcessListArgs({ ...scope, serverId }), toProcessInfo);
	}

	/** Список информационных баз кластера. */
	async listInfobases(
		connection: ClusterConnection,
		clusterId: string
	): Promise<ServiceResult<InfobaseInfo[]>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.collect(connection, scope, buildInfobaseListArgs(scope), toInfobaseInfo);
	}

	/**
	 * Читает полные сведения о нескольких информационных базах.
	 *
	 * Режим работы и размещение краткий список не отдаёт, а полные сведения
	 * читаются по одной базе. Пароль администратора базы не спрашивается — ради
	 * значка в дереве окно ввода было бы навязчиво, — поэтому закрытая база
	 * остаётся без сведений; уже известный пароль используется.
	 *
	 * @param connection - Подключение
	 * @param clusterId - Идентификатор кластера
	 * @param infobaseIds - Идентификаторы баз
	 * @returns Промис, который разрешается сведениями тех баз, которые ответили
	 */
	async infobaseRecords(
		connection: ClusterConnection,
		clusterId: string,
		infobaseIds: string[]
	): Promise<Map<string, RacRecord>> {
		const scope = await this.clusterScope(connection, clusterId);
		const records = new Map<string, RacRecord>();
		const queue = [...infobaseIds];
		const read = async (): Promise<void> => {
			for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
				const result = await this.client.run(
					buildInfobaseInfoArgs({
						...scope,
						infobaseId: id,
						infobase: await this.credentials.resolveInfobase(connection.id, id),
					}),
					{ platformVersion: connection.platformVersion }
				);
				const record = result.ok ? result.records[0] : undefined;
				if (record) {
					records.set(id, record);
				}
			}
		};
		// Порциями: каждый вызов — отдельный процесс rac. Все разом нагрузили бы
		// машину, строго по одному — дерево ждало бы сведения слишком долго.
		await Promise.all(
			Array.from({ length: Math.min(INFOBASE_BATCH, queue.length) }, () => read())
		);
		return records;
	}

	/** Список сеансов кластера или одной информационной базы. */
	async listSessions(
		connection: ClusterConnection,
		clusterId: string,
		infobaseId?: string
	): Promise<ServiceResult<SessionInfo[]>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.collect(connection, scope, buildSessionListArgs({ ...scope, infobaseId }), toSessionInfo);
	}

	/**
	 * Список соединений кластера, процесса или информационной базы.
	 *
	 * Соединения одной базы платформа отдаёт её администратору, если в базе
	 * есть пользователи, поэтому отбор по базе идёт с её набором.
	 */
	async listConnections(
		connection: ClusterConnection,
		clusterId: string,
		filter: { processId?: string; infobaseId?: string; infobaseName?: string } = {}
	): Promise<ServiceResult<ConnectionInfo[]>> {
		const scope = await this.clusterScope(connection, clusterId);
		// Платформа принимает --process только вместе с --infobase и без второй
		// опции отвечает «Ошибка разбора параметра: infobase». Поэтому отбор по
		// процессу без базы делается на нашей стороне: список соединений кластера
		// и так содержит идентификатор рабочего процесса.
		const platformFilters = filter.processId !== undefined && filter.infobaseId !== undefined;
		const args = (infobase?: RacCredentials) =>
			buildConnectionListArgs({
				...scope,
				infobaseId: filter.infobaseId,
				processId: platformFilters ? filter.processId : undefined,
				infobase,
			});
		const result =
			filter.infobaseId === undefined
				? await this.collect(connection, scope, args(), toConnectionInfo)
				: toList(
						await this.withInfobaseAuth(
							connection,
							scope,
							filter.infobaseId,
							filter.infobaseName ?? 'информационная база',
							(infobase) => this.run(connection, args(infobase))
						),
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
		return this.collect(connection, scope, buildLockListArgs({ ...scope, infobaseId }), toLockInfo);
	}

	/** Подробности кластера. */
	async clusterDetails(
		connection: ClusterConnection,
		clusterId: string
	): Promise<ServiceResult<RacRecord>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.single(connection, scope, buildClusterInfoArgs(scope));
	}

	/** Подробности рабочего сервера. */
	async serverDetails(
		connection: ClusterConnection,
		clusterId: string,
		serverId: string
	): Promise<ServiceResult<RacRecord>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.single(connection, scope, buildServerInfoArgs({ ...scope, serverId }));
	}

	/** Подробности рабочего процесса. */
	async processDetails(
		connection: ClusterConnection,
		clusterId: string,
		processId: string
	): Promise<ServiceResult<RacRecord>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.single(connection, scope, buildProcessInfoArgs({ ...scope, processId }));
	}

	/** Подробности сеанса. */
	async sessionDetails(
		connection: ClusterConnection,
		clusterId: string,
		sessionId: string
	): Promise<ServiceResult<RacRecord>> {
		const scope = await this.clusterScope(connection, clusterId);
		return this.single(connection, scope, buildSessionInfoArgs({ ...scope, sessionId }));
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
		const result = await this.withInfobaseAuth(connection, scope, infobaseId, infobaseName, (infobase) =>
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
					scope,
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
			scope,
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

	/**
	 * Удаляет информационную базу из кластера.
	 *
	 * @param connection - Подключение
	 * @param clusterId - Идентификатор кластера
	 * @param infobase - Идентификатор и имя базы
	 * @param mode - Что делать с базой данных на сервере СУБД
	 * @returns Промис, который разрешается итогом операции
	 */
	async dropInfobase(
		connection: ClusterConnection,
		clusterId: string,
		infobase: { id: string; name: string },
		mode: InfobaseDropMode
	): Promise<ServiceResult<void>> {
		const scope = await this.clusterScope(connection, clusterId);
		const result = await this.withInfobaseAuth(
			connection,
			scope,
			infobase.id,
			infobase.name,
			(infobaseCredentials) =>
				this.client.run(
					buildInfobaseDropArgs({
						...scope,
						infobaseId: infobase.id,
						infobase: infobaseCredentials,
						mode,
					}),
					{ platformVersion: connection.platformVersion }
				)
		);
		return result.ok ? { ok: true, value: undefined } : { ok: false, failure: result.failure };
	}
}
