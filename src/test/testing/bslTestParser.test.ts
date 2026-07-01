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

	test('xunit: параметризованный тест разворачивается в кейс на каждый ИсточникЗначение', () => {
		const content = [
			'#Использовать asserts',
			'',
			'&ПараметризованныйТест',
			'&ИсточникЗначение("ibcmd")',
			'&ИсточникЗначение("designer")',
			'Процедура ТестДолжен_СобратьКонфигурацию(Режим) Экспорт',
			'КонецПроцедуры',
			'',
			'&Тест',
			'Процедура ТестДолжен_СобратьИзБазы() Экспорт',
			'КонецПроцедуры'
		].join('\n');

		const result = parseBslTestModule(content, 'xunit');
		assert.ok(result, 'Модуль с &ПараметризованныйТест — тестовый');
		assert.deepStrictEqual(
			result.cases.map((c) => c.name),
			['[ibcmd]', '[designer]', 'ТестДолжен_СобратьИзБазы'],
			'Имена совпадают с jUnit-отчётом OneUnit ([значение])'
		);
		// Параметризованные кейсы указывают на объявление процедуры и несут её имя
		assert.strictEqual(result.cases[0].line, 5);
		assert.strictEqual(result.cases[1].line, 5);
		assert.strictEqual(result.cases[0].methodName, 'ТестДолжен_СобратьКонфигурацию');
		assert.strictEqual(result.cases[1].methodName, 'ТестДолжен_СобратьКонфигурацию');
		// Обычный &Тест: methodName совпадает с именем, отдельный запуск не нужен
		assert.strictEqual(result.cases[2].name, 'ТестДолжен_СобратьИзБазы');
	});

	test('xunit: шаблон имени и ОтображаемоеИмя параметризованного теста', () => {
		const content = [
			'&ПараметризованныйТест("{ОтображаемоеИмя}({Параметры})")',
			'&ОтображаемоеИмя("Сложение")',
			'&ИсточникЗначение(1, 2)',
			'Процедура ТестСложения(А, Б) Экспорт',
			'КонецПроцедуры'
		].join('\n');

		const result = parseBslTestModule(content, 'xunit');
		assert.ok(result);
		assert.deepStrictEqual(
			result.cases.map((c) => c.name),
			['Сложение([1, 2])']
		);
		assert.strictEqual(result.cases[0].methodName, 'ТестСложения');
	});

	test('xunit: файл только с параметризованными тестами распознаётся', () => {
		const content = [
			'&ПараметризованныйТест',
			'&ИсточникЗначение("a")',
			'Процедура Тест(Значение) Экспорт',
			'КонецПроцедуры'
		].join('\n');

		assert.strictEqual(isBslTestModule(content, 'xunit'), true);
		const result = parseBslTestModule(content, 'xunit');
		assert.ok(result);
		assert.deepStrictEqual(result.cases.map((c) => c.name), ['[a]']);
	});

	test('xunit: параметризованный тест без ИсточникЗначение — один кейс по имени метода', () => {
		const content = [
			'&ПараметризованныйТест',
			'&ИсточникJSON("[[1],[2]]")',
			'Процедура ТестИзJson(Значение) Экспорт',
			'КонецПроцедуры'
		].join('\n');

		const result = parseBslTestModule(content, 'xunit');
		assert.ok(result);
		assert.deepStrictEqual(result.cases.map((c) => c.name), ['ТестИзJson']);
	});

	test('xunit: &ОтображаемоеИмя переопределяет имя обычного &Тест', () => {
		const content = [
			'&Тест',
			'&ОтображаемоеИмя("Человекочитаемое имя")',
			'Процедура ЯТест() Экспорт',
			'КонецПроцедуры'
		].join('\n');

		const result = parseBslTestModule(content, 'xunit');
		assert.ok(result);
		assert.strictEqual(result.cases[0].name, 'Человекочитаемое имя');
		assert.strictEqual(result.cases[0].methodName, 'ЯТест');
	});

	test('xunit: &ТестовыйНабор не принимается за &Тест', () => {
		const content = [
			'&ТестовыйНабор',
			'Процедура НеТест() Экспорт',
			'КонецПроцедуры'
		].join('\n');

		// Нет ни ИсполняемыеСценарии, ни &Тест/&ПараметризованныйТест — не тестовый модуль
		assert.strictEqual(parseBslTestModule(content, 'xunit'), undefined);
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
