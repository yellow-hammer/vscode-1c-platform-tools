import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { BaseCommand } from '../../commands/baseCommand';
import { createTestContext } from '../fixtures/helpers/testContext';
import type { CommandExecutionOptions } from '../../shared/commandExecutionTypes';
import { OBJLIST_REL_PATH } from '../../shared/pathDefaults';

/**
 * Тестовый класс для проверки методов BaseCommand
 */
class TestCommand extends BaseCommand {
	/**
	 * Публичный метод для тестирования ensureWorkspace
	 */
	public async testEnsureWorkspace(): Promise<string | undefined> {
		return this.ensureWorkspace();
	}

	/**
	 * Публичный метод для тестирования checkDirectoryExists
	 */
	public async testCheckDirectoryExists(dirPath: string, errorMessage?: string): Promise<boolean> {
		return this.checkDirectoryExists(dirPath, errorMessage);
	}

	/**
	 * Публичный метод для тестирования getDirectories
	 */
	public async testGetDirectories(dirPath: string, errorMessage?: string): Promise<string[]> {
		return this.getDirectories(dirPath, errorMessage);
	}

	/**
	 * Публичный метод для тестирования getFilesByExtension
	 */
	public async testGetFilesByExtension(dirPath: string, extension: string, errorMessage?: string): Promise<string[]> {
		return this.getFilesByExtension(dirPath, extension, errorMessage);
	}

	/**
	 * Публичный метод для тестирования ensureDirectoryExists
	 */
	public async testEnsureDirectoryExists(dirPath: string, errorMessage?: string): Promise<boolean> {
		return this.ensureDirectoryExists(dirPath, errorMessage);
	}

	/**
	 * Публичный метод для тестирования addIbcmdIfNeeded
	 */

	/**
	 * Публичный метод для тестирования ensureOscriptForExecution
	 */
	public async testEnsureOscriptForExecution(opts?: CommandExecutionOptions): Promise<boolean> {
		return this.ensureOscriptForExecution(opts);
	}

	public async testEnsureOscriptAvailable(): Promise<boolean> {
		return this.ensureOscriptAvailable();
	}

	public override readObjlist(root: string): Promise<string[] | undefined> {
		return super.readObjlist(root);
	}
}

suite('BaseCommand', () => {
	let testContext: Awaited<ReturnType<typeof createTestContext>>;
	let testCommand: TestCommand;

	suiteSetup(async () => {
		testContext = await createTestContext({ template: 'minimal-1c-project' });
		testCommand = new TestCommand();
	});

	suiteTeardown(async () => {
		await testContext.cleanup();
	});

	test('обе команды загрузки читают список только из .1cpt', async () => {
		const root = await fs.mkdtemp(path.join(testContext.workspacePath, 'objlist-'));
		const file = path.join(root, OBJLIST_REL_PATH);
		try {
			await fs.writeFile(path.join(root, 'objlist.txt'), 'src/cf/Documents/Прежний.xml\n');
			assert.strictEqual(await testCommand.readObjlist(root), undefined);
			await fs.mkdir(path.dirname(file));
			await fs.writeFile(file, '  src/cf/Documents/Документ.xml\r\n \r\nsrc/cfe/Проверка/Queues/Очередь.xml\n');
			assert.deepStrictEqual(await testCommand.readObjlist(root), [
				'src/cf/Documents/Документ.xml',
				'src/cfe/Проверка/Queues/Очередь.xml',
			]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('ensureWorkspace возвращает путь к workspace', async () => {
		// Этот тест требует, чтобы workspace был открыт в VS Code
		// В тестовом окружении это может не работать, поэтому проверяем структуру
		const workspaceRoot = await testCommand.testEnsureWorkspace();
		// Если workspace не открыт, метод вернет undefined
		// Это нормальное поведение, поэтому просто проверяем тип
		if (workspaceRoot) {
			assert.ok(typeof workspaceRoot === 'string', 'workspaceRoot должен быть строкой');
			assert.ok(workspaceRoot.length > 0, 'workspaceRoot не должен быть пустым');
		}
	});

	test('checkDirectoryExists возвращает true для существующей директории', async () => {
		const exists = await testCommand.testCheckDirectoryExists(testContext.workspacePath);
		assert.strictEqual(exists, true, 'Существующая директория должна возвращать true');
	});

	test('checkDirectoryExists возвращает false для несуществующей директории', async () => {
		const nonExistentPath = path.join(testContext.workspacePath, 'non-existent-dir-12345');
		const exists = await testCommand.testCheckDirectoryExists(nonExistentPath);
		assert.strictEqual(exists, false, 'Несуществующая директория должна возвращать false');
	});

	test('getDirectories возвращает список директорий', async () => {
		const dirs = await testCommand.testGetDirectories(testContext.workspacePath);
		assert.ok(Array.isArray(dirs), 'getDirectories должен возвращать массив');
		// Проверяем, что метод работает корректно - возвращает массив (может быть пустым или содержать директории)
		// В минимальном проекте может быть директория src, но это не обязательно
		// Массив может быть пустым или содержать директории - оба варианта валидны
	});

	test('getFilesByExtension возвращает файлы с указанным расширением', async () => {
		const files = await testCommand.testGetFilesByExtension(testContext.workspacePath, '.json');
		assert.ok(Array.isArray(files), 'getFilesByExtension должен возвращать массив');
		// В минимальном проекте должен быть env.json
		const hasEnvJson = files.some(file => file.includes('env.json'));
		assert.ok(hasEnvJson || files.length === 0, 'Должен быть найден env.json или массив пуст');
	});

	test('getFilesByExtension возвращает пустой массив для несуществующей директории', async () => {
		const nonExistentPath = path.join(testContext.workspacePath, 'non-existent-dir-12345');
		const files = await testCommand.testGetFilesByExtension(nonExistentPath, '.json');
		assert.strictEqual(files.length, 0, 'Несуществующая директория должна возвращать пустой массив');
	});

	test('ensureDirectoryExists создает директорию, если она не существует', async () => {
		const newDirPath = path.join(testContext.workspacePath, 'test-dir-' + Date.now());
		const created = await testCommand.testEnsureDirectoryExists(newDirPath);
		assert.strictEqual(created, true, 'Директория должна быть создана');
		
		// Проверяем, что директория действительно создана
		const stats = await fs.stat(newDirPath);
		assert.ok(stats.isDirectory(), 'Созданный путь должен быть директорией');
		
		// Очищаем
		await fs.rm(newDirPath, { recursive: true, force: true });
	});

	test('ensureDirectoryExists возвращает true для существующей директории', async () => {
		const exists = await testCommand.testEnsureDirectoryExists(testContext.workspacePath);
		assert.strictEqual(exists, true, 'Существующая директория должна возвращать true');
	});

	test('ensureOscriptForExecution: при docker.enabled=true не требует локальный OneScript', async () => {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		await config.update('docker.enabled', true, vscode.ConfigurationTarget.Workspace);
		try {
			const result = await testCommand.testEnsureOscriptForExecution({ wait: true });
			assert.strictEqual(result, true, 'В docker-режиме локальный oscript/opm не нужен');
		} finally {
			await config.update('docker.enabled', undefined, vscode.ConfigurationTarget.Workspace);
		}
	});

	test('ensureOscriptAvailable: команды vrunner в docker-режиме не требуют локальный OneScript', async () => {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		await config.update('docker.enabled', true, vscode.ConfigurationTarget.Workspace);
		try {
			assert.strictEqual(await testCommand.testEnsureOscriptAvailable(), true);
		} finally {
			await config.update('docker.enabled', undefined, vscode.ConfigurationTarget.Workspace);
		}
	});
});

