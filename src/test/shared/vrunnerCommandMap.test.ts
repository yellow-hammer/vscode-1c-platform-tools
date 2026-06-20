import * as assert from 'node:assert';
import { translateVRunnerCommandTo3x, REMOVED_IN_3X } from '../../shared/vrunnerCommandMap';

suite('vrunnerCommandMap', () => {
	test('запуск и отладка', () => {
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['run', '--ibconnection', '/F./build/ib']), ['run', 'enterprise', '--ibconnection', '/F./build/ib']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['designer']), ['run', 'designer']);
	});

	test('тесты и проверки', () => {
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['vanessa', '--settings', 'env.json']), ['test', 'vanessa', '--settings', 'env.json']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['xunit']), ['test', 'xunit']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['syntax-check']), ['validate', 'syntax-check']);
	});

	test('информационная база', () => {
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['init-dev']), ['infobase', 'init']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['update-dev']), ['infobase', 'update']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['updatedb']), ['infobase', 'update']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['dump', '--out', 'ib.dt']), ['infobase', 'dump-dt', '--out', 'ib.dt']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['restore', 'ib.dt']), ['infobase', 'restore-dt', 'ib.dt']);
	});

	test('конфигурация и расширения', () => {
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['compile', 'out.cf']), ['cf', 'compile', 'out.cf']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['decompile', 'src']), ['cf', 'decompile', 'src']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['load', 'src']), ['cf', 'load', 'src']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['compileext', 'src', 'Ext']), ['cfe', 'compile', 'src', 'Ext']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['decompileext', 'Ext', 'out']), ['cfe', 'decompile', 'Ext', 'out']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['loadext', '--file', 'e.cfe']), ['cfe', 'load', '--file', 'e.cfe']);
	});

	test('внешние обработки и хранилище', () => {
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['compileepf', 'src', 'out']), ['epf', 'compile', 'src', 'out']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['decompileepf', 'f.epf', 'out']), ['epf', 'decompile', 'f.epf', 'out']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['loadrepo']), ['repo', 'load']);
	});

	test('неизменяемые и неизвестные команды — без изменений', () => {
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['version']), ['version']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x([]), []);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['mcp']), ['mcp']);
	});

	test('удалённые в 3.x команды', () => {
		assert.ok(REMOVED_IN_3X.has('init-project'));
	});
});
