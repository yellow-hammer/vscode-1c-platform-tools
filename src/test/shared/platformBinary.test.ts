import * as assert from 'node:assert';
import {
	is1cVersionDir,
	compare1cVersions,
	platformBinaryFileName,
	pickPlatformVersion,
} from '../../shared/platformBinary';

suite('platformBinary', () => {
	test('is1cVersionDir: только каталоги версий', () => {
		assert.strictEqual(is1cVersionDir('8.3.27.1936'), true);
		assert.strictEqual(is1cVersionDir('8.5.1.1150'), true);
		assert.strictEqual(is1cVersionDir('common'), false);
		assert.strictEqual(is1cVersionDir('8.3.27'), false);
		assert.strictEqual(is1cVersionDir('conf'), false);
	});

	test('compare1cVersions: посегментно числом', () => {
		assert.strictEqual(compare1cVersions('8.3.27.1859', '8.3.27.1936'), -1);
		assert.strictEqual(compare1cVersions('8.5.1.1150', '8.3.27.1936'), 1);
		assert.strictEqual(compare1cVersions('8.3.27.1936', '8.3.27.1936'), 0);
		// числовое, а не лексикографическое: 1936 > 999
		assert.strictEqual(compare1cVersions('8.3.27.1936', '8.3.27.999'), 1);
	});

	test('platformBinaryFileName: расширение по ОС', () => {
		assert.strictEqual(platformBinaryFileName('ibsrv', 'win32'), 'ibsrv.exe');
		assert.strictEqual(platformBinaryFileName('ibcmd', 'win32'), 'ibcmd.exe');
		assert.strictEqual(platformBinaryFileName('ibsrv', 'linux'), 'ibsrv');
	});

	test('pickPlatformVersion: наибольшая при отсутствии запроса', () => {
		const versions = ['8.3.23.2040', '8.3.27.1859', '8.3.27.1936', '8.5.1.1150', 'common'];
		assert.strictEqual(pickPlatformVersion(versions), '8.5.1.1150');
	});

	test('pickPlatformVersion: точный запрос', () => {
		const versions = ['8.3.23.2040', '8.3.27.1859', '8.3.27.1936', '8.5.1.1150'];
		assert.strictEqual(pickPlatformVersion(versions, '8.3.27.1859'), '8.3.27.1859');
	});

	test('pickPlatformVersion: префиксный запрос → наибольшая подходящая', () => {
		const versions = ['8.3.23.2040', '8.3.27.1859', '8.3.27.1936', '8.5.1.1150'];
		assert.strictEqual(pickPlatformVersion(versions, '8.3.27'), '8.3.27.1936');
	});

	test('pickPlatformVersion: нет подходящих → undefined', () => {
		assert.strictEqual(pickPlatformVersion(['common', 'conf']), undefined);
		assert.strictEqual(pickPlatformVersion(['8.3.27.1936'], '8.4'), undefined);
	});
});
