import * as assert from 'node:assert';
import {
	toConnectionDraft,
	validateConnectionDraft,
	type ConnectionDraft,
} from '../../features/clusters/connectionsEditor';

/** Заполненное подключение формы, от которого отталкиваются проверки. */
function draft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
	return {
		id: 'connection-1',
		name: 'Тестовый сервер',
		host: 'srv-1c',
		port: 1545,
		clusterUser: '',
		agentUser: '',
		platformVersion: '',
		hasPassword: false,
		hasAgentPassword: false,
		...overrides,
	};
}

suite('форма подключений к кластерам', () => {
	test('заполненное подключение замечаний не вызывает', () => {
		assert.deepStrictEqual(validateConnectionDraft(draft()), []);
	});

	test('без названия и адреса сохранять нечего', () => {
		assert.deepStrictEqual(validateConnectionDraft(draft({ name: '   ' })), ['не задано название']);
		assert.deepStrictEqual(validateConnectionDraft(draft({ host: '' })), [
			'не задан адрес сервера администрирования',
		]);
	});

	test('порт проверяется диапазоном', () => {
		const message = 'порт должен быть числом от 1 до 65535';
		assert.deepStrictEqual(validateConnectionDraft(draft({ port: 0 })), [message]);
		assert.deepStrictEqual(validateConnectionDraft(draft({ port: 70000 })), [message]);
		assert.deepStrictEqual(validateConnectionDraft(draft({ port: 1.5 })), [message]);
		assert.deepStrictEqual(validateConnectionDraft(draft({ port: 1 })), []);
		assert.deepStrictEqual(validateConnectionDraft(draft({ port: 65535 })), []);
	});

	test('версия платформы: пусто или цифры через точку', () => {
		assert.deepStrictEqual(validateConnectionDraft(draft({ platformVersion: '' })), []);
		assert.deepStrictEqual(validateConnectionDraft(draft({ platformVersion: '8.3.27' })), []);
		assert.deepStrictEqual(validateConnectionDraft(draft({ platformVersion: '8.3.27.1936' })), []);
		assert.deepStrictEqual(validateConnectionDraft(draft({ platformVersion: 'последняя' })), [
			'версия платформы указывается цифрами, например 8.3.27',
		]);
	});

	test('замечания собираются все сразу: форму не правят по одному полю', () => {
		const problems = validateConnectionDraft(draft({ name: '', host: '', port: -1 }));
		assert.strictEqual(problems.length, 3);
	});

	test('сохранённое подключение разворачивается в поля формы', () => {
		const record = toConnectionDraft(
			{
				id: 'connection-2',
				name: 'Прод',
				host: 'srv-prod',
				port: 1745,
				clusterUser: 'admin',
				platformVersion: '8.3.27',
			},
			true
		);
		assert.deepStrictEqual(record, {
			id: 'connection-2',
			name: 'Прод',
			host: 'srv-prod',
			port: 1745,
			clusterUser: 'admin',
			agentUser: '',
			platformVersion: '8.3.27',
			hasPassword: true,
			hasAgentPassword: false,
		});
	});

	test('незаданные администратор и версия становятся пустыми полями, а не undefined', () => {
		const record = toConnectionDraft(
			{ id: 'connection-3', name: 'Тест', host: 'srv', port: 1545 },
			false
		);
		assert.strictEqual(record.clusterUser, '');
		assert.strictEqual(record.platformVersion, '');
		assert.strictEqual(record.hasPassword, false);
	});
});
