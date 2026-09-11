import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { resolveOnescriptTestsPath } from '../../features/testing/onescriptTestsPath';
import { testsDirectoryName } from '../../shared/projectLayout';

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

	test('без настройки скриптовые тесты лежат в каталоге тестов', () => {
		assert.strictEqual(resolveOnescriptTestsPath(), testsDirectoryName());
		assert.strictEqual(resolveOnescriptTestsPath(), 'tests');
	});
});
