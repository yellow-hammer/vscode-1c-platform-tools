import * as assert from 'node:assert';
import { mapResults, KnownCase } from '../../features/testing/testResultMapper';
import { JUnitCase } from '../../features/testing/parsers/junitParser';

function junitCase(name: string, status: JUnitCase['status'] = 'passed', extra?: Partial<JUnitCase>): JUnitCase {
	return { suiteName: 'S', className: 'C', name, status, ...extra };
}

suite('testResultMapper', () => {
	const known: KnownCase[] = [
		{ id: 'id-1', caseName: 'Создание элемента справочника' },
		{ id: 'id-2', caseName: 'ТестДолжен_ПроверитьСложение' },
		{ id: 'id-3', caseName: 'Параметризованный' }
	];

	test('точное совпадение имени', () => {
		const { results, unmatched } = mapResults([junitCase('ТестДолжен_ПроверитьСложение')], known);
		assert.strictEqual(results.get('id-2')?.status, 'passed');
		assert.strictEqual(unmatched.length, 0);
	});

	test('совпадение без учёта регистра и лишних пробелов', () => {
		const { results } = mapResults([junitCase('  создание   элемента справочника ')], known);
		assert.strictEqual(results.get('id-1')?.status, 'passed');
	});

	test('совпадение после снятия префикса и нумерации', () => {
		const { results } = mapResults(
			[junitCase('001. Сценарий: Создание элемента справочника', 'failed', { message: 'Упал' })],
			known
		);
		const mapped = results.get('id-1');
		assert.ok(mapped);
		assert.strictEqual(mapped.status, 'failed');
		assert.deepStrictEqual(mapped.messages, [{ text: 'Упал' }]);
	});

	test('подстрочное совпадение: единственный кандидат привязывается', () => {
		const single: KnownCase[] = [{ id: 'one', caseName: 'Тест создания документа' }];
		const { results } = mapResults(
			[junitCase('Прогон: Тест создания документа (вариант 2)')],
			single
		);
		assert.ok(results.has('one'));
	});

	test('подстрочное совпадение: при нескольких кандидатах — не угадываем (unmatched)', () => {
		const ambiguous: KnownCase[] = [
			{ id: 'short', caseName: 'Тест' },
			{ id: 'long', caseName: 'Тест создания документа' }
		];
		const { results, unmatched } = mapResults(
			[junitCase('Прогон: Тест создания документа (вариант 2)')],
			ambiguous
		);
		assert.strictEqual(results.size, 0, 'Неоднозначный подстрочный матч не привязывается');
		assert.strictEqual(unmatched.length, 1);
	});

	test('агрегация нескольких testcase в один кейс (Структура сценария)', () => {
		const { results } = mapResults(
			[
				junitCase('Параметризованный', 'passed', { timeMs: 100 }),
				junitCase('Параметризованный', 'failed', { timeMs: 200, message: 'Строка 2 упала' })
			],
			known
		);
		const mapped = results.get('id-3');
		assert.ok(mapped);
		assert.strictEqual(mapped.status, 'failed', 'failed важнее passed');
		assert.strictEqual(mapped.durationMs, 300);
		assert.deepStrictEqual(mapped.messages, [{ text: 'Строка 2 упала' }]);
	});

	test('error важнее failed, skipped — только если все пропущены', () => {
		const { results } = mapResults(
			[
				junitCase('Параметризованный', 'failed'),
				junitCase('Параметризованный', 'error', { message: 'Исключение' })
			],
			known
		);
		assert.strictEqual(results.get('id-3')?.status, 'error');

		const { results: skippedResults } = mapResults(
			[junitCase('Параметризованный', 'skipped')],
			known
		);
		assert.strictEqual(skippedResults.get('id-3')?.status, 'skipped');
	});

	test('несматченные testcase попадают в unmatched', () => {
		const { results, unmatched } = mapResults([junitCase('Совершенно другое имя XYZ')], known);
		assert.strictEqual(results.size, 0);
		assert.strictEqual(unmatched.length, 1);
	});

	test('падение без message получает заглушку', () => {
		const { results } = mapResults([junitCase('Параметризованный', 'failed')], known);
		assert.strictEqual(results.get('id-3')?.messages.length, 1);
		assert.ok(results.get('id-3')?.messages[0].text.length);
	});

	test('пара expected/actual пробрасывается в сообщение для diff', () => {
		const { results } = mapResults(
			[
				junitCase('ТестДолжен_ПроверитьСложение', 'failed', {
					message: 'expected:<4> but was:<5>',
					expected: '4',
					actual: '5'
				})
			],
			known
		);
		const mapped = results.get('id-2');
		assert.ok(mapped);
		assert.strictEqual(mapped.messages.length, 1);
		assert.strictEqual(mapped.messages[0].expected, '4');
		assert.strictEqual(mapped.messages[0].actual, '5');
		assert.ok(mapped.messages[0].text.includes('expected:<4>'));
	});

	test('без пары expected/actual поля diff не выставляются (fallback на текст)', () => {
		const { results } = mapResults(
			[junitCase('ТестДолжен_ПроверитьСложение', 'failed', { message: 'Просто упал' })],
			known
		);
		const message = results.get('id-2')?.messages[0];
		assert.ok(message);
		assert.strictEqual(message.expected, undefined);
		assert.strictEqual(message.actual, undefined);
	});

	test('одноимённые кейсы разных контейнеров различаются по группе (suiteName)', () => {
		// Два «[ibcmd]» из разных параметризованных процедур одного файла
		const paramKnown: KnownCase[] = [
			{ id: 'decompile-ibcmd', caseName: '[ibcmd]', suiteName: 'ТестДолжен_Разобрать' },
			{ id: 'unload-ibcmd', caseName: '[ibcmd]', suiteName: 'ТестДолжен_Выгрузить' }
		];
		const { results, unmatched } = mapResults(
			[
				junitCase('[ibcmd]', 'passed', { suiteName: 'ТестДолжен_Выгрузить' }),
				junitCase('[ibcmd]', 'failed', { suiteName: 'ТестДолжен_Разобрать', message: 'Упал' })
			],
			paramKnown
		);
		assert.strictEqual(results.get('unload-ibcmd')?.status, 'passed');
		assert.strictEqual(results.get('decompile-ibcmd')?.status, 'failed');
		assert.strictEqual(unmatched.length, 0);
	});

	test('без suiteName одноимённые кейсы падают на первый (совместимость)', () => {
		const dup: KnownCase[] = [
			{ id: 'first', caseName: '[ibcmd]' },
			{ id: 'second', caseName: '[ibcmd]' }
		];
		const { results } = mapResults([junitCase('[ibcmd]')], dup);
		assert.strictEqual(results.get('first')?.status, 'passed');
		assert.strictEqual(results.get('second'), undefined);
	});
});
