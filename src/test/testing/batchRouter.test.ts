import * as assert from 'node:assert';
import { routeReportCases } from '../../features/testing/batchRouter';
import { JUnitCase } from '../../features/testing/parsers/junitParser';

function makeCase(partial: Partial<JUnitCase> & { name: string }): JUnitCase {
	return {
		suiteName: '',
		className: '',
		status: 'passed',
		...partial
	};
}

suite('batchRouter', () => {
	const files = [
		{ id: 'a', fsPath: 'C:\\proj\\tests\\unit\\Сервисы\\ТестСервисEDT.os' },
		{ id: 'b', fsPath: 'C:\\proj\\tests\\unit\\Движки\\ТестДвижокIbCmd.os' }
	];

	test('раскладывает по относительному пути в атрибуте file', () => {
		const cases = [
			makeCase({ name: 'Тест1', file: 'tests/unit/Сервисы/ТестСервисEDT.os' }),
			makeCase({ name: 'Тест2', file: 'tests/unit/Движки/ТестДвижокIbCmd.os' })
		];

		const { byFile, unrouted } = routeReportCases(cases, files);
		assert.strictEqual(unrouted.length, 0);
		assert.deepStrictEqual(byFile.get('a')?.map((c) => c.name), ['Тест1']);
		assert.deepStrictEqual(byFile.get('b')?.map((c) => c.name), ['Тест2']);
	});

	test('раскладывает по реальному формату OneUnit (.\\tests\\...)', () => {
		// Точный вид атрибута file из отчёта oneunit 0.3.3
		const cases = [makeCase({ name: 'Тест1', file: '.\\tests\\unit\\Сервисы\\ТестСервисEDT.os', className: 'ТестСервисEDT' })];

		const { byFile, unrouted } = routeReportCases(cases, files);
		assert.strictEqual(unrouted.length, 0);
		assert.deepStrictEqual(byFile.get('a')?.map((c) => c.name), ['Тест1']);
	});

	test('раскладывает по абсолютному пути с обратными слэшами', () => {
		const cases = [makeCase({ name: 'Тест1', file: 'C:\\proj\\tests\\unit\\Сервисы\\ТестСервисEDT.os' })];

		const { byFile } = routeReportCases(cases, files);
		assert.deepStrictEqual(byFile.get('a')?.map((c) => c.name), ['Тест1']);
	});

	test('группирует несколько кейсов одного файла', () => {
		const cases = [
			makeCase({ name: 'Тест1', file: 'tests/unit/Сервисы/ТестСервисEDT.os' }),
			makeCase({ name: 'Тест2', file: 'tests/unit/Сервисы/ТестСервисEDT.os' })
		];

		const { byFile } = routeReportCases(cases, files);
		assert.deepStrictEqual(byFile.get('a')?.map((c) => c.name), ['Тест1', 'Тест2']);
	});

	test('запасной признак — classname по имени модуля без расширения', () => {
		const cases = [makeCase({ name: 'Тест1', className: 'ТестСервисEDT' })];

		const { byFile, unrouted } = routeReportCases(cases, files);
		assert.strictEqual(unrouted.length, 0);
		assert.deepStrictEqual(byFile.get('a')?.map((c) => c.name), ['Тест1']);
	});

	test('кейс без признаков файла попадает в unrouted', () => {
		const cases = [makeCase({ name: 'Сирота', file: 'tests/unit/Прочее/Неизвестный.os' })];

		const { byFile, unrouted } = routeReportCases(cases, files);
		assert.strictEqual(byFile.size, 0);
		assert.deepStrictEqual(unrouted.map((c) => c.name), ['Сирота']);
	});

	test('совпадение по имени файла не цепляет «хвостовой» файл', () => {
		// tests.os не должен сматчиться на mytests.os (граница сегмента)
		const onlyFiles = [{ id: 'x', fsPath: 'C:\\proj\\tests\\mytests.os' }];
		const cases = [makeCase({ name: 'Т', file: 'tests.os' })];

		const { unrouted } = routeReportCases(cases, onlyFiles);
		assert.strictEqual(unrouted.length, 1, 'tests.os не привязан к mytests.os');
	});

	test('неоднозначный basename разводится по полному пути', () => {
		const dupFiles = [
			{ id: 'u', fsPath: 'C:\\proj\\tests\\unit\\Общий.os' },
			{ id: 'e', fsPath: 'C:\\proj\\tests\\e2e\\Общий.os' }
		];
		const cases = [makeCase({ name: 'Т', file: 'tests/e2e/Общий.os' })];

		const { byFile } = routeReportCases(cases, dupFiles);
		assert.deepStrictEqual(byFile.get('e')?.map((c) => c.name), ['Т']);
		assert.strictEqual(byFile.has('u'), false);
	});

	test('Vanessa: раскладка по имени функционала из classname и suiteName', () => {
		const vaFiles = [
			{ id: 'f1', fsPath: 'C:\proj\features\Смоук\ЗапускПриложения.feature', label: 'Запуск приложения' },
			{ id: 'f2', fsPath: 'C:\proj\features\Справочники\Валюты.feature', label: 'Справочник Валюты' },
			{ id: 'f3', fsPath: 'C:\proj\features\Справочники\ПримерыПадений.feature', label: 'Примеры падающих сценариев' }
		];
		const cases = [
			makeCase({ name: 'Подключение тестового клиента', suiteName: 'Запуск приложения', className: 'Смоук.Запуск приложения' }),
			makeCase({ name: 'Открытие списка валют', suiteName: 'Справочник Валюты', className: 'Справочники.Справочник Валюты' }),
			makeCase({ name: 'Падение - окно не открылось', status: 'error', suiteName: 'Примеры падающих сценариев', className: 'Справочники.Примеры падающих сценариев' })
		];

		const { byFile, unrouted } = routeReportCases(cases, vaFiles);
		assert.strictEqual(unrouted.length, 0);
		assert.deepStrictEqual(byFile.get('f1')?.map((c) => c.name), ['Подключение тестового клиента']);
		assert.deepStrictEqual(byFile.get('f2')?.map((c) => c.name), ['Открытие списка валют']);
		assert.deepStrictEqual(byFile.get('f3')?.map((c) => c.name), ['Падение - окно не открылось']);
	});

	test('без заголовка файла кейсы Vanessa остаются непривязанными', () => {
		const vaFiles = [{ id: 'f1', fsPath: 'C:\proj\features\Валюты.feature' }];
		const cases = [makeCase({ name: 'Открытие списка валют', suiteName: 'Справочник Валюты', className: 'Справочники.Справочник Валюты' })];

		const { byFile, unrouted } = routeReportCases(cases, vaFiles);
		assert.strictEqual(byFile.size, 0);
		assert.strictEqual(unrouted.length, 1);
	});
});
