import * as assert from 'node:assert';
import {
	decodeRacOutput,
	describeRacFailure,
	formatRacCommandForLog,
	isRacUsageOutput,
	maskRacSecrets,
	parseRacRecord,
	parseRacRecords,
	unquoteRacValue,
} from '../../features/clusters/racOutput';

suite('вывод rac: разбор', () => {
	test('блоки, разделённые пустой строкой, дают отдельные объекты', () => {
		const output = [
			'cluster : 0e588a25-8354-4d1d-9dd3-f2fa2a1c6b8b',
			'host    : srv-1c',
			'port    : 1541',
			'name    : "Локальный кластер"',
			'',
			'cluster : 1f699b36-9465-5e2e-0ee4-03fb3b2d7c9c',
			'host    : srv-2c',
			'port    : 1741',
			'name    : "Тестовый кластер"',
			'',
		].join('\n');

		const records = parseRacRecords(output);

		assert.strictEqual(records.length, 2);
		assert.strictEqual(records[0].cluster, '0e588a25-8354-4d1d-9dd3-f2fa2a1c6b8b');
		assert.strictEqual(records[0].name, 'Локальный кластер');
		assert.strictEqual(records[1].host, 'srv-2c');
		assert.strictEqual(records[1].port, '1741');
	});

	test('значение отрезается по первому двоеточию: дата остаётся целой', () => {
		const record = parseRacRecord('started-at : 2024-05-01T10:15:30');

		assert.strictEqual(record?.['started-at'], '2024-05-01T10:15:30');
	});

	test('перевод строки Windows не мешает разбору', () => {
		const records = parseRacRecords('session : 1\r\nhost : pc\r\n\r\nsession : 2\r\nhost : pc2\r\n');

		assert.strictEqual(records.length, 2);
		assert.strictEqual(records[1].session, '2');
	});

	test('строки, не похожие на поле, игнорируются', () => {
		const records = parseRacRecords(
			'1C:Enterprise 8.3 Remote Administrative Client Utility\nЛишняя строка\ncluster : abc\n'
		);

		assert.deepStrictEqual(records, [{ cluster: 'abc' }]);
	});

	test('пустой вывод даёт пустой список', () => {
		assert.deepStrictEqual(parseRacRecords(''), []);
		assert.deepStrictEqual(parseRacRecords('\n\n   \n'), []);
	});

	test('пустое значение сохраняется как пустая строка', () => {
		const record = parseRacRecord('descr :\nname : База');

		assert.strictEqual(record?.descr, '');
		assert.strictEqual(record?.name, 'База');
	});

	test('кавычки снимаются, удвоенная кавычка восстанавливается', () => {
		assert.strictEqual(unquoteRacValue('"Бухгалтерия"'), 'Бухгалтерия');
		assert.strictEqual(unquoteRacValue('  "с пробелами"  '), 'с пробелами');
		assert.strictEqual(unquoteRacValue('"База ""Копия"""'), 'База "Копия"');
		assert.strictEqual(unquoteRacValue('без кавычек'), 'без кавычек');
		assert.strictEqual(unquoteRacValue('"'), '"');
	});
});

suite('вывод rac: декодирование', () => {
	test('корректный UTF-8 проходит без изменений', () => {
		const text = 'name : Локальный кластер';

		assert.strictEqual(decodeRacOutput(Buffer.from(text, 'utf8')), text);
	});

	test('вывод в кодировке 866 распознаётся и перекодируется', () => {
		// «Лок» в cp866: Л=0x8B, о=0xAE, к=0xAA
		assert.strictEqual(decodeRacOutput(Buffer.from([0x8b, 0xae, 0xaa])), 'Лок');
		// «ряд» из второго участка кириллицы: р=0xE0, я=0xEF, д=0xA4
		assert.strictEqual(decodeRacOutput(Buffer.from([0xe0, 0xef, 0xa4])), 'ряд');
		// Ё и ё стоят отдельно
		assert.strictEqual(decodeRacOutput(Buffer.from([0xf0, 0xf1])), 'Ёё');
	});

	test('латиница и служебные символы сохраняются при перекодировке', () => {
		const buffer = Buffer.from([0x6e, 0x61, 0x6d, 0x65, 0x20, 0x3a, 0x20, 0x8b]);

		assert.strictEqual(decodeRacOutput(buffer), 'name : Л');
	});
});

suite('вывод rac: неудачи', () => {
	test('отказ по аутентификации распознаётся как auth', () => {
		const failure = describeRacFailure(1, '', 'Администрирование кластера не разрешено');

		assert.strictEqual(failure.kind, 'auth');
		assert.ok(failure.message.includes('Администратор не принят'));
	});

	test('формулировка платформы 8.5 «не аутентифицирован» тоже распознаётся', () => {
		const cluster = describeRacFailure(127, '', 'Администратор кластера не аутентифицирован');
		const agent = describeRacFailure(127, '', 'Администратор центрального сервера не аутентифицирован');

		assert.strictEqual(cluster.kind, 'auth');
		assert.strictEqual(agent.kind, 'auth');
		assert.ok(cluster.message.includes('Администратор не принят'));
	});

	test('английская формулировка отказа тоже распознаётся', () => {
		assert.strictEqual(
			describeRacFailure(1, '', 'Cluster administrator is not authenticated').kind,
			'auth'
		);
	});

	test('недоступный сервер администрирования распознаётся как connection', () => {
		const failure = describeRacFailure(1, '', 'Ошибка соединения с сервером: connection refused');

		assert.strictEqual(failure.kind, 'connection');
		assert.ok(failure.message.includes('ras'));
	});

	test('причина берётся и из stdout: rac пишет её то в один поток, то в другой', () => {
		const failure = describeRacFailure(1, 'Кластер не найден', '');

		assert.strictEqual(failure.kind, 'notFound');
		assert.ok(failure.output?.includes('Кластер не найден'));
	});

	test('нераспознанному отказу показывается первая строка, а не весь абзац', () => {
		const failure = describeRacFailure(
			1,
			'',
			'Сбой обработки запроса\nПодробности, до которых читателю строки состояния дела нет'
		);

		assert.strictEqual(failure.message, 'Сбой обработки запроса');
	});

	test('полный вывод сохраняется для журнала', () => {
		const failure = describeRacFailure(1, '', 'Ошибка соединения с сервером\nТаймаут ожидания отклика');

		assert.ok(failure.message.length < 120, 'сообщение пользователю должно быть коротким');
		assert.ok(failure.output?.includes('Таймаут ожидания отклика'));
	});

	test('пустой вывод даёт сообщение с кодом возврата', () => {
		const failure = describeRacFailure(105, '', '');

		assert.strictEqual(failure.kind, 'unknown');
		assert.ok(failure.message.includes('105'));
		assert.strictEqual(failure.output, undefined);
	});
});

suite('вывод rac: справка вместо результата', () => {
	// Незнакомую команду rac ошибкой не считает: печатает справку и завершается
	// с нулевым кодом, из-за чего действие выглядело бы выполненным
	test('шапка справки распознаётся', () => {
		const output = [
			'1C:Enterprise 8.5 Remote Administrative Client Utility © 1C-Soft LLC 1996-2026',
			'Утилита администрирования платформы 1С:Предприятие',
			'',
			'Использование:',
			'',
			'\trac help [options]',
		].join('\n');

		assert.strictEqual(isRacUsageOutput(output), true);
	});

	test('обычный вывод команды справкой не считается', () => {
		assert.strictEqual(isRacUsageOutput('session : abc\nuser-name : DefUser'), false);
		assert.strictEqual(isRacUsageOutput(''), false);
	});
});

suite('вывод rac: журнал', () => {
	test('пароли в журнал не попадают', () => {
		const args = [
			'session',
			'list',
			'--cluster=abc',
			'--cluster-user=admin',
			'--cluster-pwd=очень секретный',
			'srv:1545',
		];

		const masked = maskRacSecrets(args);

		assert.deepStrictEqual(masked, [
			'session',
			'list',
			'--cluster=abc',
			'--cluster-user=admin',
			'--cluster-pwd=***',
			'srv:1545',
		]);
	});

	test('маскируются все парольные опции, включая пароль базы', () => {
		const masked = maskRacSecrets(['--infobase-pwd=x', '--agent-pwd=y', '--db-pwd=z']);

		assert.deepStrictEqual(masked, ['--infobase-pwd=***', '--agent-pwd=***', '--db-pwd=***']);
	});

	test('имя пользователя в журнале остаётся: без него не понять, чей отказ', () => {
		const line = formatRacCommandForLog('/opt/1cv8/x86_64/8.3.27.1936/rac', [
			'cluster',
			'info',
			'--cluster-user=Администратор',
			'--cluster-pwd=secret',
			'srv:1545',
		]);

		assert.ok(line.includes('--cluster-user=Администратор'));
		assert.ok(line.includes('--cluster-pwd=***'));
		assert.ok(!line.includes('secret'));
	});
});
