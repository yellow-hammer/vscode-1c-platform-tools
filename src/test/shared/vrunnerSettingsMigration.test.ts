import * as assert from 'node:assert';
import { convertEnvToAutumnProperties } from '../../shared/vrunnerSettingsMigration';

suite('vrunnerSettingsMigration', () => {
	test('default → vrunner.*, снятие префикса --', () => {
		const { result } = convertEnvToAutumnProperties({
			default: { '--ibconnection': '/F./build/ib', '--v8version': '8.3.24' },
		});
		assert.deepStrictEqual(result, {
			vrunner: { ibconnection: '/F./build/ib', v8version: '8.3.24' },
		});
	});

	test('секции команд раскладываются по иерархии', () => {
		const { result } = convertEnvToAutumnProperties({
			vanessa: { '--vanessasettings': './vb.json' },
			xunit: { '--reportsxunit': 'jUnit{./b.xml}' },
		});
		assert.deepStrictEqual(result, {
			vrunner: {
				test: {
					vanessa: { vanessasettings: './vb.json' },
					xunit: { reportsxunit: 'jUnit{./b.xml}' },
				},
			},
		});
	});

	test('syntax-check: mode теряет ведущий дефис', () => {
		const { result } = convertEnvToAutumnProperties({
			'syntax-check': { '--mode': ['-ThinClient', '-Server'], '--groupbymetadata': true },
		});
		const sc = (result.vrunner as any).validate['syntax-check'];
		assert.deepStrictEqual(sc.mode, ['ThinClient', 'Server']);
		assert.strictEqual(sc.groupbymetadata, true);
	});

	test('updatedb: --v2 → infobase.update.rtype', () => {
		const { result } = convertEnvToAutumnProperties({ updatedb: { '--v2': true, '--ibcmd': true } });
		const upd = (result.vrunner as any).infobase.update;
		assert.strictEqual(upd.rtype, 'v2');
		assert.strictEqual(upd.ibcmd, true);
		assert.strictEqual(upd.v2, undefined);
	});

	test('глобальные переименования ключей', () => {
		const { result } = convertEnvToAutumnProperties({
			compileext: { inputPath: 'src/cfe', outputPath: 'out', extensionName: 'Ext' },
		});
		assert.deepStrictEqual((result.vrunner as any).cfe.compile, {
			src: 'src/cfe',
			out: 'out',
			'extension-name': 'Ext',
		});
	});

	test('testsPath не переносится, с предупреждением', () => {
		const { result, warnings } = convertEnvToAutumnProperties({
			xunit: { testsPath: '$addRoot/tests/smoke', '--xddConfig': './x.json' },
		});
		assert.strictEqual((result.vrunner as any).test.xunit.testsPath, undefined);
		assert.strictEqual((result.vrunner as any).test.xunit.xddConfig, './x.json');
		assert.ok(warnings.some((w) => w.includes('testsPath')));
	});

	test('$schema игнорируется, неизвестная секция → предупреждение', () => {
		const { result, warnings } = convertEnvToAutumnProperties({
			$schema: 'https://example/schema.json',
			somethingElse: { '--x': 1 },
		});
		assert.deepStrictEqual(result, {});
		assert.ok(warnings.some((w) => w.includes('somethingElse')));
	});

	test('секции с ручной миграцией → предупреждение, пропуск', () => {
		const { result, warnings } = convertEnvToAutumnProperties({ 'init-dev': { '--ibconnection': '/F./ib' } });
		assert.deepStrictEqual(result, {});
		assert.ok(warnings.some((w) => w.includes('init-dev')));
	});
});
