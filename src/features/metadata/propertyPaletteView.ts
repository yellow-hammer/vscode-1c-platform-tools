/**
 * Панель «Свойства»: показывает свойства того, что выделено, откуда бы выделение ни пришло.
 *
 * Содержимое описывается данными, а не разметкой: источник отдаёт группы и строки
 * (`PropertyPaletteState`), панель их рисует. Так один и тот же механизм обслуживает элементы
 * формы, объекты метаданных и всё, что появится дальше.
 *
 * @module propertyPaletteView
 */

import * as vscode from 'vscode';

export const PROPERTY_PALETTE_VIEW_ID = '1c-platform-tools-metadata-properties';

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
	}

	/** Убирает свойства, если панель показывает выделение этого источника. */
	clear(ownerId: string): void {
		if (this._ownerId !== ownerId) {
			return;
		}
		this._ownerId = undefined;
		this._state = undefined;
		this.push();
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
		padding: 6px 0;
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		color: var(--vscode-foreground);
	}
	.header {
		padding: 0 10px 6px 10px;
		border-bottom: 1px solid var(--vscode-panel-border);
		margin-bottom: 6px;
	}
	.title {
		font-weight: 600;
		word-break: break-word;
	}
	.subtitle {
		font-size: 11px;
		opacity: 0.7;
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
	}
	.row:hover {
		background: var(--vscode-list-hoverBackground);
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
	.empty {
		padding: 8px 10px;
		opacity: 0.6;
	}
</style>
</head>
<body>
	<div id="root"><div class="empty">Ничего не выделено</div></div>
	<script>
		const vscode = acquireVsCodeApi();
		const root = document.getElementById('root');

		function element(tag, className, text) {
			const el = document.createElement(tag);
			if (className) { el.className = className; }
			if (text) { el.textContent = text; }
			return el;
		}

		function render(state) {
			root.textContent = '';
			if (!state || !state.groups || state.groups.length === 0) {
				root.append(element('div', 'empty', 'Ничего не выделено'));
				return;
			}
			const header = element('div', 'header');
			header.append(element('div', 'title', state.title));
			if (state.subtitle) { header.append(element('div', 'subtitle', state.subtitle)); }
			root.append(header);
			for (const group of state.groups) {
				root.append(element('div', 'group-title', group.title));
				for (const row of group.rows) {
					const line = element('div', 'row');
					line.append(element('div', 'row-label', row.label));
					line.append(element('div', 'row-value', row.value ?? ''));
					root.append(line);
				}
			}
		}

		window.addEventListener('message', (event) => {
			if (event.data && event.data.type === 'state') { render(event.data.state); }
		});
		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
	}
}
