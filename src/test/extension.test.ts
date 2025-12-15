import * as assert from 'node:assert';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createTestContext } from './fixtures/helpers/testContext';
import { readFixtureFile } from './fixtures/helpers/testWorkspace';
import { InputBoxMock, MessageMock } from './fixtures/mocks/vscodeMocks';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});
});

suite('Фикстуры - Базовые тесты', () => {
	let testContext: Awaited<ReturnType<typeof createTestContext>>;

	suiteSetup(async () => {
		// Создаем тестовый контекст с минимальным проектом
		testContext = await createTestContext({
			template: 'minimal-1c-project'
		});
	});

	suiteTeardown(async () => {
		// Очищаем временный workspace
		await testContext.cleanup();
	});

	test('workspace содержит базовые файлы проекта', async () => {
		// Проверяем наличие env.json
		const envPath = path.join(testContext.workspacePath, 'env.json');
		const envExists = await fs.access(envPath).then(() => true).catch(() => false);
		assert.strictEqual(envExists, true, 'env.json должен существовать');
		
		// Проверяем наличие packagedef
		const packagedefPath = path.join(testContext.workspacePath, 'packagedef');
		const packagedefExists = await fs.access(packagedefPath).then(() => true).catch(() => false);
		assert.strictEqual(packagedefExists, true, 'packagedef должен существовать');
		
		// Проверяем наличие .bsl-language-server.json
		const bslConfigPath = path.join(testContext.workspacePath, '.bsl-language-server.json');
		const bslExists = await fs.access(bslConfigPath).then(() => true).catch(() => false);
		assert.strictEqual(bslExists, true, '.bsl-language-server.json должен существовать');
	});

	test('workspace содержит env.json', async () => {
		const envPath = path.join(testContext.workspacePath, 'env.json');
		const content = await fs.readFile(envPath, 'utf8');
		const env = JSON.parse(content);
		
		assert.ok(env.default, 'env.json должен содержать секцию default');
		assert.strictEqual(env.default['--v8version'], '8.3.27.1688');
	});

	test('workspace содержит packagedef', async () => {
		const packagedefPath = path.join(testContext.workspacePath, 'packagedef');
		const content = await fs.readFile(packagedefPath, 'utf8');
		assert.strictEqual(content.trim(), 'TestPackage');
	});

	test('workspace содержит .bsl-language-server.json', async () => {
		const bslConfigPath = path.join(testContext.workspacePath, '.bsl-language-server.json');
		const content = await fs.readFile(bslConfigPath, 'utf8');
		const config = JSON.parse(content);
		
		assert.strictEqual(config.language, 'ru');
		assert.ok(config.codeLens);
	});
});

suite('Фикстуры - Полный проект', () => {
	let testContext: Awaited<ReturnType<typeof createTestContext>>;

	suiteSetup(async () => {
		testContext = await createTestContext({
			template: 'full-1c-project'
		});
	});

	suiteTeardown(async () => {
		await testContext.cleanup();
	});

	test('workspace содержит исходники конфигурации в src/cf', async () => {
		const configPath = path.join(testContext.workspacePath, 'src', 'cf', 'Configuration.xml');
		const exists = await fs.access(configPath).then(() => true).catch(() => false);
		assert.strictEqual(exists, true, 'Configuration.xml должен существовать в src/cf/');

		const content = await fs.readFile(configPath, 'utf8');
		assert.ok(content.includes('Configuration'), 'Configuration.xml должен содержать конфигурацию');
	});

	test('workspace содержит структуру проекта 1С', async () => {
		// Проверяем наличие основных директорий
		const catalogsPath = path.join(testContext.workspacePath, 'src', 'cf', 'Catalogs');
		const catalogsExists = await fs.access(catalogsPath).then(() => true).catch(() => false);
		assert.strictEqual(catalogsExists, true, 'Директория Catalogs должна существовать');

		const documentsPath = path.join(testContext.workspacePath, 'src', 'cf', 'Documents');
		const documentsExists = await fs.access(documentsPath).then(() => true).catch(() => false);
		assert.strictEqual(documentsExists, true, 'Директория Documents должна существовать');
	});

	test('env.json содержит секции для разных команд', async () => {
		const envPath = path.join(testContext.workspacePath, 'env.json');
		const content = await fs.readFile(envPath, 'utf8');
		const env = JSON.parse(content);

		assert.ok(env.default, 'Должна быть секция default');
		assert.ok(env.run, 'Должна быть секция run');
		assert.ok(env.designer, 'Должна быть секция designer');
	});
});

suite('Фикстуры - Модификация файлов', () => {
	test('workspace с модифицированным env.json', async () => {
		const context = await createTestContext({
			template: 'minimal-1c-project',
			modifyFiles: {
				'env.json': (content) => {
					const env = JSON.parse(content);
					env.default['--ibconnection'] = '/Fcustom/path';
					env.default['--v8version'] = '8.3.28.1234';
					return JSON.stringify(env, null, 2);
				}
			}
		});

		try {
			const envPath = path.join(context.workspacePath, 'env.json');
			const content = await fs.readFile(envPath, 'utf8');
			const env = JSON.parse(content);

			assert.strictEqual(env.default['--ibconnection'], '/Fcustom/path');
			assert.strictEqual(env.default['--v8version'], '8.3.28.1234');
		} finally {
			await context.cleanup();
		}
	});

	test('workspace с кастомными файлами', async () => {
		const context = await createTestContext({
			template: 'minimal-1c-project',
			customFiles: {
				'custom-config.json': JSON.stringify({ test: true, version: '1.0.0' }, null, 2),
				'src/cf/CustomModule.bsl': 'Процедура Кастомная()\n    Сообщить("Кастомный модуль");\nКонецПроцедуры'
			}
		});

		try {
			// Проверяем наличие кастомных файлов
			const customConfigPath = path.join(context.workspacePath, 'custom-config.json');
			const customConfig = await fs.readFile(customConfigPath, 'utf8');
			const config = JSON.parse(customConfig);
			assert.strictEqual(config.test, true);
			assert.strictEqual(config.version, '1.0.0');

			const customModulePath = path.join(context.workspacePath, 'src', 'cf', 'CustomModule.bsl');
			const moduleContent = await fs.readFile(customModulePath, 'utf8');
			assert.ok(moduleContent.includes('Кастомный модуль'));
		} finally {
			await context.cleanup();
		}
	});
});

suite('Фикстуры - Чтение эталонных файлов', () => {
	test('чтение эталонного env.json из шаблона', async () => {
		const content = await readFixtureFile('minimal-1c-project', 'env.json');
		const env = JSON.parse(content);

		assert.ok(env.default);
		assert.strictEqual(env.default['--v8version'], '8.3.27.1688');
	});

	test('чтение эталонной конфигурации из шаблона', async () => {
		const content = await readFixtureFile('full-1c-project', 'src/cf/Configuration.xml');
		assert.ok(content.includes('Configuration'));
		assert.ok(content.includes('MetaDataObject'));
	});
});

suite('Фикстуры - Моки VS Code API', () => {
	let inputBoxMock: InputBoxMock;
	let messageMock: MessageMock;

	setup(() => {
		inputBoxMock = new InputBoxMock();
		messageMock = new MessageMock();

		// Подменяем VS Code API
		(vscode.window as any).showInputBox = inputBoxMock.showInputBox.bind(inputBoxMock);
		(vscode.window as any).showInformationMessage = messageMock.showInformationMessage.bind(messageMock);
		(vscode.window as any).showWarningMessage = messageMock.showWarningMessage.bind(messageMock);
		(vscode.window as any).showErrorMessage = messageMock.showErrorMessage.bind(messageMock);
	});

	teardown(() => {
		messageMock.clear();
	});

	test('InputBoxMock возвращает заданные ответы', async () => {
		inputBoxMock.setResponses(['ответ1', 'ответ2', undefined]);

		const result1 = await vscode.window.showInputBox({ prompt: 'Вопрос 1' });
		const result2 = await vscode.window.showInputBox({ prompt: 'Вопрос 2' });
		const result3 = await vscode.window.showInputBox({ prompt: 'Вопрос 3' });

		assert.strictEqual(result1, 'ответ1');
		assert.strictEqual(result2, 'ответ2');
		assert.strictEqual(result3, undefined);
	});

	test('InputBoxMock валидирует ввод', async () => {
		inputBoxMock.setResponses(['']);

		const options: vscode.InputBoxOptions = {
			prompt: 'Введите значение',
			validateInput: (value) => {
				if (!value || value.trim().length === 0) {
					return 'Значение не может быть пустым';
				}
				return null;
			}
		};

		try {
			await vscode.window.showInputBox(options);
			assert.fail('Должна была быть выброшена ошибка валидации');
		} catch (error) {
			assert.ok(error instanceof Error);
			assert.strictEqual(error.message, 'Значение не может быть пустым');
		}
	});

	test('MessageMock записывает сообщения', async () => {
		await vscode.window.showInformationMessage('Информация');
		await vscode.window.showWarningMessage('Предупреждение');
		await vscode.window.showErrorMessage('Ошибка');

		const messages = messageMock.getMessages();
		assert.strictEqual(messages.length, 3);
		assert.ok(messages.some(m => m.includes('INFO: Информация')));
		assert.ok(messages.some(m => m.includes('WARN: Предупреждение')));
		assert.ok(messages.some(m => m.includes('ERROR: Ошибка')));
	});
});
