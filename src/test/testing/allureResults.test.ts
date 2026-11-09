import * as assert from 'node:assert';
import { uniqueResultDirs } from '../../utils/allureResults';

suite('allureResults', () => {
	test('jUnit-отчёт прогона с результатами Allure в отчёт не идёт', () => {
		assert.deepStrictEqual(
			uniqueResultDirs([
				{ dir: '/p/build/out/syntax-check', run: 'syntax-check', junit: true },
				{ dir: '/p/build/out/syntax-check/allure', run: 'syntax-check' },
				{ dir: '/p/build/out/smoke/junit', run: 'xunit', junit: true },
				{ dir: '/p/build/out/va' },
				{ dir: '/p/build/out/va' },
			]),
			['/p/build/out/syntax-check/allure', '/p/build/out/smoke/junit', '/p/build/out/va']
		);
	});
});
