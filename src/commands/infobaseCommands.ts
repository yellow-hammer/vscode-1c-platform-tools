import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { BaseCommand } from './baseCommand';
import {
	getCreateEmptyInfobaseCommandName,
	getUpdateConfigurationInInfobaseCommandName,
	getUpdateDatabaseCommandName,
	getBlockExternalResourcesCommandName,
	getInitializeCommandName,
	getDumpInfobaseToDtCommandName,
	getLoadInfobaseFromDtCommandName
} from '../features/tools/commandNames';
import { vanessaRunnerEpf, EPF_NAMES, EPF_COMMANDS } from '../shared/constants';
import { formatDateForDtFileName } from '../utils/dateUtils';
import { logger } from '../shared/logger';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';

const log = logger.scope('commands');

/**
 * Команды для работы с информационными базами
 */
export class InfobaseCommands extends BaseCommand {

	async createEmptyInfobase(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const cmd = getCreateEmptyInfobaseCommandName();
		return this.runIntent(
			{ kind: 'infobase.init', common: ibConnectionParam },
			opts, cmd.title, undefined, cmd.id
		);
	}

	async updateInfobase(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const cmd = getUpdateConfigurationInInfobaseCommandName();
		return this.runIntent(
			{ kind: 'infobase.updateDb', common: ibConnectionParam },
			opts, cmd.title, undefined, cmd.id
		);
	}

	async updateDatabase(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const epfPath = vanessaRunnerEpf(EPF_NAMES.CLOSE_ENTERPRISE);
		const cmd = getUpdateDatabaseCommandName();
		return this.runIntent(
			{ kind: 'run.enterprise', command: EPF_COMMANDS.UPDATE_DATABASE, execute: epfPath, common: ibConnectionParam },
			opts, cmd.title, undefined, cmd.id
		);
	}

	async blockExternalResources(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const epfPath = vanessaRunnerEpf(EPF_NAMES.BLOCK_EXTERNAL_RESOURCES);
		const cmd = getBlockExternalResourcesCommandName();
		return this.runIntent(
			{ kind: 'run.enterprise', command: EPF_COMMANDS.BLOCK_EXTERNAL_RESOURCES, execute: epfPath, common: ibConnectionParam },
			opts, cmd.title, undefined, cmd.id
		);
	}

	async initialize(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		// Инициализация отличается от обычного прогона Vanessa только сценарием:
		// его подставляем через --vanessasettings, а ИБ, путь к VA и остальное
		// берутся из активного профиля (planIntents добавит его --settings). Так
		// работает и на v2, и на v3, где файл init формата 2.x не передаётся.
		const vanessaSettings = this.vrunner.getInitVanessaSettingsPath();
		const cmd = getInitializeCommandName();
		return this.runIntent(
			{ kind: 'test.vanessa', vanessaSettings },
			opts, cmd.title, undefined, cmd.id
		);
	}

	async dumpToDt(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
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
		const dtFolder = path.join(buildPath, 'dt');
		const dtFolderFullPath = path.join(cwd, dtFolder);

		try {
			await fs.mkdir(dtFolderFullPath, { recursive: true });
		} catch (error) {
			const errMsg = (error as Error).message;
			if (opts?.wait === true) {
				return this.executionError(`Не удалось создать каталог ${dtFolder}: ${errMsg}`);
			}
			log.error(`Ошибка при создании папки ${dtFolder}: ${errMsg}`);
			vscode.window.showErrorMessage(`Ошибка при создании папки ${dtFolder}: ${errMsg}`);
			return;
		}

		const fileName = `1Cv8_${formatDateForDtFileName()}.dt`;
		const dtPath = path.join(dtFolder, fileName);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const cmd = getDumpInfobaseToDtCommandName();
		return this.runIntent(
			{ kind: 'infobase.dumpDt', out: dtPath, common: ibConnectionParam },
			opts, cmd.title, dtPath, cmd.id
		);
	}

	async loadFromDt(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const reject = this.rejectIfWait(
			opts,
			'Загрузка из .dt требует выбора файла в UI; wait: true недоступен'
		);
		if (reject) {
			return reject;
		}

		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot || !(await this.ensureOscriptAvailable())) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const dtFolder = path.join(workspaceRoot, buildPath, 'dt');

		const fileUri = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			openLabel: 'Загрузить',
			filters: { 'DT файлы': ['dt'] },
			defaultUri: vscode.Uri.file(dtFolder)
		});

		if (!fileUri || fileUri.length === 0) {
			return;
		}

		const selectedFilePath = fileUri[0].fsPath;
		const relativePath = path.relative(workspaceRoot, selectedFilePath);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const cmd = getLoadInfobaseFromDtCommandName();
		return this.runIntent(
			{ kind: 'infobase.restoreDt', file: relativePath, common: ibConnectionParam },
			opts, cmd.title, undefined, cmd.id
		);
	}
}
