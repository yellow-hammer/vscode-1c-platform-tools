import * as assert from 'node:assert';
import { resolveUpdateDb } from '../../features/configuration/updateDbDecision';

suite('обновление конфигурации БД после загрузки', () => {
	test('явное значение из опций сильнее настройки', () => {
		assert.strictEqual(resolveUpdateDb('never', true, false), 'update');
		assert.strictEqual(resolveUpdateDb('always', false, false), 'loadOnly');
		assert.strictEqual(resolveUpdateDb('ask', true, true), 'update');
	});

	test('заданная настройка убирает вопрос', () => {
		assert.strictEqual(resolveUpdateDb('always', undefined, true), 'update');
		assert.strictEqual(resolveUpdateDb('never', undefined, true), 'loadOnly');
	});

	test('вопрос задаётся только интерактивному запуску', () => {
		assert.strictEqual(resolveUpdateDb('ask', undefined, true), 'ask');
	});

	test('агент, цепочка и хук вопроса не получают', () => {
		// Висящее окно в неинтерактивном вызове нажать некому: команда просто загружает.
		assert.strictEqual(resolveUpdateDb('ask', undefined, false), 'loadOnly');
	});
});
