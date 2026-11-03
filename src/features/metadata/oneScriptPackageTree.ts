/**
 * Дерево пакета OneScript: классы, модули и программы из `packagedef`, задачи из каталога задач.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { oneScriptTasksDirectory } from '../../shared/oneScriptLayout';
import { PROJECT_FILE } from '../../shared/projectLayout';
import { packageMembers, parsePackagedef, type PackageMemberKind } from '../../shared/packagedef';

const GROUP_LABEL: Readonly<Record<PackageMemberKind, string>> = {
	class: 'Классы',
	module: 'Модули',
	executable: 'Программы',
};

const GROUP_ICON: Readonly<Record<PackageMemberKind, string>> = {
	class: 'symbol-class',
	module: 'symbol-module',
	executable: 'terminal',
};

/** Цвет обычной иконки темы. Без него VS Code красит `symbol-*` своим цветом символа. */
const PLAIN_ICON = new vscode.ThemeColor('icon.foreground');

function plainIcon(id: string): vscode.ThemeIcon {
	return new vscode.ThemeIcon(id, PLAIN_ICON);
}

function oneScriptExpansionId(kind: PackageMemberKind | 'tasks'): string {
	return `oscript:${kind}`;
}

/** Раскрыта группа или свёрнута. Без сохранённого состояния верхний уровень свёрнут. */
function groupState(hasChildren: boolean, expanded: boolean | undefined): vscode.TreeItemCollapsibleState {
	if (!hasChildren) {
		return vscode.TreeItemCollapsibleState.None;
	}
	return (expanded ?? false)
		? vscode.TreeItemCollapsibleState.Expanded
		: vscode.TreeItemCollapsibleState.Collapsed;
}

/** Группа состава пакета. */
export class OneScriptGroupTreeItem extends vscode.TreeItem {
	readonly kind: PackageMemberKind;

	readonly members: readonly OneScriptMemberTreeItem[];

	readonly expansionId: string;

	constructor(kind: PackageMemberKind, members: readonly OneScriptMemberTreeItem[], expanded?: boolean) {
		super(GROUP_LABEL[kind], groupState(members.length > 0, expanded));
		this.kind = kind;
		this.members = members;
		this.expansionId = oneScriptExpansionId(kind);
		this.contextValue = kind === 'class'
			? 'oneScriptPackageGroupClass'
			: kind === 'module'
				? 'oneScriptPackageGroupModule'
				: 'oneScriptPackageGroupExecutable';
		this.iconPath = plainIcon(GROUP_ICON[kind]);
	}
}

/** Класс, модуль или программа пакета. */
export class OneScriptMemberTreeItem extends vscode.TreeItem {
	constructor(
		readonly kind: PackageMemberKind,
		name: string,
		readonly file: string,
		root: string
	) {
		super(name, vscode.TreeItemCollapsibleState.None);
		this.description = file;
		this.contextValue = 'oneScriptPackageMemberDeletable';
		this.resourceUri = vscode.Uri.file(path.resolve(root, file));
		this.command = { command: 'vscode.open', title: 'Открыть', arguments: [this.resourceUri] };
		this.iconPath = plainIcon('file');
	}
}

/** Файл задачи: `*.os` в каталоге задач. */
export class OneScriptTaskTreeItem extends vscode.TreeItem {
	constructor(name: string, file: vscode.Uri) {
		super(name, vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'oneScriptTask';
		this.resourceUri = file;
		this.command = { command: 'vscode.open', title: 'Открыть', arguments: [file] };
		this.iconPath = new vscode.ThemeIcon('rocket');
		this.tooltip = file.fsPath;
	}
}

/** Группа задач внизу дерева метаданных. */
export class OneScriptTasksGroupTreeItem extends vscode.TreeItem {
	readonly tasks: readonly OneScriptTaskTreeItem[];

	readonly expansionId = oneScriptExpansionId('tasks');

	constructor(tasks: readonly OneScriptTaskTreeItem[], expanded?: boolean) {
		super('Задачи (oscript)', groupState(tasks.length > 0, expanded));
		this.tasks = tasks;
		this.contextValue = 'oneScriptTasksGroup';
		this.iconPath = new vscode.ThemeIcon('rocket');
	}
}

/**
 * Задачи проекта: файлы `*.os` из каталога задач OneScript.
 *
 * @param root - Корень проекта
 * @returns Группа или undefined, если задач нет
 */
export async function oneScriptTasksGroup(
	root: string,
	expanded?: (id: string) => boolean | undefined
): Promise<OneScriptTasksGroupTreeItem | undefined> {
	const directory = oneScriptTasksDirectory(root);
	let names: string[] = [];
	try {
		const entries = await fs.readdir(directory, { withFileTypes: true });
		names = entries
			.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.os'))
			.map((entry) => entry.name)
			.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
	} catch {
		return undefined;
	}
	if (names.length === 0) {
		return undefined;
	}
	return new OneScriptTasksGroupTreeItem(
		names.map((file) => new OneScriptTaskTreeItem(
			path.basename(file, path.extname(file)),
			vscode.Uri.file(path.join(directory, file))
		)),
		expanded?.(oneScriptExpansionId('tasks'))
	);
}

/**
 * Корень дерева пакета.
 *
 * @param root - Корень проекта
 * @returns Группы или текст пояснения, если файла `packagedef` нет
 */
export async function oneScriptPackageRoot(
	root: string,
	expanded?: (id: string) => boolean | undefined
): Promise<OneScriptGroupTreeItem[] | string> {
	let source: string;
	try {
		source = await fs.readFile(path.join(root, PROJECT_FILE), 'utf8');
	} catch {
		return 'Нет файла packagedef';
	}
	const members = packageMembers(parsePackagedef(source));
	return (['class', 'module', 'executable'] as const).flatMap((kind) => {
		const items = members
			.filter((member) => member.kind === kind)
			.map((member) => new OneScriptMemberTreeItem(member.kind, member.name, member.file, root));
		if (items.length === 0) {
			return [];
		}
		return [new OneScriptGroupTreeItem(kind, items, expanded?.(oneScriptExpansionId(kind)))];
	});
}
