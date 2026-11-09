import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { YaxunitAdapter, extractModuleName, procedureCase } from '../../features/testing/adapters/yaxunitAdapter';
import { parseJUnitXml, type JUnitCase } from '../../features/testing/parsers/junitParser';
import { fixturePath } from '../fixtures/helpers/fixturePath';

import { invalidateProjectLayout } from '../../shared/projectLayout';

/** Рабочие области с исходным кодом в обоих форматах. */
const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');
const DESIGNER_WORKSPACE = path.join(FIXTURES, 'designer');
const EDT_WORKSPACE = path.join(FIXTURES, 'edt-workspace');

/** Раннер, знающий только корень рабочей области: остальное адаптер берёт из раскладки. */
function vrunnerAt(workspaceRoot: string, configPath?: string, schema: 'v2' | 'v3' = 'v2'): VRunnerManager {
	const settings = configPath
		? schema === 'v3'
			? { vrunner: { test: { yaxunit: { 'yaxunit-config': configPath } } } }
			: { yaxunit: { '--command': `RunUnitTests=${configPath}` } }
		: {};
	return {
		getWorkspaceRoot: () => workspaceRoot,
		readActiveSettings: async () => ({ settings, schema }),
		planIntent: async () => [['run', 'enterprise']],
		runnerPath: async (hostPath: string) => hostPath,
	} as unknown as VRunnerManager;
}

/** Конфиг профиля с чужим списком расширений: панель должна заменить его фильтром прогона. */
async function writeBaseConfig(dir: string): Promise<string> {
	const configPath = path.join(dir, 'base.json');
	await fs.writeFile(configPath, JSON.stringify({
		filter: { extensions: ['Чужое'] },
		reportPath: 'build/from-config.xml',
	}), 'utf8');
	return configPath;
}

/** Положение модуля в дереве по пути внутри рабочей области. */
function locate(adapter: YaxunitAdapter, workspaceRoot: string, ...segments: string[]) {
	return adapter.describeFileLocation(vscode.Uri.file(path.join(workspaceRoot, ...segments)), workspaceRoot);
}

suite('yaxunitAdapter', () => {
	test('isTestFile: служебный модуль фреймворка (без зарегистрированных тестов) отсекается', async () => {
		const adapter = new YaxunitAdapter(VRunnerManager.getInstance());
		// Похоже на ЮТТестыСлужебный: есть ИсполняемыеСценарии и текст «ДобавитьТест(»,
		// но нет ни одной регистрации .ДобавитьТест("Имя") — это плумбинг, не тесты
		const serviceModule = [
			'Процедура ДобавитьТест(Знач НаборТестов, Знач ИмяТеста) Экспорт',
			'\tНаборТестов.Тесты.Добавить(ИмяТеста);',
			'КонецПроцедуры',
			'',
			'Функция ИсполняемыеСценарии() Экспорт',
			'\tВозврат Неопределено;',
			'КонецФункции'
		].join('\n');
		assert.strictEqual(adapter.isTestFile(serviceModule), false);
	});

	test('isTestFile: модуль с .ДобавитьТест("...") распознаётся тестовым', async () => {
		const adapter = new YaxunitAdapter(VRunnerManager.getInstance());
		const testModule = [
			'Процедура ИсполняемыеСценарии() Экспорт',
			'\tЮТТесты.ДобавитьТест("ПроверитьЗапись");',
			'КонецПроцедуры',
			'',
			'Процедура ПроверитьЗапись() Экспорт',
			'КонецПроцедуры'
		].join('\n');
		assert.strictEqual(adapter.isTestFile(testModule), true);
	});

	test('extractModuleName извлекает имя модуля из пути', () => {
		assert.strictEqual(
			extractModuleName('C:\\proj\\src\\cfe\\Тесты\\CommonModules\\ОМ_ПроверкаЗаписи\\Module.bsl'),
			'ОМ_ПроверкаЗаписи'
		);
		assert.strictEqual(
			extractModuleName('/proj/src/cfe/Tests/CommonModules/ТестыСложения/Module.bsl'),
			'ТестыСложения'
		);
	});

	test('без конфига в профиле свой файл и свой отчёт не создаются', async () => {
		invalidateProjectLayout();
		const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaxunit-report-'));
		const fileUri = vscode.Uri.file(
			path.join(DESIGNER_WORKSPACE, 'tests', 'cfe', 'Тесты', 'CommonModules', 'ОМ_Тест', 'Ext', 'Module.bsl')
		);
		const cases = [
			{
				schema: 'v3' as const,
				settings: {
					vrunner: { test: { yaxunit: { 'report-path': 'build/out/yaxunit/junit.xml' } } },
				},
				report: path.join(DESIGNER_WORKSPACE, 'build', 'out', 'yaxunit', 'junit.xml'),
			},
			{
				schema: 'v2' as const,
				settings: {},
				report: undefined,
			},
		];
		try {
			for (const item of cases) {
				let intent: { configPath?: string; report?: string; filter?: { modules?: string[] } } | undefined;
				const vrunner = {
					getWorkspaceRoot: () => DESIGNER_WORKSPACE,
					readActiveSettings: async () => ({ settings: item.settings, schema: item.schema }),
					planIntent: async (value: { configPath?: string; report?: string; filter?: { modules?: string[] } }) => {
						intent = value;
						return [['test', 'yaxunit']];
					},
					runnerPath: async (hostPath: string) => hostPath,
				} as unknown as VRunnerManager;
				const plan = await new YaxunitAdapter(vrunner).buildRunPlan({ fileUri }, reportDir);
				assert.strictEqual(intent?.configPath, undefined, item.schema);
				assert.strictEqual(intent?.report, undefined, item.schema);
				assert.deepStrictEqual(intent?.filter?.modules, ['ОМ_Тест'], item.schema);
				assert.strictEqual(plan.reportTarget?.path, item.report, item.schema);
			}
			await assert.rejects(fs.access(path.join(reportDir, 'yaxunit-config.json')));
		} finally {
			await fs.rm(reportDir, { recursive: true, force: true });
		}
	});

	test('buildRunPlan: весь модуль — filter.modules, подмножество — filter.tests', async () => {
		const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaxunit-test-'));
		const fileUri = vscode.Uri.file('C:\\proj\\src\\cfe\\T\\CommonModules\\ОМ_Тесты\\Module.bsl');
		const intents: Array<{ filter?: { modules?: string[]; tests?: string[] } }> = [];
		const vrunner = {
			getWorkspaceRoot: () => undefined,
			readActiveSettings: async () => ({ settings: {}, schema: 'v3' as const }),
			planIntent: async (intent: { filter?: { modules?: string[]; tests?: string[] } }) => {
				intents.push(intent);
				return [['test', 'yaxunit']];
			},
			runnerPath: async (hostPath: string) => hostPath,
		} as unknown as VRunnerManager;
		const adapter = new YaxunitAdapter(vrunner);

		try {
			const fullPlan = await adapter.buildRunPlan({ fileUri }, reportDir);
			assert.strictEqual(fullPlan.tool, 'vrunner');
			assert.deepStrictEqual(intents[0]?.filter?.modules, ['ОМ_Тесты']);
			assert.strictEqual(fullPlan.reportTarget, undefined);

			await adapter.buildRunPlan({ fileUri, caseNames: ['ПроверитьЗапись'] }, reportDir);
			assert.deepStrictEqual(intents[1]?.filter?.tests, ['ОМ_Тесты.ПроверитьЗапись']);
			assert.strictEqual(intents[1]?.filter?.modules, undefined);
		} finally {
			await fs.rm(reportDir, { recursive: true, force: true });
		}
	});


	test('buildRunPlan: фильтр по имени расширения из раскладки, а не по списку из конфига проекта', async () => {
		invalidateProjectLayout();
		const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaxunit-ext-'));
		const configPath = await writeBaseConfig(reportDir);
		// имя расширения в метаданных отличается от имени каталога
		const fileUri = vscode.Uri.file(
			path.join(DESIGNER_WORKSPACE, 'tests', 'cfe', 'Тесты', 'CommonModules', 'ОМ_Тест', 'Ext', 'Module.bsl')
		);

		try {
			for (const schema of ['v2', 'v3'] as const) {
				const adapter = new YaxunitAdapter(vrunnerAt(DESIGNER_WORKSPACE, configPath, schema));
				const plan = await adapter.buildRunPlan({ fileUri }, reportDir);
				const config = JSON.parse(await fs.readFile(path.join(reportDir, 'yaxunit-config.json'), 'utf8'));
				// фильтр копии берёт расширение из метаданных, а не список из конфига профиля
				assert.deepStrictEqual(config.filter.extensions, ['Тесты'], schema);
				assert.deepStrictEqual(config.filter.modules, ['ОМ_Тест'], schema);
				assert.strictEqual(config.reportPath, 'build/from-config.xml', schema);
				assert.strictEqual(plan.reportTarget?.path, path.join(DESIGNER_WORKSPACE, 'build', 'from-config.xml'), schema);
			}
		} finally {
			await fs.rm(reportDir, { recursive: true, force: true });
		}
	});

	test('buildRunPlan: у проекта EDT имя расширения берётся из проекта, а не из каталога src', async () => {
		invalidateProjectLayout();
		const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaxunit-edt-'));
		const configPath = await writeBaseConfig(reportDir);
		const fileUri = vscode.Uri.file(
			path.join(EDT_WORKSPACE, 'tests', 'cfe', 'yaxunit-test', 'src', 'CommonModules', 'ОМ_Тест', 'Module.bsl')
		);

		try {
			const adapter = new YaxunitAdapter(vrunnerAt(EDT_WORKSPACE, configPath, 'v3'));
			await adapter.buildRunPlan({ fileUri }, reportDir);
			const config = JSON.parse(await fs.readFile(path.join(reportDir, 'yaxunit-config.json'), 'utf8'));
			assert.deepStrictEqual(config.filter.extensions, ['Тесты']);
		} finally {
			await fs.rm(reportDir, { recursive: true, force: true });
		}
	});

	test('поиск идёт и по расширениям решения, и по тестовым', async () => {
		invalidateProjectLayout();
		const adapter = new YaxunitAdapter(vrunnerAt(DESIGNER_WORKSPACE));

		const globs = await adapter.getIncludeGlobs();

		// расширение с тестами держат отдельно от поставки: без второго корня
		// панель тестирования перестала бы видеть тесты после переноса
		assert.deepStrictEqual(globs, [
			'src/cfe/МоёРасширение/CommonModules/*/Ext/Module.bsl',
			'src/cfe/подмодуль/src/cfe/Вложенное/CommonModules/*/Ext/Module.bsl',
			'tests/cfe/Тесты/CommonModules/*/Ext/Module.bsl',
		]);
	});
});

suite('yaxunitAdapter: раскладка EDT', () => {
	setup(() => {
		invalidateProjectLayout();
	});

	test('модули ищутся в проекте конфигурации, в расширениях проекта и в тестовых проектах', async () => {
		const adapter = new YaxunitAdapter(vrunnerAt(EDT_WORKSPACE));

		const globs = await adapter.getIncludeGlobs();

		assert.deepStrictEqual(globs, [
			'ssl31/src/CommonModules/*/Module.bsl',
			'ssl31._ДемоРасширение/src/CommonModules/*/Module.bsl',
			'учёт.РасширениеУчёта/src/CommonModules/*/Module.bsl',
			'tests/cfe/yaxunit-test/src/CommonModules/*/Module.bsl',
		]);
	});

	test('в дереве модули группируются по проекту, а не по каталогу src', async () => {
		const adapter = new YaxunitAdapter(vrunnerAt(EDT_WORKSPACE));
		await adapter.getIncludeGlobs();

		assert.deepStrictEqual(locate(adapter, EDT_WORKSPACE, 'ssl31', 'src', 'CommonModules', 'ОбщийТест', 'Module.bsl'), {
			segments: ['БиблиотекаСтандартныхПодсистемДемо'],
			label: 'ОбщийТест',
		});
		assert.deepStrictEqual(
			locate(adapter, EDT_WORKSPACE, 'ssl31._ДемоРасширение', 'src', 'CommonModules', 'ОМ_Тест', 'Module.bsl').segments,
			['_ДемоРасширение']
		);
		assert.deepStrictEqual(
			locate(adapter, EDT_WORKSPACE, 'tests', 'cfe', 'yaxunit-test', 'src', 'CommonModules', 'ОМ_Тест', 'Module.bsl').segments,
			['Тесты']
		);
	});

	test('у выгрузки конфигуратора группа тоже имя расширения из метаданных', async () => {
		const adapter = new YaxunitAdapter(vrunnerAt(DESIGNER_WORKSPACE));
		await adapter.getIncludeGlobs();

		// имя расширения в метаданных отличается от имени каталога
		assert.deepStrictEqual(
			locate(adapter, DESIGNER_WORKSPACE, 'src', 'cfe', 'МоёРасширение', 'CommonModules', 'ОМ_Тест', 'Ext', 'Module.bsl').segments,
			['Расширение']
		);
		assert.deepStrictEqual(
			locate(adapter, DESIGNER_WORKSPACE, 'tests', 'cfe', 'Тесты', 'CommonModules', 'ОМ_Тест', 'Ext', 'Module.bsl').segments,
			['Тесты']
		);
	});

	test('модуль вне корней раскладки группируется по каталогу перед CommonModules', async () => {
		const adapter = new YaxunitAdapter(vrunnerAt(DESIGNER_WORKSPACE));
		await adapter.getIncludeGlobs();

		assert.deepStrictEqual(
			locate(adapter, DESIGNER_WORKSPACE, 'чужое', 'Другое', 'CommonModules', 'ОМ_Тест', 'Ext', 'Module.bsl').segments,
			['Другое']
		);
	});

	test('модуль назван для отчёта с расширением из метаданных', async () => {
		const adapter = new YaxunitAdapter(vrunnerAt(DESIGNER_WORKSPACE));
		await adapter.getIncludeGlobs();
		const content = await fs.readFile(fixturePath('yaxunit', 'TestPresentation.bsl'), 'utf8');
		const label = (...segments: string[]) =>
			adapter.parseFile(content, vscode.Uri.file(path.join(DESIGNER_WORKSPACE, ...segments)))?.label;

		assert.strictEqual(label('tests', 'cfe', 'Тесты', 'CommonModules', 'ОМ_Тест', 'Ext', 'Module.bsl'), 'Тесты.ОМ_Тест');
		// имя расширения в метаданных отличается от имени каталога
		assert.strictEqual(
			label('src', 'cfe', 'МоёРасширение', 'CommonModules', 'ОМ_Тест', 'Ext', 'Module.bsl'),
			'Расширение.ОМ_Тест'
		);
		assert.strictEqual(label('чужое', 'Другое', 'CommonModules', 'ОМ_Тест', 'Ext', 'Module.bsl'), 'ОМ_Тест');
	});

	test('у проекта EDT модуль назван с расширением проекта, у конфигурации - без расширения', async () => {
		const adapter = new YaxunitAdapter(vrunnerAt(EDT_WORKSPACE));
		await adapter.getIncludeGlobs();
		const content = await fs.readFile(fixturePath('yaxunit', 'TestPresentation.bsl'), 'utf8');
		const label = (...segments: string[]) =>
			adapter.parseFile(content, vscode.Uri.file(path.join(EDT_WORKSPACE, ...segments)))?.label;

		assert.strictEqual(label('tests', 'cfe', 'yaxunit-test', 'src', 'CommonModules', 'ОМ_Тест', 'Module.bsl'), 'Тесты.ОМ_Тест');
		assert.strictEqual(label('ssl31', 'src', 'CommonModules', 'ОбщийТест', 'Module.bsl'), 'ОбщийТест');
	});
});

suite('yaxunitAdapter: testcase отчёта', () => {
	/** testcase отчёта из фикстуры. */
	async function reportCases(name: string): Promise<JUnitCase[]> {
		return parseJUnitXml(await fs.readFile(fixturePath('yaxunit', 'reports', name), 'utf8'));
	}

	test('тест с описанием назван процедурой из classname, модуль - с расширением', async () => {
		const cases = (await reportCases('test-presentation.xml')).map(procedureCase);
		assert.deepStrictEqual(cases.map((testCase) => [testCase.className, testCase.name]), [
			['YAXUNIT.Док_АктыВыполненныхРабот', 'АктВыполненныхРабот_Корректный'],
			['YAXUNIT.Док_АктыВыполненныхРабот', 'АктВыполненныхРабот_ОшибкаПроведения'],
		]);
	});

	test('у теста без описания меняется только модуль, подробности падения сохраняются', async () => {
		const failed = (await reportCases('ssl31.xml')).find((testCase) => testCase.status === 'failed');
		assert.ok(failed);
		assert.deepStrictEqual(procedureCase(failed), { ...failed, className: 'Тесты.ОМ_Тест_ПримерыПадений' });
	});

	test('без package модуль остаётся без расширения', async () => {
		const [testCase] = await reportCases('test-presentation.xml');
		assert.strictEqual(procedureCase({ ...testCase, suitePackage: undefined }).className, 'Док_АктыВыполненныхРабот');
	});

	test('classname без процедуры не меняется', async () => {
		const [testCase] = await reportCases('test-presentation.xml');
		const moduleOnly = { ...testCase, className: 'Док_АктыВыполненныхРабот' };
		assert.strictEqual(procedureCase(moduleOnly), moduleOnly);
	});
});
