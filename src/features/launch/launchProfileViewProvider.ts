/**
 * TreeDataProvider плашки «Профиль запуска» в панели «Инструменты 1С».
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
import { activeProfileLabel } from '../../shared/envProfiles';

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

	constructor(private readonly vrunner: VRunnerManager) {
		// Плашка живая: обновляется при смене профиля и при изменении файлов
		// настроек в корне проекта (создание, правка, удаление).
		this.disposables.push(
			this.vrunner.onDidChangeActiveEnvProfile(() => this.refresh()),
			this.vrunner.onDidChangeVRunnerVersion(() => this.refresh())
		);
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (workspaceRoot) {
			const watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(workspaceRoot, '{env*.json,autumn-properties*.json}')
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
		const settingsFile = this.vrunner.getActiveEnvFile();
		const settingsExists = workspaceRoot
			? fsSync.existsSync(path.join(workspaceRoot, settingsFile))
			: false;
		const ibConnection = this.vrunner.readActiveProfileSettingSync('ibconnection');
		const hasOverrides = this.vrunner.hasActiveEnvOverrides();

		return [
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
				{ command: '1c-platform-tools.vrunner.refreshVersion', title: 'Определить версию заново' }
			),
			item(
				`Файл настроек: ${settingsFile}`,
				settingsExists ? 'check' : 'warning',
				settingsExists
					? 'Открыть в редакторе профиля'
					: 'Профиль запуска не создан, команды заблокированы. Нажмите, чтобы создать.',
				settingsExists
					? { command: '1c-platform-tools.profile.openEditor', title: 'Редактор профиля' }
					: { command: '1c-platform-tools.serviceFiles.ensure', title: 'Файл настроек', arguments: ['launchProfile'] }
			),
			item(
				`ИБ: ${ibConnection ?? '/F./build/ib'}`,
				'database',
				ibConnection
					? 'Строка подключения из файла настроек'
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
	}
}
