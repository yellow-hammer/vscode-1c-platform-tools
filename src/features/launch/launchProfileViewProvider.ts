/**
 * TreeDataProvider плашки «Профиль запуска» в панели «1С: Инструменты».
 *
 * Показывает, с чем реально работают команды: активный профиль, версию
 * vanessa-runner, файл настроек её схемы, окружение, строку подключения к ИБ и
 * временные параметры. У проекта OneScript — профиль, файл настроек Осени и
 * окружение. Каждый пункт кликабелен: выбор профиля и окружения, открытие
 * файлов, задание временных параметров.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { VRunnerManager, type SettingsFileState } from '../../shared/vrunnerManager';
import { LOCAL_OVERRIDES_FILE } from '../../shared/envProfiles';
import { environmentLabel } from '../../shared/environments';
import { configurationScope } from '../../shared/activeConfiguration';
import { onDidChangeCurrentProject, onDidChangeProjects } from '../../shared/workspaceProjects';
import { edtProjectName, readEdtSettings, resolveEdt } from '../edt/edtRunner';

/** Элемент плашки профиля. */
function item(
	label: string,
	icon: string,
	tooltip: string,
	command?: vscode.Command
): vscode.TreeItem {
	const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
	treeItem.iconPath = new vscode.ThemeIcon(icon);
	treeItem.tooltip = tooltip;
	treeItem.command = command;
	return treeItem;
}

/** Подсказка к строке файла настроек: почему файл не годится. */
function settingsHint(state: SettingsFileState, vrunner: VRunnerManager): string {
	if (state.fileReady) {
		return 'Открыть в редакторе профиля';
	}
	if (!state.exists) {
		return 'Профиль запуска не создан, команды заблокированы. Нажмите, чтобы создать.';
	}
	return `Команды заблокированы. ${vrunner.settingsFileProblemMessage(state)}`;
}

export class LaunchProfileViewProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private readonly disposables: vscode.Disposable[] = [];
	/** Проект активной конфигурации, если она в формате 1С:EDT. */
	private edtProject: string | undefined;
	/** Наблюдатель за файлами настроек текущего проекта. */
	private projectWatcher: vscode.Disposable | undefined;

	constructor(private readonly vrunner: VRunnerManager) {
		// Плашка живая: обновляется при смене профиля, временных параметров, проекта и при изменении
		// файлов настроек в корне проекта (создание, правка, удаление).
		this.disposables.push(
			this.vrunner.onDidChangeActiveEnvProfile(() => this.refresh()),
			this.vrunner.onDidChangeActiveEnvironment(() => this.refresh()),
			this.vrunner.onDidChangeEnvOverrides(() => this.refresh()),
			this.vrunner.onDidChangeVRunnerVersion(() => this.refresh()),
			// Вид проекта, от которого зависит состав плашки, известен после обнаружения
			onDidChangeProjects(() => this.refresh()),
			onDidChangeCurrentProject((change) => {
				this.watchProject(change.current);
				this.refresh();
				void this.refreshEdtProject();
				void this.vrunner.getVRunnerVersion().then(() => this.refresh());
			}),
			new vscode.Disposable(() => this.projectWatcher?.dispose())
		);
		void this.refreshEdtProject();
		this.watchProject(this.vrunner.getWorkspaceRoot());
		// Детект версии асинхронный: перерисовать плашку, когда версия определится
		void this.vrunner.getVRunnerVersion().then(() => this.refresh());
	}

	/** Следит за файлами настроек проекта; .git/HEAD - за строкой ИБ с ${gitBranch}. */
	private watchProject(root: string | undefined): void {
		this.projectWatcher?.dispose();
		this.projectWatcher = undefined;
		if (root === undefined) {
			return;
		}
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(root, '{env*.json,autumn-properties*.json,.env,.env.*,.git/HEAD}')
		);
		this.projectWatcher = vscode.Disposable.from(
			watcher,
			watcher.onDidCreate(() => this.refresh()),
			watcher.onDidChange(() => this.refresh()),
			watcher.onDidDelete(() => this.refresh())
		);
	}

	/** Формат активной конфигурации: у проекта EDT команды идут через 1cedtcli. */
	private async refreshEdtProject(): Promise<void> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		let project: string | undefined;
		if (workspaceRoot) {
			const scope = await configurationScope(workspaceRoot);
			project = scope.configuration?.format === 'edt' ? edtProjectName(scope.configuration.dir) : undefined;
		}
		if (project !== this.edtProject) {
			this.edtProject = project;
			this.refresh();
		}
	}

	public refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	public dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	/** Проект EDT: его исходники раннер получает через 1cedtcli. */
	private edtItem(project: string): vscode.TreeItem {
		const installation = resolveEdt(readEdtSettings());
		return item(
			`1С:EDT: ${installation?.version ?? 'не найдена'}`,
			installation ? 'verified' : 'warning',
			installation
				? `Проект ${project} идёт через 1cedtcli: выгрузка перед загрузкой, сборкой и тестами, импорт после выгрузки из базы.`
				: `Проект ${project} в формате 1С:EDT, а 1cedtcli не найдена: команды над исходниками не выполнятся.`,
			{ command: '1c-platform-tools.edt.projectInfo', title: 'Сведения о проекте' }
		);
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	/** Окружение: выбранное окружение, его файлы и имена переменных без значений. */
	private environmentItem(): vscode.TreeItem {
		const { id, files, variables } = this.vrunner.activeEnvironment();
		const problem = this.vrunner.environmentProblem();
		const names = Object.keys(variables);
		return item(
			`Окружение: ${environmentLabel(id, files)}`,
			problem ? 'warning' : 'variable-group',
			problem ?? (files.length > 0
				? `${files.join(', ')}${names.length > 0 ? `: ${names.join(', ')}` : ''}`
				: 'Переменные среды для всех запусков: файлы .env и .env.<имя>'),
			{ command: '1c-platform-tools.env.selectEnvironment', title: 'Выбрать окружение' }
		);
	}

	/** Файлы настроек приложения на Осени: их проект OneScript читает сам. */
	private appSettingsItems(workspaceRoot: string | undefined, settingsFiles: string[]): vscode.TreeItem[] {
		if (workspaceRoot === undefined) {
			return [];
		}
		return settingsFiles.map((settingsFile) =>
			item(`Файл настроек: ${settingsFile}`, 'settings', 'Настройки приложения на Осени', {
				command: 'vscode.open',
				title: 'Открыть файл настроек',
				arguments: [vscode.Uri.file(path.join(workspaceRoot, settingsFile))],
			})
		);
	}

	getChildren(): vscode.TreeItem[] {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		const { profile } = this.vrunner.launchSummary();
		const profileProblem = this.vrunner.profileProblem();
		const profileItem = item(
			`Профиль: ${profile.label}`,
			profileProblem ? 'warning' : 'rocket',
			profileProblem ?? 'Выбрать профиль запуска',
			{ command: '1c-platform-tools.env.selectProfile', title: 'Выбрать профиль запуска' }
		);
		// У проекта OneScript нет vanessa-runner: строк его версии, базы и параметров нет
		if (!this.vrunner.usesVanessaRunner()) {
			return [profileItem, ...this.appSettingsItems(workspaceRoot, profile.settingsFiles), this.environmentItem()];
		}
		const schema = this.vrunner.getActiveSettingsSchema();
		const versionLabel = this.vrunner.getCachedVRunnerVersionLabel();
		const settings = this.vrunner.describeSettingsState();
		// эффективная строка подключения: временные параметры > env.local.json >
		// профиль (в том числе значения с подставленным ${gitBranch})
		const ibConnection = this.vrunner.getEffectiveEnvOverrides()?.ibConnection
			?? this.vrunner.readActiveProfileSettingSync('ibconnection');
		const hasOverrides = this.vrunner.hasActiveEnvOverrides();
		const hasLocalOverrides = this.vrunner.hasLocalEnvOverrides();

		const items = [
			profileItem,
			item(
				`vanessa-runner: ${versionLabel ?? 'не определён'}`,
				versionLabel ? 'verified' : 'question',
				`Синтаксис ${schema === 'v3' ? '3.x' : '2.x'}. Нажмите, чтобы определить заново.`,
				{ command: '1c-platform-tools.env.refreshVersion', title: 'Определить версию' }
			),
			...(this.edtProject ? [this.edtItem(this.edtProject)] : []),
			item(
				`Файл настроек: ${settings.fileName}`,
				settings.fileReady ? 'check' : 'warning',
				settingsHint(settings, this.vrunner),
				settings.fileReady || settings.readError
					? { command: '1c-platform-tools.env.openProfileEditor', title: 'Редактор профиля' }
					: { command: '1c-platform-tools.serviceFiles.ensure', title: 'Файл настроек', arguments: ['launchProfile'] }
			),
			this.environmentItem(),
			item(
				`ИБ: ${ibConnection ?? '/F./build/ib'}`,
				'database',
				ibConnection
					? 'Строка подключения, которую увидят команды vrunner (профиль и перекрытия, ${gitBranch} подставлен)'
					: 'В файле настроек не задана, используется каталог build/ib по умолчанию',
				{ command: '1c-platform-tools.serviceFiles.ensure', title: 'Файл настроек', arguments: ['launchProfile'] }
			),
			item(
				hasOverrides ? 'Временные параметры: заданы' : 'Временные параметры: нет',
				hasOverrides ? 'record' : 'circle-outline',
				'Разовые параметры поверх файла настроек (строка подключения, версия платформы и др.)',
				{ command: '1c-platform-tools.env.setOverrides', title: 'Временные параметры' }
			),
		];
		if (hasLocalOverrides && workspaceRoot) {
			items.push(
				item(
					`Локальные перекрытия: ${LOCAL_OVERRIDES_FILE}`,
					'layers-active',
					'Значения из env.local.json применяются поверх активного профиля (приоритет ниже временных параметров). Нажмите, чтобы открыть файл.',
					{
						command: 'vscode.open',
						title: 'Открыть env.local.json',
						arguments: [vscode.Uri.file(path.join(workspaceRoot, LOCAL_OVERRIDES_FILE))],
					}
				)
			);
		}
		return items;
	}
}
