import * as path from 'node:path';
import * as vscode from 'vscode';
import { DependenciesCommands } from '../commands/dependenciesCommands';
import { openGetStartedWalkthrough } from '../features/tools/getStartedView';
import { setOnProjectCreated } from '../shared/projectContext';

export interface RefreshableProvider {
	refresh(): void;
}

export interface RegisterProjectCreatedHandlerParams {
	isProjectRef: { current: boolean };
	treeDataProvider: RefreshableProvider;
	artifactsProvider: RefreshableProvider;
	metadataTreeProvider: RefreshableProvider;
}

/**
 * Проверяет, является ли текущий workspace проектом 1С по наличию `packagedef`.
 *
 * @returns Промис, который разрешается в `true`, если в корне workspace есть `packagedef`.
 */
async function hasPackageDefInWorkspace(): Promise<boolean> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return false;
	}

	const workspaceRoot = workspaceFolders[0].uri.fsPath;
	const fs = await import('node:fs/promises');
	const packagedefPath = path.join(workspaceRoot, 'packagedef');

	try {
		await fs.access(packagedefPath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Определяет стартовый статус проекта и обновляет контекст `1c-platform-tools.is1CProject`.
 *
 * @returns Промис, который разрешается в `true`, если открыт проект 1С.
 */
export async function detectAndSetInitialProjectContext(): Promise<boolean> {
	await vscode.commands.executeCommand('setContext', '1c-platform-tools.is1CProject', false);
	const isProject = await hasPackageDefInWorkspace();
	if (isProject) {
		await vscode.commands.executeCommand('setContext', '1c-platform-tools.is1CProject', true);
	}
	return isProject;
}

/**
 * Регистрирует реакцию на создание `packagedef` через команду инициализации проекта.
 */
export function registerProjectCreatedHandler(
	params: RegisterProjectCreatedHandlerParams
): void {
	const { isProjectRef, treeDataProvider, artifactsProvider, metadataTreeProvider } = params;

	setOnProjectCreated(() => {
		isProjectRef.current = true;
		void vscode.commands.executeCommand('setContext', '1c-platform-tools.is1CProject', true);
		treeDataProvider.refresh();
		artifactsProvider.refresh();
		metadataTreeProvider.refresh();
	});
}

/**
 * Выполняет post-open сценарии для workspace после активации.
 *
 * - отложенная установка зависимостей после создания проекта
 * - отложенное открытие руководства «С чего начать?»
 */
export function runPostOpenProjectWorkflow(
	context: vscode.ExtensionContext,
	installDependencies: () => Promise<void>
): void {
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspaceRoot) {
		return;
	}

	const installAfterCreatePath = context.globalState.get<string>(
		DependenciesCommands.INSTALL_DEPS_AFTER_CREATE_KEY
	);
	if (
		installAfterCreatePath &&
		path.normalize(installAfterCreatePath) === path.normalize(workspaceRoot)
	) {
		void context.globalState.update(
			DependenciesCommands.INSTALL_DEPS_AFTER_CREATE_KEY,
			undefined
		);
		setImmediate(() => void installDependencies());
	}

	const showGetStartedForPath = context.globalState.get<string>(
		'1c-platform-tools.showGetStartedForPath'
	);
	if (
		showGetStartedForPath &&
		path.normalize(showGetStartedForPath) === path.normalize(workspaceRoot)
	) {
		void context.globalState.update('1c-platform-tools.showGetStartedForPath', undefined);
		openGetStartedWalkthrough(context, { scheduleDelayMs: 500 });
	}
}
