/**
 * Общий каркас редакторов служебных файлов (пайплайны, хуки).
 *
 * Один источник оформления и поведения: колонка со списком сущностей слева,
 * панель действий сверху, панель сохранения снизу. Редакторы отличаются только
 * содержимым центра, поэтому подписи кнопок, крестик удаления в строке списка и
 * работа с несохранёнными правками у них одинаковые.
 */

/** Подписи действий: одни и те же во всех редакторах */
export const CHROME_LABELS = {
	add: '＋',
	remove: 'Удалить',
	json: 'JSON',
	save: 'Сохранить',
	cancel: 'Отменить',
	dirty: 'Есть несохранённые изменения',
	saved: 'Сохранено',
} as const;

/**
 * Общий CSS редакторов: переменные, кнопки, список, панели.
 *
 * @returns Текст стилей для вставки в тег style
 */
export function chromeStyles(): string {
	return /* css */ `
	:root {
		--line: var(--vscode-widget-border, #454545);
		--ok: var(--vscode-charts-green, #89d185);
		--fail: var(--vscode-charts-red, #f14c4c);
	}
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; height: 100vh; overflow: hidden; }
	.chrome { display: flex; flex-direction: column; height: 100vh; }
	.chrome-body { flex: 1; min-height: 0; display: grid; }
	.side { overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 2px; }
	.side.left { border-right: 1px solid var(--line); }
	.side.right { border-left: 1px solid var(--line); }

	h2 { font-size: 0.72em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
		color: var(--vscode-descriptionForeground); margin: 16px 0 6px; display: flex; align-items: center; gap: 6px; }
	h2:first-child { margin-top: 0; }
	h2 button { margin-left: auto; }

	input[type=text], input[type=number], input[type=password], textarea, select {
		background: var(--vscode-input-background); color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 5px 8px;
		font-family: inherit; font-size: inherit; box-sizing: border-box; width: 100%;
	}
	input:focus, textarea:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); }
	textarea { font-family: var(--vscode-editor-font-family); min-height: 52px; resize: vertical; }

	button {
		background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
		border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; white-space: nowrap; font-size: 0.9em;
	}
	button:hover { background: var(--vscode-button-secondaryHoverBackground); }
	button:disabled { opacity: 0.5; cursor: default; }
	button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
	button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
	button.round { width: 26px; height: 26px; padding: 0; border-radius: 50%; font-size: 1em; line-height: 1; }
	button.icon { background: none; color: var(--vscode-descriptionForeground); padding: 0 5px; }
	button.icon:hover { color: var(--vscode-foreground); background: none; }
	button.danger:hover:not(:disabled) { color: var(--fail); }

	.list-item { padding: 7px 9px; border-radius: 5px; cursor: pointer; display: flex; gap: 8px; align-items: center;
		border: 1px solid transparent; }
	.list-item:hover { background: var(--vscode-list-hoverBackground); }
	.list-item.active { background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground); border-color: var(--vscode-focusBorder); }
	.list-item .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
		background: var(--vscode-descriptionForeground); }
	.list-item .text { min-width: 0; }
	.list-item .sub { font-size: 0.78em; opacity: 0.75; margin-top: 2px; overflow-wrap: anywhere; }
	.list-item .remove { visibility: hidden; background: none; color: var(--vscode-descriptionForeground);
		margin-left: auto; padding: 0 2px; font-size: 0.95em; }
	.list-item:hover .remove, .list-item.active .remove { visibility: visible; }
	.list-item .remove:hover { color: var(--fail); background: none; }

	.toolbar { display: flex; gap: 6px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--line); }
	.toolbar .title { font-weight: 600; margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	.save-bar { display: flex; gap: 8px; align-items: center; justify-content: flex-end;
		padding: 7px 12px; border-top: 1px solid var(--line); background: var(--vscode-editorWidget-background, #252526); }
	.save-bar.hidden { display: none; }
	.save-bar .status { margin-right: auto; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
	.save-bar .status.error { color: var(--fail); }
	.save-bar .status.ok { color: var(--ok); }

	.field { margin-bottom: 10px; }
	.field label { display: block; font-size: 0.76em; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
	.check { display: flex; gap: 7px; align-items: center; cursor: pointer; font-size: 0.9em; margin-bottom: 7px; }
	.check input { width: auto; }
	.empty { color: var(--vscode-descriptionForeground); font-size: 0.9em; padding: 8px 0; }
	.error { color: var(--fail); padding: 8px 0; }
	.hint { color: var(--vscode-descriptionForeground); font-size: 0.8em; margin-top: 10px; line-height: 1.5; }
`;
}

/**
 * Общий JS редакторов: поля, список, панель сохранения.
 *
 * Скрипт ожидает от страницы функции `renderAll()` и переменные `draft`,
 * `baseline`: что именно редактируется, знает конкретный редактор.
 *
 * @returns Текст скрипта для вставки в тег script
 */
export function chromeScript(): string {
	return /* js */ `
const vscodeApi = acquireVsCodeApi();
let saveStatus = '';
let saveStatusKind = '';
/** В поле набирают текст: значение ещё не ушло в модель */
let pendingEdit = false;

function post(message) { vscodeApi.postMessage(message); }

/** Правки живут в форме, пока их не сохранили: файл меняется только по кнопке */
function isDirty() { return JSON.stringify(draft) !== JSON.stringify(baseline); }

function commit() {
	pendingEdit = false;
	saveStatus = '';
	saveStatusKind = '';
	renderAll();
}

function save() {
	// Значение поля попадает в модель по потере фокуса: перед записью применяем набранное
	if (pendingEdit && document.activeElement && document.activeElement.blur) {
		document.activeElement.blur();
	}
	pendingEdit = false;
	post({ type: 'save', data: draft });
}

function cancelChanges() {
	pendingEdit = false;
	draft = JSON.parse(JSON.stringify(baseline));
	saveStatus = '';
	saveStatusKind = '';
	renderAll();
}

function renderSaveBar() {
	const bar = document.getElementById('saveBar');
	const status = document.getElementById('saveStatus');
	const saveButton = document.getElementById('saveButton');
	const cancelButton = document.getElementById('cancelButton');
	const dirty = isDirty() || pendingEdit;
	bar.classList.toggle('hidden', !dirty && saveStatus === '');
	status.textContent = saveStatus || (dirty ? ${JSON.stringify(CHROME_LABELS.dirty)} : '');
	status.className = 'status' + (saveStatusKind ? ' ' + saveStatusKind : '');
	saveButton.disabled = !dirty;
	cancelButton.disabled = !dirty;
}

function listItem(options) {
	const item = document.createElement('div');
	item.className = 'list-item' + (options.active ? ' active' : '');
	const dot = document.createElement('span');
	dot.className = 'dot';
	if (options.color) { dot.style.background = options.color; }
	const text = document.createElement('div');
	text.className = 'text';
	const name = document.createElement('div');
	name.textContent = options.title;
	text.appendChild(name);
	if (options.subtitle) {
		const sub = document.createElement('div');
		sub.className = 'sub';
		sub.textContent = options.subtitle;
		text.appendChild(sub);
	}
	item.appendChild(dot);
	item.appendChild(text);
	if (options.onRemove) {
		const remove = document.createElement('button');
		remove.className = 'remove';
		remove.textContent = '✕';
		remove.title = ${JSON.stringify(CHROME_LABELS.remove)};
		remove.addEventListener('click', (event) => { event.stopPropagation(); options.onRemove(); });
		item.appendChild(remove);
	}
	item.addEventListener('click', options.onSelect);
	return item;
}

function field(labelText, value, onChange, kind) {
	const wrap = document.createElement('div');
	wrap.className = 'field';
	const label = document.createElement('label');
	label.textContent = labelText;
	const input = document.createElement(kind === 'textarea' ? 'textarea' : 'input');
	if (kind !== 'textarea') { input.type = kind === 'number' ? 'number' : 'text'; }
	input.value = value === undefined || value === null ? '' : value;
	// По ходу набора показываем панель сохранения, но форму не перерисовываем:
	// иначе поле теряло бы фокус на каждом символе. Значение уходит в модель,
	// когда поле теряет фокус или когда нажали «Сохранить»
	input.addEventListener('input', () => {
		pendingEdit = true;
		renderSaveBar();
	});
	input.addEventListener('change', () => {
		pendingEdit = false;
		onChange(input.value);
	});
	wrap.appendChild(label);
	wrap.appendChild(input);
	return wrap;
}

/**
 * Поле с «живым» вводом: значение уходит в модель на каждый ввод, без blur.
 *
 * Перерисовка формы по change — то есть по потере фокуса — пересоздаёт DOM:
 * Tab не доходит до следующего поля, а клик из отредактированного поля
 * приходит по уничтоженному элементу и теряется. Поэтому onChange зовётся на
 * каждый ввод, а перерисовывать в ответ можно только части формы без фокуса.
 */
function liveField(labelText, value, onChange, kind) {
	const wrap = document.createElement('div');
	wrap.className = 'field';
	const label = document.createElement('label');
	label.textContent = labelText;
	const input = document.createElement(kind === 'textarea' ? 'textarea' : 'input');
	if (kind !== 'textarea') {
		input.type = kind === 'number' ? 'number' : (kind === 'password' ? 'password' : 'text');
	}
	input.value = value === undefined || value === null ? '' : value;
	input.addEventListener('input', () => onChange(input.value));
	wrap.appendChild(label);
	wrap.appendChild(input);
	return wrap;
}

function checkbox(labelText, checked, onChange) {
	const label = document.createElement('label');
	label.className = 'check';
	const box = document.createElement('input');
	box.type = 'checkbox';
	box.checked = checked;
	box.addEventListener('change', () => onChange(box.checked));
	label.appendChild(box);
	label.append(labelText);
	return label;
}

function hint(text) {
	const element = document.createElement('div');
	element.className = 'hint';
	element.textContent = text;
	return element;
}

function empty(text) {
	const element = document.createElement('div');
	element.className = 'empty';
	element.textContent = text;
	return element;
}

window.addEventListener('message', (event) => {
	// Ctrl+S приходит командой из расширения: внутри webview его перехватывает VS Code
	if (event.data && event.data.type === 'saveRequested' && (isDirty() || pendingEdit)) {
		save();
	}
});

window.addEventListener('error', (event) => {
	post({ type: 'error', message: event.message + ' (' + event.lineno + ':' + event.colno + ')' });
});

document.getElementById('saveButton').addEventListener('click', save);
document.getElementById('cancelButton').addEventListener('click', cancelChanges);
// Кнопка JSON есть только у редакторов служебных файлов: форме без файла её открывать нечем
document.getElementById('jsonButton')?.addEventListener('click', () => post({ type: 'openJson' }));
window.addEventListener('keydown', (event) => {
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
		event.preventDefault();
		if (isDirty() || pendingEdit) { save(); }
	}
});
`;
}

/**
 * Разметка панели сохранения: одинаковая во всех редакторах.
 *
 * @returns HTML нижней панели
 */
export function saveBarHtml(): string {
	return /* html */ `<div class="save-bar hidden" id="saveBar">
	<span class="status" id="saveStatus"></span>
	<button id="cancelButton">${CHROME_LABELS.cancel}</button>
	<button class="primary" id="saveButton">${CHROME_LABELS.save}</button>
</div>`;
}
