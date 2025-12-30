import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { BaseCommand } from './baseCommand';
import {
	getCreateEmptyInfobaseCommandName,
	getUpdateDatabaseCommandName,
	getBlockExternalResourcesCommandName,
	getInitializeCommandName,
	getDumpInfobaseToDtCommandName,
	getLoadInfobaseFromDtCommandName
} from '../commandNames';
import { VANESSA_RUNNER_ROOT, VANESSA_RUNNER_EPF, EPF_NAMES, EPF_COMMANDS } from '../constants';
import { formatDateForDtFileName } from '../utils/dateUtils';

/**
 * Команды для работы с информационными базами
 */
export class InfobaseCommands extends BaseCommand {

	/**
	 * Создает пустую информационную базу
	 * Выполняет команду vrunner init-dev с параметром --ibconnection из env.json
	 * @returns Промис, который разрешается после запуска команды
	 */
	async createEmptyInfobase(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = this.addIbcmdIfNeeded(['init-dev', ...ibConnectionParam]);
		const commandName = getCreateEmptyInfobaseCommandName();

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Выполняет постобработку обновления информационной базы
	 * Выполняет команду vrunner run с обработкой ЗакрытьПредприятие.epf
	 * @returns Промис, который разрешается после запуска команды
	 */
	async updateDatabase(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getUpdateDatabaseCommandName();
		const epfPath = path.join(VANESSA_RUNNER_ROOT, VANESSA_RUNNER_EPF, EPF_NAMES.CLOSE_ENTERPRISE);

		const args = [
			'run',
			'--command',
			EPF_COMMANDS.UPDATE_DATABASE,
			'--execute',
			epfPath,
			...ibConnectionParam
		];

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Запрещает работу с внешними ресурсами
	 * Выполняет команду vrunner run с обработкой БлокировкаРаботыСВнешнимиРесурсами.epf
	 * @returns Промис, который разрешается после запуска команды
	 */
	async blockExternalResources(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getBlockExternalResourcesCommandName();
		const epfPath = path.join(VANESSA_RUNNER_ROOT, VANESSA_RUNNER_EPF, EPF_NAMES.BLOCK_EXTERNAL_RESOURCES);

		const args = [
			'run',
			'--command',
			EPF_COMMANDS.BLOCK_EXTERNAL_RESOURCES,
			'--execute',
			epfPath,
			...ibConnectionParam
		];

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Инициализирует информационную базу
	 * Выполняет команду vrunner vanessa с настройками из файла инициализации
	 * @returns Промис, который разрешается после запуска команды
	 */
	async initialize(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getInitializeCommandName();
		const settingsPath = this.vrunner.getVRunnerInitSettingsPath();

		const args = [
			'vanessa',
			'--settings',
			settingsPath,
			...ibConnectionParam
		];

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Выгружает информационную базу в dt-файл
	 * Формирует имя файла в формате: 1Cv8_YYYYMMDD_HHMMSS.dt
	 * @returns Промис, который разрешается после запуска команды
	 */
	async dumpToDt(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const dtFolder = path.join(buildPath, 'dt');
		const dtFolderFullPath = path.join(workspaceRoot, dtFolder);

		try {
			await fs.mkdir(dtFolderFullPath, { recursive: true });
		} catch (error) {
			vscode.window.showErrorMessage(`Ошибка при создании папки ${dtFolder}: ${(error as Error).message}`);
			return;
		}

		const fileName = `1Cv8_${formatDateForDtFileName()}.dt`;
		const dtPath = path.join(dtFolder, fileName);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getDumpInfobaseToDtCommandName();
		const args = this.addIbcmdIfNeeded(['dump', dtPath, ...ibConnectionParam]);

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Загружает информационную базу из dt-файла
	 * Предлагает окно для выбора dt-файла
	 * @returns Промис, который разрешается после выбора файла и запуска команды
	 */
	async loadFromDt(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const dtFolder = path.join(workspaceRoot, buildPath, 'dt');

		const fileUri = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			openLabel: 'Загрузить',
			filters: {
				'DT файлы': ['dt']
			},
			defaultUri: vscode.Uri.file(dtFolder)
		});

		if (!fileUri || fileUri.length === 0) {
			return;
		}

		const selectedFilePath = fileUri[0].fsPath;
		const relativePath = path.relative(workspaceRoot, selectedFilePath);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getLoadInfobaseFromDtCommandName();
		const args = this.addIbcmdIfNeeded(['restore', relativePath, ...ibConnectionParam]);

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}
}
