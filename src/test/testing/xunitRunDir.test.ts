import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { XUnitAdapter } from '../../features/testing/adapters/xunitAdapter';
import { VRunnerManager } from '../../shared/vrunnerManager';

/**
 * Заглушка менеджера: path.out задаётся относительно проекта, как в настройках.
 * Именно на этом ломался сбор каталога прогона — файловая система в процессе
 * расширения относительный путь не находит.
 */
function managerFor(workspaceRoot: string): VRunnerManager {
	return {
		getOutPath: () => path.join('build', 'out'),
		getWorkspaceRoot: () => workspaceRoot,
		getTestsSrcPath: () => path.join('tests', 'epf'),
		getTestsPath: () => 'tests',
		planIntent: async () => [['test', 'xunit']],
		readActiveSettings: async () => {
			throw new Error('в проекте нет файла настроек');
		},
	} as unknown as VRunnerManager;
}

suite('xunit: каталог прогона', () => {
	let workspaceRoot = '';

	setup(async () => {
		workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1cpt-xunit-'));
		const built = path.join(workspaceRoot, 'build', 'out', 'tests', 'epf');
		await fs.mkdir(built, { recursive: true });
		for (const name of ['Тесты_Арифметика', 'Тесты_ПримерыПадений', 'Тесты_Посторонние']) {
			await fs.writeFile(path.join(built, `${name}.epf`), name);
		}
	});

	teardown(async () => {
		await fs.rm(workspaceRoot, { recursive: true, force: true });
	});

	/** Единица прогона по исходнику обработки в раскладке decompileepf. */
	const unitFor = (name: string) => ({
		fileUri: vscode.Uri.file(
			path.join(workspaceRoot, 'tests', 'epf', name, name, 'Ext', 'ObjectModule.bsl')
		),
	});

	test('в каталог прогона попадают только выбранные обработки', async () => {
		const adapter = new XUnitAdapter(managerFor(workspaceRoot));
		const reportDir = path.join(workspaceRoot, 'run');
		await fs.mkdir(reportDir, { recursive: true });

		const plan = await adapter.buildBatchRunPlan(
			[unitFor('Тесты_Арифметика'), unitFor('Тесты_ПримерыПадений')],
			reportDir
		);
		assert.ok(plan, 'план батч-прогона не построился');

		const collect = plan.prepare?.find((step) => step.tool === 'action');
		assert.ok(collect, 'шага сбора каталога прогона нет');
		await collect.run?.();

		const collected = (await fs.readdir(path.join(reportDir, 'epf'))).sort();
		assert.deepStrictEqual(collected, ['Тесты_Арифметика.epf', 'Тесты_ПримерыПадений.epf']);
	});

	test('шаг сборки каталога идёт после сборки обработок', async () => {
		const adapter = new XUnitAdapter(managerFor(workspaceRoot));
		const plan = await adapter.buildBatchRunPlan(
			[unitFor('Тесты_Арифметика')],
			path.join(workspaceRoot, 'run')
		);

		const kinds = plan?.prepare?.map((step) => step.tool);
		assert.deepStrictEqual(kinds, ['vrunner', 'action']);
	});

	test('собранной обработки нет — понятная ошибка, а не пустой прогон', async () => {
		const adapter = new XUnitAdapter(managerFor(workspaceRoot));
		const reportDir = path.join(workspaceRoot, 'run');
		await fs.mkdir(reportDir, { recursive: true });
		await fs.rm(path.join(workspaceRoot, 'build', 'out', 'tests', 'epf', 'Тесты_Арифметика.epf'));

		const plan = await adapter.buildBatchRunPlan(
			[unitFor('Тесты_Арифметика'), unitFor('Тесты_ПримерыПадений')],
			reportDir
		);
		const collect = plan?.prepare?.find((step) => step.tool === 'action');

		await assert.rejects(() => collect!.run!(), /Тесты_Арифметика\.epf/);
	});
});
