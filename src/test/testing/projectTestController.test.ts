import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AdapterRunPlan, FileTreeLocation, TestFrameworkAdapter, TestFrameworkId } from '../../features/testing/frameworkAdapter';
import { findProjectFiles } from '../../features/artifacts/projectScan';
import { TestingController } from '../../features/testing/testController';
import { DEFAULT_PROFILE_ID } from '../../shared/envProfiles';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { testingVRunner } from '../fixtures/helpers/testingVRunner';
import { buildProcessCommand } from '../../utils/commandUtils';
import { currentRoot, sameProjectRoot, type ProjectScanRoot } from '../../shared/workspaceProjects';

/** Проект с подпроектом и зависимостями. */
const PROJECT = path.resolve(__dirname, '../../../src/test/fixtures/workspaceScan/проект');
const SUB_PROJECT = path.join(PROJECT, 'подпроект');

/** Адаптер, который запоминает корень, видимый при обнаружении и прогоне. */
class RecordingAdapter implements TestFrameworkAdapter {
	public readonly id: TestFrameworkId = 'onescript';
	public readonly label: string = 'OneScript';
	public readonly usesVanessaRunner: boolean = false;
	public readonly usesReportDir = false;
	public readonly discoveryRoots: (string | undefined)[] = [];
	public readonly runRoots: (string | undefined)[] = [];

	public async isEnabled(): Promise<boolean> {
		return true;
	}

	public getIncludeGlobs(): string[] {
		this.discoveryRoots.push(currentRoot());
		return ['tests/**/*.os'];
	}

	public parseFile(): undefined {
		return undefined;
	}

	public describeFileLocation(): FileTreeLocation {
		return { segments: [] };
	}

	public async buildRunPlan(): Promise<AdapterRunPlan> {
		this.runRoots.push(currentRoot());
		throw new Error('процесс в проверке не запускается');
	}
}

/** Адаптер, чей прогон исполняет готовую команду оболочки. */
class ShellAdapter extends RecordingAdapter {
	constructor(private readonly command: string, private readonly report: string) {
		super();
	}

	public override async buildRunPlan(): Promise<AdapterRunPlan> {
		return { tool: 'shell', args: [this.command], reportTarget: { format: 'junit', path: this.report } };
	}
}

/** Адаптер тестов 1С: прогон идёт через vanessa-runner, файлы — в каталоге features. */
class VRunnerShellAdapter extends ShellAdapter {
	public override readonly id: TestFrameworkId = 'xunit';
	public override readonly label: string = 'xUnit';
	public override readonly usesVanessaRunner: boolean = true;

	public override getIncludeGlobs(): string[] {
		return ['features/**/*.os'];
	}
}

interface ControllerInternals {
	controller: vscode.TestController;
	runHandler(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void>;
}

const scanRootOf = async (root: string): Promise<ProjectScanRoot> => ({
	root,
	excludeDirs: sameProjectRoot(root, PROJECT) ? [SUB_PROJECT] : [],
});

function fileItems(controller: vscode.TestController): vscode.TestItem[] {
	const files: vscode.TestItem[] = [];
	const visit = (item: vscode.TestItem) => {
		if (item.uri && path.extname(item.uri.fsPath) === '.os') {
			files.push(item);
		}
		item.children.forEach(visit);
	};
	controller.items.forEach(visit);
	return files;
}

const labels = (controller: vscode.TestController) => fileItems(controller).map((item) => item.label).sort();

const isRoot = (expected: string) => (root: string | undefined) => root !== undefined && sameProjectRoot(root, expected);

suite('тестирование: дерево текущего проекта', () => {
	test('поиск от корня проекта без подпроекта и зависимостей', async function () {
		this.timeout(60_000);
		const files = await findProjectFiles({ root: PROJECT, excludeDirs: [SUB_PROJECT] }, '**/*.os', ['oscript_modules']);

		assert.deepStrictEqual(
			files.map((uri) => path.relative(PROJECT, uri.fsPath).split(path.sep).join('/')),
			['tests/Проверка.os']
		);
	});

	test('смена проекта пересобирает дерево, адаптеры видят корень проекта', async function () {
		this.timeout(60_000);
		const adapter = new RecordingAdapter();
		const testing = new TestingController([adapter], testingVRunner(), { current: true }, {
			id: '1c-platform-tools-tests-project-switch',
			scanRootOf,
		});
		const internals = testing as unknown as ControllerInternals;
		try {
			testing.setProject(PROJECT);
			await testing.enqueueRebuild();
			assert.deepStrictEqual(labels(internals.controller), ['Проверка.os']);
			assert.ok(adapter.discoveryRoots.length > 0 && adapter.discoveryRoots.every(isRoot(PROJECT)));

			testing.setProject(SUB_PROJECT);
			await testing.enqueueRebuild();
			assert.deepStrictEqual(labels(internals.controller), ['Подпроект.os']);
			assert.ok(isRoot(SUB_PROJECT)(adapter.discoveryRoots.at(-1)));
		} finally {
			testing.dispose();
		}
	});

	test('прогон идёт в проекте, чьи файлы в дереве', async function () {
		this.timeout(60_000);
		const adapter = new RecordingAdapter();
		const testing = new TestingController([adapter], testingVRunner(), { current: true }, {
			id: '1c-platform-tools-tests-run-root',
			scanRootOf,
		});
		const internals = testing as unknown as ControllerInternals;
		const cancellation = new vscode.CancellationTokenSource();
		try {
			testing.setProject(PROJECT);
			await testing.enqueueRebuild();
			const [item] = fileItems(internals.controller);
			assert.ok(item);

			testing.setProject(SUB_PROJECT);
			await internals.runHandler(new vscode.TestRunRequest([item]), cancellation.token);

			assert.strictEqual(adapter.runRoots.length, 1);
			assert.ok(isRoot(PROJECT)(adapter.runRoots[0]));
		} finally {
			cancellation.dispose();
			testing.dispose();
		}
	});

	test('раннер OneScript получает окружение выбранного движка', async function () {
		this.timeout(60_000);
		const output = path.join(os.tmpdir(), `1cpt-onescript-env-${process.pid}.txt`);
		const envRoots: (string | undefined)[] = [];
		const vrunner = testingVRunner({
			oneScriptEnv: async (extra?: NodeJS.ProcessEnv) => {
				envRoots.push(currentRoot());
				return { ...process.env, ...extra, ONESCRIPT_ENGINE: 'выбранный' };
			},
		});
		const adapter = new ShellAdapter(
			buildProcessCommand('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(output)}, process.env.ONESCRIPT_ENGINE ?? '')`]),
			`${output}.xml`
		);
		const testing = new TestingController([adapter], vrunner, { current: true }, {
			id: '1c-platform-tools-tests-engine-env',
			scanRootOf,
		});
		const internals = testing as unknown as ControllerInternals;
		const cancellation = new vscode.CancellationTokenSource();
		try {
			testing.setProject(PROJECT);
			await testing.enqueueRebuild();
			const [item] = fileItems(internals.controller);
			assert.ok(item);

			await internals.runHandler(new vscode.TestRunRequest([item]), cancellation.token);

			assert.strictEqual(fs.readFileSync(output, 'utf8'), 'выбранный');
			assert.ok(envRoots.length === 1 && isRoot(PROJECT)(envRoots[0]));
		} finally {
			fs.rmSync(output, { force: true });
			cancellation.dispose();
			testing.dispose();
		}
	});
});

suite('тестирование: предупреждение о движке OneScript', () => {
	test('тесты через vanessa-runner в Docker движок машины не проверяют, тесты OneScript проверяют', async function () {
		this.timeout(60_000);
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-warning-'));
		fs.mkdirSync(path.join(root, 'tests'));
		fs.mkdirSync(path.join(root, 'features'));
		fs.writeFileSync(path.join(root, 'tests', 'Проверка.os'), '', 'utf8');
		fs.writeFileSync(path.join(root, 'features', 'Сценарий.os'), '', 'utf8');
		let warnings = 0;
		const vrunner = testingVRunner({
			shouldUseDocker: async () => true,
			warnIfEngineUnfit: async () => {
				warnings += 1;
			},
			oneScriptEnv: async (extra?: NodeJS.ProcessEnv) => ({ ...process.env, ...extra }),
		});
		const noop = buildProcessCommand('node', ['-e', '']);
		const testing = new TestingController(
			[new ShellAdapter(noop, path.join(root, 'onescript.xml')), new VRunnerShellAdapter(noop, path.join(root, 'xunit.xml'))],
			vrunner,
			{ current: true },
			{
				id: '1c-platform-tools-tests-engine-warning',
				scanRootOf: async (scanned: string): Promise<ProjectScanRoot> => ({ root: scanned, excludeDirs: [] }),
			}
		);
		const internals = testing as unknown as ControllerInternals;
		const cancellation = new vscode.CancellationTokenSource();
		// Предупреждение идёт мимо прогона: даём ему завершиться
		const settled = () => new Promise((resolve) => setTimeout(resolve, 50));
		try {
			testing.setProject(root);
			await testing.enqueueRebuild();
			const file = (label: string) => fileItems(internals.controller).find((item) => item.label === label);
			const scenario = file('Сценарий.os');
			const check = file('Проверка.os');
			assert.ok(scenario && check, 'дерево должно найти оба файла');

			await internals.runHandler(new vscode.TestRunRequest([scenario]), cancellation.token);
			await settled();
			assert.strictEqual(warnings, 0, 'vanessa-runner в Docker работает движком образа');

			await internals.runHandler(new vscode.TestRunRequest([check]), cancellation.token);
			await settled();
			assert.strictEqual(warnings, 1, 'тесты OneScript идут движком этой машины');
		} finally {
			cancellation.dispose();
			testing.dispose();
			fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
		}
	});
});

suite('тестирование: окружение запуска', () => {
	const vrunner = VRunnerManager.getInstance();
	let root: string;
	let output: string;
	let adapter: ShellAdapter;
	let testing: TestingController;
	let internals: ControllerInternals;
	let cancellation: vscode.CancellationTokenSource;

	setup(async function () {
		this.timeout(60_000);
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'environment-run-'));
		output = path.join(root, 'вывод.txt');
		fs.mkdirSync(path.join(root, 'tests'));
		fs.writeFileSync(path.join(root, 'tests', 'Проверка.os'), '', 'utf8');
		fs.writeFileSync(path.join(root, '.env.dev'), 'RUN_INTEGRATION=true\n', 'utf8');
		adapter = new ShellAdapter(
			buildProcessCommand('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(output)}, process.env.RUN_INTEGRATION ?? 'нет')`]),
			path.join(root, 'junit.xml')
		);
		testing = new TestingController([adapter], vrunner, { current: true }, {
			id: '1c-platform-tools-tests-environment',
			scanRootOf: async (scanned: string): Promise<ProjectScanRoot> => ({ root: scanned, excludeDirs: [] }),
		});
		internals = testing as unknown as ControllerInternals;
		cancellation = new vscode.CancellationTokenSource();
		testing.setProject(root);
		await testing.enqueueRebuild();
	});

	teardown(() => {
		cancellation.dispose();
		testing.dispose();
		fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
	});

	async function run(environmentId: string | undefined): Promise<void> {
		await vrunner.runWithProjectRoot(root, () => vrunner.setActiveEnvironmentId(environmentId));
		const [item] = fileItems(internals.controller);
		assert.ok(item, 'дерево должно найти тестовый файл');
		await internals.runHandler(new vscode.TestRunRequest([item]), cancellation.token);
	}

	test('раннер получает переменные выбранного окружения, по умолчанию их нет', async function () {
		this.timeout(60_000);
		await run('dev');
		assert.strictEqual(fs.readFileSync(output, 'utf8'), 'true');
		await run(undefined);
		assert.strictEqual(fs.readFileSync(output, 'utf8'), 'нет');
	});

	test('выбранного окружения нет: прогон не начинается', async function () {
		this.timeout(60_000);
		await run('stage');
		assert.strictEqual(fs.existsSync(output), false);
	});

	test('выбранного профиля нет: тест OneScript идёт, тест через vanessa-runner не начинается', async function () {
		this.timeout(60_000);
		const oneCOutput = path.join(root, 'тест-1с.txt');
		fs.mkdirSync(path.join(root, 'features'));
		fs.writeFileSync(path.join(root, 'features', 'Сценарий.os'), '', 'utf8');
		const oneC = new VRunnerShellAdapter(
			buildProcessCommand('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(oneCOutput)}, 'запущен')`]),
			path.join(root, 'junit-1c.xml')
		);
		const mixed = new TestingController([adapter, oneC], vrunner, { current: true }, {
			id: '1c-platform-tools-tests-missing-profile',
			scanRootOf: async (scanned: string): Promise<ProjectScanRoot> => ({ root: scanned, excludeDirs: [] }),
		});
		const mixedInternals = mixed as unknown as ControllerInternals;
		try {
			mixed.setProject(root);
			await mixed.enqueueRebuild();
			await vrunner.runWithProjectRoot(root, () => vrunner.setActiveEnvProfileId('dev'));
			const items = fileItems(mixedInternals.controller);
			assert.strictEqual(items.length, 2, 'дерево должно найти оба тестовых файла');

			await mixedInternals.runHandler(new vscode.TestRunRequest(items), cancellation.token);

			assert.strictEqual(fs.readFileSync(output, 'utf8'), 'нет', 'тест OneScript прошёл без профиля');
			assert.strictEqual(fs.existsSync(oneCOutput), false, 'тест через vanessa-runner не начался');
		} finally {
			await vrunner.runWithProjectRoot(root, () => vrunner.setActiveEnvProfileId(DEFAULT_PROFILE_ID));
			mixed.dispose();
		}
	});
});
