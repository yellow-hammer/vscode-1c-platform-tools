import * as vscode from 'vscode';
import { DEFAULT_TESTING } from '../../shared/pathDefaults';
import { testsDirectoryName } from '../../shared/projectLayout';

/**
 * Каталог тестов OneScript относительно корня проекта.
 *
 * Скриптовые тесты маркеров не имеют, поэтому каталог задаётся настройкой
 * `test.path.onescriptTests`; пустая настройка значит каталог тестов.
 */
export function resolveOnescriptTestsPath(): string {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const configured = config.get<string>('test.path.onescriptTests', DEFAULT_TESTING.onescriptTestsPath).trim();
	return configured.length > 0 ? configured : testsDirectoryName();
}
