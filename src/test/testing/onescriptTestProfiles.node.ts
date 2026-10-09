/**
 * Профили переменных среды тестов OneScript.
 * Запуск: npm run test:node
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
	mergeOnescriptProfileFiles,
	nextOnescriptProfilesLoad,
	parseOnescriptProfileFile,
	type OnescriptProfileFile,
} from '../../features/testing/onescriptEnv/profilesFile';
import { envForAdapter, resolveOnescriptLayers } from '../../features/testing/onescriptEnv/resolveEnv';

const COMMON = `{
  "env": { "TZ": "UTC" },
  "profiles": {
    "sqlite": {
      "description": "Только SQLite",
      "env": {
        "TESTRUNNER_RUN_SQLITE_TESTS": true,
        "TESTRUNNER_RUN_POSTGRES_TESTS": false,
        "POSTGRES_HOST": null
      }
    },
    "postgres": {
      "description": "PostgreSQL",
      "env": {
        "TESTRUNNER_RUN_SQLITE_TESTS": false,
        "TESTRUNNER_RUN_POSTGRES_TESTS": true,
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": 5432,
        "POSTGRES_DATABASE": "entity_\${gitBranch}"
      }
    }
  }
}`;

const LOCAL = `{
  "env": { "TZ": "Europe/Moscow" },
  "profiles": {
    "postgres": {
      "env": {
        "POSTGRES_USERNAME": "vladimir",
        "POSTGRES_PASSWORD": "secret"
      }
    }
  }
}`;

function files(): { common: OnescriptProfileFile; local: OnescriptProfileFile } {
	const common = parseOnescriptProfileFile(COMMON);
	const local = parseOnescriptProfileFile(LOCAL);
	assert.ok(!('error' in common));
	assert.ok(!('error' in local));
	if ('error' in common || 'error' in local) {
		throw new Error('разбор');
	}
	return { common, local };
}

describe('parseOnescriptProfileFile', () => {
	test('OVM_OSCRIPTBIN отвергается, PATH принимается', () => {
		const rejected = parseOnescriptProfileFile('{"profiles":{"a":{"env":{"OVM_OSCRIPTBIN":"C:\\\\evil"}}}}');
		assert.equal('error' in rejected, true);
		const accepted = parseOnescriptProfileFile('{"profiles":{"a":{"env":{"PATH":"C:\\\\lib"}}}}');
		assert.equal('error' in accepted, false);
	});

	test('одинаковые имена после обрезки пробелов — ошибка', () => {
		const parsed = parseOnescriptProfileFile('{"profiles":{"a":{"env":{}},"a ":{"env":{}}}}');
		assert.deepEqual(parsed, { error: 'Профиль «a» задан дважды' });
	});
});

describe('resolveOnescriptLayers', () => {
	test('личный файл перекрывает общий, null снимает переменную, число становится строкой', () => {
		const { common, local } = files();
		const sqlite = resolveOnescriptLayers({
			processEnv: { POSTGRES_HOST: 'global', TZ: 'local', PATH: 'C:\\bin' },
			common,
			local,
			profileName: 'sqlite',
			gitBranch: 'feature-x',
			engineBinDir: undefined,
		});
		assert.ok(!('error' in sqlite));
		if ('error' in sqlite) {
			return;
		}
		assert.equal(sqlite.env.TZ, 'Europe/Moscow');
		assert.equal(sqlite.env.TESTRUNNER_RUN_SQLITE_TESTS, 'true');
		assert.equal(sqlite.env.TESTRUNNER_RUN_POSTGRES_TESTS, 'false');
		assert.equal(sqlite.env.POSTGRES_HOST, undefined);
		assert.equal(sqlite.env.PATH, 'C:\\bin');

		const postgres = resolveOnescriptLayers({
			processEnv: { POSTGRES_HOST: 'global', PATH: 'C:\\bin' },
			common,
			local,
			profileName: 'postgres',
			gitBranch: 'feature-x',
			engineBinDir: 'C:\\oscript\\bin',
		});
		assert.ok(!('error' in postgres));
		if ('error' in postgres) {
			return;
		}
		assert.equal(postgres.env.POSTGRES_HOST, 'localhost');
		assert.equal(postgres.env.POSTGRES_PORT, '5432');
		assert.equal(postgres.env.POSTGRES_DATABASE, 'entity_feature-x');
		assert.equal(postgres.env.POSTGRES_USERNAME, 'vladimir');
		assert.equal(postgres.env.POSTGRES_PASSWORD, 'secret');
		assert.equal(postgres.env.TESTRUNNER_RUN_SQLITE_TESTS, 'false');
		assert.ok(String(postgres.env.PATH).startsWith('C:\\oscript\\bin'));
	});

	test('на Windows имя в другом регистре не создаёт вторую переменную', () => {
		const parsed = parseOnescriptProfileFile('{"profiles":{"a":{"env":{"postgres_host":"local"}}}}');
		assert.ok(!('error' in parsed));
		if ('error' in parsed) {
			return;
		}
		const resolved = resolveOnescriptLayers({
			processEnv: { POSTGRES_HOST: 'global' },
			common: parsed,
			local: undefined,
			profileName: 'a',
			gitBranch: undefined,
			engineBinDir: undefined,
		});
		assert.ok(!('error' in resolved));
		if ('error' in resolved) {
			return;
		}
		if (process.platform === 'win32') {
			assert.equal(resolved.env.POSTGRES_HOST, 'local');
			assert.equal(resolved.env.postgres_host, undefined);
		} else {
			assert.equal(resolved.env.postgres_host, 'local');
		}
	});

	test('${gitBranch} подставляется, неизвестная подстановка — ошибка', () => {
		const parsed = parseOnescriptProfileFile('{"profiles":{"a":{"env":{"X":"${foo}"}}}}');
		assert.ok(!('error' in parsed));
		if ('error' in parsed) {
			return;
		}
		const resolved = resolveOnescriptLayers({
			processEnv: {},
			common: parsed,
			local: undefined,
			profileName: 'a',
			gitBranch: 'main',
			engineBinDir: undefined,
		});
		assert.deepEqual(resolved, { error: 'Неизвестная подстановка ${foo}' });
	});

	test('выбранный профиль отсутствует — отказ', () => {
		const resolved = resolveOnescriptLayers({
			processEnv: {},
			common: { env: {}, profiles: {} },
			local: undefined,
			profileName: 'postgres',
			gitBranch: undefined,
			engineBinDir: undefined,
		});
		assert.deepEqual(resolved, { error: 'Профиль postgres не найден' });
	});
});

describe('nextOnescriptProfilesLoad', () => {
	test('файл не разбирается — отказ и прежние профили на месте', () => {
		const previous = mergeOnescriptProfileFiles(
			{ env: {}, profiles: { sqlite: { env: { A: '1' } } } },
			undefined
		);
		const next = nextOnescriptProfilesLoad(
			previous,
			{ kind: 'error', error: 'Файл профилей тестов OneScript не разобран' },
			{ kind: 'missing' }
		);
		assert.equal(next.broken, 'Файл профилей тестов OneScript не разобран');
		assert.deepEqual(next.file, previous);
	});
});

describe('envForAdapter', () => {
	test('тесты 1С окружение профиля не получают', () => {
		const plan = { PATH: 'C:\\oscript' };
		const resolved = { PATH: 'C:\\profile' };
		assert.deepEqual(envForAdapter('vanessa', resolved, plan), { env: plan, complete: false });
		assert.deepEqual(envForAdapter('xunit', resolved, plan), { env: plan, complete: false });
		assert.deepEqual(envForAdapter('yaxunit', resolved, plan), { env: plan, complete: false });
	});

	test('без профиля окружение плана не меняется', () => {
		const plan = { PATH: 'C:\\oscript' };
		assert.deepEqual(envForAdapter('onescript', undefined, plan), { env: plan, complete: false });
		assert.equal(envForAdapter('onescript', undefined, plan).env, plan);
	});

	test('oneunit и 1bdd получают полное окружение профиля', () => {
		const resolved = { A: '1' };
		assert.deepEqual(envForAdapter('onescript', resolved, undefined), { env: resolved, complete: true });
		assert.deepEqual(envForAdapter('onebdd', resolved, undefined), { env: resolved, complete: true });
	});
});
