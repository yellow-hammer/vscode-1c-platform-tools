import * as assert from 'node:assert';
import {
	ENV_OPTIONAL_SECTIONS,
	mergeEnvSections,
	AUTUMN_OPTIONAL_SECTIONS,
	mergeAutumnSections,
} from '../../features/serviceFiles/envSections';

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

	suite('autumn (v3)', () => {
		const autumnBase = { vrunner: { ibconnection: '/F./build/ib' } };

		test('без выбора — только базовый vrunner', () => {
			const result = mergeAutumnSections(autumnBase, []) as { vrunner: Record<string, unknown> };
			assert.deepStrictEqual(Object.keys(result.vrunner), ['ibconnection']);
		});

		test('секции вкладываются в каскад vrunner.test/validate', () => {
			const result = mergeAutumnSections(autumnBase, ['vanessa', 'xunit', 'syntax-check']) as {
				vrunner: { ibconnection: string; test: { vanessa: unknown; xunit: unknown }; validate: { 'syntax-check': unknown } };
			};
			assert.strictEqual(result.vrunner.ibconnection, '/F./build/ib', 'база не потеряна');
			assert.ok(result.vrunner.test.vanessa, 'vrunner.test.vanessa');
			assert.ok(result.vrunner.test.xunit, 'vrunner.test.xunit');
			assert.ok(result.vrunner.validate['syntax-check'], 'vrunner.validate.syntax-check');
		});

		test('невыбранная секция отсутствует; база не мутируется', () => {
			const result = mergeAutumnSections(autumnBase, ['vanessa']) as {
				vrunner: { test: { vanessa: unknown; xunit?: unknown } };
			};
			assert.ok(result.vrunner.test.vanessa);
			assert.strictEqual(result.vrunner.test.xunit, undefined);
			assert.deepStrictEqual(Object.keys(autumnBase.vrunner), ['ibconnection'], 'исходный объект не изменён');
		});

		test('формат v3: bddrunner-path, jUnit{}/allure{}, mode без дефиса', () => {
			const vanessa = AUTUMN_OPTIONAL_SECTIONS.find((s) => s.id === 'vanessa')!;
			assert.ok('bddrunner-path' in vanessa.section, 'опция bddrunner-path (не pathvanessa)');
			const xunit = AUTUMN_OPTIONAL_SECTIONS.find((s) => s.id === 'xunit')!;
			assert.ok(String(xunit.section.reportsxunit).includes('jUnit{'), 'генератор jUnit{}');
			const syntax = AUTUMN_OPTIONAL_SECTIONS.find((s) => s.id === 'syntax-check')!;
			assert.ok((syntax.section.mode as string[]).every((m) => !m.startsWith('-')), 'режимы без ведущего -');
		});
	});
});
