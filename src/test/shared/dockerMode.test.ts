import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { VRunnerIntent } from '../../shared/vrunnerCli';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { runWithProject } from '../../shared/workspaceProjects';
import { writeLocalRunner } from '../fixtures/helpers/vrunnerStub';

const PROJECT = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout/designer');

suite('Docker: режим проекта', () => {
	const config = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration('1c-platform-tools');

	teardown(async () => {
		await config().update('docker.enabled', undefined, vscode.ConfigurationTarget.Workspace);
	});

	test('клиент с окном выполняется на этой машине', async () => {
		await config().update('docker.enabled', true, vscode.ConfigurationTarget.Workspace);
		const vrunner = VRunnerManager.getInstance();

		await runWithProject(PROJECT, async () => {
			assert.strictEqual(await vrunner.shouldUseDocker(), true);
			assert.strictEqual(await vrunner.runOnThisMachine(() => vrunner.shouldUseDocker()), false);
		});
	});

	test('порты из docker.runArgs публикуются только клиенту с окном', async () => {
		await config().update('docker.enabled', true, vscode.ConfigurationTarget.Workspace);
		await config().update('docker.image', 'vrunner:8.3.27-vnc', vscode.ConfigurationTarget.Workspace);
		await config().update('docker.runArgs', ['-p', '127.0.0.1:6080:6080', '--network', 'host'], vscode.ConfigurationTarget.Workspace);
		const vrunner = VRunnerManager.getInstance();
		const internals = vrunner as unknown as {
			dockerPlan(argsArray: string[][]): { options: { runArgs?: string[] } } | { error: string };
		};
		const runArgs = (): string[] | undefined => {
			const plan = internals.dockerPlan([['--version']]);
			assert.ok(!('error' in plan), 'error' in plan ? plan.error : '');
			return plan.options.runArgs;
		};

		try {
			await runWithProject(PROJECT, async () => {
				assert.deepStrictEqual(runArgs(), ['--network', 'host']);
				assert.deepStrictEqual(
					await vrunner.runWithWindow(async () => runArgs()),
					['-p', '127.0.0.1:6080:6080', '--network', 'host']
				);
			});
		} finally {
			await config().update('docker.image', undefined, vscode.ConfigurationTarget.Workspace);
			await config().update('docker.runArgs', undefined, vscode.ConfigurationTarget.Workspace);
		}
	});

	test('в контейнере клиент 1С не отпускается с --no-wait', async () => {
		const vrunner = VRunnerManager.getInstance();
		const intents: VRunnerIntent[] = [
			{ kind: 'run.designer', noWait: true },
			{ kind: 'infobase.updateDb' },
		];

		await runWithProject(PROJECT, async () => {
			assert.deepStrictEqual(await vrunner.runnableIntents(intents), intents);
			await config().update('docker.enabled', true, vscode.ConfigurationTarget.Workspace);
			assert.deepStrictEqual(await vrunner.runnableIntents(intents), [
				{ kind: 'run.designer', noWait: false },
				{ kind: 'infobase.updateDb' },
			]);
			assert.deepStrictEqual(await vrunner.runOnThisMachine(() => vrunner.runnableIntents(intents)), intents);
		});
	});

	test('путь файла проекта для раннера в Docker ведёт в /workspace', async () => {
		const vrunner = VRunnerManager.getInstance();
		const report = path.join(PROJECT, 'build', 'test-reports', 'xunit.xml');
		const outside = path.join(path.dirname(PROJECT), 'другой', 'xunit.xml');

		await runWithProject(PROJECT, async () => {
			assert.strictEqual(await vrunner.runnerPath(report), report);
			await config().update('docker.enabled', true, vscode.ConfigurationTarget.Workspace);
			assert.strictEqual(await vrunner.runnerPath(report), '/workspace/build/test-reports/xunit.xml');
			assert.strictEqual(await vrunner.runnerPath(outside), outside);
		});
	});
});

suite('Docker: версия vrunner', () => {
	const config = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration('1c-platform-tools');
	const vrunner = VRunnerManager.getInstance();
	let root: string;

	setup(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'vrunner-docker-'));
	});

	teardown(async () => {
		await config().update('docker.enabled', undefined, vscode.ConfigurationTarget.Workspace);
		fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
	});

	test('в Docker версия не берётся из установки в проекте', async () => {
		writeLocalRunner(root, '3.0.0');
		const packageDir = path.join(root, 'oscript_modules', 'vanessa-runner');
		fs.mkdirSync(packageDir, { recursive: true });
		fs.writeFileSync(path.join(packageDir, 'opm-metadata.xml'), '<opm-metadata><version>3.0.0</version></opm-metadata>', 'utf8');

		await vrunner.runWithProjectRoot(root, async () => {
			assert.strictEqual((await vrunner.getVRunnerVersion())?.raw, '3.0.0');

			await config().update('docker.enabled', true, vscode.ConfigurationTarget.Workspace);
			assert.strictEqual(await vrunner.getVRunnerVersion(), undefined);
			assert.strictEqual(vrunner.getActiveSettingsSchema(), 'v2');

			await config().update('docker.enabled', undefined, vscode.ConfigurationTarget.Workspace);
			assert.strictEqual(vrunner.getCachedVRunnerVersionLabel(), '3.0.0');
		});
	});

	test('смена настроек Docker оповещает подписчиков версии', async () => {
		const watch = vrunner.watchVRunnerInstallation();
		let subscription: vscode.Disposable | undefined;
		const changed = new Promise<void>((resolve) => {
			subscription = vrunner.onDidChangeVRunnerVersion(() => resolve());
		});
		try {
			await config().update('docker.enabled', true, vscode.ConfigurationTarget.Workspace);
			await changed;
		} finally {
			subscription?.dispose();
			watch.dispose();
		}
	});
});
