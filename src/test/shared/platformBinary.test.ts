import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	is1cVersionDir,
	compare1cVersions,
	platformBinaryFileName,
	pickPlatformVersion,
	expandEnvPlaceholders,
	resolvePlatformVersion,
	resolvePlatformBinary,
	defaultPlatformBasePaths,
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

	test('expandEnvPlaceholders: раскрывает ${env:NAME}', () => {
		process.env.__TEST_1CV8_BASE = path.join('X', '1cv8');
		assert.strictEqual(
			expandEnvPlaceholders('${env:__TEST_1CV8_BASE}/bin'),
			`${path.join('X', '1cv8')}/bin`
		);
		delete process.env.__TEST_1CV8_BASE;
	});

	test('resolvePlatformVersion: сводит префикс профиля к конкретной сборке', () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), '1cv8-'));
		for (const name of ['8.3.23.2040', '8.3.27.1859', '8.3.27.1936', 'common']) {
			fs.mkdirSync(path.join(base, name));
		}
		try {
			assert.strictEqual(resolvePlatformVersion(base, '8.3.27'), '8.3.27.1936');
			assert.strictEqual(resolvePlatformVersion(base), '8.3.27.1936');
			assert.strictEqual(resolvePlatformVersion(base, '8.3.27.1859'), '8.3.27.1859');
			assert.strictEqual(resolvePlatformVersion(base, '8.9'), undefined);
		} finally {
			fs.rmSync(base, { recursive: true, force: true });
		}
	});

	test('resolvePlatformVersion: каталог недоступен → undefined', () => {
		assert.strictEqual(
			resolvePlatformVersion(path.join(os.tmpdir(), 'no-such-1cv8-dir-xyz'), '8.3'),
			undefined
		);
	});

	test('defaultPlatformBasePaths: кандидаты по ОС', () => {
		assert.deepStrictEqual(defaultPlatformBasePaths('linux'), [
			'/opt/1cv8/x86_64',
			'/opt/1C/v8.3/x86_64',
		]);
		const win = defaultPlatformBasePaths('win32');
		assert.strictEqual(win.length, 1);
		assert.ok(win[0].endsWith(path.join('', '1cv8')));
	});

	suite('resolvePlatformBinary (файловые раскладки)', () => {
		let baseDir: string;

		setup(() => {
			baseDir = fs.mkdtempSync(path.join(os.tmpdir(), '1c-platform-'));
		});

		teardown(() => {
			fs.rmSync(baseDir, { recursive: true, force: true });
		});

		const touch = (...segments: string[]): string => {
			const full = path.join(baseDir, ...segments);
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, '');
			return full;
		};

		test('Windows-раскладка: <версия>/bin/ibsrv.exe', () => {
			const expected = touch('8.3.27.1936', 'bin', 'ibsrv.exe');
			touch('8.3.23.2040', 'bin', 'ibsrv.exe');
			assert.strictEqual(
				resolvePlatformBinary(baseDir, 'ibsrv', { platform: 'win32' }),
				expected
			);
		});

		test('Linux .deb-раскладка: <версия>/ibsrv без bin', () => {
			touch('8.3.27.1936', 'ibsrv');
			const expected = touch('8.5.1.1343', 'ibsrv');
			assert.strictEqual(
				resolvePlatformBinary(baseDir, 'ibsrv', { platform: 'linux' }),
				expected
			);
		});

		test('Linux .run-раскладка: ibsrv прямо в базе без каталога версии', () => {
			const expected = touch('ibsrv');
			assert.strictEqual(
				resolvePlatformBinary(baseDir, 'ibsrv', { platform: 'linux' }),
				expected
			);
		});

		test('запрошенная версия выбирается среди каталогов без bin', () => {
			const expected = touch('8.3.27.1936', 'ibsrv');
			touch('8.5.1.1343', 'ibsrv');
			assert.strictEqual(
				resolvePlatformBinary(baseDir, 'ibsrv', {
					platform: 'linux',
					requestedVersion: '8.3.27',
				}),
				expected
			);
		});

		test('каталог версии без бинаря игнорируется', () => {
			fs.mkdirSync(path.join(baseDir, '8.5.1.1343'), { recursive: true });
			const expected = touch('8.3.27.1936', 'ibsrv');
			assert.strictEqual(
				resolvePlatformBinary(baseDir, 'ibsrv', { platform: 'linux' }),
				expected
			);
		});

		test('нет бинаря → undefined', () => {
			fs.mkdirSync(path.join(baseDir, '8.5.1.1343'), { recursive: true });
			assert.strictEqual(
				resolvePlatformBinary(baseDir, 'ibsrv', { platform: 'linux' }),
				undefined
			);
		});

		test('несуществующая база → undefined', () => {
			assert.strictEqual(
				resolvePlatformBinary(path.join(baseDir, 'нет'), 'ibsrv', { platform: 'linux' }),
				undefined
			);
		});
	});
});
