import * as assert from 'node:assert';
import {
	BASE_ENV_FILE,
	DEFAULT_PROFILE_ID,
	NOT_SELECTED_LABEL,
	parseEnvFileName,
	buildEnvProfiles,
	resolveActiveEnvFileName,
	activeProfileLabel,
	buildOverrideArgs,
	hasOverrides,
} from '../../shared/envProfiles';

suite('envProfiles', () => {
	test('parseEnvFileName: env.json → профиль «По умолчанию»', () => {
		const profile = parseEnvFileName('env.json');
		assert.ok(profile);
		assert.strictEqual(profile.id, DEFAULT_PROFILE_ID);
		assert.strictEqual(profile.fileName, BASE_ENV_FILE);
		assert.strictEqual(profile.isBase, true);
	});

	test('parseEnvFileName: именованный профиль env.dev.json', () => {
		const profile = parseEnvFileName('env.dev.json');
		assert.ok(profile);
		assert.strictEqual(profile.id, 'dev');
		assert.strictEqual(profile.fileName, 'env.dev.json');
		assert.strictEqual(profile.isBase, false);
	});

	test('parseEnvFileName: многоточечный id env.prod.local.json', () => {
		const profile = parseEnvFileName('env.prod.local.json');
		assert.ok(profile);
		assert.strictEqual(profile.id, 'prod.local');
	});

	test('parseEnvFileName: не env-файлы отбрасываются', () => {
		assert.strictEqual(parseEnvFileName('environment.json'), undefined);
		assert.strictEqual(parseEnvFileName('envx.json'), undefined);
		assert.strictEqual(parseEnvFileName('package.json'), undefined);
		assert.strictEqual(parseEnvFileName('env.json.bak'), undefined);
	});

	test('buildEnvProfiles: пустой список файлов → пусто', () => {
		assert.deepStrictEqual(buildEnvProfiles([]), []);
	});

	test('buildEnvProfiles: только существующие файлы, env.json первым, дедуп', () => {
		const profiles = buildEnvProfiles([
			'env.prod.json',
			'env.dev.json',
			'env.json',
			'env.dev.json', // дубль
			'readme.md',
		]);
		assert.deepStrictEqual(
			profiles.map((p) => p.id),
			[DEFAULT_PROFILE_ID, 'dev', 'prod']
		);
	});

	test('resolveActiveEnvFileName: найденный профиль → его файл', () => {
		const profiles = buildEnvProfiles(['env.json', 'env.dev.json']);
		assert.strictEqual(resolveActiveEnvFileName('dev', profiles), 'env.dev.json');
	});

	test('resolveActiveEnvFileName: неизвестный/пустой id → env.json', () => {
		const profiles = buildEnvProfiles(['env.json', 'env.dev.json']);
		assert.strictEqual(resolveActiveEnvFileName('prod', profiles), BASE_ENV_FILE);
		assert.strictEqual(resolveActiveEnvFileName('', profiles), BASE_ENV_FILE);
		assert.strictEqual(resolveActiveEnvFileName(undefined, profiles), BASE_ENV_FILE);
	});

	test('activeProfileLabel: пустой/неизвестный id → «Не выбран», иначе подпись', () => {
		const profiles = buildEnvProfiles(['env.json', 'env.dev.json']);
		assert.strictEqual(activeProfileLabel('', profiles), NOT_SELECTED_LABEL);
		assert.strictEqual(activeProfileLabel(undefined, profiles), NOT_SELECTED_LABEL);
		assert.strictEqual(activeProfileLabel('prod', profiles), NOT_SELECTED_LABEL);
		assert.strictEqual(activeProfileLabel('dev', profiles), 'dev');
		assert.strictEqual(activeProfileLabel(DEFAULT_PROFILE_ID, profiles), 'По умолчанию');
	});

	test('buildOverrideArgs: только заданные поля', () => {
		assert.deepStrictEqual(buildOverrideArgs(undefined), []);
		assert.deepStrictEqual(buildOverrideArgs({}), []);
		assert.deepStrictEqual(
			buildOverrideArgs({ ibConnection: '/Fbuild/ib', v8version: '8.3.27' }),
			['--ibconnection', '/Fbuild/ib', '--v8version', '8.3.27']
		);
	});

	test('buildOverrideArgs: полный набор полей в ожидаемом порядке', () => {
		assert.deepStrictEqual(
			buildOverrideArgs({
				ibConnection: 'srv',
				dbUser: 'admin',
				dbPwd: 'pwd',
				v8version: '8.3.27',
				additional: '/L ru',
			}),
			['--ibconnection', 'srv', '--db-user', 'admin', '--db-pwd', 'pwd', '--v8version', '8.3.27', '--additional', '/L ru']
		);
	});

	test('hasOverrides: пусто/undefined → false, любое поле → true', () => {
		assert.strictEqual(hasOverrides(undefined), false);
		assert.strictEqual(hasOverrides({}), false);
		assert.strictEqual(hasOverrides({ ibConnection: '' }), false);
		assert.strictEqual(hasOverrides({ v8version: '8.3.27' }), true);
	});
});
