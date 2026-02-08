import * as path from 'node:path';
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
	 * Проверяет наличие OneScript (oscript и opm). При отсутствии предлагает установить через OVM.
	 *
	 * @returns Промис, который разрешается true, если oscript и opm доступны или пользователь запустил установку; false при отмене
	 */
	protected async ensureOscriptAvailable(): Promise<boolean> {
		const oscriptOk = await this.vrunner.checkOscriptAvailable();
		const opmOk = await this.vrunner.checkOpmAvailable();
		if (oscriptOk && opmOk) {
			return true;
		}
		const action = await vscode.window.showWarningMessage(
			'OneScript не найден. Установить через OVM?',
			'Установить OneScript',
			'Отмена'
		);
		if (action === 'Установить OneScript') {
			await vscode.commands.executeCommand('1c-platform-tools.dependencies.installOscript');
		}
		return false;
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
	 * Проверяет, что fullPath лежит в basePath (или совпадает с ним). На Windows — без учёта регистра.
	 */
	protected pathUnderBase(basePath: string, fullPath: string): boolean {
		const base = path.resolve(basePath);
		const full = path.resolve(fullPath);
		if (process.platform === 'win32') {
			const baseLower = base.toLowerCase();
			const fullLower = full.toLowerCase();
			return fullLower === baseLower || fullLower.startsWith(baseLower + path.sep);
		}
		return full === base || full.startsWith(base + path.sep);
	}

	/** Строки objlist (без пустых). */
	protected parseObjlistLines(content: string): string[] {
		return content.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
	}

	/** Полный путь: line — абсолютный или относительно workspaceRoot. */
	protected resolveObjlistLine(workspaceRoot: string, line: string): string {
		return path.isAbsolute(line) ? path.resolve(line) : path.resolve(workspaceRoot, line);
	}

	/** Относительный путь basePath → fullPath с прямыми слэшами. */
	protected relativePathSlash(basePath: string, fullPath: string): string {
		return path.relative(path.resolve(basePath), path.resolve(fullPath)).split(path.sep).join('/');
	}

	/** Путь для параметра команды 1С (прямые слэши). */
	protected pathForCmd(p: string): string {
		return p.replaceAll('\\', '/');
	}

	/** Записывает файл списка (строки через \n), UTF-8. При ошибке — лог и сообщение пользователю. Возвращает false при ошибке. */
	protected async writeListFile(
		filePath: string,
		lines: string[],
		errorContext?: string
	): Promise<boolean> {
		try {
			await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
			return true;
		} catch (error) {
			const errMsg = (error as Error).message;
			logger.error(`${errorContext ?? 'Запись списка'}: ${errMsg}`);
			vscode.window.showErrorMessage(`Не удалось записать список файлов: ${errMsg}`);
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
