import * as assert from 'node:assert';
import {
	BASE_ENV_FILE,
	DEFAULT_PROFILE_ID,
	LOCAL_OVERRIDES_FILE,
	NO_SETTINGS_LABEL,
	parseEnvFileName,
	buildEnvProfiles,
	resolveActiveEnvFileName,
	activeProfileLabel,
	buildOverrideArgs,
	hasOverrides,
	mergeEnvOverrides,
	parseLocalOverrides,
	detectSettingsFormat,
} from '../../shared/envProfiles';

suite('envProfiles', () => {
	test('parseEnvFileName (v3): autumn-properties.json — базовый, именованные через .<id>.', () => {
		const base = parseEnvFileName('autumn-properties.json', 'v3');
		assert.ok(base);
		assert.strictEqual(base.isBase, true);
		assert.strictEqual(base.fileName, 'autumn-properties.json');

		const dev = parseEnvFileName('autumn-properties.dev.json', 'v3');
		assert.ok(dev);
		assert.strictEqual(dev.id, 'dev');
		assert.strictEqual(dev.isBase, false);

		// файлы другой схемы не распознаются
		assert.strictEqual(parseEnvFileName('env.json', 'v3'), undefined);
		assert.strictEqual(parseEnvFileName('autumn-properties.json', 'v2'), undefined);
	});

	test('buildEnvProfiles (v3): собирает только autumn-профили', () => {
		const profiles = buildEnvProfiles(
			['env.json', 'autumn-properties.json', 'autumn-properties.ci.json', 'tools.json'],
			'v3'
		);
		assert.deepStrictEqual(profiles.map((p) => p.fileName), ['autumn-properties.json', 'autumn-properties.ci.json']);
	});

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

	test('parseEnvFileName: env.local.json — файл перекрытий, а не профиль', () => {
		assert.strictEqual(parseEnvFileName(LOCAL_OVERRIDES_FILE), undefined);
		assert.strictEqual(parseEnvFileName(LOCAL_OVERRIDES_FILE, 'v3'), undefined);
		assert.deepStrictEqual(
			buildEnvProfiles(['env.json', LOCAL_OVERRIDES_FILE, 'env.dev.json']).map((p) => p.id),
			[DEFAULT_PROFILE_ID, 'dev']
		);
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

	test('activeProfileLabel: файла активного профиля нет → «Нет файла настроек», иначе подпись', () => {
		const profiles = buildEnvProfiles(['env.json', 'env.dev.json']);
		assert.strictEqual(activeProfileLabel('', profiles), NO_SETTINGS_LABEL);
		assert.strictEqual(activeProfileLabel(undefined, profiles), NO_SETTINGS_LABEL);
		assert.strictEqual(activeProfileLabel('prod', profiles), NO_SETTINGS_LABEL);
		assert.strictEqual(activeProfileLabel('dev', profiles), 'dev');
		assert.strictEqual(activeProfileLabel(DEFAULT_PROFILE_ID, profiles), 'По умолчанию');
		// Базового файла нет — «По умолчанию» не среди профилей → нет файла настроек
		assert.strictEqual(activeProfileLabel(DEFAULT_PROFILE_ID, buildEnvProfiles([])), NO_SETTINGS_LABEL);
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

suite('parseLocalOverrides', () => {
	test('плоский формат с флагами vrunner', () => {
		const { overrides, ignoredKeys } = parseLocalOverrides({
			'--ibconnection': '/F./build/${gitBranch}',
			'--db-user': 'admin',
			'--v8version': '8.3.27',
		});
		assert.deepStrictEqual(overrides, {
			ibConnection: '/F./build/${gitBranch}',
			dbUser: 'admin',
			v8version: '8.3.27',
		});
		assert.deepStrictEqual(ignoredKeys, []);
	});

	test('имена ключей принимаются без префикса --', () => {
		const { overrides } = parseLocalOverrides({ ibconnection: '/Fbuild/ib', 'db-pwd': 'секрет' });
		assert.deepStrictEqual(overrides, { ibConnection: '/Fbuild/ib', dbPwd: 'секрет' });
	});

	test('обёртки default (2.x) и vrunner (3.x) принимаются', () => {
		const v2 = parseLocalOverrides({ default: { '--ibconnection': '/Fx' } });
		assert.deepStrictEqual(v2.overrides, { ibConnection: '/Fx' });

		const v3 = parseLocalOverrides({ vrunner: { ibconnection: '/Fy', additional: '/L ru' } });
		assert.deepStrictEqual(v3.overrides, { ibConnection: '/Fy', additional: '/L ru' });
	});

	test('неподдержанные и нестроковые ключи попадают в ignoredKeys', () => {
		const { overrides, ignoredKeys } = parseLocalOverrides({
			$schema: 'https://example/schema.json',
			'--ibconnection': '/Fx',
			'--root': '.',
			'--ordinaryapp': 1,
		});
		assert.deepStrictEqual(overrides, { ibConnection: '/Fx' });
		assert.deepStrictEqual(ignoredKeys, ['--root', '--ordinaryapp']);
	});

	test('пустые строки означают «не перекрывать» и не считаются ошибкой', () => {
		const { overrides, ignoredKeys } = parseLocalOverrides({ '--db-user': '', '--v8version': '  ' });
		assert.deepStrictEqual(overrides, {});
		assert.deepStrictEqual(ignoredKeys, []);
	});

	test('не объект → пустые перекрытия', () => {
		assert.deepStrictEqual(parseLocalOverrides(undefined).overrides, {});
		assert.deepStrictEqual(parseLocalOverrides('строка').overrides, {});
		assert.deepStrictEqual(parseLocalOverrides([1, 2]).overrides, {});
		assert.deepStrictEqual(parseLocalOverrides(null).overrides, {});
	});
});

suite('mergeEnvOverrides', () => {
	test('непустые поля верхнего слоя побеждают', () => {
		const merged = mergeEnvOverrides(
			{ ibConnection: '/Fbase', dbUser: 'base', v8version: '8.3.25' },
			{ ibConnection: '/Fover', dbUser: '' }
		);
		assert.deepStrictEqual(merged, { ibConnection: '/Fover', dbUser: 'base', v8version: '8.3.25' });
	});

	test('undefined-слои переживаются, пустой результат → undefined', () => {
		assert.deepStrictEqual(mergeEnvOverrides(undefined, { dbUser: 'x' }), { dbUser: 'x' });
		assert.deepStrictEqual(mergeEnvOverrides({ dbUser: 'x' }, undefined), { dbUser: 'x' });
		assert.strictEqual(mergeEnvOverrides(undefined, undefined), undefined);
		assert.strictEqual(mergeEnvOverrides({}, { ibConnection: '' }), undefined);
	});

	test('последовательное слияние даёт приоритет UI > env.local.json > профиль', () => {
		const profile = { ibConnection: '/F./build/${gitBranch}', v8version: '8.3.25' };
		const local = { ibConnection: '/Flocal', dbUser: 'local' };
		const ui = { dbUser: 'ui' };
		const merged = mergeEnvOverrides(mergeEnvOverrides(profile, local), ui);
		assert.deepStrictEqual(merged, {
			ibConnection: '/Flocal',
			dbUser: 'ui',
			v8version: '8.3.25',
		});
	});
});

suite('detectSettingsFormat', () => {
	test('корневой ключ vrunner означает формат 3.x', () => {
		assert.strictEqual(detectSettingsFormat({ vrunner: { 'test.epf': {} } }), 'v3');
	});

	test('плоские секции означают формат 2.x', () => {
		assert.strictEqual(detectSettingsFormat({ default: { v8version: '8.3.25' } }), 'v2');
	});

	test('пустой объект считается форматом 2.x', () => {
		// пустой env.json допустим: секции добавляются по мере надобности
		assert.strictEqual(detectSettingsFormat({}), 'v2');
	});

	test('не объект форматом настроек не считается', () => {
		assert.strictEqual(detectSettingsFormat(null), 'unknown');
		assert.strictEqual(detectSettingsFormat([1, 2]), 'unknown');
		assert.strictEqual(detectSettingsFormat('строка'), 'unknown');
		assert.strictEqual(detectSettingsFormat(undefined), 'unknown');
	});
});
