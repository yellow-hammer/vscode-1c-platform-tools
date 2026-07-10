import * as assert from 'node:assert';
import { translateArgsToV3 } from '../../shared/vrunnerCommandMap';

const conn = ['--ibconnection', '/F./build/ib'];

suite('vrunnerCommandMap: трансляция 2.x → 3.x', () => {
	// ---- Конфигурация (cf) ----
	test('compile → cf compile (--out становится позиционным)', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['compile', '--src', 'src/cf', '--out', 'build/out/1Cv8.cf', '--ibcmd']),
			['cf', 'compile', '--src', 'src/cf', '--ibcmd', 'build/out/1Cv8.cf']
		);
	});

	test('decompile --in → cf decompile --cf-file', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['decompile', '--in', 'build/x.cf', '--out', 'src/cf']),
			['cf', 'decompile', '--cf-file', 'build/x.cf', 'src/cf']
		);
	});

	test('decompile --current → cf decompile из ИБ (без --cf-file)', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['decompile', '--current', '--out', 'src/cf', ...conn]),
			['cf', 'decompile', '--ibconnection', '/F./build/ib', 'src/cf']
		);
	});

	test('load --src → cf load (SRC позиционный)', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['load', '--src', 'build/dist/1Cv8.cf', ...conn, '--ibcmd']),
			['cf', 'load', '--ibconnection', '/F./build/ib', '--ibcmd', 'build/dist/1Cv8.cf']
		);
	});

	test('unload → cf unload (OUT позиционный)', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['unload', 'build/out/1Cv8.cf', ...conn]),
			['cf', 'unload', '--ibconnection', '/F./build/ib', 'build/out/1Cv8.cf']
		);
	});

	// ---- Расширения (cfe) ----
	test('compileexttocfe → cfe compile (+ --extension-name из каталога)', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['compileexttocfe', '--src', 'src/cfe/Ext1', '--out', 'build/out/cfe/Ext1.cfe']),
			['cfe', 'compile', '--src', 'src/cfe/Ext1', '--extension-name', 'Ext1', 'build/out/cfe/Ext1.cfe']
		);
	});

	test('loadext → cfe load (--file → SRC, --extension → --extension-name)', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['loadext', '--file', 'build/out/cfe/Ext1.cfe', '--extension', 'Ext1', ...conn]),
			['cfe', 'load', '--ibconnection', '/F./build/ib', '--extension-name', 'Ext1', 'build/out/cfe/Ext1.cfe']
		);
	});

	test('compileext --updatedb → cfe load (обновление БД по умолчанию, без флага)', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['compileext', 'src/cfe/Ext1', 'Ext1', '--updatedb', ...conn]),
			['cfe', 'load', '--ibconnection', '/F./build/ib', '--extension-name', 'Ext1', 'src/cfe/Ext1']
		);
	});

	test('compileext без --updatedb → cfe load --no-update-db', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['compileext', 'src/cfe/Ext1', 'Ext1', ...conn]),
			['cfe', 'load', '--ibconnection', '/F./build/ib', '--extension-name', 'Ext1', '--no-update-db', 'src/cfe/Ext1']
		);
	});

	test('decompileext → cfe decompile из ИБ', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['decompileext', 'Ext1', 'src/cfe/Ext1', ...conn]),
			['cfe', 'decompile', '--ibconnection', '/F./build/ib', '--extension-name', 'Ext1', 'src/cfe/Ext1']
		);
	});

	test('unloadext → cfe unload (CFE позиционный)', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['unloadext', 'build/out/cfe/Ext1.cfe', 'Ext1', ...conn]),
			['cfe', 'unload', '--ibconnection', '/F./build/ib', '--extension-name', 'Ext1', 'build/out/cfe/Ext1.cfe']
		);
	});

	test('updateext → infobase update --target', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['updateext', 'Ext1', ...conn]),
			['infobase', 'update', '--ibconnection', '/F./build/ib', '--target', 'Ext1']
		);
	});

	// ---- Внешние обработки (epf) ----
	test('compileepf → epf compile -R --out SRC (рекурсия по каталогу)', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['compileepf', 'src/epf', 'build/out/epf', ...conn]),
			['epf', 'compile', '--ibconnection', '/F./build/ib', '--out', 'build/out/epf', '-R', 'src/epf']
		);
	});

	test('decompileepf → epf decompile -R --out IN', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['decompileepf', 'build/out/epf', 'src/epf', ...conn]),
			['epf', 'decompile', '--ibconnection', '/F./build/ib', '--out', 'src/epf', '-R', 'build/out/epf']
		);
	});

	// ---- Информационная база (infobase) ----
	test('init-dev → infobase init', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['init-dev', ...conn]),
			['infobase', 'init', '--ibconnection', '/F./build/ib']
		);
	});

	test('init-dev --src → infobase init --src (--src остаётся опцией)', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['init-dev', '--src', 'src/cf', ...conn]),
			['infobase', 'init', '--src', 'src/cf', '--ibconnection', '/F./build/ib']
		);
	});

	test('update-dev --src → infobase update --src', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['update-dev', '--src', 'src/cf', ...conn]),
			['infobase', 'update', '--src', 'src/cf', '--ibconnection', '/F./build/ib']
		);
	});

	test('update-dev --git-increment → infobase update --increment', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['update-dev', '--src', 'src/cf', '--git-increment', ...conn]),
			['infobase', 'update', '--src', 'src/cf', '--ibconnection', '/F./build/ib', '--increment']
		);
	});

	test('updatedb → infobase update', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['updatedb', ...conn]),
			['infobase', 'update', '--ibconnection', '/F./build/ib']
		);
	});

	test('dump → infobase dump-dt (DT позиционный)', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['dump', 'build/backup.dt', ...conn]),
			['infobase', 'dump-dt', '--ibconnection', '/F./build/ib', 'build/backup.dt']
		);
	});

	test('restore → infobase restore-dt (SRC позиционный)', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['restore', 'build/backup.dt', ...conn]),
			['infobase', 'restore-dt', '--ibconnection', '/F./build/ib', 'build/backup.dt']
		);
	});

	// ---- Запуск (run) ----
	test('designer --additional → run designer', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['designer', '--additional', '/DumpResult x', ...conn]),
			['run', 'designer', '--additional', '/DumpResult x', '--ibconnection', '/F./build/ib']
		);
	});

	test('designer --no-wait → run designer', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['designer', '--no-wait', ...conn]),
			['run', 'designer', '--no-wait', '--ibconnection', '/F./build/ib']
		);
	});

	test('run --no-wait → run enterprise', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['run', '--no-wait', ...conn]),
			['run', 'enterprise', '--no-wait', '--ibconnection', '/F./build/ib']
		);
	});

	test('run --command --execute → run enterprise', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['run', '--command', 'Загрузить', '--execute', 'x.epf', ...conn]),
			['run', 'enterprise', '--command', 'Загрузить', '--execute', 'x.epf', '--ibconnection', '/F./build/ib']
		);
	});

	test('run --command RunUnitTests → run enterprise (значение сохраняется)', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['run', '--command', 'RunUnitTests=tools/yaxunit.json', ...conn]),
			['run', 'enterprise', '--command', 'RunUnitTests=tools/yaxunit.json', '--ibconnection', '/F./build/ib']
		);
	});

	// ---- Тесты и проверка (test / validate) ----
	test('xunit без пути → test xunit', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['xunit', '--settings', 'env.json']),
			['test', 'xunit', '--settings', 'env.json']
		);
	});

	test('xunit с путём → test xunit (опции ПЕРЕД позиционным)', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['xunit', '$addRoot/tests/smoke', '--settings', 'env.json']),
			['test', 'xunit', '--settings', 'env.json', '$addRoot/tests/smoke']
		);
	});

	test('vanessa → test vanessa', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['vanessa', '--settings', 'tools/vrunner.init.json', ...conn]),
			['test', 'vanessa', '--settings', 'tools/vrunner.init.json', '--ibconnection', '/F./build/ib']
		);
	});

	test('syntax-check → validate syntax-check', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['syntax-check', '--settings', 'env.json']),
			['validate', 'syntax-check', '--settings', 'env.json']
		);
	});

	// ---- Прочее ----
	test('идемпотентность: run enterprise/designer в 3.x не транслируются повторно', () => {
		assert.deepStrictEqual(
			translateArgsToV3(['run', 'designer', '--no-wait']),
			['run', 'designer', '--no-wait']
		);
		assert.deepStrictEqual(
			translateArgsToV3(['run', 'enterprise', '--command', 'X', '--no-wait']),
			['run', 'enterprise', '--command', 'X', '--no-wait']
		);
		assert.deepStrictEqual(
			translateArgsToV3(['infobase', 'update', '--src', 'src/cf']),
			['infobase', 'update', '--src', 'src/cf']
		);
	});

	test('неизвестная команда возвращается без изменений', () => {
		assert.deepStrictEqual(translateArgsToV3(['version']), ['version']);
		assert.deepStrictEqual(translateArgsToV3([]), []);
		// Уже в формате 3.x — не трогаем
		assert.deepStrictEqual(
			translateArgsToV3(['cf', 'compile', '--src', 'src/cf', 'build/out/1Cv8.cf']),
			['cf', 'compile', '--src', 'src/cf', 'build/out/1Cv8.cf']
		);
	});
});
