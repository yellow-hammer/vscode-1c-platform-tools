import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { BaseCommand } from './baseCommand';
import { buildCommand, joinCommands, detectShellType } from '../utils/commandUtils';
import {
	getLoadExtensionFromSrcCommandName,
	getLoadExtensionFromCfeCommandName,
	getLoadExtensionFromFilesByListCommandName,
	getDumpExtensionToSrcCommandName,
	getDumpExtensionToCfeCommandName,
	getBuildExtensionCommandName,
	getDecompileExtensionCommandName
} from '../commandNames';
import { VANESSA_RUNNER_ROOT, VANESSA_RUNNER_EPF, EPF_NAMES, EPF_COMMANDS } from '../constants';
import { logger } from '../logger';

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
	 * Выполняет команду vrunner для всех расширений с учетом Docker
	 * 
	 * Если Docker включен, выполняет команды последовательно через executeVRunnerInTerminal.
	 * Если Docker выключен, объединяет команды в одну строку для выполнения в одном терминале.
	 * 
	 * @param buildArgs - Функция, которая строит аргументы команды для одного расширения
	 * @param commandName - Название команды для отображения в терминале
	 * @returns Промис, который разрешается после запуска всех команд
	 */
	private async executeForAllExtensions(
		buildArgs: (extensionFolder: string) => string[],
		commandName: string
	): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		const extensionFolders = await this.getExtensionFoldersFromSrc(workspaceRoot);
		if (!extensionFolders) {
			return;
		}

		const useDocker = await this.vrunner.shouldUseDocker();
		
		if (useDocker) {
			// В Docker выполняем команды последовательно
			for (const extensionFolder of extensionFolders) {
				const args = this.addIbcmdIfNeeded(buildArgs(extensionFolder));
				await this.vrunner.executeVRunnerInTerminal(args, {
					cwd: workspaceRoot,
					name: commandName
				});
			}
		} else {
			// Локальное выполнение - объединяем команды
			const vrunnerPath = this.vrunner.getVRunnerPath();
			const shellType = detectShellType();
			const commands = extensionFolders.map(extensionFolder => {
				const args = this.addIbcmdIfNeeded(buildArgs(extensionFolder));
				return buildCommand(vrunnerPath, args, shellType);
			});
			this.executeCommandsInTerminal(commands, commandName, workspaceRoot, shellType);
		}
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
			logger.info(`В папке ${cfePath} не найдено расширений`);
			vscode.window.showInformationMessage(`В папке ${cfePath} не найдено расширений`);
			return undefined;
		}

		return extensionFolders;
	}

	/** Группирует пути из objlist по расширениям (src/cfe/<имя>). Пути — полные или относительно workspace. */
	private async getPathsByExtensionFromObjlist(
		workspaceRoot: string,
		extensionFolders: string[]
	): Promise<Map<string, string[]>> {
		let content: string;
		try {
			content = await fs.readFile(path.join(workspaceRoot, 'objlist.txt'), 'utf-8');
		} catch {
			return new Map();
		}
		const lines = this.parseObjlistLines(content);
		const cfePath = this.vrunner.getCfePath();
		const byExtension = new Map<string, string[]>();
		for (const line of lines) {
			const fullPath = this.resolveObjlistLine(workspaceRoot, line);
			for (const extName of extensionFolders) {
				const extFullPath = path.resolve(workspaceRoot, cfePath, extName);
				if (this.pathUnderBase(extFullPath, fullPath)) {
					const rel = this.relativePathSlash(extFullPath, fullPath);
					const list = byExtension.get(extName) ?? [];
					if (!list.includes(rel)) {
						list.push(rel);
						byExtension.set(extName, list);
					}
					break;
				}
			}
		}
		return byExtension;
	}

	/** Удаляет в build временные списки extension-partial-load-*.txt от предыдущего запуска. */
	private async cleanupExtensionPartialLoadLists(buildDir: string): Promise<void> {
		try {
			const entries = await fs.readdir(buildDir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isFile() && entry.name.startsWith('extension-partial-load-') && entry.name.endsWith('.txt')) {
					await fs.unlink(path.join(buildDir, entry.name));
					logger.debug(`Удалён временный список: ${entry.name}`);
				}
			}
		} catch {
			// каталог может отсутствовать
		}
	}

	/**
	 * Частичная загрузка расширений из objlist.txt: только пути из src/cfe/<имя>. Списки в build, удаляются при следующем запуске.
	 */
	async loadFromFilesByList(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const buildFullPath = path.join(workspaceRoot, buildPath);
		await this.cleanupExtensionPartialLoadLists(buildFullPath);

		const objlistPath = path.join(workspaceRoot, 'objlist.txt');
		try {
			await fs.access(objlistPath);
		} catch {
			logger.warn(`Файл objlist.txt не найден: ${objlistPath}`);
			vscode.window.showErrorMessage(
				'Файл objlist.txt не найден в корне проекта. Создайте файл со списком путей к объектам для загрузки.'
			);
			return;
		}

		const extensionFolders = await this.getExtensionFoldersFromSrc(workspaceRoot);
		if (!extensionFolders) {
			return;
		}

		const pathsByExtension = await this.getPathsByExtensionFromObjlist(workspaceRoot, extensionFolders);
		if (pathsByExtension.size === 0) {
			logger.info('В objlist.txt нет путей в каталогах расширений (src/cfe/...)');
			vscode.window.showInformationMessage(
				'В objlist.txt нет путей из каталогов расширений (src/cfe/<имя>).'
			);
			return;
		}

		if (!(await this.ensureDirectoryExists(buildFullPath, `Ошибка при создании каталога ${buildPath}`))) {
			return;
		}

		const cfePath = this.vrunner.getCfePath();
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getLoadExtensionFromFilesByListCommandName();
		const listFilePrefix = this.pathForCmd(buildPath) + '/';

		for (const [extensionName, relativePaths] of pathsByExtension) {
			const listFileName = `extension-partial-load-${extensionName}.txt`;
			const listFilePath = path.join(buildFullPath, listFileName);
			if (!(await this.writeListFile(listFilePath, relativePaths, `Список расширения ${extensionName}`))) {
				continue;
			}
			const extensionRelativePath = path.join(cfePath, extensionName);
			const additionalParam = `/LoadConfigFromFiles ${this.pathForCmd(extensionRelativePath)} -Extension ${extensionName} -listFile ${listFilePrefix}${listFileName} -Format Hierarchical -partial`;
			const args = this.addIbcmdIfNeeded(['designer', '--additional', additionalParam, ...ibConnectionParam]);
			this.vrunner.executeVRunnerInTerminal(args, {
				cwd: workspaceRoot,
				name: commandName.title
			});
		}
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
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		const extensionFolders = await this.getExtensionFoldersFromSrc(workspaceRoot);
		if (!extensionFolders) {
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getLoadExtensionFromSrcCommandName();
		const cfePath = this.vrunner.getCfePath();

		await this.executeForAllExtensions(
			(extensionFolder) => {
				const inputPath = path.join(cfePath, extensionFolder);
				return ['compileext', inputPath, extensionFolder, ...ibConnectionParam];
			},
			commandName.title
		);
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
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const cfePath = path.join(workspaceRoot, buildPath, 'cfe');

		if (!(await this.checkDirectoryExists(cfePath, `Папка ${buildPath}/cfe не является директорией`))) {
			return;
		}

		const cfeFiles = await this.getFilesByExtension(cfePath, '.cfe', `Ошибка при чтении папки ${buildPath}/cfe`);
		if (cfeFiles.length === 0) {
			logger.info(`В папке ${buildPath}/cfe не найдено файлов .cfe`);
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
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		const extensionFolders = await this.getExtensionFoldersFromSrc(workspaceRoot);
		if (!extensionFolders) {
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getDumpExtensionToSrcCommandName();
		const cfePath = this.vrunner.getCfePath();

		await this.executeForAllExtensions(
			(extensionFolder) => {
				const outputPath = path.join(cfePath, extensionFolder);
				return ['decompileext', extensionFolder, outputPath, ...ibConnectionParam];
			},
			commandName.title
		);
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
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		const extensionFolders = await this.getExtensionFoldersFromSrc(workspaceRoot);
		if (!extensionFolders) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const cfeBuildPath = path.join(workspaceRoot, buildPath, 'cfe');
		if (!(await this.ensureDirectoryExists(cfeBuildPath, `Ошибка при создании папки ${buildPath}/cfe`))) {
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getDumpExtensionToCfeCommandName();

		await this.executeForAllExtensions(
			(extensionFolder) => {
				const extensionFileName = `${extensionFolder}.cfe`;
				const cfepath = path.join(buildPath, 'cfe', extensionFileName);
				return ['unloadext', cfepath, extensionFolder, ...ibConnectionParam];
			},
			commandName.title
		);
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
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		const extensionFolders = await this.getExtensionFoldersFromSrc(workspaceRoot);
		if (!extensionFolders) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const cfeBuildPath = path.join(workspaceRoot, buildPath, 'cfe');
		if (!(await this.ensureDirectoryExists(cfeBuildPath, `Ошибка при создании папки ${buildPath}/cfe`))) {
			return;
		}

		const commandName = getBuildExtensionCommandName();
		const cfePath = this.vrunner.getCfePath();
		
		await this.executeForAllExtensions(
			(extensionFolder) => {
				const extensionFileName = `${extensionFolder}.cfe`;
				const srcPath = path.join(cfePath, extensionFolder);
				const outPath = path.join(buildPath, 'cfe', extensionFileName);
				return ['compileexttocfe', '--src', srcPath, '--out', outPath];
			},
			commandName.title
		);
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
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const cfeBuildPath = path.join(workspaceRoot, buildPath, 'cfe');

		if (!(await this.checkDirectoryExists(cfeBuildPath, `Папка ${buildPath}/cfe не является директорией`))) {
			return;
		}

		const cfeFiles = await this.getFilesByExtension(cfeBuildPath, '.cfe', `Ошибка при чтении папки ${buildPath}/cfe`);
		if (cfeFiles.length === 0) {
			logger.info(`В папке ${buildPath}/cfe не найдено файлов .cfe`);
			vscode.window.showInformationMessage(`В папке ${buildPath}/cfe не найдено файлов .cfe`);
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getDecompileExtensionCommandName();
		const useDocker = await this.vrunner.shouldUseDocker();
		const cfePath = this.vrunner.getCfePath();

		if (useDocker) {
			for (const cfeFile of cfeFiles) {
				const extensionName = cfeFile.replace(/\.cfe$/i, '');
				const outputPath = path.join(cfePath, extensionName);
				const args = this.addIbcmdIfNeeded(['decompileext', extensionName, outputPath, ...ibConnectionParam]);
				await this.vrunner.executeVRunnerInTerminal(args, {
					cwd: workspaceRoot,
					name: commandName.title
				});
			}
		} else {
			const vrunnerPath = this.vrunner.getVRunnerPath();
			const shellType = detectShellType();
			const commands: string[] = [];
			for (const cfeFile of cfeFiles) {
				const extensionName = cfeFile.replace(/\.cfe$/i, '');
				const outputPath = path.join(cfePath, extensionName);
				const args = this.addIbcmdIfNeeded(['decompileext', extensionName, outputPath, ...ibConnectionParam]);
				commands.push(buildCommand(vrunnerPath, args, shellType));
			}
			this.executeCommandsInTerminal(commands, commandName.title, workspaceRoot, shellType);
		}
	}
}
