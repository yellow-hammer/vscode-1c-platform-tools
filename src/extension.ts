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
import { DependenciesCommands } from './commands/dependenciesCommands';
import { RunCommands } from './commands/runCommands';
import { TestCommands } from './commands/testCommands';
import { SetVersionCommands } from './commands/setVersionCommands';
import { WorkspaceTasksCommands } from './commands/workspaceTasksCommands';
import { OscriptTasksCommands } from './commands/oscriptTasksCommands';
import { registerCommands } from './commands/commandRegistry';
import { VRunnerManager } from './vrunnerManager';
import {
	getPickableCommandsByGroup,
	getFavorites,
	setFavorites,
	type FavoriteEntry,
	type PickableCommandGroup,
} from './favorites';

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

/**
 * Активирует расширение
 * @param context - Контекст расширения VS Code
 */
export async function activate(context: vscode.ExtensionContext) {
	await vscode.commands.executeCommand('setContext', '1c-platform-tools.is1CProject', false);
	
	const isProject = await is1CProject();
	
	if (!isProject) {
		return;
	}

	await vscode.commands.executeCommand('setContext', '1c-platform-tools.is1CProject', true);

	// Инициализируем VRunnerManager с контекстом расширения для доступа к extensionPath
	VRunnerManager.getInstance(context);

	const commands = {
		infobase: new InfobaseCommands(),
		configuration: new ConfigurationCommands(),
		extensions: new ExtensionsCommands(),
		externalFiles: new ExternalFilesCommands(),
		dependencies: new DependenciesCommands(),
		run: new RunCommands(),
		test: new TestCommands(),
		setVersion: new SetVersionCommands(),
		oscriptTasks: new OscriptTasksCommands(),
		workspaceTasks: new WorkspaceTasksCommands(),
	};

	const commandDisposables = registerCommands(context, commands);

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

	const refreshCommand = vscode.commands.registerCommand('1c-platform-tools.refresh', () => {
		treeDataProvider.refresh();
		vscode.window.showInformationMessage('Дерево обновлено');
	});

	const settingsCommand = vscode.commands.registerCommand('1c-platform-tools.settings', () => {
		vscode.commands.executeCommand('workbench.action.openSettings', '@ext:yellow-hammer.1c-platform-tools');
	});

	const launchViewCommand = vscode.commands.registerCommand('1c-platform-tools.launch.view', () => {
		treeDataProvider.refresh();
	});

	const launchRunCommand = vscode.commands.registerCommand('1c-platform-tools.launch.run', async (taskLabel: string) => {
		await commands.workspaceTasks.runTask(taskLabel);
	});

	const oscriptRunCommand = vscode.commands.registerCommand('1c-platform-tools.oscript.run', async (taskName: string) => {
		await commands.oscriptTasks.runOscriptTask(taskName);
	});

	const oscriptAddTaskCommand = vscode.commands.registerCommand('1c-platform-tools.oscript.addTask', async () => {
		await commands.oscriptTasks.addOscriptTask();
		treeDataProvider.refresh();
	});

	const launchEditCommand = vscode.commands.registerCommand('1c-platform-tools.launch.edit', () => {
		commands.workspaceTasks.editTasks();
	});

	const fileOpenCommand = vscode.commands.registerCommand('1c-platform-tools.file.open', async (filePath: string) => {
		const uri = vscode.Uri.file(filePath);
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc);
	});

	const launchEditConfigurationsCommand = vscode.commands.registerCommand('1c-platform-tools.launch.editConfigurations', () => {
		commands.workspaceTasks.editLaunchConfigurations();
	});

	const onWorkspaceTasksSave = vscode.workspace.onDidSaveTextDocument((document) => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return;
		}
		const relativePath = vscode.workspace.asRelativePath(document.uri);
		if (relativePath === '.vscode/tasks.json' || relativePath === '.vscode/launch.json') {
			treeDataProvider.refresh();
		}
	});

	const favoritesConfigureCommand = vscode.commands.registerCommand(
		'1c-platform-tools.favorites.configure',
		async () => {
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
			vscode.window.showInformationMessage(
				`Избранное обновлено: ${newFavorites.length} команд`
			);
		}
	);

	context.subscriptions.push(
		treeView,
		refreshCommand,
		settingsCommand,
		favoritesConfigureCommand,
		launchViewCommand,
		launchRunCommand,
		oscriptRunCommand,
		oscriptAddTaskCommand,
		launchEditCommand,
		fileOpenCommand,
		launchEditConfigurationsCommand,
		onWorkspaceTasksSave,
		...commandDisposables
	);

}

/**
 * Деактивирует расширение
 * Очистка не требуется: все ресурсы автоматически освобождаются
 * через context.subscriptions при деактивации расширения
 */
export function deactivate() {
	// Очистка не требуется
}
