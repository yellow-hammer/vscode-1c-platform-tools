import * as assert from 'node:assert';
import {
	CLUSTER_SECTIONS,
	buildClusterChange,
	toClusterForm,
	validateClusterForm,
} from '../../features/clusters/clusterProperties';
import { changedValues, toPropertyValues } from '../../features/clusters/propertiesForm';
import { unappliedFields } from '../../features/clusters/propertiesPanel';

/** Ответ платформы 8.5 на `cluster info`. */
const RECORD = {
	cluster: 'f793f20c-f2a1-4b9c-bfe3-2cc84be31328',
	host: 'legion-johnny',
	port: '1541',
	name: 'Локальный кластер',
	'expiration-timeout': '60',
	'lifetime-limit': '0',
	'max-memory-size': '0',
	'max-memory-time-limit': '0',
	'security-level': '0',
	'session-fault-tolerance-level': '0',
	'load-balancing-mode': 'performance',
	'errors-count-threshold': '0',
	'kill-problem-processes': '1',
	'kill-by-memory-with-dump': '0',
	'allow-access-right-audit-events-recording': '0',
	'ping-period': '0',
	'ping-timeout': '0',
	'restart-schedule': '',
};

suite('свойства кластера: чтение', () => {
	test('флаги платформы 1/0 читаются как включённые и выключенные', () => {
		const values = toClusterForm(RECORD);

		assert.strictEqual(values['kill-problem-processes'], 'on');
		assert.strictEqual(values['kill-by-memory-with-dump'], 'off');
	});

	test('идентификатор, сервер и порт только для чтения', () => {
		const readonly = CLUSTER_SECTIONS[0].fields.filter((field) => field.kind === 'readonly');

		assert.deepStrictEqual(
			readonly.map((field) => field.key),
			['cluster', 'host', 'port']
		);
	});
});

suite('свойства кластера: изменение', () => {
	test('без правок изменение пустое', () => {
		const values = toClusterForm(RECORD);

		assert.deepStrictEqual(buildClusterChange(values, values), {});
	});

	test('флаг отправляется словом: платформа читает 1/0, а принимает yes/no', () => {
		const before = toClusterForm(RECORD);

		const enabled = buildClusterChange(before, { ...before, 'kill-by-memory-with-dump': 'on' });
		const disabled = buildClusterChange(before, { ...before, 'kill-problem-processes': 'off' });

		assert.deepStrictEqual(enabled, { 'kill-by-memory-with-dump': 'yes' });
		assert.deepStrictEqual(disabled, { 'kill-problem-processes': 'no' });
	});

	test('отправляются только тронутые поля', () => {
		const before = toClusterForm(RECORD);

		const change = buildClusterChange(before, { ...before, 'lifetime-limit': '86400' });

		assert.deepStrictEqual(change, { 'lifetime-limit': '86400' });
	});

	test('идентификатор кластера правкой не считается', () => {
		const before = toClusterForm(RECORD);

		const change = buildClusterChange(before, { ...before, cluster: 'другой', host: 'другой' });

		assert.deepStrictEqual(change, {});
	});
});

suite('свойства кластера: проверка ввода', () => {
	test('числовое поле проверяется', () => {
		const values = { ...toClusterForm(RECORD), 'ping-period': 'быстро' };

		assert.ok(validateClusterForm(values)[0].includes('Период проверки связи'));
	});

	test('пустое имя кластера не принимается', () => {
		const values = { ...toClusterForm(RECORD), name: '  ' };

		assert.ok(validateClusterForm(values)[0].includes('Имя кластера'));
	});

	test('исходные значения замечаний не вызывают', () => {
		assert.deepStrictEqual(validateClusterForm(toClusterForm(RECORD)), []);
	});
});

suite('карточка свойств: общие правила', () => {
	test('отсутствующее поле становится пустым, а не undefined', () => {
		const values = toPropertyValues({}, CLUSTER_SECTIONS);

		assert.strictEqual(values.name, '');
	});

	test('поля только для чтения в правки не попадают', () => {
		const before = toPropertyValues(RECORD, CLUSTER_SECTIONS);

		const changed = changedValues(before, { ...before, host: 'другой', name: 'Новый' }, CLUSTER_SECTIONS);

		assert.deepStrictEqual(changed, { name: 'Новый' });
	});
});

suite('карточка свойств: непринятые поля', () => {
	test('поле, которое платформа не применила, называется по имени', () => {
		const requested = { ...toClusterForm(RECORD), 'lifetime-limit': '86400', name: 'Новый' };
		const actual = { ...toClusterForm(RECORD), name: 'Новый' };

		// Платформа принимает вызов без ошибки, но значение оставляет прежним
		const ignored = unappliedFields(CLUSTER_SECTIONS, requested, actual);

		assert.deepStrictEqual(ignored, ['Период перезапуска, с']);
	});

	test('когда всё применилось, список пуст', () => {
		const values = toClusterForm(RECORD);

		assert.deepStrictEqual(unappliedFields(CLUSTER_SECTIONS, values, values), []);
	});
});
