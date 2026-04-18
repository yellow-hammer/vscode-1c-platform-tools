import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	PlatformTreeDataProvider,
	PlatformTreeItem,
	TREE_GROUP_EXPANDED_STATE_KEY,
} from './treeViewProvider';
import { InfobaseCommands } from './commands/infobaseCommands';
import { ConfigurationCommands } from './commands/configurationCommands';
import { ExtensionsCommands } from './commands/extensionsCommands';
import { ExternalFilesCommands } from './commands/externalFilesCommands';
import { SupportCommands } from './commands/supportCommands';
import { DependenciesCommands } from './commands/dependenciesCommands';
import { RunCommands } from './commands/runCommands';
import { TestCommands } from './commands/testCommands';
import { SetVersionCommands } from './commands/setVersionCommands';
import { WorkspaceTasksCommands } from './commands/workspaceTasksCommands';
import { ArtifactCommands } from './commands/artifactCommands';
import { OscriptTasksCommands } from './commands/oscriptTasksCommands';
import { SkillsCommands } from './commands/skillsCommands';
import { registerCommands } from './commands/commandRegistry';
import { VRunnerManager } from './vrunnerManager';
import { logger } from './logger';
import { setOnProjectCreated } from './projectContext';
import {
	getPickableCommandsByGroup,
	getFavorites,
	setFavorites,
	type FavoriteEntry,
	type PickableCommandGroup,
} from './favorites';
import { TodoPanelTreeDataProvider, type FilterScope } from './todoPanelView';
import {
	ProjectArtifactsTreeDataProvider,
	type FeaturesViewMode,
} from './projectArtifactsView';
import {
	MetadataLeafTreeItem,
	MetadataMdGroupTreeItem,
	MetadataMdSubgroupTreeItem,
	MetadataObjectNodeTreeItem,
	MetadataObjectSectionTreeItem,
	MetadataSourceTreeItem,
	MetadataTreeDataProvider,
} from './metadataTreeView';
import { clearMdSparrowDownloadCache, ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { mdSparrowSchemaFlagFromConfigurationXml } from './mdSparrowSchemaVersion';
import { createMdSparrowMutationRunner } from './mdSparrowMutationQueue';
import { runMdSparrow } from './mdSparrowRunner';
import { openMetadataObjectPropertiesEditor } from './metadataObjectPropertiesPanel';
import {
	openMetadataSourcePropertiesPanel,
	type SourcePropertiesDto,
} from './metadataSourcePropertiesPanel';
import {
	openExternalArtifactPropertiesPanel,
	type ExternalArtifactPropertiesDto,
} from './metadataExternalArtifactPropertiesPanel';
import {
	parseMdBoilerplateKindFromCommandArgs,
	resolveNextBoilerplateMdName,
} from './metadataBoilerplateNames';
import { registerGetStarted, openGetStartedWalkthrough, showGetStartedOnFirstRun } from './getStartedView';
import { OneCLocator } from './oneCLocator';
import {
	ProjectStorage,
	ProjectsStack,
	ProjectsProviders,
	getProjectsFilePath,
	showStatusBar,
} from './projects';
import { HelpAndSupportProvider } from './projects/helpAndSupportProvider';
import { registerProjectsDecoration } from './projects/decoration';
import { registerProjectsCommands } from './projects/commands';
import * as onecDebugTargets from './debug/debugTargets';
import {
	OnecDebugConfigurationProvoider,
	watchTargetTypesChanged,
} from './debug/debugConfigurations';
import { registerRunCommandFileWatcher } from './runCommandFromFileWatcher';
import { startIpcServer } from './ipcServer';
import { loadProjectMetadataTree } from './metadataTreeService';

/** Элемент QuickPick для настройки избранного (с полями команды и группы) */
type FavoritesSelectableItem = vscode.QuickPickItem & {
	command: string;
	title: string;
	groupLabel: string;
	sectionType: string;
	arguments?: unknown[];
};

/**
 * Добавляет в массив элементы «Установить версию»: расширения, отчёты, обработки (динамические)
 */
async function pushSetVersionDynamicItems(
	items: vscode.QuickPickItem[],
	group: PickableCommandGroup,
	favoriteKeys: Set<string>,
	setVersionCommands: SetVersionCommands
): Promise<void> {
	items.push({ label: '🏷️ Расширения', kind: vscode.QuickPickItemKind.Separator });
	items.push({
		label: '🏷️ Все',
		description: '1c-platform-tools.setVersion.allExtensions',
		picked: favoriteKeys.has('1c-platform-tools.setVersion.allExtensions|[]'),
		command: '1c-platform-tools.setVersion.allExtensions',
		title: 'Все',
		groupLabel: group.groupLabel,
		sectionType: group.sectionType,
	} as FavoritesSelectableItem);
	const extensions = await setVersionCommands.getExtensionFoldersForTree();
	for (const name of extensions) {
		const command = '1c-platform-tools.setVersion.extension';
		const args = [name];
		items.push({
			label: `🏷️ ${name}`,
			description: command,
			picked: favoriteKeys.has(`${command}|${JSON.stringify(args)}`),
			command,
			title: name,
			groupLabel: group.groupLabel,
			sectionType: group.sectionType,
			arguments: args,
		} as FavoritesSelectableItem);
	}
	items.push({ label: '🏷️ Внешнего отчёта', kind: vscode.QuickPickItemKind.Separator });
	const reports = await setVersionCommands.getReportFoldersForTree();
	for (const name of reports) {
		const command = '1c-platform-tools.setVersion.report';
		const args = [name];
		items.push({
			label: `🏷️ Отчёт: ${name}`,
			description: command,
			picked: favoriteKeys.has(`${command}|${JSON.stringify(args)}`),
			command,
			title: name,
			groupLabel: group.groupLabel,
			sectionType: group.sectionType,
			arguments: args,
		} as FavoritesSelectableItem);
	}
	items.push({ label: '🏷️ Внешней обработки', kind: vscode.QuickPickItemKind.Separator });
	const processors = await setVersionCommands.getProcessorFoldersForTree();
	for (const name of processors) {
		const command = '1c-platform-tools.setVersion.processor';
		const args = [name];
		items.push({
			label: `🏷️ Обработка: ${name}`,
			description: command,
			picked: favoriteKeys.has(`${command}|${JSON.stringify(args)}`),
			command,
			title: name,
			groupLabel: group.groupLabel,
			sectionType: group.sectionType,
			arguments: args,
		} as FavoritesSelectableItem);
	}
}

/**
 * Добавляет в массив группу «Задачи (oscript)» — динамический список из каталога tasks
 */
async function pushOscriptTasksItems(
	items: vscode.QuickPickItem[],
	favoriteKeys: Set<string>,
	oscriptTasksCommands: OscriptTasksCommands
): Promise<void> {
	items.push({ label: 'Задачи (oscript)', kind: vscode.QuickPickItemKind.Separator });
	items.push({
		label: '➕ Добавить задачу',
		description: '1c-platform-tools.oscript.addTask',
		picked: favoriteKeys.has('1c-platform-tools.oscript.addTask|[]'),
		command: '1c-platform-tools.oscript.addTask',
		title: 'Добавить задачу',
		groupLabel: 'Задачи (oscript)',
		sectionType: 'oscriptTasks',
	} as FavoritesSelectableItem);
	const tasks = await oscriptTasksCommands.getOscriptTasks();
	for (const task of tasks) {
		const command = '1c-platform-tools.oscript.run';
		const args = [task.name];
		items.push({
			label: `▶️ ${task.name}`,
			description: command,
			picked: favoriteKeys.has(`${command}|${JSON.stringify(args)}`),
			command,
			title: task.name,
			groupLabel: 'Задачи (oscript)',
			sectionType: 'oscriptTasks',
			arguments: args,
		} as FavoritesSelectableItem);
	}
}

/**
 * Проверяет, является ли открытая рабочая область проектом 1С
 * Расширение активируется, если в корне есть файл packagedef
 * @returns true, если это проект 1С
 */
async function is1CProject(): Promise<boolean> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return false;
	}

	const workspaceRoot = workspaceFolders[0].uri.fsPath;
	const fs = await import('node:fs/promises');
	const path = await import('node:path');

	const packagedefPath = path.join(workspaceRoot, 'packagedef');
	
	try {
		await fs.access(packagedefPath);
		return true;
	} catch {
		return false;
	}
}

const NOT_1C_PROJECT_MESSAGE =
	'Откройте папку проекта 1С (в корне должен быть файл packagedef). ' +
	'Чтобы создать новый проект, выполните команду «1C: Зависимости: Инициализировать проект» из палитры команд.';

export async function activate(context: vscode.ExtensionContext) {
	// Панель «Проекты 1С» — сразу создаём TreeViews, чтобы избежать «Отсутствует поставщик данных»
	const oneCLocator = new OneCLocator(context);
	const projectsConfig = vscode.workspace.getConfiguration('1c-platform-tools');
	const projectsLocation = projectsConfig.get<string>('projects.projectsLocation', '');
	const projectFilePath = getProjectsFilePath(projectsLocation, context);
	const projectStorage = new ProjectStorage(projectFilePath);
	const loadError = projectStorage.load();
	if (loadError) {
		void vscode.window
			.showErrorMessage('Ошибка загрузки projects.json', { modal: true, detail: loadError }, { title: 'Открыть файл' })
			.then((choice) => {
				if (choice?.title === 'Открыть файл') {
					void vscode.commands.executeCommand('1c-platform-tools.projects.editProjects');
				}
			});
	}
	const stack = new ProjectsStack(
		(k) => context.globalState.get(k),
		(k, v) => context.globalState.update(k, v)
	);
	const providers = new ProjectsProviders(context, projectStorage, oneCLocator, stack);

	// Панель «Список дел» — TreeView с TreeDataProvider, фильтр через команду
	const todoPanelProvider = new TodoPanelTreeDataProvider(context);
	const todoTreeView = vscode.window.createTreeView('1c-platform-tools-todo-list', {
		treeDataProvider: todoPanelProvider,
		showCollapseAll: true,
	});
	todoPanelProvider.setTreeView(todoTreeView);
	context.subscriptions.push(todoTreeView);

	// Панель «Артефакты проекта» — дерево артефактов (feature, конфигурации, расширения, обработки, отчёты)
	const artifactsProvider = new ProjectArtifactsTreeDataProvider(context);
	const artifactsTreeView = vscode.window.createTreeView(
		'1c-platform-tools-artifacts-tree',
		{
			treeDataProvider: artifactsProvider,
			showCollapseAll: true,
		}
	);
	context.subscriptions.push(artifactsTreeView);

	const metadataTreeProvider = new MetadataTreeDataProvider(context);
	const metadataTreeView = vscode.window.createTreeView('1c-platform-tools-metadata-tree', {
		treeDataProvider: metadataTreeProvider,
		showCollapseAll: true,
	});
	context.subscriptions.push(metadataTreeView);

	const syncMetadataCatalogSelectionContext = (): void => {
		const has = metadataTreeView.selection.some(
			(s) => s instanceof MetadataLeafTreeItem && s.objectType === 'Catalog'
		);
		void vscode.commands.executeCommand('setContext', '1c-platform-tools.metadata.catalogSelected', has);
		const hasSubsystem = metadataTreeView.selection.some(
			(s) => s instanceof MetadataLeafTreeItem && s.objectType === 'Subsystem'
		);
		void vscode.commands.executeCommand(
			'setContext',
			'1c-platform-tools.metadata.subsystemSelected',
			hasSubsystem
		);
	};
	void vscode.commands.executeCommand('setContext', '1c-platform-tools.metadata.catalogSelected', false);
	void vscode.commands.executeCommand('setContext', '1c-platform-tools.metadata.subsystemSelected', false);
	void vscode.commands.executeCommand('setContext', '1c-platform-tools.metadata.subsystemFilterActive', false);
	context.subscriptions.push(metadataTreeView.onDidChangeSelection(syncMetadataCatalogSelectionContext));

	await vscode.commands.executeCommand('setContext', '1c-platform-tools.is1CProject', false);

	// Регистрация DAP 1С (onec-debug-adapter) и представлений отладки
	vscode.debug.registerDebugConfigurationProvider(
		'1c-platform-tools',
		new OnecDebugConfigurationProvoider()
	);
	watchTargetTypesChanged(context);
	context.subscriptions.push(
		vscode.debug.onDidStartDebugSession((session) => {
			onecDebugTargets.updateDebugTargets(session);
		})
	);
	context.subscriptions.push(
		vscode.debug.onDidReceiveDebugSessionCustomEvent((ev) => {
			if (ev.event === 'DebugTargetsUpdated') {
				onecDebugTargets.updateDebugTargets(ev.session);
			}
		})
	);
	onecDebugTargets.init(context);

	const isProject = await is1CProject();

	if (isProject) {
		await vscode.commands.executeCommand('setContext', '1c-platform-tools.is1CProject', true);
	}

	// Инициализируем VRunnerManager с контекстом расширения для доступа к extensionPath
	VRunnerManager.getInstance(context);

	const commands = {
		infobase: new InfobaseCommands(),
		configuration: new ConfigurationCommands(),
		extensions: new ExtensionsCommands(),
		artifact: new ArtifactCommands(),
		externalFiles: new ExternalFilesCommands(),
		support: new SupportCommands(),
		dependencies: new DependenciesCommands(),
		run: new RunCommands(),
		test: new TestCommands(),
		setVersion: new SetVersionCommands(),
		oscriptTasks: new OscriptTasksCommands(),
		workspaceTasks: new WorkspaceTasksCommands(),
		skills: new SkillsCommands(),
	};

	const commandDisposables = registerCommands(context, commands);

	// Изменяемая ссылка: после создания packagedef из палитры станет true, команды будут работать без перезагрузки
	const isProjectRef = { current: isProject };

	const showNot1CProjectMessage = (): void => {
		logger.info(NOT_1C_PROJECT_MESSAGE);
		vscode.window.showInformationMessage(NOT_1C_PROJECT_MESSAGE);
	};

	const MD_SPARROW_CLI_ERR_PREVIEW = 500;

	const runMdSparrowMutation = createMdSparrowMutationRunner();

	function resolveCfPathsFromMetadataTree(): { cfgPath: string; cfRoot: string } | undefined {
		const sel = metadataTreeView.selection[0];
		if (sel instanceof MetadataMdGroupTreeItem || sel instanceof MetadataMdSubgroupTreeItem) {
			if (sel.configurationXmlAbs && sel.metadataRootAbs) {
				return { cfgPath: sel.configurationXmlAbs, cfRoot: sel.metadataRootAbs };
			}
		}
		if (sel instanceof MetadataLeafTreeItem) {
			if (sel.configurationXmlAbs && sel.metadataRootAbs) {
				return { cfgPath: sel.configurationXmlAbs, cfRoot: sel.metadataRootAbs };
			}
		}
		const cfgPath = metadataTreeProvider.configurationXml;
		const cfRoot = metadataTreeProvider.resolveCfRoot();
		if (cfgPath && cfRoot) {
			return { cfgPath, cfRoot };
		}
		return undefined;
	}

	const metadataObjectTypeToXmlTag: Record<string, string> = {
		Catalog: 'Catalog',
		Constant: 'Constant',
		Enum: 'Enum',
		Document: 'Document',
		Report: 'Report',
		DataProcessor: 'DataProcessor',
		Task: 'Task',
		ChartOfAccounts: 'ChartOfAccounts',
		ChartOfCharacteristicTypes: 'ChartOfCharacteristicTypes',
		ChartOfCalculationTypes: 'ChartOfCalculationTypes',
		CommonModule: 'CommonModule',
		Subsystem: 'Subsystem',
		SessionParameter: 'SessionParameter',
		ExchangePlan: 'ExchangePlan',
		CommonAttribute: 'CommonAttribute',
		CommonPicture: 'CommonPicture',
		DocumentNumerator: 'DocumentNumerator',
		ExternalDataSource: 'ExternalDataSource',
		Role: 'Role',
	};

	function resolveSelectedMetadataLeaf(item?: MetadataLeafTreeItem): MetadataLeafTreeItem | undefined {
		if (item instanceof MetadataLeafTreeItem) {
			return item;
		}
		if (metadataTreeView.selection.length === 0) {
			return undefined;
		}
		const selected = metadataTreeView.selection[0];
		if (selected instanceof MetadataLeafTreeItem) {
			return selected;
		}
		return undefined;
	}

	function resolveSelectedMetadataSource(item?: MetadataSourceTreeItem): MetadataSourceTreeItem | undefined {
		if (item instanceof MetadataSourceTreeItem) {
			return item;
		}
		if (metadataTreeView.selection.length === 0) {
			return undefined;
		}
		const selected = metadataTreeView.selection[0];
		if (selected instanceof MetadataSourceTreeItem) {
			return selected;
		}
		return undefined;
	}

	async function openTextFile(pathToOpen: string): Promise<void> {
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(pathToOpen));
		await vscode.window.showTextDocument(doc, { preview: false });
	}

	async function resolveFirstXmlInDir(dir: string): Promise<string | undefined> {
		try {
			const entries = await fs.promises.readdir(dir, { withFileTypes: true });
			const files = entries
				.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.xml'))
				.map((entry) => entry.name)
				.sort((a, b) => a.localeCompare(b, 'ru'))
				.map((name) => path.join(dir, name));
			if (files.length > 0) {
				return files[0];
			}
			const dirs = entries
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.sort((a, b) => a.localeCompare(b, 'ru'));
			for (const subdir of dirs) {
				const nested = await resolveFirstXmlInDir(path.join(dir, subdir));
				if (nested) {
					return nested;
				}
			}
			return undefined;
		} catch {
			return undefined;
		}
	}

	async function resolveModulePathForSource(
		source: MetadataSourceTreeItem,
		moduleFileName: string
	): Promise<string | undefined> {
		if (!source.metadataRootAbs) {
			return undefined;
		}
		const exact = path.join(source.metadataRootAbs, 'Ext', moduleFileName);
		try {
			await fs.promises.access(exact);
			return exact;
		} catch {
			return undefined;
		}
	}

	async function listExternalArtifactXmlFromSource(
		source: MetadataSourceTreeItem
	): Promise<Array<{ name: string; xmlPath: string; objectType: 'ExternalReport' | 'ExternalDataProcessor' }>> {
		if (!source.metadataRootAbs) {
			return [];
		}
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(source.metadataRootAbs, { withFileTypes: true });
		} catch {
			return [];
		}
		const dirs = entries
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.sort((a, b) => a.localeCompare(b, 'ru'));
		const objectType: 'ExternalReport' | 'ExternalDataProcessor' =
			source.sourceKind === 'externalErf' ? 'ExternalReport' : 'ExternalDataProcessor';
		const out: Array<{ name: string; xmlPath: string; objectType: 'ExternalReport' | 'ExternalDataProcessor' }> = [];
		for (const dirName of dirs) {
			const dirPath = path.join(source.metadataRootAbs, dirName);
			let files: fs.Dirent[];
			try {
				files = await fs.promises.readdir(dirPath, { withFileTypes: true });
			} catch {
				continue;
			}
			const xml = files
				.filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.xml'))
				.map((f) => f.name)
				.sort((a, b) => a.localeCompare(b, 'ru'))[0];
			if (!xml) {
				continue;
			}
			out.push({
				name: path.basename(xml, '.xml'),
				xmlPath: path.join(dirPath, xml),
				objectType,
			});
		}
		return out;
	}

	async function loadSourcePropertiesDto(
		cfgPath: string,
		cfRoot: string
	): Promise<{ schema: string; dto: SourcePropertiesDto }> {
		const schema = await mdSparrowSchemaFlagFromConfigurationXml(cfgPath);
		const runtime = await ensureMdSparrowRuntime(context);
		const getRes = await runMdSparrow(
			runtime,
			['cf-configuration-properties-get', cfgPath, '-v', schema],
			{ cwd: cfRoot }
		);
		if (getRes.exitCode !== 0) {
			const errText = (getRes.stderr.trim() || getRes.stdout.trim() || `код ${getRes.exitCode}`).slice(
				0,
				MD_SPARROW_CLI_ERR_PREVIEW
			);
			throw new Error(errText);
		}
		let dto: SourcePropertiesDto;
		try {
			dto = JSON.parse(getRes.stdout.trim()) as SourcePropertiesDto;
		} catch {
			throw new Error('Не удалось разобрать свойства Configuration.xml.');
		}
		return { schema, dto };
	}

	async function saveSourcePropertiesDto(
		cfgPath: string,
		cfRoot: string,
		schema: string,
		dto: SourcePropertiesDto
	): Promise<boolean> {
		const tmpPath = path.join(os.tmpdir(), `md-sparrow-source-props-${Date.now()}.json`);
		try {
			await fs.promises.writeFile(tmpPath, JSON.stringify(dto), 'utf8');
			const runtime = await ensureMdSparrowRuntime(context);
			const setRes = await runMdSparrow(
				runtime,
				['cf-configuration-properties-set', cfgPath, tmpPath, '-v', schema],
				{ cwd: cfRoot }
			);
			if (setRes.exitCode !== 0) {
				const errText = (setRes.stderr.trim() || setRes.stdout.trim() || `код ${setRes.exitCode}`).slice(
					0,
					MD_SPARROW_CLI_ERR_PREVIEW
				);
				void vscode.window.showErrorMessage(errText);
				return false;
			}
			return true;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
			return false;
		} finally {
			try {
				await fs.promises.unlink(tmpPath);
			} catch {
				/* ignore */
			}
		}
	}

	async function loadExternalArtifactPropertiesDto(
		objectXmlPath: string,
		cwd: string
	): Promise<{ schema: string; dto: ExternalArtifactPropertiesDto }> {
		const schema = await mdSparrowSchemaFlagFromConfigurationXml(objectXmlPath);
		const runtime = await ensureMdSparrowRuntime(context);
		const getRes = await runMdSparrow(
			runtime,
			['external-artifact-properties-get', objectXmlPath, '-v', schema],
			{ cwd }
		);
		if (getRes.exitCode !== 0) {
			const errText = (getRes.stderr.trim() || getRes.stdout.trim() || `код ${getRes.exitCode}`).slice(
				0,
				MD_SPARROW_CLI_ERR_PREVIEW
			);
			throw new Error(errText);
		}
		type ExternalDto = { name?: string; synonymRu?: string; comment?: string; kind?: 'REPORT' | 'DATA_PROCESSOR' };
		let externalDto: ExternalDto;
		try {
			externalDto = JSON.parse(getRes.stdout.trim()) as ExternalDto;
		} catch {
			throw new Error('Не удалось разобрать свойства внешнего объекта.');
		}
		const dto: ExternalArtifactPropertiesDto = {
			kind: externalDto.kind === 'DATA_PROCESSOR' ? 'DATA_PROCESSOR' : 'REPORT',
			name: String(externalDto.name ?? ''),
			synonymRu: String(externalDto.synonymRu ?? ''),
			comment: String(externalDto.comment ?? ''),
		};
		return { schema, dto };
	}

	async function saveExternalArtifactPropertiesDto(
		objectXmlPath: string,
		cwd: string,
		schema: string,
		dto: ExternalArtifactPropertiesDto
	): Promise<boolean> {
		const tmpPath = path.join(os.tmpdir(), `md-sparrow-external-props-${Date.now()}.json`);
		try {
			const payload = {
				name: dto.name,
				synonymRu: dto.synonymRu,
				comment: dto.comment,
			};
			await fs.promises.writeFile(tmpPath, JSON.stringify(payload), 'utf8');
			const runtime = await ensureMdSparrowRuntime(context);
			const setRes = await runMdSparrow(
				runtime,
				['external-artifact-properties-set', objectXmlPath, tmpPath, '-v', schema],
				{ cwd }
			);
			if (setRes.exitCode !== 0) {
				const errText = (setRes.stderr.trim() || setRes.stdout.trim() || `код ${setRes.exitCode}`).slice(
					0,
					MD_SPARROW_CLI_ERR_PREVIEW
				);
				void vscode.window.showErrorMessage(errText);
				return false;
			}
			return true;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
			return false;
		} finally {
			try {
				await fs.promises.unlink(tmpPath);
			} catch {
				/* ignore */
			}
		}
	}

	async function openExternalArtifactPropertiesEditor(
		objectXmlPath: string,
		label: string,
		objectType: 'ExternalReport' | 'ExternalDataProcessor'
	): Promise<void> {
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(objectXmlPath);
		await runMdSparrowMutation(async () => {
			try {
				const { schema, dto } = await loadExternalArtifactPropertiesDto(objectXmlPath, cwd);
				await openExternalArtifactPropertiesPanel(
					context,
					label,
					dto,
					async (nextDto) => {
						const saved = await saveExternalArtifactPropertiesDto(
							objectXmlPath,
							cwd,
							schema,
							nextDto
						);
						if (!saved) {
							return false;
						}
						void vscode.window.showInformationMessage('Свойства сохранены.');
						await metadataTreeProvider.refresh();
						return true;
					}
				);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
			}
		});
	}

	async function addExternalArtifact(sourceKind: 'externalErf' | 'externalEpf'): Promise<void> {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			void vscode.window.showInformationMessage('Откройте папку проекта.');
			return;
		}
		const isReport = sourceKind === 'externalErf';
		const vrunner = VRunnerManager.getInstance(context);
		const rootRelative = isReport ? vrunner.getErfPath() : vrunner.getEpfPath();
		const rootAbs = path.resolve(workspaceRoot, rootRelative);
		try {
			await fs.promises.mkdir(rootAbs, { recursive: true });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
			return;
		}
		let existingNames: string[] = [];
		try {
			const entries = await fs.promises.readdir(rootAbs, { withFileTypes: true });
			existingNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
		} catch {
			existingNames = [];
		}
		const prefix = isReport ? 'ВнешнийОтчет' : 'ВнешняяОбработка';
		let nextIndex = 1;
		for (;;) {
			const candidate = `${prefix}${nextIndex}`;
			if (!existingNames.includes(candidate)) {
				const schema = await pickSchemaFlagInitEmptyCf(path.join(workspaceRoot, 'src', 'cf', 'Configuration.xml'));
				if (!schema) {
					return;
				}
				const runtime = await ensureMdSparrowRuntime(context);
				const res = await runMdSparrow(
					runtime,
					[
						'external-artifact-add',
						rootAbs,
						candidate,
						'--kind',
						isReport ? 'REPORT' : 'DATA_PROCESSOR',
						'-v',
						schema,
					],
					{ cwd: workspaceRoot }
				);
				if (res.exitCode !== 0) {
					const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
						0,
						MD_SPARROW_CLI_ERR_PREVIEW
					);
					void vscode.window.showErrorMessage(errText);
					return;
				}
				await metadataTreeProvider.refresh();
				void vscode.window.showInformationMessage(
					isReport
						? `Внешний отчёт «${candidate}» добавлен.`
						: `Внешняя обработка «${candidate}» добавлена.`
				);
				return;
			}
			nextIndex += 1;
		}
	}

	function parseContentRefsToObjectNames(contentRefs: string[]): Set<string> {
		const out = new Set<string>();
		for (const raw of contentRefs) {
			const trimmed = raw.trim();
			if (!trimmed) {
				continue;
			}
			const slashParts = trimmed.split(/[\\/]/g).filter((x) => x.length > 0);
			const dotParts = trimmed.split('.').filter((x) => x.length > 0);
			const candidateFromSlash = slashParts[slashParts.length - 1] ?? '';
			const candidateFromDot = dotParts[dotParts.length - 1] ?? '';
			const candidate = candidateFromDot.length >= candidateFromSlash.length ? candidateFromDot : candidateFromSlash;
			if (candidate) {
				out.add(candidate);
			}
		}
		return out;
	}

	function parseContentRefsToObjectKeys(contentRefs: string[]): Set<string> {
		const out = new Set<string>();
		for (const raw of contentRefs) {
			const trimmed = raw.trim();
			if (!trimmed) {
				continue;
			}
			const parts = trimmed.split('.');
			if (parts.length >= 2) {
				const objectType = normalizeMdObjectTypeFromRefPrefix(parts[0] ?? '');
				const objectName = parts.slice(1).join('.').trim();
				if (objectType && objectName) {
					out.add(`${objectType}.${objectName}`);
				}
			}
		}
		return out;
	}

	function normalizeMdObjectTypeFromRefPrefix(prefix: string): string {
		const p = prefix.trim();
		switch (p) {
			case 'Catalog':
			case 'Constant':
			case 'Enum':
			case 'Document':
			case 'Report':
			case 'DataProcessor':
			case 'Task':
			case 'ChartOfAccounts':
			case 'ChartOfCharacteristicTypes':
			case 'ChartOfCalculationTypes':
			case 'CommonModule':
			case 'Subsystem':
			case 'SessionParameter':
			case 'ExchangePlan':
			case 'CommonAttribute':
			case 'CommonPicture':
			case 'DocumentNumerator':
			case 'ExternalDataSource':
			case 'Role':
				return p;
			default:
				return '';
		}
	}

	function parseExternalArtifactSourceKindFromArgs(
		args: readonly unknown[]
	): 'externalErf' | 'externalEpf' | undefined {
		for (const arg of args) {
			if (
				typeof arg === 'object' &&
				arg !== null &&
				'sourceKind' in arg &&
				((arg as { sourceKind?: unknown }).sourceKind === 'externalErf' ||
					(arg as { sourceKind?: unknown }).sourceKind === 'externalEpf')
			) {
				return (arg as { sourceKind: 'externalErf' | 'externalEpf' }).sourceKind;
			}
			if (Array.isArray(arg)) {
				const nested = parseExternalArtifactSourceKindFromArgs(arg);
				if (nested) {
					return nested;
				}
			}
		}
		return undefined;
	}

	type MutatableChildNodeKind = 'attribute' | 'tabularSection' | 'tabularAttribute';
	type MutatableChildNode = MetadataObjectNodeTreeItem & { nodeKind: MutatableChildNodeKind };
	type ChildNodeMutationMode = 'rename' | 'delete' | 'duplicate';

	function isMutatableChildNodeKind(kind: MetadataObjectNodeTreeItem['nodeKind']): kind is MutatableChildNodeKind {
		return kind === 'attribute' || kind === 'tabularSection' || kind === 'tabularAttribute';
	}

	/**
	 * Возвращает выбранный дочерний узел МД для операций rename/delete/duplicate.
	 *
	 * @param item Узел из контекстного меню.
	 * @param unsupportedMessage Текст для неподдерживаемых узлов.
	 * @returns Узел с поддерживаемым типом или `undefined`, если операция невозможна.
	 */
	function resolveChildNodeForMutation(
		item: MetadataObjectNodeTreeItem | undefined,
		unsupportedMessage: string
	): MutatableChildNode | undefined {
		const node = item ?? metadataTreeView.selection[0];
		if (!(node instanceof MetadataObjectNodeTreeItem)) {
			void vscode.window.showInformationMessage('Выберите узел метаданных.');
			return undefined;
		}
		if (!node.owner.resourceUri || !node.owner.configurationXmlAbs || !node.owner.metadataRootAbs) {
			void vscode.window.showInformationMessage('Недостаточно данных для операции.');
			return undefined;
		}
		if (!isMutatableChildNodeKind(node.nodeKind)) {
			void vscode.window.showInformationMessage(unsupportedMessage);
			return undefined;
		}
		return node;
	}

	/**
	 * Строит аргументы CLI md-sparrow для мутаций дочерних узлов объекта.
	 *
	 * @param node Узел реквизита/табличной части/реквизита ТЧ.
	 * @param mode Режим мутации: rename, delete или duplicate.
	 * @param name Имя для операции (`new-name`/`name` в зависимости от режима).
	 * @returns Аргументы для вызова `runMdSparrow`.
	 */
	function buildChildNodeMutationArgs(
		node: MutatableChildNode,
		mode: ChildNodeMutationMode,
		name: string
	): string[] {
		const objectXmlPath = node.owner.resourceUri.fsPath;
		if (node.nodeKind === 'attribute') {
			if (mode === 'rename') {
				return ['cf-md-attribute-rename', objectXmlPath, '--old-name', node.name, '--new-name', name];
			}
			if (mode === 'delete') {
				return ['cf-md-attribute-delete', objectXmlPath, '--name', name];
			}
			return ['cf-md-attribute-duplicate', objectXmlPath, '--source-name', node.name, '--new-name', name];
		}
		if (node.nodeKind === 'tabularSection') {
			if (mode === 'rename') {
				return ['cf-md-tabular-section-rename', objectXmlPath, '--old-name', node.name, '--new-name', name];
			}
			if (mode === 'delete') {
				return ['cf-md-tabular-section-delete', objectXmlPath, '--name', name];
			}
			return [
				'cf-md-tabular-section-duplicate',
				objectXmlPath,
				'--source-name',
				node.name,
				'--new-name',
				name,
			];
		}
		const tabularSectionName = node.tabularSectionName ?? '';
		if (mode === 'rename') {
			return [
				'cf-md-tabular-attribute-rename',
				objectXmlPath,
				'--tabular-section',
				tabularSectionName,
				'--old-name',
				node.name,
				'--new-name',
				name,
			];
		}
		if (mode === 'delete') {
			return [
				'cf-md-tabular-attribute-delete',
				objectXmlPath,
				'--tabular-section',
				tabularSectionName,
				'--name',
				name,
			];
		}
		return [
			'cf-md-tabular-attribute-duplicate',
			objectXmlPath,
			'--tabular-section',
			tabularSectionName,
			'--source-name',
			node.name,
			'--new-name',
			name,
		];
	}

	/**
	 * Выполняет мутацию дочернего узла объекта через md-sparrow и обновляет дерево.
	 *
	 * @param node Узел, к которому относится операция.
	 * @param args Аргументы подкоманды md-sparrow без флага схемы.
	 * @param successMessage Сообщение после успешного завершения.
	 * @returns Промис, который разрешается после выполнения операции.
	 */
	async function runChildNodeMutation(
		node: MutatableChildNode,
		args: string[],
		successMessage: string
	): Promise<void> {
		const schema = await mdSparrowSchemaFlagFromConfigurationXml(node.owner.configurationXmlAbs);
		const runtime = await ensureMdSparrowRuntime(context);
		const res = await runMdSparrow(runtime, [...args, '-v', schema], { cwd: node.owner.metadataRootAbs });
		if (res.exitCode !== 0) {
			const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
				0,
				MD_SPARROW_CLI_ERR_PREVIEW
			);
			void vscode.window.showErrorMessage(errText);
			return;
		}
		await metadataTreeProvider.refresh();
		void vscode.window.showInformationMessage(successMessage);
	}

	/** Флаг `-v` для init-empty-cf: из существующего Configuration.xml или выбор, если файла нет. */
	async function pickSchemaFlagInitEmptyCf(configurationXmlPath: string): Promise<string | undefined> {
		try {
			await fs.promises.access(configurationXmlPath);
			return await mdSparrowSchemaFlagFromConfigurationXml(configurationXmlPath);
		} catch {
			const pick = await vscode.window.showQuickPick(
				[
					{ label: 'V2_21', description: 'Схемы 2.21' },
					{ label: 'V2_20', description: 'Схемы 2.20' },
				],
				{ title: 'Версия XSD для пустой выгрузки (нет Configuration.xml)' }
			);
			if (pick?.label === 'V2_21' || pick?.label === 'V2_20') {
				return pick.label;
			}
			return undefined;
		}
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('1c-platform-tools.metadata.refresh', () => {
			void metadataTreeProvider.refresh();
		}),
		vscode.commands.registerCommand('1c-platform-tools.metadata.addDocument', async () => {
			await vscode.commands.executeCommand('1c-platform-tools.metadata.addMdObject', 'DOCUMENT');
		}),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.addMdObject',
			async (...commandArgs: unknown[]) => {
				await runMdSparrowMutation(async () => {
					const kind = parseMdBoilerplateKindFromCommandArgs(commandArgs);
					if (!kind) {
						void vscode.window.showErrorMessage('Не указан вид метаданных.');
						return;
					}
					const paths = resolveCfPathsFromMetadataTree();
					if (!paths) {
						void vscode.window.showInformationMessage('Нет открытой папки проекта или выгрузки CF.');
						return;
					}
					const { cfgPath, cfRoot } = paths;
					try {
						await fs.promises.access(cfgPath);
					} catch {
						void vscode.window.showInformationMessage('Не найден Configuration.xml в выгрузке.');
						return;
					}
					try {
						const schema = await mdSparrowSchemaFlagFromConfigurationXml(cfgPath);
						const runtime = await ensureMdSparrowRuntime(context);
						const resolved = await resolveNextBoilerplateMdName(
							runtime,
							cfgPath,
							schema,
							cfRoot,
							kind
						);
						if ('error' in resolved) {
							void vscode.window.showErrorMessage(
								resolved.error.slice(0, MD_SPARROW_CLI_ERR_PREVIEW)
							);
							return;
						}
						const name = resolved.name;
						const addArgs = ['add-md-object', cfgPath, name, '-v', schema, '--type', kind];
						if (kind === 'CATALOG') {
							addArgs.push('--synonym-empty');
						}
						const res = await runMdSparrow(
							runtime,
							addArgs,
							{ cwd: cfRoot }
						);
						if (res.exitCode !== 0) {
							const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
								0,
								MD_SPARROW_CLI_ERR_PREVIEW
							);
							void vscode.window.showErrorMessage(errText);
							return;
						}
						await metadataTreeProvider.refresh();
						void vscode.window.showInformationMessage(`Объект метаданных «${name}» добавлен.`);
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
					}
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.createObject',
			async (...commandArgs: unknown[]) => {
				const sourceKind = parseExternalArtifactSourceKindFromArgs(commandArgs);
				if (sourceKind === 'externalErf') {
					await runMdSparrowMutation(async () => {
						await addExternalArtifact('externalErf');
					});
					return;
				}
				if (sourceKind === 'externalEpf') {
					await runMdSparrowMutation(async () => {
						await addExternalArtifact('externalEpf');
					});
					return;
				}
				const kind = parseMdBoilerplateKindFromCommandArgs(commandArgs);
				if (!kind) {
					void vscode.window.showInformationMessage('Выберите группу метаданных для добавления.');
					return;
				}
				await vscode.commands.executeCommand(
					'1c-platform-tools.metadata.addMdObject',
					kind
				);
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.renameObject',
			async (item?: MetadataLeafTreeItem) => {
				await runMdSparrowMutation(async () => {
					const node = resolveSelectedMetadataLeaf(item);
					if (!(node instanceof MetadataLeafTreeItem) || !node.resourceUri) {
						void vscode.window.showInformationMessage('Выберите объект в дереве метаданных.');
						return;
					}
					if (node.objectType === 'ExternalReport' || node.objectType === 'ExternalDataProcessor') {
						const nextName = await vscode.window.showInputBox({
							title: 'Переименование внешнего файла',
							placeHolder: 'Новое имя',
							value: node.name,
							validateInput: (value) => {
								const trimmed = value.trim();
								if (trimmed.length === 0) {
									return 'Введите имя.';
								}
								if (trimmed === node.name) {
									return 'Укажите имя, отличающееся от текущего.';
								}
								return null;
							},
						});
						if (!nextName) {
							return;
						}
						const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
						const cwd = workspaceRoot ?? path.dirname(node.resourceUri.fsPath);
						const schema = await mdSparrowSchemaFlagFromConfigurationXml(node.resourceUri.fsPath);
						const runtime = await ensureMdSparrowRuntime(context);
						const res = await runMdSparrow(
							runtime,
							[
								'external-artifact-rename',
								node.resourceUri.fsPath,
								'--new-name',
								nextName.trim(),
								'-v',
								schema,
							],
							{ cwd }
						);
						if (res.exitCode !== 0) {
							const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
								0,
								MD_SPARROW_CLI_ERR_PREVIEW
							);
							void vscode.window.showErrorMessage(errText);
							return;
						}
						await metadataTreeProvider.refresh();
						void vscode.window.showInformationMessage(
							`Внешний файл переименован: ${node.name} -> ${nextName.trim()}.`
						);
						return;
					}
					const tag = metadataObjectTypeToXmlTag[node.objectType];
					if (!tag) {
						void vscode.window.showInformationMessage('Переименование для этого типа пока недоступно.');
						return;
					}
					const nextName = await vscode.window.showInputBox({
						title: 'Переименование объекта',
						placeHolder: 'Новое имя объекта',
						value: node.name,
						validateInput: (value) => {
							const trimmed = value.trim();
							if (trimmed.length === 0) {
								return 'Введите имя объекта.';
							}
							if (trimmed === node.name) {
								return 'Укажите имя, отличающееся от текущего.';
							}
							return null;
						},
					});
					if (!nextName) {
						return;
					}
					const cfgPath = node.configurationXmlAbs;
					const cfRoot = node.metadataRootAbs;
					if (!cfgPath || !cfRoot) {
						void vscode.window.showInformationMessage('Нет выгрузки CF или Configuration.xml.');
						return;
					}
					const runtime = await ensureMdSparrowRuntime(context);
					const res = await runMdSparrow(
						runtime,
						[
							'cf-md-object-rename',
							cfgPath,
							node.resourceUri.fsPath,
							'--tag',
							tag,
							'--old-name',
							node.name,
							'--new-name',
							nextName.trim(),
						],
						{ cwd: cfRoot }
					);
					if (res.exitCode !== 0) {
						const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
							0,
							MD_SPARROW_CLI_ERR_PREVIEW
						);
						void vscode.window.showErrorMessage(errText);
						return;
					}
					await metadataTreeProvider.refresh();
					void vscode.window.showInformationMessage(`Объект переименован: ${node.name} -> ${nextName.trim()}.`);
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.deleteObject',
			async (item?: MetadataLeafTreeItem) => {
				await runMdSparrowMutation(async () => {
					const node = resolveSelectedMetadataLeaf(item);
					if (!(node instanceof MetadataLeafTreeItem) || !node.resourceUri) {
						void vscode.window.showInformationMessage('Выберите объект в дереве метаданных.');
						return;
					}
					if (node.objectType === 'ExternalReport' || node.objectType === 'ExternalDataProcessor') {
						const answer = await vscode.window.showWarningMessage(
							`Удалить внешний файл «${node.name}»?`,
							{ modal: true },
							'Удалить'
						);
						if (answer !== 'Удалить') {
							return;
						}
						const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
						const cwd = workspaceRoot ?? path.dirname(node.resourceUri.fsPath);
						const runtime = await ensureMdSparrowRuntime(context);
						const res = await runMdSparrow(
							runtime,
							['external-artifact-delete', node.resourceUri.fsPath],
							{ cwd }
						);
						if (res.exitCode !== 0) {
							const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
								0,
								MD_SPARROW_CLI_ERR_PREVIEW
							);
							void vscode.window.showErrorMessage(errText);
							return;
						}
						await metadataTreeProvider.refresh();
						void vscode.window.showInformationMessage(`Внешний файл «${node.name}» удалён.`);
						return;
					}
					const tag = metadataObjectTypeToXmlTag[node.objectType];
					if (!tag) {
						void vscode.window.showInformationMessage('Удаление для этого типа пока недоступно.');
						return;
					}
					const answer = await vscode.window.showWarningMessage(
						`Удалить объект «${node.name}»?`,
						{ modal: true },
						'Удалить'
					);
					if (answer !== 'Удалить') {
						return;
					}
					const cfgPath = node.configurationXmlAbs;
					const cfRoot = node.metadataRootAbs;
					if (!cfgPath || !cfRoot) {
						void vscode.window.showInformationMessage('Нет выгрузки CF или Configuration.xml.');
						return;
					}
					const runtime = await ensureMdSparrowRuntime(context);
					const res = await runMdSparrow(
						runtime,
						[
							'cf-md-object-delete',
							cfgPath,
							node.resourceUri.fsPath,
							'--tag',
							tag,
							'--name',
							node.name,
						],
						{ cwd: cfRoot }
					);
					if (res.exitCode !== 0) {
						const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
							0,
							MD_SPARROW_CLI_ERR_PREVIEW
						);
						void vscode.window.showErrorMessage(errText);
						return;
					}
					await metadataTreeProvider.refresh();
					void vscode.window.showInformationMessage(`Объект «${node.name}» удалён.`);
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.duplicateObject',
			async (item?: MetadataLeafTreeItem) => {
				await runMdSparrowMutation(async () => {
					const node = resolveSelectedMetadataLeaf(item);
					if (!(node instanceof MetadataLeafTreeItem) || !node.resourceUri) {
						void vscode.window.showInformationMessage('Выберите объект в дереве метаданных.');
						return;
					}
					if (node.objectType === 'ExternalReport' || node.objectType === 'ExternalDataProcessor') {
						const nextName = await vscode.window.showInputBox({
							title: 'Дублирование внешнего файла',
							placeHolder: 'Имя копии',
							value: `${node.name}Копия`,
							validateInput: (value) => {
								if (value.trim().length === 0) {
									return 'Введите имя.';
								}
								return null;
							},
						});
						if (!nextName) {
							return;
						}
						const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
						const cwd = workspaceRoot ?? path.dirname(node.resourceUri.fsPath);
						const schema = await mdSparrowSchemaFlagFromConfigurationXml(node.resourceUri.fsPath);
						const runtime = await ensureMdSparrowRuntime(context);
						const res = await runMdSparrow(
							runtime,
							[
								'external-artifact-duplicate',
								node.resourceUri.fsPath,
								'--new-name',
								nextName.trim(),
								'-v',
								schema,
							],
							{ cwd }
						);
						if (res.exitCode !== 0) {
							const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
								0,
								MD_SPARROW_CLI_ERR_PREVIEW
							);
							void vscode.window.showErrorMessage(errText);
							return;
						}
						await metadataTreeProvider.refresh();
						void vscode.window.showInformationMessage(`Создана копия «${nextName.trim()}».`);
						return;
					}
					const tag = metadataObjectTypeToXmlTag[node.objectType];
					if (!tag) {
						void vscode.window.showInformationMessage('Дублирование для этого типа пока недоступно.');
						return;
					}
					const nextName = await vscode.window.showInputBox({
						title: 'Дублирование объекта',
						placeHolder: 'Имя копии',
						value: `${node.name}Копия`,
						validateInput: (value) => {
							if (value.trim().length === 0) {
								return 'Введите имя объекта.';
							}
							return null;
						},
					});
					if (!nextName) {
						return;
					}
					const cfgPath = node.configurationXmlAbs;
					const cfRoot = node.metadataRootAbs;
					if (!cfgPath || !cfRoot) {
						void vscode.window.showInformationMessage('Нет выгрузки CF или Configuration.xml.');
						return;
					}
					const runtime = await ensureMdSparrowRuntime(context);
					const res = await runMdSparrow(
						runtime,
						[
							'cf-md-object-duplicate',
							cfgPath,
							node.resourceUri.fsPath,
							'--tag',
							tag,
							'--source-name',
							node.name,
							'--new-name',
							nextName.trim(),
						],
						{ cwd: cfRoot }
					);
					if (res.exitCode !== 0) {
						const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
							0,
							MD_SPARROW_CLI_ERR_PREVIEW
						);
						void vscode.window.showErrorMessage(errText);
						return;
					}
					await metadataTreeProvider.refresh();
					void vscode.window.showInformationMessage(`Создана копия «${nextName.trim()}».`);
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.addChildNode',
			async (item?: MetadataObjectNodeTreeItem | MetadataObjectSectionTreeItem | MetadataLeafTreeItem) => {
				await runMdSparrowMutation(async () => {
					const selected = item ?? metadataTreeView.selection[0];
					let leaf: MetadataLeafTreeItem | undefined;
					let args: string[] | undefined;
					let okText: string | undefined;
					if (selected instanceof MetadataObjectNodeTreeItem && selected.nodeKind === 'tabularSection') {
						leaf = selected.owner;
						const name = await vscode.window.showInputBox({
							title: 'Новый реквизит табличной части',
							placeHolder: 'Имя реквизита',
							validateInput: (value) => (!value.trim() ? 'Введите имя.' : null),
						});
						if (!name) {
							return;
						}
						args = [
							'cf-md-tabular-attribute-add',
							leaf.resourceUri?.fsPath ?? '',
							'--tabular-section',
							selected.name,
							'--name',
							name.trim(),
						];
						okText = `Реквизит добавлен в табличную часть «${selected.name}».`;
					} else if (selected instanceof MetadataObjectSectionTreeItem) {
						leaf = selected.owner;
						if (selected.sectionKind !== 'attributes' && selected.sectionKind !== 'tabularSections') {
							void vscode.window.showInformationMessage('В этом разделе добавление не поддерживается.');
							return;
						}
						const title =
							selected.sectionKind === 'attributes' ? 'Новый реквизит' : 'Новая табличная часть';
						const name = await vscode.window.showInputBox({
							title,
							placeHolder: 'Имя',
							validateInput: (value) => (!value.trim() ? 'Введите имя.' : null),
						});
						if (!name) {
							return;
						}
						args =
							selected.sectionKind === 'attributes'
								? ['cf-md-attribute-add', leaf.resourceUri?.fsPath ?? '', '--name', name.trim()]
								: [
										'cf-md-tabular-section-add',
										leaf.resourceUri?.fsPath ?? '',
										'--name',
										name.trim(),
									];
						okText =
							selected.sectionKind === 'attributes'
								? `Реквизит «${name.trim()}» добавлен.`
								: `Табличная часть «${name.trim()}» добавлена.`;
					} else if (selected instanceof MetadataLeafTreeItem) {
						leaf = selected;
						const kind = await vscode.window.showQuickPick(
							[
								{ label: 'Реквизит', value: 'attribute' as const },
								{ label: 'Табличная часть', value: 'tabularSection' as const },
							],
							{ title: 'Что добавить?' }
						);
						if (!kind) {
							return;
						}
						const name = await vscode.window.showInputBox({
							title: kind.value === 'attribute' ? 'Новый реквизит' : 'Новая табличная часть',
							placeHolder: 'Имя',
							validateInput: (value) => (!value.trim() ? 'Введите имя.' : null),
						});
						if (!name) {
							return;
						}
						args =
							kind.value === 'attribute'
								? ['cf-md-attribute-add', leaf.resourceUri?.fsPath ?? '', '--name', name.trim()]
								: [
										'cf-md-tabular-section-add',
										leaf.resourceUri?.fsPath ?? '',
										'--name',
										name.trim(),
									];
						okText =
							kind.value === 'attribute'
								? `Реквизит «${name.trim()}» добавлен.`
								: `Табличная часть «${name.trim()}» добавлена.`;
					} else {
						void vscode.window.showInformationMessage('Выберите объект или табличную часть.');
						return;
					}

					if (!leaf.resourceUri || !leaf.configurationXmlAbs || !leaf.metadataRootAbs) {
						void vscode.window.showInformationMessage('Недостаточно данных для операции.');
						return;
					}
					const schema = await mdSparrowSchemaFlagFromConfigurationXml(leaf.configurationXmlAbs);
					const runtime = await ensureMdSparrowRuntime(context);
					const res = await runMdSparrow(runtime, [...args, '-v', schema], {
						cwd: leaf.metadataRootAbs,
					});
					if (res.exitCode !== 0) {
						const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
							0,
							MD_SPARROW_CLI_ERR_PREVIEW
						);
						void vscode.window.showErrorMessage(errText);
						return;
					}
					await metadataTreeProvider.refresh();
					void vscode.window.showInformationMessage(okText);
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.renameChildNode',
			async (item?: MetadataObjectNodeTreeItem) => {
				await runMdSparrowMutation(async () => {
					const node = resolveChildNodeForMutation(item, 'Этот узел нельзя переименовать.');
					if (!node) {
						return;
					}
					const newName = await vscode.window.showInputBox({
						title: 'Переименование',
						value: node.name,
						validateInput: (value) => (!value.trim() ? 'Введите имя.' : null),
					});
					if (!newName || newName.trim() === node.name) {
						return;
					}
					const args = buildChildNodeMutationArgs(node, 'rename', newName.trim());
					await runChildNodeMutation(node, args, 'Переименование выполнено.');
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.deleteChildNode',
			async (item?: MetadataObjectNodeTreeItem) => {
				await runMdSparrowMutation(async () => {
					const node = resolveChildNodeForMutation(item, 'Этот узел нельзя удалить.');
					if (!node) {
						return;
					}
					const answer = await vscode.window.showWarningMessage(`Удалить «${node.name}»?`, { modal: true }, 'Удалить');
					if (answer !== 'Удалить') {
						return;
					}
					const args = buildChildNodeMutationArgs(node, 'delete', node.name);
					await runChildNodeMutation(node, args, 'Удаление выполнено.');
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.duplicateChildNode',
			async (item?: MetadataObjectNodeTreeItem) => {
				await runMdSparrowMutation(async () => {
					const node = resolveChildNodeForMutation(item, 'Этот узел нельзя дублировать.');
					if (!node) {
						return;
					}
					const newName = await vscode.window.showInputBox({
						title: 'Имя копии',
						value: `${node.name}Копия`,
						validateInput: (value) => (!value.trim() ? 'Введите имя.' : null),
					});
					if (!newName) {
						return;
					}
					const args = buildChildNodeMutationArgs(node, 'duplicate', newName.trim());
					await runChildNodeMutation(node, args, 'Дублирование выполнено.');
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.filterBySubsystem',
			async (item?: MetadataLeafTreeItem) => {
				const node = resolveSelectedMetadataLeaf(item);
				if (!(node instanceof MetadataLeafTreeItem) || node.objectType !== 'Subsystem' || !node.resourceUri) {
					void vscode.window.showInformationMessage('Выберите подсистему в дереве метаданных.');
					return;
				}
				const cfgPath = node.configurationXmlAbs;
				const cfRoot = node.metadataRootAbs;
				if (!cfgPath || !cfRoot) {
					void vscode.window.showInformationMessage('Нет выгрузки CF или Configuration.xml.');
					return;
				}
				const schema = await mdSparrowSchemaFlagFromConfigurationXml(cfgPath);
				const runtime = await ensureMdSparrowRuntime(context);
				const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
				if (!workspaceRoot) {
					void vscode.window.showInformationMessage('Нет открытой папки workspace.');
					return;
				}
				type SubsystemDto = { contentRefs?: unknown[]; nestedSubsystems?: unknown[] };
				const readSubsystemDto = async (subsystemNode: MetadataLeafTreeItem): Promise<SubsystemDto | undefined> => {
					if (!subsystemNode.resourceUri) {
						return undefined;
					}
					const getRes = await runMdSparrow(
						runtime,
						['cf-md-object-get', subsystemNode.resourceUri.fsPath, '-v', schema],
						{ cwd: cfRoot }
					);
					if (getRes.exitCode !== 0) {
						const errText = (getRes.stderr.trim() || getRes.stdout.trim() || `код ${getRes.exitCode}`).slice(
							0,
							MD_SPARROW_CLI_ERR_PREVIEW
						);
						void vscode.window.showErrorMessage(errText);
						return undefined;
					}
					try {
						return JSON.parse(getRes.stdout.trim()) as SubsystemDto;
					} catch {
						void vscode.window.showErrorMessage('Не удалось разобрать состав подсистемы.');
						return undefined;
					}
				};

				const tree = metadataTreeProvider.getCachedTree();
				const subsystemNameToLeaf = new Map<string, MetadataLeafTreeItem>();
				if (tree) {
					for (const src of tree.sources) {
						for (const group of src.groups) {
							for (const subgroup of group.subgroups ?? []) {
								for (const mdItem of subgroup.items) {
									if (mdItem.objectType !== 'Subsystem') {
										continue;
									}
									const rel = mdItem.relativePath?.length ? mdItem.relativePath : undefined;
									const leafNode = new MetadataLeafTreeItem(
										src.id,
										group.id,
										subgroup.id,
										mdItem.objectType,
										mdItem.name,
										rel,
										workspaceRoot,
										src.configurationXmlRelativePath ? path.join(workspaceRoot, src.configurationXmlRelativePath) : undefined,
										src.metadataRootRelativePath ? path.join(workspaceRoot, src.metadataRootRelativePath) : undefined
									);
									subsystemNameToLeaf.set(mdItem.name, leafNode);
								}
							}
						}
					}
				}
				subsystemNameToLeaf.set(node.name, node);

				const visitedSubsystems = new Set<string>();
				const allowedSubsystemNames = new Set<string>();
				const allowedNames = new Set<string>();
				const allowedKeys = new Set<string>();

				const walkSubsystem = async (subsystemLeaf: MetadataLeafTreeItem): Promise<void> => {
					if (visitedSubsystems.has(subsystemLeaf.name)) {
						return;
					}
					visitedSubsystems.add(subsystemLeaf.name);
					allowedSubsystemNames.add(subsystemLeaf.name);
					allowedNames.add(subsystemLeaf.name);
					allowedKeys.add(`Subsystem.${subsystemLeaf.name}`);

					const dto = await readSubsystemDto(subsystemLeaf);
					if (!dto) {
						return;
					}
					const refs = Array.isArray(dto.contentRefs)
						? dto.contentRefs.filter((x): x is string => typeof x === 'string')
						: [];
					for (const name of parseContentRefsToObjectNames(refs)) {
						allowedNames.add(name);
					}
					for (const key of parseContentRefsToObjectKeys(refs)) {
						allowedKeys.add(key);
					}
					const nestedSubsystems = Array.isArray(dto.nestedSubsystems)
						? dto.nestedSubsystems.filter((x): x is string => typeof x === 'string')
						: [];
					for (const nestedName of nestedSubsystems) {
						const nestedLeaf = subsystemNameToLeaf.get(nestedName);
						if (nestedLeaf) {
							await walkSubsystem(nestedLeaf);
						} else {
							allowedSubsystemNames.add(nestedName);
							allowedNames.add(nestedName);
							allowedKeys.add(`Subsystem.${nestedName}`);
						}
					}
				};

				await walkSubsystem(node);
				metadataTreeProvider.setSubsystemFilter(node.name, allowedNames, allowedKeys, allowedSubsystemNames);
				void vscode.commands.executeCommand(
					'setContext',
					'1c-platform-tools.metadata.subsystemFilterActive',
					true
				);
				void vscode.window.showInformationMessage(`Фильтр подсистемы: ${node.name}`);
			}
		),
		vscode.commands.registerCommand('1c-platform-tools.metadata.clearSubsystemFilter', async () => {
			metadataTreeProvider.clearSubsystemFilter();
			void vscode.commands.executeCommand(
				'setContext',
				'1c-platform-tools.metadata.subsystemFilterActive',
				false
			);
			void vscode.window.showInformationMessage('Фильтр подсистемы сброшен.');
		}),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.copyObjectName',
			async (item?: MetadataLeafTreeItem) => {
				const node = resolveSelectedMetadataLeaf(item);
				if (!(node instanceof MetadataLeafTreeItem)) {
					void vscode.window.showInformationMessage('Выберите объект в дереве метаданных.');
					return;
				}
				await vscode.env.clipboard.writeText(node.name);
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.copyObjectPath',
			async (item?: MetadataLeafTreeItem) => {
				const node = resolveSelectedMetadataLeaf(item);
				if (!(node instanceof MetadataLeafTreeItem) || !node.resourceUri) {
					void vscode.window.showInformationMessage('Выберите объект с файлом в дереве метаданных.');
					return;
				}
				await vscode.env.clipboard.writeText(node.resourceUri.fsPath);
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openExternalConnectionModule',
			async (item?: MetadataSourceTreeItem) => {
				const source = resolveSelectedMetadataSource(item);
				if (!source || (source.sourceKind !== 'main' && source.sourceKind !== 'extension')) {
					void vscode.window.showInformationMessage('Выберите конфигурацию или расширение.');
					return;
				}
				const modulePath = await resolveModulePathForSource(source, 'ExternalConnectionModule.bsl');
				if (!modulePath) {
					void vscode.window.showInformationMessage('Модуль внешнего соединения не найден.');
					return;
				}
				await openTextFile(modulePath);
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openApplicationModule',
			async (item?: MetadataSourceTreeItem) => {
				const source = resolveSelectedMetadataSource(item);
				if (!source || (source.sourceKind !== 'main' && source.sourceKind !== 'extension')) {
					void vscode.window.showInformationMessage('Выберите конфигурацию или расширение.');
					return;
				}
				const managed = await resolveModulePathForSource(source, 'ManagedApplicationModule.bsl');
				const ordinary = await resolveModulePathForSource(source, 'OrdinaryApplicationModule.bsl');
				const modulePath = managed ?? ordinary;
				if (!modulePath) {
					void vscode.window.showInformationMessage('Модуль приложения не найден.');
					return;
				}
				await openTextFile(modulePath);
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openSessionModule',
			async (item?: MetadataSourceTreeItem) => {
				const source = resolveSelectedMetadataSource(item);
				if (!source || (source.sourceKind !== 'main' && source.sourceKind !== 'extension')) {
					void vscode.window.showInformationMessage('Выберите конфигурацию или расширение.');
					return;
				}
				const modulePath = await resolveModulePathForSource(source, 'SessionModule.bsl');
				if (!modulePath) {
					void vscode.window.showInformationMessage('Модуль сеанса не найден.');
					return;
				}
				await openTextFile(modulePath);
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openSourceProperties',
			async (item?: MetadataSourceTreeItem | MetadataLeafTreeItem) => {
				const source = resolveSelectedMetadataSource(
					item instanceof MetadataSourceTreeItem ? item : undefined
				);
				if (source?.configurationXmlAbs && source.metadataRootAbs) {
					await runMdSparrowMutation(async () => {
						try {
							const { schema, dto } = await loadSourcePropertiesDto(
								source.configurationXmlAbs!,
								source.metadataRootAbs!
							);
							await openMetadataSourcePropertiesPanel(
								context,
								{
									label: typeof source.label === 'string' ? source.label : source.sourceId,
									sourceKind: source.sourceKind,
								},
								dto,
								async (nextDto) => {
									const saved = await saveSourcePropertiesDto(
										source.configurationXmlAbs!,
										source.metadataRootAbs!,
										schema,
										nextDto
									);
									if (!saved) {
										return false;
									}
									void vscode.window.showInformationMessage('Свойства сохранены.');
									await metadataTreeProvider.refresh();
									return true;
								},
								async (moduleKind) => {
									if (moduleKind === 'externalConnection') {
										await vscode.commands.executeCommand(
											'1c-platform-tools.metadata.openExternalConnectionModule',
											source
										);
										return;
									}
									if (moduleKind === 'application') {
										await vscode.commands.executeCommand(
											'1c-platform-tools.metadata.openApplicationModule',
											source
										);
										return;
									}
									await vscode.commands.executeCommand(
										'1c-platform-tools.metadata.openSessionModule',
										source
									);
								}
							);
						} catch (e) {
							const msg = e instanceof Error ? e.message : String(e);
							void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
						}
					});
					return;
				}
				if (
					source?.sourceKind &&
					(source.sourceKind === 'externalErf' || source.sourceKind === 'externalEpf')
				) {
					const items = await listExternalArtifactXmlFromSource(source);
					if (items.length === 0) {
						void vscode.window.showInformationMessage('Внешние файлы не найдены.');
						return;
					}
					if (items.length === 1) {
						await openExternalArtifactPropertiesEditor(
							items[0].xmlPath,
							items[0].name,
							items[0].objectType
						);
						return;
					}
					const picked = await vscode.window.showQuickPick(
						items.map((x) => ({ label: x.name, description: x.xmlPath, item: x })),
						{ title: 'Выберите внешний файл' }
					);
					if (!picked) {
						return;
					}
					await openExternalArtifactPropertiesEditor(
						picked.item.xmlPath,
						picked.item.name,
						picked.item.objectType
					);
					return;
				}
				const node = resolveSelectedMetadataLeaf(
					item instanceof MetadataLeafTreeItem ? item : undefined
				);
				if (
					node instanceof MetadataLeafTreeItem &&
					node.resourceUri &&
					(node.objectType === 'ExternalReport' || node.objectType === 'ExternalDataProcessor')
				) {
					await openExternalArtifactPropertiesEditor(
						node.resourceUri.fsPath,
						node.name,
						node.objectType as 'ExternalReport' | 'ExternalDataProcessor'
					);
					return;
				}
				if (node?.resourceUri) {
					await openTextFile(node.resourceUri.fsPath);
					return;
				}
				void vscode.window.showInformationMessage('Свойства для выбранного узла недоступны.');
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openSourceXml',
			async (item?: MetadataSourceTreeItem | MetadataLeafTreeItem) => {
				const source = resolveSelectedMetadataSource(
					item instanceof MetadataSourceTreeItem ? item : undefined
				);
				if (source?.configurationXmlAbs) {
					await openTextFile(source.configurationXmlAbs);
					return;
				}
				if (source?.metadataRootAbs) {
					const firstXml = await resolveFirstXmlInDir(source.metadataRootAbs);
					if (firstXml) {
						await openTextFile(firstXml);
						return;
					}
				}
				const node = resolveSelectedMetadataLeaf(
					item instanceof MetadataLeafTreeItem ? item : undefined
				);
				if (node?.resourceUri) {
					await openTextFile(node.resourceUri.fsPath);
					return;
				}
				void vscode.window.showInformationMessage('XML для выбранного узла не найден.');
			}
		),
		vscode.commands.registerCommand('1c-platform-tools.metadata.initEmptyCf', async () => {
			await runMdSparrowMutation(async () => {
				const cfRoot = metadataTreeProvider.resolveCfRoot();
				if (!cfRoot) {
					void vscode.window.showInformationMessage('Нет открытой папки проекта или выгрузки CF.');
					return;
				}
				const configurationXmlPath = path.join(cfRoot, 'Configuration.xml');
				let hasConfigurationXml = false;
				try {
					await fs.promises.access(configurationXmlPath);
					hasConfigurationXml = true;
				} catch {
					/* нет корня выгрузки */
				}
				if (hasConfigurationXml) {
					const answer = await vscode.window.showWarningMessage(
						'Уже есть конфигурация. Все метаданные будут удалены. Продолжить?',
						{ modal: true },
						'Продолжить'
					);
					if (answer !== 'Продолжить') {
						return;
					}
				}
				const schema = await pickSchemaFlagInitEmptyCf(configurationXmlPath);
				if (!schema) {
					return;
				}
				try {
					const runtime = await ensureMdSparrowRuntime(context);
					const res = await runMdSparrow(
						runtime,
						['init-empty-cf', cfRoot, '-v', schema],
						{ cwd: cfRoot }
					);
					if (res.exitCode !== 0) {
						const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
							0,
							MD_SPARROW_CLI_ERR_PREVIEW
						);
						void vscode.window.showErrorMessage(errText);
						return;
					}
					await metadataTreeProvider.refresh();
					void vscode.window.showInformationMessage('Пустая конфигурация создана.');
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
				}
			});
		}),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openObjectProperties',
			async (item?: MetadataLeafTreeItem) => {
				let node = item;
				if (!node && metadataTreeView.selection.length > 0) {
					const sel = metadataTreeView.selection[0];
					if (sel instanceof MetadataLeafTreeItem) {
						node = sel;
					}
				}
				if (!(node instanceof MetadataLeafTreeItem) || !node.resourceUri) {
					void vscode.window.showInformationMessage('Выберите объект в дереве метаданных.');
					return;
				}
				let schemaFlagFallback: string | undefined;
				if (!node.configurationXmlAbs) {
					schemaFlagFallback = metadataTreeProvider.getCachedTree()?.mainSchemaVersionFlag;
					if (!schemaFlagFallback) {
						const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
						if (workspaceRoot) {
							const dto = await loadProjectMetadataTree(context, workspaceRoot);
							schemaFlagFallback = dto.mainSchemaVersionFlag;
						}
					}
				}
				if (!node.configurationXmlAbs && !schemaFlagFallback) {
					void vscode.window.showInformationMessage('Не удалось определить схему для чтения свойств.');
					return;
				}
				await openMetadataObjectPropertiesEditor(
					context,
					{
						objectXmlFsPath: node.resourceUri.fsPath,
						cfgPath: node.configurationXmlAbs,
						schemaFlag: schemaFlagFallback,
						cwd: node.metadataRootAbs ?? path.dirname(node.resourceUri.fsPath),
						objectType: node.objectType,
					}
				);
			}
		),
		vscode.commands.registerCommand('1c-platform-tools.metadata.getProjectTree', async () => {
			const cached = metadataTreeProvider.getCachedTree();
			if (cached) {
				return cached;
			}
			const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!root) {
				return undefined;
			}
			return loadProjectMetadataTree(context, root);
		}),
		vscode.commands.registerCommand('1c-platform-tools.metadata.updateMdSparrow', async () => {
			const pick = await vscode.window.showQuickPick(
				[
					{ label: 'Только JAR', value: 'jar' as const },
					{ label: 'JAR и portable JRE', value: 'all' as const },
				],
				{ title: 'Сбросить кэш' }
			);
			if (!pick) {
				return;
			}
			await clearMdSparrowDownloadCache(context, pick.value === 'all');
			void vscode.window.showInformationMessage(
				'Кэш очищен. При следующем действии JAR и при необходимости JRE будут загружены снова.'
			);
			void metadataTreeProvider.refresh();
		}),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('1c-platform-tools.metadata')) {
				void metadataTreeProvider.refresh();
			}
		})
	);

	if (isProject) {
		void metadataTreeProvider.refresh();
	}

	// Дерево создаём всегда: при отсутствии проекта панель скрыта (when), после создания packagedef — показывается
	const treeDataProvider = new PlatformTreeDataProvider(
		context.extensionUri,
		commands.setVersion,
		context
	);

	const treeView = vscode.window.createTreeView('1c-platform-tools', {
		treeDataProvider: treeDataProvider,
		showCollapseAll: true,
	});

	// Сохранение состояния раскрытия групп (кроме «Избранное») в globalState
	const saveGroupExpandedState = (element: unknown, expanded: boolean): void => {
		if (!(element instanceof PlatformTreeItem) || !element.groupId) {
			return;
		}
		const state = context.globalState.get<Record<string, boolean>>(TREE_GROUP_EXPANDED_STATE_KEY) ?? {};
		state[element.groupId] = expanded;
		void context.globalState.update(TREE_GROUP_EXPANDED_STATE_KEY, state);
	};
	context.subscriptions.push(
		treeView.onDidExpandElement((e) => saveGroupExpandedState(e.element, true)),
		treeView.onDidCollapseElement((e) => saveGroupExpandedState(e.element, false))
	);

	// После создания packagedef из палитры — полная активация: контекст и обновление дерева
	setOnProjectCreated(() => {
		isProjectRef.current = true;
		void vscode.commands.executeCommand('setContext', '1c-platform-tools.is1CProject', true);
		treeDataProvider.refresh();
		void artifactsProvider.refresh();
		void metadataTreeProvider.refresh();
	});

	// Если проект только что создан через «Создать проект 1С» с опцией установки зависимостей — запускаем установку после открытия папки
	const installAfterCreatePath = context.globalState.get<string>(DependenciesCommands.INSTALL_DEPS_AFTER_CREATE_KEY);
	const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (installAfterCreatePath && wsRoot && path.normalize(installAfterCreatePath) === path.normalize(wsRoot)) {
		void context.globalState.update(DependenciesCommands.INSTALL_DEPS_AFTER_CREATE_KEY, undefined);
		setImmediate(() => void commands.dependencies.installDependencies());
	}

	registerGetStarted(context);
	showGetStartedOnFirstRun(context);

	const openCreateIssueCommand = vscode.commands.registerCommand('1c-platform-tools.help.openCreateIssue', () => {
		void vscode.env.openExternal(
			vscode.Uri.parse('https://github.com/yellow-hammer/vscode-1c-platform-tools/issues/new?template=bug_report.md')
		);
	});
	const openWriteReviewCommand = vscode.commands.registerCommand('1c-platform-tools.help.openWriteReview', () => {
		void vscode.env.openExternal(
			vscode.Uri.parse('https://marketplace.visualstudio.com/items?itemName=yellow-hammer.1c-platform-tools&ssr=false#review-details')
		);
	});
	const openSponsorCommand = vscode.commands.registerCommand('1c-platform-tools.help.openSponsor', () => {
		void vscode.env.openExternal(
			vscode.Uri.parse('https://github.com/yellow-hammer/vscode-1c-platform-tools?tab=readme-ov-file#%D0%B0%D0%B2%D1%82%D0%BE%D1%80')
		);
	});

	// Сначала регистрируем представление «Помощь и поддержка» и команды проектов, чтобы при сбое showTreeViews()
	// (например в упакованном расширении) панель и команды уже были доступны и не было «command not found» / «нет поставщика данных».
	const helpAndSupportProvider = new HelpAndSupportProvider();
	const helpAndSupportTreeView = vscode.window.createTreeView('1c-platform-tools-projects-help', {
		treeDataProvider: helpAndSupportProvider,
		showCollapseAll: false,
	});
	const metadataHelpTreeView = vscode.window.createTreeView('1c-platform-tools-metadata-help', {
		treeDataProvider: helpAndSupportProvider,
		showCollapseAll: false,
	});
	context.subscriptions.push(helpAndSupportTreeView, metadataHelpTreeView);
	registerProjectsDecoration(context);
	showStatusBar(projectStorage, oneCLocator);
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			showStatusBar(projectStorage, oneCLocator);
		})
	);
	registerRunCommandFileWatcher(context);
	const projectsCommandDisposables = registerProjectsCommands(
		context,
		projectStorage,
		oneCLocator,
		providers,
		stack
	);

	// Панель «Проекты 1С»: загрузка данных (локация проектов). Не даём сбою здесь прервать активацию.
	try {
		await providers.showTreeViews();
	} catch (err) {
		logger.error(`Ошибка при загрузке списка проектов 1С: ${String(err)}`);
	}

	try {
		fs.watch(path.dirname(projectFilePath), (_, filename) => {
			if (filename === 'projects.json') {
				projectStorage.load();
				providers.refreshStorage();
			}
		});
	} catch {
		// Папка может не существовать
	}
	const onProjectsConfigChange = vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('1c-platform-tools.projects')) {
			void oneCLocator.refreshProjects(true).then(() => {
				providers.refreshAll();
				providers.updateStorageTitle();
				providers.updateAutodetectTitle();
			});
		}
		if (e.affectsConfiguration('1c-platform-tools.artifacts.exclude')) {
			void artifactsProvider.refresh();
		}
	});

	// Обновление артефактов при создании, удалении, переносе файлов
	const artifactsRefreshDebounce = { timer: undefined as ReturnType<typeof setTimeout> | undefined };
	const scheduleArtifactsRefresh = (): void => {
		if (!isProjectRef.current) {
			return;
		}
		if (artifactsRefreshDebounce.timer) {
			clearTimeout(artifactsRefreshDebounce.timer);
		}
		artifactsRefreshDebounce.timer = setTimeout(() => {
			artifactsRefreshDebounce.timer = undefined;
			void artifactsProvider.refresh();
		}, 1000);
	};
	const artifactPatterns = [
		'**/*.feature',
		'**/*.cf',
		'**/*.cfe',
		'**/*.epf',
		'**/*.erf',
		'**/Configuration.xml',
	];
	const artifactWatchers = artifactPatterns.flatMap((pattern) => {
		const w = vscode.workspace.createFileSystemWatcher(pattern);
		return [
			w.onDidCreate(scheduleArtifactsRefresh),
			w.onDidDelete(scheduleArtifactsRefresh),
			w,
		];
	});
	context.subscriptions.push(
		...artifactWatchers,
		{
			dispose: () => {
				if (artifactsRefreshDebounce.timer) {
					clearTimeout(artifactsRefreshDebounce.timer);
				}
			},
		}
	);

	const showGetStartedForPath = context.globalState.get<string>('1c-platform-tools.showGetStartedForPath');
	if (showGetStartedForPath && wsRoot && path.normalize(showGetStartedForPath) === path.normalize(wsRoot)) {
		void context.globalState.update('1c-platform-tools.showGetStartedForPath', undefined);
		openGetStartedWalkthrough(context, { scheduleDelayMs: 500 });
	}

	const refreshCommand = vscode.commands.registerCommand('1c-platform-tools.refresh', () => {
		if (!isProjectRef.current) {
			showNot1CProjectMessage();
			return;
		}
		treeDataProvider.refresh();
		logger.debug('Дерево обновлено');
		vscode.window.showInformationMessage('Дерево обновлено');
	});

	const artifactsRefreshCommand = vscode.commands.registerCommand(
		'1c-platform-tools.artifacts.refresh',
		async () => {
			if (!isProjectRef.current) {
				showNot1CProjectMessage();
				return;
			}
			await artifactsProvider.refresh();
			logger.debug('Дерево артефактов обновлено');
			vscode.window.showInformationMessage('Дерево артефактов обновлено');
		}
	);

	const updateArtifactsViewContext = (): void => {
		const mode = artifactsProvider.getFeaturesViewMode();
		void vscode.commands.executeCommand(
			'setContext',
			'1c-platform-tools.artifacts.viewAsList',
			mode === 'list'
		);
	};
	updateArtifactsViewContext();

	const artifactsViewAsListCommand = vscode.commands.registerCommand(
		'1c-platform-tools.artifacts._viewAsList',
		async () => {
			await artifactsProvider.setFeaturesViewMode('list' as FeaturesViewMode);
		}
	);

	const artifactsViewByFolderCommand = vscode.commands.registerCommand(
		'1c-platform-tools.artifacts._viewByFolder',
		async () => {
			await artifactsProvider.setFeaturesViewMode('folder' as FeaturesViewMode);
		}
	);

	const SETTINGS_EXT = '@ext:yellow-hammer.1c-platform-tools';
	const settingsCommand = vscode.commands.registerCommand('1c-platform-tools.settings', async () => {
		const choice = await vscode.window.showQuickPick(
			[
				{ label: '$(plug) Сервер IPC', detail: 'MCP, порт, токен', filter: '1c-platform-tools.ipc' },
				{ label: '$(tools) Инструменты', detail: 'vrunner, пути, docker, allure', filter: '1c-platform-tools' },
				{ label: '$(folder-opened) Проекты', detail: 'baseFolders, исключения, избранное', filter: '1c-platform-tools.projects.' },
				{ label: '$(package) Артефакты', detail: 'исключения при сканировании', filter: '1c-platform-tools.artifacts' },
				{ label: '$(checklist) Список дел', detail: 'паттерны, исключения, теги', filter: '1c-platform-tools.todo' },
				{
					label: '$(list-tree) Метаданные 1С',
					detail: 'дерево метаданных, JAR, JRE',
					filter: '1c-platform-tools.metadata.',
				},
				{ label: '$(settings-gear) Общее', detail: 'все настройки расширения', filter: '' },
			],
			{ placeHolder: 'Раздел настроек' }
		);
		let query = '';
		if (choice) {
			query = choice.filter ? `${SETTINGS_EXT} ${choice.filter}` : SETTINGS_EXT;
		}
		if (query) {
			await vscode.commands.executeCommand('workbench.action.openSettings', query);
		}
	});
	vscode.commands.registerCommand('1c-platform-tools.settings.openProjects', () =>
		vscode.commands.executeCommand('workbench.action.openSettings', `${SETTINGS_EXT} 1c-platform-tools.projects.`)
	);
	vscode.commands.registerCommand('1c-platform-tools.settings.openTools', () =>
		vscode.commands.executeCommand('workbench.action.openSettings', SETTINGS_EXT)
	);
	vscode.commands.registerCommand('1c-platform-tools.settings.openTodo', () =>
		vscode.commands.executeCommand('workbench.action.openSettings', `${SETTINGS_EXT} 1c-platform-tools.todo`)
	);
	vscode.commands.registerCommand('1c-platform-tools.settings.openArtifacts', () =>
		vscode.commands.executeCommand('workbench.action.openSettings', `${SETTINGS_EXT} 1c-platform-tools.artifacts`)
	);
	vscode.commands.registerCommand('1c-platform-tools.settings.openMetadata', () =>
		vscode.commands.executeCommand(
			'workbench.action.openSettings',
			`${SETTINGS_EXT} 1c-platform-tools.metadata.`
		)
	);
	vscode.commands.registerCommand('1c-platform-tools.settings.openIpc', () =>
		vscode.commands.executeCommand('workbench.action.openSettings', `${SETTINGS_EXT} 1c-platform-tools.ipc`)
	);
	vscode.commands.registerCommand('1c-platform-tools.settings.openGeneral', () =>
		vscode.commands.executeCommand('workbench.action.openSettings', SETTINGS_EXT)
	);

	const launchViewCommand = vscode.commands.registerCommand('1c-platform-tools.launch.view', () => {
		if (!isProjectRef.current) {
			showNot1CProjectMessage();
			return;
		}
		treeDataProvider.refresh();
	});

	const launchRunCommand = vscode.commands.registerCommand('1c-platform-tools.launch.run', async (taskLabel: string) => {
		if (!isProjectRef.current) {
			showNot1CProjectMessage();
			return;
		}
		await commands.workspaceTasks.runTask(taskLabel);
	});

	const oscriptRunCommand = vscode.commands.registerCommand('1c-platform-tools.oscript.run', async (taskName: string) => {
		if (!isProjectRef.current) {
			showNot1CProjectMessage();
			return;
		}
		await commands.oscriptTasks.runOscriptTask(taskName);
	});

	const oscriptAddTaskCommand = vscode.commands.registerCommand('1c-platform-tools.oscript.addTask', async () => {
		if (!isProjectRef.current) {
			showNot1CProjectMessage();
			return;
		}
		await commands.oscriptTasks.addOscriptTask();
		treeDataProvider.refresh();
	});

	const launchEditCommand = vscode.commands.registerCommand('1c-platform-tools.launch.edit', () => {
		if (!isProjectRef.current) {
			showNot1CProjectMessage();
			return;
		}
		commands.workspaceTasks.editTasks();
	});

	const fileOpenCommand = vscode.commands.registerCommand('1c-platform-tools.file.open', async (filePath: string) => {
		if (!isProjectRef.current) {
			showNot1CProjectMessage();
			return;
		}
		const uri = vscode.Uri.file(filePath);
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc);
	});

	const todoOpenLocationCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo.openLocation',
		async (uriArg: string | vscode.Uri, line: number) => {
			const uri = typeof uriArg === 'string' ? vscode.Uri.parse(uriArg) : uriArg;
			const doc = await vscode.workspace.openTextDocument(uri);
			const lineIndex = Math.max(0, (line ?? 1) - 1);
			const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
			await vscode.window.showTextDocument(doc, { selection: range, preview: false });
		}
	);

	const todoShowPanelCommand = vscode.commands.registerCommand('1c-platform-tools.todo.showPanel', async () => {
		await vscode.commands.executeCommand('workbench.view.extension.1c-platform-tools-todo');
		await todoPanelProvider.refresh();
	});

	const todoRefreshCommand = vscode.commands.registerCommand('1c-platform-tools.todo.refresh', async () => {
		await todoPanelProvider.refresh();
	});

	const todoGroupByHierarchyKey = '1c-platform-tools.todo.groupByHierarchy';
	const updateTodoGroupByContext = (): void => {
		const groupBy = todoPanelProvider.getGroupByFile();
		void vscode.commands.executeCommand('setContext', todoGroupByHierarchyKey, groupBy);
	};

	const todoToggleGroupByCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo.toggleGroupBy',
		async () => {
			const next = !todoPanelProvider.getGroupByFile();
			await todoPanelProvider.setGroupByFile(next);
			updateTodoGroupByContext();
		}
	);

	const todoViewAsListCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo._viewAsList',
		async () => {
			await todoPanelProvider.setGroupByFile(false);
			updateTodoGroupByContext();
		}
	);

	const todoViewAsHierarchyCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo._viewAsHierarchy',
		async () => {
			await todoPanelProvider.setGroupByFile(true);
			updateTodoGroupByContext();
		}
	);

	const todoClearFilterCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo.clearFilter',
		async () => {
			await todoPanelProvider.clearAllFilters();
		}
	);

	type ScopeQuickPickItem = vscode.QuickPickItem & { scope: FilterScope };
	type TagQuickPickItem = vscode.QuickPickItem & { tag: string };
	const scopeItems: ScopeQuickPickItem[] = [
		{ label: '$(folder-opened)  Весь проект', description: 'Все файлы по маске сканирования', scope: 'all' },
		{ label: '$(file-text)  Текущий открытый файл', description: 'Только дела в активном редакторе', scope: 'currentFile' },
		{ label: '$(markdown)  Markdown', description: 'Файлы .md', scope: 'md' },
		{ label: '$(code)  BSL', description: 'Модули .bsl', scope: 'bsl' },
		{ label: '$(file-code)  OScript', description: 'Файлы .os', scope: 'os' },
		{ label: '$(beaker)  Feature', description: 'Сценарии Gherkin .feature', scope: 'feature' },
	];
	const todoFilterByScopeCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo.filterByScope',
		async () => {
			const config = vscode.workspace.getConfiguration('1c-platform-tools');
			const tags = config.get<string[]>('todo.tags') ?? ['TODO', 'FIXME', 'XXX', 'HACK', 'BUG'];
			const scopeSet = new Set(scopeItems.map((i) => i.scope));
			const tagItems: TagQuickPickItem[] = tags.map((tag) => ({
				label: `$(tag)  ${tag}`,
				description: '',
				tag,
			}));
			const items: (ScopeQuickPickItem | TagQuickPickItem | vscode.QuickPickItem)[] = [
				{ label: 'Область', kind: vscode.QuickPickItemKind.Separator },
				scopeItems[0],
				scopeItems[1],
				{ label: 'По типу файла', kind: vscode.QuickPickItemKind.Separator },
				...scopeItems.slice(2),
				{ label: 'Теги', kind: vscode.QuickPickItemKind.Separator },
				...tagItems,
			];
			const chosen = await vscode.window.showQuickPick(items, {
				title: 'Список дел: область или тег',
				placeHolder: 'Выберите одну область, тип файла или один тег',
				matchOnDescription: true,
			});
			if (chosen === undefined) {
				return;
			}
			if ('scope' in chosen && scopeSet.has(chosen.scope)) {
				await todoPanelProvider.setFilterScope(chosen.scope);
				await todoPanelProvider.setFilterTags(null);
			} else if ('tag' in chosen) {
				await todoPanelProvider.setFilterScope('all');
				await todoPanelProvider.setFilterTags([chosen.tag]);
			}
		}
	);

	const todoFilterByTagCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo.filterByTag',
		async () => {
			await vscode.commands.executeCommand('1c-platform-tools.todo.filterByScope');
		}
	);

	const launchEditConfigurationsCommand = vscode.commands.registerCommand('1c-platform-tools.launch.editConfigurations', () => {
		if (!isProjectRef.current) {
			showNot1CProjectMessage();
			return;
		}
		commands.workspaceTasks.editLaunchConfigurations();
	});

	const onWorkspaceTasksSave = vscode.workspace.onDidSaveTextDocument((document) => {
		if (!isProjectRef.current) {
			return;
		}
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return;
		}
		const relativePath = vscode.workspace.asRelativePath(document.uri);
		if (relativePath === '.vscode/tasks.json' || relativePath === '.vscode/launch.json') {
			treeDataProvider.refresh();
		}
	});

	// При фильтре «текущий файл» обновлять список при смене активного редактора
	const onTodoActiveEditorChange = vscode.window.onDidChangeActiveTextEditor(() => {
		if (todoPanelProvider.getFilterScope() === 'currentFile') {
			todoPanelProvider.refreshView();
		}
	});

	// Обновление списка дел при сохранении релевантного файла (дебаунс 1.5 с)
	const todoSaveDebounce = { timer: undefined as ReturnType<typeof setTimeout> | undefined };
	const onTodoRelevantSave = vscode.workspace.onDidSaveTextDocument((doc) => {
		if (!isProjectRef.current) {
			return;
		}
		if (!/\.(bsl|os|md|feature)$/i.test(doc.uri.fsPath)) {
			return;
		}
		if (todoSaveDebounce.timer) {
			clearTimeout(todoSaveDebounce.timer);
		}
		todoSaveDebounce.timer = setTimeout(() => {
			todoSaveDebounce.timer = undefined;
			void todoPanelProvider.refresh();
		}, 1500);
	});

	const favoritesConfigureCommand = vscode.commands.registerCommand(
		'1c-platform-tools.favorites.configure',
		async () => {
			if (!isProjectRef.current) {
				showNot1CProjectMessage();
				return;
			}
			const groups = getPickableCommandsByGroup();
			const currentFavorites = getFavorites(context);
			const favoriteKeys = new Set(
				currentFavorites.map((f) => `${f.command}|${JSON.stringify(f.arguments ?? [])}`)
			);

			const items: vscode.QuickPickItem[] = [];

			for (const group of groups) {
				if (group.sectionType === 'config') {
					continue;
				}
				items.push({
					label: group.groupLabel,
					kind: vscode.QuickPickItemKind.Separator,
				});

				if (group.sectionType === 'setVersion') {
					for (const cmd of group.commands) {
						items.push({
							label: cmd.treeLabel,
							description: cmd.command,
							picked: favoriteKeys.has(`${cmd.command}|[]`),
							command: cmd.command,
							title: cmd.title,
							groupLabel: group.groupLabel,
							sectionType: group.sectionType,
						} as FavoritesSelectableItem);
					}
					await pushSetVersionDynamicItems(items, group, favoriteKeys, commands.setVersion);
				} else {
					for (const cmd of group.commands) {
						items.push({
							label: cmd.treeLabel,
							description: cmd.command,
							picked: favoriteKeys.has(`${cmd.command}|[]`),
							command: cmd.command,
							title: cmd.title,
							groupLabel: group.groupLabel,
							sectionType: group.sectionType,
						} as FavoritesSelectableItem);
					}
				}
			}

			await pushOscriptTasksItems(items, favoriteKeys, commands.oscriptTasks);

			const configGroup = groups.find((g) => g.sectionType === 'config');
			if (configGroup) {
				items.push({
					label: configGroup.groupLabel,
					kind: vscode.QuickPickItemKind.Separator,
				});
				for (const cmd of configGroup.commands) {
					items.push({
						label: cmd.treeLabel,
						description: cmd.command,
						picked: favoriteKeys.has(`${cmd.command}|[]`),
						command: cmd.command,
						title: cmd.title,
						groupLabel: configGroup.groupLabel,
						sectionType: configGroup.sectionType,
					} as FavoritesSelectableItem);
				}
			}

			const selected = await vscode.window.showQuickPick(items, {
				canPickMany: true,
				placeHolder: 'Выберите команды для избранного (отмечены — в избранном)',
				matchOnDescription: true,
			});
			if (selected === undefined) {
				return;
			}
			const newFavorites: FavoriteEntry[] = (selected as FavoritesSelectableItem[])
				.filter((item) => item.command !== undefined)
				.map((item) => ({
					command: item.command,
					title: item.title,
					groupLabel: item.groupLabel,
					sectionType: item.sectionType,
					arguments: item.arguments,
				}));
			await setFavorites(context, newFavorites);
			treeDataProvider.refresh();
			logger.info(`Избранное обновлено: ${newFavorites.length} команд`);
			vscode.window.showInformationMessage(
				`Избранное обновлено: ${newFavorites.length} команд`
			);
		}
	);

	context.subscriptions.push(
		openCreateIssueCommand,
		openWriteReviewCommand,
		openSponsorCommand,
		treeView,
		artifactsRefreshCommand,
		artifactsViewAsListCommand,
		artifactsViewByFolderCommand,
		...projectsCommandDisposables,
		onProjectsConfigChange,
		refreshCommand,
		settingsCommand,
		favoritesConfigureCommand,
		launchViewCommand,
		launchRunCommand,
		oscriptRunCommand,
		oscriptAddTaskCommand,
		launchEditCommand,
		fileOpenCommand,
		todoOpenLocationCommand,
		todoShowPanelCommand,
		todoRefreshCommand,
		todoToggleGroupByCommand,
		todoViewAsListCommand,
		todoViewAsHierarchyCommand,
		todoFilterByTagCommand,
		todoFilterByScopeCommand,
		todoClearFilterCommand,
		todoPanelProvider.onDidChangeTreeData(updateTodoGroupByContext),
		launchEditConfigurationsCommand,
		onWorkspaceTasksSave,
		onTodoActiveEditorChange,
		onTodoRelevantSave,
		{
			dispose: () => {
				if (todoSaveDebounce.timer) {
					clearTimeout(todoSaveDebounce.timer);
				}
			},
		},
		...commandDisposables
	);

	startIpcServer(context);
}

export function deactivate() {
	logger.dispose();
}
