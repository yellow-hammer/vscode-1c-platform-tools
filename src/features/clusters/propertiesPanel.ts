/**
 * Карточка свойств объекта кластера.
 *
 * Карточек в консоли две — у информационной базы и у самого кластера, — и ведут
 * они себя одинаково: читают объект, показывают разделы с полями, сохраняют
 * только изменённые значения. Поэтому панель здесь одна, а что показывать и
 * куда отправлять, ей сообщает описание объекта.
 */

import * as vscode from 'vscode';
import { CHROME_LABELS, chromeScript, chromeStyles, saveBarHtml } from '../editors/webviewChrome';
import type { PropertySection, PropertyValues } from './propertiesForm';

/** Что делает карточка: чем наполняется и куда сохраняет. */
export interface PropertiesDescriptor {
	/**
	 * Ключ объекта: у каждого своя вкладка.
	 *
	 * Повторное открытие того же объекта переиспользует вкладку, а разные
	 * объекты открываются рядом — свойства двух соединений сравнивают глазами.
	 */
	key: string;
	/** Заголовок вкладки. */
	title: string;
	/** Пояснение в шапке: подключение и адрес. */
	subtitle: string;
	/** Разделы с полями. */
	sections: PropertySection[];
	/** Читает значения объекта. */
	load: () => Promise<{ ok: true; values: PropertyValues } | { ok: false; message: string }>;
	/** Проверяет значения перед отправкой. */
	validate: (values: PropertyValues) => string[];
	/**
	 * Сохраняет правки.
	 *
	 * Получает прочитанные и набранные значения целиком: что из них изменилось и
	 * как перевести это в параметры rac, знает описание объекта.
	 */
	save: (
		before: PropertyValues,
		after: PropertyValues
	) => Promise<{ ok: true; changed: boolean } | { ok: false; message: string }>;
}

/**
 * Находит поля, которые платформа не применила.
 *
 * Сравниваются набранные значения и то, что сервер отдал после сохранения:
 * расхождение означает, что параметр не принят, хотя вызов прошёл без ошибки.
 *
 * @param sections - Разделы карточки
 * @param requested - Значения, отправленные на сервер
 * @param actual - Значения, прочитанные после сохранения
 * @returns Подписи непринятых полей
 */
export function unappliedFields(
	sections: PropertySection[],
	requested: PropertyValues,
	actual: PropertyValues
): string[] {
	const titles: string[] = [];
	for (const section of sections) {
		for (const field of section.fields) {
			if (field.kind === 'readonly') {
				continue;
			}
			const want = (requested[field.key] ?? '').trim();
			const got = (actual[field.key] ?? '').trim();
			if (want !== got) {
				titles.push(field.title);
			}
		}
	}
	return titles;
}

/** Сообщение из карточки. */
type PanelMessage =
	| { type: 'save'; data: PropertyValues }
	| { type: 'reload' }
	| { type: 'error'; message: string };

/** Открытая карточка: вкладка вместе с тем, что она показывает. */
interface OpenCard {
	panel: vscode.WebviewPanel;
	descriptor: PropertiesDescriptor;
	/** Значения, прочитанные с сервера: с ними сравниваются правки формы. */
	baseline: PropertyValues;
}

/**
 * Карточки свойств объектов кластера.
 *
 * Каждому объекту достаётся своя вкладка: свойства двух соединений или сеансов
 * администратор сравнивает рядом, и общая вкладка, перерисовывающая себя под
 * последний выбранный объект, такое сравнение сделала бы невозможным. Повторное
 * открытие того же объекта переиспользует его вкладку, а не плодит копии.
 */
export class PropertiesPanel {
	/** Открытые карточки по ключу объекта. */
	private readonly cards = new Map<string, OpenCard>();

	/**
	 * @param viewType - Тип вкладки для восстановления раскладки VS Code
	 */
	constructor(private readonly viewType: string) {}

	/**
	 * Открывает карточку объекта.
	 *
	 * @param descriptor - Что показывать и куда сохранять
	 */
	async open(descriptor: PropertiesDescriptor): Promise<void> {
		const existing = this.cards.get(descriptor.key);
		if (existing) {
			existing.descriptor = descriptor;
			existing.panel.title = descriptor.title;
			existing.panel.reveal(existing.panel.viewColumn);
			await this.load(descriptor.key);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			this.viewType,
			descriptor.title,
			vscode.ViewColumn.Active,
			{ enableScripts: true, retainContextWhenHidden: true }
		);
		panel.webview.html = buildHtml();
		panel.webview.onDidReceiveMessage((message: PanelMessage) =>
			this.handleMessage(descriptor.key, message)
		);
		panel.onDidDispose(() => {
			this.cards.delete(descriptor.key);
		});
		this.cards.set(descriptor.key, { panel, descriptor, baseline: {} });
		await this.load(descriptor.key);
	}

	dispose(): void {
		for (const card of this.cards.values()) {
			card.panel.dispose();
		}
		this.cards.clear();
	}

	/**
	 * Читает объект и отправляет значения в форму.
	 *
	 * @param key - Ключ открытой карточки
	 */
	private async load(key: string): Promise<void> {
		const card = this.cards.get(key);
		if (!card) {
			return;
		}
		const result = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: `Читаю: ${card.descriptor.title}` },
			() => card.descriptor.load()
		);
		if (!result.ok) {
			void card.panel.webview.postMessage({ type: 'failed', message: result.message });
			return;
		}
		card.baseline = result.values;
		void card.panel.webview.postMessage({
			type: 'model',
			sections: card.descriptor.sections,
			values: card.baseline,
			subtitle: card.descriptor.subtitle,
		});
	}

	/**
	 * Обрабатывает сообщение карточки.
	 *
	 * @param key - Ключ открытой карточки
	 * @param message - Сообщение
	 */
	private async handleMessage(key: string, message: PanelMessage): Promise<void> {
		const card = this.cards.get(key);
		if (!card) {
			return;
		}
		if (message.type === 'reload') {
			await this.load(key);
			return;
		}
		if (message.type === 'error') {
			void vscode.window.showErrorMessage(`${card.descriptor.title}: ${message.message}`);
			return;
		}

		const problems = card.descriptor.validate(message.data);
		if (problems.length > 0) {
			void card.panel.webview.postMessage({ type: 'saveFailed', message: problems.join('; ') });
			return;
		}

		const requested = message.data;
		const result = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: `Сохраняю: ${card.descriptor.title}` },
			() => card.descriptor.save(card.baseline, requested)
		);
		if (!result.ok) {
			void card.panel.webview.postMessage({ type: 'saveFailed', message: result.message });
			return;
		}
		if (result.changed) {
			await this.load(key);
		}
		// Часть параметров платформа принимает молча, но не применяет: вызов
		// завершается успешно, а значение остаётся прежним. Молчать об этом нельзя —
		// иначе «Сохранено» врёт, и поле необъяснимо возвращается к старому виду.
		const ignored = unappliedFields(card.descriptor.sections, requested, card.baseline);
		void card.panel.webview.postMessage({
			type: 'saved',
			message:
				ignored.length > 0 ? `Сохранено; платформа не приняла: ${ignored.join(', ')}` : undefined,
		});
	}
}

/** Разметка и скрипт карточки. */
function buildHtml(): string {
	const nonce = Math.random().toString(36).slice(2);
	return /* html */ `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
${chromeStyles()}
	.chrome-body { grid-template-columns: minmax(0, 1fr); }
	/* Кнопка стоит рядом с заголовком, а не улетает к правому краю пустой полосы */
	.toolbar .title { margin-right: 10px; }
	.main { overflow: auto; padding: 10px 16px 18px; }
	/* Разделы идут двумя колонками, а внутри раздела подпись стоит слева от поля:
	   так карточка держится в одном экране, как диалог свойств в консоли кластера */
	.sections { display: grid; grid-template-columns: repeat(auto-fit, minmax(430px, 1fr));
		gap: 4px 26px; align-items: start; }
	.section { break-inside: avoid; margin-bottom: 10px; }
	.section h2 { margin: 8px 0 6px; }
	.field { display: grid; grid-template-columns: 210px minmax(0, 1fr); align-items: center;
		gap: 8px; margin-bottom: 4px; }
	.field label { font-size: 0.9em; color: var(--vscode-foreground); text-align: right;
		overflow-wrap: anywhere; }
	.field input, .field select { padding: 3px 6px; }
	/* Каркас оформляет только текст, число и пароль: дате нужны те же цвета */
	.field input[type=datetime-local] { background: var(--vscode-input-background);
		color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent);
		border-radius: 4px; font-family: inherit; font-size: inherit; }
	/* Календарь и стрелки рисует браузер: без подсказки о теме они остаются светлыми */
	body.vscode-dark input[type=datetime-local] { color-scheme: dark; }
	.field.flag { grid-template-columns: 210px minmax(0, 1fr); }
	.field.flag label { order: 1; text-align: right; }
	.field.flag input { order: 2; width: auto; justify-self: start; }
	.readonly { font-family: var(--vscode-editor-font-family); font-size: 0.9em;
		color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
	.state { padding: 14px 0; color: var(--vscode-descriptionForeground); }
	.state.error { color: var(--fail); }
</style>
</head>
<body>
<div class="chrome">
	<div class="toolbar">
		<span class="title" id="subtitle">Свойства объекта кластера</span>
		<button id="reload">Обновить</button>
	</div>
	<div class="chrome-body">
		<div class="main" id="main"><div class="state">Читаю свойства…</div></div>
	</div>
	${saveBarHtml()}
</div>
<script nonce="${nonce}">
${chromeScript()}

let sections = [];
let draft = {};
let baseline = {};

function readonlyField(item, value) {
	const wrap = document.createElement('div');
	wrap.className = 'field';
	const label = document.createElement('label');
	label.textContent = item.title;
	const text = document.createElement('div');
	text.className = 'readonly';
	text.textContent = value;
	wrap.appendChild(label);
	wrap.appendChild(text);
	return wrap;
}

/** Поле с выбором из списка: значения и подписи задаёт описание объекта */
function selectField(item, value) {
	const wrap = document.createElement('div');
	wrap.className = 'field';
	const label = document.createElement('label');
	label.textContent = item.title;
	if (item.hint) { wrap.title = item.hint; }
	const select = document.createElement('select');
	for (const option of item.options || []) {
		const element = document.createElement('option');
		element.value = option[0];
		element.textContent = option[1];
		element.selected = value === option[0];
		select.appendChild(element);
	}
	select.addEventListener('change', () => { draft[item.key] = select.value; renderAll(); });
	wrap.appendChild(label);
	wrap.appendChild(select);
	return wrap;
}

/** Дата и время: платформа ждёт местное время вида 2026-08-18T22:00:00 */
function dateField(item, value) {
	const wrap = document.createElement('div');
	wrap.className = 'field';
	const label = document.createElement('label');
	label.textContent = item.title;
	if (item.hint) { wrap.title = item.hint; }
	const input = document.createElement('input');
	input.type = 'datetime-local';
	// Секунды платформа хранит, поэтому поле показывает их и не округляет молча
	input.step = '1';
	input.value = value;
	input.addEventListener('change', () => {
		const next = input.value;
		draft[item.key] = next === '' || next.length > 16 ? next : next + ':00';
		renderAll();
	});
	wrap.appendChild(label);
	wrap.appendChild(input);
	return wrap;
}

/** Одно поле карточки: имя параметра именно item, чтобы не перекрыть field() каркаса */
function renderField(item) {
	const value = draft[item.key] === undefined ? '' : draft[item.key];
	if (item.kind === 'readonly') { return readonlyField(item, value); }
	if (item.kind === 'select') { return selectField(item, value); }
	if (item.kind === 'date') { return dateField(item, value); }
	if (item.kind === 'password') {
		const wrap = document.createElement('div');
		wrap.className = 'field';
		const label = document.createElement('label');
		label.textContent = item.title;
		const input = document.createElement('input');
		input.type = 'password';
		input.value = value;
		input.addEventListener('input', () => { pendingEdit = true; renderSaveBar(); });
		input.addEventListener('change', () => {
			pendingEdit = false;
			draft[item.key] = input.value;
			renderSaveBar();
		});
		if (item.hint) { wrap.title = item.hint; }
		wrap.appendChild(label);
		wrap.appendChild(input);
		return wrap;
	}
	if (item.kind === 'flag') {
		const wrap = document.createElement('div');
		wrap.className = 'field flag';
		const label = document.createElement('label');
		label.textContent = item.title;
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = value === 'on';
		input.addEventListener('change', () => {
			draft[item.key] = input.checked ? 'on' : 'off';
			renderAll();
		});
		if (item.hint) { wrap.title = item.hint; }
		wrap.appendChild(label);
		wrap.appendChild(input);
		return wrap;
	}
	const element = field(
		item.title,
		value,
		(next) => { draft[item.key] = next; renderAll(); },
		item.kind === 'number' ? 'number' : 'text'
	);
	// Подпись каркаса стоит над полем, а карточке нужна слева: переносим её сами
	element.className = 'field';
	if (item.hint) { element.title = item.hint; }
	return element;
}

function renderAll() {
	const main = document.getElementById('main');
	main.textContent = '';
	const columns = document.createElement('div');
	columns.className = 'sections';
	for (const section of sections) {
		const block = document.createElement('div');
		block.className = 'section';
		const heading = document.createElement('h2');
		heading.textContent = section.title;
		block.appendChild(heading);
		for (const item of section.fields) {
			block.appendChild(renderField(item));
		}
		columns.appendChild(block);
	}
	main.appendChild(columns);
	renderSaveBar();
}

document.getElementById('reload').addEventListener('click', () => post({ type: 'reload' }));

window.addEventListener('message', (event) => {
	const data = event.data;
	if (data.type === 'model') {
		sections = data.sections;
		draft = JSON.parse(JSON.stringify(data.values));
		baseline = JSON.parse(JSON.stringify(data.values));
		document.getElementById('subtitle').textContent = data.subtitle;
		commit();
		return;
	}
	if (data.type === 'saved') {
		saveStatus = data.message || ${JSON.stringify(CHROME_LABELS.saved)};
		saveStatusKind = 'ok';
		renderSaveBar();
		return;
	}
	if (data.type === 'saveFailed') {
		saveStatus = data.message;
		saveStatusKind = 'error';
		renderSaveBar();
		return;
	}
	if (data.type === 'failed') {
		const main = document.getElementById('main');
		main.textContent = '';
		const state = document.createElement('div');
		state.className = 'state error';
		state.textContent = data.message;
		main.appendChild(state);
	}
});
</script>
</body>
</html>`;
}
