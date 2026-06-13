import * as assert from 'node:assert';
import { parseBslTestModule, isBslTestModule } from '../../features/testing/parsers/bslTestParser';

suite('bslTestParser', () => {
	const xddModule = [
		'Функция ИсполняемыеСценарии() Экспорт',
		'\tВсеТесты = Новый Массив;',
		'\tВсеТесты.Добавить("ТестДолжен_ПроверитьСложение");',
		'\tВозврат ВсеТесты;',
		'КонецФункции',
		'',
		'Процедура ТестДолжен_ПроверитьСложение() Экспорт',
		'\tжют.ПроверитьРавенство(2 + 2, 4);',
		'КонецПроцедуры',
		'',
		'Процедура ТестДолжен_ПроверитьВычитание() Экспорт',
		'\tжют.ПроверитьРавенство(4 - 2, 2);',
		'КонецПроцедуры',
		'',
		'Процедура СлужебныйМетод()',
		'\t// не экспортный — не тест',
		'КонецПроцедуры'
	].join('\n');

	test('xunit: кейсы — экспортные методы без служебных', () => {
		const result = parseBslTestModule(xddModule, 'xunit');
		assert.ok(result, 'Модуль должен быть распознан как тестовый');
		assert.deepStrictEqual(
			result.cases.map((c) => c.name),
			['ТестДолжен_ПроверитьСложение', 'ТестДолжен_ПроверитьВычитание']
		);
		assert.strictEqual(result.cases[0].line, 6);
		assert.strictEqual(result.cases[1].line, 10);
	});

	test('xunit: модуль без ИсполняемыеСценарии не считается тестовым', () => {
		const content = 'Процедура Просто() Экспорт\nКонецПроцедуры';
		assert.strictEqual(parseBslTestModule(content, 'xunit'), undefined);
		assert.strictEqual(isBslTestModule(content, 'xunit'), false);
	});

	test('xunit: учитывает BOM и регистр ключевых слов', () => {
		const content = '﻿функция ИсполняемыеСценарии() экспорт\nКонецФункции\n' +
			'процедура Тест_Один() Экспорт\nконецпроцедуры';
		const result = parseBslTestModule(content, 'xunit');
		assert.ok(result);
		assert.strictEqual(result.cases.length, 1);
		assert.strictEqual(result.cases[0].name, 'Тест_Один');
	});

	test('yaxunit: кейсы из ДобавитьТест со строкой объявления метода', () => {
		const content = [
			'Процедура ИсполняемыеСценарии() Экспорт',
			'\tЮТТесты',
			'\t\t.ДобавитьТест("ПроверитьЗаполнение")',
			'\t\t.ДобавитьТест("ПроверитьЗапись");',
			'КонецПроцедуры',
			'',
			'Процедура ПроверитьЗаполнение() Экспорт',
			'КонецПроцедуры',
			'',
			'Процедура ПроверитьЗапись() Экспорт',
			'КонецПроцедуры'
		].join('\n');

		const result = parseBslTestModule(content, 'yaxunit');
		assert.ok(result);
		assert.deepStrictEqual(
			result.cases.map((c) => c.name),
			['ПроверитьЗаполнение', 'ПроверитьЗапись']
		);
		// Строка — объявление метода, а не строка регистрации
		assert.strictEqual(result.cases[0].line, 6);
		assert.strictEqual(result.cases[1].line, 9);
	});

	test('yaxunit: регистрация без одноимённого метода указывает на строку регистрации', () => {
		const content = [
			'Процедура ИсполняемыеСценарии() Экспорт',
			'\tТесты.ДобавитьТест("ВнешнийТест");',
			'КонецПроцедуры'
		].join('\n');

		const result = parseBslTestModule(content, 'yaxunit');
		assert.ok(result);
		assert.strictEqual(result.cases[0].name, 'ВнешнийТест');
		assert.strictEqual(result.cases[0].line, 1);
	});

	test('yaxunit: повторная регистрация одного имени не дублирует кейс', () => {
		const content = [
			'Процедура ИсполняемыеСценарии() Экспорт',
			'\tТесты.ДобавитьТест("Тест1").ДобавитьТест("Тест1");',
			'КонецПроцедуры'
		].join('\n');

		const result = parseBslTestModule(content, 'yaxunit');
		assert.ok(result);
		assert.strictEqual(result.cases.length, 1);
	});

	test('yaxunit: обычный xdd-модуль не распознаётся', () => {
		assert.strictEqual(parseBslTestModule(xddModule, 'yaxunit'), undefined);
	});

	test('пустой тестовый модуль возвращает undefined', () => {
		const content = 'Функция ИсполняемыеСценарии() Экспорт\nКонецФункции';
		assert.strictEqual(parseBslTestModule(content, 'xunit'), undefined);
	});

	test('xunit: аннотационный стиль &Тест (современный 1testrunner)', () => {
		const content = [
			'#Использовать asserts',
			'',
			'// BSLLS:MagicNumber-off',
			'',
			'&Тест',
			'Процедура ТестДолжен_ПроверитьВектор() Экспорт',
			'КонецПроцедуры',
			'',
			'&Тест',
			'// комментарий между аннотацией и объявлением',
			'Процедура ТестДолжен_ПроверитьОчистку() Экспорт',
			'КонецПроцедуры',
			'',
			'Процедура СлужебныйПомощник() Экспорт',
			'\t// экспортный, но без &Тест — не кейс',
			'КонецПроцедуры'
		].join('\n');

		const result = parseBslTestModule(content, 'xunit');
		assert.ok(result, 'Модуль с аннотациями &Тест — тестовый');
		assert.deepStrictEqual(
			result.cases.map((c) => c.name),
			['ТестДолжен_ПроверитьВектор', 'ТестДолжен_ПроверитьОчистку']
		);
		assert.strictEqual(result.cases[0].line, 5, 'Строка — объявление процедуры, не аннотация');
	});

	test('xunit: регистрация через ПолучитьСписокТестов (новый стиль add)', () => {
		const content = [
			'Функция ПолучитьСписокТестов() Экспорт',
			'\tВсеТесты = Новый Массив;',
			'\tВсеТесты.Добавить("ТестДолжен_Работать");',
			'\tВозврат ВсеТесты;',
			'КонецФункции',
			'',
			'Процедура ТестДолжен_Работать() Экспорт',
			'КонецПроцедуры'
		].join('\n');

		const result = parseBslTestModule(content, 'xunit');
		assert.ok(result, 'Модуль с ПолучитьСписокТестов — тестовый');
		assert.deepStrictEqual(
			result.cases.map((c) => c.name),
			['ТестДолжен_Работать'],
			'ПолучитьСписокТестов — служебный метод, не кейс'
		);
	});
});
