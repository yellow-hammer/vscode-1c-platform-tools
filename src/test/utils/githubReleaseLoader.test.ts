import * as assert from 'node:assert';
import { isNewerTag, updateCheckDue } from '../../shared/githubReleaseLoader';

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

suite('githubReleaseLoader: проверка обновлений', () => {
	const now = 1_000_000_000_000;

	test('без штампа проверяем сразу', () => {
		assert.strictEqual(updateCheckDue(undefined, now), true);
	});

	test('сразу после проверки отдаём кэш', () => {
		assert.strictEqual(updateCheckDue(now - 60_000, now), false);
	});

	test('через восемь минут проверяем снова', () => {
		assert.strictEqual(updateCheckDue(now - 8 * 60_000, now), true);
		assert.strictEqual(updateCheckDue(now - 60 * 60_000, now), true);
	});
});
