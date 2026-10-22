import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	resolveConfigPath,
	extractJUnitPathFromReportsXunit,
	extractAllurePathFromReportsXunit,
	syntaxCheckAllurePathsFromEnv,
	vanessaReportTarget,
	vanessaSettingsPathFromEnv,
	reportsXunitFromEnv,
	syntaxCheckJUnitPathFromEnv,
	syntaxCheckGroupByMetadataFromEnv,
	yaxunitSectionFromEnv,
	yaxunitConfigPathFromCommand,
} from '../../features/testing/projectTestConfig';
import { settingValue } from '../../shared/vrunnerSettings';

// Абсолютный корень на любой ОС: path.join('C:','proj') не абсолютен под Linux,
// из-за чего проверка ветки «уже абсолютный путь» падала в CI.
const ROOT = path.resolve(path.sep, 'proj');

suite('projectTestConfig', () => {
	test('resolveConfigPath подставляет $workspaceRoot и разрешает относительные пути', () => {
		assert.strictEqual(
			resolveConfigPath('$workspaceRoot/build/out/cucumber', ROOT),
			path.join(ROOT, 'build', 'out', 'cucumber')
		);
		assert.strictEqual(
			resolveConfigPath('./tools/VAParams.json', ROOT),
			path.join(ROOT, 'tools', 'VAParams.json')
		);
		assert.strictEqual(
			resolveConfigPath(path.join(ROOT, 'abs.xml'), ROOT),
			path.join(ROOT, 'abs.xml')
		);
	});

	test('extractJUnitPathFromReportsXunit: синтаксис генераторов (как в ssl_3_1)', () => {
		const value =
			'ГенераторОтчетаJUnitXML{build/out/smoke/junit/junit.xml};ГенераторОтчетаAllureXMLВерсия2{build/out/smoke/allure/allure.xml}';
		assert.strictEqual(extractJUnitPathFromReportsXunit(value), 'build/out/smoke/junit/junit.xml');
	});

	test('extractAllurePathFromReportsXunit: Allure-генератор из того же значения', () => {
		// каталоги результатов для Allure берём из конфига проекта, а не по именам папок
		const v2 =
			'ГенераторОтчетаJUnitXML{build/out/smoke/junit/junit.xml};ГенераторОтчетаAllureXMLВерсия2{build/out/smoke/allure/allure.xml}';
		assert.strictEqual(extractAllurePathFromReportsXunit(v2), 'build/out/smoke/allure/allure.xml');
		assert.strictEqual(
			extractAllurePathFromReportsXunit('jUnit{a/junit.xml};allure{b/allure.xml}'),
			'b/allure.xml'
		);
		assert.strictEqual(
			extractAllurePathFromReportsXunit('allure:build/out/allure'),
			'build/out/allure'
		);
		assert.strictEqual(extractAllurePathFromReportsXunit('jUnit{a/junit.xml}'), undefined);
	});

	test('syntaxCheckAllurePathsFromEnv: обе опции синтаксконтроля, xml и json', () => {
		// --allure-results (xml) и --allure-results2 (json) — разные каталоги,
		// заданы могут быть оба, поэтому берём все
		assert.deepStrictEqual(
			syntaxCheckAllurePathsFromEnv({
				'syntax-check': {
					'--allure-results': 'build/out/syntax-check/allure-xml',
					'--allure-results2': 'build/out/syntax-check/allure'
				}
			}),
			['build/out/syntax-check/allure-xml', 'build/out/syntax-check/allure']
		);
		assert.deepStrictEqual(syntaxCheckAllurePathsFromEnv({ 'syntax-check': {} }), []);
	});

	test('syntaxCheckAllurePathsFromEnv: в 3.x каталог из report-path, без allure в паре из allure-results', () => {
		const section = (values: Record<string, unknown>) => ({ vrunner: { validate: { 'syntax-check': values } } });
		assert.deepStrictEqual(
			syntaxCheckAllurePathsFromEnv(
				section({ 'report-format': ['junit', 'allure'], 'report-path': 'build/out/sc/', 'allure-results': 'build/old' }),
				'v3'
			),
			['build/out/sc/allure']
		);
		assert.deepStrictEqual(
			syntaxCheckAllurePathsFromEnv(section({ 'report-path': 'build/sc.xml', 'allure-results': 'build/old' }), 'v3'),
			['build/old']
		);
		assert.deepStrictEqual(
			syntaxCheckAllurePathsFromEnv(section({ 'report-format': 'Allure', 'report-path': 'build/allure' }), 'v3'),
			['build/allure']
		);
		assert.deepStrictEqual(
			syntaxCheckAllurePathsFromEnv(section({ 'report-path': 'build/junit.xml', 'allure-results2': 'build/a2' }), 'v3'),
			[],
			'без report-format отчёт junit, allure-results2 в 3.x нет'
		);
	});

	test('syntaxCheckJUnitPathFromEnv: в 3.x report-path перекрывает junitpath', () => {
		const section = (values: Record<string, unknown>) => ({ vrunner: { validate: { 'syntax-check': values } } });
		assert.strictEqual(
			syntaxCheckJUnitPathFromEnv(section({ 'report-path': 'build/sc.xml', junitpath: 'build/old.xml' }), 'v3'),
			'build/sc.xml'
		);
		assert.strictEqual(
			syntaxCheckJUnitPathFromEnv(section({ 'report-format': ['JUnit', 'allure'], 'report-path': 'build/sc' }), 'v3'),
			'build/sc/junit.xml'
		);
		assert.strictEqual(
			syntaxCheckJUnitPathFromEnv(section({ 'report-format': ['allure'], 'report-path': 'build/a', junitpath: 'build/old.xml' }), 'v3'),
			'build/old.xml'
		);
	});

	test('settingValue: в 3.x опция ищется от секции команды к общему уровню', () => {
		const settings = {
			vrunner: {
				'report-format': ['junit', 'allure'],
				validate: { 'report-path': 'build/validate', 'syntax-check': { groupbymetadata: true, junitpath: null } },
				junitpath: 'build/common.xml',
			},
		};
		assert.strictEqual(settingValue(settings, 'v3', 'syntax-check', 'groupbymetadata'), true);
		assert.strictEqual(settingValue(settings, 'v3', 'syntax-check', 'report-path'), 'build/validate');
		assert.strictEqual(settingValue(settings, 'v3', 'syntax-check', 'junitpath'), 'build/common.xml');
		assert.strictEqual(settingValue(settings, 'v3', 'xunit', 'report-path'), undefined);
		assert.strictEqual(syntaxCheckJUnitPathFromEnv(settings, 'v3'), 'build/validate/junit.xml');
		assert.deepStrictEqual(syntaxCheckAllurePathsFromEnv(settings, 'v3'), ['build/validate/allure']);
	});

	test('extractJUnitPathFromReportsXunit: синтаксис vanessa-runner 3', () => {
		const value = 'jUnit{build/out/smoke/junit/junit.xml};allure{build/out/smoke/allure/allure.xml}';
		assert.strictEqual(extractJUnitPathFromReportsXunit(value), 'build/out/smoke/junit/junit.xml');
	});

	test('extractJUnitPathFromReportsXunit: короткий синтаксис jUnit:', () => {
		assert.strictEqual(
			extractJUnitPathFromReportsXunit('jUnit:./build/junit.xml'),
			'./build/junit.xml'
		);
	});

	test('extractJUnitPathFromReportsXunit: без jUnit-генератора — undefined', () => {
		assert.strictEqual(
			extractJUnitPathFromReportsXunit('ГенераторОтчетаAllureXMLВерсия2{build/allure.xml}'),
			undefined
		);
	});

	test('vanessaReportTarget: jUnit выключен, Cucumber включён (как в ssl_3_1)', () => {
		const vaParams = {
			'ДелатьОтчетВФорматеjUnit': false,
			'ДелатьОтчетВФорматеCucumberJson': true,
			'ОтчетCucumber': { 'КаталогВыгрузкиCucumberJson': '$workspaceRoot/build/out/cucumber' }
		};
		const target = vanessaReportTarget(vaParams, ROOT);
		assert.ok(target);
		assert.strictEqual(target.format, 'cucumber');
		assert.strictEqual(target.path, path.join(ROOT, 'build', 'out', 'cucumber'));
	});

	test('vanessaReportTarget: приоритет у включённого jUnit', () => {
		const vaParams = {
			'ДелатьОтчетВФорматеjUnit': true,
			'ОтчетjUnit': { 'КаталогВыгрузкиjUnit': '$workspaceRoot/build/out/junit' },
			'ДелатьОтчетВФорматеCucumberJson': true,
			'ОтчетCucumber': { 'КаталогВыгрузкиCucumberJson': '$workspaceRoot/build/out/cucumber' }
		};
		const target = vanessaReportTarget(vaParams, ROOT);
		assert.ok(target);
		assert.strictEqual(target.format, 'junit');
		assert.strictEqual(target.path, path.join(ROOT, 'build', 'out', 'junit'));
	});

	test('vanessaReportTarget: отчёты не настроены — undefined', () => {
		assert.strictEqual(vanessaReportTarget({}, ROOT), undefined);
		assert.strictEqual(
			vanessaReportTarget({ 'ДелатьОтчетВФорматеjUnit': true }, ROOT),
			undefined,
			'jUnit включён, но каталог не задан'
		);
	});

	test('vanessaSettingsPathFromEnv и reportsXunitFromEnv читают секции env.json', () => {
		const envJson = {
			vanessa: { '--vanessasettings': './tools/VAParams.json' },
			xunit: { '--reportsxunit': 'ГенераторОтчетаJUnitXML{build/junit.xml}' }
		};
		assert.strictEqual(vanessaSettingsPathFromEnv(envJson), './tools/VAParams.json');
		assert.strictEqual(reportsXunitFromEnv(envJson), 'ГенераторОтчетаJUnitXML{build/junit.xml}');
		assert.strictEqual(vanessaSettingsPathFromEnv({}), undefined);
		assert.strictEqual(reportsXunitFromEnv({}), undefined);
	});

	test('схема v3: читатели берут значения из autumn-properties (vrunner.test/validate.*)', () => {
		const autumn = {
			vrunner: {
				test: {
					vanessa: { vanessasettings: './tools/VAParams.json' },
					xunit: { reportsxunit: 'jUnit{build/junit.xml}' }
				},
				validate: {
					'syntax-check': { junitpath: 'build/out/sc/junit.xml', groupbymetadata: false }
				}
			}
		};
		assert.strictEqual(vanessaSettingsPathFromEnv(autumn, 'v3'), './tools/VAParams.json');
		assert.strictEqual(reportsXunitFromEnv(autumn, 'v3'), 'jUnit{build/junit.xml}');
		assert.strictEqual(syntaxCheckJUnitPathFromEnv(autumn, 'v3'), 'build/out/sc/junit.xml');
		assert.strictEqual(syntaxCheckGroupByMetadataFromEnv(autumn, 'v3'), false);
		// v2-читатель не находит значения в autumn-структуре
		assert.strictEqual(reportsXunitFromEnv(autumn, 'v2'), undefined);
	});

	test('yaxunitSectionFromEnv: секция yaxunit env.json (2.x)', () => {
		const envJson = {
			yaxunit: {
				'--command': 'RunUnitTests=tools/yaxunit.smoke.json',
				'--ordinaryapp': -1,
				'--exitCodePath': './build/out/yaxunit/result.txt',
				'--no-wait': true
			}
		};
		assert.deepStrictEqual(yaxunitSectionFromEnv(envJson), {
			configPath: 'tools/yaxunit.smoke.json',
			ordinaryApp: '-1',
			exitCodePath: './build/out/yaxunit/result.txt',
			additional: undefined,
			noWait: true
		});
		assert.deepStrictEqual(yaxunitSectionFromEnv({}), {
			configPath: undefined,
			ordinaryApp: undefined,
			exitCodePath: undefined,
			additional: undefined,
			noWait: undefined
		});
	});

	test('yaxunitConfigPathFromCommand: путь до точки с запятой, другая команда даёт undefined', () => {
		assert.strictEqual(yaxunitConfigPathFromCommand('RunUnitTests=tools/yaxunit.json'), 'tools/yaxunit.json');
		assert.strictEqual(
			yaxunitConfigPathFromCommand(' runUnitTests = ./tools/yaxunit.json ;ЗавершитьРаботуСистемы'),
			'./tools/yaxunit.json'
		);
		assert.strictEqual(yaxunitConfigPathFromCommand('RunUnitTests='), undefined);
		assert.strictEqual(yaxunitConfigPathFromCommand('Путь=МойКаталог'), undefined);
	});

	test('yaxunitSectionFromEnv: секция vrunner.test.yaxunit autumn-properties (3.x)', () => {
		const autumn = {
			vrunner: {
				test: { yaxunit: { 'yaxunit-config': 'tools/yaxunit.json', report: 'build/out/yaxunit/junit.xml', ordinaryapp: '-1' } }
			}
		};
		assert.deepStrictEqual(yaxunitSectionFromEnv(autumn, 'v3'), {
			configPath: 'tools/yaxunit.json',
			report: 'build/out/yaxunit/junit.xml'
		});
		// отчёт другого формата панель не прочитает: путь остаётся раннеру
		const allure = { vrunner: { test: { yaxunit: { report: 'build/out/yaxunit/allure', 'report-format': 'allure' } } } };
		assert.deepStrictEqual(yaxunitSectionFromEnv(allure, 'v3'), { configPath: undefined, report: undefined });
		// v2-читатель не находит значения в autumn-структуре
		assert.strictEqual(yaxunitSectionFromEnv(autumn, 'v2').configPath, undefined);
	});

	test('yaxunitSectionFromEnv: в 3.x путь отчёта из report-path по каскаду, report запасная', () => {
		const yaxunit = (values: Record<string, unknown>, common: Record<string, unknown> = {}) =>
			({ vrunner: { ...common, test: { yaxunit: values } } });
		assert.strictEqual(
			yaxunitSectionFromEnv(yaxunit({ 'report-path': 'build/yax.xml', report: 'build/old.xml' }), 'v3').report,
			'build/yax.xml'
		);
		assert.strictEqual(
			yaxunitSectionFromEnv(yaxunit({ report: 'build/old.xml' }, { 'report-path': 'build/common.xml' }), 'v3').report,
			'build/common.xml'
		);
		assert.strictEqual(
			yaxunitSectionFromEnv(yaxunit({ 'report-format': ['JUnit'], report: 'build/old.xml' }), 'v3').report,
			'build/old.xml'
		);
		assert.strictEqual(
			yaxunitSectionFromEnv(yaxunit({ 'report-path': 'build/yax' }, { 'report-format': ['junit', 'allure'] }), 'v3').report,
			undefined,
			'YAxUnit пишет один отчёт за прогон'
		);
	});

	test('syntaxCheckJUnitPathFromEnv читает --junitpath секции syntax-check', () => {
		const envJson = {
			'syntax-check': {
				'--junitpath': 'build/out/syntax-check/junit/junit.xml',
				'--groupbymetadata': true
			}
		};
		assert.strictEqual(
			syntaxCheckJUnitPathFromEnv(envJson),
			'build/out/syntax-check/junit/junit.xml'
		);
		assert.strictEqual(syntaxCheckJUnitPathFromEnv({}), undefined);
		assert.strictEqual(syntaxCheckJUnitPathFromEnv({ 'syntax-check': {} }), undefined);
	});

	test('syntaxCheckGroupByMetadataFromEnv возвращает флаг или undefined', () => {
		assert.strictEqual(
			syntaxCheckGroupByMetadataFromEnv({ 'syntax-check': { '--groupbymetadata': true } }),
			true
		);
		assert.strictEqual(
			syntaxCheckGroupByMetadataFromEnv({ 'syntax-check': { '--groupbymetadata': false } }),
			false
		);
		assert.strictEqual(syntaxCheckGroupByMetadataFromEnv({ 'syntax-check': {} }), undefined);
		assert.strictEqual(syntaxCheckGroupByMetadataFromEnv({}), undefined);
	});
});
