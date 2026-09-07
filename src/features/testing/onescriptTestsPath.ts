import * as vscode from 'vscode';
import { DEFAULT_TESTING } from '../../shared/pathDefaults';

/**
 * Каталог тестов OneScript относительно корня проекта.
 *
 * Скриптовые тесты маркеров не имеют, поэтому каталог задаётся настройкой
 * `test.path.onescriptTests`.
 */
export function resolveOnescriptTestsPath(): string {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	return config.get<string>('test.path.onescriptTests', DEFAULT_TESTING.onescriptTestsPath);
}
