import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { BaseCommand } from './baseCommand';
import {
	getLoadExtensionFromSrcCommandName,
	getLoadExtensionFromCfeCommandName,
	getLoadExtensionFromFilesByListCommandName,
	getDumpExtensionToSrcCommandName,
	getDumpExtensionToCfeCommandName,
	getBuildExtensionCommandName,
	getDecompileExtensionCommandName,
	getUpdateExtensionsInInfobaseCommandName
} from '../features/tools/commandNames';
import { vanessaRunnerEpf, EPF_NAMES, EPF_COMMANDS } from '../shared/constants';
import { logger } from '../shared/logger';
import { filterCfeFilesBySelection } from '../features/extensions/extensionSelection';
import { resolveExtensionNameFromSrc } from '../features/extensions/extensionNames';
import { pickExtensions } from '../features/extensions/extensionPicker';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';
import type { VRunnerIntent } from '../shared/vrunnerCli';

const log = logger.scope('commands');

/**
 * Команды для работы с расширениями конфигурации
 * 
 * Предоставляет методы для загрузки, выгрузки, сборки и разбора расширений конфигурации 1С
 */
export class ExtensionsCommands extends BaseCommand {

	/**
	 * Выполняет команду vrunner для всех расширений
	 *
	 * Команды для всех расширений выполняются одной последовательной задачей
	 * через executeVRunnerCommandsInSequence (с учётом Docker и режима задач/терминала).
	 *
	 * @param buildIntent - Функция, которая строит намерение vrunner для одного расширения
	 *                      (получает имя каталога исходников и имя расширения из метаданных)
	 * @param commandName - Название команды для отображения
	 * @returns Промис, который разрешается после запуска всех команд
	 */
	private async executeForAllExtensions(
		buildIntent: (extensionFolder: string, extensionName: string) => VRunnerIntent,
		commandName: string,
		opts?: CommandExecutionOptions,
		commandId?: string
	): Promise<StructuredCommandResult | void> {
		const workspaceRoot = this.getExecutionCwd(opts);
		if (!workspaceRoot) {
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
		{
			const gate = await this.settingsGate(opts);
			if (gate) {
				return gate === 'blocked' ? undefined : gate;
			}
		}

		const extensionFolders = await this.getExtensionFoldersFromSrc(workspaceRoot);
		if (!extensionFolders) {
			if (opts?.wait === true) {
				return this.executionError('В каталоге расширений не найдено подкаталогов');
			}
			return;
		}

		const selectedFolders = await this.selectExtensions(extensionFolders, opts);
		if (selectedFolders === undefined) {
			// Отмена quickpick — команда не выполняется
			return;
		}
		if (selectedFolders.length === 0) {
			if (opts?.wait === true) {
				return this.executionError('Не выбрано ни одного расширения');
			}
			vscode.window.showInformationMessage('Не выбрано ни одного расширения.');
			return;
		}

		// Имя расширения берётся из метаданных исходников: оно может отличаться
		// от имени каталога (например, каталог yaxunit-test с расширением «Тесты»)
		const cfeRoot = path.join(workspaceRoot, this.vrunner.getCfePath());
		const intents = await Promise.all(selectedFolders.map(async (folder) =>
			buildIntent(folder, await resolveExtensionNameFromSrc(path.join(cfeRoot, folder)))
		));
		const steps = await this.vrunner.planIntents(intents, opts?.settingsFile);

		if (opts?.wait === true) {
			return this.runVRunnerSequential(steps, opts, commandName, commandId, true);
		}

		await this.vrunner.executeVRunnerCommandsInSequence(steps, {
			cwd: workspaceRoot,
			name: commandName,
			appendOverrides: false,
		});
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
			log.info(`В папке ${cfePath} не найдено расширений`);
			vscode.window.showInformationMessage(`В папке ${cfePath} не найдено расширений`);
			return undefined;
		}

		return extensionFolders;
	}

	/**
	 * Выбор расширений, с которыми выполнить команду.
	 *
	 * В UI-режиме показывает quickpick с чекбоксами: изначально отмечены все
	 * (либо ранее сохранённое подмножество). Выбор запоминается для проекта и
	 * подставляется при следующем запуске любой команды расширений. Если
	 * отмечены все — фильтр сбрасывается, чтобы новые расширения подхватывались
	 * автоматически.
	 *
	 * В режиме wait (MCP) quickpick не показывается — применяется сохранённый
	 * выбор (или все расширения, если выбор не задан).
	 *
	 * @param allNames - Все доступные имена расширений
	 * @param opts - Параметры выполнения (режим wait)
	 * @returns Выбранное подмножество, либо undefined при отмене quickpick
	 */
	private async selectExtensions(
		allNames: string[],
		opts?: CommandExecutionOptions
	): Promise<string[] | undefined> {
		return pickExtensions(allNames, this.vrunner.getWorkspaceMemento(), opts);
	}

	/**
	 * Выбор файлов *.cfe по выбранным расширениям (см. {@link selectExtensions}).
	 *
	 * Имя расширения берётся из имени файла без `.cfe`.
	 *
	 * @param cfeFiles - Все доступные файлы *.cfe
	 * @param opts - Параметры выполнения (режим wait)
	 * @returns Отфильтрованный список файлов, либо undefined при отмене quickpick
	 */
	private async selectCfeFiles(
		cfeFiles: string[],
		opts?: CommandExecutionOptions
	): Promise<string[] | undefined> {
		const names = [...new Set(cfeFiles.map((file) => file.replace(/\.cfe$/i, '')))];
		const selected = await this.selectExtensions(names, opts);
		if (selected === undefined) {
			return undefined;
		}
		return filterCfeFilesBySelection(cfeFiles, selected);
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
					log.debug(`Удалён временный список: ${entry.name}`);
				}
			}
		} catch {
			// каталог может отсутствовать
		}
	}

	/**
	 * Частичная загрузка расширений из objlist.txt: только пути из src/cfe/<имя>. Списки в build, удаляются при следующем запуске.
	 */
	async loadFromFilesByList(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const reject = this.rejectIfWait(
			opts,
			'Частичная загрузка расширений по objlist — несколько шагов; wait: true недоступен'
		);
		if (reject) {
			return reject;
		}

		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}
		if (!(await this.vrunner.ensureProfileSettingsFile(true))) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const buildFullPath = path.join(workspaceRoot, buildPath);
		await this.cleanupExtensionPartialLoadLists(buildFullPath);

		const objlistPath = path.join(workspaceRoot, 'objlist.txt');
		try {
			await fs.access(objlistPath);
		} catch {
			log.warn(`Файл objlist.txt не найден: ${objlistPath}`);
			vscode.window.showErrorMessage(
				'Файл objlist.txt не найден в корне проекта. Создайте файл со списком путей к объектам для загрузки.'
			);
			return;
		}

		const extensionFolders = await this.getExtensionFoldersFromSrc(workspaceRoot);
		if (!extensionFolders) {
			return;
		}

		const selectedFolders = await this.selectExtensions(extensionFolders, opts);
		if (selectedFolders === undefined) {
			// Отмена quickpick — команда не выполняется
			return;
		}
		if (selectedFolders.length === 0) {
			vscode.window.showInformationMessage('Не выбрано ни одного расширения.');
			return;
		}

		const pathsByExtension = await this.getPathsByExtensionFromObjlist(workspaceRoot, selectedFolders);
		if (pathsByExtension.size === 0) {
			log.info('В objlist.txt нет путей в каталогах расширений (src/cfe/...)');
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

		const intents: VRunnerIntent[] = [];
		const loadedExtensionNames: string[] = [];
		for (const [extensionFolder, relativePaths] of pathsByExtension) {
			const listFileName = `extension-partial-load-${extensionFolder}.txt`;
			const listFilePath = path.join(buildFullPath, listFileName);
			if (!(await this.writeListFile(listFilePath, relativePaths, `Список расширения ${extensionFolder}`))) {
				continue;
			}
			const extensionRelativePath = path.join(cfePath, extensionFolder);
			// Конфигуратору и обновлению БД нужно имя расширения из метаданных,
			// а не имя каталога исходников
			const extensionName = await resolveExtensionNameFromSrc(path.join(workspaceRoot, extensionRelativePath));
			const additionalParam = `/LoadConfigFromFiles ${this.pathForCmd(extensionRelativePath)} -Extension ${extensionName} -listFile ${listFilePrefix}${listFileName} -Format Hierarchical -partial`;
			intents.push({ kind: 'run.designer', additional: additionalParam, common: ibConnectionParam });
			loadedExtensionNames.push(extensionName);
		}

		if (intents.length === 0) {
			return;
		}

		// После загрузки файлов расширения необходимо отдельной командой обновить
		// БД для каждого расширения — vrunner updatedb обновляет только основную
		// конфигурацию, для расширений предназначена команда updateext <имя>.
		for (const extensionName of loadedExtensionNames) {
			intents.push({ kind: 'infobase.updateExtension', extensionName, common: ibConnectionParam });
		}

		const steps = await this.vrunner.planIntents(intents, opts?.settingsFile);
		await this.vrunner.executeVRunnerCommandsInSequence(steps, {
			cwd: workspaceRoot,
			name: commandName.title,
			appendOverrides: false,
		});
	}

	/**
	 * Загружает расширения из исходников в информационную базу
	 * 
	 * Находит все подпапки в папке расширений и для каждой выполняет команду `compileext`.
	 * Расширения загружаются в информационную базу, указанную в параметрах подключения.
	 * 
	 * @returns Промис, который разрешается после запуска команд
	 */
	async loadFromSrc(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getLoadExtensionFromSrcCommandName();
		const cfePath = this.vrunner.getCfePath();

		return this.executeForAllExtensions(
			(extensionFolder, extensionName) => ({
				kind: 'cfe.loadFromSrc',
				src: path.join(cfePath, extensionFolder),
				extensionName,
				// обновление БД расширения сразу после загрузки, иначе изменения
				// не применяются к ИБ
				updateDb: true,
				common: ibConnectionParam,
			}),
			commandName.title,
			opts,
			commandName.id
		);
	}

	/**
	 * Обновляет расширения в ИБ: для каждого расширения из src/cfe/<имя>
	 * выполняется `vrunner updateext <имя>`. Симметрично команде «Обновить
	 * конфигурацию в ИБ» (vrunner updatedb) для основной конфигурации.
	 */
	async updateInInfobase(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getUpdateExtensionsInInfobaseCommandName();

		return this.executeForAllExtensions(
			(_extensionFolder, extensionName) => ({ kind: 'infobase.updateExtension', extensionName, common: ibConnectionParam }),
			commandName.title,
			opts,
			commandName.id
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
	async loadFromCfe(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
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
		{
			const gate = await this.settingsGate(opts);
			if (gate) {
				return gate === 'blocked' ? undefined : gate;
			}
		}

		const buildPath = this.vrunner.getOutPath();
		const cfePath = path.join(cwd, buildPath, 'cfe');

		if (opts?.wait === true) {
			try {
				const stats = await fs.stat(cfePath);
				if (!stats.isDirectory()) {
					return this.executionError(`Каталог ${buildPath}/cfe не найден`);
				}
			} catch {
				return this.executionError(`Каталог ${buildPath}/cfe не найден`);
			}
		} else if (!(await this.checkDirectoryExists(cfePath, `Папка ${buildPath}/cfe не является директорией`))) {
			return;
		}

		const cfeFiles = await this.getFilesByExtension(cfePath, '.cfe', `Ошибка при чтении папки ${buildPath}/cfe`);
		if (cfeFiles.length === 0) {
			if (opts?.wait === true) {
				return this.executionError(`В каталоге ${buildPath}/cfe нет файлов .cfe`);
			}
			log.info(`В папке ${buildPath}/cfe не найдено файлов .cfe`);
			vscode.window.showInformationMessage(`В папке ${buildPath}/cfe не найдено файлов .cfe`);
			return;
		}

		const selectedCfeFiles = await this.selectCfeFiles(cfeFiles, opts);
		if (selectedCfeFiles === undefined) {
			// Отмена quickpick — команда не выполняется
			return;
		}
		if (selectedCfeFiles.length === 0) {
			if (opts?.wait === true) {
				return this.executionError(`В каталоге ${buildPath}/cfe нет файлов .cfe выбранных расширений`);
			}
			vscode.window.showInformationMessage('Не выбрано ни одного расширения.');
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getLoadExtensionFromCfeCommandName();
		// В 3.x обработка загрузки расширения переименована (параметр Путь= прежний).
		await this.vrunner.getVRunnerVersion();
		const epfPath = vanessaRunnerEpf(
			this.vrunner.getActiveSettingsSchema() === 'v3'
				? EPF_NAMES.LOAD_EXTENSION_V3
				: EPF_NAMES.LOAD_EXTENSION
		);
		const steps = await this.vrunner.planIntents(selectedCfeFiles.map((cfeFile) => {
			const cfeFilePath = path.join(buildPath, 'cfe', cfeFile);
			const commandParam = EPF_COMMANDS.LOAD_EXTENSION(cfeFilePath);
			return { kind: 'run.enterprise' as const, command: commandParam, execute: epfPath, common: ibConnectionParam };
		}), opts?.settingsFile);

		if (opts?.wait === true) {
			return this.runVRunnerSequential(steps, opts, commandName.title, commandName.id, true);
		}

		await this.vrunner.executeVRunnerCommandsInSequence(steps, {
			cwd,
			name: commandName.title,
		});
	}

	/**
	 * Выгружает расширения из информационной базы в исходники
	 * 
	 * Находит все подпапки в папке расширений и для каждой выполняет команду `decompileext`.
	 * Расширения выгружаются из информационной базы в исходники в формате XML.
	 * 
	 * @returns Промис, который разрешается после запуска команд
	 */
	async dumpToSrc(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getDumpExtensionToSrcCommandName();
		const cfePath = this.vrunner.getCfePath();

		return this.executeForAllExtensions(
			(extensionFolder, extensionName) => ({
				kind: 'cfe.dumpIbToSrc',
				extensionName,
				out: path.join(cfePath, extensionFolder),
				common: ibConnectionParam,
			}),
			commandName.title,
			opts,
			commandName.id
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
	async dumpToCfe(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
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

		const extensionFolders = await this.getExtensionFoldersFromSrc(cwd);
		if (!extensionFolders) {
			if (opts?.wait === true) {
				return this.executionError('В каталоге расширений не найдено подкаталогов');
			}
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const cfeBuildPath = path.join(cwd, buildPath, 'cfe');
		if (!(await this.ensureDirectoryForExecution(
			cfeBuildPath,
			opts,
			`Ошибка при создании папки ${buildPath}/cfe`
		))) {
			if (opts?.wait === true) {
				return this.executionError(`Не удалось создать каталог ${buildPath}/cfe`);
			}
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getDumpExtensionToCfeCommandName();

		return this.executeForAllExtensions(
			(extensionFolder, extensionName) => ({
				kind: 'cfe.unloadIbToCfe',
				extensionName,
				out: path.join(buildPath, 'cfe', `${extensionFolder}.cfe`),
				common: ibConnectionParam,
			}),
			commandName.title,
			opts,
			commandName.id
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
	async compile(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
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

		const extensionFolders = await this.getExtensionFoldersFromSrc(cwd);
		if (!extensionFolders) {
			if (opts?.wait === true) {
				return this.executionError('В каталоге расширений не найдено подкаталогов');
			}
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const cfeBuildPath = path.join(cwd, buildPath, 'cfe');
		if (!(await this.ensureDirectoryForExecution(
			cfeBuildPath,
			opts,
			`Ошибка при создании папки ${buildPath}/cfe`
		))) {
			if (opts?.wait === true) {
				return this.executionError(`Не удалось создать каталог ${buildPath}/cfe`);
			}
			return;
		}

		const commandName = getBuildExtensionCommandName();
		const cfePath = this.vrunner.getCfePath();

		return this.executeForAllExtensions(
			(extensionFolder, extensionName) => ({
				kind: 'cfe.buildCfe',
				src: path.join(cfePath, extensionFolder),
				out: path.join(buildPath, 'cfe', `${extensionFolder}.cfe`),
				extensionName,
			}),
			commandName.title,
			opts,
			commandName.id
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
	async decompile(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
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
		{
			const gate = await this.settingsGate(opts);
			if (gate) {
				return gate === 'blocked' ? undefined : gate;
			}
		}

		const buildPath = this.vrunner.getOutPath();
		const cfeBuildPath = path.join(cwd, buildPath, 'cfe');

		if (opts?.wait === true) {
			try {
				const stats = await fs.stat(cfeBuildPath);
				if (!stats.isDirectory()) {
					return this.executionError(`Каталог ${buildPath}/cfe не найден`);
				}
			} catch {
				return this.executionError(`Каталог ${buildPath}/cfe не найден`);
			}
		} else if (!(await this.checkDirectoryExists(cfeBuildPath, `Папка ${buildPath}/cfe не является директорией`))) {
			return;
		}

		const cfeFiles = await this.getFilesByExtension(cfeBuildPath, '.cfe', `Ошибка при чтении папки ${buildPath}/cfe`);
		if (cfeFiles.length === 0) {
			if (opts?.wait === true) {
				return this.executionError(`В каталоге ${buildPath}/cfe нет файлов .cfe`);
			}
			log.info(`В папке ${buildPath}/cfe не найдено файлов .cfe`);
			vscode.window.showInformationMessage(`В папке ${buildPath}/cfe не найдено файлов .cfe`);
			return;
		}

		const selectedCfeFiles = await this.selectCfeFiles(cfeFiles, opts);
		if (selectedCfeFiles === undefined) {
			// Отмена quickpick — команда не выполняется
			return;
		}
		if (selectedCfeFiles.length === 0) {
			if (opts?.wait === true) {
				return this.executionError(`В каталоге ${buildPath}/cfe нет файлов .cfe выбранных расширений`);
			}
			vscode.window.showInformationMessage('Не выбрано ни одного расширения.');
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getDecompileExtensionCommandName();
		const cfePath = this.vrunner.getCfePath();
		const steps = await this.vrunner.planIntents(await Promise.all(selectedCfeFiles.map(async (cfeFile) => {
			const folderName = cfeFile.replace(/\.cfe$/i, '');
			const extensionName = await resolveExtensionNameFromSrc(path.join(cwd, cfePath, folderName));
			return {
				kind: 'cfe.dumpIbToSrc' as const,
				extensionName,
				out: path.join(cfePath, folderName),
				common: ibConnectionParam,
			};
		})), opts?.settingsFile);

		if (opts?.wait === true) {
			return this.runVRunnerSequential(steps, opts, commandName.title, commandName.id, true);
		}

		await this.vrunner.executeVRunnerCommandsInSequence(steps, {
			cwd,
			name: commandName.title,
		});
	}
}
