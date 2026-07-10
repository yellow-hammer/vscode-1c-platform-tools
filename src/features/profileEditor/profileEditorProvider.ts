/**
 * Редактор профиля запуска vanessa-runner (custom editor поверх JSON-файла).
 *
 * Открывает env*.json (2.x) и autumn-properties*.json (3.x) формой: параметры
 * сгруппированы по смыслу (подключение, платформа, ibcmd…), у каждого —
 * описание из vanessa-runner и контрол по типу. Добавление параметров и
 * командных секций — через нативный QuickPick VS Code с поиском по имени и
 * описанию. Файл остаётся источником истины: правки вносятся точечно
 * (jsonc-parser), форма перерисовывается при любом изменении документа.
 */

import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import { SettingsSchema } from '../../shared/envProfiles';
import { loadEditorSections, EditorSection, OptionGroup, CatalogOption } from './optionsCatalog';

export const PROFILE_EDITOR_VIEW_TYPE = '1c-platform-tools.profileEditor';

/** Заданный в файле параметр секции (для модели формы). */
interface ModelEntry {
	key: string;
	value: unknown;
	type: string;
	description: string;
	default?: unknown;
	enum?: unknown[];
	enumLabels?: Record<string, string>;
	itemsEnum?: unknown[];
	group: string;
	/** Ключ найден в каталоге опций (иначе — нестандартный параметр) */
	known: boolean;
}

interface ModelSection {
	id: string;
	label: string;
	isMain: boolean;
	entries: ModelEntry[];
	/** В каталоге есть что добавить в эту секцию */
	canAdd: boolean;
}

interface EditorModel {
	schema: SettingsSchema;
	schemaLabel: string;
	fileName: string;
	error?: string;
	groups: OptionGroup[];
	sections: ModelSection[];
	/** Есть командные секции, доступные к добавлению (3.x и секции 2.x) */
	canAddSection: boolean;
}

type WebviewMessage =
	| { type: 'set'; sectionId: string; key: string; value: unknown }
	| { type: 'remove'; sectionId: string; key: string }
	| { type: 'pickAdd'; sectionId: string }
	| { type: 'pickSection' }
	| { type: 'openJson' };

export class ProfileEditorProvider implements vscode.CustomTextEditorProvider {
	constructor(private readonly extensionPath: string) {}

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			PROFILE_EDITOR_VIEW_TYPE,
			new ProfileEditorProvider(context.extensionPath),
			{ webviewOptions: { retainContextWhenHidden: true } }
		);
	}

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel
	): Promise<void> {
		webviewPanel.webview.options = { enableScripts: true };
		webviewPanel.webview.html = buildHtml();

		const postModel = (): void => {
			void webviewPanel.webview.postMessage({ type: 'model', model: this.buildModel(document) });
		};

		const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
			if (event.document.uri.toString() === document.uri.toString()) {
				postModel();
			}
		});
		webviewPanel.onDidDispose(() => changeSubscription.dispose());

		webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
			switch (message.type) {
				case 'openJson':
					await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
					return;
				case 'set':
					await this.setValue(document, message.sectionId, message.key, message.value);
					return;
				case 'remove':
					await this.setValue(document, message.sectionId, message.key, undefined);
					return;
				case 'pickAdd':
					await this.pickAndAddOption(document, message.sectionId);
					return;
				case 'pickSection':
					await this.pickAndAddSection(document);
					return;
			}
		});

		postModel();
	}

	private sectionsFor(document: vscode.TextDocument): { sections: EditorSection[]; groups: OptionGroup[] } {
		return loadEditorSections(this.extensionPath, detectSchema(document));
	}

	private async setValue(
		document: vscode.TextDocument,
		sectionId: string,
		key: string,
		value: unknown
	): Promise<void> {
		const { sections } = this.sectionsFor(document);
		const section = sections.find((candidate) => candidate.id === sectionId);
		const jsonPath = [...(section?.jsonPath ?? [sectionId]), key];
		const edits = jsonc.modify(document.getText(), jsonPath, value, { formattingOptions: FORMATTING });
		await applyJsoncEdits(document, edits);
	}

	/** Нативный QuickPick: добавить параметр из каталога в секцию. */
	private async pickAndAddOption(document: vscode.TextDocument, sectionId: string): Promise<void> {
		const { sections, groups } = this.sectionsFor(document);
		const section = sections.find((candidate) => candidate.id === sectionId);
		if (!section) {
			return;
		}
		const existing = sectionValues(document, section);
		const addable = section.options.filter((option) => !(option.key in existing));
		if (addable.length === 0) {
			void vscode.window.showInformationMessage('Все параметры этой секции уже заданы.');
			return;
		}

		const groupLabel = new Map(groups.map((group) => [group.id, group.label]));
		const items: (vscode.QuickPickItem & { option?: CatalogOption })[] = [];
		let lastGroup: string | undefined;
		for (const option of addable) {
			if (section.isMain && option.group !== lastGroup) {
				lastGroup = option.group;
				items.push({ label: groupLabel.get(option.group) ?? option.group, kind: vscode.QuickPickItemKind.Separator });
			}
			items.push({
				label: option.key,
				description: option.description.length > 110 ? `${option.description.slice(0, 110)}…` : option.description,
				option,
			});
		}

		const picked = await vscode.window.showQuickPick(items, {
			title: `Добавить параметр — ${section.label}`,
			placeHolder: 'Поиск по имени или описанию…',
			matchOnDescription: true,
		});
		if (!picked?.option) {
			return;
		}
		await this.setValue(document, sectionId, picked.option.key, initialValue(picked.option));
	}

	/** Нативный QuickPick: добавить секцию команды и сразу первый параметр в неё. */
	private async pickAndAddSection(document: vscode.TextDocument): Promise<void> {
		const { sections } = this.sectionsFor(document);
		const commandSections = sections.filter((section) => !section.isMain && section.advertised);
		const picked = await vscode.window.showQuickPick(
			commandSections.map((section) => ({
				label: section.label.replace(/^Команда: /, ''),
				description: `${section.options.length} параметров`,
				section,
			})),
			{ title: 'Параметры для команды', placeHolder: 'Команда vanessa-runner…' }
		);
		if (!picked) {
			return;
		}
		await this.pickAndAddOption(document, picked.section.id);
	}

	/** Собирает модель формы: заданные значения документа + метаданные каталога. */
	private buildModel(document: vscode.TextDocument): EditorModel {
		const schema = detectSchema(document);
		const fileName = document.uri.path.split('/').pop() ?? document.uri.path;
		const base: EditorModel = {
			schema,
			schemaLabel: schema === 'v3' ? 'vanessa-runner 3 · autumn-properties' : 'vanessa-runner 2 · env.json',
			fileName,
			groups: [],
			sections: [],
			canAddSection: false,
		};

		let root: unknown;
		try {
			root = document.getText().trim() === '' ? {} : jsonc.parse(document.getText());
		} catch {
			root = undefined;
		}
		if (typeof root !== 'object' || root === null || Array.isArray(root)) {
			return { ...base, error: 'Файл не является JSON-объектом — исправьте его в текстовом редакторе.' };
		}

		const { sections, groups } = this.sectionsFor(document);
		base.groups = groups;
		base.canAddSection = sections.some((section) => !section.isMain);

		for (const section of sections) {
			const values = sectionValues(document, section, root);
			const catalogByKey = new Map(section.options.map((option) => [option.key, option]));

			const entries: ModelEntry[] = [];
			for (const [key, value] of Object.entries(values)) {
				// вложенные объекты (подсекции 3.x) редактируются в своих секциях
				if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
					continue;
				}
				const option = catalogByKey.get(key);
				entries.push({
					key,
					value,
					type: option?.type ?? typeOfValue(value),
					description: option?.description ?? 'Нестандартный параметр (нет в каталоге vanessa-runner)',
					default: option?.default,
					enum: option?.enum,
					enumLabels: option?.enumLabels,
					itemsEnum: option?.itemsEnum,
					group: option?.group ?? 'other',
					known: option !== undefined,
				});
			}
			entries.sort((a, b) => {
				const orderA = catalogByKey.get(a.key)?.order ?? Number.MAX_SAFE_INTEGER;
				const orderB = catalogByKey.get(b.key)?.order ?? Number.MAX_SAFE_INTEGER;
				return orderA - orderB || a.key.localeCompare(b.key);
			});

			const canAdd = section.options.some((option) => !(option.key in values));
			// командные секции показываем только когда в них что-то задано;
			// добавить новую можно через «Параметры команды…»
			if (!section.isMain && entries.length === 0) {
				continue;
			}
			base.sections.push({ id: section.id, label: section.label, isMain: section.isMain, entries, canAdd });
		}
		return base;
	}
}

const FORMATTING: jsonc.FormattingOptions = { insertSpaces: false, tabSize: 4, eol: '\n' };

/** Начальное значение добавляемого параметра: default каталога или нейтральное по типу. */
function initialValue(option: CatalogOption): unknown {
	if (option.default !== undefined) {
		return option.default;
	}
	switch (option.type) {
		case 'boolean':
			return true;
		case 'array':
			return [];
		case 'number':
		case 'integer':
			return 0;
		default:
			return option.enum?.length ? String(option.enum[0]) : '';
	}
}

/** Значения секции из документа (плоский объект секции). */
function sectionValues(
	document: vscode.TextDocument,
	section: EditorSection,
	parsedRoot?: unknown
): Record<string, unknown> {
	const root = parsedRoot ?? safeParse(document);
	const value = valueAtPath(root, section.jsonPath);
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function safeParse(document: vscode.TextDocument): unknown {
	try {
		return document.getText().trim() === '' ? {} : jsonc.parse(document.getText());
	} catch {
		return {};
	}
}

/** Схема файла: по корневому ключу `vrunner`, затем по имени файла. */
function detectSchema(document: vscode.TextDocument): SettingsSchema {
	const root = safeParse(document);
	if (typeof root === 'object' && root !== null && 'vrunner' in root) {
		return 'v3';
	}
	const fileName = document.uri.path.split('/').pop() ?? '';
	return fileName.startsWith('autumn-properties') ? 'v3' : 'v2';
}

function valueAtPath(root: unknown, jsonPath: string[]): unknown {
	let current: unknown = root;
	for (const segment of jsonPath) {
		if (typeof current !== 'object' || current === null) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function typeOfValue(value: unknown): string {
	if (typeof value === 'boolean') {
		return 'boolean';
	}
	if (typeof value === 'number') {
		return 'number';
	}
	if (Array.isArray(value)) {
		return 'array';
	}
	return 'string';
}

async function applyJsoncEdits(document: vscode.TextDocument, edits: jsonc.Edit[]): Promise<void> {
	const workspaceEdit = new vscode.WorkspaceEdit();
	for (const edit of edits) {
		const start = document.positionAt(edit.offset);
		const end = document.positionAt(edit.offset + edit.length);
		workspaceEdit.replace(document.uri, new vscode.Range(start, end), edit.content);
	}
	await vscode.workspace.applyEdit(workspaceEdit);
	await document.save();
}

/** HTML формы: рендер модели в инлайн-скрипте, правки уходят в extension. */
function buildHtml(): string {
	const nonce = Math.random().toString(36).slice(2);
	return /* html */ `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; }
	.page { max-width: 760px; margin: 0 auto; padding: 0 20px 40px; }
	header { position: sticky; top: 0; background: var(--vscode-editor-background); padding: 14px 0 10px; z-index: 1; border-bottom: 1px solid var(--vscode-widget-border, #3333); }
	h1 { font-size: 1.2em; margin: 0; font-weight: 600; }
	.subtitle { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 2px; }
	.toolbar { margin-top: 10px; display: flex; gap: 8px; }
	.toolbar input { flex: 1; }
	input[type=text], select, textarea {
		background: var(--vscode-input-background); color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 4px 8px;
		font-family: inherit; font-size: inherit; box-sizing: border-box;
	}
	input[type=text]:focus, select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
	button {
		background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
		border: none; border-radius: 2px; padding: 4px 12px; cursor: pointer; white-space: nowrap;
	}
	button:hover { background: var(--vscode-button-secondaryHoverBackground); }
	button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
	button.primary:hover { background: var(--vscode-button-hoverBackground); }

	h2 { font-size: 1em; font-weight: 600; margin: 26px 0 4px; }
	h2 .count { color: var(--vscode-descriptionForeground); font-weight: 400; }
	.group-title { font-size: 0.8em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); margin: 18px 0 2px; }

	.row { padding: 10px 0 8px; border-bottom: 1px solid var(--vscode-widget-border, #2a2a2a44); }
	.row-top { display: flex; gap: 12px; align-items: center; }
	.key { font-family: var(--vscode-editor-font-family); font-size: 0.95em; min-width: 200px; flex-shrink: 0; }
	.key .badge { font-family: var(--vscode-font-family); font-size: 0.75em; color: var(--vscode-descriptionForeground); border: 1px solid var(--vscode-widget-border, #5555); border-radius: 8px; padding: 0 6px; margin-left: 6px; }
	.control { flex: 1; min-width: 0; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
	.control input[type=text], .control select, .control textarea { width: 100%; }
	.control label.radio { display: inline-flex; gap: 5px; align-items: center; cursor: pointer; white-space: nowrap; }
	.remove { background: none; color: var(--vscode-descriptionForeground); padding: 0 4px; font-size: 1.05em; flex-shrink: 0; }
	.remove:hover { color: var(--vscode-errorForeground); background: none; }
	.desc { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 4px; line-height: 1.45; overflow-wrap: break-word; }

	details.other, details.command { margin-top: 18px; }
	details summary { cursor: pointer; font-weight: 600; padding: 6px 0; user-select: none; }
	details summary .count { color: var(--vscode-descriptionForeground); font-weight: 400; }
	.section-add { margin: 10px 0 0; }
	.error { color: var(--vscode-errorForeground); padding: 24px 0; }
	.empty { color: var(--vscode-descriptionForeground); padding: 18px 0; }
</style>
</head>
<body>
<div class="page">
<header>
	<h1 id="title"></h1>
	<div class="subtitle" id="subtitle"></div>
	<div class="toolbar">
		<input type="text" id="filter" placeholder="Поиск параметра (имя или описание)…">
		<button class="primary" id="addMain">＋ Параметр</button>
		<button id="addSection" title="Задать параметры для конкретной команды vanessa-runner">＋ Команда…</button>
		<button id="openJson" title="Открыть файл как обычный JSON">JSON</button>
	</div>
</header>
<div id="content"></div>
</div>
<script nonce="${nonce}">
const vscodeApi = acquireVsCodeApi();
let model;

window.addEventListener('message', (event) => {
	if (event.data.type === 'model') { model = event.data.model; render(); }
});
document.getElementById('openJson').addEventListener('click', () => post({ type: 'openJson' }));
document.getElementById('addSection').addEventListener('click', () => post({ type: 'pickSection' }));
document.getElementById('addMain').addEventListener('click', () => {
	const main = model && model.sections.find((section) => section.isMain);
	post({ type: 'pickAdd', sectionId: main ? main.id : 'default' });
});
document.getElementById('filter').addEventListener('input', render);

function post(message) { vscodeApi.postMessage(message); }

function matches(filter, entry) {
	if (!filter) { return true; }
	const haystack = (entry.key + ' ' + entry.description).toLowerCase();
	return filter.toLowerCase().split(/\\s+/).every((part) => haystack.includes(part));
}

function control(sectionId, entry) {
	const wrap = document.createElement('div');
	wrap.className = 'control';
	const send = (value) => post({ type: 'set', sectionId, key: entry.key, value });

	if (entry.type === 'boolean') {
		const box = document.createElement('input');
		box.type = 'checkbox';
		box.checked = entry.value === true;
		box.addEventListener('change', () => send(box.checked));
		wrap.appendChild(box);
	} else if (entry.enum && entry.enum.length && entry.enum.length <= 4) {
		for (const raw of entry.enum) {
			const value = String(raw);
			const label = document.createElement('label');
			label.className = 'radio';
			const radio = document.createElement('input');
			radio.type = 'radio';
			radio.name = sectionId + '/' + entry.key;
			radio.checked = String(entry.value) === value;
			radio.addEventListener('change', () => send(typeof raw === 'number' ? raw : value));
			label.appendChild(radio);
			label.append((entry.enumLabels && entry.enumLabels[value]) ? entry.enumLabels[value] + ' (' + value + ')' : value);
			wrap.appendChild(label);
		}
	} else if (entry.enum && entry.enum.length) {
		const select = document.createElement('select');
		for (const raw of entry.enum) {
			const value = String(raw);
			const optionEl = document.createElement('option');
			optionEl.value = value;
			optionEl.textContent = (entry.enumLabels && entry.enumLabels[value]) ? entry.enumLabels[value] + ' (' + value + ')' : value;
			optionEl.selected = String(entry.value) === value;
			select.appendChild(optionEl);
		}
		select.addEventListener('change', () => send(select.value));
		wrap.appendChild(select);
	} else if (entry.type === 'array') {
		const area = document.createElement('textarea');
		area.rows = Math.min(6, Math.max(2, (Array.isArray(entry.value) ? entry.value.length : 1) + 1));
		area.value = Array.isArray(entry.value) ? entry.value.join('\\n') : String(entry.value ?? '');
		area.placeholder = 'по одному значению на строку' + (entry.itemsEnum ? ': ' + entry.itemsEnum.join(', ') : '');
		area.addEventListener('change', () => send(area.value.split('\\n').map((line) => line.trim()).filter(Boolean)));
		wrap.appendChild(area);
	} else {
		const input = document.createElement('input');
		input.type = 'text';
		input.value = entry.value === undefined || entry.value === null ? '' : String(entry.value);
		if (entry.default !== undefined && entry.default !== '') {
			input.placeholder = 'по умолчанию: ' + entry.default;
		}
		input.addEventListener('change', () => send(entry.type === 'number' || entry.type === 'integer' ? Number(input.value) : input.value));
		wrap.appendChild(input);
	}
	return wrap;
}

function renderRow(sectionId, entry) {
	const row = document.createElement('div');
	row.className = 'row';
	const top = document.createElement('div');
	top.className = 'row-top';
	const key = document.createElement('div');
	key.className = 'key';
	key.textContent = entry.key;
	if (!entry.known) {
		const badge = document.createElement('span');
		badge.className = 'badge';
		badge.textContent = 'нестандартный';
		key.appendChild(badge);
	}
	top.appendChild(key);
	top.appendChild(control(sectionId, entry));
	const remove = document.createElement('button');
	remove.className = 'remove';
	remove.textContent = '✕';
	remove.title = 'Удалить параметр из файла';
	remove.addEventListener('click', () => post({ type: 'remove', sectionId, key: entry.key }));
	top.appendChild(remove);
	row.appendChild(top);
	const desc = document.createElement('div');
	desc.className = 'desc';
	desc.textContent = entry.description;
	row.appendChild(desc);
	return row;
}

function addButton(sectionId, label) {
	const holder = document.createElement('div');
	holder.className = 'section-add';
	const button = document.createElement('button');
	button.textContent = label;
	button.addEventListener('click', () => post({ type: 'pickAdd', sectionId }));
	holder.appendChild(button);
	return holder;
}

function render() {
	const content = document.getElementById('content');
	content.textContent = '';
	if (!model) { return; }
	document.getElementById('title').textContent = model.fileName;
	document.getElementById('subtitle').textContent = model.schemaLabel;
	document.getElementById('addSection').style.display = model.canAddSection ? '' : 'none';
	if (model.error) {
		const error = document.createElement('div');
		error.className = 'error';
		error.textContent = model.error;
		content.appendChild(error);
		return;
	}
	const filter = document.getElementById('filter').value.trim();
	const groupLabel = Object.fromEntries(model.groups.map((group) => [group.id, group.label]));

	for (const section of model.sections) {
		const visible = section.entries.filter((entry) => matches(filter, entry));
		if (filter && visible.length === 0) { continue; }

		if (section.isMain) {
			// главная секция: параметры по смысловым группам, «Прочее» — свёрнуто
			const order = model.groups.map((group) => group.id);
			const byGroup = new Map();
			for (const entry of visible) {
				const id = order.includes(entry.group) ? entry.group : 'other';
				if (!byGroup.has(id)) { byGroup.set(id, []); }
				byGroup.get(id).push(entry);
			}
			if (visible.length === 0 && !filter) {
				const empty = document.createElement('div');
				empty.className = 'empty';
				empty.textContent = 'Параметры ещё не заданы — нажмите «＋ Параметр».';
				content.appendChild(empty);
			}
			for (const groupId of order) {
				const entries = byGroup.get(groupId);
				if (!entries || entries.length === 0) { continue; }
				if (groupId === 'other' && !filter) {
					const details = document.createElement('details');
					details.className = 'other';
					details.open = false;
					const summary = document.createElement('summary');
					summary.innerHTML = 'Прочее <span class="count">· ' + entries.length + '</span>';
					details.appendChild(summary);
					for (const entry of entries) { details.appendChild(renderRow(section.id, entry)); }
					content.appendChild(details);
				} else {
					const title = document.createElement('div');
					title.className = 'group-title';
					title.textContent = groupLabel[groupId] || groupId;
					content.appendChild(title);
					for (const entry of entries) { content.appendChild(renderRow(section.id, entry)); }
				}
			}
		} else {
			const details = document.createElement('details');
			details.className = 'command';
			details.open = Boolean(filter) || true;
			const summary = document.createElement('summary');
			summary.innerHTML = section.label + ' <span class="count">· ' + section.entries.length + '</span>';
			details.appendChild(summary);
			for (const entry of visible) { details.appendChild(renderRow(section.id, entry)); }
			if (section.canAdd && !filter) {
				details.appendChild(addButton(section.id, '＋ Параметр команды'));
			}
			details.appendChild(document.createElement('div'));
			content.appendChild(details);
		}
	}
}
</script>
</body>
</html>`;
}
