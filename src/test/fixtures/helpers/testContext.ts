import * as vscode from 'vscode';
import { createMockExtensionContext, createMockWorkspaceFolder } from '../mocks/vscodeMocks';
import { createTestWorkspace, cleanupTestWorkspace, TestWorkspaceOptions } from './testWorkspace';

export interface TestContext {
	extensionContext: vscode.ExtensionContext;
	workspacePath: string;
	cleanup: () => Promise<void>;
}

/**
 * Создает полный тестовый контекст с workspace
 */
export async function createTestContext(
	workspaceOptions?: TestWorkspaceOptions
): Promise<TestContext> {
	const workspacePath = await createTestWorkspace(workspaceOptions);
	const extensionContext = createMockExtensionContext(workspacePath);

	// Мокаем workspaceFolders через Object.defineProperty, так как это read-only свойство
	const mockWorkspaceFolder = createMockWorkspaceFolder(workspacePath);
	Object.defineProperty(vscode.workspace, 'workspaceFolders', {
		get: () => [mockWorkspaceFolder],
		configurable: true,
		enumerable: true
	});

	return {
		extensionContext,
		workspacePath,
		cleanup: async () => {
			await cleanupTestWorkspace(workspacePath);
		}
	};
}

