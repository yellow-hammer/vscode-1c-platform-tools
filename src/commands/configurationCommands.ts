import * as path from 'node:path';
import { BaseCommand } from './baseCommand';
import {
	getLoadConfigurationFromSrcCommandName,
	getLoadConfigurationFromCfCommandName,
	getDumpConfigurationToSrcCommandName,
	getDumpConfigurationToCfCommandName,
	getDumpConfigurationToDistCommandName,
	getBuildConfigurationCommandName,
	getDecompileConfigurationCommandName
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
		const srcPath = this.vrunner.getSrcPath();
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = [command, '--src', srcPath, ...ibConnectionParam];
		if (this.vrunner.getUseIbcmd()) {
			args.push('--ibcmd');
		}
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

		const buildPath = this.vrunner.getBuildPath();
		const cfFilePath = path.join(buildPath, '1Cv8.cf');
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['load', '--src', cfFilePath, ...ibConnectionParam];
		if (this.vrunner.getUseIbcmd()) {
			args.push('--ibcmd');
		}
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

		const srcPath = this.vrunner.getSrcPath();
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['decompile', '--current', '--out', srcPath, ...ibConnectionParam];
		if (this.vrunner.getUseIbcmd()) {
			args.push('--ibcmd');
		}
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

		const buildPath = this.vrunner.getBuildPath();
		const buildFullPath = path.join(workspaceRoot, buildPath);
		if (!(await this.ensureDirectoryExists(buildFullPath, `Ошибка при создании папки ${buildPath}`))) {
			return;
		}

		const outputPath = path.join(buildPath, '1Cv8.cf');
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['unload', outputPath, ...ibConnectionParam];
		if (this.vrunner.getUseIbcmd()) {
			args.push('--ibcmd');
		}
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

		const buildPath = this.vrunner.getBuildPath();
		const buildFullPath = path.join(workspaceRoot, buildPath);
		if (!(await this.ensureDirectoryExists(buildFullPath, `Ошибка при создании папки ${buildPath}`))) {
			return;
		}

		const outputPath = path.join(buildPath, '1Cv8dist.cf');
		const args = ['make-dist', outputPath];
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

		const srcPath = this.vrunner.getSrcPath();
		const buildPath = this.vrunner.getBuildPath();
		const buildFullPath = path.join(workspaceRoot, buildPath);
		if (!(await this.ensureDirectoryExists(buildFullPath, `Ошибка при создании папки ${buildPath}`))) {
			return;
		}

		const outputPath = path.join(buildPath, '1Cv8.cf');
		const args = ['compile', '--src', srcPath, '--out', outputPath];
		if (this.vrunner.getUseIbcmd()) {
			args.push('--ibcmd');
		}
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

		const buildPath = this.vrunner.getBuildPath();
		const inputPath = path.join(buildPath, '1Cv8.cf');
		const srcPath = this.vrunner.getSrcPath();
		const args = ['decompile', '--in', inputPath, '--out', srcPath];
		if (this.vrunner.getUseIbcmd()) {
			args.push('--ibcmd');
		}
		const commandName = getDecompileConfigurationCommandName();

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}
}
