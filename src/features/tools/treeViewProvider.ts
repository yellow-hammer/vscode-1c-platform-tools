import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fsSync from 'node:fs';
import { WorkspaceTasksCommands } from '../../commands/workspaceTasksCommands';
import { OscriptTasksCommands } from '../../commands/oscriptTasksCommands';
import { SERVICE_FILES, resolveLaunchProfileSpec, serviceFilesWatchGlob } from '../serviceFiles/registry';
import { VRunnerManager } from '../../shared/vrunnerManager';
import {
	getSetVersionReportCommandName,
	getSetVersionProcessorCommandName,
	getOpenPipelineEditorCommandName,
	getOpenHooksEditorCommandName
} from './commandNames';
import { readPipelines } from '../../shared/pipelines/pipelineFile';
import { PIPELINE_TEMPLATE_ID_PREFIX } from '../../shared/pipelines/pipelineTemplates';
import { stepsWord } from '../../shared/pipelines/pipelineTypes';
import { readHooks, describeHookEntry, HOOKS_WILDCARD } from '../../shared/hooks/hooksModel';
import { commandTitle } from '../../shared/commandCatalog';
import type { SetVersionCommands } from '../../commands/setVersionCommands';
import { getFavorites, type FavoriteEntry } from './favorites';
import { getHiddenToolGroups } from './toolsGroupVisibility';
import {
	TREE_GROUPS,
	favoriteVisibleFor,
	groupCommandsFor,
	groupVisibleFor,
	treeCommandLabel,
	treeTraitsOf,
	type TreeProjectTrait,
	type TreeSourceFormat,
} from './treeStructure';
import { configurationScope } from '../../shared/activeConfiguration';
import { onDidChangeProjectLayout } from '../../shared/projectLayoutWatch';
import { currentRoot, onDidChangeCurrentProject, onDidChangeProjects, projectByRoot } from '../../shared/workspaceProjects';

/** Ключ в globalState для сохранения состояния раскрытия групп дерева */
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
	Pipelines = 'pipelines',
	PipelineEntry = 'pipelineEntry',
	Hooks = 'hooks',
	Editor = 'editor',
	Subsystem = 'subsystem',
	Configuration = 'configuration',
	Extension = 'extension',
	ExternalFile = 'externalFile',
	SetVersion = 'setVersion',
	SetVersionReportsFolder = 'setVersionReportsFolder',
	SetVersionProcessorsFolder = 'setVersionProcessorsFolder',
	Favorites = 'favorites',
	FavoritesConfigure = 'favoritesConfigure',
	Lightbulb = 'lightbulb',
	Skills = 'skills',
	Edt = 'edt',
}

/** Элемент дерева команд */
export class PlatformTreeItem extends vscode.TreeItem {
	/** Идентификатор пайплайна: для кнопки запуска в строке дерева */
	public pipelineId?: string;

	/** Тип для отображения иконки (если задан — используется вместо type) */
	private readonly preferredIconType?: TreeItemType;

	/**
	 * Стабильный идентификатор группы (sectionType) для сохранения состояния раскрытия.
	 * Заполняется у корневых групп, включая «Избранное».
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
	private getIconPath(
		type: TreeItemType
	): vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } | undefined {
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
					return {
						light: vscode.Uri.joinPath(this.extensionUri, 'resources', '1c-icon.svg'),
						dark: vscode.Uri.joinPath(this.extensionUri, 'resources', '1c-icon-dark.svg'),
					};
				}
				return new vscode.ThemeIcon('circle-outline');
			case TreeItemType.Configuration:
				return new vscode.ThemeIcon('file-code');
			case TreeItemType.Extension:
				return new vscode.ThemeIcon('file-code');
			case TreeItemType.ExternalFile:
				return new vscode.ThemeIcon('file-code');
			case TreeItemType.SetVersion:
			case TreeItemType.SetVersionReportsFolder:
			case TreeItemType.SetVersionProcessorsFolder:
				return new vscode.ThemeIcon('tag');
			case TreeItemType.Favorites:
				return new vscode.ThemeIcon('star-full');
			case TreeItemType.FavoritesConfigure:
				return new vscode.ThemeIcon('gear');
			case TreeItemType.Lightbulb:
				return new vscode.ThemeIcon('lightbulb');
			case TreeItemType.Skills:
				return new vscode.ThemeIcon('sparkle');
			case TreeItemType.Edt:
				return new vscode.ThemeIcon('code');
			case TreeItemType.Pipelines:
				return new vscode.ThemeIcon('run-all');
			case TreeItemType.PipelineEntry:
				return new vscode.ThemeIcon('circuit-board');
			case TreeItemType.Hooks:
				return new vscode.ThemeIcon('zap');
			case TreeItemType.Editor:
				return new vscode.ThemeIcon('edit');
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
export class PlatformTreeDataProvider implements vscode.TreeDataProvider<PlatformTreeItem>, vscode.Disposable {
	private readonly _onDidChangeTreeData: vscode.EventEmitter<TreeDataChangeEvent> =
		new vscode.EventEmitter<TreeDataChangeEvent>();
	readonly onDidChangeTreeData: vscode.Event<TreeDataChangeEvent> =
		this._onDidChangeTreeData.event;

	private readonly workspaceTasksCommands: WorkspaceTasksCommands;
	private readonly oscriptTasksCommands: OscriptTasksCommands;
	private readonly setVersionCommands?: SetVersionCommands;
	private readonly extensionUri: vscode.Uri | undefined;
	private readonly extensionContext: vscode.ExtensionContext | undefined;
	/** Формат конфигурации проекта: от него зависят подписи и состав команд. */
	private sourceFormat: TreeSourceFormat | undefined;
	/** Черты проекта: у проекта OneScript в дереве только его группы. */
	private traits: ReadonlySet<TreeProjectTrait> = treeTraitsOf(undefined, false);
	private readonly formatSubscription: vscode.Disposable;
	private readonly layoutSubscription: vscode.Disposable;
	private readonly projectsSubscription: vscode.Disposable;
	/** Create/delete служебных файлов → иконки check/add в группе. */
	private serviceFilesWatcher: vscode.Disposable | undefined;

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
		this.formatSubscription = onDidChangeCurrentProject((change) => {
			this.watchServiceFiles(change.current);
			void this.refreshSourceFormat(true);
		});
		this.layoutSubscription = onDidChangeProjectLayout(() => void this.refreshSourceFormat());
		this.projectsSubscription = onDidChangeProjects(() => void this.refreshSourceFormat());
		this.watchServiceFiles(currentRoot());
		void this.refreshSourceFormat();
	}

	/** Черты текущего проекта, по которым собрано дерево. */
	projectTraits(): ReadonlySet<TreeProjectTrait> {
		return this.traits;
	}

	/**
	 * Обновляет дерево команд
	 */
	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	dispose(): void {
		this.formatSubscription.dispose();
		this.layoutSubscription.dispose();
		this.projectsSubscription.dispose();
		this.serviceFilesWatcher?.dispose();
		this.serviceFilesWatcher = undefined;
	}

	/** Как у плашки профиля: watcher на корень проекта, при смене корня — пересоздать. */
	private watchServiceFiles(root: string | undefined): void {
		this.serviceFilesWatcher?.dispose();
		this.serviceFilesWatcher = undefined;
		if (root === undefined) {
			return;
		}
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(root, serviceFilesWatchGlob()),
			false,
			true,
			false
		);
		this.serviceFilesWatcher = vscode.Disposable.from(
			watcher,
			watcher.onDidCreate(() => this.refresh()),
			watcher.onDidDelete(() => this.refresh())
		);
	}

	/**
	 * Формат конфигурации и черты проекта; дерево перестраивается, когда они меняются.
	 *
	 * @param rebuild - Перестроить дерево и без смены формата: сменился проект
	 */
	private async refreshSourceFormat(rebuild = false): Promise<void> {
		const vrunner = VRunnerManager.getInstance();
		const workspaceRoot = vrunner.getWorkspaceRoot();
		const project = workspaceRoot === undefined ? undefined : projectByRoot(workspaceRoot);
		const traits = treeTraitsOf(project?.kind, project?.package === true);
		let format: TreeSourceFormat | undefined;
		if (workspaceRoot && project?.kind !== 'onescript') {
			try {
				format = (await configurationScope(workspaceRoot)).configuration?.format;
			} catch {
				format = undefined;
			}
		}
		const traitsChanged = [...traits].sort().join() !== [...this.traits].sort().join();
		if (rebuild || traitsChanged || format !== this.sourceFormat) {
			this.sourceFormat = format;
			this.traits = traits;
			this.refresh();
		}
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
			package: TreeItemType.Dependency,
			run: TreeItemType.Run,
			session: TreeItemType.Run,
			test: TreeItemType.Test,
			testEnvironment: TreeItemType.Test,
			setVersion: TreeItemType.SetVersion,
			config: TreeItemType.Config,
			serviceFiles: TreeItemType.Config,
			helpAndSupport: TreeItemType.Lightbulb,
			oscriptTasks: TreeItemType.OscriptTasks,
			pipelines: TreeItemType.Pipelines,
			skills: TreeItemType.Skills,
			edt: TreeItemType.Edt,
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

		if (element.type === TreeItemType.Pipelines) {
			return this.getPipelines();
		}

		if (element.type === TreeItemType.SetVersionReportsFolder) {
			return this.getSetVersionReportItems();
		}

		if (element.type === TreeItemType.SetVersionProcessorsFolder) {
			return this.getSetVersionProcessorItems();
		}

		// Служебные файлы строим лениво: состав («Осн. профиль запуска» →
		// env.json / autumn-properties.json, CI-файлы) зависит от версии vrunner,
		// которая могла определиться уже после первого построения дерева.
		if (element.groupId === 'serviceFiles') {
			return this.buildServiceFilesChildren();
		}

		return Promise.resolve(element.children || []);
	}

	/**
	 * Создаёт группу «Избранное» со списком избранных команд (иконки и префикс группы как в оригинале)
	 * @param favorites - Список избранных записей
	 * @returns Элемент дерева «Избранное» или undefined, если избранных нет
	 */
	private createFavoritesRootItem(favorites: FavoriteEntry[]): PlatformTreeItem | undefined {
		const visible = favorites.filter((entry) => favoriteVisibleFor(entry.command, entry.sectionType, this.traits));
		if (visible.length === 0) {
			return undefined;
		}
		const favoriteItems = visible.map((entry) => {
			// Подпись берётся из структуры дерева: у команды с параметрами её нет,
			// там заголовок записи и есть имя выбранного объекта
			const title = (entry.arguments ? undefined : treeCommandLabel(entry.command)) ?? entry.title;
			const label = entry.groupLabel ? `${entry.groupLabel} › ${title}` : title;
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
			this.resolveGroupCollapsibleState('favorites', false),
			undefined,
			favoriteItems,
			undefined,
			'favorites'
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
	 * Возвращает сохранённое состояние раскрытия групп из globalState.
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
	 * Строит дочерние элементы группы «Служебные файлы»: для каждого файла его
	 * наличие в проекте и действие создать (если нет) или открыть (если есть).
	 * @returns Массив элементов дерева
	 */
	private async buildServiceFilesChildren(): Promise<PlatformTreeItem[]> {
		const workspaceRoot = currentRoot();
		const items: PlatformTreeItem[] = [
			this.createTreeItem(
				'Базовый набор',
				TreeItemType.Task,
				vscode.TreeItemCollapsibleState.None,
				{
					command: '1c-platform-tools.serviceFiles.createRecommendedSet',
					title: 'Базовый набор',
				},
				undefined,
				undefined,
				undefined,
				'checklist'
			),
		];

		const schema = VRunnerManager.getInstance().getActiveSettingsSchema();
		for (const staticSpec of SERVICE_FILES) {
			// «Профиль запуска» указывает на файл схемы установленного vrunner
			const spec = staticSpec.id === 'launchProfile' ? resolveLaunchProfileSpec(schema) : staticSpec;
			const exists = workspaceRoot
				? fsSync.existsSync(path.join(workspaceRoot, spec.relPath))
				: false;
			const item = this.createTreeItem(
				spec.label,
				TreeItemType.Task,
				vscode.TreeItemCollapsibleState.None,
				{
					command: '1c-platform-tools.serviceFiles.ensure',
					title: spec.label,
					arguments: [spec.id],
				},
				undefined,
				undefined,
				undefined,
				exists ? 'check' : 'add'
			);
			item.tooltip = exists ? `Открыть ${spec.relPath}` : `Создать ${spec.relPath}`;
			items.push(item);
			// Типовые цепочки наполняют .1cpt/pipelines.json, поэтому стоят сразу за ним
			if (spec.id === 'pipelines') {
				items.push(await this.createPipelineTemplatesItem(workspaceRoot));
			}
		}

		return items;
	}

	/**
	 * Строка «1cpt: pipeline templates» рядом с файлом цепочек.
	 *
	 * Значок как у служебного файла: плюс, пока типовых цепочек в проекте нет,
	 * и галка, когда они уже стоят.
	 *
	 * @param workspaceRoot Корень проекта; без него цепочки не читаются
	 * @returns Элемент дерева
	 */
	private async createPipelineTemplatesItem(workspaceRoot: string | undefined): Promise<PlatformTreeItem> {
		const pipelines = workspaceRoot ? await readPipelines(workspaceRoot) : [];
		const installed = pipelines.some((pipeline) => pipeline.id.startsWith(PIPELINE_TEMPLATE_ID_PREFIX));
		const item = this.createTreeItem(
			'1cpt: pipeline templates',
			TreeItemType.Task,
			vscode.TreeItemCollapsibleState.None,
			{ command: '1c-platform-tools.pipelines.addTemplates', title: '1cpt: pipeline templates' },
			undefined,
			undefined,
			undefined,
			installed ? 'check' : 'add'
		);
		item.tooltip = installed
			? 'Обновить типовые цепочки до поставляемых с расширением'
			: 'Добавить в проект типовые цепочки шагов';
		return item;
	}

	/**
	 * Получает корневые элементы дерева из единой структуры TREE_GROUPS и динамических узлов
	 * @returns Массив корневых элементов
	 */
	private getRootItems(): PlatformTreeItem[] {
		const allSections: PlatformTreeItem[] = [];
		const hiddenGroups = this.extensionContext
			? getHiddenToolGroups(this.extensionContext)
			: new Set<string>();

		for (const group of TREE_GROUPS) {
			if (group.sectionType === 'helpAndSupport') {
				continue;
			}
			if (hiddenGroups.has(group.sectionType) || !groupVisibleFor(group, this.traits)) {
				continue;
			}
			const groupType = this.sectionTypeToRootType(group.sectionType);
			const defaultExpanded = group.defaultCollapsibleState === 'expanded';
			const collapsibleState = this.resolveGroupCollapsibleState(group.sectionType, defaultExpanded);

			const children: PlatformTreeItem[] = groupCommandsFor(group, this.sourceFormat, this.traits).map((cmd) =>
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

		if (!hiddenGroups.has('pipelines')) {
			const pipelinesExpanded = this.resolveGroupCollapsibleState('pipelines', false) === vscode.TreeItemCollapsibleState.Expanded;
			allSections.push(
				this.createTreeItem(
					'Автоматизация',
					TreeItemType.Pipelines,
					pipelinesExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
					undefined,
					[],
					undefined,
					'pipelines'
				)
			);
		}
		if (!hiddenGroups.has('oscriptTasks')) {
			const oscriptExpanded = this.resolveGroupCollapsibleState('oscriptTasks', false) === vscode.TreeItemCollapsibleState.Expanded;
			allSections.push(
				this.createTreeItem(
					'Задачи (oscript)',
					TreeItemType.OscriptTasks,
					oscriptExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
					undefined,
					[],
					undefined,
					'oscriptTasks'
				)
			);
		}
		if (!hiddenGroups.has('launch')) {
			const launchExpanded = this.resolveGroupCollapsibleState('launch', false) === vscode.TreeItemCollapsibleState.Expanded;
			allSections.push(
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
		}

		// Группа «Помощь и поддержка» вынесена в отдельную плашку (view
		// 1c-platform-tools-tools-help), данные даёт HelpAndSupportProvider.

		const favorites = this.extensionContext ? getFavorites(this.extensionContext) : [];
		const favoritesRoot = this.createFavoritesRootItem(favorites);
		return [
			...(favoritesRoot ? [favoritesRoot] : []),
			...allSections,
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
					command: '1c-platform-tools.tasks.edit',
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
							command: '1c-platform-tools.tasks.run',
							title: 'Запустить задачу workspace',
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
							command: '1c-platform-tools.tasks.run',
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
	 * Получает пайплайны проекта из .1cpt/pipelines.json
	 * @returns Промис, который разрешается массивом элементов дерева с цепочками
	 */
	private async getPipelines(): Promise<PlatformTreeItem[]> {
		const items: PlatformTreeItem[] = [
			this.createTreeItem(
				'Редактор пайплайнов',
				TreeItemType.Editor,
				vscode.TreeItemCollapsibleState.None,
				{
					command: '1c-platform-tools.pipelines.openEditor',
					title: getOpenPipelineEditorCommandName().title,
				}
			),
		];

		const workspaceRoot = VRunnerManager.getInstance().getWorkspaceRoot();
		if (!workspaceRoot) {
			return items;
		}

		const pipelines = await readPipelines(workspaceRoot);

		// Клик по цепочке открывает её в редакторе: запуск - кнопкой в строке,
		// иначе один промах мышью запускает команды по базе
		for (const pipeline of pipelines) {
			const item = this.createTreeItem(
				pipeline.name,
				TreeItemType.PipelineEntry,
				vscode.TreeItemCollapsibleState.None,
				{
					command: '1c-platform-tools.pipelines.openEditor',
					title: getOpenPipelineEditorCommandName().title,
					arguments: [pipeline.id],
				}
			);
			item.pipelineId = pipeline.id;
			item.description = `${pipeline.nodes.length} ${stepsWord(pipeline.nodes.length)}`;
			item.tooltip = pipeline.description ?? `Открыть «${pipeline.name}» в редакторе`;
			items.push(item);
		}

		items.push(
			this.createTreeItem(
				'Редактор хуков',
				TreeItemType.Editor,
				vscode.TreeItemCollapsibleState.None,
				{
					command: '1c-platform-tools.hooks.openEditor',
					title: getOpenHooksEditorCommandName().title,
				}
			)
		);

		const { hooks } = await readHooks(workspaceRoot);
		for (const [commandId, entry] of Object.entries(hooks)) {
			const item = this.createTreeItem(
				commandId === HOOKS_WILDCARD ? 'Все команды' : commandTitle(commandId) ?? commandId,
				TreeItemType.Hooks,
				vscode.TreeItemCollapsibleState.None,
				{
					command: '1c-platform-tools.hooks.openEditor',
					title: getOpenHooksEditorCommandName().title,
					arguments: [commandId],
				}
			);
			item.description = describeHookEntry(entry);
			item.tooltip = commandId;
			items.push(item);
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
					command: '1c-platform-tools.tasks.addOscript',
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
							command: '1c-platform-tools.tasks.runOscript',
							title: 'Запустить задачу oscript',
							arguments: [task.name],
						}
					)
				);
			}

			if (items.length === 1) {
				items.push(
					this.createTreeItem(
						'Нет файлов *.os в каталоге задач',
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
	 * Получает элементы дерева «Внешнего отчёта»
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
						'Внешних отчётов нет',
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
						command: '1c-platform-tools.epf.setVersionReport',
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
	 * Получает элементы дерева «Внешней обработки»
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
						'Внешних обработок нет',
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
						command: '1c-platform-tools.epf.setVersionProcessor',
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
