import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { BaseCommand } from './baseCommand';
import { getInstallDependenciesCommandName, getUpdateOpmCommandName } from '../commandNames';
import { logger } from '../logger';
import { notifyProjectCreated } from '../projectContext';

/**
 * Команды для управления зависимостями проекта
 */
export class DependenciesCommands extends BaseCommand {

	/**
	 * Устанавливает зависимости проекта
	 * 
	 * Выполняет команду opm install -l в терминале для установки всех зависимостей,
	 * указанных в packagedef файле проекта.
	 * 
	 * @returns Промис, который разрешается после запуска команды
	 */
	async installDependencies(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const commandName = getInstallDependenciesCommandName();
		this.vrunner.executeOpmInTerminal(['install', '-l'], {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Удаляет зависимости проекта
	 * 
	 * Удаляет каталог oscript_modules из workspace, что приводит к удалению
	 * всех установленных зависимостей проекта.
	 * 
	 * @returns Промис, который разрешается после удаления каталога
	 */
	async removeDependencies(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const oscriptModulesPath = path.join(workspaceRoot, 'oscript_modules');
		
		try {
			const stats = await fs.stat(oscriptModulesPath);
			if (stats.isDirectory()) {
				await fs.rm(oscriptModulesPath, { recursive: true, force: true });
				logger.info(`Каталог oscript_modules успешно удалён: ${oscriptModulesPath}`);
				vscode.window.showInformationMessage('Каталог oscript_modules успешно удален');
			} else {
				logger.warn(`oscript_modules не является каталогом: ${oscriptModulesPath}`);
				vscode.window.showWarningMessage('oscript_modules не является каталогом');
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				logger.info('Каталог oscript_modules не найден');
				vscode.window.showInformationMessage('Каталог oscript_modules не найден');
			} else {
				const errMsg = (error as Error).message;
				logger.error(`Не удалось удалить каталог oscript_modules: ${errMsg}. Путь: ${oscriptModulesPath}`);
				vscode.window.showErrorMessage(`Не удалось удалить каталог oscript_modules: ${errMsg}`);
			}
		}
	}

	/**
	 * Обновляет OPM (OneScript Package Manager)
	 *
	 * Выполняет команду opm install opm в терминале для установки или обновления
	 * менеджера пакетов OPM в проекте.
	 *
	 * @returns Промис, который разрешается после запуска команды
	 */
	async updateOpm(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const commandName = getUpdateOpmCommandName();
		this.vrunner.executeOpmInTerminal(['install', 'opm'], {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Инициализирует файл packagedef с шаблоном
	 * 
	 * Создает файл packagedef в корне проекта с базовым содержимым из шаблона.
	 * Если файл уже существует, запрашивает подтверждение на перезапись.
	 * После создания открывает файл в редакторе VS Code.
	 * 
	 * @returns Промис, который разрешается после создания файла
	 * @throws {Error} Если не удалось прочитать шаблон или создать файл
	 */
	async initializePackagedef(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const packagedefPath = path.join(workspaceRoot, 'packagedef');
		
		// Проверяем, существует ли уже файл
		try {
			await fs.access(packagedefPath);
			const action = await vscode.window.showWarningMessage(
				'Файл packagedef уже существует. Перезаписать?',
				'Да',
				'Нет'
			);
			
			if (action !== 'Да') {
				return;
			}
		} catch {
			// Файл не существует, продолжаем
		}

		// Получаем путь к шаблону
		const extensionPath = this.vrunner.getExtensionPath();
		if (!extensionPath) {
			const msg = 'Не удалось определить путь к расширению';
			logger.error(
				`${msg}. Возможные причины: расширение не передало ExtensionContext в VRunnerManager при активации; workspaceRoot=${workspaceRoot ?? 'не определён'}. Проверьте панель Output (1C Platform Tools) для диагностики.`
			);
			logger.show();
			vscode.window.showErrorMessage(msg);
			return;
		}

		const templatePath = path.join(extensionPath, 'resources', 'templates', 'packagedef.template');
		logger.debug(`Инициализация packagedef: workspaceRoot=${workspaceRoot}, extensionPath=${extensionPath}, templatePath=${templatePath}`);

		// Читаем шаблон из файла
		let packagedefContent: string;
		try {
			packagedefContent = await fs.readFile(templatePath, 'utf-8');
		} catch (error) {
			const errMsg = (error as Error).message;
			logger.error(`Не удалось прочитать шаблон packagedef: ${errMsg}. Путь: ${templatePath}`);
			logger.show();
			vscode.window.showErrorMessage(
				`Не удалось прочитать шаблон packagedef: ${errMsg}`
			);
			return;
		}

		try {
			await fs.writeFile(packagedefPath, packagedefContent, 'utf-8');
			logger.info(`Файл packagedef успешно создан: ${packagedefPath}`);
			vscode.window.showInformationMessage('Файл packagedef успешно создан');

			// Полная активация расширения: панель 1C Platform Tools и дерево появятся без перезагрузки окна
			notifyProjectCreated();

			// Открываем файл в редакторе
			const uri = vscode.Uri.file(packagedefPath);
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc);
		} catch (error) {
			const errMsg = (error as Error).message;
			logger.error(`Не удалось создать файл packagedef: ${errMsg}. Путь: ${packagedefPath}`);
			logger.show();
			vscode.window.showErrorMessage(`Не удалось создать файл packagedef: ${errMsg}`);
		}
	}
}
