import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { BaseCommand } from './baseCommand';
import {
	getBuildExternalProcessorCommandName,
	getBuildExternalReportCommandName,
	getDecompileExternalProcessorCommandName,
	getDecompileExternalReportCommandName
} from '../features/tools/commandNames';
import { logger } from '../shared/logger';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';

/**
 * Тип внешнего файла
 */
export type ExternalFileType = 'processor' | 'report';

/**
 * Команды для работы с внешними файлами (обработки и отчеты)
 */
export class ExternalFilesCommands extends BaseCommand {

	async compile(
		fileType: ExternalFileType = 'processor',
		opts?: CommandExecutionOptions
	): Promise<StructuredCommandResult | void> {
		const cwd = this.getExecutionCwd(opts);
		if (!cwd) {
			if (opts?.wait === true) {
				return this.executionError(
					'Укажите projectPath или откройте рабочую область с проектом 1С'
				);
			}
			this.ensureWorkspace();
			return;
		}
		if (!(await this.ensureOscriptForExecution(opts))) {
			if (opts?.wait === true) {
				return this.executionError('OneScript (oscript) или opm не найдены');
			}
			return;
		}

		const srcFolder = fileType === 'processor' ? this.vrunner.getEpfPath() : this.vrunner.getErfPath();
		const srcPath = path.join(cwd, srcFolder);

		if (opts?.wait === true) {
			try {
				const stats = await fs.stat(srcPath);
				if (!stats.isDirectory()) {
					return this.executionError(`Каталог ${srcFolder} не найден`);
				}
			} catch {
				return this.executionError(`Каталог ${srcFolder} не найден`);
			}
		} else if (!(await this.checkDirectoryExists(srcPath, `Папка ${srcFolder} не является директорией`))) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const outputFolder = fileType === 'processor' ? 'epf' : 'erf';
		const outputFullPath = path.join(cwd, buildPath, outputFolder);
		if (!(await this.ensureDirectoryForExecution(
			outputFullPath,
			opts,
			`Ошибка при создании папки ${buildPath}/${outputFolder}`
		))) {
			if (opts?.wait === true) {
				return this.executionError(`Не удалось создать каталог ${buildPath}/${outputFolder}`);
			}
			return;
		}

		const commandName = fileType === 'processor'
			? getBuildExternalProcessorCommandName()
			: getBuildExternalReportCommandName();
		const outputPath = path.join(buildPath, outputFolder);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['compileepf', srcFolder, outputPath, ...ibConnectionParam];
		return this.runVRunner(args, opts, commandName.title, outputPath);
	}

	async decompile(
		fileType: ExternalFileType = 'processor',
		opts?: CommandExecutionOptions
	): Promise<StructuredCommandResult | void> {
		const cwd = this.getExecutionCwd(opts);
		if (!cwd) {
			if (opts?.wait === true) {
				return this.executionError(
					'Укажите projectPath или откройте рабочую область с проектом 1С'
				);
			}
			this.ensureWorkspace();
			return;
		}
		if (!(await this.ensureOscriptForExecution(opts))) {
			if (opts?.wait === true) {
				return this.executionError('OneScript (oscript) или opm не найдены');
			}
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const buildFolder = fileType === 'processor' ? 'epf' : 'erf';
		const inputPath = path.join(buildPath, buildFolder);
		const inputFullPath = path.join(cwd, inputPath);

		if (opts?.wait === true) {
			try {
				const stats = await fs.stat(inputFullPath);
				if (!stats.isDirectory()) {
					return this.executionError(`Каталог ${inputPath} не найден`);
				}
			} catch {
				return this.executionError(`Каталог ${inputPath} не найден`);
			}
		} else if (!(await this.checkDirectoryExists(inputFullPath, `Папка ${inputPath} не является директорией`))) {
			return;
		}

		const outputPath = fileType === 'processor' ? this.vrunner.getEpfPath() : this.vrunner.getErfPath();
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = fileType === 'processor'
			? getDecompileExternalProcessorCommandName()
			: getDecompileExternalReportCommandName();
		const args = ['decompileepf', inputPath, outputPath, ...ibConnectionParam];
		return this.runVRunner(args, opts, commandName.title);
	}

	async clearCache(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const reject = this.rejectIfWait(opts, 'Очистка кэша — файловая операция, не vrunner');
		if (reject) {
			return reject;
		}

		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const buildDir = path.dirname(buildPath);
		const cacheFilePath = path.join(workspaceRoot, buildDir, 'cache.json');

		try {
			await fs.unlink(cacheFilePath);
			logger.info(`Кэш успешно очищен: ${cacheFilePath}`);
			vscode.window.showInformationMessage('Кэш успешно очищен');
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (err.code === 'ENOENT') {
				logger.info(`Файл кэша не найден: ${cacheFilePath}`);
				vscode.window.showInformationMessage('Файл кэша не найден');
			} else {
				logger.error(`Ошибка при удалении кэша: ${err.message}. Путь: ${cacheFilePath}`);
				vscode.window.showErrorMessage(`Ошибка при удалении кэша: ${err.message}`);
			}
		}
	}
}
