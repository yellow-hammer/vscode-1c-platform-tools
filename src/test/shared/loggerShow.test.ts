import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { logger, revealOutputChannel } from '../../shared/logger';

suite('logger: показ журнала', () => {
	test('панель Output раскрывается штатной командой', async () => {
		const commands = await vscode.commands.getCommands(true);

		// команда раскрытия панели - часть контракта показа журнала: без неё кнопка «Показать
		// журнал» в части сборок ничего не делает
		assert.ok(commands.includes('workbench.panel.output.focus'), 'нет команды раскрытия панели Output');
		assert.doesNotThrow(() => logger.show());
	});

	test('канал выбирается до раскрытия панели, без перехвата фокуса', () => {
		const shown: (boolean | undefined)[] = [];
		const channel = { show: (preserveFocus?: boolean) => shown.push(preserveFocus) } as unknown as vscode.OutputChannel;

		revealOutputChannel(channel);

		// панель открывается на канале, активном в момент раскрытия: выбор не ждёт раскрытия
		assert.deepStrictEqual(shown, [true]);
	});
});
