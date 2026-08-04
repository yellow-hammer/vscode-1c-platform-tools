/**
 * Отдельная панель «Свойства»: показывает свойства того, что выделено, откуда бы выделение ни пришло.
 *
 * Содержимое описывается данными, а не разметкой: источник отдаёт группы и строки
 * (`PropertyPaletteState`), панель их рисует. Так один и тот же механизм обслуживает элементы
 * формы, объекты метаданных и всё, что появится дальше.
 *
 * @module propertyPaletteView
 */

import * as vscode from 'vscode';

export const PROPERTY_PALETTE_VIEW_ID = '1c-platform-tools-properties';

/** Вид редактора значения; пока панель показывает значения, правка появится вместе с записью. */
export type PropertyControlKind = 'text' | 'multiline' | 'number' | 'boolean' | 'select' | 'reference';

/** Одно свойство: путь в модели источника, подпись и значение. */
export interface PropertyRow {
	readonly key: string;
	readonly label: string;
	readonly kind: PropertyControlKind;
	readonly value?: string;
	readonly options?: readonly { readonly value: string; readonly label: string }[];
	/** Свойство только для чтения: источник его не записывает. */
	readonly readonly?: boolean;
	/** Пояснение к свойству: показывается внизу панели у выделенной строки. */
	readonly hint?: string;
}

/** Группа свойств: заголовок и строки в порядке источника. */
export interface PropertyGroup {
	readonly title: string;
	readonly rows: readonly PropertyRow[];
}

/** Состояние панели: что выделено и какие у него свойства. */
export interface PropertyPaletteState {
	/** Кто выделен: имя элемента, объекта, реквизита. */
	readonly title: string;
	/** Вид выделенного: тип элемента формы, вид объекта метаданных. */
	readonly subtitle?: string;
	readonly groups: readonly PropertyGroup[];
}

/** Подпись значения флажка: панель не показывает `true`/`false`. */
export function booleanText(value: boolean | undefined): string | undefined {
	return value === undefined ? undefined : value ? 'Да' : 'Нет';
}

/** Строка палитры без пустых значений: свойства, которых у выделенного нет, не показываем. */
export function propertyRow(
	key: string,
	label: string,
	value: string | undefined,
	kind: PropertyControlKind = 'text'
): PropertyRow | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	return { key, label, kind, value, readonly: true };
}

/** Группа из строк, среди которых могут быть пропущенные. */
export function propertyGroup(title: string, rows: readonly (PropertyRow | undefined)[]): PropertyGroup | undefined {
	const filled = rows.filter((row): row is PropertyRow => row !== undefined);
	return filled.length > 0 ? { title, rows: filled } : undefined;
}

export class PropertyPaletteViewProvider implements vscode.WebviewViewProvider {
	private _view: vscode.WebviewView | undefined;
	private _state: PropertyPaletteState | undefined;
	/** Кто последним показал свойства: чужой источник не гасит чужое выделение. */
	private _ownerId: string | undefined;

	constructor(private readonly _extensionUri: vscode.Uri) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		this._view = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'resources')],
		};
		view.webview.html = this.html();
		view.webview.onDidReceiveMessage((message: unknown) => {
			if (typeof message === 'object' && message !== null && (message as { type?: string }).type === 'ready') {
				this.push();
			}
		});
		view.onDidDispose(() => {
			this._view = undefined;
		});
		this.push();
	}

	/**
	 * Показывает свойства выделенного.
	 *
	 * @param ownerId Источник выделения: панель гаснет только по его же команде.
	 * @param state Что показать.
	 */
	show(ownerId: string, state: PropertyPaletteState): void {
		this._ownerId = ownerId;
		this._state = state;
		this.push();
		this.syncHeader();
	}

	/** Убирает свойства, если панель показывает выделение этого источника. */
	clear(ownerId: string): void {
		if (this._ownerId !== ownerId) {
			return;
		}
		this._ownerId = undefined;
		this._state = undefined;
		this.push();
		this.syncHeader();
	}

	/** В заголовке панели видно, чьи свойства показаны: имя выделенного рядом с названием плашки. */
	private syncHeader(): void {
		if (this._view) {
			this._view.description = this._state?.title;
		}
	}

	private push(): void {
		void this._view?.webview.postMessage({ type: 'state', state: this._state });
	}

	private html(): string {
		return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<style>
	body {
		margin: 0;
		padding: 0;
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		color: var(--vscode-foreground);
		display: flex;
		flex-direction: column;
		height: 100vh;
		box-sizing: border-box;
	}
	.toolbar {
		display: flex;
		gap: 4px;
		align-items: center;
		padding: 6px 8px;
	}
	.toolbar input {
		flex: 1;
		min-width: 0;
		padding: 3px 6px;
		border-radius: 2px;
		border: 1px solid var(--vscode-input-border, transparent);
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		font-family: inherit;
		font-size: inherit;
	}
	.toolbar input:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	.toolbar button {
		flex: none;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 3px;
		color: var(--vscode-foreground);
		font-family: inherit;
		font-size: 11px;
		padding: 3px 6px;
		cursor: pointer;
		opacity: 0.7;
	}
	.toolbar button.is-active {
		opacity: 1;
		border-color: var(--vscode-focusBorder);
	}
	.header {
		padding: 0 10px 6px 10px;
	}
	.title {
		font-weight: 600;
		word-break: break-word;
	}
	.subtitle {
		font-size: 11px;
		opacity: 0.7;
	}
	.list {
		flex: 1;
		min-height: 0;
		overflow: auto;
		border-top: 1px solid var(--vscode-panel-border);
		padding-bottom: 4px;
	}
	.group-title {
		padding: 6px 10px 2px 10px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		opacity: 0.7;
	}
	.row {
		display: flex;
		gap: 8px;
		padding: 2px 10px;
		align-items: baseline;
		cursor: default;
	}
	.row:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.row.is-selected {
		background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}
	.row-label {
		flex: 0 0 45%;
		opacity: 0.8;
		word-break: break-word;
	}
	.row-value {
		flex: 1;
		word-break: break-word;
	}
	.hint {
		border-top: 1px solid var(--vscode-panel-border);
		padding: 6px 10px;
		min-height: 32px;
		font-size: 11px;
		opacity: 0.8;
	}
	.hint-name {
		font-weight: 600;
	}
	.empty {
		padding: 8px 10px;
		opacity: 0.6;
	}
</style>
</head>
<body>
	<div class="toolbar">
		<input id="search" type="text" placeholder="Поиск свойства" />
		<button id="sortToggle" type="button" title="По алфавиту">А-Я</button>
	</div>
	<div id="header" class="header"></div>
	<div id="list" class="list"><div class="empty">Ничего не выделено</div></div>
	<div id="hint" class="hint"></div>
	<script>
		const vscode = acquireVsCodeApi();
		const header = document.getElementById('header');
		const list = document.getElementById('list');
		const hint = document.getElementById('hint');
		const search = document.getElementById('search');
		const sortToggle = document.getElementById('sortToggle');
		let current;
		let selectedKey;
		let alphabetical = false;

		function element(tag, className, text) {
			const el = document.createElement(tag);
			if (className) { el.className = className; }
			if (text) { el.textContent = text; }
			return el;
		}

		function matches(row, query) {
			if (!query) { return true; }
			return (row.label + ' ' + (row.value || '')).toLowerCase().includes(query);
		}

		function showHint(row) {
			hint.textContent = '';
			if (!row) { return; }
			hint.append(element('div', 'hint-name', row.label));
			hint.append(element('div', null, row.hint || row.key));
		}

		function renderRow(row) {
			const line = element('div', 'row' + (selectedKey === row.key ? ' is-selected' : ''));
			line.append(element('div', 'row-label', row.label));
			line.append(element('div', 'row-value', row.value || ''));
			line.addEventListener('click', () => {
				selectedKey = row.key;
				render();
				showHint(row);
			});
			return line;
		}

		function render() {
			list.textContent = '';
			header.textContent = '';
			if (!current || !current.groups || current.groups.length === 0) {
				list.append(element('div', 'empty', 'Ничего не выделено'));
				return;
			}
			header.append(element('div', 'title', current.title));
			if (current.subtitle) { header.append(element('div', 'subtitle', current.subtitle)); }

			const query = search.value.trim().toLowerCase();
			if (alphabetical) {
				const rows = current.groups
					.flatMap((group) => group.rows)
					.filter((row) => matches(row, query))
					.sort((a, b) => a.label.localeCompare(b.label, 'ru'));
				if (rows.length === 0) { list.append(element('div', 'empty', 'Ничего не найдено')); return; }
				rows.forEach((row) => list.append(renderRow(row)));
				return;
			}
			let shown = 0;
			for (const group of current.groups) {
				const rows = group.rows.filter((row) => matches(row, query));
				if (rows.length === 0) { continue; }
				shown += rows.length;
				list.append(element('div', 'group-title', group.title));
				rows.forEach((row) => list.append(renderRow(row)));
			}
			if (shown === 0) { list.append(element('div', 'empty', 'Ничего не найдено')); }
		}

		search.addEventListener('input', render);
		sortToggle.addEventListener('click', () => {
			alphabetical = !alphabetical;
			sortToggle.classList.toggle('is-active', alphabetical);
			render();
		});

		window.addEventListener('message', (event) => {
			if (event.data && event.data.type === 'state') {
				current = event.data.state;
				selectedKey = undefined;
				showHint(undefined);
				render();
			}
		});
		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
	}
}
