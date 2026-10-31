import * as assert from 'node:assert';
import * as path from 'node:path';
import { oneScriptTestsCall } from '../../features/testing/oneScriptTestsRun';

suite('прогон тестов OneScript из дерева', () => {
	const tests = path.join('проект', 'tests');
	const reports = path.join('проект', 'build', 'out', 'onescript');

	test('OneUnit: каталог тестов вместе с подкаталогами, отчёт в каталоге отчётов', () => {
		const call = oneScriptTestsCall('oneunit', tests, reports);

		assert.deepStrictEqual(call.args, ['execute', '-d', tests, '-r', '--junit', path.join(reports, 'oneunit.xml')]);
		assert.strictEqual(call.report, path.join(reports, 'oneunit.xml'));
	});

	test('1testrunner: каталог целиком, отчёт назван по каталогу', () => {
		const call = oneScriptTestsCall('1testrunner', tests, reports);

		assert.deepStrictEqual(call.args, ['-runall', tests, 'xddReportPath', reports]);
		assert.strictEqual(call.report, path.join(reports, 'tests.xml'));
	});
});
