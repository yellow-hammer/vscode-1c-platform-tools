/**
 * Сборка аргументов командной строки rac.
 *
 * Синтаксис утилиты: `rac [<адрес>] <режим> [<команда>] [<опции>]`. Адрес сервера
 * администрирования — позиционный аргумент; расширение ставит его первым и всегда
 * указывает явно: при отсутствии адреса rac подставит `localhost:1545`, а
 * подключений в дереве несколько, и умолчание увело бы вызов не туда.
 *
 * Модуль чистый: строит массивы аргументов, ничего не запускает. Аргументы
 * передаются процессу списком, без оболочки, поэтому кавычки и экранирование
 * здесь не нужны — значения с пробелами (имя базы, сообщение блокировки)
 * доезжают как есть.
 */

/** Учётные данные администратора: кластера, агента или информационной базы. */
export interface RacCredentials {
	/** Имя администратора; пусто — вызов без аутентификации. */
	user?: string;
	/** Пароль администратора. */
	password?: string;
}

/** Общая часть вызова: адрес RAS и администраторы. */
export interface RacScope {
	/** Адрес сервера администрирования, `host:port`. */
	address: string;
	/** Администратор кластера: нужен всему, что внутри кластера. */
	cluster?: RacCredentials;
	/** Администратор центрального сервера: нужен правке самого кластера. */
	agent?: RacCredentials;
}

/** Вызов в пределах одного кластера. */
export interface ClusterScope extends RacScope {
	/** Идентификатор кластера. */
	clusterId: string;
}

/**
 * Собирает адрес сервера администрирования.
 *
 * @param host - Имя или адрес компьютера с ras
 * @param port - Порт ras
 * @returns Адрес вида `host:port`
 */
export function racAddress(host: string, port: number): string {
	return `${host}:${port}`;
}

/**
 * Превращает учётные данные в опции rac.
 *
 * Пустое имя означает вызов без аутентификации: опции не добавляются вовсе.
 * Пустой пароль при заданном имени — допустимая ситуация (администратор без
 * пароля), поэтому `--<prefix>-pwd=` уходит с пустым значением.
 *
 * @param prefix - Префикс опций: `cluster`, `agent` или `infobase`
 * @param credentials - Учётные данные
 * @returns Опции rac (возможно, пустой список)
 */
export function credentialOptions(
	prefix: 'cluster' | 'agent' | 'infobase',
	credentials?: RacCredentials
): string[] {
	const user = credentials?.user?.trim();
	if (!user) {
		return [];
	}
	return [`--${prefix}-user=${user}`, `--${prefix}-pwd=${credentials?.password ?? ''}`];
}

/**
 * Собирает вызов: адрес, режим и команда, затем опции.
 *
 * @param mode - Режим rac (`cluster`, `session`, …)
 * @param command - Команда режима (`list`, `info`, `terminate`, …)
 * @param options - Опции вызова
 * @param address - Адрес сервера администрирования
 * @returns Аргументы командной строки
 */
function compose(mode: string, command: string[], options: string[], address: string): string[] {
	return [address, mode, ...command, ...options];
}

/**
 * Форматирует дату для опций блокировки сеансов.
 *
 * Платформа ждёт местное время без часового пояса: `ГГГГ-ММ-ДДTчч:мм:сс`.
 * Приведение к UTC сдвинуло бы интервал блокировки.
 *
 * @param date - Дата и время
 * @returns Строка для `--denied-from` / `--denied-to`
 */
export function formatRacDate(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
	);
}


/** Список кластеров сервера администрирования. */
export function buildClusterListArgs(scope: RacScope): string[] {
	return compose('cluster', ['list'], [], scope.address);
}

/**
 * Информация о кластере.
 *
 * Администратор кластера здесь не передаётся: сведения о кластере утилита
 * отдаёт на уровне агента, и опций аутентификации у этой команды нет — лишние
 * опции вызов отклонят.
 */
export function buildClusterInfoArgs(scope: ClusterScope): string[] {
	return compose('cluster', ['info'], [`--cluster=${scope.clusterId}`], scope.address);
}

/** Список рабочих серверов кластера. */
export function buildServerListArgs(scope: ClusterScope): string[] {
	return compose(
		'server',
		['list'],
		[`--cluster=${scope.clusterId}`, ...credentialOptions('cluster', scope.cluster)],
		scope.address
	);
}

/** Информация о рабочем сервере. */
export function buildServerInfoArgs(scope: ClusterScope & { serverId: string }): string[] {
	return compose(
		'server',
		['info'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			`--server=${scope.serverId}`,
		],
		scope.address
	);
}

/** Список рабочих процессов кластера или одного сервера. */
export function buildProcessListArgs(scope: ClusterScope & { serverId?: string }): string[] {
	return compose(
		'process',
		['list'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			...(scope.serverId ? [`--server=${scope.serverId}`] : []),
		],
		scope.address
	);
}

/** Информация о рабочем процессе. */
export function buildProcessInfoArgs(scope: ClusterScope & { processId: string }): string[] {
	return compose(
		'process',
		['info'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			`--process=${scope.processId}`,
		],
		scope.address
	);
}

/**
 * Краткий список информационных баз.
 *
 * Краткий список (`infobase summary list`) отдаёт имя и описание без пароля
 * администратора базы — полная `infobase info` его требует. Поэтому дерево
 * строится по краткому списку, а подробности запрашиваются по требованию.
 */
export function buildInfobaseListArgs(scope: ClusterScope): string[] {
	return compose(
		'infobase',
		['summary', 'list'],
		[`--cluster=${scope.clusterId}`, ...credentialOptions('cluster', scope.cluster)],
		scope.address
	);
}

/** Полная информация об информационной базе. */
export function buildInfobaseInfoArgs(
	scope: ClusterScope & { infobaseId: string; infobase?: RacCredentials }
): string[] {
	return compose(
		'infobase',
		['info'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			`--infobase=${scope.infobaseId}`,
			...credentialOptions('infobase', scope.infobase),
		],
		scope.address
	);
}

/** Изменение параметров информационной базы: блокировки сеансов и заданий. */
export interface InfobaseUpdate {
	/** Режим блокировки начала сеансов. */
	sessionsDeny?: boolean;
	/** Блокировка выполнения регламентных заданий. */
	scheduledJobsDeny?: boolean;
	/** Сообщение при попытке нарушения блокировки. */
	deniedMessage?: string;
	/** Код разрешения, позволяющий начать сеанс вопреки блокировке. */
	permissionCode?: string;
	/** Начало интервала блокировки. */
	deniedFrom?: string;
	/** Конец интервала блокировки. */
	deniedTo?: string;
	/** Выдача лицензий сервером. */
	licenseDistribution?: 'allow' | 'deny';
	/** Описание базы. */
	descr?: string;
	/** Профиль безопасности. */
	securityProfile?: string;
	/** Профиль безопасности внешнего кода. */
	safeModeSecurityProfile?: string;
}

/**
 * Обновление информационной базы.
 *
 * Передаются только заданные поля: rac трактует опцию с пустым значением как
 * присвоение пустого значения, и лишний `--denied-message=` стёр бы сообщение,
 * заданное ранее администратором.
 */
export function buildInfobaseUpdateArgs(
	scope: ClusterScope & {
		infobaseId: string;
		infobase?: RacCredentials;
		update: InfobaseUpdate;
	}
): string[] {
	const { update } = scope;
	const options: string[] = [
		`--cluster=${scope.clusterId}`,
		...credentialOptions('cluster', scope.cluster),
		`--infobase=${scope.infobaseId}`,
		...credentialOptions('infobase', scope.infobase),
	];
	if (update.sessionsDeny !== undefined) {
		options.push(`--sessions-deny=${update.sessionsDeny ? 'on' : 'off'}`);
	}
	if (update.scheduledJobsDeny !== undefined) {
		options.push(`--scheduled-jobs-deny=${update.scheduledJobsDeny ? 'on' : 'off'}`);
	}
	if (update.deniedMessage !== undefined) {
		options.push(`--denied-message=${update.deniedMessage}`);
	}
	if (update.permissionCode !== undefined) {
		options.push(`--permission-code=${update.permissionCode}`);
	}
	if (update.deniedFrom !== undefined) {
		options.push(`--denied-from=${update.deniedFrom}`);
	}
	if (update.deniedTo !== undefined) {
		options.push(`--denied-to=${update.deniedTo}`);
	}
	if (update.licenseDistribution !== undefined) {
		options.push(`--license-distribution=${update.licenseDistribution}`);
	}
	if (update.descr !== undefined) {
		options.push(`--descr=${update.descr}`);
	}
	if (update.securityProfile !== undefined) {
		options.push(`--security-profile-name=${update.securityProfile}`);
	}
	if (update.safeModeSecurityProfile !== undefined) {
		options.push(`--safe-mode-security-profile-name=${update.safeModeSecurityProfile}`);
	}
	return compose('infobase', ['update'], options, scope.address);
}

/** Список сеансов кластера или одной информационной базы. */
export function buildSessionListArgs(scope: ClusterScope & { infobaseId?: string }): string[] {
	return compose(
		'session',
		['list'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			...(scope.infobaseId ? [`--infobase=${scope.infobaseId}`] : []),
		],
		scope.address
	);
}

/** Информация о сеансе. */
export function buildSessionInfoArgs(scope: ClusterScope & { sessionId: string }): string[] {
	return compose(
		'session',
		['info'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			`--session=${scope.sessionId}`,
		],
		scope.address
	);
}

/**
 * Принудительное завершение сеанса.
 *
 * Сообщение пользователю появилось в платформе позже самой команды, поэтому
 * опция уходит только когда текст задан: на старой версии лишняя опция
 * завалила бы разбор параметров.
 */
export function buildSessionTerminateArgs(
	scope: ClusterScope & { sessionId: string; errorMessage?: string }
): string[] {
	return compose(
		'session',
		['terminate'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			`--session=${scope.sessionId}`,
			...(scope.errorMessage ? [`--error-message=${scope.errorMessage}`] : []),
		],
		scope.address
	);
}

/**
 * Прерывание текущего серверного вызова сеанса.
 *
 * Мягче завершения: сеанс остаётся, обрывается только затянувшийся вызов —
 * зависший отчёт или обработка. Команда есть не во всех версиях платформы.
 */
export function buildSessionInterruptArgs(
	scope: ClusterScope & { sessionId: string; errorMessage?: string }
): string[] {
	return compose(
		'session',
		['interrupt-current-server-call'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			`--session=${scope.sessionId}`,
			...(scope.errorMessage ? [`--error-message=${scope.errorMessage}`] : []),
		],
		scope.address
	);
}

/**
 * Выключение рабочего процесса.
 *
 * Процесс перестаёт принимать новые соединения и завершается, когда отпустит
 * текущие; кластер поднимает замену. Команда есть не во всех версиях платформы.
 */
export function buildProcessTurnOffArgs(scope: ClusterScope & { processId: string }): string[] {
	return compose(
		'process',
		['turn-off'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			`--process=${scope.processId}`,
		],
		scope.address
	);
}

/** Список соединений: всех, либо процесса, либо информационной базы. */
export function buildConnectionListArgs(
	scope: ClusterScope & {
		processId?: string;
		infobaseId?: string;
		infobase?: RacCredentials;
	}
): string[] {
	return compose(
		'connection',
		['list'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			...(scope.processId ? [`--process=${scope.processId}`] : []),
			...(scope.infobaseId ? [`--infobase=${scope.infobaseId}`] : []),
			...credentialOptions('infobase', scope.infobase),
		],
		scope.address
	);
}

/**
 * Разрыв соединения.
 *
 * Процесс обязателен: соединение живёт в рабочем процессе, и rac без
 * `--process` вызов отклонит.
 */
export function buildConnectionDisconnectArgs(
	scope: ClusterScope & {
		processId: string;
		connectionId: string;
		infobase?: RacCredentials;
	}
): string[] {
	return compose(
		'connection',
		['disconnect'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			`--process=${scope.processId}`,
			`--connection=${scope.connectionId}`,
			...credentialOptions('infobase', scope.infobase),
		],
		scope.address
	);
}

/** Список блокировок кластера или одной информационной базы. */
export function buildLockListArgs(scope: ClusterScope & { infobaseId?: string }): string[] {
	return compose(
		'lock',
		['list'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			...(scope.infobaseId ? [`--infobase=${scope.infobaseId}`] : []),
		],
		scope.address
	);
}

/**
 * Правка параметров рабочего сервера.
 *
 * Ключ — имя опции rac без ведущих дефисов: полей у сервера полтора десятка, и
 * перечислять их по одному значило бы повторять справку платформы.
 */
export function buildServerUpdateArgs(
	scope: ClusterScope & { serverId: string; update: Record<string, string> }
): string[] {
	return compose(
		'server',
		['update'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			`--server=${scope.serverId}`,
			...Object.entries(scope.update).map(([key, value]) => `--${key}=${value}`),
		],
		scope.address
	);
}

/** Сведения о соединении. */
export function buildConnectionInfoArgs(scope: ClusterScope & { connectionId: string }): string[] {
	return compose(
		'connection',
		['info'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			`--connection=${scope.connectionId}`,
		],
		scope.address
	);
}

/** Сведения о менеджере кластера. */
export function buildManagerInfoArgs(scope: ClusterScope & { managerId: string }): string[] {
	return compose(
		'manager',
		['info'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			`--manager=${scope.managerId}`,
		],
		scope.address
	);
}

/** Список менеджеров кластера. */
export function buildManagerListArgs(scope: ClusterScope): string[] {
	return compose(
		'manager',
		['list'],
		[`--cluster=${scope.clusterId}`, ...credentialOptions('cluster', scope.cluster)],
		scope.address
	);
}

/**
 * Изменение параметров кластера.
 *
 * Ключ — имя опции rac без дефисов в начале, значение — то, что уходит после
 * знака равенства. Полей у кластера полтора десятка, и перечислять их по одному
 * значило бы дублировать справку платформы: карточка свойств и так знает, какие
 * поля показывает, а какие только читает.
 */
export type ClusterUpdate = Record<string, string>;

/**
 * Правка параметров кластера.
 *
 * Требует администратора центрального сервера: сам кластер — объект уровня
 * агента, и администратор кластера его свойства менять не вправе.
 */
export function buildClusterUpdateArgs(
	scope: RacScope & { clusterId: string; update: ClusterUpdate }
): string[] {
	const options = [
		`--cluster=${scope.clusterId}`,
		...Object.entries(scope.update).map(([key, value]) => `--${key}=${value}`),
		...credentialOptions('agent', scope.agent),
	];
	return compose('cluster', ['update'], options, scope.address);
}

/** Версия агента кластера: вызов без кластера и без аутентификации. */
export function buildAgentVersionArgs(scope: RacScope): string[] {
	return compose('agent', ['version'], [], scope.address);
}

/** Список администраторов кластера. */
export function buildClusterAdminListArgs(scope: ClusterScope): string[] {
	return compose(
		'cluster',
		['admin', 'list'],
		[`--cluster=${scope.clusterId}`, ...credentialOptions('cluster', scope.cluster)],
		scope.address
	);
}

/** Список администраторов центрального сервера. */
export function buildAgentAdminListArgs(scope: RacScope): string[] {
	return compose('agent', ['admin', 'list'], credentialOptions('agent', scope.agent), scope.address);
}

/** Новый администратор: пароль обязателен только при парольной аутентификации. */
export interface AdminRegistration {
	name: string;
	password?: string;
	descr?: string;
	/** Способ аутентификации: пароль, средства ОС или оба. */
	auth: 'pwd' | 'os' | 'pwd,os';
	/** Пользователь операционной системы для аутентификации средствами ОС. */
	osUser?: string;
}

/**
 * Собирает опции нового администратора.
 *
 * @param registration - Данные администратора
 * @returns Опции rac
 */
function adminOptions(registration: AdminRegistration): string[] {
	const options = [`--name=${registration.name}`, `--auth=${registration.auth}`];
	if (registration.password !== undefined) {
		options.push(`--pwd=${registration.password}`);
	}
	if (registration.descr) {
		options.push(`--descr=${registration.descr}`);
	}
	if (registration.osUser) {
		options.push(`--os-user=${registration.osUser}`);
	}
	return options;
}

/**
 * Добавление администратора кластера.
 *
 * Кроме администратора кластера требует администратора центрального сервера:
 * список администраторов кластера хранит агент.
 */
export function buildClusterAdminRegisterArgs(
	scope: ClusterScope & { registration: AdminRegistration }
): string[] {
	return compose(
		'cluster',
		['admin', 'register'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			...adminOptions(scope.registration),
			...credentialOptions('agent', scope.agent),
		],
		scope.address
	);
}

/** Удаление администратора кластера. */
export function buildClusterAdminRemoveArgs(scope: ClusterScope & { name: string }): string[] {
	return compose(
		'cluster',
		['admin', 'remove'],
		[
			`--cluster=${scope.clusterId}`,
			...credentialOptions('cluster', scope.cluster),
			`--name=${scope.name}`,
		],
		scope.address
	);
}

/** Добавление администратора центрального сервера. */
export function buildAgentAdminRegisterArgs(
	scope: RacScope & { registration: AdminRegistration }
): string[] {
	return compose(
		'agent',
		['admin', 'register'],
		[...adminOptions(scope.registration), ...credentialOptions('agent', scope.agent)],
		scope.address
	);
}

/** Удаление администратора центрального сервера. */
export function buildAgentAdminRemoveArgs(scope: RacScope & { name: string }): string[] {
	return compose(
		'agent',
		['admin', 'remove'],
		[`--name=${scope.name}`, ...credentialOptions('agent', scope.agent)],
		scope.address
	);
}
