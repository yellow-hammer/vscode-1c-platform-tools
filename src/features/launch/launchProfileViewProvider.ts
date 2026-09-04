/**
 * TreeDataProvider плашки «Профиль запуска» в панели «1С: Инструменты».
 *
 * Показывает, с чем реально работают команды vrunner: активный профиль,
 * версию vanessa-runner, файл настроек её схемы, строку подключения к ИБ и
 * временные параметры. Каждый пункт кликабелен: выбор профиля, создание или
 * открытие файла настроек, задание временных параметров.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fsSync from 'node:fs';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { activeProfileLabel, LOCAL_OVERRIDES_FILE } from '../../shared/envProfiles';
import { configurationScope, onDidChangeActiveConfiguration } from '../../shared/activeConfiguration';
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

export class LaunchProfileViewProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private readonly disposables: vscode.Disposable[] = [];
	/** Проект активной конфигурации, если она в формате 1С:EDT. */
	private edtProject: string | undefined;

	constructor(private readonly vrunner: VRunnerManager) {
		// Плашка живая: обновляется при смене профиля и при изменении файлов
		// настроек в корне проекта (создание, правка, удаление).
		this.disposables.push(
			this.vrunner.onDidChangeActiveEnvProfile(() => this.refresh()),
			this.vrunner.onDidChangeVRunnerVersion(() => this.refresh()),
			onDidChangeActiveConfiguration(() => void this.refreshEdtProject())
		);
		void this.refreshEdtProject();
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (workspaceRoot) {
			// .git/HEAD — чтобы строка ИБ с ${gitBranch} обновлялась при смене ветки
			const watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(workspaceRoot, '{env*.json,autumn-properties*.json,.git/HEAD}')
			);
			this.disposables.push(
				watcher,
				watcher.onDidCreate(() => this.refresh()),
				watcher.onDidChange(() => this.refresh()),
				watcher.onDidDelete(() => this.refresh())
			);
		}
		// Детект версии асинхронный: перерисовать плашку, когда версия определится
		void this.vrunner.getVRunnerVersion().then(() => this.refresh());
	}

	/** Формат активной конфигурации: у проекта EDT команды идут через 1cedtcli. */
	private async refreshEdtProject(): Promise<void> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		let project: string | undefined;
		if (workspaceRoot) {
			const scope = await configurationScope(workspaceRoot, {
				configuration: this.vrunner.getCfPath(),
				extensions: [this.vrunner.getCfePath(), this.vrunner.getTestsCfePath()],
			});
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

	getChildren(): vscode.TreeItem[] {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		const schema = this.vrunner.getActiveSettingsSchema();
		const versionLabel = this.vrunner.getCachedVRunnerVersionLabel();
		const profileLabel = activeProfileLabel(
			this.vrunner.getActiveEnvProfileId(),
			this.vrunner.discoverEnvProfiles()
		);
		const settingsFile = this.vrunner.getActiveEnvFile();
		const settingsExists = workspaceRoot
			? fsSync.existsSync(path.join(workspaceRoot, settingsFile))
			: false;
		// эффективная строка подключения: временные параметры > env.local.json >
		// профиль (в том числе значения с подставленным ${gitBranch})
		const ibConnection = this.vrunner.getEffectiveEnvOverrides()?.ibConnection
			?? this.vrunner.readActiveProfileSettingSync('ibconnection');
		const hasOverrides = this.vrunner.hasActiveEnvOverrides();
		const hasLocalOverrides = this.vrunner.hasLocalEnvOverrides();

		const items = [
			item(
				`Профиль: ${profileLabel}`,
				'rocket',
				'Выбрать или создать профиль запуска',
				{ command: '1c-platform-tools.env.selectProfile', title: 'Выбрать профиль запуска' }
			),
			item(
				`vanessa-runner: ${versionLabel ?? 'не определён'}`,
				versionLabel ? 'verified' : 'question',
				`Синтаксис ${schema === 'v3' ? '3.x' : '2.x'}. Нажмите, чтобы определить заново.`,
				{ command: '1c-platform-tools.env.refreshVersion', title: 'Определить версию' }
			),
			...(this.edtProject ? [this.edtItem(this.edtProject)] : []),
			item(
				`Файл настроек: ${settingsFile}`,
				settingsExists ? 'check' : 'warning',
				settingsExists
					? 'Открыть в редакторе профиля'
					: 'Профиль запуска не создан, команды заблокированы. Нажмите, чтобы создать.',
				settingsExists
					? { command: '1c-platform-tools.env.openProfileEditor', title: 'Редактор профиля' }
					: { command: '1c-platform-tools.serviceFiles.ensure', title: 'Файл настроек', arguments: ['launchProfile'] }
			),
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
