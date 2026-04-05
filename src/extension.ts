import * as fs from 'node:fs';
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
	});

	// Если проект только что создан через «Создать проект 1С» с опцией установки зависимостей — запускаем установку после открытия папки
	const installAfterCreatePath = context.globalState.get<string>(DependenciesCommands.INSTALL_DEPS_AFTER_CREATE_KEY);
	const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (installAfterCreatePath && wsRoot && path.normalize(installAfterCreatePath) === path.normalize(wsRoot)) {
		void context.globalState.update(DependenciesCommands.INSTALL_DEPS_AFTER_CREATE_KEY, undefined);
		setImmediate(() => void commands.dependencies.installDependencies());
	}

	// Панель «Начало работы» — открывается в редакторе по команде; при первом запуске после установки — показываем автоматически
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
	context.subscriptions.push(helpAndSupportTreeView);
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

	// Открыть «Начало работы» в редакторе при первом открытии только что созданного проекта
	const showGetStartedForPath = context.globalState.get<string>('1c-platform-tools.showGetStartedForPath');
	if (showGetStartedForPath && wsRoot && path.normalize(showGetStartedForPath) === path.normalize(wsRoot)) {
		void context.globalState.update('1c-platform-tools.showGetStartedForPath', undefined);
		setImmediate(() => openGetStartedWalkthrough(context));
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
				{ label: '$(folder-opened) Проекты', detail: 'baseFolders, исключения, избранное', filter: '1c-platform-tools.projects' },
				{ label: '$(package) Артефакты', detail: 'исключения при сканировании', filter: '1c-platform-tools.artifacts' },
				{ label: '$(checklist) Список дел', detail: 'паттерны, исключения, теги', filter: '1c-platform-tools.todo' },
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
		vscode.commands.executeCommand('workbench.action.openSettings', `${SETTINGS_EXT} 1c-platform-tools.projects`)
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
