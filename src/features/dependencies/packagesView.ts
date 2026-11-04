/**
 * Представление «1С: Пакеты» в проводнике, рядом с «1С: Артефакты».
 *
 * Зависимости всех проектов окна. Когда проектов несколько, они стоят группами,
 * выбранный проект первым и раскрыт. У каждой строки есть корень её проекта:
 * кнопки шапки получают выбранную строку и выполняются в этом проекте.
 */

import * as vscode from 'vscode';
import {
	onDidChangeCurrentProject,
	onDidChangeProjects,
	projectScanRoots,
	sameProjectRoot,
} from '../../shared/workspaceProjects';
import {
	CURRENT_PROJECT_DESCRIPTION,
	projectLabel,
	selectedRoot,
} from '../artifacts/projectScan';
import { forgetDependencyInsight, onDidChangeDependencyInsight } from './dependencyInsight';
import { dependencyTreeMessage, dependencyTreeRows, type DependencyRowIcon, type DependencyTreeRow } from './dependencyTree';

/** Откуда панель берёт проекты и строки. В тестах подменяется. */
export interface PackagesTreeSource {
	/** Корни проектов окна. */
	roots(): readonly string[];
	/** Строки зависимостей одного проекта. */
	rows(root: string): DependencyTreeRow[];
	/** Сводка над списком для одного проекта. */
	message(root: string): string;
	/** Выбранный проект, без корня выполняющейся команды. */
	selected(): string | undefined;
}

const workspacePackagesSource: PackagesTreeSource = {
	roots: () => projectScanRoots().map((scanRoot) => scanRoot.root),
	rows: dependencyTreeRows,
	message: dependencyTreeMessage,
	selected: selectedRoot,
};

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

	/** Корень проекта строки: команда шапки выполняется в нём. */
	readonly projectRoot: string;

	readonly children: PackageTreeItem[];

	constructor(row: DependencyTreeRow, projectRoot: string) {
		super(
			row.label,
			row.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
		);
		this.description = row.description;
		this.tooltip = row.tooltip;
		this.iconPath = dependencyIcon(row.icon);
		this.packageName = row.packageName;
		this.projectRoot = projectRoot;
		this.contextValue = row.packageName !== undefined ? 'oscriptPackage' : 'oscriptPackages';
		this.children = row.children.map((child) => new PackageTreeItem(child, projectRoot));
	}
}

/** Группа проекта, когда проектов несколько. */
class PackageProjectItem extends vscode.TreeItem {
	/** Корень проекта группы. */
	readonly projectRoot: string;

	readonly children: PackageTreeItem[];

	constructor(root: string, rows: readonly DependencyTreeRow[], selected: boolean) {
		super(
			projectLabel(root),
			selected ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
		);
		this.projectRoot = root;
		this.description = selected ? CURRENT_PROJECT_DESCRIPTION : undefined;
		this.tooltip = root;
		this.iconPath = new vscode.ThemeIcon('repo');
		this.contextValue = 'oscriptPackagesProject';
		this.children = rows.map((row) => new PackageTreeItem(row, root));
	}
}

type PackagesTreeElement = PackageProjectItem | PackageTreeItem;

/** Дерево, у которого панель пишет сводку. */
type PackagesTreeMessage = Pick<vscode.TreeView<PackagesTreeElement>, 'message'>;

/**
 * Дерево пакетов проектов окна.
 */
export class PackagesViewProvider implements vscode.TreeDataProvider<PackagesTreeElement>, vscode.Disposable {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private view: PackagesTreeMessage | undefined;
	private modulesWatcher: vscode.Disposable | undefined;
	private modulesTimer: ReturnType<typeof setTimeout> | undefined;
	private watched: string[] = [];
	private readonly subscriptions: vscode.Disposable[] = [];

	/**
	 * @param source - Проекты и их зависимости; по умолчанию проекты окна
	 */
	constructor(private readonly source: PackagesTreeSource = workspacePackagesSource) {
		this.subscriptions.push(
			onDidChangeCurrentProject(() => this.refresh()),
			onDidChangeProjects(() => this.refresh()),
			onDidChangeDependencyInsight(() => this.refresh())
		);
		this.syncWatchers();
	}

	/** Связать провайдер с деревом, чтобы писать сводку над списком. */
	bind(view: PackagesTreeMessage): void {
		this.view = view;
		this.refresh();
	}

	getTreeItem(element: PackagesTreeElement): vscode.TreeItem {
		return element;
	}

	getChildren(element?: PackagesTreeElement): PackagesTreeElement[] {
		if (element) {
			return element.children;
		}
		const roots = this.rootsInOrder();
		if (roots.length === 0) {
			return [];
		}
		if (roots.length === 1) {
			return this.rowsOf(roots[0]);
		}
		const selected = this.source.selected();
		return roots.map((root) => new PackageProjectItem(
			root,
			this.source.rows(root),
			selected !== undefined && sameProjectRoot(root, selected)
		));
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

	/** Выбранный проект первым, остальные в прежнем порядке. */
	private rootsInOrder(): string[] {
		const roots = [...this.source.roots()];
		const selected = this.source.selected();
		const index = selected === undefined ? -1 : roots.findIndex((root) => sameProjectRoot(root, selected));
		return index <= 0 ? roots : [roots[index], ...roots.slice(0, index), ...roots.slice(index + 1)];
	}

	private rowsOf(root: string): PackageTreeItem[] {
		return this.source.rows(root).map((row) => new PackageTreeItem(row, root));
	}

	private refresh(): void {
		this.syncWatchers();
		this.updateMessage();
		this._onDidChangeTreeData.fire();
	}

	private updateMessage(): void {
		if (!this.view) {
			return;
		}
		const roots = this.source.roots();
		if (roots.length === 0) {
			this.view.message = '';
			return;
		}
		const selected = this.source.selected();
		const current = roots.length === 1
			? roots[0]
			: roots.find((root) => selected !== undefined && sameProjectRoot(root, selected));
		if (current === undefined) {
			this.view.message = '';
			return;
		}
		const summary = this.source.message(current);
		if (summary === '') {
			this.view.message = '';
			return;
		}
		this.view.message = roots.length > 1 ? `${projectLabel(current)}: ${summary}` : summary;
	}

	/** packagedef и установленные пакеты каждого проекта: список перечитывается, прошлый отчёт depos сбрасывается. */
	private syncWatchers(): void {
		const roots = [...this.source.roots()];
		if (
			roots.length === this.watched.length &&
			roots.every((root, index) => sameProjectRoot(root, this.watched[index]))
		) {
			return;
		}
		this.modulesWatcher?.dispose();
		this.watched = roots;
		this.modulesWatcher = vscode.Disposable.from(...roots.map((root) => this.watchRoot(root)));
	}

	private watchRoot(root: string): vscode.Disposable {
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(root, '{packagedef,oscript_modules/*/opm-metadata.xml}')
		);
		const schedule = (): void => {
			this.scheduleRefresh(root);
		};
		return vscode.Disposable.from(
			watcher,
			watcher.onDidCreate(schedule),
			watcher.onDidChange(schedule),
			watcher.onDidDelete(schedule)
		);
	}

	private scheduleRefresh(root: string): void {
		forgetDependencyInsight(root);
		if (this.modulesTimer !== undefined) {
			clearTimeout(this.modulesTimer);
		}
		this.modulesTimer = setTimeout(() => {
			this.modulesTimer = undefined;
			this.refresh();
		}, 400);
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
