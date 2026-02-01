import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { BaseCommand } from './baseCommand';
import { logger } from '../logger';

/**
 * Результат получения списка задач oscript из каталога tasks
 */
export interface OscriptTask {
	/** Имя задачи (имя файла без расширения .os) */
	name: string;
}

/** Содержимое по умолчанию для нового файла задачи oscript */
const DEFAULT_TASK_CONTENT = '//Вставить содержимое скрипта ';

/**
 * Команды для работы с задачами oscript из каталога tasks в корне проекта
 */
export class OscriptTasksCommands extends BaseCommand {
	private static readonly TASKS_DIR = 'tasks';
	private static readonly OS_EXTENSION = '.os';

	/**
	 * Получает список задач oscript из каталога tasks
	 *
	 * Читает каталог tasks в корне workspace и возвращает имена файлов *.os
	 * без расширения (для выполнения через opm run &lt;имя&gt;).
	 *
	 * @returns Промис, который разрешается массивом задач.
	 *          Возвращает пустой массив, если workspace не открыт, каталог tasks
	 *          не существует или не содержит файлов *.os
	 */
	async getOscriptTasks(): Promise<OscriptTask[]> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return [];
		}

		const tasksPath = path.join(workspaceRoot, OscriptTasksCommands.TASKS_DIR);
		try {
			const entries = await fs.readdir(tasksPath, { withFileTypes: true });
			const files = entries
				.filter(
					entry =>
						entry.isFile() &&
						entry.name.toLowerCase().endsWith(OscriptTasksCommands.OS_EXTENSION)
				)
				.map(entry => path.basename(entry.name, OscriptTasksCommands.OS_EXTENSION))
				.map(name => ({ name }));
			return files;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return [];
			}
			throw error;
		}
	}

	/**
	 * Запускает задачу oscript через opm run
	 *
	 * Выполняет команду opm run &lt;имя&gt; в терминале VS Code.
	 * Если taskName не передан (вызов из палитры команд), показывает выбор задачи из списка.
	 *
	 * @param taskName - Имя задачи (имя файла без .os). Опционально при вызове из палитры
	 * @returns Промис, который разрешается после запуска команды в терминале или отмены выбора
	 */
	async runOscriptTask(taskName?: string): Promise<void> {
		if (!this.ensureWorkspace()) {
			return;
		}

		let nameToRun = taskName;
		if (nameToRun === undefined) {
			const tasks = await this.getOscriptTasks();
			if (tasks.length === 0) {
				logger.warn('Нет задач oscript в каталоге tasks');
				vscode.window.showWarningMessage('Нет задач oscript в каталоге tasks');
				return;
			}
			const chosen = await vscode.window.showQuickPick(
				tasks.map(t => ({ label: t.name, description: `opm run ${t.name}` })),
				{ placeHolder: 'Выберите задачу oscript для запуска' }
			);
			if (!chosen) {
				return;
			}
			nameToRun = chosen.label;
		}

		this.vrunner.executeOpmInTerminal(['run', nameToRun], {
			name: `opm run ${nameToRun}`,
		});
	}

	/**
	 * Добавляет новую задачу oscript
	 *
	 * Показывает диалог ввода имени файла, создаёт каталог tasks в корне проекта
	 * (если его нет), создаёт в нём файл с введённым именем в формате *.os
	 * и содержимым по умолчанию.
	 *
	 * @returns Промис, который разрешается после создания файла или отмены ввода
	 */
	async addOscriptTask(): Promise<void> {
		if (!this.ensureWorkspace()) {
			return;
		}

		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return;
		}

		const fileName = await vscode.window.showInputBox({
			prompt: 'Имя файла задачи (будет создан в каталоге tasks с расширением .os)',
			placeHolder: 'имя_задачи',
			validateInput: (value: string) => {
				const trimmed = value.trim();
				if (!trimmed) {
					return 'Введите имя файла';
				}
				const invalidChars = /[\\/:*?"<>|]/;
				if (invalidChars.test(trimmed)) {
					return String.raw`Имя файла не должно содержать символы \ / : * ? " < > |`;
				}
				return null;
			},
		});

		if (fileName === undefined) {
			return;
		}

		const baseName = fileName.trim();
		const nameWithExt = baseName.toLowerCase().endsWith(OscriptTasksCommands.OS_EXTENSION)
			? baseName
			: `${baseName}${OscriptTasksCommands.OS_EXTENSION}`;

		const tasksPath = path.join(workspaceRoot, OscriptTasksCommands.TASKS_DIR);
		const filePath = path.join(tasksPath, nameWithExt);

		try {
			await fs.mkdir(tasksPath, { recursive: true });
			await fs.writeFile(filePath, DEFAULT_TASK_CONTENT, 'utf8');

			const uri = vscode.Uri.file(filePath);
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc);

			logger.info(`Создана задача oscript: ${nameWithExt}, путь: ${filePath}`);
			vscode.window.showInformationMessage(`Создана задача oscript: ${nameWithExt}`);
		} catch (error) {
			const errMsg = (error as Error).message;
			logger.error(`Ошибка при создании задачи oscript: ${errMsg}. Путь: ${filePath}`);
			vscode.window.showErrorMessage(
				`Ошибка при создании задачи: ${errMsg}`
			);
		}
	}
}
