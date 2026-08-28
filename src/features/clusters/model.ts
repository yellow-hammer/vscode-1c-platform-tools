/**
 * Объекты кластера серверов и их разбор из вывода rac.
 *
 * У каждого объекта два слоя: разобранные поля, на которых держится дерево и
 * действия, и исходный набор полей `record` — его показывает окно подробностей.
 * Так набор полей, отличающийся между версиями платформы, не теряется: дерево
 * работает на известных полях, а пользователь видит всё, что отдал rac.
 */

import { EMPTY_UUID } from './constants';
import type { RacRecord } from './racOutput';

/** Подключение к серверу администрирования (хранится в настройках расширения). */
export interface ClusterConnection {
	/** Внутренний идентификатор подключения. */
	id: string;
	/** Имя подключения, заданное пользователем. */
	name: string;
	/** Имя или адрес компьютера с сервером администрирования. */
	host: string;
	/** Порт сервера администрирования. */
	port: number;
	/** Версия платформы для выбора rac; пусто — наибольшая доступная. */
	platformVersion?: string;
}

/** Кластер серверов. */
export interface ClusterInfo {
	id: string;
	name: string;
	host: string;
	port: string;
	record: RacRecord;
}

/** Рабочий сервер кластера. */
export interface ServerInfo {
	id: string;
	name: string;
	host: string;
	port: string;
	/** Вариант использования: `main` — центральный сервер, `normal` — обычный. */
	using: string;
	record: RacRecord;
}

/** Рабочий процесс. */
export interface ProcessInfo {
	id: string;
	host: string;
	port: string;
	pid: string;
	/** Процесс запущен. */
	running: boolean;
	/** Процесс включён администратором. */
	enabled: boolean;
	/** Количество соединений процесса. */
	connections: string;
	/** Занятая память, байты (как отдал rac). */
	memorySize: string;
	record: RacRecord;
}

/** Информационная база (краткое описание). */
export interface InfobaseInfo {
	id: string;
	name: string;
	descr: string;
	record: RacRecord;
}

/**
 * Режим работы информационной базы.
 *
 * Краткий список баз этих признаков не отдаёт: они приходят только в полных
 * сведениях о базе. Дерево и таблица показывают их отдельно от {@link
 * InfobaseInfo}, потому что состояние известно не всегда — базу с
 * администратором платформа без пароля не раскрывает.
 */
export interface InfobaseState {
	/** Начало сеансов запрещено. */
	sessionsDeny: boolean;
	/** Регламентные задания запрещены. */
	scheduledJobsDeny: boolean;
	/** Начало блокировки сеансов, как отдал rac; пусто, если не задано. */
	deniedFrom: string;
	/** Конец блокировки сеансов, как отдал rac; пусто, если не задано. */
	deniedTo: string;
}

/** Сеанс информационной базы. */
export interface SessionInfo {
	id: string;
	/** Номер сеанса в информационной базе. */
	number: string;
	userName: string;
	host: string;
	appId: string;
	startedAt: string;
	lastActiveAt: string;
	infobaseId: string;
	connectionId: string;
	processId: string;
	/** Сеанс ждёт освобождения блокировки СУБД. */
	blockedByDbms: boolean;
	/** Сеанс ждёт освобождения управляемой транзакционной блокировки. */
	blockedByLs: boolean;
	/** Сеанс спящий. */
	hibernate: boolean;
	record: RacRecord;
}

/** Соединение с информационной базой. */
export interface ConnectionInfo {
	id: string;
	/** Номер соединения. */
	connId: string;
	host: string;
	processId: string;
	infobaseId: string;
	application: string;
	connectedAt: string;
	sessionNumber: string;
	record: RacRecord;
}

/** Блокировка, удерживаемая соединением или сеансом. */
export interface LockInfo {
	connectionId: string;
	sessionId: string;
	object: string;
	locked: string;
	descr: string;
	record: RacRecord;
}

/**
 * Читает поле объекта, подставляя пустую строку.
 *
 * @param record - Поля объекта из вывода rac
 * @param key - Имя поля
 * @returns Значение или пустая строка
 */
function field(record: RacRecord, key: string): string {
	return record[key] ?? '';
}

/**
 * Приводит логическое поле rac к boolean.
 *
 * Утилита пишет `yes`/`no` для признаков процессов и сеансов и `on`/`off` для
 * режимов информационной базы, поэтому распознаются оба набора.
 *
 * @param value - Значение поля
 * @returns true, если признак включён
 */
export function isRacFlagOn(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return normalized === 'yes' || normalized === 'on' || normalized === 'true' || normalized === '1';
}

/**
 * Пустая ли ссылка на объект.
 *
 * rac заполняет отсутствующую ссылку нулевым идентификатором, а не пропускает
 * поле: соединение служебного назначения приходит с нулевой информационной базой.
 *
 * @param id - Идентификатор из вывода rac
 * @returns true, если ссылки нет
 */
export function isEmptyRef(id: string): boolean {
	return id === '' || id === EMPTY_UUID;
}

/** Разбирает кластер. */
export function toClusterInfo(record: RacRecord): ClusterInfo {
	return {
		id: field(record, 'cluster'),
		name: field(record, 'name'),
		host: field(record, 'host'),
		port: field(record, 'port'),
		record,
	};
}

/** Разбирает рабочий сервер. */
export function toServerInfo(record: RacRecord): ServerInfo {
	return {
		id: field(record, 'server'),
		name: field(record, 'name'),
		host: field(record, 'agent-host'),
		port: field(record, 'agent-port'),
		using: field(record, 'using'),
		record,
	};
}

/** Разбирает рабочий процесс. */
export function toProcessInfo(record: RacRecord): ProcessInfo {
	return {
		id: field(record, 'process'),
		host: field(record, 'host'),
		port: field(record, 'port'),
		pid: field(record, 'pid'),
		running: isRacFlagOn(field(record, 'running')),
		// Поле переименовано в платформе 8.5: было is-enable, стало turned-on.
		enabled: isRacFlagOn(field(record, 'turned-on') || field(record, 'is-enable')),
		connections: field(record, 'connections'),
		memorySize: field(record, 'memory-size'),
		record,
	};
}

/** Менеджер кластера. */
export interface ManagerInfo {
	id: string;
	pid: string;
	host: string;
	port: string;
	/** main — главный менеджер кластера, остальные обслуживают сервисы. */
	using: string;
	descr: string;
	record: RacRecord;
}

/** Разбирает менеджер кластера. */
export function toManagerInfo(record: RacRecord): ManagerInfo {
	return {
		id: field(record, 'manager'),
		pid: field(record, 'pid'),
		host: field(record, 'host'),
		port: field(record, 'port'),
		using: field(record, 'using'),
		descr: field(record, 'descr'),
		record,
	};
}

/** Администратор кластера или центрального сервера. */
export interface AdminInfo {
	name: string;
	/** Способ аутентификации: pwd, os или оба. */
	auth: string;
	/** Пользователь операционной системы при аутентификации средствами ОС. */
	osUser: string;
	descr: string;
	record: RacRecord;
}

/** Разбирает администратора. */
export function toAdminInfo(record: RacRecord): AdminInfo {
	return {
		name: field(record, 'name'),
		auth: field(record, 'auth'),
		osUser: field(record, 'os-user'),
		descr: field(record, 'descr'),
		record,
	};
}

/** Разбирает информационную базу. */
export function toInfobaseInfo(record: RacRecord): InfobaseInfo {
	return {
		id: field(record, 'infobase'),
		name: field(record, 'name'),
		descr: field(record, 'descr'),
		record,
	};
}

/** Разбирает режим работы информационной базы. */
export function toInfobaseState(record: RacRecord): InfobaseState {
	return {
		sessionsDeny: isRacFlagOn(field(record, 'sessions-deny')),
		scheduledJobsDeny: isRacFlagOn(field(record, 'scheduled-jobs-deny')),
		deniedFrom: field(record, 'denied-from'),
		deniedTo: field(record, 'denied-to'),
	};
}

/** Разбирает сеанс. */
export function toSessionInfo(record: RacRecord): SessionInfo {
	return {
		id: field(record, 'session'),
		number: field(record, 'session-id'),
		userName: field(record, 'user-name'),
		host: field(record, 'host'),
		appId: field(record, 'app-id'),
		startedAt: field(record, 'started-at'),
		lastActiveAt: field(record, 'last-active-at'),
		infobaseId: field(record, 'infobase'),
		connectionId: field(record, 'connection'),
		processId: field(record, 'process'),
		blockedByDbms: !isEmptyRef(field(record, 'blocked-by-dbms')) && field(record, 'blocked-by-dbms') !== '0',
		blockedByLs: !isEmptyRef(field(record, 'blocked-by-ls')) && field(record, 'blocked-by-ls') !== '0',
		hibernate: isRacFlagOn(field(record, 'hibernate')),
		record,
	};
}

/** Разбирает соединение. */
export function toConnectionInfo(record: RacRecord): ConnectionInfo {
	return {
		id: field(record, 'connection'),
		connId: field(record, 'conn-id'),
		host: field(record, 'host'),
		processId: field(record, 'process'),
		infobaseId: field(record, 'infobase'),
		// Поле переименовывалось между версиями платформы: сначала application, позже app-id.
		application: field(record, 'application') || field(record, 'app-id'),
		connectedAt: field(record, 'connected-at'),
		sessionNumber: field(record, 'session-number'),
		record,
	};
}

/**
 * Сравнивает значения, числовые по смыслу.
 *
 * Номера сеансов и соединений rac отдаёт строками, и лексикографический порядок
 * поставил бы 10-й сеанс перед 9-м. Нечисловые значения уходят в конец.
 *
 * @param a - Первое значение
 * @param b - Второе значение
 * @returns Отрицательное, ноль или положительное число
 */
export function compareNumeric(a: string, b: string): number {
	const left = Number(a);
	const right = Number(b);
	const leftValid = Number.isFinite(left) && a.trim() !== '';
	const rightValid = Number.isFinite(right) && b.trim() !== '';
	if (leftValid && rightValid) {
		return left - right;
	}
	if (leftValid !== rightValid) {
		return leftValid ? -1 : 1;
	}
	return a.localeCompare(b, 'ru');
}

/** Упорядочивает информационные базы по имени. */
export function sortInfobases(items: InfobaseInfo[]): InfobaseInfo[] {
	return [...items].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/** Упорядочивает рабочие серверы: центральный первым, далее по имени. */
export function sortServers(items: ServerInfo[]): ServerInfo[] {
	return [...items].sort((a, b) => {
		if (a.using !== b.using) {
			return a.using === 'main' ? -1 : b.using === 'main' ? 1 : 0;
		}
		return (a.name || a.host).localeCompare(b.name || b.host, 'ru');
	});
}

/** Упорядочивает рабочие процессы по компьютеру и порту. */
export function sortProcesses(items: ProcessInfo[]): ProcessInfo[] {
	return [...items].sort(
		(a, b) => a.host.localeCompare(b.host, 'ru') || compareNumeric(a.port, b.port)
	);
}

/** Упорядочивает сеансы по номеру. */
export function sortSessions(items: SessionInfo[]): SessionInfo[] {
	return [...items].sort((a, b) => compareNumeric(a.number, b.number));
}

/** Упорядочивает соединения по номеру. */
export function sortConnections(items: ConnectionInfo[]): ConnectionInfo[] {
	return [...items].sort((a, b) => compareNumeric(a.connId, b.connId));
}

/** Разбирает блокировку. */
export function toLockInfo(record: RacRecord): LockInfo {
	return {
		connectionId: field(record, 'connection'),
		sessionId: field(record, 'session'),
		object: field(record, 'object'),
		locked: field(record, 'locked'),
		descr: field(record, 'descr'),
		record,
	};
}

/**
 * Упорядочивает администраторов по имени.
 *
 * @param items - Администраторы
 * @returns Новый упорядоченный список
 */
export function sortAdmins(items: AdminInfo[]): AdminInfo[] {
	return [...items].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/**
 * Упорядочивает менеджеров: главный первым.
 *
 * @param items - Менеджеры кластера
 * @returns Новый упорядоченный список
 */
export function sortManagers(items: ManagerInfo[]): ManagerInfo[] {
	return [...items].sort((a, b) => {
		if (a.using !== b.using) {
			return a.using === 'main' ? -1 : 1;
		}
		return compareNumeric(a.port, b.port);
	});
}
