import * as assert from 'node:assert';
import {
	describeHookEntry,
	normalizeHooks,
	serializeHooks,
} from '../../shared/hooks/hooksModel';

suite('модель хуков', () => {
	test('короткая запись приводится к списку шагов', () => {
		const model = normalizeHooks({
			hooks: {
				'1c-platform-tools.cf.compile': {
					pre: 'npm run prepare',
					post: ['npm run notify', { command: 'npm run clean', continueOnError: true, timeout: 15 }],
				},
			},
		});
		assert.deepStrictEqual(model.hooks['1c-platform-tools.cf.compile'], {
			pre: [{ command: 'npm run prepare' }],
			post: [
				{ command: 'npm run notify' },
				{ command: 'npm run clean', continueOnError: true, timeout: 15 },
			],
		});
	});

	test('незаполненный шаг сохраняется, чужие фазы и мусор отбрасываются', () => {
		const model = normalizeHooks({
			hooks: {
				'a': { pre: ['', '   '], onError: [{ command: 'echo fail' }], unknown: 'x' },
				'b': { pre: [] },
				'c': 'мусор',
			},
		});
		assert.deepStrictEqual(Object.keys(model.hooks), ['a']);
		assert.deepStrictEqual(model.hooks.a, {
			pre: [{ command: '' }, { command: '' }],
			onError: [{ command: 'echo fail' }],
		});
	});

	test('запись возвращает короткую форму, где нет настроек', () => {
		const text = serializeHooks(
			normalizeHooks({
				hooks: {
					'a': {
						pre: [{ command: 'один' }],
						post: [{ command: 'первый' }, { command: 'второй', timeout: 5 }],
					},
				},
			})
		);
		const parsed = JSON.parse(text) as { version: number; hooks: Record<string, Record<string, unknown>> };
		assert.strictEqual(parsed.version, 1);
		assert.strictEqual(parsed.hooks.a.pre, 'один', 'одиночный шаг без настроек пишется строкой');
		assert.deepStrictEqual(parsed.hooks.a.post, ['первый', { command: 'второй', timeout: 5 }]);
		assert.ok(text.includes('hooks.schema.json'), 'в файле остаётся ссылка на схему');
	});

	test('разбор и запись переживают круг без потерь', () => {
		const source = {
			hooks: {
				'*': { pre: [{ command: 'echo start' }], onError: [{ command: 'echo fail', continueOnError: true }] },
			},
		};
		const once = normalizeHooks(source);
		const twice = normalizeHooks(JSON.parse(serializeHooks(once)));
		assert.deepStrictEqual(twice, once);
	});

	test('подпись перечисляет фазы с количеством шагов', () => {
		assert.strictEqual(
			describeHookEntry({ pre: [{ command: 'a' }, { command: 'b' }], onError: [{ command: 'c' }] }),
			'до 2, при ошибке 1'
		);
		assert.strictEqual(describeHookEntry({}), '');
	});

	test('мусор вместо файла даёт пустую модель', () => {
		assert.deepStrictEqual(normalizeHooks(undefined).hooks, {});
		assert.deepStrictEqual(normalizeHooks({ hooks: [] }).hooks, {});
	});
});
