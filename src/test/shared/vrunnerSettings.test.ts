import * as assert from 'node:assert';
import { settingValue } from '../../shared/vrunnerSettings';

suite('vrunnerSettings', () => {
	test('settingValue: каскад 3.x для vanessa', () => {
		assert.strictEqual(
			settingValue({
				vrunner: { test: { vanessa: { 'bddrunner-path': './a.epf' } } },
			}, 'v3', 'vanessa', 'bddrunner-path'),
			'./a.epf'
		);
	});

	test('settingValue: 2.x секция vanessa с --pathvanessa', () => {
		assert.strictEqual(
			settingValue({
				vanessa: { '--pathvanessa': './b.epf' },
			}, 'v2', 'vanessa', 'pathvanessa'),
			'./b.epf'
		);
	});
});
