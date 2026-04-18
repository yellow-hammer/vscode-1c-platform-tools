/**
 * Узлы дерева проектов.
 */

import * as path from 'node:path';
import type { Command } from 'vscode';
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { VIEW_SCHEME } from './decoration';

export interface ProjectPreview {
	name: string;
	path: string;
	detail?: string;
	tags?: string[];
}

export class ProjectNode extends TreeItem {
	constructor(
		label: string,
		collapsibleState: TreeItemCollapsibleState,
		_icon: string | undefined,
		preview: ProjectPreview,
		command?: Command
	) {
		super(label, collapsibleState);
		this.contextValue = 'ProjectNodeKind';
		this.iconPath = new ThemeIcon('folder');
		this.resourceUri = Uri.from({ scheme: VIEW_SCHEME, path: preview.path });
		this.description = preview.detail;
		this.command = command;

		const md = new MarkdownString(undefined, true);
		md.appendMarkdown(`${label}\n\n`);
		md.appendMarkdown(`_${preview.path}_\n\n`);
		if (preview.tags && preview.tags.length > 0) {
			md.appendMarkdown(`$(tag) ${preview.tags.join(', ')}`);
		} else {
			md.appendMarkdown('$(folder) Проект 1С');
		}
		this.tooltip = md;
	}
}

export class TagNode extends TreeItem {
	constructor(label: string, collapsibleState: TreeItemCollapsibleState) {
		super(label, collapsibleState);
		this.iconPath = new ThemeIcon('tag');
	}
}

export class NoTagNode extends TagNode {
	constructor(label: string, collapsibleState: TreeItemCollapsibleState) {
		super('', collapsibleState);
		this.description = label;
	}
}
