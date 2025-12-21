import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { BaseCommand } from './baseCommand';
import {
	getBuildExternalProcessorCommandName,
	getBuildExternalReportCommandName,
	getDecompileExternalProcessorCommandName,
	getDecompileExternalReportCommandName
} from '../commandNames';

/**
 * Тип внешнего файла
 */
export type ExternalFileType = 'processor' | 'report';

/**
 * Команды для работы с внешними файлами (обработки и отчеты)
 */
export class ExternalFilesCommands extends BaseCommand {

	/**
	 * Собирает внешний файл (обработку или отчет) из исходников
	 * @param fileType - Тип файла: 'processor' для обработок, 'report' для отчетов
	 * @returns Промис, который разрешается после запуска команды
	 */
	async compile(fileType: ExternalFileType = 'processor'): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const srcFolder = fileType === 'processor' ? this.vrunner.getEpfPath() : this.vrunner.getErfPath();
		const srcPath = path.join(workspaceRoot, srcFolder);

		if (!(await this.checkDirectoryExists(srcPath, `Папка ${srcFolder} не является директорией`))) {
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const buildPath = this.vrunner.getBuildPath();
		const outputFolder = fileType === 'processor' ? 'epf' : 'erf';
		const outputFullPath = path.join(workspaceRoot, buildPath, outputFolder);
		if (!(await this.ensureDirectoryExists(outputFullPath, `Ошибка при создании папки ${buildPath}/${outputFolder}`))) {
			return;
		}

		const commandName = fileType === 'processor' 
			? getBuildExternalProcessorCommandName()
			: getBuildExternalReportCommandName();
		const vrunnerCommand = 'compileepf';
		const inputPath = srcFolder;
		const outputPath = path.join(buildPath, outputFolder);
		const args = [vrunnerCommand, inputPath, outputPath, ...ibConnectionParam];

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Разбирает внешний файл (обработку или отчет) из .epf/.erf в исходники
	 * @param fileType - Тип файла: 'processor' для обработок, 'report' для отчетов
	 * @returns Промис, который разрешается после запуска команды
	 */
	async decompile(fileType: ExternalFileType = 'processor'): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const buildPath = this.vrunner.getBuildPath();
		const buildFolder = fileType === 'processor' ? 'epf' : 'erf';
		const inputPath = path.join(buildPath, buildFolder);
		const inputFullPath = path.join(workspaceRoot, inputPath);

		if (!(await this.checkDirectoryExists(inputFullPath, `Папка ${inputPath} не является директорией`))) {
			return;
		}

		const outputPath = fileType === 'processor' ? this.vrunner.getEpfPath() : this.vrunner.getErfPath();
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = fileType === 'processor' 
			? getDecompileExternalProcessorCommandName()
			: getDecompileExternalReportCommandName();
		const vrunnerCommand = 'decompileepf';
		const args = [vrunnerCommand, inputPath, outputPath, ...ibConnectionParam];

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Очищает кэш, удаляя файл build/cache.json
	 * @returns Промис, который разрешается после удаления файла кэша
	 */
	async clearCache(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const buildPath = this.vrunner.getBuildPath();
		const buildDir = path.dirname(buildPath);
		const cacheFilePath = path.join(workspaceRoot, buildDir, 'cache.json');

		try {
			await fs.unlink(cacheFilePath);
			vscode.window.showInformationMessage('Кэш успешно очищен');
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (err.code === 'ENOENT') {
				vscode.window.showInformationMessage('Файл кэша не найден');
			} else {
				vscode.window.showErrorMessage(`Ошибка при удалении кэша: ${err.message}`);
			}
		}
	}
}
