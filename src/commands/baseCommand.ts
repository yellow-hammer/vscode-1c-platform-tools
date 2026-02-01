import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { VRunnerManager } from '../vrunnerManager';
import { logger } from '../logger';

/**
 * Базовый класс для всех команд
 * Предоставляет общие методы для проверки workspace и работы с файловой системой
 */
export abstract class BaseCommand {
	protected readonly vrunner: VRunnerManager;

	constructor() {
		this.vrunner = VRunnerManager.getInstance();
	}

	/**
	 * Проверяет наличие workspace и показывает ошибку, если его нет
	 * @returns workspaceRoot или undefined, если workspace не открыт
	 */
	protected ensureWorkspace(): string | undefined {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			logger.warn('Команда вызвана без открытой рабочей области (workspaceFolders пуст или отсутствует)');
			vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
		}
		return workspaceRoot;
	}

	/**
	 * Проверяет существование директории
	 * @param dirPath - Путь к директории
	 * @param errorMessage - Сообщение об ошибке, если директория не существует
	 * @returns Промис, который разрешается true, если директория существует и является директорией, иначе false
	 */
	protected async checkDirectoryExists(dirPath: string, errorMessage?: string): Promise<boolean> {
		try {
			const stats = await fs.stat(dirPath);
			if (!stats.isDirectory()) {
				const message = errorMessage || `Папка ${dirPath} не является директорией`;
				logger.error(message);
				vscode.window.showErrorMessage(message);
				return false;
			}
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				const message = errorMessage || `Папка ${dirPath} не найдена`;
				logger.warn(message);
				vscode.window.showErrorMessage(message);
				return false;
			}
			const message = errorMessage || `Ошибка при проверке папки ${dirPath}: ${(error as Error).message}`;
			logger.error(message);
			vscode.window.showErrorMessage(message);
			return false;
		}
	}

	/**
	 * Получает список директорий в указанной папке
	 * @param dirPath - Путь к папке
	 * @param errorMessage - Сообщение об ошибке при чтении
	 * @returns Промис, который разрешается массивом имен директорий
	 */
	protected async getDirectories(dirPath: string, errorMessage?: string): Promise<string[]> {
		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });
			return entries
				.filter(entry => entry.isDirectory())
				.map(entry => entry.name);
		} catch (error) {
			const message = errorMessage || `Ошибка при чтении папки ${dirPath}: ${(error as Error).message}`;
			logger.error(message);
			vscode.window.showErrorMessage(message);
			return [];
		}
	}

	/**
	 * Получает список файлов с указанным расширением в папке
	 * @param dirPath - Путь к папке
	 * @param extension - Расширение файлов (например, '.cfe')
	 * @param errorMessage - Сообщение об ошибке при чтении
	 * @returns Промис, который разрешается массивом имен файлов
	 */
	protected async getFilesByExtension(dirPath: string, extension: string, errorMessage?: string): Promise<string[]> {
		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });
			return entries
				.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(extension.toLowerCase()))
				.map(entry => entry.name);
		} catch (error) {
			const message = errorMessage || `Ошибка при чтении папки ${dirPath}: ${(error as Error).message}`;
			logger.error(message);
			vscode.window.showErrorMessage(message);
			return [];
		}
	}

	/**
	 * Создает директорию, если она не существует
	 * @param dirPath - Путь к директории
	 * @param errorMessage - Сообщение об ошибке при создании
	 * @returns Промис, который разрешается true, если директория существует или была создана, иначе false
	 */
	protected async ensureDirectoryExists(dirPath: string, errorMessage?: string): Promise<boolean> {
		try {
			await fs.mkdir(dirPath, { recursive: true });
			return true;
		} catch (error) {
			const message = errorMessage || `Ошибка при создании папки ${dirPath}: ${(error as Error).message}`;
			logger.error(message);
			vscode.window.showErrorMessage(message);
			return false;
		}
	}

	/**
	 * Добавляет параметр --ibcmd к аргументам команды, если это необходимо
	 * 
	 * Проверяет, нужно ли использовать ibcmd и поддерживает ли команда этот параметр.
	 * 
	 * @param args - Массив аргументов команды
	 * @returns Массив аргументов с добавленным --ibcmd (если нужно)
	 */
	protected addIbcmdIfNeeded(args: string[]): string[] {
		if (this.vrunner.getUseIbcmd() && this.vrunner.supportsIbcmd(args)) {
			args.push('--ibcmd');
		}
		return args;
	}
}
