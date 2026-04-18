/**
 * TreeDataProvider для представления «Помощь и поддержка» в контейнере «Проекты 1С».
 * Показывает те же команды, что и группа «Помощь и поддержка» в «Инструменты 1С».
 */

import * as vscode from 'vscode';
import { TREE_GROUPS } from '../tools/treeStructure';

export class HelpAndSupportProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	getChildren(): vscode.TreeItem[] {
		const group = TREE_GROUPS.find((g) => g.sectionType === 'helpAndSupport');
		if (!group) {
			return [];
		}
		return group.commands.map((cmd) => {
			const item = new vscode.TreeItem(cmd.treeLabel, vscode.TreeItemCollapsibleState.None);
			item.command = {
				command: cmd.command,
				title: cmd.title,
			};
			item.iconPath = cmd.icon
				? new vscode.ThemeIcon(cmd.icon)
				: new vscode.ThemeIcon('lightbulb');
			return item;
		});
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}
}
