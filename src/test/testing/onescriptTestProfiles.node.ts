/**
 * Разбор профилей переменных среды тестов OneScript.
 * Запуск: npm run test:node
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { onescriptProfileEnv, parseOnescriptTestProfiles } from '../../features/testing/onescriptTestProfiles';

const FILE = `{
  "profiles": {
    "sqlite": {
      "TESTRUNNER_RUN_SQLITE_TESTS": "true",
      "TESTRUNNER_RUN_POSTGRES_TESTS": "false"
    },
    "postgres": {
      "POSTGRES_HOST": "localhost"
    }
  }
}`;

describe('parseOnescriptTestProfiles', () => {
	test('разбирает именованные наборы строк', () => {
		const parsed = parseOnescriptTestProfiles(FILE);
		assert.ok(!('error' in parsed));
		if ('error' in parsed) {
			return;
		}
		assert.deepEqual(parsed.profiles.sqlite, {
			TESTRUNNER_RUN_SQLITE_TESTS: 'true',
			TESTRUNNER_RUN_POSTGRES_TESTS: 'false',
		});
	});

	test('число вместо строки — ошибка', () => {
		const parsed = parseOnescriptTestProfiles('{"profiles":{"sqlite":{"PORT":5432}}}');
		assert.deepEqual(parsed, { error: 'Переменная PORT профиля «sqlite» должна быть строкой' });
	});

	test('PATH профиля не принимается', () => {
		const parsed = parseOnescriptTestProfiles('{"profiles":{"sqlite":{"Path":"C:\\\\evil"}}}');
		assert.equal('error' in parsed, true);
	});
});

describe('onescriptProfileEnv', () => {
	test('набор попадает только в тесты OneScript и перекрывает одноимённые', () => {
		const env = onescriptProfileEnv(
			'onescript',
			{ TESTRUNNER_RUN_SQLITE_TESTS: 'false' },
			{ TESTRUNNER_RUN_SQLITE_TESTS: 'true', PATH: 'C:\\oscript' }
		);
		assert.deepEqual(env, {
			TESTRUNNER_RUN_SQLITE_TESTS: 'false',
			PATH: 'C:\\oscript',
		});
	});

	test('тесты 1С набор не получают', () => {
		const plan = { PATH: 'C:\\oscript' };
		assert.equal(onescriptProfileEnv('vanessa', { A: '1' }, plan), plan);
		assert.equal(onescriptProfileEnv('xunit', { A: '1' }, plan), plan);
	});

	test('без профиля окружение плана не меняется', () => {
		const plan = { PATH: 'C:\\oscript' };
		assert.equal(onescriptProfileEnv('onescript', undefined, plan), plan);
	});
});
