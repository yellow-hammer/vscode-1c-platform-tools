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

	test('cf.loadFromSrc с обновлением БД', () => {
		check(
			{ kind: 'cf.loadFromSrc', src: 'src/cf', updateDb: true, common: conn },
			[['update-dev', '--src', 'src/cf', ...conn]],
			[['cf', 'load', ...conn, 'src/cf']]
		);
	});

	test('cf.loadFromSrc с инкрементом', () => {
		check(
			{ kind: 'cf.loadFromSrc', src: 'src/cf', increment: true, updateDb: true, common: conn },
			[['update-dev', '--src', 'src/cf', '--git-increment', ...conn]],
			[['cf', 'load', '--increment', ...conn, 'src/cf']]
		);
	});

	test('cf.loadFromSrc без обновления БД', () => {
		check(
			{ kind: 'cf.loadFromSrc', src: 'src/cf', updateDb: false, common: conn },
			[['designer', '--additional', '/LoadConfigFromFiles src/cf -updateConfigDumpInfo', ...conn]],
			[['cf', 'load', '--no-update-db', ...conn, 'src/cf']]
		);
	});

	test('cf.loadFromSrc по списку объектов', () => {
		check(
			{ kind: 'cf.loadFromSrc', src: 'src/cf', listFile: 'build/objlist-config.txt', updateDb: true, common: conn },
			[
				['designer', '--additional', '/LoadConfigFromFiles src/cf -listFile build/objlist-config.txt', ...conn],
				['updatedb', ...conn],
			],
			[['cf', 'load', '--list', 'build/objlist-config.txt', ...conn, 'src/cf']]
		);
	});

	test('infobase.updateDb трогает только основную конфигурацию', () => {
		check(
			{ kind: 'infobase.updateDb', common: conn },
			[['updatedb', ...conn]],
			[['infobase', 'update', '--target', 'main', ...conn]]
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

	test('infobase.listExtensions: в 2.x designer --additional, в 3.x infobase extensions list', () => {
		check(
			{ kind: 'infobase.listExtensions', json: true, out: 'build/out/cfe-ib-list', common: conn },
			[['designer', '--additional', '/DumpConfigToFiles build/out/cfe-ib-list -AllExtensions', ...conn]],
			[['infobase', 'extensions', 'list', '--json', ...conn]]
		);
		assert.throws(() => v2.plan({ kind: 'infobase.listExtensions' }), /каталог выгрузки/);
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

	test('cf.dumpIbToSrc: файл версий не передаётся, его берут из каталога выгрузки', () => {
		// --versions на файл внутри каталога выгрузки ломает инкремент: конфигуратор
		// отвечает «Каталог не пуст», хотя тот же -update без него отрабатывает
		const planned = v2.plan({ kind: 'cf.dumpIbToSrc', out: 'src/cf', common: conn }).flat();
		assert.ok(!planned.includes('--versions'), 'файл версий ушёл в команду');
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

	test('cf.loadFileToIb с обновлением БД', () => {
		check(
			{ kind: 'cf.loadFileToIb', file: 'build/out/1Cv8.cf', updateDb: true, common: conn },
			[
				['load', '--src', 'build/out/1Cv8.cf', ...conn],
				['updatedb', ...conn],
			],
			[['cf', 'load', ...conn, 'build/out/1Cv8.cf']]
		);
	});

	test('cf.loadFileToIb без обновления БД', () => {
		check(
			{ kind: 'cf.loadFileToIb', file: 'build/out/1Cv8.cf', updateDb: false, common: conn },
			[['load', '--src', 'build/out/1Cv8.cf', ...conn]],
			[['cf', 'load', '--no-update-db', ...conn, 'build/out/1Cv8.cf']]
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

	test('test.yaxunit с готовым конфигом и опциями секции профиля', () => {
		check(
			{
				kind: 'test.yaxunit',
				configPath: 'build/out/testapi/yaxunit-config.json',
				ordinaryApp: '-1',
				exitCodePath: './build/out/yaxunit/result.txt',
				additional: '/L ru',
				noWait: true,
				common: conn,
			},
			[[
				'run', '--command', 'RunUnitTests=build/out/testapi/yaxunit-config.json',
				'--ordinaryapp', '-1', '--exitCodePath', './build/out/yaxunit/result.txt',
				'--additional', '/L ru', '--no-wait', ...conn,
			]],
			[[
				'test', 'yaxunit', '--yaxunit-config', 'build/out/testapi/yaxunit-config.json',
				'--ordinaryapp', '-1', '--exitcode', './build/out/yaxunit/result.txt',
				'--additional', '/L ru', '--no-wait', ...conn,
			]]
		);
	});

	test('test.yaxunit без готового конфига: 3.x передаёт фильтр и отчёт опциями, 2.x отказывает', () => {
		const intent: VRunnerIntent = {
			kind: 'test.yaxunit',
			filter: { extensions: ['Тесты'], modules: ['ОМ_Тест'] },
			report: 'build/out/testapi/yaxunit/report.xml',
			common: conn,
		};
		assert.deepStrictEqual(v3.plan(intent), [[
			'test', 'yaxunit', '--ext', 'Тесты', '--modules', 'ОМ_Тест',
			'--report', 'build/out/testapi/yaxunit/report.xml', '--report-format', 'jUnit', ...conn,
		]]);
		assert.throws(() => v2.plan(intent), /готовым конфигом/);
	});

	test('test.yaxunit: выбранные тесты уходят в --tests', () => {
		assert.deepStrictEqual(
			v3.plan({ kind: 'test.yaxunit', filter: { extensions: ['Тесты'], tests: ['ОМ_Тест.Первый', 'ОМ_Тест.Второй'] } }),
			[['test', 'yaxunit', '--ext', 'Тесты', '--tests', 'ОМ_Тест.Первый,ОМ_Тест.Второй']]
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
			{ kind: 'test.xunit', testsPath: 'build/out/tests/epf/Тест.epf', common: ['--settings', 'env.json'] },
			[['xunit', 'build/out/tests/epf/Тест.epf', '--settings', 'env.json']],
			[['test', 'xunit', '--settings', 'env.json', 'build/out/tests/epf/Тест.epf']]
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

suite('vrunnerCli: сеансы информационной базы', () => {
	// Подключение к кластеру (адрес RAS, база, администратор, пароль) живёт в
	// файле настроек проекта: аргумент командной строки перекрыл бы профиль

	test('session.lock: в 3.x команда в группе cluster, сообщение названо иначе', () => {
		check(
			{
				kind: 'session.lock',
				deniedMessage: 'База закрыта на обслуживание',
				accessCode: 'code',
				common: [...conn],
			},
			[[
				'session', 'lock',
				'--uccode', 'code',
				'--lockmessage', 'База закрыта на обслуживание',
				...conn,
			]],
			[[
				'cluster', 'session', 'lock',
				'--uccode', 'code',
				'--denied-message', 'База закрыта на обслуживание',
				...conn,
			]]
		);
	});

	test('session.lock: время блокировки уходит только в 2.x', () => {
		const intent: VRunnerIntent = {
			kind: 'session.lock',
			lockStart: '2040-12-31T23:59:59',
			lockEnd: '2041-01-01T06:00:00',
		};
		assert.deepStrictEqual(v2.plan(intent), [[
			'session', 'lock',
			'--lockstart', '2040-12-31T23:59:59',
			'--lockend', '2041-01-01T06:00:00',
		]]);
		// в 3.x таких опций нет: блокировка применяется сразу
		assert.deepStrictEqual(v3.plan(intent), [['cluster', 'session', 'lock']]);
	});

	test('session.unlock: код допуска передаётся обеим версиям', () => {
		check(
			{ kind: 'session.unlock', accessCode: 'code' },
			[['session', 'unlock', '--uccode', 'code']],
			[['cluster', 'session', 'unlock', '--uccode', 'code']]
		);
	});

	test('session.kill: единый отбор 2.x раскладывается на опции 3.x', () => {
		check(
			{ kind: 'session.kill', filter: 'appid=Designer', withoutLock: true },
			[['session', 'kill', '--filter', 'appid=Designer', '--with-nolock']],
			[['cluster', 'session', 'kill', '--filter-app', 'Designer', '--no-lock']]
		);
	});

	test('session.kill: отбор по приложению и пользователю разводится по опциям', () => {
		check(
			{ kind: 'session.kill', filter: 'appid=Designer;1CV8|name=рег1;рег2' },
			[['session', 'kill', '--filter', 'appid=Designer;1CV8|name=рег1;рег2']],
			[[
				'cluster', 'session', 'kill',
				'--filter-app', 'Designer;1CV8',
				'--filter-name', 'рег1;рег2',
			]]
		);
	});

	test('session.kill: режим EXCEPT становится флагом инверсии', () => {
		const intent: VRunnerIntent = {
			kind: 'session.kill',
			filter: 'appid=Designer',
			filterMode: 'EXCEPT',
		};
		assert.deepStrictEqual(v2.plan(intent), [[
			'session', 'kill', '--filter', 'appid=Designer', '--mode', 'EXCEPT',
		]]);
		assert.deepStrictEqual(v3.plan(intent), [[
			'cluster', 'session', 'kill', '--filter-app', 'Designer', '--filter-except',
		]]);
	});

	test('session.kill: режим OFF снимает отбор, неизвестный режим отвергается', () => {
		assert.deepStrictEqual(
			v3.plan({ kind: 'session.kill', filter: 'appid=Designer', filterMode: 'OFF' }),
			[['cluster', 'session', 'kill']]
		);
		assert.throws(
			() => v3.plan({ kind: 'session.kill', filterMode: 'ALL' }),
			/EXCEPT/
		);
	});

	test('session.kill: инверсию без условий разбирает сам vanessa-runner', () => {
		// свою проверку не заводим: vanessa-runner отвергает такой вызов и называет
		// недостающие опции точнее, чем это сделали бы мы
		assert.deepStrictEqual(
			v3.plan({ kind: 'session.kill', filterMode: 'EXCEPT' }),
			[['cluster', 'session', 'kill', '--filter-except']]
		);
	});

	test('session.kill: непонятный отбор не уходит в команду молча', () => {
		assert.throws(
			() => v3.plan({ kind: 'session.kill', filter: 'computer=СЕРВЕР' }),
			/appid/
		);
	});

	test('session.kill: ожидание и попытки есть только в 3.x, вместе не идут', () => {
		assert.deepStrictEqual(
			v3.plan({ kind: 'session.kill', retry: 5 }),
			[['cluster', 'session', 'kill', '--retry', '5']]
		);
		// при заданном таймауте vanessa-runner игнорирует retry, поэтому шлём только timeout
		assert.deepStrictEqual(
			v3.plan({ kind: 'session.kill', retry: 5, timeoutSeconds: 60 }),
			[['cluster', 'session', 'kill', '--timeout', '60']]
		);
		assert.deepStrictEqual(v2.plan({ kind: 'session.kill', retry: 5 }), [['session', 'kill']]);
	});

	test('session.closed: действие есть в обеих версиях, ожидание - только в 3.x', () => {
		check(
			{ kind: 'session.closed', filter: 'name=Иванов' },
			[['session', 'closed', '--filter', 'name=Иванов']],
			[['cluster', 'session', 'closed', '--filter-name', 'Иванов']]
		);
		assert.deepStrictEqual(
			v3.plan({ kind: 'session.closed', timeoutSeconds: 300 }),
			[['cluster', 'session', 'closed', '--timeout', '300']]
		);
	});

	test('session.list: действия нет в 2.x и это видно сразу', () => {
		assert.deepStrictEqual(
			v3.plan({ kind: 'session.list', connections: true }),
			[['cluster', 'session', 'list', '--connections']]
		);
		assert.throws(() => v2.plan({ kind: 'session.list' }), /3\.x/);
	});

	test('без параметров вызова команда состоит из одного действия', () => {
		check(
			{ kind: 'session.unlock' },
			[['session', 'unlock']],
			[['cluster', 'session', 'unlock']]
		);
	});
});

suite('vrunnerCli: регламентные задания', () => {
	test('в 2.x это отдельная команда, в 3.x подкоманда группы cluster', () => {
		check(
			{ kind: 'jobs.lock' },
			[['scheduledjobs', 'lock']],
			[['cluster', 'jobs', 'lock']]
		);
	});

	test('снятие запрета зеркально запрету', () => {
		check(
			{ kind: 'jobs.unlock' },
			[['scheduledjobs', 'unlock']],
			[['cluster', 'jobs', 'unlock']]
		);
	});

	test('сквозные опции доходят до команды', () => {
		check(
			{ kind: 'jobs.lock', common: [...conn] },
			[['scheduledjobs', 'lock', ...conn]],
			[['cluster', 'jobs', 'lock', ...conn]]
		);
	});
});
