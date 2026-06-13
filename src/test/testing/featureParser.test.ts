import * as assert from 'node:assert';
import { parseFeatureFile } from '../../features/testing/parsers/featureParser';

suite('featureParser', () => {
	test('разбирает русский feature-файл с функционалом и сценариями', () => {
		const content = [
			'# language: ru',
			'',
			'Функционал: Проверка справочников',
			'',
			'Контекст:',
			'\tДано Я запускаю сценарий открытия TestClient',
			'',
			'Сценарий: Создание элемента справочника',
			'\tКогда Я нажимаю кнопку "Создать"',
			'',
			'Сценарий: Удаление элемента справочника',
			'\tКогда Я нажимаю кнопку "Удалить"'
		].join('\n');

		const result = parseFeatureFile(content);
		assert.ok(result, 'Файл должен быть распознан');
		assert.strictEqual(result.label, 'Проверка справочников');
		assert.strictEqual(result.labelLine, 2);
		assert.strictEqual(result.cases.length, 2);
		assert.strictEqual(result.cases[0].name, 'Создание элемента справочника');
		assert.strictEqual(result.cases[0].line, 7);
		assert.strictEqual(result.cases[1].name, 'Удаление элемента справочника');
		assert.strictEqual(result.cases[1].line, 10);
	});

	test('разбирает английский feature-файл со Scenario Outline', () => {
		const content = [
			'Feature: Catalog checks',
			'',
			'Scenario: Create item',
			'\tWhen I click "Create"',
			'',
			'Scenario Outline: Parameterized check',
			'\tWhen I enter <value>',
			'',
			'Examples:',
			'\t| value |',
			'\t| 1     |'
		].join('\n');

		const result = parseFeatureFile(content);
		assert.ok(result);
		assert.strictEqual(result.label, 'Catalog checks');
		assert.strictEqual(result.cases.length, 2);
		assert.strictEqual(result.cases[1].name, 'Parameterized check');
		assert.strictEqual(result.cases[1].line, 5);
	});

	test('учитывает BOM и CRLF', () => {
		const content = '﻿# language: ru\r\nФункционал: С BOM\r\n\r\nСценарий: Первый\r\n';
		const result = parseFeatureFile(content);
		assert.ok(result);
		assert.strictEqual(result.label, 'С BOM');
		assert.strictEqual(result.cases.length, 1);
		assert.strictEqual(result.cases[0].line, 3);
	});

	test('привязывает теги к следующему сценарию', () => {
		const content = [
			'Функционал: Теги',
			'',
			'@smoke @tree',
			'Сценарий: С тегами',
			'',
			'Сценарий: Без тегов'
		].join('\n');

		const result = parseFeatureFile(content);
		assert.ok(result);
		assert.deepStrictEqual(result.cases[0].tags, ['smoke', 'tree']);
		assert.strictEqual(result.cases[1].tags, undefined);
	});

	test('различает Сценарий и Структура сценария', () => {
		const content = [
			'Функционал: Структуры',
			'',
			'Структура сценария: Параметризованный',
			'\tКогда Я ввожу <значение>'
		].join('\n');

		const result = parseFeatureFile(content);
		assert.ok(result);
		assert.strictEqual(result.cases.length, 1);
		assert.strictEqual(result.cases[0].name, 'Параметризованный');
	});

	test('возвращает undefined для файла без функционала и сценариев', () => {
		assert.strictEqual(parseFeatureFile('# просто комментарий\n\n'), undefined);
		assert.strictEqual(parseFeatureFile(''), undefined);
	});

	test('файл с функционалом без сценариев распознаётся', () => {
		const result = parseFeatureFile('Функционал: Пустой\n');
		assert.ok(result);
		assert.strictEqual(result.cases.length, 0);
	});
});
