/**
 * Подписи объектов кластера и текст окна подробностей.
 *
 * Модуль чистый: превращает разобранные объекты в подписи, описания и текст
 * документа. Узлы дерева берут готовые подписи, поэтому формулировки проверяются
 * тестами без запуска VS Code.
 */

import type {
	ClusterConnection,
	ClusterInfo,
	ConnectionInfo,
	InfobaseInfo,
	InfobaseState,
	AdminInfo,
	LockInfo,
	ManagerInfo,
	ProcessInfo,
	ServerInfo,
	SessionInfo,
} from './model';

/** Подпись узла: заголовок и уточнение справа. */
export interface NodePresentation {
	label: string;
	description?: string;
	/** Строки всплывающей подсказки. */
	tooltip: string[];
}

/**
 * Названия приложений, от имени которых работает сеанс.
 *
 * rac отдаёт идентификатор приложения; администратору нужнее человеческое имя,
 * но исходный идентификатор остаётся в подробностях.
 */
const APP_TITLES: Record<string, string> = {
	'1CV8': 'Толстый клиент',
	'1CV8C': 'Тонкий клиент',
	WebClient: 'Веб-клиент',
	Designer: 'Конфигуратор',
	SrvrConsole: 'Консоль кластера',
	COMConnection: 'COM-соединение',
	WSConnection: 'Web-сервис',
	HTTPServiceConnection: 'HTTP-сервис',
	BackgroundJob: 'Фоновое задание',
	JobScheduler: 'Планировщик заданий',
	SystemBackgroundJob: 'Системное фоновое задание',
	Debugger: 'Отладчик',
	RAS: 'Сервер администрирования',
	RAC: 'Клиент администрирования',
};

/**
 * Человеческое название приложения сеанса.
 *
 * @param appId - Идентификатор приложения из вывода rac
 * @returns Название или исходный идентификатор, если он незнаком
 */
export function appTitle(appId: string): string {
	return APP_TITLES[appId] ?? (appId || 'Неизвестное приложение');
}

/**
 * Переводит дату rac в привычный вид.
 *
 * Значение приходит как `2024-05-01T10:15:00` в местном времени сервера.
 * Разбор через Date не нужен: строка переставляется как есть, поэтому часовой
 * пояс машины администратора ничего не сдвигает.
 *
 * @param value - Значение поля даты
 * @returns Дата вида `01.05.2024 10:15:00` или исходная строка
 */
export function formatRacDateTime(value: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
	if (!match) {
		return value;
	}
	const [, year, month, day, hours, minutes, seconds] = match;
	return `${day}.${month}.${year} ${hours}:${minutes}:${seconds ?? '00'}`;
}

/**
 * Дата rac без секунд.
 *
 * В подписи узла важен момент, а не секунда: секунды удлиняют строку и мешают
 * читать список.
 *
 * @param value - Значение поля даты
 * @returns Дата вида `01.05.2024 10:15`
 */
export function formatRacDateTimeShort(value: string): string {
	return formatRacDateTime(value).replace(/(\d{2}:\d{2}):\d{2}$/, '$1');
}

/**
 * Переводит объём в байтах в читаемый вид.
 *
 * @param value - Значение поля в байтах
 * @returns Строка с единицей измерения или исходное значение, если это не число
 */
export function formatBytes(value: string): string {
	const bytes = Number(value);
	if (!Number.isFinite(bytes) || value.trim() === '') {
		return value;
	}
	const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
	let size = Math.abs(bytes);
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit += 1;
	}
	const sign = bytes < 0 ? '-' : '';
	const formatted = unit === 0 ? String(Math.round(size)) : size.toFixed(size < 10 ? 1 : 0);
	return `${sign}${formatted} ${units[unit]}`;
}

/** Подпись подключения к серверу администрирования. */
export function connectionPresentation(connection: ClusterConnection): NodePresentation {
	const address = `${connection.host}:${connection.port}`;
	const tooltip = [connection.name, `Сервер администрирования: ${address}`];
	tooltip.push(
		connection.clusterUser
			? `Администратор кластера: ${connection.clusterUser}`
			: 'Администратор кластера не задан'
	);
	if (connection.platformVersion) {
		tooltip.push(`Версия платформы: ${connection.platformVersion}`);
	}
	return { label: connection.name, description: address, tooltip };
}

/** Подпись кластера. */
export function clusterPresentation(cluster: ClusterInfo): NodePresentation {
	const address = cluster.port ? `${cluster.host}:${cluster.port}` : cluster.host;
	return {
		label: cluster.name || address || 'Кластер',
		description: address,
		tooltip: [cluster.name || 'Кластер', `Центральный сервер: ${address}`, `Идентификатор: ${cluster.id}`],
	};
}

/** Подпись рабочего сервера. */
export function serverPresentation(server: ServerInfo): NodePresentation {
	const address = server.port ? `${server.host}:${server.port}` : server.host;
	const role = server.using === 'main' ? 'центральный' : '';
	return {
		label: server.name || address || 'Рабочий сервер',
		description: [address, role].filter(Boolean).join(' · '),
		tooltip: [
			server.name || 'Рабочий сервер',
			`Агент сервера: ${address}`,
			`Использование: ${server.using === 'main' ? 'центральный сервер' : 'обычный сервер'}`,
			`Идентификатор: ${server.id}`,
		],
	};
}

/** Подпись рабочего процесса. */
export function processPresentation(process: ProcessInfo): NodePresentation {
	const address = process.port ? `${process.host}:${process.port}` : process.host;
	const state = process.running ? 'работает' : 'остановлен';
	const parts = [`pid ${process.pid || 'нет данных'}`, state];
	if (process.connections) {
		parts.push(`соединений: ${process.connections}`);
	}
	return {
		label: address || 'Рабочий процесс',
		description: parts.join(' · '),
		tooltip: [
			`Рабочий процесс ${address}`,
			`Состояние: ${state}${process.enabled ? '' : ', выключен администратором'}`,
			`Идентификатор процесса ОС: ${process.pid || 'нет данных'}`,
			`Памяти занято: ${formatBytes(process.memorySize)}`,
			`Идентификатор: ${process.id}`,
		],
	};
}

/**
 * Срок блокировки сеансов словами.
 *
 * @param state - Режим работы базы
 * @returns Строка вида `с 01.05.2024 10:15 по 02.05.2024 08:00` или пусто
 */
function deniedPeriod(state: InfobaseState): string {
	const from = formatRacDateTimeShort(state.deniedFrom);
	const to = formatRacDateTimeShort(state.deniedTo);
	if (from && to) {
		return `с ${from} по ${to}`;
	}
	if (from) {
		return `с ${from}`;
	}
	return to ? `по ${to}` : '';
}

/**
 * Подпись информационной базы.
 *
 * Справа от имени — только срок блокировки: сам запрет виден значком, а даты
 * значком не покажешь. Словами состояние названо в подсказке, вместе с
 * остальными подробностями.
 *
 * @param infobase - Информационная база
 * @param state - Режим работы базы, если он прочитан
 * @returns Подпись, описание и подсказка узла
 */
export function infobasePresentation(
	infobase: InfobaseInfo,
	state?: InfobaseState
): NodePresentation {
	const marks: string[] = [];
	if (state?.sessionsDeny) {
		marks.push('начало сеансов запрещено');
	}
	if (state?.scheduledJobsDeny) {
		marks.push('регламентные задания запрещены');
	}
	// Срок относится к запрету сеансов: без запрета старые даты в полях базы
	// ничего не значат.
	const period = state?.sessionsDeny ? deniedPeriod(state) : '';
	return {
		label: infobase.name || 'Информационная база',
		description: [infobase.descr, period].filter(Boolean).join(' · ') || undefined,
		tooltip: [
			infobase.name || 'Информационная база',
			...(infobase.descr ? [infobase.descr] : []),
			...marks.map((mark) => `Состояние: ${mark}`),
			...(period ? [`Блокировка ${period}`] : []),
			`Идентификатор: ${infobase.id}`,
		],
	};
}

/** Подпись сеанса. */
export function sessionPresentation(session: SessionInfo): NodePresentation {
	const user = session.userName || 'пользователь не указан';
	const marks: string[] = [];
	if (session.blockedByDbms) {
		marks.push('ждёт блокировку СУБД');
	}
	if (session.blockedByLs) {
		marks.push('ждёт управляемую блокировку');
	}
	if (session.hibernate) {
		marks.push('спящий');
	}
	const description = [appTitle(session.appId), session.host, ...marks].filter(Boolean).join(' · ');
	return {
		label: session.number ? `№ ${session.number} · ${user}` : user,
		description,
		tooltip: [
			`Сеанс № ${session.number || 'нет данных'}`,
			`Пользователь: ${user}`,
			`Приложение: ${appTitle(session.appId)} (${session.appId || 'нет данных'})`,
			`Компьютер: ${session.host || 'нет данных'}`,
			`Начат: ${formatRacDateTime(session.startedAt) || 'нет данных'}`,
			`Последняя активность: ${formatRacDateTime(session.lastActiveAt) || 'нет данных'}`,
			...marks.map((mark) => `Состояние: ${mark}`),
			`Идентификатор: ${session.id}`,
		],
	};
}

/** Подпись соединения. */
export function connectionInfoPresentation(connection: ConnectionInfo): NodePresentation {
	const application = appTitle(connection.application);
	return {
		label: connection.connId ? `№ ${connection.connId} · ${application}` : application,
		description: [connection.host, formatRacDateTime(connection.connectedAt)]
			.filter(Boolean)
			.join(' · '),
		tooltip: [
			`Соединение № ${connection.connId || 'нет данных'}`,
			`Приложение: ${application} (${connection.application || 'нет данных'})`,
			`Компьютер: ${connection.host || 'нет данных'}`,
			`Установлено: ${formatRacDateTime(connection.connectedAt) || 'нет данных'}`,
			`Сеанс: ${connection.sessionNumber || 'нет данных'}`,
			`Идентификатор: ${connection.id}`,
		],
	};
}

/** Подпись администратора. */
export function adminPresentation(admin: AdminInfo): NodePresentation {
	const ways: string[] = [];
	if (admin.auth.includes('pwd')) {
		ways.push('пароль');
	}
	if (admin.auth.includes('os')) {
		ways.push(admin.osUser ? `ОС: ${admin.osUser}` : 'средства ОС');
	}
	return {
		label: admin.name || 'Администратор',
		description: [admin.descr, ways.join(', ')].filter(Boolean).join(' · '),
		tooltip: [
			admin.name || 'Администратор',
			...(admin.descr ? [admin.descr] : []),
			`Аутентификация: ${ways.join(', ') || 'не указана'}`,
		],
	};
}

/** Подпись менеджера кластера. */
export function managerPresentation(manager: ManagerInfo): NodePresentation {
	const main = manager.using === 'main';
	return {
		label: manager.descr || `Менеджер ${manager.host}:${manager.port}`,
		description: [`${manager.host}:${manager.port}`, main ? 'главный' : undefined]
			.filter(Boolean)
			.join(' · '),
		tooltip: [
			manager.descr || 'Менеджер кластера',
			`Адрес: ${manager.host}:${manager.port}`,
			`Процесс ОС: ${manager.pid || 'нет данных'}`,
			main ? 'Главный менеджер кластера' : 'Менеджер сервисов',
		],
	};
}

/** Подпись блокировки. */
export function lockPresentation(lock: LockInfo): NodePresentation {
	return {
		label: lock.descr || 'Блокировка',
		description: formatRacDateTime(lock.locked) || undefined,
		tooltip: [
			lock.descr || 'Блокировка',
			`Установлена: ${formatRacDateTime(lock.locked) || 'нет данных'}`,
			`Соединение: ${lock.connectionId || 'нет данных'}`,
			`Сеанс: ${lock.sessionId || 'нет данных'}`,
			`Объект: ${lock.object || 'нет данных'}`,
		],
	};
}
