import * as assert from 'node:assert';
import { pickerFor } from '../../features/profileEditor/valuePickers';

suite('Подбор значений параметров профиля', () => {
	test('строка подключения подбирается в обеих схемах настроек', () => {
		assert.strictEqual(pickerFor('ibconnection')?.label, 'Выбрать базу…', 'схема 3.x: ключ без префикса');
		assert.strictEqual(pickerFor('--ibconnection')?.label, 'Выбрать базу…', 'схема 2.x: ключ с префиксом');
	});

	test('у остальных параметров подбора нет, они вписываются руками', () => {
		assert.strictEqual(pickerFor('db-user'), undefined);
		assert.strictEqual(pickerFor('--v8version'), undefined);
		assert.strictEqual(pickerFor(''), undefined);
	});
});
