import * as vscode from 'vscode';
import type { SetVersionCommands } from '../../commands/setVersionCommands';
import {
	PlatformTreeDataProvider,
	PlatformTreeItem,
	TREE_GROUP_EXPANDED_STATE_KEY,
} from './treeViewProvider';
import { HelpAndSupportProvider } from '../projects/helpAndSupportProvider';
import { bindProjectDescription } from '../projects/projectViewDescription';
import { LaunchProfileViewProvider } from '../launch/launchProfileViewProvider';
import * as path from 'node:path';
import { ServiceFilesTreeProvider, openServiceFile } from '../serviceFiles/serviceFilesTree';
import { currentRoot } from '../../shared/workspaceProjects';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { notifyQuiet } from '../../shared/notify';
import {
	formatMissingProfileFile,
	formatProfileLinks,
	profileFileMissing,
	profileLinks,
} from '../testing/profileLinks';
import { showTextTask } from '../tasks/vrunnerTask';
import { showWorkspaceRequired } from '../../shared/configurationWriteTarget';

export interface MainTreeViewRegistration {
	treeDataProvider: PlatformTreeDataProvider;
}

/**
 * Регистрирует tree view панели «1С: Инструменты» и сохранение состояния раскрытия групп.
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
	const treeView = vscode.window.createTreeView('1c-platform-tools-tools-commands', {
		treeDataProvider,
		showCollapseAll: true,
	});

	// Плашка «Профиль запуска»: с чем работают команды vrunner
	const launchProfileProvider = new LaunchProfileViewProvider(VRunnerManager.getInstance());
	const profileTreeView = vscode.window.createTreeView('1c-platform-tools-tools-profile', {
		treeDataProvider: launchProfileProvider,
		showCollapseAll: false,
	});

	// Отдельная плашка «Помощь и поддержка» под деревом команд
	const helpTreeView = vscode.window.createTreeView('1c-platform-tools-tools-help', {
		treeDataProvider: new HelpAndSupportProvider(),
		showCollapseAll: false,
	});

	const vrunner = VRunnerManager.getInstance();
	const serviceFilesProvider = new ServiceFilesTreeProvider(vrunner);
	const serviceFilesView = vscode.window.createTreeView('1c-platform-tools-service-files-tree', {
		treeDataProvider: serviceFilesProvider,
		showCollapseAll: true,
	});
	const serviceFilesCheck = vscode.commands.registerCommand('1c-platform-tools.serviceFiles.checkLinks', async () => {
		const root = currentRoot();
		if (!root) {
			showWorkspaceRequired();
			return;
		}
		const file = vrunner.getActiveEnvFile();
		if (await profileFileMissing(root, file)) {
			await showTextTask('Проверить связи', formatMissingProfileFile(file), root, 1);
			return;
		}
		const { settings, schema } = await vrunner.readActiveSettings();
		const links = await profileLinks(root, settings, schema);
		await showTextTask('Проверить связи', formatProfileLinks(file, links), root, links.every((link) => link.ok) ? 0 : 1);
	});
	const serviceFilesRefresh = vscode.commands.registerCommand('1c-platform-tools.serviceFiles.refresh', () => {
		serviceFilesProvider.refresh();
		notifyQuiet('Дерево обновлено');
	});
	const serviceFilesOpen = vscode.commands.registerCommand('1c-platform-tools.serviceFiles.open', (element?: unknown) =>
		openServiceFile(element)
	);
	const serviceFilesReveal = vscode.commands.registerCommand('1c-platform-tools.serviceFiles.revealInTree', async (uri?: vscode.Uri) => {
		const target = uri ?? vscode.window.activeTextEditor?.document.uri;
		await vscode.commands.executeCommand('1c-platform-tools-service-files-tree.focus');
		if (!target || target.scheme !== 'file') {
			return;
		}
		const root = currentRoot();
		if (!root) {
			return;
		}
		const relPath = path.relative(root, target.fsPath).replace(/\\/g, '/');
		const node = await serviceFilesProvider.nodeFor(relPath);
		if (node) {
			await serviceFilesView.reveal(node, { select: true, focus: true, expand: true });
		}
	});
	const serviceFilesHelp = vscode.window.createTreeView('1c-platform-tools-service-files-help', {
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

	// Схема файлов профиля зависит от версии vrunner. Прогреваем детект и перерисовываем, когда версия известна.
	void vrunner.getVRunnerVersion().then(() => {
		treeDataProvider.refresh();
		serviceFilesProvider.refresh();
	});

	context.subscriptions.push(
		treeView,
		treeDataProvider,
		bindProjectDescription(treeView),
		launchProfileProvider,
		profileTreeView,
		helpTreeView,
		serviceFilesProvider,
		serviceFilesCheck,
		serviceFilesRefresh,
		serviceFilesOpen,
		serviceFilesReveal,
		serviceFilesView,
		serviceFilesHelp,
		vrunner.onDidChangeVRunnerVersion(() => {
			treeDataProvider.refresh();
			serviceFilesProvider.refresh();
		}),
		treeView.onDidExpandElement((event) =>
			saveGroupExpandedState(event.element, true)
		),
		treeView.onDidCollapseElement((event) =>
			saveGroupExpandedState(event.element, false)
		),
		serviceFilesView.onDidExpandElement((event) =>
			serviceFilesProvider.rememberExpanded(event.element, true)
		),
		serviceFilesView.onDidCollapseElement((event) =>
			serviceFilesProvider.rememberExpanded(event.element, false)
		)
	);

	return { treeDataProvider };
}
