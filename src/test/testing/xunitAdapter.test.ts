import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { epfTestSourceInfo, XUnitAdapter } from '../../features/testing/adapters/xunitAdapter';
import { initActiveConfiguration, setActiveConfiguration } from '../../shared/activeConfiguration';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { TESTS_SUBDIRS, testsSubPath } from '../../shared/pathDefaults';
import { invalidateProjectLayout, testsDirectoryName } from '../../shared/projectLayout';
import type { VRunnerIntent } from '../../shared/vrunnerCli/intents';

/** Рабочие области с исходным кодом в обоих форматах. */
const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');
const EDT_WORKSPACE = path.join(FIXTURES, 'edt-workspace');
const DESIGNER_WORKSPACE = path.join(FIXTURES, 'designer');

/** Исходник тестовой обработки в проекте EDT. */
const EDT_TEST_MODULE = path.join(
	EDT_WORKSPACE, 'tests', 'epf', 'Тесты_Арифметика', 'src', 'ExternalDataProcessors', 'Тесты_Арифметика', 'ObjectModule.bsl'
);

/** Раннер над фикстурой: намерение возвращается аргументом, чтобы план читался в проверке. */
function vrunnerAt(workspaceRoot: string): VRunnerManager {
	return {
		getWorkspaceRoot: () => workspaceRoot,
		getOutPath: () => 'build/out',
		readActiveSettings: async () => ({ settings: {}, schema: 'v2' }),
		planIntent: async (intent: VRunnerIntent) => [[JSON.stringify(intent)]],
	} as unknown as VRunnerManager;
}

/** Намерение из аргументов плана. */
const intentOf = (args: string[]): VRunnerIntent => JSON.parse(args[0]) as VRunnerIntent;

/** Хранилище выбора конфигурации в памяти. */
function memoryContext(): unknown {
	const values = new Map<string, unknown>();
	return {
		workspaceState: {
			get: (key: string) => values.get(key),
			update: async (key: string, value: unknown) => {
				values.set(key, value);
			},
			keys: () => [...values.keys()],
		},
	};
}

suite('xunitAdapter', () => {
	test('epfTestSourceInfo: стандартная структура decompileepf', () => {
		const info = epfTestSourceInfo(
			'C:\\proj\\src\\tests\\Тесты_Сложение\\Тесты_Сложение\\Ext\\ObjectModule.bsl'
		);
		assert.ok(info);
		assert.strictEqual(info.processorName, 'Тесты_Сложение');
		assert.strictEqual(
			info.processorDir,
			path.join('C:', 'proj', 'src', 'tests', 'Тесты_Сложение')
		);
	});

	test('epfTestSourceInfo: обработка в подкаталоге-группе', () => {
		const info = epfTestSourceInfo(
			'C:/proj/tests/epf/Core/Тест_Плагины/Тест_Плагины/Ext/ObjectModule.bsl'
		);
		assert.ok(info);
		assert.strictEqual(info.processorName, 'Тест_Плагины');
		assert.ok(info.processorDir.endsWith(path.join('Core', 'Тест_Плагины')));
	});

	test('epfTestSourceInfo: без дублирующего каталога — берётся внутренний', () => {
		const info = epfTestSourceInfo('C:/proj/tests/epf/Тест_Один/Ext/ObjectModule.bsl');
		assert.ok(info);
		assert.strictEqual(info.processorName, 'Тест_Один');
		assert.ok(info.processorDir.endsWith('Тест_Один'));
		assert.strictEqual(info.format, 'designer');
		assert.strictEqual(info.projectDir, undefined);
	});

	test('epfTestSourceInfo: обработка в проекте EDT', () => {
		const info = epfTestSourceInfo(EDT_TEST_MODULE);
		assert.ok(info);
		assert.strictEqual(info.processorName, 'Тесты_Арифметика');
		assert.strictEqual(info.format, 'edt');
		assert.strictEqual(
			info.processorDir,
			path.join(EDT_WORKSPACE, 'tests', 'epf', 'Тесты_Арифметика', 'src', 'ExternalDataProcessors', 'Тесты_Арифметика')
		);
		assert.strictEqual(info.projectDir, path.join(EDT_WORKSPACE, 'tests', 'epf', 'Тесты_Арифметика'));
	});

	test('поиск обработок идёт по корню тестов', async () => {
		const adapter = new XUnitAdapter(VRunnerManager.getInstance());

		const globs = await adapter.getIncludeGlobs();

		// Панель ищет исходники там же, куда смотрят команды сборки, иначе ветка
		// xUnit опустеет
		const expected = testsSubPath(testsDirectoryName(), TESTS_SUBDIRS.epf);
		assert.strictEqual(expected, 'tests/epf');
		assert.deepStrictEqual(globs, [
			`${expected}/**/Ext/ObjectModule.bsl`,
			`${expected}/**/src/ExternalDataProcessors/*/ObjectModule.bsl`,
		]);
	});

	test('epfTestSourceInfo: не ObjectModule.bsl — undefined', () => {
		assert.strictEqual(epfTestSourceInfo('C:/proj/tests/Тест.os'), undefined);
		assert.strictEqual(
			epfTestSourceInfo('C:/proj/tests/epf/Тест/Forms/Форма/Ext/Form/Module.bsl'),
			undefined
		);
		assert.strictEqual(epfTestSourceInfo('C:/proj/ObjectModule.bsl'), undefined);
	});
});

suite('поиск тестов в раскладке EDT', () => {
	setup(async () => {
		invalidateProjectLayout();
		initActiveConfiguration(memoryContext() as never);
		await setActiveConfiguration(undefined);
	});

	test('xUnit ищет тестовые обработки и в проекте EDT', async () => {
		const adapter = new XUnitAdapter(VRunnerManager.getInstance());

		const globs = await adapter.getIncludeGlobs();

		assert.ok(
			globs.some((glob) => glob.endsWith('/src/ExternalDataProcessors/*/ObjectModule.bsl')),
			`в раскладке EDT обработки лежат иначе: ${globs.join(', ')}`
		);
	});

	test('проекты с обработками решения в ветку xUnit не попадают', async () => {
		const adapter = new XUnitAdapter(vrunnerAt(EDT_WORKSPACE));

		const globs = await adapter.getIncludeGlobs();

		assert.deepStrictEqual(globs, [
			'tests/epf/**/Ext/ObjectModule.bsl',
			'tests/epf/**/src/ExternalDataProcessors/*/ObjectModule.bsl',
			'tests/epf/Тесты_Арифметика/src/ExternalDataProcessors/*/ObjectModule.bsl',
		]);
	});

	test('обработка из проекта EDT в дереве зовётся своим именем, а не ObjectModule.bsl', async () => {
		const adapter = new XUnitAdapter(vrunnerAt(EDT_WORKSPACE));
		await adapter.getIncludeGlobs();

		const location = adapter.describeFileLocation(vscode.Uri.file(EDT_TEST_MODULE), EDT_WORKSPACE);

		// Проект лежит прямо в каталоге тестовых обработок: промежуточных узлов нет
		assert.deepStrictEqual(location, { segments: [], label: 'Тесты_Арифметика' });
	});

	test('прогон обработки из проекта EDT: выгрузка, сборка выгрузки, запуск собранного .epf', async () => {
		const adapter = new XUnitAdapter(vrunnerAt(EDT_WORKSPACE));

		const plan = await adapter.buildRunPlan({ fileUri: vscode.Uri.file(EDT_TEST_MODULE) }, path.join(EDT_WORKSPACE, 'run'));

		assert.deepStrictEqual(plan.prepare?.map((step) => step.tool), ['action', 'vrunner']);
		assert.strictEqual(plan.prepare?.[0].title, 'Выгрузка из 1С:EDT: tests/epf/Тесты_Арифметика');
		// Раннер собирает выгрузку проекта, а не его исходники
		assert.deepStrictEqual(intentOf(plan.prepare![1].args), {
			kind: 'epf.build',
			src: 'build/out/edt-export/Тесты_Арифметика',
			out: path.join('build/out', 'tests', 'epf'),
		});
		const run = intentOf(plan.args) as Extract<VRunnerIntent, { kind: 'test.xunit' }>;
		assert.strictEqual(run.kind, 'test.xunit');
		assert.strictEqual(run.testsPath, path.join('build/out', 'tests', 'epf', 'Тесты_Арифметика.epf'));
	});

	test('батч-прогон: выгрузка идёт перед сборками, каталог прогона собирается после', async () => {
		const adapter = new XUnitAdapter(vrunnerAt(EDT_WORKSPACE));

		const plan = await adapter.buildBatchRunPlan([{ fileUri: vscode.Uri.file(EDT_TEST_MODULE) }], path.join(EDT_WORKSPACE, 'run'));

		assert.deepStrictEqual(plan?.prepare?.map((step) => step.tool), ['action', 'vrunner', 'action']);
		assert.strictEqual(intentOf(plan!.prepare![1].args).kind, 'epf.build');
	});

	test('выгрузка конфигуратора собирается как раньше, без шага выгрузки', async () => {
		const adapter = new XUnitAdapter(vrunnerAt(DESIGNER_WORKSPACE));
		const module = path.join(
			DESIGNER_WORKSPACE, 'tests', 'epf', 'Тесты_Арифметика', 'Тесты_Арифметика', 'Ext', 'ObjectModule.bsl'
		);

		const plan = await adapter.buildRunPlan({ fileUri: vscode.Uri.file(module) }, path.join(DESIGNER_WORKSPACE, 'run'));

		assert.deepStrictEqual(plan.prepare?.map((step) => step.tool), ['vrunner']);
		assert.deepStrictEqual(intentOf(plan.prepare![0].args), {
			kind: 'epf.build',
			src: path.join(DESIGNER_WORKSPACE, 'tests', 'epf', 'Тесты_Арифметика'),
			out: path.join('build/out', 'tests', 'epf'),
		});
	});

	test('обработка EDT вне проекта не собирается молча', async () => {
		const adapter = new XUnitAdapter(vrunnerAt(EDT_WORKSPACE));
		const stray = path.join(EDT_WORKSPACE, 'tests', 'epf', 'Чужая', 'src', 'ExternalDataProcessors', 'Чужая', 'ObjectModule.bsl');

		await assert.rejects(
			() => adapter.buildRunPlan({ fileUri: vscode.Uri.file(stray) }, path.join(EDT_WORKSPACE, 'run')),
			/вне проекта 1С:EDT/
		);
	});
});
