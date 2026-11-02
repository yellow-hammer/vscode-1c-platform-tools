/**
 * Запуск mutatos: аргументы, окружение, исключаемые каталоги и проверка движка.
 * Запуск: npm run test:node
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { engineVersionSupported, parseEngineVersion } from '../../shared/oneScriptEngine';
import {
	excludedDirectories,
	isFrameworkDependentEngine,
	MUTATOS_MIN_ENGINE,
	mutatosCall,
	mutatosEnv,
	mutatosReports,
	mutatosTempEnv,
	oneUnitSuiteName,
	relativeTestsDirs,
	selectionFilters,
	selectionLabel,
} from '../../features/testing/mutatos/mutatosRun';

const ENGINES = path.resolve(__dirname, '../../../src/test/fixtures/onescriptEngines');
const ROOT = path.resolve('/projects/calc');
const SRC = path.join(ROOT, 'src');
const TESTS = path.join(ROOT, 'tests');
const OUT = path.join(ROOT, 'build', 'out');
const DIST = path.join(ROOT, 'build', 'dist');
const noTopLevel = () => false;

describe('mutatos: запуск', () => {
	test('точка входа из зависимостей проекта, абсолютные пути исходников и отчётов', () => {
		const reports = mutatosReports(path.join(OUT, 'mutatos'));
		const call = mutatosCall({ oscript: path.resolve('/os/bin/oscript'), root: ROOT, sourcesDirs: [SRC], reports });

		assert.equal(call.file, path.resolve('/os/bin/oscript'));
		assert.deepEqual(call.args, [
			'-encoding=utf-8',
			path.join(ROOT, 'oscript_modules', 'mutatos', 'src', 'cli', 'main.os'),
			'run',
			'-p', ROOT,
			'-d', SRC,
			'--json', path.join(OUT, 'mutatos', 'mutations.json'),
			'--html', path.join(OUT, 'mutatos', 'mutations.html'),
			'--xml', path.join(OUT, 'mutatos', 'mutations.xml'),
		]);
	});

	test('каталоги тестов передаются от корня проекта', () => {
		assert.deepEqual(relativeTestsDirs(ROOT, [TESTS, path.join(ROOT, 'tests', 'unit')]), ['tests', 'tests/unit']);
	});

	test('отбор тестов добавляет фильтры набора и метода', () => {
		const reports = mutatosReports(path.join(OUT, 'mutatos'));
		const selection = { file: path.join(TESTS, 'Калькулятор.os'), method: 'СложениеСкладывает' };
		const call = mutatosCall({ oscript: path.resolve('/os/bin/oscript'), root: ROOT, sourcesDirs: [SRC], reports, selection });

		assert.deepEqual(call.args.slice(-4), ['-s', '^Калькулятор$', '-m', '^СложениеСкладывает$']);
	});
});

describe('mutatos: отбор тестов OneUnit', () => {
	test('имя набора: точка, пробел и не буква в начале заменяются подчёркиванием', () => {
		assert.equal(oneUnitSuiteName(path.join(TESTS, 'Тест.Калькулятора.os')), 'Тест_Калькулятора');
		assert.equal(oneUnitSuiteName(path.join(TESTS, 'Пробел в имени.os')), 'Пробел_в_имени');
		assert.equal(oneUnitSuiteName(path.join(TESTS, '1Калькулятор.os')), '_Калькулятор');
		assert.equal(oneUnitSuiteName(path.join(TESTS, 'JWT_Тесты2.os')), 'JWT_Тесты2');
		assert.equal(oneUnitSuiteName(path.join(TESTS, 'Ёлка-ёж.os')), 'Ёлка_ёж');
	});

	test('отбор файла только по набору, кейса ещё по методу', () => {
		const file = path.join(TESTS, 'unit', '1Калькулятор.os');

		assert.deepEqual(selectionFilters({ file }), ['-s', '^_Калькулятор$']);
		assert.deepEqual(selectionFilters({ file, method: 'Сложение' }), ['-s', '^_Калькулятор$', '-m', '^Сложение$']);
		assert.equal(selectionLabel({ file, method: 'Сложение' }), '_Калькулятор.Сложение');
	});

	test('метод в фильтре экранирован как литерал регулярного выражения', () => {
		assert.deepEqual(selectionFilters({ file: 'a.os', method: 'Тест(1).*' }).slice(2), ['-m', '^Тест\\(1\\)\\.\\*$']);
	});
});

describe('mutatos: окружение', () => {
	const BIN = path.resolve('/os/2.2.0/bin');

	test('движок первым в PATH и в OVM_OSCRIPTBIN, прогресс отметками, детальки mutatos', () => {
		const env = mutatosEnv({ PATH: path.resolve('/os/1.9.4/bin'), OVM_OSCRIPTBIN: path.resolve('/os/1.9.4/bin') }, {
			binDir: BIN,
			testsDirs: ['tests', 'spec'],
			excluded: ['oscript_modules', '.git', 'out', 'build'],
		});

		assert.equal(env.PATH, `${BIN}${path.delimiter}${path.resolve('/os/1.9.4/bin')}`);
		assert.equal(env.OVM_OSCRIPTBIN, BIN);
		assert.equal(env.CI, '1');
		assert.equal(env['mutatos_КаталогиТестов'], 'tests,spec');
		assert.equal(env['mutatos_ИсключаемыеКаталоги'], 'oscript_modules,.git,out,build');
	});

	test('временный каталог запуска в TEMP и TMP под прежними именами переменных', () => {
		const temp = path.resolve('/tmp/1cpt-mutatos-1');
		const env = mutatosTempEnv({ Temp: 'a', TMP: 'b' }, temp);

		if (process.platform === 'win32') {
			assert.deepEqual(env, { Temp: temp, TMP: temp });
		} else {
			assert.deepEqual(env, { TEMP: temp, TMP: temp });
		}
	});
});

describe('mutatos: исключаемые каталоги', () => {
	test('каталог сборки не копируется в рабочие копии', () => {
		const excluded = excludedDirectories({ root: ROOT, sourcesDirs: [SRC], testsDirs: [TESTS], outputDirs: [OUT, DIST], hasTopLevel: noTopLevel });

		assert.deepEqual(excluded, ['oscript_modules', '.git', 'out', 'build']);
	});

	test('каталог сборки внутри исходников или вне проекта не исключается', () => {
		const excluded = excludedDirectories({
			root: ROOT,
			sourcesDirs: [SRC],
			testsDirs: [TESTS],
			outputDirs: [path.join(SRC, 'out'), path.resolve(ROOT, '..', 'out')],
			hasTopLevel: noTopLevel,
		});

		assert.deepEqual(excluded, ['oscript_modules', '.git', 'out']);
	});

	test('тесты внутри исходников исключаются из поиска, если так не называется каталог в корне', () => {
		const tests = path.join(SRC, 'tests');
		const options = { root: ROOT, sourcesDirs: [SRC], testsDirs: [tests], outputDirs: [OUT] };

		assert.deepEqual(excludedDirectories({ ...options, hasTopLevel: noTopLevel }), ['oscript_modules', '.git', 'out', 'build', 'tests']);
		assert.deepEqual(excludedDirectories({ ...options, hasTopLevel: (name) => name === 'tests' }), ['oscript_modules', '.git', 'out', 'build']);
	});

	test('имя из пути самих исходников не передаётся: сканер отбросил бы все файлы', () => {
		const root = path.resolve('/ci/build/out/calc');
		const excluded = excludedDirectories({
			root,
			sourcesDirs: [path.join(root, 'src')],
			testsDirs: [path.join(root, 'tests')],
			outputDirs: [path.join(root, 'build', 'out')],
			hasTopLevel: noTopLevel,
		});

		assert.deepEqual(excluded, ['oscript_modules', '.git']);
	});

	test('каталоги верхнего уровня без .os не копируются, исходники и тесты остаются', () => {
		const lib = path.join(ROOT, 'lib');
		const excluded = excludedDirectories({
			root: ROOT,
			sourcesDirs: [lib],
			testsDirs: [TESTS],
			outputDirs: [OUT],
			topLevelWithoutOs: ['src', 'features', 'tools', 'lib', 'tests'],
			hasTopLevel: noTopLevel,
		});

		assert.deepEqual(excluded, ['oscript_modules', '.git', 'out', 'build', 'src', 'features', 'tools']);
	});
});

describe('mutatos: движок', () => {
	test('версия из вывода движков 2.x и 1.x', () => {
		assert.deepEqual(parseEngineVersion('2.2.0\r\n'), { parts: [2, 2, 0], text: '2.2.0' });
		assert.deepEqual(parseEngineVersion('1.9.4.16'), { parts: [1, 9, 4], text: '1.9.4.16' });
		assert.deepEqual(parseEngineVersion('2.3.0-dev+12'), { parts: [2, 3, 0], text: '2.3.0-dev+12' });
		assert.equal(parseEngineVersion('oscript'), undefined);
	});

	test('mutatos нужен движок не ниже 2.0.0', () => {
		assert.equal(engineVersionSupported([2, 0, 0], MUTATOS_MIN_ENGINE), true);
		assert.equal(engineVersionSupported([2, 2, 0], MUTATOS_MIN_ENGINE), true);
		assert.equal(engineVersionSupported([10, 0, 0], MUTATOS_MIN_ENGINE), true);
		assert.equal(engineVersionSupported([1, 9, 4], MUTATOS_MIN_ENGINE), false);
	});

	test('сборка, запускаемая через dotnet: на Windows не exe, на остальных ОС сценарий', () => {
		assert.equal(isFrameworkDependentEngine(path.join(ENGINES, 'scd', 'bin', 'oscript.exe'), 'win32'), false);
		assert.equal(isFrameworkDependentEngine(path.join(ENGINES, 'fdd', 'bin', 'oscript.bat'), 'win32'), true);
		assert.equal(isFrameworkDependentEngine(path.join(ENGINES, 'fdd', 'bin', 'oscript'), 'linux'), true);
		assert.equal(isFrameworkDependentEngine(path.join(ENGINES, 'native', 'bin', 'oscript'), 'linux'), false);
	});
});
