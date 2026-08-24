import * as assert from 'node:assert';
import {
	compareNumeric,
	isEmptyRef,
	isRacFlagOn,
	sortConnections,
	sortInfobases,
	sortManagers,
	sortProcesses,
	sortServers,
	sortSessions,
	toConnectionInfo,
	toInfobaseInfo,
	toInfobaseState,
	toManagerInfo,
	toProcessInfo,
	toServerInfo,
	toSessionInfo,
	type ConnectionInfo,
	type InfobaseInfo,
	type ProcessInfo,
	type ServerInfo,
	type SessionInfo,
} from '../../features/clusters/model';
import { parseRacRecord, parseRacRecords } from '../../features/clusters/racOutput';

suite('объекты кластера: признаки', () => {
	test('yes и on означают включённый признак', () => {
		assert.strictEqual(isRacFlagOn('yes'), true);
		assert.strictEqual(isRacFlagOn('on'), true);
		assert.strictEqual(isRacFlagOn(' YES '), true);
		assert.strictEqual(isRacFlagOn('no'), false);
		assert.strictEqual(isRacFlagOn('off'), false);
		assert.strictEqual(isRacFlagOn(''), false);
	});

	test('нулевой идентификатор считается отсутствующей ссылкой', () => {
		assert.strictEqual(isEmptyRef('00000000-0000-0000-0000-000000000000'), true);
		assert.strictEqual(isEmptyRef(''), true);
		assert.strictEqual(isEmptyRef('0e588a25-8354-4d1d-9dd3-f2fa2a1c6b8b'), false);
	});
});

suite('объекты кластера: разбор', () => {
	test('сеанс собирается из полей вывода rac', () => {
		const record = parseRacRecord(
			[
				'session          : 5a0e6f11-7f5d-4a1c-9a2f-1b2c3d4e5f60',
				'session-id       : 12',
				'infobase         : ib-uuid',
				'connection       : conn-uuid',
				'process          : proc-uuid',
				'user-name        : Иванов',
				'host             : WS-12',
				'app-id           : 1CV8C',
				'started-at       : 2024-05-01T10:15:30',
				'last-active-at   : 2024-05-01T11:00:00',
				'hibernate        : no',
				'blocked-by-dbms  : 0',
				'blocked-by-ls    : 0',
			].join('\n')
		);
		assert.ok(record);

		const session = toSessionInfo(record);

		assert.strictEqual(session.number, '12');
		assert.strictEqual(session.userName, 'Иванов');
		assert.strictEqual(session.appId, '1CV8C');
		assert.strictEqual(session.infobaseId, 'ib-uuid');
		assert.strictEqual(session.hibernate, false);
		assert.strictEqual(session.blockedByDbms, false);
		assert.strictEqual(session.blockedByLs, false);
	});

	test('ожидание блокировки СУБД распознаётся по непустому полю', () => {
		const record = parseRacRecord('session : s1\nblocked-by-dbms : 8\nblocked-by-ls : 0');
		assert.ok(record);

		const session = toSessionInfo(record);

		assert.strictEqual(session.blockedByDbms, true);
		assert.strictEqual(session.blockedByLs, false);
	});

	test('рабочий процесс читает состояние и адрес', () => {
		const record = parseRacRecord(
			[
				'process   : proc-uuid',
				'host      : srv-1c',
				'port      : 1562',
				'pid       : 4128',
				'is-enable : yes',
				'running   : yes',
				'connections : 7',
				'memory-size : 2852656',
			].join('\n')
		);
		assert.ok(record);

		const process = toProcessInfo(record);

		assert.strictEqual(process.pid, '4128');
		assert.strictEqual(process.running, true);
		assert.strictEqual(process.enabled, true);
		assert.strictEqual(process.connections, '7');
	});

	test('рабочий сервер читает адрес агента и роль', () => {
		const record = parseRacRecord(
			['server : srv-uuid', 'agent-host : srv-1c', 'agent-port : 1540', 'name : "Центральный"', 'using : main'].join(
				'\n'
			)
		);
		assert.ok(record);

		const server = toServerInfo(record);

		assert.strictEqual(server.host, 'srv-1c');
		assert.strictEqual(server.port, '1540');
		assert.strictEqual(server.name, 'Центральный');
		assert.strictEqual(server.using, 'main');
	});

	test('краткий список баз разбирается целиком', () => {
		const records = parseRacRecords(
			[
				'infobase : ib-1',
				'name     : Бухгалтерия',
				'descr    : "Рабочая база"',
				'',
				'infobase : ib-2',
				'name     : Зарплата',
				'descr    :',
				'',
			].join('\n')
		);

		const infobases = records.map(toInfobaseInfo);

		assert.strictEqual(infobases.length, 2);
		assert.strictEqual(infobases[0].descr, 'Рабочая база');
		assert.strictEqual(infobases[1].descr, '');
	});

	test('режим работы базы читается из полных сведений', () => {
		const state = toInfobaseState({
			'sessions-deny': 'on',
			'scheduled-jobs-deny': 'off',
			'denied-from': '2024-05-01T20:00:00',
			'denied-to': '2024-05-02T08:00:00',
		});

		assert.strictEqual(state.sessionsDeny, true);
		assert.strictEqual(state.scheduledJobsDeny, false);
		assert.strictEqual(state.deniedFrom, '2024-05-01T20:00:00');
		assert.strictEqual(state.deniedTo, '2024-05-02T08:00:00');
	});

	test('база без полей блокировок считается открытой', () => {
		const state = toInfobaseState({ name: 'Бухгалтерия' });

		assert.strictEqual(state.sessionsDeny, false);
		assert.strictEqual(state.scheduledJobsDeny, false);
		assert.strictEqual(state.deniedFrom, '');
		assert.strictEqual(state.deniedTo, '');
	});

	test('соединение читает процесс и номер', () => {
		const record = parseRacRecord(
			[
				'connection : conn-uuid',
				'conn-id : 42',
				'host : WS-12',
				'process : proc-uuid',
				'infobase : ib-uuid',
				'application : JobScheduler',
				'connected-at : 2024-05-01T09:00:00',
				'session-number : 12',
			].join('\n')
		);
		assert.ok(record);

		const connection = toConnectionInfo(record);

		assert.strictEqual(connection.connId, '42');
		assert.strictEqual(connection.processId, 'proc-uuid');
		assert.strictEqual(connection.application, 'JobScheduler');
	});

	test('отсутствующие поля не ломают разбор', () => {
		const session = toSessionInfo({ session: 'only-id' });

		assert.strictEqual(session.id, 'only-id');
		assert.strictEqual(session.userName, '');
		assert.strictEqual(session.number, '');
	});
});

suite('объекты кластера: порядок', () => {
	test('номера сравниваются числом, а не по алфавиту', () => {
		assert.ok(compareNumeric('9', '10') < 0);
		assert.ok(compareNumeric('100', '20') > 0);
		assert.strictEqual(compareNumeric('7', '7'), 0);
	});

	test('нечисловое значение уходит в конец', () => {
		assert.ok(compareNumeric('12', '') < 0);
		assert.ok(compareNumeric('', '12') > 0);
	});

	test('сеансы упорядочены по номеру', () => {
		const sessions = [
			{ number: '10' },
			{ number: '2' },
			{ number: '1' },
		] as SessionInfo[];

		assert.deepStrictEqual(
			sortSessions(sessions).map((session) => session.number),
			['1', '2', '10']
		);
	});

	test('соединения упорядочены по номеру', () => {
		const connections = [{ connId: '11' }, { connId: '3' }] as ConnectionInfo[];

		assert.deepStrictEqual(
			sortConnections(connections).map((item) => item.connId),
			['3', '11']
		);
	});

	test('базы упорядочены по имени', () => {
		const infobases = [{ name: 'Зарплата' }, { name: 'Бухгалтерия' }] as InfobaseInfo[];

		assert.deepStrictEqual(
			sortInfobases(infobases).map((item) => item.name),
			['Бухгалтерия', 'Зарплата']
		);
	});

	test('центральный сервер идёт первым', () => {
		const servers = [
			{ name: 'Рабочий', host: 'srv-2', using: 'normal' },
			{ name: 'Центральный', host: 'srv-1', using: 'main' },
		] as ServerInfo[];

		assert.deepStrictEqual(
			sortServers(servers).map((item) => item.name),
			['Центральный', 'Рабочий']
		);
	});

	test('процессы упорядочены по компьютеру, затем по порту числом', () => {
		const processes = [
			{ host: 'srv-1c', port: '1570' },
			{ host: 'srv-1c', port: '1562' },
			{ host: 'srv-0c', port: '1562' },
		] as ProcessInfo[];

		assert.deepStrictEqual(
			sortProcesses(processes).map((item) => `${item.host}:${item.port}`),
			['srv-0c:1562', 'srv-1c:1562', 'srv-1c:1570']
		);
	});

	test('исходный список не меняется', () => {
		const sessions = [{ number: '2' }, { number: '1' }] as SessionInfo[];

		sortSessions(sessions);

		assert.strictEqual(sessions[0].number, '2');
	});
});

suite('модель кластера: менеджеры', () => {
	test('поля менеджера читаются из вывода', () => {
		const manager = toManagerInfo({
			manager: '62edba84-f3e0-49f9-8231-8943e476b26f',
			pid: '4020',
			using: 'main',
			host: 'legion-johnny',
			port: '1541',
			descr: 'Главный менеджер кластера',
		});

		assert.strictEqual(manager.id, '62edba84-f3e0-49f9-8231-8943e476b26f');
		assert.strictEqual(manager.pid, '4020');
		assert.strictEqual(manager.descr, 'Главный менеджер кластера');
	});

	test('главный менеджер идёт первым, остальные по порту', () => {
		const sorted = sortManagers([
			toManagerInfo({ manager: 'c', using: 'normal', port: '1562' }),
			toManagerInfo({ manager: 'a', using: 'normal', port: '1560' }),
			toManagerInfo({ manager: 'main', using: 'main', port: '1541' }),
		]);

		assert.deepStrictEqual(
			sorted.map((item) => item.id),
			['main', 'a', 'c']
		);
	});
});
