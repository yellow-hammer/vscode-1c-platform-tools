import * as vscode from 'vscode';
import { WorkspaceTasksCommands } from './commands/workspaceTasksCommands';
import { OscriptTasksCommands } from './commands/oscriptTasksCommands';
import {
	getCreateEmptyInfobaseCommandName,
	getUpdateDatabaseCommandName,
	getBlockExternalResourcesCommandName,
	getInitializeCommandName,
	getDumpInfobaseToDtCommandName,
	getLoadInfobaseFromDtCommandName,
	getInstallDependenciesCommandName,
	getRemoveDependenciesCommandName,
	getInitializePackagedefCommandName,
	getLoadConfigurationFromSrcCommandName,
	getLoadConfigurationIncrementFromSrcCommandName,
	getLoadConfigurationFromFilesByListCommandName,
	getLoadConfigurationFromCfCommandName,
	getDumpConfigurationToSrcCommandName,
	getDumpConfigurationIncrementToSrcCommandName,
	getDumpConfigurationToCfCommandName,
	getDumpConfigurationToDistCommandName,
	getBuildConfigurationCommandName,
	getDecompileConfigurationCommandName,
	getLoadExtensionFromSrcCommandName,
	getLoadExtensionFromCfeCommandName,
	getDumpExtensionToSrcCommandName,
	getDumpExtensionToCfeCommandName,
	getBuildExtensionCommandName,
	getDecompileExtensionCommandName,
	getBuildExternalProcessorCommandName,
	getDecompileExternalProcessorCommandName,
	getBuildExternalReportCommandName,
	getDecompileExternalReportCommandName,
	getClearCacheCommandName,
	getRunEnterpriseCommandName,
	getRunDesignerCommandName,
	getXUnitTestsCommandName,
	getSyntaxCheckCommandName,
	getVanessaTestsCommandName,
	getAllureReportCommandName
} from './commandNames';

/**
 * Типы элементов дерева команд в панели 1C Platform Tools
 */
export enum TreeItemType {
	Task = 'task',
	Dependency = 'dependency',
	Config = 'config',
	File = 'file',
	Info = 'info',
	Infobase = 'infobase',
	Build = 'build',
	Decompile = 'decompile',
	Run = 'run',
	Test = 'test',
	Launch = 'launch',
	OscriptTasks = 'oscriptTasks',
	Subsystem = 'subsystem',
	Configuration = 'configuration',
	Extension = 'extension',
	ExternalFile = 'externalFile',
}

/**
 * Элемент дерева для 1C Platform Tools
 */
export class PlatformTreeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly type: TreeItemType,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command,
		public readonly children?: PlatformTreeItem[],
		public readonly extensionUri?: vscode.Uri
	) {
		super(label, collapsibleState);

		this.iconPath = this.getIconPath(type);
		this.contextValue = type;
	}

	/**
	 * Получает путь к иконке для типа элемента
	 * @param type - Тип элемента дерева
	 * @returns Путь к иконке или ThemeIcon
	 */
	private getIconPath(type: TreeItemType): vscode.ThemeIcon | vscode.Uri | undefined {
		switch (type) {
			case TreeItemType.Task:
				return new vscode.ThemeIcon('play');
			case TreeItemType.Dependency:
				return new vscode.ThemeIcon('package');
			case TreeItemType.Config:
				return new vscode.ThemeIcon('gear');
			case TreeItemType.File:
				return new vscode.ThemeIcon('file');
			case TreeItemType.Info:
				return new vscode.ThemeIcon('info');
			case TreeItemType.Infobase:
				return new vscode.ThemeIcon('database');
			case TreeItemType.Build:
				return new vscode.ThemeIcon('tools');
			case TreeItemType.Decompile:
				return new vscode.ThemeIcon('unlock');
			case TreeItemType.Run:
				return new vscode.ThemeIcon('play-circle');
			case TreeItemType.Test:
				return new vscode.ThemeIcon('beaker');
			case TreeItemType.Launch:
			case TreeItemType.OscriptTasks:
				return new vscode.ThemeIcon('rocket');
			case TreeItemType.Subsystem:
				if (this.extensionUri) {
					return vscode.Uri.joinPath(this.extensionUri, 'resources', '1c-icon.svg');
				}
				return new vscode.ThemeIcon('circle-outline');
			case TreeItemType.Configuration:
				return new vscode.ThemeIcon('file-code');
			case TreeItemType.Extension:
				return new vscode.ThemeIcon('file-code');
			case TreeItemType.ExternalFile:
				return new vscode.ThemeIcon('file-code');
			default:
				return new vscode.ThemeIcon('circle-outline');
		}
	}
}

/**
 * Тип для события изменения дерева
 */
type TreeDataChangeEvent = PlatformTreeItem | undefined | null | void;

/**
 * Провайдер данных для дерева 1C Platform Tools
 */
export class PlatformTreeDataProvider implements vscode.TreeDataProvider<PlatformTreeItem> {
	private readonly _onDidChangeTreeData: vscode.EventEmitter<TreeDataChangeEvent> =
		new vscode.EventEmitter<TreeDataChangeEvent>();
	readonly onDidChangeTreeData: vscode.Event<TreeDataChangeEvent> =
		this._onDidChangeTreeData.event;

	private readonly workspaceTasksCommands: WorkspaceTasksCommands;
	private readonly oscriptTasksCommands: OscriptTasksCommands;
	private readonly extensionUri: vscode.Uri | undefined;

	constructor(extensionUri?: vscode.Uri) {
		this.workspaceTasksCommands = new WorkspaceTasksCommands();
		this.oscriptTasksCommands = new OscriptTasksCommands();
		this.extensionUri = extensionUri;
	}

	/**
	 * Обновляет дерево команд
	 */
	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	/**
	 * Получает элемент дерева для отображения
	 * @param element - Элемент дерева
	 * @returns Элемент дерева VS Code
	 */
	getTreeItem(element: PlatformTreeItem): vscode.TreeItem {
		return element;
	}

	/**
	 * Создает элемент дерева
	 * @param label - Метка элемента
	 * @param type - Тип элемента
	 * @param collapsibleState - Состояние сворачивания
	 * @param command - Команда для выполнения
	 * @param children - Дочерние элементы
	 * @returns Созданный элемент дерева
	 */
	private createTreeItem(
		label: string,
		type: TreeItemType,
		collapsibleState: vscode.TreeItemCollapsibleState,
		command?: vscode.Command,
		children?: PlatformTreeItem[]
	): PlatformTreeItem {
		return new PlatformTreeItem(label, type, collapsibleState, command, children, this.extensionUri);
	}

	/**
	 * Получает дочерние элементы дерева
	 * @param element - Родительский элемент (undefined для корня)
	 * @returns Промис, который разрешается массивом дочерних элементов
	 */
	getChildren(element?: PlatformTreeItem): Thenable<PlatformTreeItem[]> {
		if (!element) {
			return Promise.resolve(this.getRootItems());
		}

		if (element.type === TreeItemType.Launch) {
			return this.getWorkspaceTasks();
		}

		if (element.type === TreeItemType.OscriptTasks) {
			return this.getOscriptTasks();
		}

		return Promise.resolve(element.children || []);
	}

	/**
	 * Получает корневые элементы дерева
	 * @returns Массив корневых элементов
	 */
	private getRootItems(): PlatformTreeItem[] {
		return [
			this.createTreeItem(
				'Информационные базы',
				TreeItemType.Infobase,
				vscode.TreeItemCollapsibleState.Collapsed,
				undefined,
				[
					this.createTreeItem(
						'➕ Создать пустую ИБ',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.infobase.createEmpty',
							title: getCreateEmptyInfobaseCommandName().title,
						}
					),
					this.createTreeItem(
						'🔄 Постобработка обновления',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.infobase.updateDatabase',
							title: getUpdateDatabaseCommandName().title,
						}
					),
					this.createTreeItem(
						'🚫 Запретить работу с внешними ресурсами',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.infobase.blockExternalResources',
							title: getBlockExternalResourcesCommandName().title,
						}
					),
					this.createTreeItem(
						'🚀 Инициализировать данные',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.infobase.initialize',
							title: getInitializeCommandName().title,
						}
					),
					this.createTreeItem(
						'📤 Выгрузить в dt',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.infobase.dumpToDt',
							title: getDumpInfobaseToDtCommandName().title,
						}
					),
					this.createTreeItem(
						'📥 Загрузить из dt',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.infobase.loadFromDt',
							title: getLoadInfobaseFromDtCommandName().title,
						}
					),
				]
			),
			this.createTreeItem(
				'Конфигурация',
				TreeItemType.Configuration,
				vscode.TreeItemCollapsibleState.Expanded,
				undefined,
				[
					this.createTreeItem(
						'📥 Загрузить из src/cf',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.configuration.loadFromSrc',
							title: getLoadConfigurationFromSrcCommandName().title,
						}
					),
					this.createTreeItem(
						'📥 Загрузить изменения (git diff)',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.configuration.loadIncrementFromSrc',
							title: getLoadConfigurationIncrementFromSrcCommandName().title,
						}
					),
					this.createTreeItem(
						'📥 Загрузить из objlist.txt',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.configuration.loadFromFilesByList',
							title: getLoadConfigurationFromFilesByListCommandName().title,
						}
					),
					this.createTreeItem(
						'📥 Загрузить из 1Cv8.cf',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.configuration.loadFromCf',
							title: getLoadConfigurationFromCfCommandName().title,
						}
					),
					this.createTreeItem(
						'📤 Выгрузить в src/cf',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.configuration.dumpToSrc',
							title: getDumpConfigurationToSrcCommandName().title,
						}
					),
					this.createTreeItem(
						'📤 Выгрузить изменения в src/cf',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.configuration.dumpIncrementToSrc',
							title: getDumpConfigurationIncrementToSrcCommandName().title,
						}
					),
					this.createTreeItem(
						'📤 Выгрузить в 1Cv8.cf',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.configuration.dumpToCf',
							title: getDumpConfigurationToCfCommandName().title,
						}
					),
					this.createTreeItem(
						'📦 Выгрузить файл поставки в 1Cv8dist.cf',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.configuration.dumpToDist',
							title: getDumpConfigurationToDistCommandName().title,
						}
					),
					this.createTreeItem(
						'🔨 Собрать 1Cv8.cf из src/cf',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.configuration.build',
							title: getBuildConfigurationCommandName().title,
						}
					),
					this.createTreeItem(
						'🔓 Разобрать 1Cv8.cf в src/cf',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.configuration.decompile',
							title: getDecompileConfigurationCommandName().title,
						}
					),
				]
			),
			this.createTreeItem(
				'Расширения',
				TreeItemType.Extension,
				vscode.TreeItemCollapsibleState.Expanded,
				undefined,
				[
					this.createTreeItem(
						'📥 Загрузить из src/cfe',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.extensions.loadFromSrc',
							title: getLoadExtensionFromSrcCommandName().title,
						}
					),
					this.createTreeItem(
						'📥 Загрузить из *.cfe',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.extensions.loadFromCfe',
							title: getLoadExtensionFromCfeCommandName().title,
						}
					),
					this.createTreeItem(
						'📤 Выгрузить в src/cfe',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.extensions.dumpToSrc',
							title: getDumpExtensionToSrcCommandName().title,
						}
					),
					this.createTreeItem(
						'📤 Выгрузить в *.cfe',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.extensions.dumpToCfe',
							title: getDumpExtensionToCfeCommandName().title,
						}
					),
					this.createTreeItem(
						'🔨 Собрать *.cfe из src/cfe',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.extensions.build',
							title: getBuildExtensionCommandName().title,
						}
					),
					this.createTreeItem(
						'🔓 Разобрать *.cfe в src/cfe',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.extensions.decompile',
							title: getDecompileExtensionCommandName().title,
						}
					),
				]
			),
			this.createTreeItem(
				'Внешние файлы',
				TreeItemType.ExternalFile,
				vscode.TreeItemCollapsibleState.Collapsed,
				undefined,
				[
					this.createTreeItem(
						'🔨 Собрать внешнюю обработку',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.externalProcessors.build',
							title: getBuildExternalProcessorCommandName().title,
						}
					),
					this.createTreeItem(
						'🔨 Собрать внешний отчет',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.externalReports.build',
							title: getBuildExternalReportCommandName().title,
						}
					),
					this.createTreeItem(
						'🔓 Разобрать внешнюю обработку',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.externalProcessors.decompile',
							title: getDecompileExternalProcessorCommandName().title,
						}
					),
					this.createTreeItem(
						'🔓 Разобрать внешний отчет',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.externalReports.decompile',
							title: getDecompileExternalReportCommandName().title,
						}
					),
					this.createTreeItem(
						'🗑️ Очистить кэш',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.externalFiles.clearCache',
							title: getClearCacheCommandName().title,
						}
					),
				]
			),
			this.createTreeItem(
				'Зависимости',
				TreeItemType.Dependency,
				vscode.TreeItemCollapsibleState.Collapsed,
				undefined,
				[
					this.createTreeItem(
						'📝 Инициализировать packagedef',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.dependencies.initializePackagedef',
							title: getInitializePackagedefCommandName().title,
						}
					),
					this.createTreeItem(
						'📦 Установить зависимости',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.dependencies.install',
							title: getInstallDependenciesCommandName().title,
						}
					),
					this.createTreeItem(
						'🗑️ Удалить зависимости',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.dependencies.remove',
							title: getRemoveDependenciesCommandName().title,
						}
					),
				]
			),
			this.createTreeItem(
				'Запуск',
				TreeItemType.Run,
				vscode.TreeItemCollapsibleState.Expanded,
				undefined,
				[
					this.createTreeItem(
						'▶️ Запустить Предприятие',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.run.enterprise',
							title: getRunEnterpriseCommandName().title,
						}
					),
					this.createTreeItem(
						'▶️ Запустить Конфигуратор',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.run.designer',
							title: getRunDesignerCommandName().title,
						}
					),
				]
			),
			this.createTreeItem(
				'Тестирование',
				TreeItemType.Test,
				vscode.TreeItemCollapsibleState.Collapsed,
				undefined,
				[
					this.createTreeItem(
						'🧪 XUnit тесты',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.test.xunit',
							title: getXUnitTestsCommandName().title,
						}
					),
					this.createTreeItem(
						'🧪 Синтаксический контроль',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.test.syntaxCheck',
							title: getSyntaxCheckCommandName().title,
						}
					),
					this.createTreeItem(
						'🧪 Vanessa тесты',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.test.vanessa',
							title: getVanessaTestsCommandName('normal').title,
						}
					),
					this.createTreeItem(
						'📊 Allure отчет',
						TreeItemType.Task,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.test.allure',
							title: getAllureReportCommandName().title,
						}
					),
				]
			),
			this.createTreeItem(
				'Задачи (oscript)',
				TreeItemType.OscriptTasks,
				vscode.TreeItemCollapsibleState.Collapsed,
				undefined,
				[]
			),
			this.createTreeItem(
				'Задачи (workspace)',
				TreeItemType.Launch,
				vscode.TreeItemCollapsibleState.Collapsed,
				undefined,
				[]
			),
			this.createTreeItem(
				'Конфигурации запуска',
				TreeItemType.Config,
				vscode.TreeItemCollapsibleState.Collapsed,
				undefined,
				[
					this.createTreeItem(
						'📄 env.json',
						TreeItemType.File,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.config.env.edit',
							title: 'Открыть env.json',
						}
					),
					this.createTreeItem(
						'📄 launch.json',
						TreeItemType.File,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.launch.editConfigurations',
							title: 'Открыть launch.json',
						}
					),
				]
			),
		];
	}

	/**
	 * Получает задачи workspace из tasks.json и launch.json
	 * @returns Промис, который разрешается массивом элементов дерева с задачами
	 */
	private async getWorkspaceTasks(): Promise<PlatformTreeItem[]> {
		const items: PlatformTreeItem[] = [
			this.createTreeItem(
				'➕ Добавить задачу',
				TreeItemType.Task,
				vscode.TreeItemCollapsibleState.None,
				{
					command: '1c-platform-tools.launch.edit',
					title: 'Добавить задачу',
				}
			),
		];

		try {
			const tasks = await this.workspaceTasksCommands.getTasks();
			for (const task of tasks) {
				items.push(
					this.createTreeItem(
						`▶️ ${task.label}`,
						TreeItemType.Launch,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.launch.run',
							title: 'Запустить задачу',
							arguments: [task.label],
						}
					)
				);
			}

			const launchConfigs = await this.workspaceTasksCommands.getLaunchConfigurations();
			for (const config of launchConfigs) {
				items.push(
					this.createTreeItem(
						`🚀 ${config.name}`,
						TreeItemType.Launch,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.launch.run',
							title: 'Запустить конфигурацию',
							arguments: [config.name],
						}
					)
				);
			}

			if (items.length === 1) {
				items.push(
					this.createTreeItem(
						'Нет задач',
						TreeItemType.Info,
						vscode.TreeItemCollapsibleState.None
					)
				);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			items.push(
				this.createTreeItem(
					`Ошибка загрузки задач: ${errorMessage}`,
					TreeItemType.Info,
					vscode.TreeItemCollapsibleState.None
				)
			);
		}

		return items;
	}

	/**
	 * Получает задачи oscript из каталога tasks (файлы *.os)
	 * @returns Промис, который разрешается массивом элементов дерева с задачами
	 */
	private async getOscriptTasks(): Promise<PlatformTreeItem[]> {
		const items: PlatformTreeItem[] = [
			this.createTreeItem(
				'➕ Добавить задачу',
				TreeItemType.Task,
				vscode.TreeItemCollapsibleState.None,
				{
					command: '1c-platform-tools.oscript.addTask',
					title: 'Добавить задачу',
				}
			),
		];

		try {
			const tasks = await this.oscriptTasksCommands.getOscriptTasks();
			for (const task of tasks) {
				items.push(
					this.createTreeItem(
						`▶️ ${task.name}`,
						TreeItemType.Launch,
						vscode.TreeItemCollapsibleState.None,
						{
							command: '1c-platform-tools.oscript.run',
							title: 'Запустить задачу oscript',
							arguments: [task.name],
						}
					)
				);
			}

			if (items.length === 1) {
				items.push(
					this.createTreeItem(
						'Нет файлов *.os в каталоге tasks',
						TreeItemType.Info,
						vscode.TreeItemCollapsibleState.None
					)
				);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			items.push(
				this.createTreeItem(
					`Ошибка загрузки задач: ${errorMessage}`,
					TreeItemType.Info,
					vscode.TreeItemCollapsibleState.None
				)
			);
		}

		return items;
	}
}
