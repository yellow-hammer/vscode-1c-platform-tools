import * as assert from 'node:assert';
import { declaredMethodName, declaresMethod, isMethodDeclaration } from '../../shared/bslDeclaration';
import { findHandlerLine } from '../../features/metadata/formViewerPanel';
import { adjustBreakpointLine } from '../../features/debug/bslBreakpoints';

suite('объявление процедуры и функции', () => {
	test('асинхронное объявление распознаётся на обоих языках', () => {
		assert.strictEqual(declaredMethodName('Асинх Процедура ПриОткрытии(Отказ)'), 'ПриОткрытии');
		assert.strictEqual(declaredMethodName('	Async Function Получить(Ключ) Экспорт'), 'Получить');
		assert.strictEqual(declaredMethodName('Процедура ПриОткрытии(Отказ)'), 'ПриОткрытии');
		assert.strictEqual(declaredMethodName('Function Get(Key)'), 'Get');
	});

	test('не объявление остаётся не объявлением', () => {
		assert.strictEqual(isMethodDeclaration('// Процедура ПриОткрытии(Отказ)'), false);
		assert.strictEqual(isMethodDeclaration('Перем Настройки;'), false);
		assert.strictEqual(isMethodDeclaration('КонецПроцедуры'), false);
		assert.strictEqual(isMethodDeclaration('ПриОткрытии(Отказ);'), false);
	});

	test('имя сверяется без учёта регистра', () => {
		assert.strictEqual(declaresMethod('Асинх Процедура ПриОткрытии(Отказ)', 'приоткрытии'), true);
		assert.strictEqual(declaresMethod('Процедура ПриОткрытииФормы(Отказ)', 'ПриОткрытии'), false);
	});

	test('переход к обработчику находит асинхронный', () => {
		const module = [
			'&НаКлиенте',
			'Асинх Процедура ПодключитьсяКСерверу(Команда)',
			'	Ждать Подключение();',
			'КонецПроцедуры',
		].join('\r\n');

		assert.strictEqual(findHandlerLine(module, 'ПодключитьсяКСерверу'), 1);
	});

	test('точка останова не садится на асинхронный заголовок', () => {
		const lines = [
			'&НаКлиенте',
			'Асинх Процедура ПодключитьсяКСерверу(Команда)',
			'	Ждать Подключение();',
		];

		assert.strictEqual(adjustBreakpointLine(lines, 2), 3);
	});
});
