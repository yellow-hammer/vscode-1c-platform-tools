import * as assert from 'node:assert';
import { parseInfobaseExtensionsList } from '../../features/extensions/infobaseExtensionsList';

suite('infobaseExtensionsList', () => {
	test('JSON-массив с полем имя, как печатает vanessa-runner 3', () => {
		const stdout = `[
 {
  "имя": "Зарплата",
  "синоним": "Зарплата",
  "версия": "1.0.0.1",
  "хэш": "aabb",
  "активно": true,
  "безопасныйРежим": false,
  "защитаОтОпасныхДействий": true,
  "основныеРолиДляВсех": null
 },
 {
  "имя": "Бюджет",
  "синоним": "Бюджет"
 }
]`;
		assert.deepStrictEqual(parseInfobaseExtensionsList(stdout), ['Зарплата', 'Бюджет']);
	});

	test('массив вырезается из журнала вокруг JSON', () => {
		const stdout = [
			'INFOS - Запуск предприятия',
			'[{"имя":"Ext1"},{"name":"Ext2"}]',
			'INFOS - Команда завершена'
		].join('\n');
		assert.deepStrictEqual(parseInfobaseExtensionsList(stdout), ['Ext1', 'Ext2']);
	});

	test('пустой JSON-массив — расширений нет', () => {
		assert.deepStrictEqual(parseInfobaseExtensionsList('[]'), []);
	});

	test('текстовый режим: по одному имени на строку, журнал отбрасывается', () => {
		const stdout = [
			'INFOS - list',
			'Зарплата',
			'Бюджет',
			'Установленных расширений нет — это не имя'
		].join('\n');
		assert.deepStrictEqual(parseInfobaseExtensionsList('Зарплата\nБюджет'), ['Зарплата', 'Бюджет']);
		assert.deepStrictEqual(parseInfobaseExtensionsList(stdout), ['Зарплата', 'Бюджет']);
	});

	test('сообщение «установленных расширений нет» без JSON — пустой список', () => {
		assert.deepStrictEqual(
			parseInfobaseExtensionsList('Установленных расширений нет'),
			[]
		);
	});

	test('скобка в журнале не мешает найти JSON дальше по выводу', () => {
		const stdout = [
			'ИНФОРМАЦИЯ - Используется версия платформы 8.3.27.2214 [сборка]',
			'ИНФОРМАЦИЯ - [',
			' {',
			'  "имя": "Зарплата"',
			' }',
			']',
			'ИНФОРМАЦИЯ - Работа завершена'
		].join('\n');
		assert.deepStrictEqual(parseInfobaseExtensionsList(stdout), ['Зарплата']);
	});

	test('скобка без JSON не ломает разбор: остаётся построчный режим', () => {
		const stdout = ['ИНФОРМАЦИЯ - список [неполный', 'Зарплата', 'Бюджет'].join('\n');
		assert.deepStrictEqual(parseInfobaseExtensionsList(stdout), ['Зарплата', 'Бюджет']);
	});
});
