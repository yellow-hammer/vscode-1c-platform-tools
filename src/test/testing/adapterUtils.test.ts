import * as assert from 'node:assert';
import * as path from 'node:path';
import { normalizeGlobBase, directorySegments } from '../../features/testing/adapters/adapterUtils';

const ROOT = path.join('C:', 'proj');

suite('adapterUtils', () => {
	test('normalizeGlobBase убирает ./ и завершающие слэши', () => {
		assert.strictEqual(normalizeGlobBase('./features'), 'features');
		assert.strictEqual(normalizeGlobBase('features/'), 'features');
		assert.strictEqual(normalizeGlobBase('.\\tests\\unit'), 'tests/unit');
		assert.strictEqual(normalizeGlobBase('.'), '*');
		assert.strictEqual(normalizeGlobBase(''), '*');
	});

	test('directorySegments: файл в подкаталоге базы', () => {
		assert.deepStrictEqual(
			directorySegments(path.join(ROOT, 'features', 'init', 'Файл.feature'), './features', ROOT),
			['init']
		);
		assert.deepStrictEqual(
			directorySegments(
				path.join(ROOT, 'features', 'Подсистема', 'Объект', 'Файл.feature'),
				'./features',
				ROOT
			),
			['Подсистема', 'Объект']
		);
	});

	test('directorySegments: файл прямо в базе — пусто', () => {
		assert.deepStrictEqual(
			directorySegments(path.join(ROOT, 'features', 'Файл.feature'), './features', ROOT),
			[]
		);
	});

	test('directorySegments: файл вне базы — пусто', () => {
		assert.deepStrictEqual(
			directorySegments(path.join(ROOT, 'other', 'Файл.feature'), './features', ROOT),
			[]
		);
	});
});
