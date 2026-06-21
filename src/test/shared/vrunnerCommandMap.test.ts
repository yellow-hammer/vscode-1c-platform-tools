import * as assert from 'node:assert';
import { translateVRunnerCommandTo3x, hasVRunner3Mapping, REMOVED_IN_3X } from '../../shared/vrunnerCommandMap';

suite('vrunnerCommandMap', () => {
	test('префикс токена, только опции (без позиционных)', () => {
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['run', '--no-wait', '--ibconnection', '/F./ib']), ['run', 'enterprise', '--no-wait', '--ibconnection', '/F./ib']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['designer', '--additional', '/X']), ['run', 'designer', '--additional', '/X']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['vanessa', '--settings', 'env.json']), ['test', 'vanessa', '--settings', 'env.json']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['syntax-check']), ['validate', 'syntax-check']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['init-dev', '--ibconnection', '/F./ib']), ['infobase', 'init', '--ibconnection', '/F./ib']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['updatedb', '--ibcmd']), ['infobase', 'update', '--ibcmd']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['loadrepo']), ['repo', 'load']);
	});

	test('опции переставляются перед позиционными (требование v3)', () => {
		// xunit: путь к тестам был позиционным первым → уходит в конец
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['xunit', 'tests/smoke', '--settings', 'env.json']),
			['test', 'xunit', '--settings', 'env.json', 'tests/smoke']
		);
		// dump/restore: путь к .dt после опций
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['dump', 'ib.dt', '--ibconnection', '/F./ib']),
			['infobase', 'dump-dt', '--ibconnection', '/F./ib', 'ib.dt']
		);
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['restore', 'ib.dt', '--ibcmd']),
			['infobase', 'restore-dt', '--ibcmd', 'ib.dt']
		);
		// булев флаг не «съедает» позиционный
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['xunit', 'tests/smoke', '--ibcmd']),
			['test', 'xunit', '--ibcmd', 'tests/smoke']
		);
	});

	test('cf compile/decompile/load/unload', () => {
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['compile', '--src', 'src/cf', '--out', 'build/1Cv8.cf']),
			['cf', 'compile', '--src', 'src/cf', 'build/1Cv8.cf']
		);
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['decompile', '--in', 'a.cf', '--out', 'src/cf']),
			['cf', 'decompile', '--cf-file', 'a.cf', 'src/cf']
		);
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['decompile', '--current', '--out', 'src/cf', '--ibconnection', '/F./ib']),
			['cf', 'decompile', '--ibconnection', '/F./ib', 'src/cf']
		);
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['load', '--src', 'a.cf', '--ibconnection', '/F./ib']),
			['cf', 'load', '--ibconnection', '/F./ib', 'a.cf']
		);
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['unload', 'out.cf', '--ibconnection', '/F./ib']),
			['cf', 'unload', '--ibconnection', '/F./ib', 'out.cf']
		);
	});

	test('epf compile/decompile: 2-й позиционный → --out, SRC в конец', () => {
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['compileepf', 'src/epf', 'build/epf', '--ibconnection', '/F./ib']),
			['epf', 'compile', '--out', 'build/epf', '--ibconnection', '/F./ib', 'src/epf']
		);
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['decompileepf', 'f.epf', 'src/epf']),
			['epf', 'decompile', '--out', 'src/epf', 'f.epf']
		);
	});

	test('cfe: compileext→cfe load, loadext→cfe load, compileexttocfe→cfe compile', () => {
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['compileext', 'src/cfe/X', 'X', '--updatedb', '--ibconnection', '/F./ib']),
			['cfe', 'load', '--extension-name', 'X', '--overwrite', '--update-db', '--ibconnection', '/F./ib', 'src/cfe/X']
		);
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['loadext', '--file', 'a.cfe', '--extension', 'X', '--ibconnection', '/F./ib']),
			['cfe', 'load', '--overwrite', '--ibconnection', '/F./ib', '--extension-name', 'X', 'a.cfe']
		);
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['compileexttocfe', '--src', 'src/cfe/X', '--out', 'build/X.cfe']),
			['cfe', 'compile', '--extension-name', 'X', '--src', 'src/cfe/X', 'build/X.cfe']
		);
	});

	test('cfe: unloadext→cfe unload, updateext→infobase update --target', () => {
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['unloadext', 'build/X.cfe', 'X', '--ibconnection', '/F./ib']),
			['cfe', 'unload', '--extension-name', 'X', '--ibconnection', '/F./ib', 'build/X.cfe']
		);
		assert.deepStrictEqual(
			translateVRunnerCommandTo3x(['updateext', 'X', '--ibconnection', '/F./ib']),
			['infobase', 'update', '--target', 'X', '--ibconnection', '/F./ib']
		);
	});

	test('неизменяемые/пока не покрытые команды — без изменений', () => {
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['version']), ['version']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['--version']), ['--version']);
		assert.deepStrictEqual(translateVRunnerCommandTo3x([]), []);
		// decompileext (из ИБ) пока не транслируется — смена потока в командном классе
		assert.deepStrictEqual(translateVRunnerCommandTo3x(['decompileext', 'X', 'out']), ['decompileext', 'X', 'out']);
		assert.strictEqual(hasVRunner3Mapping('decompileext'), false);
	});

	test('hasVRunner3Mapping / REMOVED_IN_3X', () => {
		assert.strictEqual(hasVRunner3Mapping('vanessa'), true);
		assert.strictEqual(hasVRunner3Mapping('compile'), true);
		assert.strictEqual(hasVRunner3Mapping('load'), true);
		assert.strictEqual(hasVRunner3Mapping('compileext'), true);
		assert.strictEqual(hasVRunner3Mapping('updateext'), true);
		assert.strictEqual(hasVRunner3Mapping('decompileext'), false);
		assert.strictEqual(hasVRunner3Mapping('version'), false);
		assert.ok(REMOVED_IN_3X.has('init-project'));
	});
});
