import * as vscode from 'vscode';
import type { SetVersionCommands } from '../../commands/setVersionCommands';
import {
	PlatformTreeDataProvider,
	PlatformTreeItem,
	TREE_GROUP_EXPANDED_STATE_KEY,
} from './treeViewProvider';
import { HelpAndSupportProvider } from '../projects/helpAndSupportProvider';
import { LaunchProfileViewProvider } from '../launch/launchProfileViewProvider';
import { VRunnerManager } from '../../shared/vrunnerManager';

export interface MainTreeViewRegistration {
	treeDataProvider: PlatformTreeDataProvider;
}

/**
 * Регистрирует tree view панели «Инструменты 1С» и сохранение состояния раскрытия групп.
 */
export function registerMainTreeView(
	context: vscode.ExtensionContext,
	setVersionCommands: SetVersionCommands
): MainTreeViewRegistration {
	// Дерево создаём всегда: при отсутствии проекта панель скрыта (when), после создания packagedef — показывается
	const treeDataProvider = new PlatformTreeDataProvider(
		context.extensionUri,
		setVersionCommands,
		context
	);
	const treeView = vscode.window.createTreeView('1c-platform-tools', {
		treeDataProvider,
		showCollapseAll: true,
	});

	// Плашка «Профиль запуска»: с чем работают команды vrunner
	const launchProfileProvider = new LaunchProfileViewProvider(VRunnerManager.getInstance());
	const profileTreeView = vscode.window.createTreeView('1c-platform-tools-profile', {
		treeDataProvider: launchProfileProvider,
		showCollapseAll: false,
	});

	// Отдельная плашка «Помощь и поддержка» под деревом команд
	const helpTreeView = vscode.window.createTreeView('1c-platform-tools-help', {
		treeDataProvider: new HelpAndSupportProvider(),
		showCollapseAll: false,
	});

	const saveGroupExpandedState = (element: unknown, expanded: boolean): void => {
		if (!(element instanceof PlatformTreeItem) || !element.groupId) {
			return;
		}
		const state =
			context.globalState.get<Record<string, boolean>>(TREE_GROUP_EXPANDED_STATE_KEY) ?? {};
		state[element.groupId] = expanded;
		void context.globalState.update(TREE_GROUP_EXPANDED_STATE_KEY, state);
	};

	// Схема служебных файлов («Профиль запуска», CI-настройки) зависит от версии
	// vrunner: пока она не определена, дерево показывало бы v2-файлы. Прогреваем
	// детект и перерисовываем дерево, когда версия установится или сменится.
	const vrunner = VRunnerManager.getInstance();
	void vrunner.getVRunnerVersion().then(() => treeDataProvider.refresh());

	context.subscriptions.push(
		treeView,
		launchProfileProvider,
		profileTreeView,
		helpTreeView,
		vrunner.onDidChangeVRunnerVersion(() => treeDataProvider.refresh()),
		treeView.onDidExpandElement((event) =>
			saveGroupExpandedState(event.element, true)
		),
		treeView.onDidCollapseElement((event) =>
			saveGroupExpandedState(event.element, false)
		)
	);

	return { treeDataProvider };
}
