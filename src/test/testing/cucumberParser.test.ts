import * as assert from 'node:assert';
import { parseCucumberJson } from '../../features/testing/parsers/cucumberParser';

suite('cucumberParser', () => {
	test('разбирает отчёт VA: passed и failed сценарии', () => {
		const json = JSON.stringify([
			{
				name: 'Проверка справочников',
				keyword: 'Функционал',
				elements: [
					{
						name: 'Создание элемента справочника',
						type: 'scenario',
						steps: [
							{ keyword: 'Дано ', name: 'Я открываю форму', result: { status: 'passed', duration: 500_000_000 } },
							{ keyword: 'Когда ', name: 'Я нажимаю Создать', result: { status: 'passed', duration: 250_000_000 } }
						]
					},
					{
						name: 'Удаление элемента',
						type: 'scenario',
						steps: [
							{ keyword: 'Дано ', name: 'Я открываю форму', result: { status: 'passed', duration: 100_000_000 } },
							{
								keyword: 'Когда ',
								name: 'Я нажимаю Удалить',
								result: { status: 'failed', duration: 50_000_000, error_message: 'Кнопка не найдена' }
							},
							{ keyword: 'Тогда ', name: 'Элемент удалён', result: { status: 'skipped' } }
						]
					}
				]
			}
		]);

		const cases = parseCucumberJson(json);
		assert.strictEqual(cases.length, 2);

		assert.strictEqual(cases[0].suiteName, 'Проверка справочников');
		assert.strictEqual(cases[0].name, 'Создание элемента справочника');
		assert.strictEqual(cases[0].status, 'passed');
		assert.strictEqual(cases[0].timeMs, 750);

		assert.strictEqual(cases[1].status, 'failed');
		assert.ok(cases[1].message?.includes('Я нажимаю Удалить'));
		assert.strictEqual(cases[1].details, 'Кнопка не найдена');
	});

	test('background не считается сценарием, undefined-шаг — это failed', () => {
		const json = JSON.stringify([
			{
				name: 'Фича',
				elements: [
					{ name: '', type: 'background', steps: [{ result: { status: 'passed' } }] },
					{
						name: 'С нереализованным шагом',
						type: 'scenario',
						steps: [{ keyword: 'И ', name: 'шаг без реализации', result: { status: 'undefined' } }]
					}
				]
			}
		]);

		const cases = parseCucumberJson(json);
		assert.strictEqual(cases.length, 1);
		assert.strictEqual(cases[0].status, 'failed');
	});

	test('сценарий только из пропущенных шагов — skipped', () => {
		const json = JSON.stringify([
			{
				name: 'Фича',
				elements: [
					{
						name: 'Пропущенный',
						type: 'scenario',
						steps: [{ result: { status: 'skipped' } }, { result: { status: 'pending' } }]
					}
				]
			}
		]);

		const cases = parseCucumberJson(json);
		assert.strictEqual(cases[0].status, 'skipped');
		assert.strictEqual(cases[0].timeMs, undefined);
	});

	test('извлекает expected/actual из error_message шага', () => {
		const json = JSON.stringify([
			{
				name: 'Фича',
				elements: [
					{
						name: 'Сравнение значений',
						type: 'scenario',
						steps: [
							{
								keyword: 'Тогда ',
								name: 'значения равны',
								result: { status: 'failed', error_message: 'Ожидаемое значение: 10. Фактическое значение: 20' }
							}
						]
					}
				]
			}
		]);

		const cases = parseCucumberJson(json);
		assert.strictEqual(cases[0].expected, '10');
		assert.strictEqual(cases[0].actual, '20');
	});

	test('битый JSON и не-массив вызывают ошибку', () => {
		assert.throws(() => parseCucumberJson('{оборвано'), /Cucumber JSON/);
		assert.throws(() => parseCucumberJson('{"name": "не массив"}'), /массив/);
	});

	test('пустой массив фич даёт пустой список', () => {
		assert.deepStrictEqual(parseCucumberJson('[]'), []);
	});
});
