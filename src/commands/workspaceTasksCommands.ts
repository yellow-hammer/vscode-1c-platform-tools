import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { BaseCommand } from './baseCommand';

interface Task {
	label: string;
	type: string;
	command?: string;
	problemMatcher?: string[];
	[key: string]: any;
}

interface LaunchConfiguration {
	name: string;
	type: string;
	request: string;
	[key: string]: any;
}

/**
 * Команды для работы с задачами и конфигурациями запуска VS Code
 */
export class WorkspaceTasksCommands extends BaseCommand {
	private readonly workspaceRoot: string | undefined;

	constructor() {
		super();
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			this.workspaceRoot = workspaceFolders[0].uri.fsPath;
		}
	}

	/**
	 * Получает задачи из tasks.json
	 *
	 * Загружает все задачи workspace из VS Code API и фильтрует их,
	 * оставляя только задачи workspace (исключая глобальные задачи).
	 *
	 * @returns Промис, который разрешается массивом задач workspace.
	 *          Возвращает пустой массив, если workspace не открыт или произошла ошибка
	 */
	async getTasks(): Promise<Task[]> {
		if (!this.workspaceRoot) {
			return [];
		}

		try {
			const vscodeTasks = await vscode.tasks.fetchTasks();
			const tasks: Task[] = [];
			for (const vscodeTask of vscodeTasks) {
				const isWorkspaceTask = vscodeTask.scope !== vscode.TaskScope.Global;

				if (isWorkspaceTask) {
					const definition = vscodeTask.definition;
					tasks.push({
						label: vscodeTask.name,
						...definition
					});
				}
			}

			return tasks;
		} catch {
			return [];
		}
	}

	/**
	 * Получает конфигурации запуска из launch.json
	 * 
	 * Читает файл `.vscode/launch.json` и возвращает массив конфигураций запуска.
	 * Если файл не существует или содержит невалидный JSON, возвращает пустой массив.
	 * 
	 * @returns Промис, который разрешается массивом конфигураций запуска.
	 *          Возвращает пустой массив, если workspace не открыт, файл не существует
	 *          или произошла ошибка при чтении/парсинге файла
	 */
	async getLaunchConfigurations(): Promise<LaunchConfiguration[]> {
		if (!this.workspaceRoot) {
			return [];
		}

		const launchPath = path.join(this.workspaceRoot, '.vscode', 'launch.json');
		try {
			const content = await fs.readFile(launchPath, 'utf8');
			const launchJson = JSON.parse(content);
			return launchJson.configurations || [];
		} catch {
			return [];
		}
	}

	/**
	 * Запускает задачу
	 * 
	 * Ищет задачу с указанным именем в workspace и запускает её.
	 * Если задача не найдена, пытается запустить конфигурацию отладки с таким же именем.
	 * 
	 * @param taskLabel - Имя задачи для запуска
	 * @returns Промис, который разрешается после запуска задачи
	 * @throws {Error} Если произошла ошибка при запуске задачи или конфигурации
	 */
	async runTask(taskLabel: string): Promise<void> {
		if (!this.workspaceRoot) {
			vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
			return;
		}

		try {
			const vscodeTasks = await vscode.tasks.fetchTasks();
			const vscodeTask = vscodeTasks.find(t => 
				t.name === taskLabel && t.scope !== vscode.TaskScope.Global
			);

			if (vscodeTask) {
				await vscode.tasks.executeTask(vscodeTask);
			} else {
				await this.runLaunchConfiguration(taskLabel);
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Ошибка при запуске задачи "${taskLabel}": ${(error as Error).message}`);
		}
	}

	/**
	 * Запускает конфигурацию отладки
	 * 
	 * Ищет конфигурацию отладки с указанным именем в launch.json и запускает её.
	 * Если конфигурация не найдена, показывает сообщение об ошибке.
	 * 
	 * @param name - Имя конфигурации для запуска
	 * @returns Промис, который разрешается после запуска конфигурации
	 * @throws {Error} Если произошла ошибка при запуске конфигурации отладки
	 */
	async runLaunchConfiguration(name: string): Promise<void> {
		if (!this.workspaceRoot) {
			vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
			return;
		}

		const configs = await this.getLaunchConfigurations();
		const config = configs.find(c => c.name === name);

		if (!config) {
			vscode.window.showErrorMessage(`Конфигурация отладки "${name}" не найдена`);
			return;
		}

		try {
			await vscode.debug.startDebugging(undefined, config);
		} catch (error) {
			vscode.window.showErrorMessage(`Ошибка при запуске конфигурации "${name}": ${(error as Error).message}`);
		}
	}

	/**
	 * Открывает tasks.json для редактирования
	 * 
	 * Открывает файл `.vscode/tasks.json` в редакторе VS Code.
	 * Если файл не существует, создает его с базовой структурой (version: '2.0.0', tasks: []).
	 * 
	 * @returns Промис, который разрешается после открытия файла
	 * @throws {Error} Если не удалось создать директорию .vscode или записать файл
	 */
	async editTasks(): Promise<void> {
		if (!this.workspaceRoot) {
			vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
			return;
		}

		const tasksPath = path.join(this.workspaceRoot, '.vscode', 'tasks.json');
		const uri = vscode.Uri.file(tasksPath);
		
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc);
		} catch {
			const fsSync = await import('node:fs');
			const fsPromises = await import('node:fs/promises');
			
			const vscodeDir = path.join(this.workspaceRoot, '.vscode');
			if (!fsSync.existsSync(vscodeDir)) {
				await fsPromises.mkdir(vscodeDir, { recursive: true });
			}
			
			const defaultTasks = {
				version: '2.0.0',
				tasks: []
			};
			await fsPromises.writeFile(tasksPath, JSON.stringify(defaultTasks, null, '\t'), 'utf8');
			
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc);
		}
	}

	/**
	 * Открывает launch.json для редактирования
	 * 
	 * Открывает файл `.vscode/launch.json` в редакторе VS Code.
	 * Если файл не существует, создает его с базовой структурой (version: '0.2.0', configurations: []).
	 * 
	 * @returns Промис, который разрешается после открытия файла
	 * @throws {Error} Если не удалось создать директорию .vscode или записать файл
	 */
	async editLaunchConfigurations(): Promise<void> {
		if (!this.workspaceRoot) {
			vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
			return;
		}

		const launchPath = path.join(this.workspaceRoot, '.vscode', 'launch.json');
		const uri = vscode.Uri.file(launchPath);
		
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc);
		} catch {
			const fsSync = await import('node:fs');
			const fsPromises = await import('node:fs/promises');
			
			const vscodeDir = path.join(this.workspaceRoot, '.vscode');
			if (!fsSync.existsSync(vscodeDir)) {
				await fsPromises.mkdir(vscodeDir, { recursive: true });
			}
			
			const defaultLaunch = {
				version: '0.2.0',
				configurations: []
			};
			await fsPromises.writeFile(launchPath, JSON.stringify(defaultLaunch, null, '\t'), 'utf8');
			
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc);
		}
	}

	/**
	 * Добавляет задачу в tasks.json
	 * 
	 * **Примечание**: Метод в настоящее время не реализован и является заглушкой.
	 * В будущих версиях будет добавлена функциональность для автоматического
	 * добавления задач в tasks.json.
	 * 
	 * @param task - Задача для добавления
	 * @returns Промис, который разрешается после добавления задачи
	 */
	async addTask(task: Task): Promise<void> {
		if (!this.workspaceRoot) {
			vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
			return;
		}

		vscode.window.showInformationMessage(`Добавление задачи "${task.label}" (заглушка)`);
	}
}
