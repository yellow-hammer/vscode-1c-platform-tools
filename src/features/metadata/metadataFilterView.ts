/**
 * Панель «Фильтры»: поле поиска, дерево подсистем с флажками и переключатели охвата.
 * Раскладка повторяет диалог «Фильтр по подсистемам» из EDT; отбор применяется сразу,
 * без отдельной кнопки.
 * @module metadataFilterView
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { hasNestedSubsystems, nestedSubsystemXmls, parentSubsystemXml, type SubsystemRef } from './metadataSubsystemFilter';
import type { MetadataLeafTreeItem, MetadataTreeDataProvider } from './metadataTreeView';

export const METADATA_FILTERS_VIEW_ID = '1c-platform-tools-metadata-filters';

/** Пауза перед применением: подсистемы отмечают пачкой, состав читаем один раз. */
const APPLY_DEBOUNCE_MS = 350;

export type FilterOptionKey = 'includeNested' | 'includeParents';

export interface FilterSelection {
	readonly subsystems: readonly SubsystemRef[];
	readonly includeNested: boolean;
	readonly includeParents: boolean;
}

/** Узел дерева подсистем для webview. */
interface SubsystemTreeNode {
	readonly key: string;
	readonly name: string;
	readonly children: SubsystemTreeNode[];
}

export class MetadataFilterViewProvider implements vscode.WebviewViewProvider {
	private _view: vscode.WebviewView | undefined;
	private readonly _refByKey = new Map<string, SubsystemRef>();
	private readonly _checked = new Set<string>();
	private readonly _options: Record<FilterOptionKey, boolean> = { includeNested: true, includeParents: false };
	private _applyTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly _treeProvider: MetadataTreeDataProvider,
		private readonly _onSelectionChanged: (selection: FilterSelection) => void
	) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		this._view = view;
		view.webview.options = { enableScripts: true };
		view.webview.html = this.html();
		view.webview.onDidReceiveMessage((msg: unknown) => this.onMessage(msg));
		view.onDidChangeVisibility(() => {
			if (view.visible) {
				this.pushTree();
			}
		});
		view.onDidDispose(() => {
			this._view = undefined;
		});
		this.pushTree();
	}

	/** Перечитывает подсистемы: дерево метаданных могло обновиться. */
	refresh(): void {
		this.pushTree();
	}

	collapseAll(): void {
		void this._view?.webview.postMessage({ type: 'collapseAll' });
	}

	/** Снимает флажки и сбрасывает отбор. */
	clear(): void {
		this._checked.clear();
		void this._view?.webview.postMessage({ type: 'clearChecked' });
		this.scheduleApply();
	}

	private onMessage(msg: unknown): void {
		if (typeof msg !== 'object' || msg === null) {
			return;
		}
		const message = msg as { type?: string; key?: string; checked?: boolean; option?: FilterOptionKey };
		if (message.type === 'toggle' && typeof message.key === 'string') {
			if (message.checked) {
				this._checked.add(message.key);
			} else {
				this._checked.delete(message.key);
			}
			this.scheduleApply();
			return;
		}
		if (message.type === 'option' && message.option) {
			this._options[message.option] = message.checked === true;
			this.scheduleApply();
			return;
		}
		if (message.type === 'ready') {
			this.pushTree();
		}
	}

	private scheduleApply(): void {
		if (this._applyTimer) {
			clearTimeout(this._applyTimer);
		}
		this._applyTimer = setTimeout(() => {
			this._applyTimer = undefined;
			const subsystems: SubsystemRef[] = [];
			for (const key of this._checked) {
				const ref = this._refByKey.get(key);
				if (ref) {
					subsystems.push(ref);
				}
			}
			this._onSelectionChanged({
				subsystems,
				includeNested: this._options.includeNested,
				includeParents: this._options.includeParents,
			});
		}, APPLY_DEBOUNCE_MS);
	}

	private pushTree(): void {
		if (!this._view) {
			return;
		}
		this._refByKey.clear();
		const roots = this._treeProvider
			.listSubsystemLeaves()
			.filter((leaf) => leaf.resourceUri && !parentSubsystemXml(leaf.resourceUri.fsPath))
			.map((leaf) => this.refFromLeaf(leaf))
			.filter((ref): ref is SubsystemRef => ref !== undefined);
		const nodes = this.toNodes(roots);
		void this._view.webview.postMessage({
			type: 'tree',
			nodes,
			checked: [...this._checked],
			options: this._options,
		});
	}

	private toNodes(refs: SubsystemRef[]): SubsystemTreeNode[] {
		return refs
			.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
			.map((ref) => {
				this._refByKey.set(ref.xmlAbs, ref);
				const children = hasNestedSubsystems(ref.xmlAbs, ref.name)
					? this.toNodes(
							nestedSubsystemXmls(ref.xmlAbs, ref.name).map((xmlAbs) => ({
								sourceId: ref.sourceId,
								name: path.basename(xmlAbs, '.xml'),
								xmlAbs,
								configurationXmlAbs: ref.configurationXmlAbs,
								metadataRootAbs: ref.metadataRootAbs,
							}))
						)
					: [];
				return { key: ref.xmlAbs, name: ref.name, children };
			});
	}

	private refFromLeaf(leaf: MetadataLeafTreeItem): SubsystemRef | undefined {
		if (!leaf.resourceUri) {
			return undefined;
		}
		return {
			sourceId: leaf.sourceId,
			name: leaf.name,
			xmlAbs: leaf.resourceUri.fsPath,
			configurationXmlAbs: leaf.configurationXmlAbs,
			metadataRootAbs: leaf.metadataRootAbs,
		};
	}

	private html(): string {
		return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<style>
	body {
		margin: 0;
		padding: 4px 0 6px 0;
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		color: var(--vscode-foreground);
	}
	.search {
		position: relative;
		padding: 0 8px 4px 8px;
	}
	.search input {
		width: 100%;
		box-sizing: border-box;
		padding: 3px 22px 3px 6px;
		border-radius: 2px;
		border: 1px solid var(--vscode-input-border, transparent);
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		font-family: inherit;
		font-size: inherit;
	}
	.search input:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	.search-clear {
		position: absolute;
		top: 2px;
		right: 12px;
		border: none;
		background: transparent;
		color: var(--vscode-descriptionForeground);
		cursor: pointer;
		font-size: 13px;
		line-height: 1;
	}
	.search-clear.hidden {
		display: none;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 1px 8px;
		white-space: nowrap;
	}
	.row:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.twisty {
		width: 14px;
		flex: 0 0 14px;
		border: none;
		background: transparent;
		color: var(--vscode-foreground);
		cursor: pointer;
		padding: 0;
		font-size: 10px;
		line-height: 1;
		text-align: center;
	}
	.twisty.empty {
		visibility: hidden;
		cursor: default;
	}
	label.name {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.options {
		margin-top: 6px;
		padding: 6px 8px 0 8px;
		border-top: 1px solid var(--vscode-panel-border);
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.options label {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		cursor: pointer;
		color: var(--vscode-descriptionForeground);
	}
	.empty-note {
		padding: 4px 8px;
		color: var(--vscode-descriptionForeground);
	}
	body.vscode-dark {
		color-scheme: dark;
	}
</style>
</head>
<body>
	<div class="search">
		<input id="q" type="text" placeholder="Поиск подсистем…" autocomplete="off" />
		<button id="clearSearch" class="search-clear hidden" type="button" title="Очистить">×</button>
	</div>
	<div id="tree"></div>
	<div class="options">
		<label><input id="includeNested" type="checkbox" checked /><span>Включать объекты из подчинённых подсистем</span></label>
		<label><input id="includeParents" type="checkbox" /><span>Включать объекты из родительских подсистем</span></label>
	</div>
	<script>
		const vscodeApi = acquireVsCodeApi();
		const treeRoot = document.getElementById('tree');
		const searchInput = document.getElementById('q');
		const clearSearchBtn = document.getElementById('clearSearch');
		const nestedBox = document.getElementById('includeNested');
		const parentsBox = document.getElementById('includeParents');
		let nodes = [];
		let checked = new Set();
		let collapsed = new Set();
		let query = '';

		function matches(node) {
			if (!query) {
				return true;
			}
			const terms = query.toLowerCase().split(/\\s+/).filter(Boolean);
			const name = node.name.toLowerCase();
			return terms.every((term) => name.includes(term));
		}

		function subtreeMatches(node) {
			return matches(node) || node.children.some(subtreeMatches);
		}

		function rowHtml(node, depth) {
			const visibleChildren = node.children.filter(subtreeMatches);
			const hasChildren = visibleChildren.length > 0;
			// При поиске ветки с совпадениями раскрыты, иначе результат пришлось бы разворачивать руками.
			const isCollapsed = query ? false : collapsed.has(node.key);
			const twisty = hasChildren
				? '<button class="twisty" data-twisty="' + escapeAttr(node.key) + '">' + (isCollapsed ? '▶' : '▼') + '</button>'
				: '<span class="twisty empty"></span>';
			const box = '<input type="checkbox" data-key="' + escapeAttr(node.key) + '"' + (checked.has(node.key) ? ' checked' : '') + ' />';
			const row =
				'<div class="row" style="padding-left:' + (8 + depth * 14) + 'px">' +
				twisty +
				'<label class="name">' + box + '<span>' + escapeHtml(node.name) + '</span></label>' +
				'</div>';
			const children = hasChildren && !isCollapsed
				? visibleChildren.map((child) => rowHtml(child, depth + 1)).join('')
				: '';
			return row + children;
		}

		function render() {
			const visible = nodes.filter(subtreeMatches);
			treeRoot.innerHTML = visible.length
				? visible.map((node) => rowHtml(node, 0)).join('')
				: '<div class="empty-note">' + (query ? 'Подсистемы не найдены' : 'Подсистем нет') + '</div>';
			for (const box of treeRoot.querySelectorAll('input[type=checkbox]')) {
				box.addEventListener('change', function () {
					const key = box.getAttribute('data-key');
					if (box.checked) {
						checked.add(key);
					} else {
						checked.delete(key);
					}
					vscodeApi.postMessage({ type: 'toggle', key: key, checked: box.checked });
				});
			}
			for (const btn of treeRoot.querySelectorAll('[data-twisty]')) {
				btn.addEventListener('click', function () {
					const key = btn.getAttribute('data-twisty');
					if (collapsed.has(key)) {
						collapsed.delete(key);
					} else {
						collapsed.add(key);
					}
					render();
				});
			}
		}

		function escapeHtml(text) {
			return String(text).replace(/[&<>"']/g, function (ch) {
				return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
			});
		}

		function escapeAttr(text) {
			return escapeHtml(text);
		}

		function collectKeys(list, out) {
			for (const node of list) {
				if (node.children.length > 0) {
					out.push(node.key);
					collectKeys(node.children, out);
				}
			}
			return out;
		}

		searchInput.addEventListener('input', function () {
			query = searchInput.value.trim();
			clearSearchBtn.classList.toggle('hidden', query.length === 0);
			render();
		});
		searchInput.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && searchInput.value) {
				searchInput.value = '';
				query = '';
				clearSearchBtn.classList.add('hidden');
				render();
			}
		});
		clearSearchBtn.addEventListener('click', function () {
			searchInput.value = '';
			query = '';
			clearSearchBtn.classList.add('hidden');
			searchInput.focus();
			render();
		});
		nestedBox.addEventListener('change', function () {
			vscodeApi.postMessage({ type: 'option', option: 'includeNested', checked: nestedBox.checked });
		});
		parentsBox.addEventListener('change', function () {
			vscodeApi.postMessage({ type: 'option', option: 'includeParents', checked: parentsBox.checked });
		});

		window.addEventListener('message', function (event) {
			const msg = event.data;
			if (!msg) {
				return;
			}
			if (msg.type === 'tree') {
				nodes = msg.nodes || [];
				checked = new Set(msg.checked || []);
				nestedBox.checked = !!(msg.options && msg.options.includeNested);
				parentsBox.checked = !!(msg.options && msg.options.includeParents);
				render();
			}
			if (msg.type === 'collapseAll') {
				collapsed = new Set(collectKeys(nodes, []));
				render();
			}
			if (msg.type === 'clearChecked') {
				checked = new Set();
				render();
			}
		});

		vscodeApi.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
	}
}
