import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { resolveOnescriptTestsPath } from '../../features/testing/onescriptTestsPath';
import { DEFAULT_PATHS } from '../../shared/pathDefaults';

suite('onescriptTestsPath', () => {
	teardown(async () => {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		await config.update('testing.onescriptTestsPath', undefined, vscode.ConfigurationTarget.Workspace);
		await config.update('paths.tests', undefined, vscode.ConfigurationTarget.Workspace);
	});

	test('без устаревшей настройки каталог берётся из paths.tests', async () => {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		await config.update('paths.tests', 'проверка/тесты', vscode.ConfigurationTarget.Workspace);

		assert.strictEqual(resolveOnescriptTestsPath(), 'проверка/тесты');
	});

	test('заданная устаревшая настройка выигрывает: проект с ней не должен сломаться', async () => {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		await config.update('paths.tests', 'проверка/тесты', vscode.ConfigurationTarget.Workspace);
		await config.update('testing.onescriptTestsPath', 'старый/каталог', vscode.ConfigurationTarget.Workspace);

		assert.strictEqual(resolveOnescriptTestsPath(), 'старый/каталог');
	});

	test('без настроек — дефолт paths.tests', () => {
		assert.strictEqual(resolveOnescriptTestsPath(), DEFAULT_PATHS.tests);
	});
});
