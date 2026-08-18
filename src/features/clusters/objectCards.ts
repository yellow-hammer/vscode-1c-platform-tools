/**
 * Карточки объектов кластера, которые платформа отдаёт только для чтения:
 * рабочий процесс, менеджер, сеанс и соединение.
 *
 * Менять их нечем — в утилите администрирования у этих объектов нет команды
 * изменения, — но смотреть на них приходится постоянно: кто занял память, чей
 * вызов идёт дольше всех, какой процесс обслуживает сеанс. Поэтому карточка
 * повторяет диалог консоли кластера, а значения приводятся к читаемому виду:
 * байты в мегабайты, метки времени в привычный порядок, длительности в секунды.
 */

import { appTitle, formatBytes, formatRacDateTime } from './presentation';
import { formatMillis } from './activityTable';
import type { RacRecord } from './racOutput';
import type { PropertySection, PropertyValues } from './propertiesForm';

/** Как привести значение поля к читаемому виду. */
type Format = 'text' | 'bytes' | 'millis' | 'date' | 'app' | 'flag' | 'seconds';

/** Поле карточки только для чтения. */
interface ReadonlyField {
	key: string;
	title: string;
	format?: Format;
}

/** Раздел карточки только для чтения. */
interface ReadonlySection {
	title: string;
	fields: ReadonlyField[];
}

/** Рабочий процесс: размещение, состояние и накопленная статистика. */
const PROCESS_FIELDS: ReadonlySection[] = [
	{
		title: 'Рабочий процесс',
		fields: [
			{ key: 'host', title: 'Компьютер' },
			{ key: 'port', title: 'Порт' },
			{ key: 'pid', title: 'Процесс операционной системы' },
			{ key: 'use', title: 'Использование' },
			{ key: 'running', title: 'Активен', format: 'flag' },
			{ key: 'turned-on', title: 'Включён', format: 'flag' },
			{ key: 'started-at', title: 'Запущен', format: 'date' },
		],
	},
	{
		title: 'Нагрузка',
		fields: [
			{ key: 'connections', title: 'Соединений' },
			{ key: 'memory-size', title: 'Занято памяти', format: 'bytes' },
			{ key: 'memory-excess-time', title: 'Превышение памяти', format: 'seconds' },
			{ key: 'available-perfomance', title: 'Доступная производительность' },
			{ key: 'capacity', title: 'Производительность сервера' },
			{ key: 'avg-server-call-time', title: 'Реакция сервера, с' },
			{ key: 'avg-call-time', title: 'Затрачено сервером, с' },
			{ key: 'avg-db-call-time', title: 'Затрачено СУБД, с' },
			{ key: 'avg-lock-call-time', title: 'Затрачено менеджером блокировок, с' },
			{ key: 'selection-size', title: 'Объём выборки', format: 'bytes' },
		],
	},
];

/** Менеджер кластера. */
const MANAGER_FIELDS: ReadonlySection[] = [
	{
		title: 'Менеджер кластера',
		fields: [
			{ key: 'descr', title: 'Описание' },
			{ key: 'host', title: 'Компьютер' },
			{ key: 'port', title: 'Основной порт' },
			{ key: 'pid', title: 'Процесс операционной системы' },
			{ key: 'using', title: 'Назначение' },
		],
	},
];

/** Сеанс: кто работает, чем и через какой процесс. */
const SESSION_FIELDS: ReadonlySection[] = [
	{
		title: 'Сеанс',
		fields: [
			{ key: 'session-id', title: 'Номер сеанса' },
			{ key: 'started-at', title: 'Начало сеанса', format: 'date' },
			{ key: 'last-active-at', title: 'Последнее обращение', format: 'date' },
			{ key: 'hibernate', title: 'Спящий', format: 'flag' },
			{ key: 'passive-session-hibernate-time', title: 'Засыпание через', format: 'seconds' },
			{ key: 'hibernate-session-terminate-time', title: 'Завершение спящего через', format: 'seconds' },
		],
	},
	{
		title: 'Клиентское приложение',
		fields: [
			{ key: 'user-name', title: 'Пользователь' },
			{ key: 'host', title: 'Компьютер' },
			{ key: 'client-ip', title: 'IP клиента' },
			{ key: 'app-id', title: 'Приложение', format: 'app' },
			{ key: 'locale', title: 'Язык интерфейса' },
		],
	},
	{
		title: 'Нагрузка',
		fields: [
			{ key: 'memory-current', title: 'Память за вызов', format: 'bytes' },
			{ key: 'memory-total', title: 'Память всего', format: 'bytes' },
			{ key: 'duration-current', title: 'Текущий вызов', format: 'millis' },
			{ key: 'duration-all', title: 'Время вызовов', format: 'millis' },
			{ key: 'calls-all', title: 'Вызовов' },
			{ key: 'cpu-time-total', title: 'Процессорное время', format: 'millis' },
			{ key: 'dbms-bytes-all', title: 'Объём данных СУБД', format: 'bytes' },
			{ key: 'duration-all-dbms', title: 'Время СУБД', format: 'millis' },
			{ key: 'bytes-all', title: 'Объём обмена', format: 'bytes' },
			{ key: 'read-total', title: 'Чтение с диска', format: 'bytes' },
			{ key: 'write-total', title: 'Запись на диск', format: 'bytes' },
			{ key: 'blocked-by-dbms', title: 'Заблокировано СУБД' },
			{ key: 'blocked-by-ls', title: 'Заблокировано менеджером блокировок' },
		],
	},
];

/** Соединение: чьё оно и сколько потребляет. */
const CONNECTION_FIELDS: ReadonlySection[] = [
	{
		title: 'Соединение',
		fields: [
			{ key: 'conn-id', title: 'Номер соединения' },
			{ key: 'session-number', title: 'Номер сеанса' },
			{ key: 'application', title: 'Приложение', format: 'app' },
			{ key: 'host', title: 'Компьютер' },
			{ key: 'connected-at', title: 'Начало работы', format: 'date' },
			{ key: 'blocked-by-ls', title: 'Заблокировано' },
		],
	},
	{
		title: 'Нагрузка',
		fields: [
			{ key: 'memory-current', title: 'Память текущая', format: 'bytes' },
			{ key: 'memory-total', title: 'Память всего', format: 'bytes' },
			{ key: 'duration-current', title: 'Текущий вызов', format: 'millis' },
			{ key: 'duration-all', title: 'Время вызовов', format: 'millis' },
			{ key: 'calls-all', title: 'Вызовов' },
			{ key: 'bytes-all', title: 'Объём данных', format: 'bytes' },
			{ key: 'dbms-bytes-all', title: 'Объём данных СУБД', format: 'bytes' },
			{ key: 'duration-all-dbms', title: 'Время СУБД', format: 'millis' },
			{ key: 'read-total', title: 'Чтение с диска', format: 'bytes' },
			{ key: 'write-total', title: 'Запись на диск', format: 'bytes' },
		],
	},
];

/** Какие объекты умеют показывать карточку только для чтения. */
export type ReadonlyCardKind = 'process' | 'manager' | 'session' | 'connection';

/** Описания карточек по видам объектов. */
const CARDS: Record<ReadonlyCardKind, ReadonlySection[]> = {
	process: PROCESS_FIELDS,
	manager: MANAGER_FIELDS,
	session: SESSION_FIELDS,
	connection: CONNECTION_FIELDS,
};

/**
 * Приводит значение поля к читаемому виду.
 *
 * @param value - Значение из вывода rac
 * @param format - Как показывать
 * @returns Готовая строка
 */
export function formatCardValue(value: string, format: Format = 'text'): string {
	if (value === '') {
		return '';
	}
	switch (format) {
		case 'bytes':
			return value === '0' ? '0' : formatBytes(value);
		case 'millis':
			return formatMillis(value);
		case 'date':
			return formatRacDateTime(value);
		case 'app':
			return appTitle(value);
		case 'flag':
			return value === 'yes' || value === 'on' || value === '1' ? 'да' : 'нет';
		case 'seconds':
			return value === '0' ? '' : `${value} с`;
		default:
			return value;
	}
}

/**
 * Разделы карточки объекта.
 *
 * @param kind - Вид объекта
 * @returns Разделы для карточки свойств
 */
export function readonlySections(kind: ReadonlyCardKind): PropertySection[] {
	return CARDS[kind].map((section) => ({
		title: section.title,
		fields: section.fields.map((field) => ({
			key: field.key,
			title: field.title,
			kind: 'readonly' as const,
		})),
	}));
}

/**
 * Готовит значения карточки, приводя их к читаемому виду.
 *
 * @param kind - Вид объекта
 * @param record - Поля объекта из вывода rac
 * @returns Значения карточки
 */
export function toReadonlyValues(kind: ReadonlyCardKind, record: RacRecord): PropertyValues {
	const values: PropertyValues = {};
	for (const section of CARDS[kind]) {
		for (const field of section.fields) {
			values[field.key] = formatCardValue(record[field.key] ?? '', field.format);
		}
	}
	return values;
}
