import * as assert from 'node:assert';
import {
	CONNECTION_COLUMNS,
	INFOBASE_COLUMNS,
	LOCK_COLUMNS,
	SESSION_COLUMNS,
	activityColumns,
	activityCsv,
	buildActivityRows,
	buildCell,
	filterActivityRows,
	formatMillis,
	sortActivityRows,
	type ActivityColumn,
} from '../../features/clusters/activityTable';

/** Сеанс в том виде, в каком его отдаёт платформа. */
const SESSION = {
	session: '6145cbac-1b69-416d-889d-c0bd382dad1d',
	'session-id': '12',
	infobase: '341e44c9-4724-4355-a18b-9335191377ef',
	process: '1e0f9dee-02e6-4e15-8bba-5b924ef563fe',
	'user-name': 'Иванов',
	host: 'pc-buh',
	'app-id': 'Designer',
	'started-at': '2026-08-17T22:38:27',
	'memory-total': '1893454',
	'duration-all': '2500',
	'calls-all': '110',
};

const NAMES = { '341e44c9-4724-4355-a18b-9335191377ef': 'Бухгалтерия' };

/** Столбец по имени поля. */
function column(key: string): ActivityColumn {
	const found = SESSION_COLUMNS.find((item) => item.key === key);
	assert.ok(found, `столбец ${key} пропал из таблицы`);
	return found;
}

suite('таблица активности: значения', () => {
	test('длительность переводится в понятные единицы', () => {
		assert.strictEqual(formatMillis('0'), '');
		assert.strictEqual(formatMillis('540'), '540 мс');
		assert.strictEqual(formatMillis('2500'), '2.5 с');
		assert.strictEqual(formatMillis('45000'), '45 с');
		assert.strictEqual(formatMillis('90000'), '1 мин 30 с');
		assert.strictEqual(formatMillis('7200000'), '2 ч 0 мин');
	});

	test('нечисловое значение длительности остаётся как есть', () => {
		assert.strictEqual(formatMillis(''), '');
		assert.strictEqual(formatMillis('нет данных'), 'нет данных');
	});

	test('объём показывается человеку, а сортируется по байтам', () => {
		const cell = buildCell(column('memory-total'), SESSION);

		assert.strictEqual(cell.text, '1.8 МБ');
		assert.strictEqual(cell.sort, 1893454);
	});

	test('идентификатор базы заменяется её именем', () => {
		const cell = buildCell(column('infobase'), SESSION, NAMES);

		assert.strictEqual(cell.text, 'Бухгалтерия');
	});

	test('пустая ссылка на базу оставляет ячейку пустой', () => {
		const cell = buildCell(column('infobase'), { infobase: '00000000-0000-0000-0000-000000000000' });

		assert.strictEqual(cell.text, '');
	});

	test('приложение платформы называется по-человечески', () => {
		assert.strictEqual(buildCell(column('app-id'), SESSION).text, 'Конфигуратор');
	});

	test('номер сортируется числом, а не строкой', () => {
		const nine = buildCell(column('session-id'), { 'session-id': '9' });
		const twelve = buildCell(column('session-id'), { 'session-id': '12' });

		assert.ok((nine.sort as number) < (twelve.sort as number));
	});
});

suite('таблица активности: строки', () => {
	test('строка сеанса знает идентификатор, процесс и подпись', () => {
		const [row] = buildActivityRows([SESSION], 'sessions', NAMES);

		assert.strictEqual(row.id, SESSION.session);
		assert.strictEqual(row.processId, SESSION.process);
		assert.strictEqual(row.label, 'сеанс № 12 (Иванов)');
		assert.strictEqual(row.cells.length, SESSION_COLUMNS.length);
	});

	test('строка соединения строится по своим столбцам', () => {
		const [row] = buildActivityRows(
			[{ connection: 'conn-uuid', 'conn-id': '7', process: 'proc-uuid', application: '1CV8C' }],
			'connections'
		);

		assert.strictEqual(row.id, 'conn-uuid');
		// Номер служебных соединений равен нулю, поэтому в подписи есть приложение
		assert.strictEqual(row.label, 'соединение № 7 (Тонкий клиент)');
		assert.strictEqual(row.cells.length, CONNECTION_COLUMNS.length);
	});

	test('сортировка по числовому столбцу идёт по величине', () => {
		const rows = buildActivityRows(
			[
				{ session: 'a', 'session-id': '2', 'memory-total': '900' },
				{ session: 'b', 'session-id': '1', 'memory-total': '1048576' },
			],
			'sessions'
		);
		const memoryIndex = SESSION_COLUMNS.findIndex((item) => item.key === 'memory-total');

		const descending = sortActivityRows(rows, memoryIndex, false);

		assert.strictEqual(descending[0].id, 'b');
	});

	test('отбор ищет по видимому тексту', () => {
		const rows = buildActivityRows(
			[SESSION, { session: 'x', 'session-id': '2', 'user-name': 'Петров' }],
			'sessions',
			NAMES
		);

		assert.strictEqual(filterActivityRows(rows, 'иванов').length, 1);
		assert.strictEqual(filterActivityRows(rows, 'бухгалтерия').length, 1);
		assert.strictEqual(filterActivityRows(rows, '').length, 2);
		assert.strictEqual(filterActivityRows(rows, 'нет такого').length, 0);
	});
});

suite('таблица активности: базы и блокировки', () => {
	test('строка базы собирается из краткого списка и полных сведений', () => {
		const [row] = buildActivityRows(
			[
				{
					infobase: 'ib-uuid',
					name: 'Бухгалтерия',
					'sessions-deny': 'on',
					'scheduled-jobs-deny': 'off',
					dbms: 'PostgreSQL',
				},
			],
			'infobases'
		);

		assert.strictEqual(row.id, 'ib-uuid');
		assert.strictEqual(row.label, 'база «Бухгалтерия»');
		assert.strictEqual(row.cells.length, INFOBASE_COLUMNS.length);
	});

	test('запрет виден словом, а разрешение не пишется вовсе', () => {
		const columns = INFOBASE_COLUMNS.filter((item) => item.kind === 'deny');
		const denied = buildCell(columns[0], { 'sessions-deny': 'on' });
		const allowed = buildCell(columns[0], { 'sessions-deny': 'off' });

		assert.strictEqual(denied.text, 'запрещено');
		assert.strictEqual(allowed.text, '');
		assert.ok((denied.sort as number) > (allowed.sort as number));
	});

	test('база без прочитанных сведений остаётся с пустыми столбцами состояния', () => {
		const [row] = buildActivityRows([{ infobase: 'ib-uuid', name: 'Закрытая' }], 'infobases');
		const denyIndex = INFOBASE_COLUMNS.findIndex((item) => item.key === 'sessions-deny');

		assert.strictEqual(row.cells[denyIndex].text, '');
	});

	test('у блокировки идентификатор складывается из соединения, сеанса и объекта', () => {
		const [row] = buildActivityRows(
			[
				{
					connection: 'conn-uuid',
					session: 'session-uuid',
					object: 'Справочник.Контрагенты',
					descr: 'Ожидание блокировки',
					locked: '2026-08-17T22:38:27',
				},
			],
			'locks'
		);

		assert.strictEqual(row.id, 'conn-uuid:session-uuid:Справочник.Контрагенты');
		assert.strictEqual(row.cells.length, LOCK_COLUMNS.length);
	});

	test('у каждого списка свои столбцы', () => {
		assert.strictEqual(activityColumns('sessions'), SESSION_COLUMNS);
		assert.strictEqual(activityColumns('connections'), CONNECTION_COLUMNS);
		assert.strictEqual(activityColumns('infobases'), INFOBASE_COLUMNS);
		assert.strictEqual(activityColumns('locks'), LOCK_COLUMNS);
	});
});

suite('таблица активности: выгрузка', () => {
	test('CSV начинается с заголовков и содержит строки', () => {
		const rows = buildActivityRows([SESSION], 'sessions', NAMES);

		const csv = activityCsv(SESSION_COLUMNS, rows).split('\n');

		assert.ok(csv[0].startsWith('№;Пользователь;Приложение'));
		assert.ok(csv[1].includes('Иванов'));
		assert.strictEqual(csv.length, 2);
	});

	test('значение с разделителем и кавычками экранируется', () => {
		const rows = buildActivityRows(
			[{ session: 'a', 'session-id': '1', 'user-name': 'Иванов; "старший"' }],
			'sessions'
		);

		const csv = activityCsv(SESSION_COLUMNS, rows);

		assert.ok(csv.includes('"Иванов; ""старший"""'));
	});
});
