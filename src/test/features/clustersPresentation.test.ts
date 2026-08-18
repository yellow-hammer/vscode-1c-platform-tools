import * as assert from 'node:assert';
import {
	appTitle,
	formatBytes,
	formatRacDateTime,
	infobasePresentation,
	processPresentation,
	sessionPresentation,
} from '../../features/clusters/presentation';
import type { InfobaseInfo, ProcessInfo, SessionInfo } from '../../features/clusters/model';

/** Сеанс с заполненными полями, от которого отталкиваются проверки подписи. */
function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
	return {
		id: 'session-uuid',
		number: '12',
		userName: 'Иванов',
		host: 'WS-12',
		appId: '1CV8C',
		startedAt: '2024-05-01T10:15:30',
		lastActiveAt: '2024-05-01T11:00:00',
		infobaseId: 'ib',
		connectionId: 'conn',
		processId: 'proc',
		blockedByDbms: false,
		blockedByLs: false,
		hibernate: false,
		record: {},
		...overrides,
	};
}

suite('подписи кластера: значения', () => {
	test('идентификатор приложения переводится на русский', () => {
		assert.strictEqual(appTitle('1CV8C'), 'Тонкий клиент');
		assert.strictEqual(appTitle('Designer'), 'Конфигуратор');
		assert.strictEqual(appTitle('BackgroundJob'), 'Фоновое задание');
	});

	test('незнакомое приложение показывается как есть', () => {
		assert.strictEqual(appTitle('SomeNewClient'), 'SomeNewClient');
		assert.strictEqual(appTitle(''), 'Неизвестное приложение');
	});

	test('дата переставляется без сдвига часового пояса', () => {
		assert.strictEqual(formatRacDateTime('2024-05-01T10:15:30'), '01.05.2024 10:15:30');
		assert.strictEqual(formatRacDateTime('2024-12-31T23:59'), '31.12.2024 23:59:00');
	});

	test('нераспознанная дата остаётся неизменной', () => {
		assert.strictEqual(formatRacDateTime(''), '');
		assert.strictEqual(formatRacDateTime('никогда'), 'никогда');
	});

	test('байты переводятся в читаемые единицы', () => {
		assert.strictEqual(formatBytes('0'), '0 Б');
		assert.strictEqual(formatBytes('2048'), '2.0 КБ');
		assert.strictEqual(formatBytes('2852656'), '2.7 МБ');
	});

	test('нечисловое значение объёма остаётся неизменным', () => {
		assert.strictEqual(formatBytes(''), '');
		assert.strictEqual(formatBytes('нет данных'), 'нет данных');
	});
});

suite('подписи кластера: узлы', () => {
	test('сеанс подписан номером и пользователем', () => {
		const presentation = sessionPresentation(session());

		assert.strictEqual(presentation.label, '№ 12 · Иванов');
		assert.ok(presentation.description?.includes('Тонкий клиент'));
		assert.ok(presentation.description?.includes('WS-12'));
	});

	test('сеанс без пользователя не остаётся без подписи', () => {
		const presentation = sessionPresentation(session({ userName: '' }));

		assert.strictEqual(presentation.label, '№ 12 · пользователь не указан');
	});

	test('ожидание блокировки видно в описании', () => {
		const presentation = sessionPresentation(session({ blockedByDbms: true }));

		assert.ok(presentation.description?.includes('ждёт блокировку СУБД'));
	});

	test('спящий сеанс отмечен в описании', () => {
		const presentation = sessionPresentation(session({ hibernate: true }));

		assert.ok(presentation.description?.includes('спящий'));
	});

	test('подсказка сеанса содержит время в читаемом виде', () => {
		const presentation = sessionPresentation(session());

		assert.ok(presentation.tooltip.some((line) => line.includes('01.05.2024 10:15:30')));
	});

	test('процесс подписан адресом, состояние ушло в описание', () => {
		const process: ProcessInfo = {
			id: 'proc',
			host: 'srv-1c',
			port: '1562',
			pid: '4128',
			running: true,
			enabled: true,
			connections: '7',
			memorySize: '2852656',
			record: {},
		};

		const presentation = processPresentation(process);

		assert.strictEqual(presentation.label, 'srv-1c:1562');
		assert.ok(presentation.description?.includes('pid 4128'));
		assert.ok(presentation.description?.includes('работает'));
		assert.ok(presentation.tooltip.some((line) => line.includes('2.7 МБ')));
	});

	test('остановленный процесс так и подписан', () => {
		const presentation = processPresentation({
			id: 'proc',
			host: 'srv-1c',
			port: '1562',
			pid: '',
			running: false,
			enabled: false,
			connections: '',
			memorySize: '',
			record: {},
		});

		assert.ok(presentation.description?.includes('остановлен'));
		assert.ok(presentation.tooltip.some((line) => line.includes('выключен администратором')));
	});

	test('база без описания не получает пустое уточнение', () => {
		const infobase: InfobaseInfo = { id: 'ib', name: 'Бухгалтерия', descr: '', record: {} };

		const presentation = infobasePresentation(infobase);

		assert.strictEqual(presentation.label, 'Бухгалтерия');
		assert.strictEqual(presentation.description, undefined);
	});
});

