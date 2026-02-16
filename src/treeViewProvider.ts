import * as vscode from 'vscode';
import { WorkspaceTasksCommands } from './commands/workspaceTasksCommands';
import { OscriptTasksCommands } from './commands/oscriptTasksCommands';
import {
	getSetVersionAllExtensionsCommandName,
	getSetVersionExtensionCommandName,
	getSetVersionReportCommandName,
	getSetVersionProcessorCommandName
} from './commandNames';
import type { SetVersionCommands } from './commands/setVersionCommands';
import { getFavorites, type FavoriteEntry } from './favorites';
import { TREE_GROUPS } from './treeStructure';

/** Ключ в globalState для сохранения состояния раскрытия групп дерева (кроме «Избранное») */
export const TREE_GROUP_EXPANDED_STATE_KEY = '1c-platform-tools.treeGroupExpanded';

/** Типы элементов дерева команд */
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
	SetVersion = 'setVersion',
	SetVersionExtensionsFolder = 'setVersionExtensionsFolder',
	SetVersionReportsFolder = 'setVersionReportsFolder',
	SetVersionProcessorsFolder = 'setVersionProcessorsFolder',
	Favorites = 'favorites',
	FavoritesConfigure = 'favoritesConfigure',
	Lightbulb = 'lightbulb',
}

/** Элемент дерева команд */
export class PlatformTreeItem extends vscode.TreeItem {
	/** Тип для отображения иконки (если задан — используется вместо type) */
	private readonly preferredIconType?: TreeItemType;

	/**
	 * Стабильный идентификатор группы (sectionType) для сохранения состояния раскрытия.
	 * Заполняется только у корневых групп, у «Избранное» не задаётся.
	 */
	public readonly groupId?: string;

	constructor(
		public readonly label: string,
		public readonly type: TreeItemType,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command,
		public readonly children?: PlatformTreeItem[],
		public readonly extensionUri?: vscode.Uri,
		preferredIconType?: TreeItemType,
		groupId?: string,
		iconCodicon?: string
	) {
		super(label, collapsibleState);
		this.preferredIconType = preferredIconType;
		this.groupId = groupId;
		this.iconPath = iconCodicon
			? new vscode.ThemeIcon(iconCodicon)
			: this.getIconPath(this.preferredIconType ?? type);
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
			case TreeItemType.SetVersion:
			case TreeItemType.SetVersionExtensionsFolder:
			case TreeItemType.SetVersionReportsFolder:
			case TreeItemType.SetVersionProcessorsFolder:
				return new vscode.ThemeIcon('tag');
			case TreeItemType.Favorites:
				return new vscode.ThemeIcon('star-full');
			case TreeItemType.FavoritesConfigure:
				return new vscode.ThemeIcon('gear');
			case TreeItemType.Lightbulb:
				return new vscode.ThemeIcon('lightbulb');
			default:
				return new vscode.ThemeIcon('circle-outline');
		}
	}
}

/**
 * Тип для события изменения дерева
 */
type TreeDataChangeEvent = PlatformTreeItem | undefined | null | void;

/** Провайдер данных дерева команд */
export class PlatformTreeDataProvider implements vscode.TreeDataProvider<PlatformTreeItem> {
	private readonly _onDidChangeTreeData: vscode.EventEmitter<TreeDataChangeEvent> =
		new vscode.EventEmitter<TreeDataChangeEvent>();
	readonly onDidChangeTreeData: vscode.Event<TreeDataChangeEvent> =
		this._onDidChangeTreeData.event;

	private readonly workspaceTasksCommands: WorkspaceTasksCommands;
	private readonly oscriptTasksCommands: OscriptTasksCommands;
	private readonly setVersionCommands?: SetVersionCommands;
	private readonly extensionUri: vscode.Uri | undefined;
	private readonly extensionContext: vscode.ExtensionContext | undefined;

	constructor(
		extensionUri?: vscode.Uri,
		setVersionCommands?: SetVersionCommands,
		extensionContext?: vscode.ExtensionContext
	) {
		this.workspaceTasksCommands = new WorkspaceTasksCommands();
		this.oscriptTasksCommands = new OscriptTasksCommands();
		this.setVersionCommands = setVersionCommands;
		this.extensionUri = extensionUri;
		this.extensionContext = extensionContext;
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
	 * @param iconType - Тип для иконки (если задан — используется вместо type)
	 * @param groupId - Идентификатор группы для сохранения состояния (только для корневых групп)
	 * @returns Созданный элемент дерева
	 */
	private createTreeItem(
		label: string,
		type: TreeItemType,
		collapsibleState: vscode.TreeItemCollapsibleState,
		command?: vscode.Command,
		children?: PlatformTreeItem[],
		iconType?: TreeItemType,
		groupId?: string,
		iconCodicon?: string
	): PlatformTreeItem {
		return new PlatformTreeItem(
			label,
			type,
			collapsibleState,
			command,
			children,
			this.extensionUri,
			iconType,
			groupId,
			iconCodicon
		);
	}

	/**
	 * Преобразует строковый тип секции (из FavoriteEntry) в TreeItemType для иконки
	 * @param sectionType - Строковый идентификатор группы
	 * @returns TreeItemType для отображения иконки группы
	 */
	private sectionTypeToIconType(sectionType: string | undefined): TreeItemType | undefined {
		if (!sectionType) {
			return undefined;
		}
		const map: Record<string, TreeItemType> = {
			infobase: TreeItemType.Infobase,
			configuration: TreeItemType.Configuration,
			extension: TreeItemType.Extension,
			externalFile: TreeItemType.ExternalFile,
			support: TreeItemType.Dependency,
			delivery: TreeItemType.Dependency,
			dependency: TreeItemType.Dependency,
			run: TreeItemType.Run,
			test: TreeItemType.Test,
			setVersion: TreeItemType.SetVersion,
			config: TreeItemType.Config,
			helpAndSupport: TreeItemType.Lightbulb,
			oscriptTasks: TreeItemType.OscriptTasks,
		};
		return map[sectionType];
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

		if (element.type === TreeItemType.SetVersionExtensionsFolder) {
			return this.getSetVersionExtensionItems();
		}

		if (element.type === TreeItemType.SetVersionReportsFolder) {
			return this.getSetVersionReportItems();
		}

		if (element.type === TreeItemType.SetVersionProcessorsFolder) {
			return this.getSetVersionProcessorItems();
		}

		return Promise.resolve(element.children || []);
	}

	/**
	 * Создаёт группу «Избранное» со списком избранных команд (иконки и префикс группы как в оригинале)
	 * @param favorites - Список избранных записей
	 * @returns Элемент дерева «Избранное» или undefined, если избранных нет
	 */
	private createFavoritesRootItem(favorites: FavoriteEntry[]): PlatformTreeItem | undefined {
		if (favorites.length === 0) {
			return undefined;
		}
		const favoriteItems = favorites.map((entry) => {
			const label = entry.groupLabel ? `${entry.groupLabel} › ${entry.title}` : entry.title;
			const iconType = this.sectionTypeToIconType(entry.sectionType);
			return this.createTreeItem(
				label,
				TreeItemType.Task,
				vscode.TreeItemCollapsibleState.None,
				{
					command: entry.command,
					title: entry.title,
					arguments: entry.arguments,
				},
				undefined,
				iconType
			);
		});
		return this.createTreeItem(
			'Избранное',
			TreeItemType.Favorites,
			vscode.TreeItemCollapsibleState.Expanded,
			undefined,
			favoriteItems
		);
	}

	/**
	 * Преобразует строковый тип секции в TreeItemType для корневого узла группы
	 * @param sectionType - Строковый идентификатор группы
	 * @returns TreeItemType для корневого элемента
	 */
	private sectionTypeToRootType(sectionType: string): TreeItemType {
		const type = this.sectionTypeToIconType(sectionType);
		return type ?? TreeItemType.Subsystem;
	}

	/**
	 * Возвращает сохранённое состояние раскрытия групп из globalState (кроме «Избранное»).
	 * @returns Объект sectionType -> true (раскрыта) / false (свёрнута)
	 */
	private getGroupExpandedState(): Record<string, boolean> {
		if (!this.extensionContext) {
			return {};
		}
		const raw = this.extensionContext.globalState.get<Record<string, boolean>>(TREE_GROUP_EXPANDED_STATE_KEY);
		return typeof raw === 'object' && raw !== null ? raw : {};
	}

	/**
	 * Определяет collapsibleState группы: сохранённое значение или значение по умолчанию
	 * @param groupId - Идентификатор группы (sectionType)
	 * @param defaultExpanded - Значение по умолчанию из TREE_GROUPS
	 * @returns Состояние для TreeItem
	 */
	private resolveGroupCollapsibleState(
		groupId: string,
		defaultExpanded: boolean
	): vscode.TreeItemCollapsibleState {
		const saved = this.getGroupExpandedState()[groupId];
		if (typeof saved === 'boolean') {
			return saved ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
		}
		return defaultExpanded
			? vscode.TreeItemCollapsibleState.Expanded
			: vscode.TreeItemCollapsibleState.Collapsed;
	}

	/**
	 * Получает корневые элементы дерева из единой структуры TREE_GROUPS и динамических узлов
	 * @returns Массив корневых элементов
	 */
	private getRootItems(): PlatformTreeItem[] {
		const allSections: PlatformTreeItem[] = [];

		for (const group of TREE_GROUPS) {
			if (group.sectionType === 'config' || group.sectionType === 'helpAndSupport') {
				continue;
			}
			const groupType = this.sectionTypeToRootType(group.sectionType);
			const defaultExpanded = group.defaultCollapsibleState === 'expanded';
			const collapsibleState = this.resolveGroupCollapsibleState(group.sectionType, defaultExpanded);

			const children: PlatformTreeItem[] = group.commands.map((cmd) =>
				this.createTreeItem(
					cmd.treeLabel,
					TreeItemType.Task,
					vscode.TreeItemCollapsibleState.None,
					{ command: cmd.command, title: cmd.title },
					undefined,
					this.sectionTypeToIconType(group.sectionType),
					undefined,
					cmd.icon
				)
			);

			if (group.sectionType === 'setVersion') {
				children.push(
					this.createTreeItem(
						'🏷️ Расширения',
						TreeItemType.SetVersionExtensionsFolder,
						vscode.TreeItemCollapsibleState.Collapsed,
						undefined,
						[]
					),
					this.createTreeItem(
						'🏷️ Внешнего отчёта',
						TreeItemType.SetVersionReportsFolder,
						vscode.TreeItemCollapsibleState.Collapsed,
						undefined,
						[]
					),
					this.createTreeItem(
						'🏷️ Внешней обработки',
						TreeItemType.SetVersionProcessorsFolder,
						vscode.TreeItemCollapsibleState.Collapsed,
						undefined,
						[]
					)
				);
			}

			allSections.push(
				this.createTreeItem(
					group.groupLabel,
					groupType,
					collapsibleState,
					undefined,
					children,
					undefined,
					group.sectionType
				)
			);
		}

		const oscriptExpanded = this.resolveGroupCollapsibleState('oscriptTasks', false) === vscode.TreeItemCollapsibleState.Expanded;
		const launchExpanded = this.resolveGroupCollapsibleState('launch', false) === vscode.TreeItemCollapsibleState.Expanded;
		allSections.push(
			this.createTreeItem(
				'Задачи (oscript)',
				TreeItemType.OscriptTasks,
				oscriptExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
				undefined,
				[],
				undefined,
				'oscriptTasks'
			),
			this.createTreeItem(
				'Задачи (workspace)',
				TreeItemType.Launch,
				launchExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
				undefined,
				[],
				undefined,
				'launch'
			)
		);

		const configGroup = TREE_GROUPS.find((g) => g.sectionType === 'config');
		if (configGroup) {
			const groupType = this.sectionTypeToRootType(configGroup.sectionType);
			const configDefaultExpanded = configGroup.defaultCollapsibleState === 'expanded';
			const collapsibleState = this.resolveGroupCollapsibleState('config', configDefaultExpanded);
			const children: PlatformTreeItem[] = configGroup.commands.map((cmd) =>
				this.createTreeItem(
					cmd.treeLabel,
					TreeItemType.Task,
					vscode.TreeItemCollapsibleState.None,
					{ command: cmd.command, title: cmd.title },
					undefined,
					this.sectionTypeToIconType(configGroup.sectionType),
					undefined,
					cmd.icon
				)
			);
			allSections.push(
				this.createTreeItem(
					configGroup.groupLabel,
					groupType,
					collapsibleState,
					undefined,
					children,
					undefined,
					'config'
				)
			);
		}

		const helpAndSupportGroup = TREE_GROUPS.find((g) => g.sectionType === 'helpAndSupport');
		if (helpAndSupportGroup) {
			const groupType = this.sectionTypeToRootType(helpAndSupportGroup.sectionType);
			const defaultExpanded = helpAndSupportGroup.defaultCollapsibleState === 'expanded';
			const collapsibleState = this.resolveGroupCollapsibleState('helpAndSupport', defaultExpanded);
			const children: PlatformTreeItem[] = helpAndSupportGroup.commands.map((cmd) =>
				this.createTreeItem(
					cmd.treeLabel,
					TreeItemType.Task,
					vscode.TreeItemCollapsibleState.None,
					{ command: cmd.command, title: cmd.title },
					undefined,
					this.sectionTypeToIconType(helpAndSupportGroup.sectionType),
					undefined,
					cmd.icon
				)
			);
			allSections.push(
				this.createTreeItem(
					helpAndSupportGroup.groupLabel,
					groupType,
					collapsibleState,
					undefined,
					children,
					undefined,
					'helpAndSupport'
				)
			);
		}

		const favorites = this.extensionContext ? getFavorites(this.extensionContext) : [];
		const favoritesRoot = this.createFavoritesRootItem(favorites);
		return favoritesRoot ? [favoritesRoot, ...allSections] : allSections;
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

	/**
	 * Получает элементы дерева «Расширения»: пункт «Все» и список каталогов в src/cfe
	 * @returns Промис, который разрешается массивом элементов дерева
	 */
	private async getSetVersionExtensionItems(): Promise<PlatformTreeItem[]> {
		if (!this.setVersionCommands) {
			return [];
		}
		try {
			const items: PlatformTreeItem[] = [
				this.createTreeItem(
					'Все',
					TreeItemType.Task,
					vscode.TreeItemCollapsibleState.None,
					{
						command: '1c-platform-tools.setVersion.allExtensions',
						title: getSetVersionAllExtensionsCommandName().title,
					}
				)
			];
			const names = await this.setVersionCommands.getExtensionFoldersForTree();
			if (names.length === 0) {
				items.push(
					this.createTreeItem(
						'Нет расширений в src/cfe',
						TreeItemType.Info,
						vscode.TreeItemCollapsibleState.None
					)
				);
			} else {
				for (const name of names) {
					items.push(
						this.createTreeItem(
							name,
							TreeItemType.Task,
							vscode.TreeItemCollapsibleState.None,
							{
								command: '1c-platform-tools.setVersion.extension',
								title: getSetVersionExtensionCommandName(name).title,
								arguments: [name],
							}
						)
					);
				}
			}
			return items;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return [
				this.createTreeItem(
					`Ошибка загрузки расширений: ${errorMessage}`,
					TreeItemType.Info,
					vscode.TreeItemCollapsibleState.None
				)
			];
		}
	}

	/**
	 * Получает элементы дерева «Внешнего отчёта» (каталоги в src/erf)
	 * @returns Промис, который разрешается массивом элементов дерева
	 */
	private async getSetVersionReportItems(): Promise<PlatformTreeItem[]> {
		if (!this.setVersionCommands) {
			return [];
		}
		try {
			const names = await this.setVersionCommands.getReportFoldersForTree();
			if (names.length === 0) {
				return [
					this.createTreeItem(
						'Нет отчётов в src/erf',
						TreeItemType.Info,
						vscode.TreeItemCollapsibleState.None
					)
				];
			}
			return names.map((name) =>
				this.createTreeItem(
					name,
					TreeItemType.Task,
					vscode.TreeItemCollapsibleState.None,
					{
						command: '1c-platform-tools.setVersion.report',
						title: getSetVersionReportCommandName(name).title,
						arguments: [name],
					}
				)
			);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return [
				this.createTreeItem(
					`Ошибка загрузки отчётов: ${errorMessage}`,
					TreeItemType.Info,
					vscode.TreeItemCollapsibleState.None
				)
			];
		}
	}

	/**
	 * Получает элементы дерева «Внешней обработки» (каталоги в src/epf)
	 * @returns Промис, который разрешается массивом элементов дерева
	 */
	private async getSetVersionProcessorItems(): Promise<PlatformTreeItem[]> {
		if (!this.setVersionCommands) {
			return [];
		}
		try {
			const names = await this.setVersionCommands.getProcessorFoldersForTree();
			if (names.length === 0) {
				return [
					this.createTreeItem(
						'Нет обработок в src/epf',
						TreeItemType.Info,
						vscode.TreeItemCollapsibleState.None
					)
				];
			}
			return names.map((name) =>
				this.createTreeItem(
					name,
					TreeItemType.Task,
					vscode.TreeItemCollapsibleState.None,
					{
						command: '1c-platform-tools.setVersion.processor',
						title: getSetVersionProcessorCommandName(name).title,
						arguments: [name],
					}
				)
			);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return [
				this.createTreeItem(
					`Ошибка загрузки обработок: ${errorMessage}`,
					TreeItemType.Info,
					vscode.TreeItemCollapsibleState.None
				)
			];
		}
	}
}
