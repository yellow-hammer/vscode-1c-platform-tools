import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createVRunnerTask, createVRunnerTaskTerminal, VRUNNER_TASK_SOURCE } from '../../features/tasks/vrunnerTask';
import {
	rememberTaskProject,
	rememberTerminalProject,
	reusableTerminal,
	taskTerminalName,
	terminalProjectRoot,
} from '../../features/tasks/terminalProjects';

function fakeTerminal(name: string, cwd?: string, env?: Record<string, string>): vscode.Terminal {
	return { name, creationOptions: cwd === undefined ? {} : { cwd, env } } as unknown as vscode.Terminal;
}

/** Запускает задачу и ждёт её завершения. */
async function runTask(task: vscode.Task): Promise<void> {
	const ended = new Promise<void>((resolve) => {
		const listener = vscode.tasks.onDidEndTask((event) => {
			if (event.execution.task.name === task.name) {
				listener.dispose();
				resolve();
			}
		});
	});
	await vscode.tasks.executeTask(task);
	await ended;
}

/** Закрывает открытые терминалы и ждёт, пока VS Code их уберёт. */
async function closeTerminals(): Promise<void> {
	for (const terminal of vscode.window.terminals) {
		terminal.dispose();
	}
	const deadline = Date.now() + 10_000;
	while (vscode.window.terminals.length > 0) {
		assert.ok(Date.now() < deadline, 'терминалы не закрылись');
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

suite('проект команды в терминале', () => {
	test('терминал режима без задач переиспользуется только с тем же каталогом', () => {
		const first = path.resolve('/w/первый');
		const second = path.resolve('/w/второй');
		const terminals = [fakeTerminal('Сборка', first), fakeTerminal('Сборка', second), fakeTerminal('Другая', first), fakeTerminal('Сборка')];

		assert.strictEqual(reusableTerminal(terminals, 'Сборка', second), terminals[1]);
		assert.strictEqual(reusableTerminal(terminals, 'Сборка', process.platform === 'win32' ? first.toUpperCase() : first), terminals[0]);
		assert.strictEqual(reusableTerminal(terminals, 'Сборка', path.resolve('/w/третий')), undefined);
	});

	test('терминал режима без задач переиспользуется только с теми же переменными окружения', () => {
		const root = path.resolve('/w/проект');
		const terminal = fakeTerminal('Сборка', root, { DB_HOST: 'localhost' });

		assert.strictEqual(reusableTerminal([terminal], 'Сборка', root, { DB_HOST: 'localhost' }), terminal);
		assert.strictEqual(reusableTerminal([terminal], 'Сборка', root, { DB_HOST: 'db' }), undefined);
		assert.strictEqual(reusableTerminal([terminal], 'Сборка', root, {}), undefined, 'окружение сброшено');
		assert.strictEqual(
			reusableTerminal([terminal], 'Сборка', root, { DB_HOST: 'localhost', DB_PORT: '5432' }),
			undefined,
			'в окружении новая переменная'
		);
	});

	test('терминал, созданный командой, помнит свой проект', () => {
		const root = path.resolve('/w/терминал');
		const terminal = fakeTerminal('Команда терминала', root);

		assert.strictEqual(terminalProjectRoot(terminal), undefined);
		rememberTerminalProject(terminal, root);
		assert.strictEqual(terminalProjectRoot(terminal), root);
		assert.strictEqual(terminalProjectRoot(fakeTerminal('Команда терминала', root)), undefined);
	});

	test('терминал задачи отдаёт проект последней задачи с его именем', () => {
		const first = path.resolve('/w/задача-первая');
		const second = path.resolve('/w/задача-вторая');
		const task = { name: 'Проверка', source: VRUNNER_TASK_SOURCE };

		rememberTaskProject(task, first);
		assert.strictEqual(terminalProjectRoot(fakeTerminal('Проверка')), first);
		rememberTaskProject(task, second);
		assert.strictEqual(terminalProjectRoot(fakeTerminal('Проверка')), second);
	});

	test('терминал задачи из tasks.json с label находит проект по имени без источника', function () {
		const folder = vscode.workspace.workspaceFolders?.find((item) => item.uri.scheme === 'file');
		if (folder === undefined) {
			this.skip();
			return;
		}
		const root = folder.uri.fsPath;

		rememberTaskProject({ name: 'Метка задачи', source: VRUNNER_TASK_SOURCE }, root);

		assert.strictEqual(terminalProjectRoot(fakeTerminal('Метка задачи')), root);
		assert.strictEqual(terminalProjectRoot(fakeTerminal(`Метка задачи (${folder.name})`)), root);
	});

	test('имя терминала задачи такое же, как у VS Code', () => {
		const task = { name: 'Синтаксический контроль', source: '1C: Platform Tools' };

		assert.strictEqual(taskTerminalName(task, 'erp', false), 'Синтаксический контроль');
		assert.strictEqual(taskTerminalName(task, undefined, false), 'Синтаксический контроль');
		assert.strictEqual(taskTerminalName(task, 'erp', true), '1C: Platform Tools: Синтаксический контроль (erp)');
		assert.strictEqual(taskTerminalName(task, undefined, true), '1C: Platform Tools: Синтаксический контроль');
	});

	test('терминал запущенной задачи отдаёт её проект, и после переиспользования другой задачей тоже', async function () {
		this.timeout(60_000);
		const folder = vscode.workspace.workspaceFolders?.find((item) => item.uri.scheme === 'file');
		if (folder === undefined) {
			this.skip();
			return;
		}
		await closeTerminals();
		const first = path.join(folder.uri.fsPath, 'src');
		const second = path.join(folder.uri.fsPath, 'docs');
		const opened: vscode.Terminal[] = [];
		const listener = vscode.window.onDidOpenTerminal((terminal) => opened.push(terminal));

		try {
			await runTask(createVRunnerTask({ name: 'Проверка проекта задачи', command: 'echo ok', cwd: os.tmpdir(), root: first }));
			assert.strictEqual(opened.length, 1);
			const [terminal] = opened;
			assert.strictEqual(terminalProjectRoot(terminal), first);

			await runTask(createVRunnerTask({ name: 'Сборка проекта задачи', command: 'echo ok', cwd: os.tmpdir(), root: second }));
			assert.strictEqual(opened.length, 1, 'терминал первой задачи не переиспользован');
			assert.strictEqual(terminalProjectRoot(terminal), second);
		} finally {
			listener.dispose();
			await closeTerminals();
		}
	});

	test('псевдотерминал задачи при запуске запоминает проект задачи', async () => {
		const root = path.resolve('/w/псевдотерминал');
		const terminal = createVRunnerTaskTerminal({ name: 'Запуск в проекте', command: 'echo ok', cwd: os.tmpdir(), root });

		await new Promise<void>((resolve) => {
			terminal.onDidClose?.(() => resolve());
			terminal.open(undefined);
		});

		assert.strictEqual(terminalProjectRoot(fakeTerminal('Запуск в проекте')), root);
	});
});
