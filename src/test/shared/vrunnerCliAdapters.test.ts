import * as assert from 'node:assert';
import { V2CliAdapter } from '../../shared/vrunnerCli/v2Adapter';
import { V3CliAdapter } from '../../shared/vrunnerCli/v3Adapter';
import { selectCliAdapter, VRunnerIntent } from '../../shared/vrunnerCli';
import { parseVRunnerVersion } from '../../shared/vrunnerVersion';

const v2 = new V2CliAdapter();
const v3 = new V3CliAdapter();
const conn = ['--ibconnection', '/F./build/ib'] as const;

/** Проверяет план интента на обоих адаптерах. */
function check(intent: VRunnerIntent, expectedV2: string[][], expectedV3: string[][]) {
	assert.deepStrictEqual(v2.plan(intent), expectedV2, 'v2');
	assert.deepStrictEqual(v3.plan(intent), expectedV3, 'v3');
}

suite('vrunnerCli: адаптеры v2/v3', () => {
	// ---- Информационная база ----
	test('infobase.init (без источника)', () => {
		check(
			{ kind: 'infobase.init', common: conn },
			[['init-dev', ...conn]],
			[['infobase', 'init', ...conn]]
		);
	});

	test('infobase.init со src', () => {
		check(
			{ kind: 'infobase.init', src: 'src/cf', common: conn },
			[['init-dev', '--src', 'src/cf', ...conn]],
			[['infobase', 'init', '--src', 'src/cf', ...conn]]
		);
	});

	test('infobase.updateFromSrc', () => {
		check(
			{ kind: 'infobase.updateFromSrc', src: 'src/cf', common: conn },
			[['update-dev', '--src', 'src/cf', ...conn]],
			[['infobase', 'update', '--src', 'src/cf', ...conn]]
		);
	});

	test('infobase.updateFromSrc с git-инкрементом', () => {
		check(
			{ kind: 'infobase.updateFromSrc', src: 'src/cf', gitIncrement: true, common: conn },
			[['update-dev', '--src', 'src/cf', '--git-increment', ...conn]],
			[['infobase', 'update', '--src', 'src/cf', '--increment', ...conn]]
		);
	});

	test('infobase.updateDb', () => {
		check(
			{ kind: 'infobase.updateDb', common: conn },
			[['updatedb', ...conn]],
			[['infobase', 'update', ...conn]]
		);
	});

	test('infobase.updateExtension', () => {
		check(
			{ kind: 'infobase.updateExtension', extensionName: 'Ext1', common: conn },
			[['updateext', 'Ext1', ...conn]],
			[['infobase', 'update', '--target', 'Ext1', ...conn]]
		);
	});

	test('infobase.dumpDt: OUT в v3 позиционный после опций', () => {
		check(
			{ kind: 'infobase.dumpDt', out: 'build/backup.dt', common: conn },
			[['dump', 'build/backup.dt', ...conn]],
			[['infobase', 'dump-dt', ...conn, 'build/backup.dt']]
		);
	});

	test('infobase.restoreDt', () => {
		check(
			{ kind: 'infobase.restoreDt', file: 'build/backup.dt', common: conn },
			[['restore', 'build/backup.dt', ...conn]],
			[['infobase', 'restore-dt', ...conn, 'build/backup.dt']]
		);
	});

	// ---- Конфигурация ----
	test('cf.build', () => {
		check(
			{ kind: 'cf.build', src: 'src/cf', out: 'build/out/1Cv8.cf' },
			[['compile', '--src', 'src/cf', '--out', 'build/out/1Cv8.cf']],
			[['cf', 'compile', '--src', 'src/cf', 'build/out/1Cv8.cf']]
		);
	});

	test('cf.decompileFile', () => {
		check(
			{ kind: 'cf.decompileFile', file: 'build/x.cf', out: 'src/cf' },
			[['decompile', '--in', 'build/x.cf', '--out', 'src/cf']],
			[['cf', 'decompile', '--cf-file', 'build/x.cf', 'src/cf']]
		);
	});

	test('cf.dumpIbToSrc', () => {
		check(
			{ kind: 'cf.dumpIbToSrc', out: 'src/cf', common: conn },
			[['decompile', '--current', '--out', 'src/cf', ...conn]],
			[['cf', 'decompile', ...conn, 'src/cf']]
		);
	});

	test('cf.unloadIbToCf', () => {
		check(
			{ kind: 'cf.unloadIbToCf', out: 'build/out/1Cv8.cf', common: conn },
			[['unload', 'build/out/1Cv8.cf', ...conn]],
			[['cf', 'unload', ...conn, 'build/out/1Cv8.cf']]
		);
	});

	test('cf.loadFileToIb', () => {
		check(
			{ kind: 'cf.loadFileToIb', file: 'build/out/1Cv8.cf', common: conn },
			[['load', '--src', 'build/out/1Cv8.cf', ...conn]],
			[['cf', 'load', ...conn, 'build/out/1Cv8.cf']]
		);
	});

	test('cf.makeDist (OUT позиционно в обеих версиях)', () => {
		check(
			{ kind: 'cf.makeDist', out: 'build/out/1Cv8dist.cf', common: conn },
			[['make-dist', 'build/out/1Cv8dist.cf', ...conn]],
			[['cf', 'make-dist', ...conn, 'build/out/1Cv8dist.cf']]
		);
	});

	// ---- Расширения ----
	test('cfe.buildCfe: v3 выводит --extension-name из каталога', () => {
		check(
			{ kind: 'cfe.buildCfe', src: 'src/cfe/Ext1', out: 'build/out/cfe/Ext1.cfe' },
			[['compileexttocfe', '--src', 'src/cfe/Ext1', '--out', 'build/out/cfe/Ext1.cfe']],
			[['cfe', 'compile', '--src', 'src/cfe/Ext1', '--extension-name', 'Ext1', 'build/out/cfe/Ext1.cfe']]
		);
	});

	test('cfe.buildCfe: имя из метаданных имеет приоритет над каталогом', () => {
		check(
			{ kind: 'cfe.buildCfe', src: 'src/cfe/yaxunit-test', out: 'build/out/cfe/yaxunit-test.cfe', extensionName: 'Тесты' },
			[['compileexttocfe', '--src', 'src/cfe/yaxunit-test', '--out', 'build/out/cfe/yaxunit-test.cfe']],
			[['cfe', 'compile', '--src', 'src/cfe/yaxunit-test', '--extension-name', 'Тесты', 'build/out/cfe/yaxunit-test.cfe']]
		);
	});

	test('cfe.loadFromSrc с обновлением БД (v3: обновление по умолчанию, без флага)', () => {
		check(
			{ kind: 'cfe.loadFromSrc', src: 'src/cfe/Ext1', extensionName: 'Ext1', updateDb: true, common: conn },
			[['compileext', 'src/cfe/Ext1', 'Ext1', '--updatedb', ...conn]],
			[['cfe', 'load', '--extension-name', 'Ext1', ...conn, 'src/cfe/Ext1']]
		);
	});

	test('cfe.loadFromSrc без обновления БД (v3: --no-update-db)', () => {
		check(
			{ kind: 'cfe.loadFromSrc', src: 'src/cfe/Ext1', extensionName: 'Ext1', updateDb: false, common: conn },
			[['compileext', 'src/cfe/Ext1', 'Ext1', ...conn]],
			[['cfe', 'load', '--extension-name', 'Ext1', '--no-update-db', ...conn, 'src/cfe/Ext1']]
		);
	});

	test('cfe.loadFromCfeFile', () => {
		check(
			{ kind: 'cfe.loadFromCfeFile', file: 'build/out/cfe/Ext1.cfe', extensionName: 'Ext1', common: conn },
			[['loadext', '--file', 'build/out/cfe/Ext1.cfe', '--extension', 'Ext1', ...conn]],
			[['cfe', 'load', '--extension-name', 'Ext1', ...conn, 'build/out/cfe/Ext1.cfe']]
		);
	});

	test('cfe.dumpIbToSrc', () => {
		check(
			{ kind: 'cfe.dumpIbToSrc', extensionName: 'Ext1', out: 'src/cfe/Ext1', common: conn },
			[['decompileext', 'Ext1', 'src/cfe/Ext1', ...conn]],
			[['cfe', 'decompile', '--extension-name', 'Ext1', ...conn, 'src/cfe/Ext1']]
		);
	});

	test('cfe.unloadIbToCfe: в 2.x OUT перед именем', () => {
		check(
			{ kind: 'cfe.unloadIbToCfe', extensionName: 'Ext1', out: 'build/out/cfe/Ext1.cfe', common: conn },
			[['unloadext', 'build/out/cfe/Ext1.cfe', 'Ext1', ...conn]],
			[['cfe', 'unload', '--extension-name', 'Ext1', ...conn, 'build/out/cfe/Ext1.cfe']]
		);
	});

	test('cfe.decompileCfeFile: 2 шага в v2, 1 шаг во временной ИБ в v3', () => {
		check(
			{ kind: 'cfe.decompileCfeFile', file: 'build/out/cfe/Ext1.cfe', extensionName: 'Ext1', out: 'src/cfe/Ext1', common: conn },
			[
				['loadext', '--file', 'build/out/cfe/Ext1.cfe', '--extension', 'Ext1', ...conn],
				['decompileext', 'Ext1', 'src/cfe/Ext1', ...conn],
			],
			// v3: сквозные опции не передаются — разборка во временной ИБ
			[['cfe', 'decompile', '--cfe-file', 'build/out/cfe/Ext1.cfe', '--extension-name', 'Ext1', 'src/cfe/Ext1']]
		);
	});

	// ---- Внешние обработки ----
	test('epf.build: в v3 рекурсия -R', () => {
		check(
			{ kind: 'epf.build', src: 'src/epf', out: 'build/out/epf', common: conn },
			[['compileepf', 'src/epf', 'build/out/epf', ...conn]],
			[['epf', 'compile', '--out', 'build/out/epf', '-R', ...conn, 'src/epf']]
		);
	});

	test('epf.decompile', () => {
		check(
			{ kind: 'epf.decompile', input: 'build/out/epf', out: 'src/epf', common: conn },
			[['decompileepf', 'build/out/epf', 'src/epf', ...conn]],
			[['epf', 'decompile', '--out', 'src/epf', '-R', ...conn, 'build/out/epf']]
		);
	});

	// ---- Запуск ----
	test('run.enterprise --no-wait', () => {
		check(
			{ kind: 'run.enterprise', noWait: true, common: conn },
			[['run', '--no-wait', ...conn]],
			[['run', 'enterprise', '--no-wait', ...conn]]
		);
	});

	test('run.enterprise с командой и обработкой', () => {
		check(
			{ kind: 'run.enterprise', command: 'RunUnitTests=tools/yaxunit.json', execute: 'x.epf', common: conn },
			[['run', '--command', 'RunUnitTests=tools/yaxunit.json', '--execute', 'x.epf', ...conn]],
			[['run', 'enterprise', '--command', 'RunUnitTests=tools/yaxunit.json', '--execute', 'x.epf', ...conn]]
		);
	});

	test('run.designer с --additional', () => {
		check(
			{ kind: 'run.designer', additional: '/DumpConfigToFiles src/cf', common: conn },
			[['designer', '--additional', '/DumpConfigToFiles src/cf', ...conn]],
			[['run', 'designer', '--additional', '/DumpConfigToFiles src/cf', ...conn]]
		);
	});

	test('run.designer --no-wait', () => {
		check(
			{ kind: 'run.designer', noWait: true, common: conn },
			[['designer', '--no-wait', ...conn]],
			[['run', 'designer', '--no-wait', ...conn]]
		);
	});

	// ---- Тесты и проверка ----
	test('test.xunit без пути: v3 подставляет дымовые тесты позиционно', () => {
		check(
			{ kind: 'test.xunit', common: ['--settings', 'env.json'] },
			[['xunit', '--settings', 'env.json']],
			[['test', 'xunit', '--settings', 'env.json', '$addRoot/tests/smoke']]
		);
	});

	test('test.xunit с путём: в v3 путь после опций', () => {
		check(
			{ kind: 'test.xunit', testsPath: 'build/out/tests/Тест.epf', common: ['--settings', 'env.json'] },
			[['xunit', 'build/out/tests/Тест.epf', '--settings', 'env.json']],
			[['test', 'xunit', '--settings', 'env.json', 'build/out/tests/Тест.epf']]
		);
	});

	test('test.vanessa', () => {
		check(
			{ kind: 'test.vanessa', common: ['--settings', 'tools/vrunner.init.json', ...conn] },
			[['vanessa', '--settings', 'tools/vrunner.init.json', ...conn]],
			[['test', 'vanessa', '--settings', 'tools/vrunner.init.json', ...conn]]
		);
	});

	test('test.vanessa с фичей и настройками VA: --path в v2, --feature-path в v3', () => {
		check(
			{ kind: 'test.vanessa', featurePath: 'features/Смоук/x.feature', vanessaSettings: 'tools/VAParams.json', common: conn },
			[['vanessa', '--vanessasettings', 'tools/VAParams.json', '--path', 'features/Смоук/x.feature', ...conn]],
			[['test', 'vanessa', '--vanessasettings', 'tools/VAParams.json', '--feature-path', 'features/Смоук/x.feature', ...conn]]
		);
	});

	test('validate.syntaxCheck', () => {
		check(
			{ kind: 'validate.syntaxCheck', common: ['--settings', 'env.json'] },
			[['syntax-check', '--settings', 'env.json']],
			[['validate', 'syntax-check', '--settings', 'env.json']]
		);
	});

	// ---- Выбор адаптера ----
	test('selectCliAdapter: 2.6 → v2, 3.0-предрелиз → v3, неизвестно → v2', () => {
		assert.ok(selectCliAdapter(parseVRunnerVersion('2.6.1')) instanceof V2CliAdapter);
		assert.ok(selectCliAdapter(parseVRunnerVersion('3.0.0_beta')) instanceof V3CliAdapter);
		assert.ok(selectCliAdapter(undefined) instanceof V2CliAdapter);
	});
});
