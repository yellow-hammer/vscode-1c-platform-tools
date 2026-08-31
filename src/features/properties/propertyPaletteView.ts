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

export const PROPERTY_PALETTE_VIEW_ID = '1c-platform-tools-properties-palette';

/** Вид редактора значения. */
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
	/** От значения зависит состав строк: выбор перестраивает панель, не записывая файл. */
	readonly rebuilds?: boolean;
	/** Пояснение к свойству: показывается внизу панели у выделенной строки. */
	readonly hint?: string;
}

/** Изменённые значения: ключ строки -> новое значение. */
export type PropertyEdits = Readonly<Record<string, string>>;

/**
 * Записывает изменения источника.
 *
 * @returns Свойства после записи; источник перечитывает их сам.
 * @throws Текст ошибки показывается в панели.
 */
export type PropertyApplyHandler = (edits: PropertyEdits) => Promise<PropertyPaletteState | undefined>;

/**
 * Пересобирает свойства с наложенной правкой, не записывая файл.
 *
 * Нужен свойствам, от которых зависит состав строк: выбрали тип - под ним появились
 * его квалификаторы, как в конфигураторе.
 *
 * @returns Свойства с учётом правки или undefined, если пересобрать нечем
 */
export type PropertyPreviewHandler = (edits: PropertyEdits) => Promise<PropertyPaletteState | undefined>;

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
	/** Что показать вместо списка, когда свойств нет: иначе панель скажет «ничего не выделено». */
	readonly emptyText?: string;
}

export class PropertyPaletteViewProvider implements vscode.WebviewViewProvider {
	private _view: vscode.WebviewView | undefined;
	private _state: PropertyPaletteState | undefined;
	/** Кто последним показал свойства: чужой источник не гасит чужое выделение. */
	private _ownerId: string | undefined;
	private _onApply: PropertyApplyHandler | undefined;
	private _onPreview: PropertyPreviewHandler | undefined;
	private readonly _onDidChangeVisibility = new vscode.EventEmitter<void>();

	/** Панель открыта: пока она закрыта, источникам незачем читать свойства. */
	readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

	constructor(private readonly _extensionUri: vscode.Uri) {}

	get visible(): boolean {
		return this._view?.visible === true;
	}

	/** Кто сейчас показан: источник не должен перебивать чужое выделение без действия пользователя. */
	get owner(): string | undefined {
		return this._ownerId;
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this._view = view;
		view.onDidChangeVisibility(() => this._onDidChangeVisibility.fire());
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'resources')],
		};
		view.webview.html = this.html();
		view.webview.onDidReceiveMessage((message: unknown) => {
			const msg = message as { type?: string; edits?: PropertyEdits } | null;
			if (msg?.type === 'ready') {
				this.push();
			} else if (msg?.type === 'apply') {
				void this.apply(msg.edits ?? {});
			} else if (msg?.type === 'preview') {
				void this.preview(msg.edits ?? {});
			}
		});
		view.onDidDispose(() => {
			this._view = undefined;
		});
		this.push();
		this._onDidChangeVisibility.fire();
	}

	/**
	 * Показывает свойства выделенного.
	 *
	 * @param ownerId Источник выделения: панель гаснет только по его же команде.
	 * @param state Что показать.
	 * @param onApply Запись изменений; без него свойства только для чтения.
	 */
	show(
		ownerId: string,
		state: PropertyPaletteState,
		onApply?: PropertyApplyHandler,
		onPreview?: PropertyPreviewHandler
	): void {
		this._ownerId = ownerId;
		this._state = state;
		this._onApply = onApply;
		this._onPreview = onPreview;
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
		this._onApply = undefined;
		this._onPreview = undefined;
		this.push();
		this.syncHeader();
	}

	/**
	 * Пересобирает свойства с черновиком правок: файл не меняется, меняется только показ.
	 */
	private async preview(edits: PropertyEdits): Promise<void> {
		const handler = this._onPreview;
		if (!handler) {
			return;
		}
		try {
			const state = await handler(edits);
			if (state) {
				this._state = state;
				void this._view?.webview.postMessage({ type: 'rebuilt', state, edits });
			}
		} catch {
			// Пересборка показа не критична: панель останется с прежним составом строк
		}
	}

	/** Записывает изменения и показывает свойства заново: в файле лежит уже другое. */
	private async apply(edits: PropertyEdits): Promise<void> {
		const handler = this._onApply;
		if (!handler) {
			void this._view?.webview.postMessage({ type: 'applied', ok: false, error: 'Свойства только для чтения' });
			return;
		}
		try {
			const state = await handler(edits);
			if (state) {
				this._state = state;
			}
			void this._view?.webview.postMessage({ type: 'applied', ok: true, state: this._state });
			this.syncHeader();
		} catch (e) {
			void this._view?.webview.postMessage({
				type: 'applied',
				ok: false,
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}

	/** В заголовке панели видно, чьи свойства показаны: имя выделенного рядом с названием плашки. */
	private syncHeader(): void {
		if (this._view) {
			this._view.description = this._state?.title;
		}
	}

	private push(): void {
		void this._view?.webview.postMessage({
			type: 'state',
			state: this._state,
			editable: this._onApply !== undefined,
		});
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
		min-width: 0;
		word-break: break-word;
	}
	.row.is-changed .row-label {
		opacity: 1;
		font-weight: 600;
	}
	.row-value input[type="text"],
	.row-value select {
		width: 100%;
		box-sizing: border-box;
		padding: 1px 3px;
		border: 1px solid transparent;
		border-radius: 2px;
		background: transparent;
		color: inherit;
		font-family: inherit;
		font-size: inherit;
	}
	.row-value input[type="text"]:hover,
	.row-value select:hover {
		border-color: var(--vscode-input-border, var(--vscode-panel-border));
	}
	.row-value input[type="text"]:focus,
	.row-value select:focus {
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	.row-value input[type="checkbox"] {
		margin: 0;
		vertical-align: middle;
	}
	.save-bar {
		display: none;
		gap: 8px;
		align-items: center;
		padding: 6px 10px;
		border-top: 1px solid var(--vscode-panel-border);
	}
	.save-bar.is-shown {
		display: flex;
	}
	.save-status {
		flex: 1;
		min-width: 0;
		font-size: 11px;
		opacity: 0.8;
		word-break: break-word;
	}
	.save-status.is-error {
		opacity: 1;
		color: var(--vscode-errorForeground);
	}
	.save-bar button {
		flex: none;
		padding: 3px 10px;
		border: none;
		border-radius: 2px;
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		font-family: inherit;
		font-size: inherit;
		cursor: pointer;
	}
	.save-bar button:disabled {
		opacity: 0.5;
		cursor: default;
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
	<div id="saveBar" class="save-bar">
		<span id="saveStatus" class="save-status"></span>
		<button id="saveBtn" type="button" disabled>Записать</button>
	</div>
	<script>
		const vscode = acquireVsCodeApi();
		const header = document.getElementById('header');
		const list = document.getElementById('list');
		const hint = document.getElementById('hint');
		const search = document.getElementById('search');
		const sortToggle = document.getElementById('sortToggle');
		const saveBar = document.getElementById('saveBar');
		const saveStatus = document.getElementById('saveStatus');
		const saveBtn = document.getElementById('saveBtn');
		let current;
		let editable = false;
		let selectedKey;
		let alphabetical = false;
		// Правки копятся до кнопки: в конфигураторе свойство тоже применяется не по каждому нажатию.
		const draft = new Map();

		function element(tag, className, text) {
			const el = document.createElement(tag);
			if (className) { el.className = className; }
			if (text) { el.textContent = text; }
			return el;
		}

		/** Значение как его читают: булево словом, константа перечисления - подписью. */
		function displayText(row) {
			const value = row.value || '';
			if (row.kind === 'boolean') {
				return value === 'true' ? 'Да' : value === 'false' ? 'Нет' : value;
			}
			if (row.options) {
				const known = row.options.find((option) => option.value === value);
				return known ? known.label : value;
			}
			return value;
		}

		function matches(row, query) {
			if (!query) { return true; }
			return (row.label + ' ' + displayText(row)).toLowerCase().includes(query);
		}

		function showHint(row) {
			hint.textContent = '';
			if (!row) { return; }
			hint.append(element('div', 'hint-name', row.label));
			hint.append(element('div', null, row.hint || row.key));
		}

		function draftValue(row) {
			return draft.has(row.key) ? draft.get(row.key) : (row.value || '');
		}

		/**
		 * Правка держится, только пока отличается от того, что показано: иначе строка снова обычная.
		 * Перерисовки нет намеренно - иначе редактор терял бы фокус на каждом изменении.
		 */
		function edit(row, line, value) {
			if (value === (row.value || '')) {
				draft.delete(row.key);
			} else {
				draft.set(row.key, value);
			}
			line.classList.toggle('is-changed', draft.has(row.key));
			syncSaveBar();
			if (row.rebuilds) {
				// Состав строк зависит от значения: просим пересобрать показ, файл не трогаем
				vscode.postMessage({ type: 'preview', edits: Object.fromEntries(draft) });
			}
		}

		function editor(row, line) {
			if (row.kind === 'boolean') {
				const box = element('input');
				box.type = 'checkbox';
				box.checked = draftValue(row) === 'true';
				box.addEventListener('change', () => edit(row, line, box.checked ? 'true' : 'false'));
				return box;
			}
			if (row.kind === 'select' && row.options && row.options.length > 0) {
				const box = element('select');
				const value = draftValue(row);
				let known = false;
				for (const option of row.options) {
					const node = element('option', null, option.label);
					node.value = option.value;
					if (option.value === value) { node.selected = true; known = true; }
					box.append(node);
				}
				// Значение из файла может быть не из словаря: показываем как есть, а не подменяем первым.
				if (!known) {
					const node = element('option', null, value || ' ');
					node.value = value;
					node.selected = true;
					box.prepend(node);
				}
				box.addEventListener('change', () => edit(row, line, box.value));
				return box;
			}
			const field = element('input');
			field.type = 'text';
			field.value = draftValue(row);
			field.addEventListener('change', () => edit(row, line, field.value));
			return field;
		}

		function renderRow(row) {
			const line = element('div', 'row'
				+ (selectedKey === row.key ? ' is-selected' : '')
				+ (draft.has(row.key) ? ' is-changed' : ''));
			line.append(element('div', 'row-label', row.label));
			const value = element('div', 'row-value');
			if (editable && !row.readonly) {
				value.append(editor(row, line));
			} else {
				value.textContent = displayText(row);
			}
			line.append(value);
			// Выделение переставляем классом: перерисовка вырвала бы фокус из редактора под курсором.
			line.addEventListener('click', () => {
				selectedKey = row.key;
				for (const other of list.querySelectorAll('.row.is-selected')) {
					other.classList.remove('is-selected');
				}
				line.classList.add('is-selected');
				showHint(row);
			});
			return line;
		}

		function syncSaveBar() {
			saveBar.classList.toggle('is-shown', editable);
			saveBtn.disabled = draft.size === 0;
			if (draft.size > 0) {
				saveStatus.classList.remove('is-error');
				saveStatus.textContent = 'Изменено свойств: ' + draft.size;
			}
		}

		function render() {
			list.textContent = '';
			header.textContent = '';
			if (!current) {
				list.append(element('div', 'empty', 'Ничего не выделено'));
				return;
			}
			header.append(element('div', 'title', current.title));
			if (current.subtitle) { header.append(element('div', 'subtitle', current.subtitle)); }
			if (!current.groups || current.groups.length === 0) {
				list.append(element('div', 'empty', current.emptyText || 'Свойств нет'));
				return;
			}

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

		saveBtn.addEventListener('click', () => {
			if (draft.size === 0) { return; }
			saveBtn.disabled = true;
			saveStatus.classList.remove('is-error');
			saveStatus.textContent = 'Записываем...';
			vscode.postMessage({ type: 'apply', edits: Object.fromEntries(draft) });
		});

		function reset(state, canEdit) {
			current = state;
			editable = canEdit;
			draft.clear();
			selectedKey = undefined;
			showHint(undefined);
			syncSaveBar();
			render();
		}

		window.addEventListener('message', (event) => {
			const message = event.data;
			if (!message) { return; }
			if (message.type === 'state') {
				reset(message.state, message.editable === true);
				saveStatus.textContent = '';
			} else if (message.type === 'rebuilt') {
				// Черновик держим: пересобрался только состав строк
				current = message.state;
				render();
				syncSaveBar();
			} else if (message.type === 'applied') {
				if (message.ok) {
					reset(message.state || current, editable);
					saveStatus.textContent = 'Записано';
				} else {
					saveBtn.disabled = draft.size === 0;
					saveStatus.classList.add('is-error');
					saveStatus.textContent = message.error || 'Не удалось записать';
				}
			}
		});
		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
	}
}
