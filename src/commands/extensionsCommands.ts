import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { BaseCommand, INFOBASE_BUSY } from './baseCommand';
import type { VRunnerExecutionResult } from '../shared/vrunnerManager';
import {
	getLoadExtensionFromSrcCommandName,
	getConvertExtensionSourcesCommandName,
	getLoadExtensionFromCfeCommandName,
	getLoadExtensionFromFilesByListCommandName,
	getDumpExtensionToSrcCommandName,
	getDumpExtensionToCfeCommandName,
	getBuildExtensionCommandName,
	getBuildTestExtensionsCommandName,
	getDumpTestExtensionsCommandName,
	getDecompileTestExtensionsCommandName,
	getLoadTestExtensionsCommandName,
	getDecompileExtensionCommandName,
	getUpdateExtensionsInInfobaseCommandName
} from '../features/tools/commandNames';
import { vanessaRunnerEpf, EPF_NAMES, EPF_COMMANDS } from '../shared/constants';
import { logger } from '../shared/logger';
import {
	filterCfeFilesBySelection,
	normalizeConfiguredExtensions
} from '../features/extensions/extensionSelection';
import { resolveExtensionNameFromSrc } from '../features/extensions/extensionNames';
import { pickExtensions } from '../features/extensions/extensionPicker';
import { parseInfobaseExtensionsList } from '../features/extensions/infobaseExtensionsList';
import {
	isUsableExtensionFolderName,
	resolveDumpTargets,
	type DiskExtension,
	type ExtensionDumpTarget
} from '../features/extensions/extensionDumpTargets';
import { decideUpdateDb } from '../features/configuration/updateDbDecision';
import type { ExtensionScope } from '../features/extensions/extensionSelection';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';
import type { VRunnerIntent } from '../shared/vrunnerCli';
import { BUILD_SUBDIRS } from '../shared/pathDefaults';
import { VRUNNER_FEATURES, isAtLeast } from '../shared/vrunnerVersion';

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
	protected async executeForAllExtensions(
		buildIntent: (extensionSource: string, extensionName: string, extensionFolder: string) => VRunnerIntent,
		commandName: string,
		opts?: CommandExecutionOptions,
		commandId?: string,
		sourcesRoot?: string,
		scope: ExtensionScope = 'solution'
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

		const sources = await this.resolveExtensionSources(workspaceRoot, sourcesRoot);
		if (!sources) {
			if (opts?.wait === true) {
				return this.executionError('В каталоге расширений не найдено подкаталогов');
			}
			return;
		}
		const { root, folders: extensionFolders } = sources;

		const selectedFolders = await this.selectExtensions(extensionFolders, opts, scope);
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
		// от имени каталога (например, каталог yaxunit-test с расширением «Тесты»).
		// Корень тот же, из которого взяли каталоги: у тестовых расширений он свой
		const cfeRoot = path.join(workspaceRoot, root);
		const intents = await Promise.all(selectedFolders.map(async (folder) => {
			// В формате EDT базой служит корень рабочей области, а каталогом - сам проект
			const source = root === '.' ? folder : `${root}/${folder}`;
			return buildIntent(source, await resolveExtensionNameFromSrc(path.join(cfeRoot, folder)), folder);
		}));
		// Через общий путь, а не своим планированием: он же освобождает базу
		// на время команд конфигуратора и возвращает её после
		return this.runIntentsSequential(intents, opts, commandName, commandId);
	}

	/**
	 * Получает список папок расширений из исходников
	 * @param workspaceRoot - Корневая директория workspace
	 * @param cfePath - Корень исходников расширений относительно workspace
	 * @returns Промис, который разрешается массивом имен папок расширений или undefined при ошибке
	 */
	private async getExtensionFoldersFromSrc(
		workspaceRoot: string,
		cfePath: string
	): Promise<string[] | undefined> {
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
	 * Каталог расширений и их подкаталоги для команд над исходниками.
	 *
	 * В формате конфигуратора расширения лежат подкаталогами настроенного пути,
	 * в формате EDT - отдельными проектами рабочей области. Во втором случае
	 * базой становится корень рабочей области, а «подкаталогом» - каталог
	 * проекта, поэтому остальной код команд не меняется.
	 *
	 * @param workspaceRoot - Корень рабочей области
	 * @param sourcesRoot - Каталог расширений, если задан явно
	 * @returns База и список каталогов расширений или undefined, если их нет
	 */
	private async resolveExtensionSources(
		workspaceRoot: string,
		sourcesRoot?: string
	): Promise<{ root: string; folders: string[] } | undefined> {
		if (sourcesRoot === undefined) {
			const edtProjects = (await this.activeExtensions()).filter((item) => item.format === 'edt');
			if (edtProjects.length > 0) {
				return { root: '.', folders: edtProjects.map((item) => item.dir) };
			}
		}

		const root = sourcesRoot ?? this.vrunner.getCfePath();
		const folders = await this.getExtensionFoldersFromSrc(workspaceRoot, root);
		return folders ? { root, folders } : undefined;
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
		opts?: CommandExecutionOptions,
		scope: ExtensionScope = 'solution'
	): Promise<string[] | undefined> {
		return pickExtensions(allNames, this.vrunner.getWorkspaceMemento(), opts, scope);
	}

	/**
	 * Выбор файлов *.cfe по выбранным расширениям (см. {@link selectExtensions}).
	 *
	 * Имя расширения берётся из имени файла без `.cfe`.
	 *
	 * @param cfeFiles - Все доступные файлы *.cfe
	 * @param opts - Параметры выполнения (режим wait)
	 * @param scope - Область расширений: решение или тестовые
	 * @returns Отфильтрованный список файлов, либо undefined при отмене quickpick
	 */
	private async selectCfeFiles(
		cfeFiles: string[],
		opts?: CommandExecutionOptions,
		scope: ExtensionScope = 'solution'
	): Promise<string[] | undefined> {
		const names = [...new Set(cfeFiles.map((file) => file.replace(/\.cfe$/i, '')))];
		const selected = await this.selectExtensions(names, opts, scope);
		if (selected === undefined) {
			return undefined;
		}
		return filterCfeFilesBySelection(cfeFiles, selected);
	}

	/**
	 * Каталоги расширений на диске: пустой список, если корня ещё нет.
	 * Сообщение «не найдено» здесь не показывается — выгрузка из ИБ сама
	 * заведёт папки по списку базы.
	 */
	private async listDiskExtensions(
		workspaceRoot: string,
		cfePath: string
	): Promise<DiskExtension[]> {
		const root = path.join(workspaceRoot, cfePath);
		try {
			const stats = await fs.stat(root);
			if (!stats.isDirectory()) {
				return [];
			}
		} catch {
			return [];
		}

		const folders = await this.getDirectories(root);
		const disk: DiskExtension[] = [];
		for (const folder of folders) {
			disk.push({
				folder,
				extensionName: await resolveExtensionNameFromSrc(path.join(root, folder))
			});
		}
		return disk;
	}

	/**
	 * Сообщает, почему выгрузку из ИБ нельзя начать: агенту — структурой,
	 * пользователю — коротким окном.
	 */
	private reportExportPrepareFailure(
		message: string,
		opts: CommandExecutionOptions | undefined,
		level: 'info' | 'error'
	): StructuredCommandResult | undefined {
		if (opts?.wait === true) {
			return this.executionError(message);
		}
		if (level === 'error') {
			void vscode.window.showErrorMessage(message);
		} else {
			void vscode.window.showInformationMessage(message);
		}
		return undefined;
	}

	/**
	 * Читает имена установленных расширений из информационной базы.
	 *
	 * В 3.x — `infobase extensions list --json`. В 2.x — выгрузка всех
	 * расширений конфигуратором (`-AllExtensions`) и имена каталогов.
	 */
	private async listExtensionNamesFromInfobase(
		workspaceRoot: string,
		opts: CommandExecutionOptions | undefined
	): Promise<{ names: string[] } | { error: string; level: 'info' | 'error' }> {
		const version = await this.vrunner.getVRunnerVersion();
		const viaDesigner = version === undefined || !isAtLeast(version, VRUNNER_FEATURES.cli3);
		const listRel = this.pathForCmd(path.join(this.vrunner.getOutPath(), 'cfe-ib-list'));
		const listAbs = path.join(workspaceRoot, listRel);

		if (viaDesigner) {
			try {
				await fs.rm(listAbs, { recursive: true, force: true });
				await fs.mkdir(listAbs, { recursive: true });
			} catch (error) {
				log.error(`Каталог списка расширений: ${(error as Error).message}`);
				return { error: 'Не удалось прочитать список расширений из базы', level: 'error' };
			}
		}

		try {
			return await this.runExtensionsListCommand(workspaceRoot, listRel, listAbs, viaDesigner, opts);
		} finally {
			if (viaDesigner) {
				// Выгрузка ради имён весит столько же, сколько сами расширения
				await fs.rm(listAbs, { recursive: true, force: true }).catch((error: Error) => {
					log.debug(`Каталог списка расширений не удалён: ${error.message}`);
				});
			}
		}
	}

	/**
	 * Выполняет команду списка расширений и разбирает её результат.
	 *
	 * @param listRel - Каталог выгрузки относительно корня проекта (нужен 2.x)
	 * @param listAbs - Он же абсолютным путём
	 * @param viaDesigner - Список снимается конфигуратором (vanessa-runner 2.x)
	 */
	private async runExtensionsListCommand(
		workspaceRoot: string,
		listRel: string,
		listAbs: string,
		viaDesigner: boolean,
		opts: CommandExecutionOptions | undefined
	): Promise<{ names: string[] } | { error: string; level: 'info' | 'error' }> {
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const intent: VRunnerIntent = {
			kind: 'infobase.listExtensions',
			json: true,
			out: listRel,
			common: ibConnectionParam
		};
		const steps = await this.vrunner.planIntent(intent, opts?.settingsFile, opts?.ibConnection);
		this.vrunner.consumePlanNotices();
		if (steps.length !== 1) {
			return { error: 'Не удалось прочитать список расширений из базы', level: 'error' };
		}

		const window = await this.openInfobaseWindow([intent], opts);
		if (window === 'blocked') {
			return { error: INFOBASE_BUSY, level: 'error' };
		}

		const run = () => this.vrunner.executeVRunner(steps[0], { cwd: workspaceRoot });

		let result: VRunnerExecutionResult;
		try {
			result = opts?.wait === true
				? await run()
				: await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: 'Читаю список расширений из базы'
					},
					run
				);
		} finally {
			await window.restore?.();
		}

		if (!result.success) {
			log.error(
				`Список расширений из ИБ: ${(result.stderr || result.stdout).trim().slice(0, 500)}`
			);
			return { error: 'Не удалось прочитать список расширений из базы', level: 'error' };
		}

		try {
			const names = viaDesigner
				? await this.extensionNamesFromDumpDir(listAbs)
				: parseInfobaseExtensionsList(`${result.stdout}\n${result.stderr}`);
			log.info(
				names.length > 0
					? `Из информационной базы: ${names.join(', ')}`
					: 'В информационной базе нет расширений'
			);
			return { names };
		} catch (error) {
			log.error(`Список расширений из ИБ: ${(error as Error).message}`);
			return { error: 'Не удалось разобрать список расширений из базы', level: 'error' };
		}
	}

	/** Имена расширений — подкаталоги выгрузки `-AllExtensions`. */
	private async extensionNamesFromDumpDir(dir: string): Promise<string[]> {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
			.map((entry) => entry.name);
	}

	/**
	 * Имена для выгрузки, когда в исходниках ещё нет каталогов:
	 * настройка `cfe.selected` или список из информационной базы.
	 */
	private async namesWhenSourcesEmpty(
		workspaceRoot: string,
		opts: CommandExecutionOptions | undefined
	): Promise<string[] | StructuredCommandResult | undefined> {
		const configured = normalizeConfiguredExtensions(
			vscode.workspace.getConfiguration('1c-platform-tools').get('cfe.selected')
		);
		if (configured.length > 0) {
			return configured;
		}

		const listed = await this.listExtensionNamesFromInfobase(workspaceRoot, opts);
		if ('error' in listed) {
			return this.reportExportPrepareFailure(listed.error, opts, listed.level);
		}
		if (listed.names.length === 0) {
			return this.reportExportPrepareFailure(
				'В информационной базе нет расширений',
				opts,
				'info'
			);
		}
		return this.selectExtensions(listed.names, opts);
	}

	/**
	 * Создаёт корень и недостающие каталоги расширений. Существующие не трогает.
	 *
	 * @returns undefined — каталоги готовы; иначе причина отказа
	 */
	private async createMissingExtensionFolders(
		workspaceRoot: string,
		cfePath: string,
		targets: readonly ExtensionDumpTarget[],
		opts: CommandExecutionOptions | undefined
	): Promise<string | undefined> {
		const root = path.join(workspaceRoot, cfePath);
		if (!(await this.ensureDirectoryForExecution(root, opts, `Ошибка при создании папки ${cfePath}`))) {
			return `Не удалось создать каталог ${cfePath}`;
		}
		for (const target of targets) {
			const dir = path.join(root, target.folder);
			if (await this.ensureDirectoryForExecution(
				dir,
				opts,
				`Ошибка при создании папки ${cfePath}/${target.folder}`
			)) {
				continue;
			}
			return `Не удалось создать каталог ${cfePath}/${target.folder}`;
		}
		return undefined;
	}

	/**
	 * Собирает цели выгрузки из ИБ: каталоги на диске и, если их нет,
	 * имена из настройки, параметра или самой базы.
	 *
	 * @param createFolders - Создать недостающие каталоги (выгрузка в исходники)
	 */
	private async prepareTargetsForIbExport(
		workspaceRoot: string,
		cfePath: string,
		opts: CommandExecutionOptions | undefined,
		createFolders: boolean
	): Promise<ExtensionDumpTarget[] | StructuredCommandResult | undefined> {
		const disk = await this.listDiskExtensions(workspaceRoot, cfePath);
		// Явные имена от агента задают цели сами: среди них могут быть расширения
		// базы, каталога под которые ещё нет, и отбор по диску их бы потерял
		const explicit = normalizeConfiguredExtensions(opts?.extensions);
		let selected: string[] | StructuredCommandResult | undefined;
		if (explicit.length > 0) {
			selected = explicit;
		} else if (disk.length > 0) {
			selected = await this.selectExtensions(disk.map((item) => item.folder), opts);
		} else {
			selected = await this.namesWhenSourcesEmpty(workspaceRoot, opts);
		}
		if (selected === undefined || !Array.isArray(selected)) {
			return selected;
		}
		if (selected.length === 0) {
			if (opts?.wait === true) {
				return this.executionError('Не выбрано ни одного расширения');
			}
			void vscode.window.showInformationMessage('Не выбрано ни одного расширения.');
			return undefined;
		}

		const targets = resolveDumpTargets(disk, selected);
		const invalid = targets.find((target) => !isUsableExtensionFolderName(target.folder));
		if (invalid !== undefined) {
			return this.reportExportPrepareFailure(
				`Нельзя создать каталог «${invalid.folder}»`,
				opts,
				'error'
			);
		}

		if (createFolders) {
			const failure = await this.createMissingExtensionFolders(workspaceRoot, cfePath, targets, opts);
			if (failure !== undefined) {
				// В UI-режиме сообщение уже показал ensureDirectoryForExecution
				return opts?.wait === true ? this.executionError(failure) : undefined;
			}
		}

		return targets;
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

		const extensionFolders = await this.getExtensionFoldersFromSrc(
			workspaceRoot,
			this.vrunner.getCfePath()
		);
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
		await this.runPlanned(steps, intents, {
			cwd: workspaceRoot,
			name: commandName.title,
			appendOverrides: false,
		});
	}

	/**
	 * Конвертирует исходники расширения между форматами EDT и конфигуратора.
	 *
	 * Расширение выбирается среди тех, что относятся к активной конфигурации;
	 * формат источника определяет сам vanessa-runner.
	 *
	 * @param opts - Опции выполнения
	 */
	async convertExtensionSources(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const version = await this.vrunner.getVRunnerVersion();
		if (version !== undefined && !isAtLeast(version, VRUNNER_FEATURES.edtSources)) {
			return this.reportUnavailable(
				'Конвертация исходников между форматами появилась в vanessa-runner 3.0.0-rc8.',
				opts
			);
		}

		const extensions = await this.activeExtensions();
		if (extensions.length === 0) {
			return this.reportUnavailable('В рабочей области нет исходников расширений.', opts);
		}

		const selected = extensions.length === 1
			? extensions[0]
			: (await vscode.window.showQuickPick(
				extensions.map((extension) => ({ label: extension.name, description: extension.dir, extension })),
				{ title: 'Расширение для конвертации', placeHolder: 'Исходники какого расширения конвертировать' }
			))?.extension;
		if (!selected) {
			return;
		}

		const defaultOut = path.join(this.vrunner.getOutPath(), 'cfe-converted', selected.name);
		const outputPath = opts?.wait === true
			? defaultOut
			: await this.pickOutputPath(defaultOut, 'Каталог для конвертированных исходников');
		if (!outputPath) {
			return;
		}

		const commandName = getConvertExtensionSourcesCommandName();
		return this.runIntent(
			{ kind: 'cfe.convert', src: selected.dir, out: outputPath, extensionName: selected.name },
			opts, commandName.title, outputPath, commandName.id
		);
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

		const updateDb = await decideUpdateDb(opts);
		if (updateDb === undefined) {
			return;
		}

		return this.executeForAllExtensions(
			(extensionSource, extensionName, extensionFolder) => ({
				kind: 'cfe.loadFromSrc',
				src: extensionSource,
				extensionName,
				updateDb,
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
		const cfePath = path.join(cwd, buildPath, BUILD_SUBDIRS.cfe);

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
		const intents = selectedCfeFiles.map((cfeFile) => {
			const cfeFilePath = path.join(buildPath, BUILD_SUBDIRS.cfe, cfeFile);
			const commandParam = EPF_COMMANDS.LOAD_EXTENSION(cfeFilePath);
			return { kind: 'run.enterprise' as const, command: commandParam, execute: epfPath, common: ibConnectionParam };
		});

		return this.runIntentsSequential(intents, opts, commandName.title, commandName.id);
	}

	/**
	 * Общие проверки перед выгрузкой из ИБ: корень проекта, oscript, файл настроек.
	 *
	 * @returns Путь проекта, результат ошибки для агента или undefined
	 */
	private async beginIbExport(
		opts: CommandExecutionOptions | undefined
	): Promise<string | StructuredCommandResult | undefined> {
		const cwd = this.getExecutionCwd(opts);
		if (!cwd) {
			if (opts?.wait === true) {
				return this.executionError(
					'Укажите projectPath или откройте рабочую область с проектом 1С'
				);
			}
			this.ensureWorkspace();
			return undefined;
		}
		if (!(await this.ensureOscriptForExecution(opts))) {
			return opts?.wait === true
				? this.executionError('OneScript (oscript) или opm не найдены')
				: undefined;
		}
		const gate = await this.settingsGate(opts);
		if (gate) {
			return gate === 'blocked' ? undefined : gate;
		}
		return cwd;
	}

	/**
	 * Выгружает расширения из информационной базы в исходники
	 *
	 * Если в каталоге расширений уже есть подпапки — выгружает выбранные.
	 * Если каталог пустой (проект только что инициализирован), берёт имена
	 * из информационной базы, создаёт недостающие папки и выгружает в них.
	 *
	 * @returns Промис, который разрешается после запуска команд
	 */
	async dumpToSrc(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const started = await this.beginIbExport(opts);
		if (started === undefined || typeof started !== 'string') {
			return started;
		}

		const cfePath = this.vrunner.getCfePath();
		const prepared = await this.prepareTargetsForIbExport(started, cfePath, opts, true);
		if (prepared === undefined || !Array.isArray(prepared)) {
			return prepared;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getDumpExtensionToSrcCommandName();
		return this.runIntentsSequential(
			prepared.map((target) => ({
				kind: 'cfe.dumpIbToSrc' as const,
				extensionName: target.extensionName,
				out: path.join(cfePath, target.folder),
				common: ibConnectionParam
			})),
			opts,
			commandName.title,
			commandName.id
		);
	}

	/**
	 * Выгружает расширение из информационной базы в .cfe файл
	 *
	 * Если в исходниках есть каталоги — выгружает выбранные. Если каталогов
	 * нет, берёт имена из информационной базы: для *.cfe папки исходников
	 * не нужны.
	 *
	 * @returns Промис, который разрешается после запуска команд
	 */
	async dumpToCfe(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const started = await this.beginIbExport(opts);
		if (started === undefined || typeof started !== 'string') {
			return started;
		}

		const prepared = await this.prepareTargetsForIbExport(
			started,
			this.vrunner.getCfePath(),
			opts,
			false
		);
		if (prepared === undefined || !Array.isArray(prepared)) {
			return prepared;
		}

		const buildPath = this.vrunner.getOutPath();
		const cfeBuildPath = path.join(started, buildPath, BUILD_SUBDIRS.cfe);
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
		return this.runIntentsSequential(
			prepared.map((target) => ({
				kind: 'cfe.unloadIbToCfe' as const,
				extensionName: target.extensionName,
				out: path.join(buildPath, BUILD_SUBDIRS.cfe, `${target.folder}.cfe`),
				common: ibConnectionParam
			})),
			opts,
			commandName.title,
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

		const extensionFolders = await this.getExtensionFoldersFromSrc(cwd, this.vrunner.getCfePath());
		if (!extensionFolders) {
			if (opts?.wait === true) {
				return this.executionError('В каталоге расширений не найдено подкаталогов');
			}
			return;
		}

		const buildPath = this.vrunner.getOutPath();
		const cfeBuildPath = path.join(cwd, buildPath, BUILD_SUBDIRS.cfe);
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

		return this.executeForAllExtensions(
			(extensionSource, extensionName, extensionFolder) => ({
				kind: 'cfe.buildCfe',
				src: extensionSource,
				out: path.join(buildPath, BUILD_SUBDIRS.cfe, `${path.basename(extensionFolder)}.cfe`),
				extensionName,
			}),
			commandName.title,
			opts,
			commandName.id
		);
	}

	/**
	 * Загружает тестовые расширения в ИБ из исходников.
	 *
	 * Тестовые расширения живут отдельно от решения (`<path.tests>/cfe`,
	 * по умолчанию `tests/cfe`): сам YAxUnit и расширение с тестами - обычные
	 * подкаталоги там же. Показывается тот же выбор, что и у расширений
	 * решения, поэтому можно подключить только тесты или только инструмент.
	 *
	 * @param opts - Опции выполнения
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async loadTestsFromSrc(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getLoadTestExtensionsCommandName();
		const testsCfePath = this.vrunner.getTestsCfePath();

		return this.executeForAllExtensions(
			(extensionSource, extensionName, extensionFolder) => ({
				kind: 'cfe.loadFromSrc',
				src: extensionSource,
				extensionName,
				updateDb: true,
				common: ibConnectionParam,
			}),
			commandName.title,
			opts,
			commandName.id,
			testsCfePath,
			'tests'
		);
	}

	/**
	 * Собирает тестовые расширения из исходников в *.cfe.
	 *
	 * Как и у тестовых обработок, собранное кладётся в каталог результатов
	 * сборки и в репозиторий не попадает.
	 *
	 * @param opts - Опции выполнения
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async buildTests(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const commandName = getBuildTestExtensionsCommandName();
		const testsCfePath = this.vrunner.getTestsCfePath();
		const buildPath = this.vrunner.getOutPath();

		return this.executeForAllExtensions(
			(extensionSource, extensionName, extensionFolder) => ({
				kind: 'cfe.buildCfe',
				src: extensionSource,
				out: path.join(buildPath, BUILD_SUBDIRS.testsCfe, `${path.basename(extensionFolder)}.cfe`),
				extensionName,
			}),
			commandName.title,
			opts,
			commandName.id,
			testsCfePath,
			'tests'
		);
	}

	/**
	 * Выгружает установленные тестовые расширения из ИБ в исходники.
	 *
	 * Нужно для первичного переноса существующего расширения с тестами под
	 * контроль версий - как «Разобрать unit тесты» у обработок.
	 *
	 * @param opts - Опции выполнения
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async dumpTestsToSrc(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getDumpTestExtensionsCommandName();
		const testsCfePath = this.vrunner.getTestsCfePath();

		return this.executeForAllExtensions(
			(extensionSource, extensionName, extensionFolder) => ({
				kind: 'cfe.dumpIbToSrc',
				extensionName,
				out: path.join(testsCfePath, extensionFolder),
				common: ibConnectionParam,
			}),
			commandName.title,
			opts,
			commandName.id,
			testsCfePath,
			'tests'
		);
	}

	/**
	 * Разбирает собранные тестовые *.cfe в исходники.
	 *
	 * Берёт файлы из каталога сборки тестовых расширений и раскладывает каждый
	 * в свой подкаталог корня тестов (`<path.tests>/cfe`). Разбирается сам файл, а не то, что
	 * установлено в ИБ: так подключают полученный со стороны YAxUnit.cfe.
	 *
	 * @param opts - Опции выполнения
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async decompileTests(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
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
		const buildDir = path.posix.join(buildPath.replace(/\\/g, '/'), BUILD_SUBDIRS.testsCfe);
		const cfeBuildPath = path.join(cwd, buildPath, BUILD_SUBDIRS.testsCfe);

		if (opts?.wait === true) {
			try {
				const stats = await fs.stat(cfeBuildPath);
				if (!stats.isDirectory()) {
					return this.executionError(`Каталог ${buildDir} не найден`);
				}
			} catch {
				return this.executionError(`Каталог ${buildDir} не найден`);
			}
		} else if (!(await this.checkDirectoryExists(cfeBuildPath, `Папка ${buildDir} не является директорией`))) {
			return;
		}

		const cfeFiles = await this.getFilesByExtension(cfeBuildPath, '.cfe', `Ошибка при чтении папки ${buildDir}`);
		if (cfeFiles.length === 0) {
			if (opts?.wait === true) {
				return this.executionError(`В каталоге ${buildDir} нет файлов .cfe`);
			}
			log.info(`В папке ${buildDir} не найдено файлов .cfe`);
			vscode.window.showInformationMessage(`В папке ${buildDir} не найдено файлов .cfe`);
			return;
		}

		const selectedCfeFiles = await this.selectCfeFiles(cfeFiles, opts, 'tests');
		if (selectedCfeFiles === undefined) {
			// Отмена quickpick — команда не выполняется
			return;
		}
		if (selectedCfeFiles.length === 0) {
			if (opts?.wait === true) {
				return this.executionError(`В каталоге ${buildDir} нет файлов .cfe выбранных расширений`);
			}
			vscode.window.showInformationMessage('Не выбрано ни одного расширения.');
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getDecompileTestExtensionsCommandName();
		const testsCfePath = this.vrunner.getTestsCfePath();
		const intents = await Promise.all(selectedCfeFiles.map(async (cfeFile) => {
			const folderName = cfeFile.replace(/\.cfe$/i, '');
			const extensionName = await resolveExtensionNameFromSrc(path.join(cwd, testsCfePath, folderName));
			return {
				kind: 'cfe.decompileCfeFile' as const,
				file: this.pathForCmd(path.join(buildPath, BUILD_SUBDIRS.testsCfe, cfeFile)),
				extensionName,
				out: this.pathForCmd(path.join(testsCfePath, folderName)),
				common: ibConnectionParam,
			};
		}));

		return this.runIntentsSequential(intents, opts, commandName.title, commandName.id);
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
		const cfeBuildPath = path.join(cwd, buildPath, BUILD_SUBDIRS.cfe);

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
		const intents = await Promise.all(selectedCfeFiles.map(async (cfeFile) => {
			const folderName = cfeFile.replace(/\.cfe$/i, '');
			const extensionName = await resolveExtensionNameFromSrc(path.join(cwd, cfePath, folderName));
			return {
				kind: 'cfe.dumpIbToSrc' as const,
				extensionName,
				out: path.join(cfePath, folderName),
				common: ibConnectionParam,
			};
		}));

		return this.runIntentsSequential(intents, opts, commandName.title, commandName.id);
	}
}
