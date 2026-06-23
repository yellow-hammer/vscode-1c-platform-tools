import * as assert from 'node:assert';
import { extractExpectedActual } from '../../features/testing/parsers/expectedActual';

suite('extractExpectedActual', () => {
	test('классический JUnit assertEquals: expected:<4> but was:<5>', () => {
		assert.deepStrictEqual(extractExpectedActual('expected:<4> but was:<5>'), {
			expected: '4',
			actual: '5'
		});
	});

	test('английский Expected/Actual на разных строках', () => {
		assert.deepStrictEqual(extractExpectedActual('Expected: 42\nActual: 7'), {
			expected: '42',
			actual: '7'
		});
	});

	test('английский Expected ... but was без знака-разделителя', () => {
		assert.deepStrictEqual(extractExpectedActual('Expected: foo but was: bar'), {
			expected: 'foo',
			actual: 'bar'
		});
	});

	test('русский: Ожидали X, получили Y', () => {
		assert.deepStrictEqual(extractExpectedActual('Ожидали: 4, получили: 5'), {
			expected: '4',
			actual: '5'
		});
	});

	test('русский: Ожидаемое значение ... Фактическое значение', () => {
		assert.deepStrictEqual(
			extractExpectedActual('Ожидаемое значение: Иванов. Фактическое значение: Петров'),
			{ expected: 'Иванов', actual: 'Петров' }
		);
	});

	test('снимает обрамляющие кавычки со значений', () => {
		assert.deepStrictEqual(extractExpectedActual('Ожидали: «10», получили: «20»'), {
			expected: '10',
			actual: '20'
		});
	});

	test('ищет пару среди нескольких текстов по приоритету', () => {
		const result = extractExpectedActual(undefined, 'нет пары', 'expected:<a> but was:<b>');
		assert.deepStrictEqual(result, { expected: 'a', actual: 'b' });
	});

	test('находит пару внутри многострочного стека', () => {
		const text = 'Тест упал\nОжидаемое значение: 100\nФактическое значение: 200\n  at module.bsl:42';
		const result = extractExpectedActual(text);
		assert.ok(result);
		assert.strictEqual(result.expected, '100');
		assert.ok(result.actual.startsWith('200'));
	});

	test('без распознаваемой пары возвращает undefined', () => {
		assert.strictEqual(extractExpectedActual('Кнопка «Создать» не найдена на форме'), undefined);
		assert.strictEqual(extractExpectedActual(undefined), undefined);
		assert.strictEqual(extractExpectedActual(''), undefined);
	});

	test('совпадающие значения не дают diff (undefined)', () => {
		assert.strictEqual(extractExpectedActual('expected:<5> but was:<5>'), undefined);
	});
});
