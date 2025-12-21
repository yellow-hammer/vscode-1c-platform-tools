import * as vscode from 'vscode';
import * as path from 'node:path';
import { BaseCommand } from './baseCommand';
import { buildCommand, joinCommands, detectShellType } from '../utils/commandUtils';
import {
	getLoadExtensionFromSrcCommandName,
	getLoadExtensionFromCfeCommandName,
	getDumpExtensionToSrcCommandName,
	getDumpExtensionToCfeCommandName,
	getBuildExtensionCommandName,
	getDecompileExtensionCommandName
} from '../commandNames';
import { VANESSA_RUNNER_ROOT, VANESSA_RUNNER_EPF, EPF_NAMES, EPF_COMMANDS } from '../constants';

/**
 * Команды для работы с расширениями конфигурации
 * 
 * Предоставляет методы для загрузки, выгрузки, сборки и разбора расширений конфигурации 1С
 */
export class ExtensionsCommands extends BaseCommand {

	/**
	 * Выполняет команды в терминале VS Code
	 * @param commands - Массив команд для выполнения
	 * @param terminalName - Имя терминала
	 * @param workspaceRoot - Корневая директория workspace
	 * @param shellType - Тип оболочки терминала
	 */
	private executeCommandsInTerminal(
		commands: string[],
		terminalName: string,
		workspaceRoot: string,
		shellType: ReturnType<typeof detectShellType>
	): void {
		const terminal = vscode.window.createTerminal({
			name: terminalName,
			cwd: workspaceRoot
		});

		terminal.sendText(joinCommands(commands, shellType));
		terminal.show();
	}

	/**
	 * Получает список папок расширений из исходников
	 * @param workspaceRoot - Корневая директория workspace
	 * @returns Промис, который разрешается массивом имен папок расширений или undefined при ошибке
	 */
	private async getExtensionFoldersFromSrc(workspaceRoot: string): Promise<string[] | undefined> {
		const cfePath = this.vrunner.getCfePath();
		const extensionsSrcPath = path.join(workspaceRoot, cfePath);

		if (!(await this.checkDirectoryExists(extensionsSrcPath, `Папка ${cfePath} не является директорией`))) {
			return undefined;
		}

		const extensionFolders = await this.getDirectories(extensionsSrcPath, `Ошибка при чтении папки ${cfePath}`);
		if (extensionFolders.length === 0) {
			vscode.window.showInformationMessage(`В папке ${cfePath} не найдено расширений`);
			return undefined;
		}

		return extensionFolders;
	}

	/**
	 * Загружает расширения из исходников в информационную базу
	 * 
	 * Находит все подпапки в папке расширений и для каждой выполняет команду `compileext`.
	 * Расширения загружаются в информационную базу, указанную в параметрах подключения.
	 * 
	 * @returns Промис, который разрешается после запуска команд
	 */
	async loadFromSrc(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const extensionFolders = await this.getExtensionFoldersFromSrc(workspaceRoot);
		if (!extensionFolders) {
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getLoadExtensionFromSrcCommandName();
		const vrunnerPath = this.vrunner.getVRunnerPath();
		const shellType = detectShellType();
		const cfePath = this.vrunner.getCfePath();

		const commands: string[] = [];
		for (const extensionFolder of extensionFolders) {
			const inputPath = path.join(cfePath, extensionFolder);
			const args = ['compileext', inputPath, extensionFolder, ...ibConnectionParam];
			if (this.vrunner.getUseIbcmd()) {
				args.push('--ibcmd');
			}
			commands.push(buildCommand(vrunnerPath, args, shellType));
		}

		this.executeCommandsInTerminal(commands, commandName.title, workspaceRoot, shellType);
	}

	/**
	 * Загружает расширение из .cfe файла в информационную базу
	 * 
	 * Находит все файлы .cfe в папке сборки и для каждого выполняет команду загрузки
	 * через EPF обработку vanessa-runner.
	 * 
	 * @returns Промис, который разрешается после запуска команд
	 */
	async loadFromCfe(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const buildPath = this.vrunner.getBuildPath();
		const cfePath = path.join(workspaceRoot, buildPath, 'cfe');

		if (!(await this.checkDirectoryExists(cfePath, `Папка ${buildPath}/cfe не является директорией`))) {
			return;
		}

		const cfeFiles = await this.getFilesByExtension(cfePath, '.cfe', `Ошибка при чтении папки ${buildPath}/cfe`);
		if (cfeFiles.length === 0) {
			vscode.window.showInformationMessage(`В папке ${buildPath}/cfe не найдено файлов .cfe`);
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getLoadExtensionFromCfeCommandName();
		const epfPath = path.join(VANESSA_RUNNER_ROOT, VANESSA_RUNNER_EPF, EPF_NAMES.LOAD_EXTENSION);
		const vrunnerPath = this.vrunner.getVRunnerPath();
		const shellType = detectShellType();

		const commands: string[] = [];
		for (const cfeFile of cfeFiles) {
			const cfeFilePath = path.join(buildPath, 'cfe', cfeFile);
			const commandParam = EPF_COMMANDS.LOAD_EXTENSION(cfeFilePath);
			const args = ['run', '--command', commandParam, '--execute', epfPath, ...ibConnectionParam];
			commands.push(buildCommand(vrunnerPath, args, shellType));
		}

		this.executeCommandsInTerminal(commands, commandName.title, workspaceRoot, shellType);
	}

	/**
	 * Выгружает расширения из информационной базы в исходники
	 * 
	 * Находит все подпапки в папке расширений и для каждой выполняет команду `decompileext`.
	 * Расширения выгружаются из информационной базы в исходники в формате XML.
	 * 
	 * @returns Промис, который разрешается после запуска команд
	 */
	async dumpToSrc(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const extensionFolders = await this.getExtensionFoldersFromSrc(workspaceRoot);
		if (!extensionFolders) {
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getDumpExtensionToSrcCommandName();
		const vrunnerPath = this.vrunner.getVRunnerPath();
		const shellType = detectShellType();
		const cfePath = this.vrunner.getCfePath();

		const commands: string[] = [];
		for (const extensionFolder of extensionFolders) {
			const outputPath = path.join(cfePath, extensionFolder);
			const args = ['decompileext', extensionFolder, outputPath, ...ibConnectionParam];
			if (this.vrunner.getUseIbcmd()) {
				args.push('--ibcmd');
			}
			commands.push(buildCommand(vrunnerPath, args, shellType));
		}

		this.executeCommandsInTerminal(commands, commandName.title, workspaceRoot, shellType);
	}

	/**
	 * Выгружает расширение из информационной базы в .cfe файл
	 * 
	 * Находит все подпапки в папке расширений и для каждой выполняет команду `unloadext`.
	 * Расширения выгружаются из информационной базы в бинарные .cfe файлы в папку сборки.
	 * 
	 * @returns Промис, который разрешается после запуска команд
	 */
	async dumpToCfe(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const extensionFolders = await this.getExtensionFoldersFromSrc(workspaceRoot);
		if (!extensionFolders) {
			return;
		}

		const buildPath = this.vrunner.getBuildPath();
		const cfeBuildPath = path.join(workspaceRoot, buildPath, 'cfe');
		if (!(await this.ensureDirectoryExists(cfeBuildPath, `Ошибка при создании папки ${buildPath}/cfe`))) {
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getDumpExtensionToCfeCommandName();
		const vrunnerPath = this.vrunner.getVRunnerPath();
		const shellType = detectShellType();

		const commands: string[] = [];
		for (const extensionFolder of extensionFolders) {
			const extensionFileName = `${extensionFolder}.cfe`;
			const cfepath = path.join(buildPath, 'cfe', extensionFileName);
			const args = ['unloadext', cfepath, extensionFolder, ...ibConnectionParam];
			if (this.vrunner.getUseIbcmd()) {
				args.push('--ibcmd');
			}
			commands.push(buildCommand(vrunnerPath, args, shellType));
		}

		this.executeCommandsInTerminal(commands, commandName.title, workspaceRoot, shellType);
	}

	/**
	 * Собирает .cfe файл из исходников
	 * 
	 * Находит все подпапки в папке расширений и для каждой выполняет команду `compileexttocfe`.
	 * Исходники расширений компилируются в бинарные .cfe файлы в папку сборки.
	 * 
	 * @returns Промис, который разрешается после запуска команд
	 */
	async compile(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const extensionFolders = await this.getExtensionFoldersFromSrc(workspaceRoot);
		if (!extensionFolders) {
			return;
		}

		const buildPath = this.vrunner.getBuildPath();
		const cfeBuildPath = path.join(workspaceRoot, buildPath, 'cfe');
		if (!(await this.ensureDirectoryExists(cfeBuildPath, `Ошибка при создании папки ${buildPath}/cfe`))) {
			return;
		}

		const commandName = getBuildExtensionCommandName();
		const vrunnerPath = this.vrunner.getVRunnerPath();
		const shellType = detectShellType();
		const cfePath = this.vrunner.getCfePath();

		const commands: string[] = [];
		for (const extensionFolder of extensionFolders) {
			const extensionFileName = `${extensionFolder}.cfe`;
			const srcPath = path.join(cfePath, extensionFolder);
			const outPath = path.join(buildPath, 'cfe', extensionFileName);
			const args = ['compileexttocfe', '--src', srcPath, '--out', outPath];
			if (this.vrunner.getUseIbcmd()) {
				args.push('--ibcmd');
			}
			commands.push(buildCommand(vrunnerPath, args, shellType));
		}

		this.executeCommandsInTerminal(commands, commandName.title, workspaceRoot, shellType);
	}

	/**
	 * Разбирает .cfe файл в исходники
	 * 
	 * Находит все файлы .cfe в папке сборки и для каждого выполняет команду `decompileext`.
	 * Бинарные .cfe файлы разбираются в исходники в формате XML в папку расширений.
	 * 
	 * @returns Промис, который разрешается после запуска команд
	 */
	async decompile(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const buildPath = this.vrunner.getBuildPath();
		const cfeBuildPath = path.join(workspaceRoot, buildPath, 'cfe');

		if (!(await this.checkDirectoryExists(cfeBuildPath, `Папка ${buildPath}/cfe не является директорией`))) {
			return;
		}

		const cfeFiles = await this.getFilesByExtension(cfeBuildPath, '.cfe', `Ошибка при чтении папки ${buildPath}/cfe`);
		if (cfeFiles.length === 0) {
			vscode.window.showInformationMessage(`В папке ${buildPath}/cfe не найдено файлов .cfe`);
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getDecompileExtensionCommandName();
		const vrunnerPath = this.vrunner.getVRunnerPath();
		const cfePath = this.vrunner.getCfePath();
		const shellType = detectShellType();

		const commands: string[] = [];
		for (const cfeFile of cfeFiles) {
			const extensionName = cfeFile.replace(/\.cfe$/i, '');
			const outputPath = path.join(cfePath, extensionName);
			const args = ['decompileext', extensionName, outputPath, ...ibConnectionParam];
			if (this.vrunner.getUseIbcmd()) {
				args.push('--ibcmd');
			}
			commands.push(buildCommand(vrunnerPath, args, shellType));
		}

		this.executeCommandsInTerminal(commands, commandName.title, workspaceRoot, shellType);
	}
}
