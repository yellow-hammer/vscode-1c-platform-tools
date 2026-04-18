/**
 * Сортировка списка проектов для отображения.
 */

import * as vscode from 'vscode';

type ListItem = { label: string; description: string };

function byLabel(a: ListItem, b: ListItem): number {
	return (a.label ?? '').toLowerCase().localeCompare((b.label ?? '').toLowerCase(), undefined, {
		sensitivity: 'base',
	});
}

function byPath(a: ListItem, b: ListItem): number {
	return (a.description ?? '').toLowerCase().localeCompare((b.description ?? '').toLowerCase(), undefined, {
		sensitivity: 'base',
	});
}

export function sortProjects(items: ListItem[]): ListItem[] {
	const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
	const mode = cfg.get<string>('projects.sortList', 'Name');
	const copy = [...items];
	return mode === 'Path' ? copy.sort(byPath) : copy.sort(byLabel);
}
