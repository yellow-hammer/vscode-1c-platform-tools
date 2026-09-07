import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { resolveOnescriptTestsPath } from '../../features/testing/onescriptTestsPath';
import { DEFAULT_TESTING } from '../../shared/pathDefaults';

suite('onescriptTestsPath', () => {
	teardown(async () => {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		await config.update('test.path.onescriptTests', undefined, vscode.ConfigurationTarget.Workspace);
	});

	test('каталог берётся из настройки: у скриптовых тестов маркеров нет', async () => {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		await config.update('test.path.onescriptTests', 'проверка/тесты', vscode.ConfigurationTarget.Workspace);

		assert.strictEqual(resolveOnescriptTestsPath(), 'проверка/тесты');
	});

	test('без настройки привычный каталог tests', () => {
		assert.strictEqual(resolveOnescriptTestsPath(), DEFAULT_TESTING.onescriptTestsPath);
	});
});
