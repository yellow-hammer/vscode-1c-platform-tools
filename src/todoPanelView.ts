/**
 * Панель «Список дел» в нижней части окна.
 * TreeDataProvider с группировкой по файлу, фильтрами по тегу и области.
 * @module todoPanelView
 */

import * as vscode from 'vscode';
import { scanWorkspaceForTodos, type TodoEntry } from './todoScanner';

const STATE_KEYS = {
	groupByFile: '1c-platform-tools.todo.groupByHierarchy',
	filterTags: '1c-platform-tools.todo.filterTags',
	filterScope: '1c-platform-tools.todo.filterScope',
} as const;

/** Область фильтра: весь проект, текущий файл или по расширению. */
export type FilterScope = 'all' | 'currentFile' | 'md' | 'bsl' | 'os' | 'feature';

/** Максимальная длина текста строки в колонке (обрезается с «…»). */
const MAX_LINE_PREVIEW_LEN = 80;

/** Расширение файла по значению области (кроме all и currentFile). */
const SCOPE_EXTENSION: Record<Exclude<FilterScope, 'all' | 'currentFile'>, string> = {
	md: '.md',
	bsl: '.bsl',
	os: '.os',
	feature: '.feature',
};

const TAG_ICON_COLORS: Record<string, string> = {
	FIXME: 'editorError.foreground',
	BUG: 'editorError.foreground',
	XXX: 'editorWarning.foreground',
	HACK: 'editorWarning.foreground',
};

const PLACEHOLDER_LOADING = 'Загрузка';
const PLACEHOLDER_EMPTY = 'Нет дел';

function getIconForTag(tag: string): vscode.ThemeIcon {
	const colorId = TAG_ICON_COLORS[tag] ?? 'editorInfo.foreground';
	return new vscode.ThemeIcon('primitive-dot', new vscode.ThemeColor(colorId));
}

/** Склонение «пункт» для числа (1 пункт, 2 пункта, 5 пунктов). */
function pluralPoints(count: number): string {
	if (count === 1) return 'пункт';
	if (count >= 2 && count <= 4) return 'пункта';
	return 'пунктов';
}

/**
 * Узел дерева списка дел: корень, плейсхолдер, группа по файлу или элемент (одна запись).
 */
export type TodoNode =
	| { kind: 'root' }
	| { kind: 'placeholder'; message: string }
	| { kind: 'file'; path: string; entries: TodoEntry[] }
	| { kind: 'entry'; entry: TodoEntry; tableMode?: boolean };

/** Проверяет, что узел — элемент списка (одна запись дела). */
export function isTodoEntryNode(node: TodoNode | undefined): node is { kind: 'entry'; entry: TodoEntry } {
	return node?.kind === 'entry';
}

/**
 * Провайдер дерева панели «Список дел».
 * Хранит кэш отсканированных записей, применяет фильтры по тегам и области, строит узлы с группировкой по файлу или плоский список.
 */
export class TodoPanelTreeDataProvider implements vscode.TreeDataProvider<TodoNode> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<TodoNode | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TodoNode | undefined | null | void> =
		this._onDidChangeTreeData.event;

	private _entries: TodoEntry[] = [];
	private _didInitialLoad = false;
	private _isScanning = false;
	private _lastFilteredCount = 0;
	private _treeView: vscode.TreeView<TodoNode> | undefined;

	constructor(private readonly _context: vscode.ExtensionContext) {}

	setTreeView(treeView: vscode.TreeView<TodoNode>): void {
		this._treeView = treeView;
		this._updateViewTitle();
	}

	getLastFilteredCount(): number {
		return this._lastFilteredCount;
	}

	private _updateViewTitle(): void {
		if (this._treeView) this._treeView.title = 'Список дел';
	}

	async refresh(): Promise<void> {
		this._isScanning = true;
		if (this._entries.length === 0) {
			this._fireChange();
		}
		try {
			this._entries = await scanWorkspaceForTodos();
			this._didInitialLoad = true;
			this._lastFilteredCount = this._filterEntries().length;
			this._updateViewTitle();
		} finally {
			this._isScanning = false;
		}
		this._fireChange();
	}

	getChildren(node?: TodoNode): TodoNode[] {
		if (!node || node.kind === 'root') return this._getRootChildren();
		if (node.kind === 'file') return node.entries.map((e) => ({ kind: 'entry' as const, entry: e, tableMode: false }));
		return [];
	}

	private _getRootChildren(): TodoNode[] {
		this._updateViewTitle();
		if (this._isScanning && this._entries.length === 0) {
			return [{ kind: 'placeholder', message: PLACEHOLDER_LOADING }];
		}
		const filtered = this._filterEntries();
		if (this._isScanning && this._entries.length > 0 && filtered.length === 0) {
			return [{ kind: 'placeholder', message: PLACEHOLDER_EMPTY }];
		}
		if (!this._didInitialLoad) {
			this._didInitialLoad = true;
			void this.refresh();
			return [{ kind: 'placeholder', message: PLACEHOLDER_LOADING }];
		}
		if (this._entries.length === 0 || filtered.length === 0) {
			return [{ kind: 'placeholder', message: PLACEHOLDER_EMPTY }];
		}
		this._lastFilteredCount = filtered.length;
		return this._buildNodesFromEntries(filtered);
	}

	private _buildNodesFromEntries(entries: TodoEntry[]): TodoNode[] {
		const groupBy = this._context.globalState.get<boolean>(STATE_KEYS.groupByFile) ?? true;
		if (!groupBy) {
			return entries.map((entry) => ({ kind: 'entry' as const, entry, tableMode: true }));
		}
		const byPath = new Map<string, TodoEntry[]>();
		for (const e of entries) {
			const p = this._relPath(e.uri);
			if (!byPath.has(p)) byPath.set(p, []);
			byPath.get(p)!.push(e);
		}
		return Array.from(byPath.entries())
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([filePath, fileEntries]) => ({ kind: 'file' as const, path: filePath, entries: fileEntries }));
	}

	private _filterEntries(): TodoEntry[] {
		let list = this._entries;
		const filterTags = this._context.globalState.get<string[]>(STATE_KEYS.filterTags);
		if (filterTags?.length) {
			const set = new Set(filterTags.map((t) => t.toUpperCase()));
			list = list.filter((e) => set.has(e.tag));
		}
		const scope = this._context.globalState.get<FilterScope>(STATE_KEYS.filterScope) ?? 'all';
		if (scope === 'all') return list;
		if (scope === 'currentFile') {
			const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
			return activeUri ? list.filter((e) => e.uri.toString() === activeUri) : [];
		}
		const ext = SCOPE_EXTENSION[scope] ?? '';
		return list.filter((e) => e.uri.fsPath.toLowerCase().endsWith(ext));
	}

	private _fireChange(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	private _relPath(uri: vscode.Uri): string {
		return vscode.workspace.workspaceFolders?.length
			? vscode.workspace.asRelativePath(uri)
			: uri.fsPath;
	}

	private _fileLabel(filePath: string): { fileName: string; dirPath: string } {
		const sep = filePath.includes('/') ? '/' : '\\';
		const parts = filePath.split(sep);
		const fileName = parts.at(-1) ?? filePath;
		const lastSep = filePath.lastIndexOf(sep);
		const dirPath = lastSep <= 0 ? '' : filePath.slice(0, lastSep);
		return { fileName, dirPath };
	}

	getTreeItem(node: TodoNode): vscode.TreeItem {
		if (node.kind === 'root') return new vscode.TreeItem('', vscode.TreeItemCollapsibleState.None);
		if (node.kind === 'placeholder') {
			const item = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
			item.contextValue = 'todoPlaceholder';
			item.iconPath = new vscode.ThemeIcon(
				node.message === PLACEHOLDER_LOADING ? 'loading~spin' : 'check-all'
			);
			if (node.message !== PLACEHOLDER_LOADING) {
				item.command = { command: '1c-platform-tools.todo.refresh', title: 'Обновить' };
			}
			return item;
		}
		if (node.kind === 'file') {
			const count = node.entries.length;
			const { fileName, dirPath } = this._fileLabel(node.path);
			const label = dirPath ? `${fileName} ${dirPath}` : fileName;
			const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
			item.contextValue = 'todoFile';
			item.description = String(count);
			item.iconPath = new vscode.ThemeIcon('symbol-file');
			item.tooltip = `${node.path} — ${count} ${pluralPoints(count)}`;
			return item;
		}
		const e = node.entry;
		const pathStr = this._relPath(e.uri);
		const lineContent = e.lineContent ?? e.message ?? '';
		const msgCol = lineContent.length > MAX_LINE_PREVIEW_LEN
			? `${lineContent.slice(0, MAX_LINE_PREVIEW_LEN)}…`
			: lineContent;
		const locationStr = `стр. ${e.line}`;
		const isTable = node.tableMode === true;
		const item = new vscode.TreeItem(msgCol, vscode.TreeItemCollapsibleState.None);
		item.contextValue = 'todoEntry';
		item.description = isTable ? `${pathStr}  ${locationStr}` : locationStr;
		item.iconPath = getIconForTag(e.tag);
		item.tooltip = `${pathStr} — строка ${e.line}`;
		item.command = {
			command: '1c-platform-tools.todo.openLocation',
			title: 'Перейти',
			arguments: [e.uri.toString(), e.line],
		};
		return item;
	}

	getGroupByFile(): boolean {
		return this._context.globalState.get<boolean>(STATE_KEYS.groupByFile) ?? true;
	}

	async setGroupByFile(value: boolean): Promise<void> {
		await this._context.globalState.update(STATE_KEYS.groupByFile, value);
		this._fireChange();
	}

	getFilterTags(): string[] | undefined {
		return this._context.globalState.get<string[]>(STATE_KEYS.filterTags);
	}

	async setFilterTags(tags: string[] | null): Promise<void> {
		await this._context.globalState.update(STATE_KEYS.filterTags, tags?.length ? tags : undefined);
		this._fireChange();
	}

	getFilterScope(): FilterScope {
		return this._context.globalState.get<FilterScope>(STATE_KEYS.filterScope) ?? 'all';
	}

	async setFilterScope(scope: FilterScope): Promise<void> {
		await this._context.globalState.update(STATE_KEYS.filterScope, scope === 'all' ? undefined : scope);
		this._fireChange();
	}

	async clearAllFilters(): Promise<void> {
		await this._context.globalState.update(STATE_KEYS.filterTags, undefined);
		await this._context.globalState.update(STATE_KEYS.filterScope, undefined);
		this._fireChange();
	}

	refreshView(): void {
		this._fireChange();
	}
}
