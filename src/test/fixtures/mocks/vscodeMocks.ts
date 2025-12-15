import * as vscode from 'vscode';
import * as path from 'node:path';

/**
 * Создает мок ExtensionContext
 */
export function createMockExtensionContext(
	workspacePath?: string,
	extensionPath?: string
): vscode.ExtensionContext {
	const workspaceRoot = workspacePath || path.join(__dirname, '../workspace-templates/minimal-1c-project');
	const extPath = extensionPath || path.join(__dirname, '../../..');

	const mockMemento: vscode.Memento = {
		get: () => undefined,
		update: () => Promise.resolve(),
		keys: () => []
	};

	const mockGlobalMemento = {
		...mockMemento,
		setKeysForSync: () => {}
	} as vscode.Memento & { setKeysForSync(keys: readonly string[]): void };

	const mockEnvCollection = {
		persistent: true,
		description: 'Test environment variables',
		replace: () => {},
		append: () => {},
		prepend: () => {},
		get: () => undefined,
		has: () => false,
		delete: () => {},
		clear: () => {},
		forEach: () => {},
		getScoped: () => ({} as vscode.EnvironmentVariableCollection),
		[Symbol.iterator]: function* () {}
	} as unknown as vscode.GlobalEnvironmentVariableCollection;

	return {
		subscriptions: [],
		workspaceState: mockMemento,
		globalState: mockGlobalMemento,
		secrets: {
			get: () => Promise.resolve(undefined),
			store: () => Promise.resolve(),
			delete: () => Promise.resolve(),
			keys: () => Promise.resolve([]),
			onDidChange: (() => {
				return { dispose: () => {} };
			}) as unknown as vscode.Event<void>
		} as unknown as vscode.SecretStorage,
		extensionPath: extPath,
		extensionUri: vscode.Uri.file(extPath),
		asAbsolutePath: (relativePath: string) => vscode.Uri.file(path.join(extPath, relativePath)).fsPath,
		storagePath: path.join(workspaceRoot, '.vscode'),
		globalStoragePath: path.join(extPath, 'globalStorage'),
		globalStorageUri: vscode.Uri.file(path.join(extPath, 'globalStorage')),
		logPath: path.join(extPath, 'logs'),
		logUri: vscode.Uri.file(path.join(extPath, 'logs')),
		extensionMode: vscode.ExtensionMode.Test,
		environmentVariableCollection: mockEnvCollection,
		storageUri: vscode.Uri.file(path.join(workspaceRoot, '.vscode')),
		extension: undefined,
		languageModelAccessInformation: undefined
	} as unknown as vscode.ExtensionContext;
}

/**
 * Создает мок WorkspaceFolder
 */
export function createMockWorkspaceFolder(fsPath: string): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(fsPath),
		name: path.basename(fsPath),
		index: 0
	};
}

/**
 * Мок для vscode.window.showInputBox
 */
export class InputBoxMock {
	private responses: (string | undefined)[] = [];
	private currentIndex = 0;

	setResponses(responses: (string | undefined)[]): void {
		this.responses = responses;
		this.currentIndex = 0;
	}

	async showInputBox(options?: vscode.InputBoxOptions): Promise<string | undefined> {
		const response = this.responses[this.currentIndex];
		this.currentIndex++;

		if (options?.validateInput && response !== undefined) {
			const validation = await options.validateInput(response);
			if (validation) {
				// validation может быть строкой или InputBoxValidationMessage
				const message = typeof validation === 'string' ? validation : validation.message;
				throw new Error(message);
			}
		}

		return response;
	}
}

/**
 * Мок для vscode.window.showInformationMessage и подобных
 */
export class MessageMock {
	private messages: string[] = [];

	getMessages(): string[] {
		return [...this.messages];
	}

	clear(): void {
		this.messages = [];
	}

	async showInformationMessage(message: string): Promise<string | undefined> {
		this.messages.push(`INFO: ${message}`);
		return undefined;
	}

	async showWarningMessage(message: string): Promise<string | undefined> {
		this.messages.push(`WARN: ${message}`);
		return undefined;
	}

	async showErrorMessage(message: string): Promise<string | undefined> {
		this.messages.push(`ERROR: ${message}`);
		return undefined;
	}
}

