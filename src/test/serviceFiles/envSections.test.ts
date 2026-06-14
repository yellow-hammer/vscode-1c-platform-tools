import * as assert from 'node:assert';
import { ENV_OPTIONAL_SECTIONS, mergeEnvSections } from '../../features/serviceFiles/envSections';

suite('serviceFiles/envSections', () => {
	const base = { $schema: 'x', default: { '--v8version': '8.3' } };

	test('без выбора — только базовые ключи', () => {
		const result = mergeEnvSections(base, []);
		assert.deepStrictEqual(Object.keys(result), ['$schema', 'default']);
	});

	test('выбранные секции добавляются по своим ключам', () => {
		const result = mergeEnvSections(base, ['vanessa', 'syntax-check']);
		assert.ok(result.vanessa, 'должна быть секция vanessa');
		assert.ok(result['syntax-check'], 'должна быть секция syntax-check');
		assert.strictEqual(result.xunit, undefined, 'невыбранная секция не добавляется');
	});

	test('неизвестные id игнорируются, база не теряется', () => {
		const result = mergeEnvSections(base, ['unknown']);
		assert.deepStrictEqual(Object.keys(result), ['$schema', 'default']);
	});

	test('каждая опция имеет id, label, непустую секцию', () => {
		for (const option of ENV_OPTIONAL_SECTIONS) {
			assert.ok(option.id && option.label, 'id и label заданы');
			assert.ok(Object.keys(option.section).length > 0, `секция ${option.id} не пуста`);
		}
	});
});
