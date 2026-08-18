import * as assert from 'node:assert';
import {
	formatCardValue,
	readonlySections,
	toReadonlyValues,
} from '../../features/clusters/objectCards';
import {
	SERVER_SECTIONS,
	buildServerChange,
	toServerForm,
	validateServerForm,
} from '../../features/clusters/serverProperties';

suite('карточки объектов: значения', () => {
	test('объём переводится в понятные единицы, ноль остаётся нулём', () => {
		assert.strictEqual(formatCardValue('192096', 'bytes'), '188 КБ');
		assert.strictEqual(formatCardValue('0', 'bytes'), '0');
	});

	test('флаг платформы становится словом', () => {
		assert.strictEqual(formatCardValue('yes', 'flag'), 'да');
		assert.strictEqual(formatCardValue('0', 'flag'), 'нет');
	});

	test('дата и длительность приводятся к привычному виду', () => {
		assert.strictEqual(formatCardValue('2026-08-18T10:16:01', 'date'), '18.08.2026 10:16:01');
		assert.strictEqual(formatCardValue('2500', 'millis'), '2.5 с');
	});

	test('пустое значение остаётся пустым', () => {
		assert.strictEqual(formatCardValue('', 'bytes'), '');
		assert.strictEqual(formatCardValue('', 'date'), '');
	});
});

suite('карточки объектов: разделы', () => {
	test('все поля карточки только для чтения', () => {
		for (const kind of ['process', 'manager', 'session', 'connection'] as const) {
			for (const section of readonlySections(kind)) {
				assert.ok(
					section.fields.every((field) => field.kind === 'readonly'),
					`${kind}: платформа не даёт менять эти объекты`
				);
			}
		}
	});

	test('сеанс показывает пользователя, приложение и нагрузку', () => {
		const values = toReadonlyValues('session', {
			'session-id': '1',
			'user-name': 'DefUser',
			'app-id': 'Designer',
			'memory-total': '1893454',
			'started-at': '2026-08-17T22:38:27',
		});

		assert.strictEqual(values['user-name'], 'DefUser');
		assert.strictEqual(values['app-id'], 'Конфигуратор');
		assert.strictEqual(values['memory-total'], '1.8 МБ');
		assert.strictEqual(values['started-at'], '17.08.2026 22:38:27');
	});
});

suite('свойства рабочего сервера', () => {
	const RECORD = {
		server: 'srv-uuid',
		name: 'Центральный сервер',
		'agent-host': 'legion-johnny',
		'agent-port': '1540',
		'cluster-port': '1541',
		'port-range': '1560:1591',
		using: 'main',
		'infobases-limit': '8',
		'connections-limit': '256',
		'dedicate-managers': 'none',
		'memory-limit': '0',
		'safe-call-memory-limit': '0',
		'safe-working-processes-memory-limit': '0',
		'critical-total-memory': '0',
		'temporary-allowed-total-memory': '0',
		'temporary-allowed-total-memory-time-limit': '300',
		'service-principal-name': '',
		'restart-schedule': '',
	};

	test('размещение сервера не редактируется', () => {
		const placement = SERVER_SECTIONS[0].fields;

		assert.deepStrictEqual(
			placement.filter((field) => field.kind === 'readonly').map((field) => field.key),
			['name', 'agent-host', 'agent-port', 'cluster-port']
		);
	});

	test('отправляются только изменённые поля', () => {
		const before = toServerForm(RECORD);

		assert.deepStrictEqual(buildServerChange(before, before), {});
		assert.deepStrictEqual(buildServerChange(before, { ...before, 'connections-limit': '128' }), {
			'connections-limit': '128',
		});
	});

	test('диапазон портов проверяется по формату платформы', () => {
		const values = toServerForm(RECORD);

		assert.deepStrictEqual(validateServerForm(values), []);
		assert.deepStrictEqual(validateServerForm({ ...values, 'port-range': '1560:1591, 1600:1610' }), []);
		assert.ok(validateServerForm({ ...values, 'port-range': '1560' })[0].includes('Диапазон портов'));
	});

	test('нечисловое ограничение не принимается', () => {
		const problems = validateServerForm({ ...toServerForm(RECORD), 'connections-limit': 'много' });

		assert.ok(problems[0].includes('Соединений на процесс'));
	});
});
