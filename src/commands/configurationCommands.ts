import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { BaseCommand } from './baseCommand';
import {
	getLoadConfigurationFromSrcCommandName,
	getLoadConfigurationFromCfCommandName,
	getDumpConfigurationToSrcCommandName,
	getDumpConfigurationIncrementToSrcCommandName,
	getDumpConfigurationToCfCommandName,
	getDumpConfigurationToDistCommandName,
	getBuildConfigurationCommandName,
	getDecompileConfigurationCommandName,
	getLoadConfigurationIncrementFromSrcCommandName,
	getLoadConfigurationFromFilesByListCommandName
} from '../features/tools/commandNames';
import {
	checkVersionFileExists,
	handleMissingVersionFile
} from '../utils/configVersionUtils';
import { logger } from '../shared/logger';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';

const log = logger.scope('commands');

/**
 * Команды для работы с конфигурацией
 */
export class ConfigurationCommands extends BaseCommand {

	async loadFromSrc(
		mode: 'init' | 'update' = 'update',
		opts?: CommandExecutionOptions
	): Promise<StructuredCommandResult | void> {
		const command = mode === 'init' ? 'init-dev' : 'update-dev';
		const srcPath = this.vrunner.getCfPath();
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = this.addIbcmdIfNeeded([command, '--src', srcPath, ...ibConnectionParam]);
		const commandName = getLoadConfigurationFromSrcCommandName(mode);
		return this.runVRunner(args, opts, commandName.title, undefined, commandName.id);
	}

	async loadFromCf(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const buildPath = this.vrunner.getOutPath();
		const cfFilePath = path.join(buildPath, '1Cv8.cf');
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		// `vrunner load` загружает .cf в конфигурацию, но не обновляет БД —
		// цепляем updatedb, иначе изменения не применяются к ИБ.
		const loadArgs = this.addIbcmdIfNeeded(['load', '--src', cfFilePath, ...ibConnectionParam]);
		const updateDbArgs = this.addIbcmdIfNeeded(['updatedb', ...ibConnectionParam]);
		const loadFromCfCmd = getLoadConfigurationFromCfCommandName();
		return this.runVRunnerSequential(
			[loadArgs, updateDbArgs],
			opts,
			loadFromCfCmd.title,
			loadFromCfCmd.id
		);
	}

	async dumpToSrc(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const srcPath = this.vrunner.getCfPath();
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = this.addIbcmdIfNeeded(['decompile', '--current', '--out', srcPath, ...ibConnectionParam]);
		const dumpToSrcCmd = getDumpConfigurationToSrcCommandName();
		return this.runVRunner(args, opts, dumpToSrcCmd.title, undefined, dumpToSrcCmd.id);
	}

	async dumpIncrementToSrc(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
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

		const srcPath = this.vrunner.getCfPath();
		const srcFullPath = path.join(cwd, srcPath);
		const configDumpInfoPath = path.join(srcFullPath, 'ConfigDumpInfo.xml');
		const versionFileExists = await checkVersionFileExists(configDumpInfoPath);

		if (!versionFileExists) {
			if (opts?.wait === true) {
				return this.executionError(
					'ConfigDumpInfo.xml не найден. Сначала выполните полную выгрузку (dumpToSrc)'
				);
			}
			if (!(await handleMissingVersionFile(srcFullPath, srcPath))) {
				return;
			}
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args: string[] = ['decompile', '--current', '--out', srcPath, ...ibConnectionParam];
		if (versionFileExists) {
			args.push('--versions', path.join(srcPath, 'ConfigDumpInfo.xml'));
		}
		const dumpIncrCmd = getDumpConfigurationIncrementToSrcCommandName();
		return this.runVRunner(
			this.addIbcmdIfNeeded(args),
			opts,
			dumpIncrCmd.title,
			undefined,
			dumpIncrCmd.id
		);
	}

	async dumpToCf(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
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

		const buildPath = this.vrunner.getOutPath();
		const buildFullPath = path.join(cwd, buildPath);
		if (!(await this.ensureDirectoryForExecution(
			buildFullPath,
			opts,
			`Ошибка при создании папки ${buildPath}`
		))) {
			if (opts?.wait === true) {
				return this.executionError(`Не удалось создать каталог ${buildPath}`);
			}
			return;
		}

		const outputPath = path.join(buildPath, '1Cv8.cf');
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = this.addIbcmdIfNeeded(['unload', outputPath, ...ibConnectionParam]);
		const dumpToCfCmd = getDumpConfigurationToCfCommandName();
		return this.runVRunner(
			args,
			opts,
			dumpToCfCmd.title,
			outputPath,
			dumpToCfCmd.id
		);
	}

	async dumpToDist(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
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

		const buildPath = this.vrunner.getOutPath();
		const buildFullPath = path.join(cwd, buildPath);
		if (!(await this.ensureDirectoryForExecution(
			buildFullPath,
			opts,
			`Ошибка при создании папки ${buildPath}`
		))) {
			if (opts?.wait === true) {
				return this.executionError(`Не удалось создать каталог ${buildPath}`);
			}
			return;
		}

		const outputPath = path.join(buildPath, '1Cv8dist.cf');
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['make-dist', outputPath, ...ibConnectionParam];
		const dumpToDistCmd = getDumpConfigurationToDistCommandName();
		return this.runVRunner(
			args,
			opts,
			dumpToDistCmd.title,
			outputPath,
			dumpToDistCmd.id
		);
	}

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

		const srcPath = this.vrunner.getCfPath();
		const buildPath = this.vrunner.getOutPath();
		const buildFullPath = path.join(cwd, buildPath);
		if (!(await this.ensureDirectoryForExecution(
			buildFullPath,
			opts,
			`Ошибка при создании папки ${buildPath}`
		))) {
			if (opts?.wait === true) {
				return this.executionError(`Не удалось создать каталог ${buildPath}`);
			}
			return;
		}

		const outputPath = path.join(buildPath, '1Cv8.cf');
		const args = this.addIbcmdIfNeeded(['compile', '--src', srcPath, '--out', outputPath]);
		const buildCmd = getBuildConfigurationCommandName();
		return this.runVRunner(args, opts, buildCmd.title, outputPath, buildCmd.id);
	}

	async decompile(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const buildPath = this.vrunner.getOutPath();
		const inputPath = path.join(buildPath, '1Cv8.cf');
		const srcPath = this.vrunner.getCfPath();
		const args = this.addIbcmdIfNeeded(['decompile', '--in', inputPath, '--out', srcPath]);
		const decompileCmd = getDecompileConfigurationCommandName();
		return this.runVRunner(args, opts, decompileCmd.title, undefined, decompileCmd.id);
	}

	async loadIncrementFromSrc(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const reject = this.rejectIfWait(
			opts,
			'Инкрементальная загрузка требует ввода SHA в UI; wait: true недоступен'
		);
		if (reject) {
			return reject;
		}

		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}

		const srcPath = this.vrunner.getCfPath();
		const lastUploadedCommitPath = path.join(workspaceRoot, srcPath, 'lastUploadedCommit.txt');

		let currentSha = '';
		try {
			const content = await fs.readFile(lastUploadedCommitPath, 'utf-8');
			currentSha = content.trim();
		} catch {
			// полная загрузка
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
			const errMsg = (error as Error).message;
			log.error(`Не удалось записать SHA в файл ${lastUploadedCommitPath}: ${errMsg}`);
			vscode.window.showErrorMessage(
				`Не удалось записать SHA в файл ${lastUploadedCommitPath}: ${errMsg}`
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
		const loadIncrCmd = getLoadConfigurationIncrementFromSrcCommandName();
		return this.runVRunner(args, opts, loadIncrCmd.title, undefined, loadIncrCmd.id);
	}

	async loadFromFilesByList(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const reject = this.rejectIfWait(
			opts,
			'Загрузка по objlist.txt требует подготовки списка в UI; wait: true недоступен'
		);
		if (reject) {
			return reject;
		}

		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}

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

		const srcPath = this.vrunner.getCfPath();
		const configFullPath = path.resolve(workspaceRoot, srcPath);
		const content = await fs.readFile(objlistPath, 'utf-8');
		const lines = this.parseObjlistLines(content);
		const configRelativePaths: string[] = [];
		for (const line of lines) {
			const fullPath = this.resolveObjlistLine(workspaceRoot, line);
			if (this.pathUnderBase(configFullPath, fullPath)) {
				const rel = this.relativePathSlash(configFullPath, fullPath);
				if (!configRelativePaths.includes(rel)) {
					configRelativePaths.push(rel);
				}
			}
		}

		if (configRelativePaths.length === 0) {
			log.info('В objlist.txt нет путей в каталоге конфигурации (src/cf)');
			vscode.window.showInformationMessage(
				'В objlist.txt нет путей из каталога конфигурации (src/cf). Для расширений используйте команду «Загрузить из objlist.txt» в разделе «Расширения».'
			);
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const buildFullPath = path.join(workspaceRoot, buildPath);
		if (!(await this.ensureDirectoryExists(buildFullPath, `Ошибка при создании каталога ${buildPath}`))) {
			return;
		}

		const listFileName = 'objlist-config.txt';
		const listFilePath = path.join(buildFullPath, listFileName);
		if (!(await this.writeListFile(listFilePath, configRelativePaths, `Список конфигурации ${listFilePath}`))) {
			return;
		}

		const listFileForCmd = this.pathForCmd(buildPath) + '/' + listFileName;
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const additionalParam = `/LoadConfigFromFiles ${this.pathForCmd(srcPath)} -listFile ${listFileForCmd}`;
		// Частичная загрузка через designer /LoadConfigFromFiles не обновляет БД,
		// поэтому отдельно цепляем updatedb.
		const designerArgs = this.addIbcmdIfNeeded(['designer', '--additional', additionalParam, ...ibConnectionParam]);
		const updateDbArgs = this.addIbcmdIfNeeded(['updatedb', ...ibConnectionParam]);

		const loadByListCmd = getLoadConfigurationFromFilesByListCommandName();
		return this.runVRunnerSequential(
			[designerArgs, updateDbArgs],
			opts,
			loadByListCmd.title,
			loadByListCmd.id
		);
	}
}
