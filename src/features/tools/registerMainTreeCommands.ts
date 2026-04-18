import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { OscriptTasksCommands } from '../../commands/oscriptTasksCommands';
import { SetVersionCommands } from '../../commands/setVersionCommands';
import { WorkspaceTasksCommands } from '../../commands/workspaceTasksCommands';
import { PlatformTreeDataProvider } from './treeViewProvider';
import {
	getPickableCommandsByGroup,
	getFavorites,
	setFavorites,
	type FavoriteEntry,
	type PickableCommandGroup,
} from './favorites';

type FavoritesSelectableItem = vscode.QuickPickItem & {
	command: string;
	title: string;
	groupLabel: string;
	sectionType: string;
	arguments?: unknown[];
};

export interface RegisterMainTreeCommandsParams {
	context: vscode.ExtensionContext;
	treeDataProvider: PlatformTreeDataProvider;
	isProjectRef: { current: boolean };
	showNot1CProjectMessage: () => void;
	setVersionCommands: SetVersionCommands;
	oscriptTasksCommands: OscriptTasksCommands;
	workspaceTasksCommands: WorkspaceTasksCommands;
}

async function pushSetVersionDynamicItems(
	items: vscode.QuickPickItem[],
	group: PickableCommandGroup,
	favoriteKeys: Set<string>,
	setVersionCommands: SetVersionCommands
): Promise<void> {
	items.push(
		{ label: '🏷️ Расширения', kind: vscode.QuickPickItemKind.Separator },
		{
			label: '🏷️ Все',
			description: '1c-platform-tools.setVersion.allExtensions',
			picked: favoriteKeys.has('1c-platform-tools.setVersion.allExtensions|[]'),
			command: '1c-platform-tools.setVersion.allExtensions',
			title: 'Все',
			groupLabel: group.groupLabel,
			sectionType: group.sectionType,
		} as FavoritesSelectableItem
	);
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

async function pushOscriptTasksItems(
	items: vscode.QuickPickItem[],
	favoriteKeys: Set<string>,
	oscriptTasksCommands: OscriptTasksCommands
): Promise<void> {
	items.push(
		{ label: 'Задачи (oscript)', kind: vscode.QuickPickItemKind.Separator },
		{
			label: '➕ Добавить задачу',
			description: '1c-platform-tools.oscript.addTask',
			picked: favoriteKeys.has('1c-platform-tools.oscript.addTask|[]'),
			command: '1c-platform-tools.oscript.addTask',
			title: 'Добавить задачу',
			groupLabel: 'Задачи (oscript)',
			sectionType: 'oscriptTasks',
		} as FavoritesSelectableItem
	);
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

function appendStaticGroupCommands(
	items: vscode.QuickPickItem[],
	group: PickableCommandGroup,
	favoriteKeys: Set<string>
): void {
	for (const command of group.commands) {
		items.push({
			label: command.treeLabel,
			description: command.command,
			picked: favoriteKeys.has(`${command.command}|[]`),
			command: command.command,
			title: command.title,
			groupLabel: group.groupLabel,
			sectionType: group.sectionType,
		} as FavoritesSelectableItem);
	}
}

async function buildFavoritesQuickPickItems(
	favoriteKeys: Set<string>,
	setVersionCommands: SetVersionCommands,
	oscriptTasksCommands: OscriptTasksCommands
): Promise<vscode.QuickPickItem[]> {
	const groups = getPickableCommandsByGroup();
	const items: vscode.QuickPickItem[] = [];

	for (const group of groups) {
		if (group.sectionType === 'config') {
			continue;
		}
		items.push({
			label: group.groupLabel,
			kind: vscode.QuickPickItemKind.Separator,
		});
		appendStaticGroupCommands(items, group, favoriteKeys);

		if (group.sectionType === 'setVersion') {
			await pushSetVersionDynamicItems(items, group, favoriteKeys, setVersionCommands);
		}
	}

	await pushOscriptTasksItems(items, favoriteKeys, oscriptTasksCommands);

	const configGroup = groups.find((group) => group.sectionType === 'config');
	if (configGroup) {
		items.push({
			label: configGroup.groupLabel,
			kind: vscode.QuickPickItemKind.Separator,
		});
		appendStaticGroupCommands(items, configGroup, favoriteKeys);
	}

	return items;
}

function toFavoriteEntries(selected: readonly vscode.QuickPickItem[]): FavoriteEntry[] {
	return (selected as FavoritesSelectableItem[])
		.filter((item) => item.command !== undefined)
		.map((item) => ({
			command: item.command,
			title: item.title,
			groupLabel: item.groupLabel,
			sectionType: item.sectionType,
			arguments: item.arguments,
		}));
}

/**
 * Регистрирует команды главного дерева «Инструменты 1С».
 */
export function registerMainTreeCommands(
	params: RegisterMainTreeCommandsParams
): vscode.Disposable[] {
	const {
		context,
		treeDataProvider,
		isProjectRef,
		showNot1CProjectMessage,
		setVersionCommands,
		oscriptTasksCommands,
		workspaceTasksCommands,
	} = params;

	const refreshCommand = vscode.commands.registerCommand('1c-platform-tools.refresh', () => {
		if (!isProjectRef.current) {
			showNot1CProjectMessage();
			return;
		}
		treeDataProvider.refresh();
		logger.debug('Дерево обновлено');
		vscode.window.showInformationMessage('Дерево обновлено');
	});

	const launchViewCommand = vscode.commands.registerCommand('1c-platform-tools.launch.view', () => {
		if (!isProjectRef.current) {
			showNot1CProjectMessage();
			return;
		}
		treeDataProvider.refresh();
	});

	const launchRunCommand = vscode.commands.registerCommand(
		'1c-platform-tools.launch.run',
		async (taskLabel: string) => {
			if (!isProjectRef.current) {
				showNot1CProjectMessage();
				return;
			}
			await workspaceTasksCommands.runTask(taskLabel);
		}
	);

	const oscriptRunCommand = vscode.commands.registerCommand(
		'1c-platform-tools.oscript.run',
		async (taskName: string) => {
			if (!isProjectRef.current) {
				showNot1CProjectMessage();
				return;
			}
			await oscriptTasksCommands.runOscriptTask(taskName);
		}
	);

	const oscriptAddTaskCommand = vscode.commands.registerCommand(
		'1c-platform-tools.oscript.addTask',
		async () => {
			if (!isProjectRef.current) {
				showNot1CProjectMessage();
				return;
			}
			await oscriptTasksCommands.addOscriptTask();
			treeDataProvider.refresh();
		}
	);

	const launchEditCommand = vscode.commands.registerCommand('1c-platform-tools.launch.edit', () => {
		if (!isProjectRef.current) {
			showNot1CProjectMessage();
			return;
		}
		workspaceTasksCommands.editTasks();
	});

	const fileOpenCommand = vscode.commands.registerCommand(
		'1c-platform-tools.file.open',
		async (filePath: string) => {
			if (!isProjectRef.current) {
				showNot1CProjectMessage();
				return;
			}
			const uri = vscode.Uri.file(filePath);
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc);
		}
	);

	const launchEditConfigurationsCommand = vscode.commands.registerCommand(
		'1c-platform-tools.launch.editConfigurations',
		() => {
			if (!isProjectRef.current) {
				showNot1CProjectMessage();
				return;
			}
			workspaceTasksCommands.editLaunchConfigurations();
		}
	);

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

	const favoritesConfigureCommand = vscode.commands.registerCommand(
		'1c-platform-tools.favorites.configure',
		async () => {
			if (!isProjectRef.current) {
				showNot1CProjectMessage();
				return;
			}
			const currentFavorites = getFavorites(context);
			const favoriteKeys = new Set(
				currentFavorites.map((favorite) => `${favorite.command}|${JSON.stringify(favorite.arguments ?? [])}`)
			);
			const items = await buildFavoritesQuickPickItems(
				favoriteKeys,
				setVersionCommands,
				oscriptTasksCommands
			);

			const selected = await vscode.window.showQuickPick(items, {
				canPickMany: true,
				placeHolder: 'Выберите команды для избранного (отмечены — в избранном)',
				matchOnDescription: true,
			});
			if (selected === undefined) {
				return;
			}
			const newFavorites = toFavoriteEntries(selected);
			await setFavorites(context, newFavorites);
			treeDataProvider.refresh();
			logger.info(`Избранное обновлено: ${newFavorites.length} команд`);
			vscode.window.showInformationMessage(
				`Избранное обновлено: ${newFavorites.length} команд`
			);
		}
	);

	return [
		refreshCommand,
		launchViewCommand,
		launchRunCommand,
		oscriptRunCommand,
		oscriptAddTaskCommand,
		launchEditCommand,
		fileOpenCommand,
		launchEditConfigurationsCommand,
		onWorkspaceTasksSave,
		favoritesConfigureCommand,
	];
}
