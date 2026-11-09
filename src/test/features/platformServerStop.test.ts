import * as assert from 'node:assert';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	PlatformServerManager,
	STOP_DATA_DIR_HOLDER_ACTION,
	dataDirHolderQuestion,
} from '../../features/launch/platformServerManager';
import { processAlive } from '../../shared/cacheDir';
import { DATA_LOCK_FILE, findDataDirHolder } from '../../shared/ibsrvDataLock';
import { waitProcessGone } from '../../shared/processTermination';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { createMockExtensionContext } from '../fixtures/mocks/vscodeMocks';

/** Переменная окружения, которой тест задаёт поведение поддельного ibsrv. */
const MODE_ENV = 'PLATFORM_TOOLS_FAKE_IBSRV_MODE';

/**
 * Поддельный ibsrv: публикует по HTTP порт из конфига и держит каталог данных
 * через lock.pid, как настоящий. В режиме macos по SIGTERM останавливает
 * сервер, но процесс выходит только по следующему сигналу.
 */
const FAKE_IBSRV = `
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const arg = (name) => process.argv.find((value) => value.startsWith('--' + name + '='))?.slice(name.length + 3);
const lockFile = path.join(arg('data'), '${DATA_LOCK_FILE}');
const port = Number(/port:\\s*(\\d+)/.exec(fs.readFileSync(arg('config'), 'utf8'))[1]);
let owner = 0;
try {
	owner = Number(fs.readFileSync(lockFile, 'utf8'));
	process.kill(owner, 0);
} catch {
	owner = 0;
}
if (owner && owner !== process.pid) {
	console.log('[FATAL] Ошибка блокировки каталога данных сервера. Рабочий каталог заблокирован процессом: ' + owner);
	process.exit(254);
}
fs.writeFileSync(lockFile, String(process.pid));
const server = http.createServer((request, response) => response.end('ok')).listen(port);
if (process.env.${MODE_ENV} === 'macos') {
	process.on('SIGTERM', () => {
		process.removeAllListeners('SIGTERM');
		server.close();
		console.log('Stand-alone Server stopped.');
	});
}
setInterval(() => {}, 1000);
`;

/** Свободный TCP-порт. */
function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once('error', reject);
		server.listen(0, () => {
			const { port } = server.address() as net.AddressInfo;
			server.close(() => resolve(port));
		});
	});
}

suite('остановка автономного сервера', () => {
	const config = () => vscode.workspace.getConfiguration('1c-platform-tools');
	let root: string;
	let dataDir: string;
	let binary: string;
	let manager: PlatformServerManager;
	let platformPathBefore: string | undefined;
	const orphans: ChildProcess[] = [];

	/** Pid процесса, который сейчас держит каталог данных. */
	const lockPid = () => Number(fs.readFileSync(path.join(dataDir, DATA_LOCK_FILE), 'utf8'));

	/** ibsrv, запущенный в обход менеджера: так остаётся сервер после перезагрузки окна. */
	async function startOrphan(): Promise<number> {
		const child = spawn(binary, [`--data=${dataDir}`, `--config=${path.join(dataDir, 'publication.yaml')}`], { stdio: 'ignore' });
		orphans.push(child);
		const deadline = Date.now() + 10_000;
		while (!fs.existsSync(path.join(dataDir, DATA_LOCK_FILE)) || lockPid() !== child.pid) {
			assert.ok(Date.now() < deadline, 'поддельный ibsrv не занял каталог данных');
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		return child.pid as number;
	}

	/** Подменяет вопрос о процессе, который держит каталог данных. */
	async function answering<T>(answer: string | undefined, questions: string[], run: () => Promise<T>): Promise<T> {
		const window = vscode.window as { showWarningMessage: (message: string) => Thenable<string | undefined> };
		const original = window.showWarningMessage;
		window.showWarningMessage = async (message: string) => {
			questions.push(message);
			return answer;
		};
		try {
			return await run();
		} finally {
			window.showWarningMessage = original;
		}
	}

	suiteSetup(async function () {
		if (process.platform === 'win32') {
			this.skip();
		}
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'ibsrv-stop-'));
		dataDir = path.join(root, 'build', 'out', 'ibsrv');
		fs.mkdirSync(dataDir, { recursive: true });
		fs.writeFileSync(
			path.join(dataDir, 'publication.yaml'),
			`server:\n  address: localhost\n  port: ${await freePort()}\ndatabase:\n  path: ${path.join(root, 'build', 'ib')}\n`
		);

		const script = path.join(root, 'fake', 'ibsrv');
		fs.mkdirSync(path.dirname(script));
		fs.writeFileSync(script, FAKE_IBSRV);
		binary = path.join(root, 'platform', '8.3.27.9999', 'ibsrv');
		fs.mkdirSync(path.dirname(binary), { recursive: true });
		fs.writeFileSync(binary, `#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });

		platformPathBefore = config().inspect<string>('platform.path')?.workspaceValue;
		await config().update('platform.path', path.join(root, 'platform'), vscode.ConfigurationTarget.Workspace);
		manager = new PlatformServerManager(VRunnerManager.getInstance(), createMockExtensionContext(root));
	});

	teardown(async () => {
		delete process.env[MODE_ENV];
		await manager?.stop();
		for (const orphan of orphans.splice(0)) {
			if (orphan.exitCode === null && orphan.signalCode === null) {
				orphan.kill('SIGKILL');
			}
		}
		// Поддельный ibsrv, который не остановился в упавшем тесте, не должен пережить прогон
		const holder = await findDataDirHolder(dataDir);
		if (holder !== undefined) {
			process.kill(holder, 'SIGKILL');
		}
	});

	suiteTeardown(async () => {
		if (root === undefined) {
			return;
		}
		try {
			manager?.dispose();
		} finally {
			await config().update('platform.path', platformPathBefore, vscode.ConfigurationTarget.Workspace);
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('после команды сервер запускается снова, хотя ibsrv не вышел по первому SIGTERM', async function () {
		this.timeout(60_000);
		process.env[MODE_ENV] = 'macos';
		await manager.start(root);
		assert.strictEqual(manager.state, 'running');
		const first = lockPid();

		const holder = manager.infobaseHolder();
		assert.ok(holder.heldInfobase());
		assert.strictEqual(await holder.release(), true);
		assert.strictEqual(processAlive(first), false, 'ibsrv после остановки остался жив');
		assert.strictEqual(manager.state, 'stopped');

		delete process.env[MODE_ENV];
		await holder.restore();
		assert.strictEqual(manager.state, 'running');
		assert.notStrictEqual(lockPid(), first);
	});

	test('ibsrv прежнего запуска, который держит каталог данных, завершается с согласия пользователя', async function () {
		this.timeout(60_000);
		const orphan = await startOrphan();
		const questions: string[] = [];

		await answering(STOP_DATA_DIR_HOLDER_ACTION, questions, () => manager.start(root));

		assert.deepStrictEqual(questions, [dataDirHolderQuestion(orphan)]);
		assert.strictEqual(processAlive(orphan), false);
		assert.strictEqual(manager.state, 'running');
		assert.notStrictEqual(lockPid(), orphan);
	});

	test('при закрытии окна ibsrv получает сигнал остановки', async function () {
		this.timeout(30_000);
		const closing = new PlatformServerManager(VRunnerManager.getInstance(), createMockExtensionContext(root));
		await closing.start(root);
		assert.strictEqual(closing.state, 'running');
		const pid = lockPid();
		// Журнал сервера открыт запуском: закрытый на глазах канал VS Code пишет в лог ошибку
		await vscode.commands.executeCommand('workbench.action.closePanel');

		closing.dispose();

		assert.strictEqual(await waitProcessGone(pid, 10_000), true, 'ibsrv пережил закрытие окна');
	});

	test('без согласия пользователя процесс, который держит каталог данных, не трогается', async function () {
		this.timeout(30_000);
		const orphan = await startOrphan();
		const questions: string[] = [];

		await answering(undefined, questions, () => manager.start(root));

		assert.deepStrictEqual(questions, [dataDirHolderQuestion(orphan)]);
		assert.strictEqual(processAlive(orphan), true);
		assert.strictEqual(manager.state, 'stopped');
	});
});
