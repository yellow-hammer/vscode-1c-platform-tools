import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { BaseCommand } from './baseCommand';
import { getInstallDependenciesCommandName } from '../commandNames';

/**
 * Команды для управления зависимостями проекта
 */
export class DependenciesCommands extends BaseCommand {

	/**
	 * Устанавливает зависимости проекта
	 * Выполняет команду opm install -l в терминале
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
	 * Удаляет каталог oscript_modules из workspace
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
				vscode.window.showInformationMessage('Каталог oscript_modules успешно удален');
			} else {
				vscode.window.showWarningMessage('oscript_modules не является каталогом');
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				vscode.window.showInformationMessage('Каталог oscript_modules не найден');
			} else {
				vscode.window.showErrorMessage(`Не удалось удалить каталог oscript_modules: ${(error as Error).message}`);
			}
		}
	}

	/**
	 * Инициализирует файл packagedef с шаблоном
	 * Создает файл packagedef в корне проекта с базовым содержимым из шаблона
	 * @returns Промис, который разрешается после создания файла
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
			vscode.window.showErrorMessage('Не удалось определить путь к расширению');
			return;
		}

		const templatePath = path.join(extensionPath, 'resources', 'templates', 'packagedef.template');

		// Читаем шаблон из файла
		let packagedefContent: string;
		try {
			packagedefContent = await fs.readFile(templatePath, 'utf-8');
		} catch (error) {
			vscode.window.showErrorMessage(
				`Не удалось прочитать шаблон packagedef: ${(error as Error).message}`
			);
			return;
		}

		try {
			await fs.writeFile(packagedefPath, packagedefContent, 'utf-8');
			vscode.window.showInformationMessage('Файл packagedef успешно создан');
			
			// Открываем файл в редакторе
			const uri = vscode.Uri.file(packagedefPath);
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc);
		} catch (error) {
			vscode.window.showErrorMessage(`Не удалось создать файл packagedef: ${(error as Error).message}`);
		}
	}
}
