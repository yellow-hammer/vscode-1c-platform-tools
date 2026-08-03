import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { logger } from '../../shared/logger';

suite('logger: показ журнала', () => {
	test('панель Output раскрывается штатной командой', async () => {
		const commands = await vscode.commands.getCommands(true);

		// команда раскрытия панели - часть контракта показа журнала: без неё кнопка «Показать
		// журнал» в части сборок ничего не делает
		assert.ok(commands.includes('workbench.panel.output.focus'), 'нет команды раскрытия панели Output');
		assert.doesNotThrow(() => logger.show());
	});
});
