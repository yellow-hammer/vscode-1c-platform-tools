import * as assert from 'node:assert';
import {
	isBlankConnectionDraft,
	isBlankSetDraft,
	resolveEditorSelection,
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
		platformVersion: '',
		clusterSetId: '',
		agentSetId: '',
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
		const record = toConnectionDraft({
			id: 'connection-2',
			name: 'Прод',
			host: 'srv-prod',
			port: 1745,
			platformVersion: '8.3.27',
		});
		assert.deepStrictEqual(record, {
			id: 'connection-2',
			name: 'Прод',
			host: 'srv-prod',
			port: 1745,
			platformVersion: '8.3.27',
			clusterSetId: '',
			agentSetId: '',
		});
	});

	test('незаданная версия становится пустым полем, а не undefined', () => {
		const record = toConnectionDraft({ id: 'connection-3', name: 'Тест', host: 'srv', port: 1545 });
		assert.strictEqual(record.platformVersion, '');
	});
});

suite('форма подключений: пустые заготовки', () => {
	test('нетронутая заготовка не считается ошибкой ввода', () => {
		assert.ok(isBlankConnectionDraft(draft({ name: '', host: '' })));
		assert.ok(!isBlankConnectionDraft(draft({ name: 'Прод', host: '' })));
		assert.ok(!isBlankConnectionDraft(draft({ name: '', host: 'srv' })));
	});

	test('набор пуст, пока не тронули ни поля, ни пароль', () => {
		const set = {
			id: 'new-1',
			name: '',
			user: '',
			kind: 'cluster' as const,
			hasPassword: false,
		};
		assert.ok(isBlankSetDraft(set));
		assert.ok(!isBlankSetDraft({ ...set, user: 'Админ' }));
		assert.ok(!isBlankSetDraft({ ...set, password: '123' }));
	});
});

suite('форма подключений: выбор при открытии', () => {
	test('без цели выбирается первое подключение', () => {
		assert.deepStrictEqual(resolveEditorSelection(undefined, ['c1', 'c2'], ['s1']), {
			kind: 'connection',
			id: 'c1',
		});
	});

	test('просьба о новом наборе доходит до формы как есть', () => {
		assert.deepStrictEqual(resolveEditorSelection({ kind: 'set', id: 'new' }, ['c1'], ['s1']), {
			kind: 'set',
			id: 'new',
		});
	});

	test('существующая запись выбирается, пропавшая заменяется первой того же вида', () => {
		assert.deepStrictEqual(resolveEditorSelection({ kind: 'set', id: 's2' }, ['c1'], ['s1', 's2']), {
			kind: 'set',
			id: 's2',
		});
		assert.deepStrictEqual(resolveEditorSelection({ kind: 'set', id: 'нет' }, ['c1'], ['s1']), {
			kind: 'set',
			id: 's1',
		});
	});

	test('пустая секция открывается заготовкой новой записи, а не пустым экраном', () => {
		assert.deepStrictEqual(resolveEditorSelection({ kind: 'set' }, ['c1'], []), {
			kind: 'set',
			id: 'new',
		});
		assert.deepStrictEqual(resolveEditorSelection(undefined, [], []), {
			kind: 'connection',
			id: 'new',
		});
	});
});
