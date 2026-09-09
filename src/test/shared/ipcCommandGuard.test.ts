import * as assert from 'node:assert';
import { handleExecuteCommand } from '../../shared/ipcServer';

/** Ответ канала с отказом. */
function errorOf(response: { error?: { code?: string } }): string | undefined {
	return response.error?.code;
}

suite('канал исполняет только опубликованные агенту команды', () => {
	test('чужая команда редактора отклоняется', async () => {
		const response = await handleExecuteCommand(
			{ id: '1', method: 'executeCommand' },
			{ commandId: 'workbench.action.terminal.sendSequence', args: ['rm -rf /'] }
		);

		assert.strictEqual(errorOf(response), 'COMMAND_NOT_EXPOSED');
	});

	test('своя, но скрытая от агента команда отклоняется', async () => {
		const response = await handleExecuteCommand(
			{ id: '2', method: 'executeCommand' },
			{ commandId: '1c-platform-tools.clusters.terminateSession' }
		);

		assert.strictEqual(errorOf(response), 'COMMAND_NOT_EXPOSED');
	});

	test('пустой идентификатор отклоняется раньше проверки публикации', async () => {
		const response = await handleExecuteCommand(
			{ id: '3', method: 'executeCommand' },
			{ commandId: '  ' }
		);

		assert.strictEqual(errorOf(response), 'INVALID_COMMAND_ID');
	});
});
