import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AdapterRunPlan } from '../../features/testing/frameworkAdapter';
import { YaxunitAdapter } from '../../features/testing/adapters/yaxunitAdapter';
import { TestingController } from '../../features/testing/testController';
import { invalidateProjectLayout } from '../../shared/projectLayout';
import type { VRunnerManager } from '../../shared/vrunnerManager';
import { testingVRunner } from '../fixtures/helpers/testingVRunner';
import type { ProjectScanRoot } from '../../shared/workspaceProjects';
import { buildProcessCommand } from '../../utils/commandUtils';
import { fixturePath } from '../fixtures/helpers/fixturePath';

const PROJECT = fixturePath('yaxunit', 'project');
const REPORTS = fixturePath('yaxunit', 'reports');

/** YAxUnit, у которого прогон в 1С заменён копированием готового отчёта. */
class ReplayedYaxunitAdapter extends YaxunitAdapter {
	public readonly usesReportDir = false;
	public report = '';

	constructor(vrunner: VRunnerManager, private readonly target: string) {
		super(vrunner);
	}

	public override async buildRunPlan(): Promise<AdapterRunPlan> {
		return this.replay();
	}

	public override async buildBatchRunPlan(): Promise<AdapterRunPlan> {
		return this.replay();
	}

	private replay(): AdapterRunPlan {
		const script = `require('fs').copyFileSync(${JSON.stringify(this.report)}, ${JSON.stringify(this.target)})`;
		return {
			tool: 'shell',
			args: [buildProcessCommand('node', ['-e', script])],
			reportTarget: { format: 'junit', path: this.target },
		};
	}
}

type Status = 'passed' | 'failed' | 'errored' | 'skipped';

/** Прогон, который запоминает итог каждого узла. */
class RecordingRun {
	public readonly statuses = new Map<string, Status>();
	public output = '';

	public enqueued(): void {}
	public started(): void {}
	public passed(item: vscode.TestItem): void {
		this.statuses.set(item.id, 'passed');
	}
	public failed(item: vscode.TestItem): void {
		this.statuses.set(item.id, 'failed');
	}
	public errored(item: vscode.TestItem): void {
		this.statuses.set(item.id, 'errored');
	}
	public skipped(item: vscode.TestItem): void {
		this.statuses.set(item.id, 'skipped');
	}
	public appendOutput(text: string): void {
		this.output += text;
	}
	public end(): void {}
}

interface ControllerInternals {
	controller: vscode.TestController;
	runHandler(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void>;
}

/** Узлы модулей по имени «Расширение.Модуль»: кейсы под модулем ссылаются на тот же файл. */
function moduleItems(controller: vscode.TestController): Map<string, vscode.TestItem> {
	const modules = new Map<string, vscode.TestItem>();
	const visit = (item: vscode.TestItem) => {
		if (item.uri && path.basename(item.uri.fsPath) === 'Module.bsl') {
			modules.set(`${item.parent?.label}.${item.label}`, item);
			return;
		}
		item.children.forEach(visit);
	};
	controller.items.forEach(visit);
	return modules;
}

suite('YAxUnit: результаты прогона в дереве', () => {
	let target: string;
	let testing: TestingController;
	let adapter: ReplayedYaxunitAdapter;
	let internals: ControllerInternals;
	let modules: Map<string, vscode.TestItem>;

	suiteSetup(async function () {
		this.timeout(60_000);
		target = fs.mkdtempSync(path.join(os.tmpdir(), '1cpt-yaxunit-run-'));
		invalidateProjectLayout();
		const vrunner = testingVRunner({
			getWorkspaceRoot: () => PROJECT,
			oneScriptEnv: async (extra?: NodeJS.ProcessEnv) => ({ ...process.env, ...extra }),
		});
		adapter = new ReplayedYaxunitAdapter(vrunner, path.join(target, 'junit.xml'));
		testing = new TestingController([adapter], vrunner, { current: true }, {
			id: '1c-platform-tools-tests-yaxunit-results',
			scanRootOf: async (root: string): Promise<ProjectScanRoot> => ({ root, excludeDirs: [] }),
		});
		internals = testing as unknown as ControllerInternals;
		testing.setProject(PROJECT);
		await testing.enqueueRebuild();
		modules = moduleItems(internals.controller);
	});

	suiteTeardown(() => {
		testing?.dispose();
		fs.rmSync(target, { recursive: true, force: true });
		invalidateProjectLayout();
	});

	/**
	 * Прогоняет модули с готовым отчётом.
	 *
	 * @returns Записанный прогон и итоги по узлам «Расширение.Модуль» и «Расширение.Модуль.Процедура»
	 */
	async function runWith(report: string, keys: string[]) {
		adapter.report = path.join(REPORTS, report);
		const run = new RecordingRun();
		internals.controller.createTestRun = () => run as unknown as vscode.TestRun;
		const items = keys.map((key) => modules.get(key)!);
		const cancellation = new vscode.CancellationTokenSource();
		try {
			await internals.runHandler(new vscode.TestRunRequest(items), cancellation.token);
		} finally {
			cancellation.dispose();
		}
		const statuses: Record<string, Status | undefined> = {};
		items.forEach((module, index) => {
			statuses[keys[index]] = run.statuses.get(module.id);
			module.children.forEach((item) => {
				statuses[`${keys[index]}.${item.label}`] = run.statuses.get(item.id);
			});
		});
		return { run, statuses };
	}

	test('фикстура: в дереве модули трёх расширений', () => {
		assert.deepStrictEqual([...modules.keys()].sort(), [
			'YAXUNIT.Док_АктыВыполненныхРабот',
			'_ДемоПустоеРасширение.ОМ_Тест_Арифметика',
			'Тесты.ОМ_Тест_Арифметика',
			'Тесты.ОМ_Тест_ПримерыПадений',
			'Тесты.ОМ_Тест_РаботаСоСтроками',
		]);
	});

	test('тест с описанием и тегом получает статус своей процедуры', async function () {
		this.timeout(60_000);
		const { run, statuses } = await runWith('test-presentation.xml', ['YAXUNIT.Док_АктыВыполненныхРабот']);

		assert.deepStrictEqual(statuses, {
			'YAXUNIT.Док_АктыВыполненныхРабот': 'passed',
			'YAXUNIT.Док_АктыВыполненныхРабот.АктВыполненныхРабот_Корректный': 'passed',
			'YAXUNIT.Док_АктыВыполненныхРабот.АктВыполненныхРабот_ОшибкаПроведения': 'passed',
		});
		assert.ok(!run.output.includes('не сопоставлен'), run.output);
	});

	test('общий отчёт расходится по модулям, одноимённый модуль другого расширения чужих статусов не получает', async function () {
		this.timeout(60_000);
		const { run, statuses } = await runWith('ssl31.xml', [
			'Тесты.ОМ_Тест_Арифметика',
			'Тесты.ОМ_Тест_ПримерыПадений',
			'Тесты.ОМ_Тест_РаботаСоСтроками',
			'_ДемоПустоеРасширение.ОМ_Тест_Арифметика',
		]);

		assert.ok(run.output.includes('батч-прогон (4 файлов)'), run.output);
		assert.deepStrictEqual(statuses, {
			'Тесты.ОМ_Тест_Арифметика': 'passed',
			'Тесты.ОМ_Тест_Арифметика.СложениеЧисел': 'passed',
			'Тесты.ОМ_Тест_Арифметика.УмножениеЧисел': 'passed',
			'Тесты.ОМ_Тест_Арифметика.ОкруглениеЧисел': 'passed',
			'Тесты.ОМ_Тест_ПримерыПадений': 'errored',
			'Тесты.ОМ_Тест_ПримерыПадений.Упасть_НеверноеОжидание': 'failed',
			'Тесты.ОМ_Тест_ПримерыПадений.Упасть_Исключение': 'errored',
			'Тесты.ОМ_Тест_ПримерыПадений.Пройти_ДляКонтраста': 'passed',
			'Тесты.ОМ_Тест_РаботаСоСтроками': 'passed',
			'Тесты.ОМ_Тест_РаботаСоСтроками.СокращениеПробелов': 'passed',
			'Тесты.ОМ_Тест_РаботаСоСтроками.ПреобразованиеРегистра': 'passed',
			'Тесты.ОМ_Тест_РаботаСоСтроками.РазделениеСтроки': 'passed',
			'_ДемоПустоеРасширение.ОМ_Тест_Арифметика': 'skipped',
			'_ДемоПустоеРасширение.ОМ_Тест_Арифметика.СложениеЧисел': 'skipped',
			'_ДемоПустоеРасширение.ОМ_Тест_Арифметика.УмножениеЧисел': 'skipped',
			'_ДемоПустоеРасширение.ОМ_Тест_Арифметика.ОкруглениеЧисел': 'skipped',
		});
		assert.ok(!run.output.includes('не сопоставлен'), run.output);
	});
});
