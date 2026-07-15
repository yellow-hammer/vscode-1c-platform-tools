import * as assert from 'node:assert';
import { isBelowMinVersion, isNewerTag } from '../../shared/githubReleaseLoader';

suite('githubReleaseLoader.isNewerTag', () => {
	test('новее по patch/minor/major', () => {
		assert.strictEqual(isNewerTag('0.2.0', '0.1.9'), true);
		assert.strictEqual(isNewerTag('0.10.0', '0.9.9'), true);
		assert.strictEqual(isNewerTag('1.0.0', '0.99.99'), true);
	});

	test('игнорирует префикс v и смешение v/без-v', () => {
		assert.strictEqual(isNewerTag('v0.2.0', '0.1.0'), true);
		assert.strictEqual(isNewerTag('0.2.0', 'v0.2.0'), false);
	});

	test('равные и более старые — не новее', () => {
		assert.strictEqual(isNewerTag('1.2.3', '1.2.3'), false);
		assert.strictEqual(isNewerTag('1.2.2', '1.2.3'), false);
	});

	test('нечисловые теги — по строковому неравенству', () => {
		assert.strictEqual(isNewerTag('nightly', 'nightly'), false);
		assert.strictEqual(isNewerTag('nightly-2', 'nightly-1'), true);
	});
});

suite('githubReleaseLoader: минимальная версия компонента', () => {
	test('кэш старее требуемой версии считается негодным', () => {
		assert.strictEqual(isBelowMinVersion('v0.3.2', '0.4.0'), true);
		assert.strictEqual(isBelowMinVersion('0.3.9', '0.4.0'), true);
	});

	test('кэш нужной версии и новее годится', () => {
		assert.strictEqual(isBelowMinVersion('v0.4.0', '0.4.0'), false);
		assert.strictEqual(isBelowMinVersion('v0.4.1', '0.4.0'), false);
		assert.strictEqual(isBelowMinVersion('v1.0.0', '0.4.0'), false);
	});

	test('без требования подходит любой тег', () => {
		assert.strictEqual(isBelowMinVersion('v0.0.1', undefined), false);
	});
});
