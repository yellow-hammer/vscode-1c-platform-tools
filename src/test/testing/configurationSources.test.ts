import * as assert from 'node:assert';
import * as path from 'node:path';
import { configurationSourcesIn } from '../../features/testing/adapters/xunitAdapter';

const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');

suite('исходники конфигурации для выбора владельца фич', () => {
	test('проект EDT на уровень ниже корня считается конфигурацией', () => {
		assert.strictEqual(configurationSourcesIn(path.join(FIXTURES, 'edt-workspace'), 'src/cf'), true);
	});

	test('корень самого проекта EDT считается конфигурацией', () => {
		assert.strictEqual(configurationSourcesIn(path.join(FIXTURES, 'edt-workspace', 'ssl31'), 'src/cf'), true);
	});

	test('без выгрузки и без проекта EDT конфигурации нет', () => {
		assert.strictEqual(configurationSourcesIn(path.resolve(__dirname, '../../../src/test/fixtures/infobases'), 'src/cf'), false);
	});
});
