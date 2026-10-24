import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { runCancellableCommand } from '../../shared/cancellableProcess';
import { runHookPhaseDry } from '../../shared/commandHooks';
import { handleExecuteCommand, openIpcChannel } from '../../shared/ipcServer';
import { runCommandFromFile } from '../../shared/runCommandFromFileWatcher';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { testingVRunner } from '../fixtures/helpers/testingVRunner';
import { setWorkspaceTrustProbe, withWorkspaceTrust, WORKSPACE_TRUST_REQUIRED } from '../../shared/workspaceTrust';
import { RacClient } from '../../features/clusters/racClient';
import { launchInfobase, launchStartWindow } from '../../features/ibases/cestart';
import { launchEdtStart } from '../../features/ibases/edtStart';
import { runEdtCommand } from '../../features/edt/edtRunner';
import { startServerDebug } from '../../features/launch/platformServerFeature';
import { PlatformServerManager } from '../../features/launch/platformServerManager';
import type { ServerDebugSessions } from '../../features/launch/serverDebugSessions';
import { projectConfiguration } from '../../shared/projectConfiguration';
import { runWithProject } from '../../shared/workspaceProjects';
import { TestingController } from '../../features/testing/testController';
import type { AdapterRunPlan, FileTreeLocation, TestFrameworkAdapter } from '../../features/testing/frameworkAdapter';
import { createMockExtensionContext } from '../fixtures/mocks/vscodeMocks';
import type { ProjectScanRoot } from '../../shared/workspaceProjects';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');
const FIXTURES = path.join(EXTENSION_ROOT, 'src', 'test', 'fixtures');
const HOOKS_FIXTURE = path.join(FIXTURES, 'workspaceTrust', 'hooks-project');
const TESTS_PROJECT = path.join(FIXTURES, 'workspaceScan', 'проект');

/** Сколько раз спросили про доверие: гейт на пути команды виден по счётчику. */
let trustQuestions = 0;

/** Окно vscode-test доверенное, поэтому отказ проверяется подменой признака. */
function distrustWorkspace(): void {
	trustQuestions = 0;
	setWorkspaceTrustProbe(() => {
		trustQuestions += 1;
		return false;
	});
}

/** Команда, которая создала бы файл, если бы процесс запустился. */
function markerCommand(marker: string): string {
	return `node --eval "require('node:fs').writeFileSync(${JSON.stringify(marker).replaceAll('"', "'")}, '')"`;
}

function tempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Свободный порт: слушатель канала поднимается на нём и проверяется подключением. */
function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			const port = typeof address === 'object' && address !== null ? address.port : 0;
			probe.close(() => resolve(port));
		});
	});
}

/**
 * Проверяет, отвечает ли кто-нибудь на порту канала.
 *
 * @param port - Порт подключения
 * @returns true, если соединение установилось
 */
function channelAccepts(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = net.connect({ port, host: '127.0.0.1' });
		const done = (accepted: boolean): void => {
			socket.destroy();
			resolve(accepted);
		};
		socket.setTimeout(2000);
		socket.once('connect', () => done(true));
		socket.once('timeout', () => done(false));
		socket.once('error', () => done(false));
	});
}

/**
 * Ждёт, пока порт канала начнёт принимать соединения.
 *
 * Слушатель поднимается не мгновенно, поэтому подключение повторяется до срока:
 * отказ подтверждается только тем, что ни одна попытка не прошла.
 *
 * @param port - Порт подключения
 * @param timeoutMs - Сколько ждать
 * @returns true, если хотя бы одно подключение установилось
 */
async function channelAcceptsWithin(port: number, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await channelAccepts(port)) {
			return true;
		}
		if (Date.now() >= deadline) {
			return false;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

suite('недоверенная папка: процессы не запускаются', () => {
	teardown(() => setWorkspaceTrustProbe());

	test('команда оболочки не доходит до дочернего процесса', async () => {
		const dir = tempDir('trust-process-');
		try {
			const marker = path.join(dir, 'ran.txt');
			distrustWorkspace();
			const result = await runCancellableCommand(markerCommand(marker), { cwd: dir });

			assert.strictEqual(result.success, false);
			assert.strictEqual(result.stderr, WORKSPACE_TRUST_REQUIRED);
			assert.strictEqual(fs.existsSync(marker), false, 'процесс не должен был запуститься');
		} finally {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
		}
	});

	test('вывод задачи называет причину отказа', async () => {
		const chunks: string[] = [];
		distrustWorkspace();
		await runCancellableCommand('node --version', { onOutput: (chunk) => chunks.push(chunk) });

		assert.ok(chunks.join('').includes(WORKSPACE_TRUST_REQUIRED), chunks.join(''));
	});

	test('синхронный vrunner отвечает отказом, а не запуском', async () => {
		distrustWorkspace();
		const result = await VRunnerManager.getInstance().executeVRunner(['--version']);

		assert.strictEqual(result.success, false);
		assert.strictEqual(result.stderr, WORKSPACE_TRUST_REQUIRED);
	});
});

suite('недоверенная папка: панель тестирования', () => {
	/** Адаптер, который сообщает, звали ли его для построения прогона. */
	class RecordingAdapter implements TestFrameworkAdapter {
		public readonly id = 'onescript' as const;
		public readonly label = 'OneScript';
		public readonly usesReportDir = false;
		public runPlansRequested = 0;

		public async isEnabled(): Promise<boolean> {
			return true;
		}

		public getIncludeGlobs(): string[] {
			return ['tests/**/*.os'];
		}

		public parseFile(): undefined {
			return undefined;
		}

		public describeFileLocation(): FileTreeLocation {
			return { segments: [] };
		}

		public async buildRunPlan(): Promise<AdapterRunPlan> {
			this.runPlansRequested += 1;
			throw new Error('процесс в проверке не запускается');
		}
	}

	interface ControllerInternals {
		controller: vscode.TestController;
		runHandler(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void>;
	}

	const scanRootOf = async (root: string): Promise<ProjectScanRoot> => ({ root, excludeDirs: [] });

	teardown(() => setWorkspaceTrustProbe());

	test('прогон из дерева тестов не начинается', async function () {
		this.timeout(60_000);
		const adapter = new RecordingAdapter();
		const testing = new TestingController([adapter], testingVRunner(), { current: true }, {
			id: '1c-platform-tools-tests-trust',
			scanRootOf,
		});
		const internals = testing as unknown as ControllerInternals;
		const cancellation = new vscode.CancellationTokenSource();
		try {
			testing.setProject(TESTS_PROJECT);
			await testing.enqueueRebuild();
			const items: vscode.TestItem[] = [];
			internals.controller.items.forEach(function collect(item: vscode.TestItem) {
				items.push(item);
				item.children.forEach(collect);
			});
			const file = items.find((item) => item.uri?.fsPath.endsWith('.os'));
			assert.ok(file, 'дерево должно найти тестовый файл');

			distrustWorkspace();
			await internals.runHandler(new vscode.TestRunRequest([file]), cancellation.token);

			assert.strictEqual(adapter.runPlansRequested, 0, 'прогон не должен строить план');
			assert.ok(trustQuestions > 0, 'прогон должен спросить про доверие');
		} finally {
			cancellation.dispose();
			testing.dispose();
		}
	});
});

suite('недоверенная папка: автономный сервер', () => {
	teardown(() => setWorkspaceTrustProbe());

	test('сервер не поднимается и остаётся остановленным', async () => {
		const dir = tempDir('trust-server-');
		const manager = new PlatformServerManager(VRunnerManager.getInstance(), createMockExtensionContext(dir));
		try {
			distrustWorkspace();
			await manager.start(dir);

			assert.strictEqual(manager.state, 'stopped');
			assert.strictEqual(manager.ownerRoot, undefined);
			assert.ok(trustQuestions > 0, 'запуск должен спросить про доверие');
		} finally {
			await manager.stop();
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
		}
	});
});

suite('недоверенная папка: отладка через автономный сервер', () => {
	teardown(() => setWorkspaceTrustProbe());

	test('вопрос про порт отладки не задаётся и настройка проекта не меняется', async () => {
		const folder = vscode.workspace.workspaceFolders?.find((item) => item.uri.scheme === 'file');
		assert.ok(folder, 'для проверки нужна папка рабочей области');
		const root = folder.uri.fsPath;
		const before = projectConfiguration(root).inspect<boolean>('server.debug')?.workspaceValue;
		distrustWorkspace();
		// Стоял бы гейт ниже вопроса, проверка повисла бы на неотвеченном окне
		await runWithProject(root, () => startServerDebug({} as unknown as PlatformServerManager, {} as unknown as ServerDebugSessions));

		assert.ok(trustQuestions > 0, 'отладка должна спросить про доверие');
		assert.strictEqual(
			projectConfiguration(root).inspect<boolean>('server.debug')?.workspaceValue,
			before,
			'настройка проекта не должна меняться ради запуска, которого не будет'
		);
	});
});

suite('недоверенная папка: список информационных баз', () => {
	teardown(() => setWorkspaceTrustProbe());

	test('клиент платформы не запускается ни из дерева, ни из палитры', () => {
		const spawned: string[] = [];
		distrustWorkspace();
		const result = launchInfobase('Демо', 'ENTERPRISE', {
			find: () => ({ binary: '/opt/1cv8/common/1cestart', bases: [] }),
			spawn: (command) => spawned.push(command),
		});

		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.ok === false ? result.message : '', WORKSPACE_TRUST_REQUIRED);
		assert.strictEqual(spawned.length, 0, 'стартер не должен был запуститься');
	});

	test('окно запуска платформы не открывается', () => {
		const spawned: string[] = [];
		distrustWorkspace();
		const result = launchStartWindow({
			find: () => ({ binary: '/opt/1cv8/common/1cestart', bases: [] }),
			spawn: (command) => spawned.push(command),
		});

		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.ok === false ? result.message : '', WORKSPACE_TRUST_REQUIRED);
		assert.strictEqual(spawned.length, 0, 'стартер не должен был запуститься');
	});

	test('окно 1C:EDT Start не открывается', () => {
		const exe = 'C:\\1C\\1CE\\components\\1c-edt-start-0.8.0\\1cedtstart.exe';
		const spawned: string[] = [];
		distrustWorkspace();
		const result = launchEdtStart(undefined, {
			platform: 'win32',
			registryQuery: () => `    (Default)    REG_SZ    "${exe}" "%1"`,
			readFile: () => undefined,
			exists: (file) => file === exe,
			spawn: (command) => spawned.push(command),
		});

		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.ok === false ? result.message : '', WORKSPACE_TRUST_REQUIRED);
		assert.strictEqual(spawned.length, 0, 'стартер не должен был запуститься');
	});
});

suite('недоверенная папка: консоль кластера', () => {
	teardown(() => setWorkspaceTrustProbe());

	test('rac не запускается, дерево получает причину отказа', async () => {
		distrustWorkspace();
		const result = await new RacClient().run(['cluster', 'list']);

		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.ok === false ? result.failure.message : '', WORKSPACE_TRUST_REQUIRED);
		assert.ok(trustQuestions > 0, 'вызов должен спросить про доверие');
	});
});

suite('недоверенная папка: версия vrunner', () => {
	teardown(() => setWorkspaceTrustProbe());

	test('неопределённая версия не кэшируется до конца сеанса', async function () {
		this.timeout(30_000);
		const dir = tempDir('trust-vrunner-version-');
		const vrunner = VRunnerManager.getInstance();
		try {
			distrustWorkspace();
			const first = await vrunner.runWithProjectRoot(dir, () => vrunner.getVRunnerVersion());
			const askedAfterFirst = trustQuestions;
			const second = await vrunner.runWithProjectRoot(dir, () => vrunner.getVRunnerVersion());

			assert.strictEqual(first, undefined);
			assert.strictEqual(second, undefined);
			assert.ok(
				trustQuestions > askedAfterFirst,
				'после выдачи доверия версия должна определяться заново, а не браться из пустого кэша'
			);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
		}
	});
});

suite('недоверенная папка: команды 1С:EDT', () => {
	teardown(() => setWorkspaceTrustProbe());

	test('1cedtcli не запускается', async () => {
		const dir = tempDir('trust-edt-');
		try {
			distrustWorkspace();
			const result = await runEdtCommand({
				command: 'project-info',
				args: ['проект'],
				title: 'EDT: проверка доверия',
				workspaceDir: path.join(dir, 'edt-workspace'),
				cwd: dir,
			});

			assert.strictEqual(result.exitCode, 1);
			assert.strictEqual(result.error, WORKSPACE_TRUST_REQUIRED);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
		}
	});
});

suite('недоверенная папка: хуки команд', () => {
	teardown(() => setWorkspaceTrustProbe());

	test('проверка хука из редактора отвечает отказом', async () => {
		const dir = tempDir('trust-hooks-');
		try {
			fs.cpSync(HOOKS_FIXTURE, dir, { recursive: true });
			distrustWorkspace();
			const result = await runHookPhaseDry(dir, '1c-platform-tools.cf.load', 'pre');

			assert.strictEqual(result.success, false);
			assert.ok(result.output.includes(WORKSPACE_TRUST_REQUIRED), result.output);
			assert.strictEqual(fs.existsSync(path.join(dir, 'hook-ran.txt')), false, 'шаг не должен был выполниться');
		} finally {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
		}
	});
});

suite('недоверенная папка: канал и файл-триггер', () => {
	teardown(() => setWorkspaceTrustProbe());

	test('команда агента по каналу отклоняется с понятной причиной', async () => {
		distrustWorkspace();
		const response = await handleExecuteCommand(
			{ id: '1', method: 'executeCommand' },
			{ commandId: '1c-platform-tools.cf.load', args: [{ wait: true }] }
		);

		assert.strictEqual(response.error?.code, 'WORKSPACE_NOT_TRUSTED');
		assert.strictEqual(response.error?.message, WORKSPACE_TRUST_REQUIRED);
	});

	test('канал не слушает порт, пока папке не доверяют', async function () {
		this.timeout(30_000);
		const config = { enabled: true, host: '127.0.0.1', port: await freePort(), token: null };
		let channel: net.Server | null = null;
		try {
			distrustWorkspace();
			channel = openIpcChannel(config, 'yellow-hammer.1c-platform-tools');

			assert.strictEqual(channel, null, 'канал не должен открываться');
			assert.strictEqual(
				await channelAcceptsWithin(config.port, 1000),
				false,
				'порт канала не должен принимать соединения'
			);

			setWorkspaceTrustProbe(() => true);
			channel = openIpcChannel(config, 'yellow-hammer.1c-platform-tools');

			assert.ok(channel, 'после доверия канал должен открыться');
			assert.strictEqual(
				await channelAcceptsWithin(config.port, 10_000),
				true,
				'после доверия канал должен слушать порт'
			);
		} finally {
			channel?.close();
		}
	});

	test('файл-триггер не выполняет команду и остаётся на месте', async () => {
		const dir = tempDir('trust-trigger-');
		const file = path.join(dir, '1c-platform-tools-run-command');
		try {
			fs.writeFileSync(file, '1c-platform-tools.project.list\n');
			distrustWorkspace();
			await runCommandFromFile(vscode.Uri.file(file));

			assert.strictEqual(fs.existsSync(file), true, 'файл не должен считаться обработанным');
			assert.ok(trustQuestions > 0, 'триггер должен спросить про доверие');
		} finally {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
		}
	});
});

suite('недоверенная папка: команды мимо гейта vrunner', () => {
	teardown(() => setWorkspaceTrustProbe());

	/** Помощники регистрации, которые не пускают команду в недоверенной папке. */
	const GATED_HELPERS = [
		'registerVRunnerCommand',
		'registerRunningCommand',
		'registerArtifactCommand',
		'registerFromEditor',
	];

	/** Команды, которые запускают платформу мимо registerVRunnerCommand. */
	const GATED_COMMANDS = [
		'1c-platform-tools.artifacts.compileConfiguration',
		'1c-platform-tools.artifacts.decompileConfiguration',
		'1c-platform-tools.artifacts.compileExtension',
		'1c-platform-tools.artifacts.decompileExtension',
		'1c-platform-tools.artifacts.compileProcessor',
		'1c-platform-tools.artifacts.decompileProcessor',
		'1c-platform-tools.artifacts.compileReport',
		'1c-platform-tools.artifacts.decompileReport',
		'1c-platform-tools.artifacts.decompileConfigurationFromEditor',
		'1c-platform-tools.artifacts.decompileExtensionFromEditor',
		'1c-platform-tools.artifacts.decompileProcessorFromEditor',
		'1c-platform-tools.artifacts.decompileReportFromEditor',
		'1c-platform-tools.cf.setVersion',
		'1c-platform-tools.cfe.setVersion',
		'1c-platform-tools.epf.setVersionReport',
		'1c-platform-tools.epf.setVersionProcessor',
	];

	const registrySource = fs.readFileSync(path.join(EXTENSION_ROOT, 'src', 'commands', 'commandRegistry.ts'), 'utf8');

	test('обёртка команды не пускает обработчик в недоверенной папке', () => {
		let calls = 0;
		const guarded = withWorkspaceTrust('проверка', () => {
			calls += 1;
			return 'выполнено';
		});

		distrustWorkspace();
		assert.strictEqual(guarded(), undefined);
		assert.strictEqual(calls, 0);
		assert.ok(trustQuestions > 0, 'обёртка должна спросить про доверие');

		setWorkspaceTrustProbe(() => true);
		assert.strictEqual(guarded(), 'выполнено');
		assert.strictEqual(calls, 1);
	});

	test('помощники регистрации зовут обёртку доверия', () => {
		const ungated = GATED_HELPERS.filter((helper) => {
			const start = registrySource.search(new RegExp(`(function|const)\\s+${helper}\\b`));
			return start < 0 || !registrySource.slice(start, start + 500).includes('withWorkspaceTrust(');
		});
		assert.deepStrictEqual(ungated, []);
	});

	test('команды, запускающие платформу, регистрируются через эти помощники', () => {
		const ungated = GATED_COMMANDS.filter((id) => {
			const registration = new RegExp(`(\\w+)\\(\\s*'${id.replaceAll('.', '\\.')}'`).exec(registrySource);
			return registration === null || !GATED_HELPERS.includes(registration[1]);
		});
		assert.deepStrictEqual(ungated, []);
	});
});

suite('настройки, которые задают программу или открывают доступ', () => {
	/**
	 * Части имени, по которым настройка попадает под проверку: путь, имя
	 * программы, аргументы запуска, признак включения канала.
	 */
	const RUN_MARKERS = [
		'path',
		'executable',
		'runner',
		'vmargs',
		'image',
		'token',
		'port',
		'enabled',
		'usetasks',
		'autoload',
		'binary',
		'docker',
		'command',
	];

	/** Настройки под проверкой, которые программу не задают и доступа не открывают. */
	const NOT_RUNNING: Record<string, string> = {
		'notifications.onCommandFinish': 'уведомление о завершении команды',
		'vrunner.path.initSettings': 'файл настроек инициализации, не программа',
		'path.out': 'каталог сборки',
		'path.dist': 'каталог поставки',
		'projects.path.baseFolders': 'каталоги поиска проектов',
		'projects.path.storage': 'файл списка проектов',
		'projects.filterOnFullPath': 'поиск по списку проектов',
		'metadata.er.path.export': 'каталог выгрузки диаграммы',
		'metadata.er.defaultExportFormat': 'формат выгрузки диаграммы',
		'metadata.supportEnabled': 'показ замка поддержки в дереве',
		'components.autoload.adapter': 'загрузка компонента, а не его путь',
		'components.autoload.metadataJar': 'загрузка компонента, а не его путь',
		'components.autoload.java': 'загрузка компонента, а не его путь',
		'components.autoload.ovm': 'загрузка компонента, а не его путь',
		'components.autoload.allure': 'загрузка компонента, а не его путь',
		'test.panelEnabled': 'показ панели тестирования',
		'test.path.features': 'каталог сценариев',
		'test.path.onescriptTests': 'каталог тестов',
		'test.path.reports': 'каталог отчётов',
		'test.path.yaxunitConfig': 'файл настроек прогона',
		'test.onescriptRunner': 'выбор из известных раннеров, не путь',
		'server.port': 'порт публикации своего сервера',
		'server.directRegPort': 'порт публикации своего сервера',
		'server.path.data': 'каталог данных сервера',
		'server.debugPort': 'порт отладки своего сервера',
		'clusters.autoRefresh.enabled': 'период обновления дерева кластеров',
	};

	const SECTION = '1c-platform-tools.';

	interface Manifest {
		contributes: { configuration: unknown };
		capabilities: { untrustedWorkspaces: { restrictedConfigurations: string[] } };
	}

	const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as Manifest;

	function declaredKeys(): string[] {
		const blocks = Array.isArray(manifest.contributes.configuration)
			? (manifest.contributes.configuration as Array<{ properties?: Record<string, unknown> }>)
			: [manifest.contributes.configuration as { properties?: Record<string, unknown> }];
		return blocks.flatMap((block) => Object.keys(block.properties ?? {}));
	}

	const restricted = manifest.capabilities.untrustedWorkspaces.restrictedConfigurations;
	const suspicious = declaredKeys().filter((key) =>
		RUN_MARKERS.some((marker) => key.toLowerCase().includes(marker))
	);

	test('список restrictedConfigurations состоит из объявленных настроек', () => {
		const declared = new Set(declaredKeys());
		assert.deepStrictEqual(restricted.filter((key) => !declared.has(key)), []);
	});

	test('настройка, задающая программу или доступ, лежит в restrictedConfigurations', () => {
		const missing = suspicious.filter(
			(key) => !restricted.includes(key) && !(key.slice(SECTION.length) in NOT_RUNNING)
		);
		assert.deepStrictEqual(
			missing,
			[],
			`добавьте в capabilities.untrustedWorkspaces.restrictedConfigurations или в NOT_RUNNING:\n${missing.join('\n')}`
		);
	});

	test('в NOT_RUNNING нет лишнего', () => {
		const known = new Set(suspicious.map((key) => key.slice(SECTION.length)));
		const stale = Object.keys(NOT_RUNNING).filter(
			(key) => !known.has(key) || restricted.includes(`${SECTION}${key}`)
		);
		assert.deepStrictEqual(stale, []);
	});

	test('канал и выбор способа запуска берутся не из папки', () => {
		for (const key of ['ipc.enabled', 'ipc.port', 'ipc.token', 'execution.useTasks']) {
			assert.ok(restricted.includes(`${SECTION}${key}`), `${key} должна быть в restrictedConfigurations`);
		}
	});
});
