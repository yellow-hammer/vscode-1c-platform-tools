/**
 * Представление «1С: Пакеты» в проводнике, рядом с «1С: Артефакты».
 *
 * Зависимости из `packagedef` и установленные пакеты.
 */

import * as vscode from 'vscode';
import { currentRoot, onDidChangeCurrentProject, onDidChangeProjects } from '../../shared/workspaceProjects';
import { forgetDependencyInsight, onDidChangeDependencyInsight } from './dependencyInsight';
import { dependencyTreeMessage, dependencyTreeRows, type DependencyRowIcon, type DependencyTreeRow } from './dependencyTree';

function dependencyIcon(icon: DependencyRowIcon): vscode.ThemeIcon {
	switch (icon) {
		case 'folder':
			return new vscode.ThemeIcon('library');
		case 'warning':
			return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
		case 'update':
			return new vscode.ThemeIcon('arrow-circle-up');
		case 'hint':
			return new vscode.ThemeIcon('info');
		case 'dev':
			return new vscode.ThemeIcon('beaker');
		case 'package':
		case 'extra':
			return new vscode.ThemeIcon('package');
		default: {
			const unknown: never = icon;
			throw new Error(`Нет иконки зависимости: ${String(unknown)}`);
		}
	}
}

/** Строка списка пакетов. У прямой зависимости есть имя для обновления версии. */
class PackageTreeItem extends vscode.TreeItem {
	readonly packageName?: string;

	readonly children: PackageTreeItem[];

	constructor(row: DependencyTreeRow) {
		super(
			row.label,
			row.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
		);
		this.description = row.description;
		this.tooltip = row.tooltip;
		this.iconPath = dependencyIcon(row.icon);
		this.packageName = row.packageName;
		this.contextValue = row.packageName !== undefined ? 'oscriptPackage' : 'oscriptPackages';
		this.children = row.children.map((child) => new PackageTreeItem(child));
	}
}

/**
 * Дерево пакетов текущего проекта OneScript.
 */
export class PackagesViewProvider implements vscode.TreeDataProvider<PackageTreeItem>, vscode.Disposable {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private view: vscode.TreeView<PackageTreeItem> | undefined;
	private modulesWatcher: vscode.Disposable | undefined;
	private modulesTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly subscriptions: vscode.Disposable[] = [];

	constructor() {
		this.subscriptions.push(
			onDidChangeCurrentProject((change) => {
				this.watchInstalledPackages(change.current);
				this.refresh();
			}),
			onDidChangeProjects(() => this.refresh()),
			onDidChangeDependencyInsight(() => this.refresh())
		);
		this.watchInstalledPackages(currentRoot());
	}

	/** Связать провайдер с деревом, чтобы писать сводку над списком. */
	bind(view: vscode.TreeView<PackageTreeItem>): void {
		this.view = view;
		this.refresh();
	}

	getTreeItem(element: PackageTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: PackageTreeItem): PackageTreeItem[] {
		if (element) {
			return element.children;
		}
		const root = currentRoot();
		if (root === undefined) {
			return [];
		}
		return dependencyTreeRows(root).map((row) => new PackageTreeItem(row));
	}

	dispose(): void {
		this.modulesWatcher?.dispose();
		if (this.modulesTimer !== undefined) {
			clearTimeout(this.modulesTimer);
		}
		for (const subscription of this.subscriptions) {
			subscription.dispose();
		}
		this._onDidChangeTreeData.dispose();
	}

	private refresh(): void {
		const root = currentRoot();
		if (this.view) {
			this.view.message = root !== undefined ? dependencyTreeMessage(root) : '';
		}
		this._onDidChangeTreeData.fire();
	}

	/** packagedef и установленные пакеты: список перечитывается, прошлый отчёт depos сбрасывается. */
	private watchInstalledPackages(root: string | undefined): void {
		this.modulesWatcher?.dispose();
		this.modulesWatcher = undefined;
		if (this.modulesTimer !== undefined) {
			clearTimeout(this.modulesTimer);
			this.modulesTimer = undefined;
		}
		if (root === undefined) {
			return;
		}
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(root, '{packagedef,oscript_modules/*/opm-metadata.xml}')
		);
		const schedule = (): void => {
			forgetDependencyInsight(root);
			if (this.modulesTimer !== undefined) {
				clearTimeout(this.modulesTimer);
			}
			this.modulesTimer = setTimeout(() => {
				this.modulesTimer = undefined;
				this.refresh();
			}, 400);
		};
		this.modulesWatcher = vscode.Disposable.from(
			watcher,
			watcher.onDidCreate(schedule),
			watcher.onDidChange(schedule),
			watcher.onDidDelete(schedule)
		);
	}
}

/** Дерево пакетов в проводнике, рядом с артефактами. */
export function registerPackagesView(context: vscode.ExtensionContext): vscode.Disposable {
	const provider = new PackagesViewProvider();
	const view = vscode.window.createTreeView('1c-platform-tools-packages', {
		treeDataProvider: provider,
		showCollapseAll: true,
	});
	provider.bind(view);
	context.subscriptions.push(view, provider);
	return view;
}
