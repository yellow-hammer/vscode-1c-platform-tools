import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { revealOutputChannel } from '../../shared/logger';

const SHOW_CHANNEL = 'workbench.action.output.show.yellow-hammer.1c-platform-tools.';

/** Канал-заглушка: запоминает вызовы `show()`. */
function fakeChannel(name: string, shown: (boolean | undefined)[]): vscode.OutputChannel {
	return { name, show: (preserveFocus?: boolean) => shown.push(preserveFocus) } as unknown as vscode.OutputChannel;
}

/** Ждёт, пока окно зарегистрирует команды показа канала с заданным началом идентификатора. */
async function channelCommands(prefix: string): Promise<string[]> {
	const deadline = Date.now() + 10_000;
	for (;;) {
		const found = (await vscode.commands.getCommands(true)).filter(
			(id) => id === prefix || id.startsWith(`${prefix}.`)
		);
		if (found.length > 0 || Date.now() > deadline) {
			return found;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

suite('logger: показ журнала', () => {
	test('канал показывается командой окна для него', async () => {
		const shown: (boolean | undefined)[] = [];
		let executed = 0;
		// так команду называет Cursor: имя канала без двоеточия и суффикс рабочей области
		const command = vscode.commands.registerCommand(`${SHOW_CHANNEL}Проба показа.workspaceId-1`, () => executed++);
		try {
			await revealOutputChannel(fakeChannel('Проба: показа', shown));
		} finally {
			command.dispose();
		}

		assert.strictEqual(executed, 1);
		assert.deepStrictEqual(shown, []);
	});

	test('без команды окна канал показывается сам, без перехвата фокуса', async () => {
		const shown: (boolean | undefined)[] = [];

		await revealOutputChannel(fakeChannel('Проба без команды', shown));

		assert.deepStrictEqual(shown, [true]);
	});

	test('из нескольких подходящих команд ни одна не выбирается', async () => {
		const shown: (boolean | undefined)[] = [];
		let executed = 0;
		const commands = ['A', 'B'].map((suffix) =>
			vscode.commands.registerCommand(`${SHOW_CHANNEL}Проба двух окон.workspaceId-${suffix}`, () => executed++)
		);
		try {
			await revealOutputChannel(fakeChannel('Проба двух окон', shown));
		} finally {
			commands.forEach((command) => command.dispose());
		}

		assert.strictEqual(executed, 0);
		assert.deepStrictEqual(shown, [true]);
	});

	test('у журнала расширения есть команда окна', async function () {
		this.timeout(15_000);
		const channel = vscode.window.createOutputChannel('1cpt: проба журнала', { log: true });
		try {
			assert.strictEqual((await channelCommands(`${SHOW_CHANNEL}1cpt проба журнала`)).length, 1);
			await revealOutputChannel(channel);
		} finally {
			channel.dispose();
		}
	});
});
