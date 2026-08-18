/**
 * Таблица активности кластера: сеансы и соединения списком со столбцами.
 *
 * Дерево отвечает на вопрос «что где устроено», а таблица — на вопрос «кто
 * сейчас мешает»: сеансы сортируются по памяти, длительности вызова или
 * обращениям к СУБД, и виновник виден сразу. Поэтому здесь не подписи узлов, а
 * столбцы с числами, которые можно сравнивать между собой.
 *
 * Модуль чистый: набор столбцов, приведение значений, сортировка, отбор и
 * выгрузка. Ни webview, ни rac — всё это проверяется тестами.
 */

import { appTitle, formatBytes, formatRacDateTime } from './presentation';
import type { RacRecord } from './racOutput';

/** Как показывать и сравнивать значение столбца. */
export type ColumnKind = 'text' | 'number' | 'bytes' | 'millis' | 'date' | 'app' | 'infobase';

/** Столбец таблицы активности. */
export interface ActivityColumn {
	/** Имя поля в выводе rac. */
	key: string;
	/** Заголовок столбца. */
	title: string;
	/** Тип значения. */
	kind: ColumnKind;
}

/** Что показывает таблица. */
export type ActivityKind = 'sessions' | 'connections';

/** Ячейка: что показать и по чему сортировать. */
export interface ActivityCell {
	text: string;
	sort: string | number;
}

/** Строка таблицы. */
export interface ActivityRow {
	/** Идентификатор объекта: сеанса или соединения. */
	id: string;
	/** Рабочий процесс — нужен для разрыва соединения. */
	processId: string;
	/** Короткая подпись для подтверждений и сообщений. */
	label: string;
	/** Значения по столбцам. */
	cells: ActivityCell[];
}

/**
 * Столбцы сеансов.
 *
 * Порядок продуман под чтение слева направо: сначала «кто это», затем «сколько
 * потребляет». Метрики берутся из `session list` — платформа отдаёт их сразу,
 * без дополнительных вызовов на каждую строку.
 */
export const SESSION_COLUMNS: ActivityColumn[] = [
	{ key: 'session-id', title: '№', kind: 'number' },
	{ key: 'user-name', title: 'Пользователь', kind: 'text' },
	{ key: 'app-id', title: 'Приложение', kind: 'app' },
	{ key: 'host', title: 'Компьютер', kind: 'text' },
	{ key: 'infobase', title: 'База', kind: 'infobase' },
	{ key: 'started-at', title: 'Начат', kind: 'date' },
	{ key: 'last-active-at', title: 'Активность', kind: 'date' },
	{ key: 'memory-current', title: 'Память, вызов', kind: 'bytes' },
	{ key: 'memory-total', title: 'Память, всего', kind: 'bytes' },
	{ key: 'duration-current', title: 'Тек. вызов', kind: 'millis' },
	{ key: 'duration-all', title: 'Вызовы, время', kind: 'millis' },
	{ key: 'calls-all', title: 'Вызовы', kind: 'number' },
	{ key: 'cpu-time-total', title: 'Процессор', kind: 'millis' },
	{ key: 'dbms-bytes-all', title: 'СУБД, объём', kind: 'bytes' },
	{ key: 'duration-all-dbms', title: 'СУБД, время', kind: 'millis' },
	{ key: 'bytes-all', title: 'Обмен', kind: 'bytes' },
];

/**
 * Столбцы соединений.
 *
 * Список соединений платформа отдаёт короче списка сеансов: подробные метрики
 * лежат в карточке соединения, поэтому здесь только то, что есть у всех.
 */
export const CONNECTION_COLUMNS: ActivityColumn[] = [
	{ key: 'conn-id', title: '№', kind: 'number' },
	{ key: 'session-number', title: 'Сеанс', kind: 'number' },
	{ key: 'application', title: 'Приложение', kind: 'app' },
	{ key: 'host', title: 'Компьютер', kind: 'text' },
	{ key: 'infobase', title: 'База', kind: 'infobase' },
	{ key: 'connected-at', title: 'Установлено', kind: 'date' },
	{ key: 'blocked-by-ls', title: 'Ждёт блокировку', kind: 'number' },
];

/** Пустой идентификатор: rac помечает им отсутствующую ссылку. */
const EMPTY_REF = '00000000-0000-0000-0000-000000000000';

/**
 * Приводит длительность платформы к читаемому виду.
 *
 * Платформа считает в миллисекундах, но администратору важен порядок величины:
 * «2,5 с» понятнее, чем «2500».
 *
 * @param value - Значение поля
 * @returns Читаемая длительность
 */
export function formatMillis(value: string): string {
	const millis = Number(value);
	if (!Number.isFinite(millis) || value.trim() === '') {
		return value;
	}
	if (millis === 0) {
		return '';
	}
	if (millis < 1000) {
		return `${millis} мс`;
	}
	const seconds = millis / 1000;
	if (seconds < 60) {
		return `${seconds.toFixed(seconds < 10 ? 1 : 0)} с`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes} мин ${Math.round(seconds % 60)} с`;
	}
	return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

/**
 * Готовит ячейку столбца.
 *
 * Показ и сортировка разведены: «1,2 ГБ» читается человеком, а сортируется по
 * числу байт, иначе порядок строк определяла бы первая цифра.
 *
 * @param column - Столбец
 * @param record - Объект вывода rac
 * @param infobaseNames - Имена баз по идентификаторам
 * @returns Ячейка таблицы
 */
export function buildCell(
	column: ActivityColumn,
	record: RacRecord,
	infobaseNames: Record<string, string> = {}
): ActivityCell {
	const raw = record[column.key] ?? '';
	switch (column.kind) {
		case 'number': {
			const value = Number(raw);
			return { text: raw, sort: Number.isFinite(value) ? value : -1 };
		}
		case 'bytes':
			return { text: raw === '' || raw === '0' ? '' : formatBytes(raw), sort: Number(raw) || 0 };
		case 'millis':
			return { text: formatMillis(raw), sort: Number(raw) || 0 };
		case 'date':
			return { text: formatRacDateTime(raw), sort: raw };
		case 'app':
			return { text: appTitle(raw), sort: appTitle(raw) };
		case 'infobase': {
			if (raw === '' || raw === EMPTY_REF) {
				return { text: '', sort: '' };
			}
			const name = infobaseNames[raw] ?? raw;
			return { text: name, sort: name };
		}
		default:
			return { text: raw, sort: raw };
	}
}

/**
 * Собирает строки таблицы.
 *
 * @param records - Объекты вывода rac
 * @param kind - Что показываем: сеансы или соединения
 * @param infobaseNames - Имена баз по идентификаторам
 * @returns Строки таблицы
 */
export function buildActivityRows(
	records: RacRecord[],
	kind: ActivityKind,
	infobaseNames: Record<string, string> = {}
): ActivityRow[] {
	const columns = kind === 'sessions' ? SESSION_COLUMNS : CONNECTION_COLUMNS;
	return records.map((record) => ({
		id: record[kind === 'sessions' ? 'session' : 'connection'] ?? '',
		processId: record.process ?? '',
		label: kind === 'sessions' ? sessionLabel(record) : connectionLabel(record),
		cells: columns.map((column) => buildCell(column, record, infobaseNames)),
	}));
}

/**
 * Подпись сеанса для подтверждений.
 *
 * @param record - Объект вывода rac
 * @returns Короткая подпись
 */
function sessionLabel(record: RacRecord): string {
	const user = record['user-name'];
	return `сеанс № ${record['session-id'] ?? '?'}${user ? ` (${user})` : ''}`;
}

/**
 * Подпись соединения для подтверждений.
 *
 * Номер соединения у служебных соединений равен нулю, поэтому одного номера
 * мало: в подтверждении администратор должен понимать, что именно рвёт.
 *
 * @param record - Объект вывода rac
 * @returns Короткая подпись
 */
function connectionLabel(record: RacRecord): string {
	const application = appTitle(record.application ?? '');
	const number = record['conn-id'] ?? '?';
	return application ? `соединение № ${number} (${application})` : `соединение № ${number}`;
}

/**
 * Сортирует строки по столбцу.
 *
 * @param rows - Строки таблицы
 * @param index - Номер столбца
 * @param ascending - По возрастанию
 * @returns Новый отсортированный список
 */
export function sortActivityRows(
	rows: ActivityRow[],
	index: number,
	ascending: boolean
): ActivityRow[] {
	const sorted = [...rows].sort((a, b) => {
		const left = a.cells[index]?.sort ?? '';
		const right = b.cells[index]?.sort ?? '';
		if (typeof left === 'number' && typeof right === 'number') {
			return left - right;
		}
		return String(left).localeCompare(String(right), 'ru');
	});
	return ascending ? sorted : sorted.reverse();
}

/**
 * Отбирает строки по подстроке.
 *
 * Ищем по показанному тексту: пользователь набирает то, что видит, — имя
 * пользователя, компьютер или базу.
 *
 * @param rows - Строки таблицы
 * @param query - Строка поиска
 * @returns Подходящие строки
 */
export function filterActivityRows(rows: ActivityRow[], query: string): ActivityRow[] {
	const needle = query.trim().toLowerCase();
	if (needle === '') {
		return rows;
	}
	return rows.filter((row) =>
		row.cells.some((cell) => cell.text.toLowerCase().includes(needle))
	);
}

/**
 * Выгружает таблицу в CSV.
 *
 * Разделитель — точка с запятой: с ним таблицу открывает Excel с русскими
 * региональными настройками, а запятая внутри чисел не ломает разбор.
 *
 * @param columns - Столбцы
 * @param rows - Строки (уже отобранные и отсортированные)
 * @returns Текст CSV
 */
export function activityCsv(columns: ActivityColumn[], rows: ActivityRow[]): string {
	const escape = (value: string): string =>
		/[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
	const header = columns.map((column) => escape(column.title)).join(';');
	const body = rows.map((row) => row.cells.map((cell) => escape(cell.text)).join(';'));
	return [header, ...body].join('\n');
}
