/**
 * Провайдеры TreeView для «Проекты 1С» — Избранное + Все проекты.
 */

import * as vscode from 'vscode';
import type { OneCLocator } from './oneCLocator';
import { ProjectStorage } from './storage';
import { StorageProvider } from './storageProvider';
import { AutodetectProvider } from './autodetectProvider';
import { TagNode } from './nodes';

export class ProjectsProviders {
	readonly storageProvider: StorageProvider;
	readonly autodetectProvider: AutodetectProvider;

	private readonly storageTreeView: vscode.TreeView<vscode.TreeItem>;
	private readonly autodetectTreeView: vscode.TreeView<vscode.TreeItem>;
	private readonly projectStorage: ProjectStorage;
	private readonly context: vscode.ExtensionContext;
	private readonly locator: OneCLocator;

	constructor(
		context: vscode.ExtensionContext,
		projectStorage: ProjectStorage,
		locator: OneCLocator,
		stack: import('./stack').ProjectsStack
	) {
		this.context = context;
		this.projectStorage = projectStorage;
		this.locator = locator;
		this.storageProvider = new StorageProvider(projectStorage, context, stack);
		this.autodetectProvider = new AutodetectProvider(locator, stack);

		this.storageTreeView = vscode.window.createTreeView('1c-platform-tools-projects-favorites', {
			treeDataProvider: this.storageProvider,
			showCollapseAll: false,
		});
		this.autodetectTreeView = vscode.window.createTreeView('1c-platform-tools-projects-all', {
			treeDataProvider: this.autodetectProvider,
			showCollapseAll: false,
		});

		context.subscriptions.push(
			this.storageTreeView.onDidExpandElement((e) => this.handleStorageExpandChange(e, true)),
			this.storageTreeView.onDidCollapseElement((e) => this.handleStorageExpandChange(e, false))
		);
	}

	private async handleStorageExpandChange(
		event: vscode.TreeViewExpansionEvent<vscode.TreeItem>,
		expanded: boolean
	): Promise<void> {
		const el = event.element;
		if (el instanceof TagNode) {
			const config = vscode.workspace.getConfiguration('1c-platform-tools');
			const behavior = config.get<string>('projects.tags.collapseItems', 'startExpanded');
			if (behavior === 'startExpanded' || behavior === 'startCollapsed') {
				const tagId = (el.label as string) || (el.description as string) || '';
				await StorageProvider.setTagExpanded(this.context, tagId, expanded);
			}
		}
	}

	refreshAll(): void {
		this.storageProvider.refresh();
		this.autodetectProvider.refresh();
	}

	refreshStorage(): void {
		this.storageProvider.refresh();
		this.updateStorageTitle();
	}

	refreshAutodetect(): void {
		this.autodetectProvider.refresh();
		this.updateAutodetectTitle();
	}

	updateStorageTitle(): void {
		const disabled = this.projectStorage.disabled().length;
		const filterByTags = this.context.globalState.get<string[]>('1c-platform-tools.projects.filterByTags', []);
		const total = this.projectStorage.length();
		let desc = '';
		if (disabled > 0) {
			desc += `${disabled} скрыто`;
		}
		if (filterByTags.length > 0) {
			desc += (desc ? ' · ' : '') + 'по тегам';
		}
		this.storageTreeView.title = `Избранное (${total - disabled})`;
		this.storageTreeView.description = desc || undefined;
	}

	updateAutodetectTitle(): void {
		this.autodetectTreeView.title = `Все проекты (${this.locator.projectList.length})`;
	}

	async showTreeViews(): Promise<void> {
		await this.locator.locateProjects();
		this.updateStorageTitle();
		this.updateAutodetectTitle();
	}
}
