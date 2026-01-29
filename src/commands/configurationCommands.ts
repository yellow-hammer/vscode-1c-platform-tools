import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { BaseCommand } from './baseCommand';
import {
	getLoadConfigurationFromSrcCommandName,
	getLoadConfigurationFromCfCommandName,
	getDumpConfigurationToSrcCommandName,
	getDumpConfigurationToCfCommandName,
	getDumpConfigurationToDistCommandName,
	getBuildConfigurationCommandName,
	getDecompileConfigurationCommandName,
	getLoadConfigurationIncrementFromSrcCommandName
} from '../commandNames';

/**
 * Команды для работы с конфигурацией
 */
export class ConfigurationCommands extends BaseCommand {

	/**
	 * Загружает конфигурацию из исходников в информационную базу
	 * @param mode - Режим загрузки: 'init' для инициализации, 'update' для обновления
	 * @returns Промис, который разрешается после запуска команды
	 */
	async loadFromSrc(mode: 'init' | 'update' = 'update'): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const command = mode === 'init' ? 'init-dev' : 'update-dev';
		const srcPath = this.vrunner.getCfPath();
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = this.addIbcmdIfNeeded([command, '--src', srcPath, ...ibConnectionParam]);
		const commandName = getLoadConfigurationFromSrcCommandName(mode);

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Загружает конфигурацию из .cf файла в информационную базу
	 * @returns Промис, который разрешается после запуска команды
	 */
	async loadFromCf(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const cfFilePath = path.join(buildPath, '1Cv8.cf');
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = this.addIbcmdIfNeeded(['load', '--src', cfFilePath, ...ibConnectionParam]);
		const commandName = getLoadConfigurationFromCfCommandName();

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Выгружает конфигурацию из информационной базы в исходники
	 * @returns Промис, который разрешается после запуска команды
	 */
	async dumpToSrc(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const srcPath = this.vrunner.getCfPath();
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = this.addIbcmdIfNeeded(['decompile', '--current', '--out', srcPath, ...ibConnectionParam]);
		const commandName = getDumpConfigurationToSrcCommandName();

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Выгружает конфигурацию из информационной базы в .cf файл
	 * @returns Промис, который разрешается после запуска команды
	 */
	async dumpToCf(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const buildFullPath = path.join(workspaceRoot, buildPath);
		if (!(await this.ensureDirectoryExists(buildFullPath, `Ошибка при создании папки ${buildPath}`))) {
			return;
		}

		const outputPath = path.join(buildPath, '1Cv8.cf');
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = this.addIbcmdIfNeeded(['unload', outputPath, ...ibConnectionParam]);
		const commandName = getDumpConfigurationToCfCommandName();

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Выгружает файл поставки в 1Cv8dist.cf
	 * @returns Промис, который разрешается после запуска команды
	 */
	async dumpToDist(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const buildFullPath = path.join(workspaceRoot, buildPath);
		if (!(await this.ensureDirectoryExists(buildFullPath, `Ошибка при создании папки ${buildPath}`))) {
			return;
		}

		const outputPath = path.join(buildPath, '1Cv8dist.cf');
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['make-dist', outputPath, ...ibConnectionParam];
		const commandName = getDumpConfigurationToDistCommandName();

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Собирает .cf файл из исходников
	 * @returns Промис, который разрешается после запуска команды
	 */
	async compile(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const srcPath = this.vrunner.getCfPath();
		const buildPath = this.vrunner.getOutPath();
		const buildFullPath = path.join(workspaceRoot, buildPath);
		if (!(await this.ensureDirectoryExists(buildFullPath, `Ошибка при создании папки ${buildPath}`))) {
			return;
		}

		const outputPath = path.join(buildPath, '1Cv8.cf');
		const args = this.addIbcmdIfNeeded(['compile', '--src', srcPath, '--out', outputPath]);
		const commandName = getBuildConfigurationCommandName();

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Разбирает .cf файл в исходники
	 * @returns Промис, который разрешается после запуска команды
	 */
	async decompile(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const inputPath = path.join(buildPath, '1Cv8.cf');
		const srcPath = this.vrunner.getCfPath();
		const args = this.addIbcmdIfNeeded(['decompile', '--in', inputPath, '--out', srcPath]);
		const commandName = getDecompileConfigurationCommandName();

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Загружает конфигурацию инкрементально из исходников с использованием git diff
	 * Перед выполнением запрашивает SHA коммита для записи в lastUploadedCommit.txt
	 * @returns Промис, который разрешается после запуска команды
	 */
	async loadIncrementFromSrc(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const srcPath = this.vrunner.getCfPath();
		const lastUploadedCommitPath = path.join(workspaceRoot, srcPath, 'lastUploadedCommit.txt');

		let currentSha = '';
		try {
			const content = await fs.readFile(lastUploadedCommitPath, 'utf-8');
			currentSha = content.trim();
		} catch {
			// Файл не существует, это нормально - будет полная загрузка
		}

		const shaInput = await vscode.window.showInputBox({
			prompt: 'Введите SHA коммита для инкрементальной загрузки',
			placeHolder: 'Оставьте пустым для полной загрузки',
			value: currentSha,
			ignoreFocusOut: true
		});

		if (shaInput === undefined) {
			return;
		}

		try {
			const srcFullPath = path.join(workspaceRoot, srcPath);
			if (!(await this.ensureDirectoryExists(srcFullPath, `Ошибка при создании папки ${srcPath}`))) {
				return;
			}

			await fs.writeFile(lastUploadedCommitPath, shaInput.trim(), 'utf-8');
		} catch (error) {
			vscode.window.showErrorMessage(
				`Не удалось записать SHA в файл ${lastUploadedCommitPath}: ${(error as Error).message}`
			);
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = this.addIbcmdIfNeeded([
			'update-dev',
			'--src',
			srcPath,
			'--git-increment',
			...ibConnectionParam
		]);
		const commandName = getLoadConfigurationIncrementFromSrcCommandName();

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}
}
