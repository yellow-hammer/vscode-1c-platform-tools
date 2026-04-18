/**
 * TreeDataProvider для вкладки «Избранное».
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { expandHomePath } from './pathUtils';
import { sortProjects } from './sorter';
import { UNTAGGED_LABEL } from './constants';
import { ProjectStorage } from './storage';
import { ProjectsStack } from './stack';
import { NoTagNode, ProjectNode, TagNode } from './nodes';

const EXPANSION_STATE_KEY = '1c-platform-tools.projects.favorites.tagsExpansionState';

function collectDuplicateLabels(labels: string[]): Set<string> {
	const byLower = new Map<string, number>();
	for (const lb of labels) {
		const k = lb.toLowerCase();
		byLower.set(k, (byLower.get(k) ?? 0) + 1);
	}
	const dupes = new Set<string>();
	for (const [k, n] of byLower) {
		if (n > 1) {dupes.add(k);}
	}
	return dupes;
}

function resolveCollapseState(
	state: Record<string, boolean>,
	tagId: string,
	behavior: string
): vscode.TreeItemCollapsibleState {
	if (behavior === 'alwaysExpanded') {return vscode.TreeItemCollapsibleState.Expanded;}
	if (behavior === 'alwaysCollapsed') {return vscode.TreeItemCollapsibleState.Collapsed;}
	const stored = state[tagId];
	if (stored === undefined) {
		return behavior === 'startExpanded'
			? vscode.TreeItemCollapsibleState.Expanded
			: vscode.TreeItemCollapsibleState.Collapsed;
	}
	return stored ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
}

export class StorageProvider implements vscode.TreeDataProvider<ProjectNode | TagNode> {
	private readonly _emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._emitter.event;

	constructor(
		private readonly store: ProjectStorage,
		private readonly context: vscode.ExtensionContext,
		private readonly recent: ProjectsStack
	) {}

	static async clearExpansionState(ctx: vscode.ExtensionContext): Promise<void> {
		await ctx.globalState.update(EXPANSION_STATE_KEY, {});
	}

	static getTagCollapsibleState(
		ctx: vscode.ExtensionContext,
		tagId: string,
		behavior: string
	): vscode.TreeItemCollapsibleState {
		const state = ctx.globalState.get<Record<string, boolean>>(EXPANSION_STATE_KEY, {});
		return resolveCollapseState(state, tagId, behavior);
	}

	static async setTagExpanded(ctx: vscode.ExtensionContext, tagId: string, expanded: boolean): Promise<void> {
		const state = ctx.globalState.get<Record<string, boolean>>(EXPANSION_STATE_KEY, {});
		await ctx.globalState.update(EXPANSION_STATE_KEY, { ...state, [tagId]: expanded });
	}

	refresh(): void {
		this._emitter.fire();
	}

	getTreeItem(element: ProjectNode | TagNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ProjectNode | TagNode): Promise<(ProjectNode | TagNode)[]> {
		if (element) {
			const entries = this.store.byTag(element.label as string);
			const sorted = sortProjects(entries);
			const dupes = collectDuplicateLabels(sorted.map((e) => e.label));
			return sorted.map((e) => {
				const fullPath = expandHomePath(e.description);
				const proj = this.store.getByName(e.label);
				return new ProjectNode(e.label, vscode.TreeItemCollapsibleState.None, 'favorites', {
					name: e.label,
					path: fullPath,
					detail: dupes.has(e.label.toLowerCase()) ? path.basename(path.dirname(fullPath)) : undefined,
					tags: proj?.tags,
				}, {
					command: '1c-platform-tools.projects._open',
					title: '',
					arguments: [fullPath, e.label],
				});
			});
		}

		if (this.store.count() === 0) {return [];}

		const showAsList = this.context.globalState.get<boolean>('1c-platform-tools.projects.viewAsList', true);
		const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
		const collapseMode = cfg.get<string>('projects.tags.collapseItems', 'startExpanded');

		if (!showAsList) {
			const tags = this.store.allTags();
			const untaggedCount = this.store.byTag('').length;
			if (tags.length === 0 && untaggedCount === 0) {
				/* без тегов — ниже возвращается плоский список */
			} else {
				const tagNodes: TagNode[] = tags.map(
					(t) => new TagNode(t, StorageProvider.getTagCollapsibleState(this.context, t, collapseMode))
				);
				if (untaggedCount > 0) {
					tagNodes.push(
						new NoTagNode(
							UNTAGGED_LABEL,
							StorageProvider.getTagCollapsibleState(this.context, UNTAGGED_LABEL, collapseMode)
						)
					);
				}
				const filterTags = this.context.globalState.get<string[]>('1c-platform-tools.projects.filterByTags', []);
				if (filterTags.length > 0) {
					return tagNodes.filter((n) =>
						n instanceof NoTagNode ? filterTags.includes(UNTAGGED_LABEL) : filterTags.includes(n.label as string)
					);
				}
				return tagNodes;
			}
		}

		const filterTags = this.context.globalState.get<string[]>('1c-platform-tools.projects.filterByTags', []);
		const entries = filterTags.length > 0 ? this.store.byTags(filterTags) : this.store.entries();
		const sorted = sortProjects(entries);
		const dupes = collectDuplicateLabels(sorted.map((e) => e.label));
		return sorted.map((e) => {
			const fullPath = expandHomePath(e.description);
			const proj = this.store.getByName(e.label);
			return new ProjectNode(e.label, vscode.TreeItemCollapsibleState.None, 'favorites', {
				name: e.label,
				path: fullPath,
				detail: dupes.has(e.label.toLowerCase()) ? path.basename(path.dirname(fullPath)) : undefined,
				tags: proj?.tags,
			}, {
				command: '1c-platform-tools.projects._open',
				title: '',
				arguments: [fullPath, e.label],
			});
		});
	}
}
