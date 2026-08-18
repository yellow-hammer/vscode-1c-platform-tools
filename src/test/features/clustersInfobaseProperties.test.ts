import * as assert from 'node:assert';
import {
	INFOBASE_SECTIONS,
	buildInfobaseChange,
	isEmptyInfobaseChange,
	toInfobaseForm,
	validateInfobaseForm,
} from '../../features/clusters/infobaseProperties';

/** Ответ платформы на `infobase info` для незаблокированной базы. */
const RECORD = {
	infobase: '341e44c9-4724-4355-a18b-9335191377ef',
	name: 'ib',
	descr: '',
	dbms: 'PostgreSQL',
	'db-server': 'localhost',
	'db-name': 'ib',
	'db-user': 'postgres',
	'sessions-deny': 'off',
	'scheduled-jobs-deny': 'off',
	'license-distribution': 'allow',
	'denied-from': '',
	'denied-to': '',
	'denied-message': '',
	'permission-code': '',
	'security-profile-name': '',
	'safe-mode-security-profile-name': '',
};

suite('свойства базы: чтение', () => {
	test('в форму попадают все поля разделов', () => {
		const values = toInfobaseForm(RECORD);

		for (const section of INFOBASE_SECTIONS) {
			for (const field of section.fields) {
				assert.ok(field.key in values, `поле ${field.key} не попало в форму`);
			}
		}
	});

	test('отсутствующее в ответе поле становится пустым, а не undefined', () => {
		const values = toInfobaseForm({ name: 'ib' });

		assert.strictEqual(values['denied-message'], '');
	});

	test('размещение базы не редактируется: его меняют вместе с самой базой', () => {
		const placement = INFOBASE_SECTIONS[0];

		assert.strictEqual(placement.title, 'Размещение');
		assert.ok(placement.fields.every((field) => field.kind === 'readonly'));
	});
});

suite('свойства базы: изменение', () => {
	test('без правок изменение пустое', () => {
		const values = toInfobaseForm(RECORD);

		assert.strictEqual(isEmptyInfobaseChange(buildInfobaseChange(values, values)), true);
	});

	test('отправляются только тронутые поля: остальное могли поменять в другой консоли', () => {
		const before = toInfobaseForm(RECORD);
		const after = { ...before, 'denied-message': 'Идёт обслуживание' };

		const change = buildInfobaseChange(before, after);

		assert.deepStrictEqual(change, { deniedMessage: 'Идёт обслуживание' });
	});

	test('флаги переводятся в булево значение', () => {
		const before = toInfobaseForm(RECORD);
		const change = buildInfobaseChange(before, {
			...before,
			'sessions-deny': 'on',
			'scheduled-jobs-deny': 'on',
		});

		assert.strictEqual(change.sessionsDeny, true);
		assert.strictEqual(change.scheduledJobsDeny, true);
	});

	test('очистка поля отправляется пустым значением: так платформа его и стирает', () => {
		const before = toInfobaseForm({ ...RECORD, 'denied-message': 'Старое сообщение' });
		const change = buildInfobaseChange(before, { ...before, 'denied-message': '' });

		assert.strictEqual(change.deniedMessage, '');
	});

	test('выдача лицензий принимает только известные платформе значения', () => {
		const before = toInfobaseForm(RECORD);

		assert.strictEqual(
			buildInfobaseChange(before, { ...before, 'license-distribution': 'deny' }).licenseDistribution,
			'deny'
		);
		assert.strictEqual(
			buildInfobaseChange(before, { ...before, 'license-distribution': 'мусор' }).licenseDistribution,
			'allow'
		);
	});
});

suite('свойства базы: проверка ввода', () => {
	test('дата блокировки проверяется по формату платформы', () => {
		const values = { ...toInfobaseForm(RECORD), 'denied-from': '18.08.2026' };

		const problems = validateInfobaseForm(values);

		assert.strictEqual(problems.length, 1);
		assert.ok(problems[0].includes('Блокировка с'));
	});

	test('правильная дата и пустое значение принимаются', () => {
		const values = {
			...toInfobaseForm(RECORD),
			'denied-from': '2026-08-18T22:00:00',
			'denied-to': '',
		};

		assert.deepStrictEqual(validateInfobaseForm(values), []);
	});

	test('запрет сеансов без сообщения вызывает замечание', () => {
		const values = { ...toInfobaseForm(RECORD), 'sessions-deny': 'on' };

		assert.strictEqual(validateInfobaseForm(values).length, 1);
	});
});
