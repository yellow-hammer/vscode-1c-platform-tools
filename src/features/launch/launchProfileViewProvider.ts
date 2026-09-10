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
import { VRunnerManager, type SettingsFileState } from '../../shared/vrunnerManager';
import { activeProfileLabel, LOCAL_OVERRIDES_FILE } from '../../shared/envProfiles';

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

/** Подсказка к строке файла настроек: почему команды заблокированы. */
function settingsHint(state: SettingsFileState, vrunner: VRunnerManager): string {
	if (state.ready) {
		return 'Открыть в редакторе профиля';
	}
	if (!state.exists) {
		return 'Профиль запуска не создан, команды заблокированы. Нажмите, чтобы создать.';
	}
	return `Команды заблокированы. ${vrunner.settingsProblemMessage(state)}`;
}

export class LaunchProfileViewProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly vrunner: VRunnerManager) {
		// Плашка живая: обновляется при смене профиля и при изменении файлов
		// настроек в корне проекта (создание, правка, удаление).
		this.disposables.push(
			this.vrunner.onDidChangeActiveEnvProfile(() => this.refresh()),
			this.vrunner.onDidChangeVRunnerVersion(() => this.refresh())
		);
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

	public refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	public dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
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
		const settings = this.vrunner.describeSettingsState();
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
			item(
				`Файл настроек: ${settings.fileName}`,
				settings.ready ? 'check' : 'warning',
				settingsHint(settings, this.vrunner),
				settings.ready || settings.readError
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
