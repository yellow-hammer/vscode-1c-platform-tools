/**
 * Вкладка «Настройки» редактора СКД: раскладка как в конфигураторе — таблица вариантов слева сверху, дерево структуры
 * справа сверху, внизу «Настройки: <узел>» и вкладки узла; в «Выбранных полях», «Отборе» и «Сортировке» — «Доступные
 * поля» слева и список с пиктограммами справа; команды над списками — пиктограммы.
 *
 * Функции dcs-editor.js исполняются как есть, вырезанные по сигнатуре: DOM и канал панели — мини-заглушки. Здесь —
 * правила и обработчики, на которых держится поведение; скрипт целиком, с настоящей перерисовкой страницы и окнами
 * VS Code, эти тесты не запускают: вид, фокус в настоящем окне и читалка проверяются вручную.
 * Функции закладок лежат в модулях рядом с ядром dcs-editor.js (общий текст частей даёт dcsEditorScript.ts). Код закладки
 * берёт общее изменяемое состояние полями объекта ядра (core.model…): в тесте это аксессоры к переменным теста.
 * Запуск: npm run compile && node --test out/test/metadata/dcsSettingsTab.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readEditorScript, withCoreAccessors } from '../fixtures/helpers/dcsEditorScript';

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const ROOT = path.resolve(__dirname, '../../..');
const WEBVIEW = path.join(ROOT, 'resources', 'webview');
const SCRIPT = readEditorScript();
const CSS = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.css'), 'utf8').replace(/\r\n/g, '\n');

/** Функция верхнего уровня скрипта (отступ — один таб) по началу сигнатуры, с телом. */
function topFunction(signature: string): string {
	const start = SCRIPT.indexOf('\n\tfunction ' + signature);
	assert.ok(start >= 0, `нет function ${signature}`);
	assert.equal(SCRIPT.indexOf('\n\tfunction ' + signature, start + 1), -1, `function ${signature} не одна`);
	const end = SCRIPT.indexOf('\n\t}\n', start);
	return SCRIPT.slice(start, end + 4);
}

/** Однострочная константа верхнего уровня («const ИМЯ = …;»). */
function topLine(name: string): string {
	const start = SCRIPT.indexOf('\n\tconst ' + name + ' = ');
	assert.ok(start >= 0, `нет const ${name}`);
	return SCRIPT.slice(start, SCRIPT.indexOf('\n', start + 1) + 1);
}

/** Константа-массив или объект верхнего уровня: от «const ИМЯ = [» / «{» до закрывающей скобки на отступе один таб. */
function topBlock(name: string, close: string): string {
	const start = SCRIPT.indexOf('\n\tconst ' + name + ' = ');
	assert.ok(start >= 0, `нет const ${name}`);
	const end = SCRIPT.indexOf('\n\t' + close + '\n', start);
	return SCRIPT.slice(start, end + close.length + 3);
}

/** Имена с местами переноса (setNameText, nameEl) — как есть: ими строят ячейки (cell), подписи деревьев и строку «Настройки: …». */
const NAME_HELPERS = topFunction('setNameText(node, text) {') + topFunction('nameEl(tag, className, text) {');

/** Номер вставки переноса мышью (dropIndex) и узел структуры по пути (nodeAt) — как есть. */
const DROP_INDEX = new Function(topFunction('dropIndex(count, from, target, place) {') + '\nreturn dropIndex;')() as (count: number, from: number, target: number, place: string) => number;
const NODE_AT = new Function(topFunction('nodeAt(settings, path) {') + '\nreturn nodeAt;')() as (settings: unknown, path: unknown[]) => unknown;

/** Узел мини-DOM: атрибуты, дети с родителем, события, фокус. */
class Node {
	tagName: string;
	className: string;
	children: Node[] = [];
	parentElement: Node | null = null;
	id = '';
	title = '';
	type = '';
	value = '';
	checked = false;
	disabled = false;
	style: Record<string, string> = {};
	private ownTabIndex: number | null = null;

	get tabIndex(): number {
		return this.ownTabIndex === null ? 0 : this.ownTabIndex;
	}

	set tabIndex(value: number) {
		this.ownTabIndex = Number(value);
	}

	/** tabIndex задан явно — как атрибут tabindex в разметке (для [tabindex] в querySelectorAll). */
	get tabIndexSet(): boolean {
		return this.ownTabIndex !== null;
	}
	private ownText: string;
	private readonly attributes = new Map<string, string>();
	private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

	constructor(tag: string, className?: string, text?: string) {
		this.tagName = tag.toUpperCase();
		this.className = className || '';
		this.ownText = text === undefined ? '' : text;
	}

	get textContent(): string {
		return this.ownText + this.children.map((child) => child.textContent).join('');
	}

	set textContent(value: string) {
		this.ownText = String(value);
		for (const child of this.children) {
			child.parentElement = null;
		}
		this.children = [];
	}

	get classList(): { toggle(name: string, on?: boolean): boolean; contains(name: string): boolean; add(name: string): void } {
		const names = (): Set<string> => new Set(this.className.split(/\s+/).filter(Boolean));
		return {
			toggle: (name: string, on?: boolean): boolean => {
				const set = names();
				const want = on === undefined ? !set.has(name) : on;
				if (want) {
					set.add(name);
				} else {
					set.delete(name);
				}
				this.className = [...set].join(' ');
				return want;
			},
			contains: (name: string): boolean => names().has(name),
			add: (name: string): void => {
				const set = names();
				set.add(name);
				this.className = [...set].join(' ');
			},
		};
	}

	get isConnected(): boolean {
		for (let node: Node | null = this; node; node = node.parentElement) {
			if (node === doc.body) {
				return true;
			}
		}
		return false;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, String(value));
	}

	getAttribute(name: string): string | null {
		return this.attributes.has(name) ? (this.attributes.get(name) as string) : null;
	}

	removeAttribute(name: string): void {
		this.attributes.delete(name);
	}

	appendChild(child: Node): Node {
		if (child.parentElement) {
			child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
		}
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	addEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.set(type, (this.listeners.get(type) || []).concat([listener]));
	}

	/** Событие обработчикам узла; возвращает признак preventDefault. */
	fire(type: string, fields: Record<string, unknown> = {}): boolean {
		let prevented = false;
		const event = Object.assign(
			{
				target: this,
				defaultPrevented: false,
				preventDefault: () => {
					prevented = true;
				},
				stopPropagation: () => undefined,
			},
			fields
		);
		for (const listener of this.listeners.get(type) || []) {
			listener(event);
		}
		return prevented;
	}

	focus(): void {
		if (this.isConnected) {
			doc.active = this;
		}
	}

	/** Потомки по простым селекторам через запятую: тег, [атрибут], тег[атрибут="значение"] (как FOCUSABLE). */
	querySelectorAll(selector: string): Node[] {
		const parts = selector.split(',').map((part) => /^([a-z]*)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/i.exec(part.trim()));
		return this.find((node) =>
			parts.some((m) => {
				if (!m) {
					return false;
				}
				if (m[1] && node.tagName !== m[1].toUpperCase()) {
					return false;
				}
				if (m[2]) {
					const value = m[2] === 'tabindex' ? (node.tabIndexSet ? String(node.tabIndex) : null) : node.getAttribute(m[2]);
					return value !== null && (m[3] === undefined || value === m[3]);
				}
				return true;
			})
		);
	}

	/** Потомки по условию, в порядке документа. */
	find(pred: (node: Node) => boolean): Node[] {
		const out: Node[] = [];
		const walk = (node: Node): void => {
			for (const child of node.children) {
				if (pred(child)) {
					out.push(child);
				}
				walk(child);
			}
		};
		walk(this);
		return out;
	}
}

const doc = {
	body: new Node('body'),
	active: null as Node | null,
	get activeElement(): Node {
		return this.active && this.active.isConnected ? this.active : this.body;
	},
	createElement: (tag: string): Node => new Node(tag),
	// Текст имени между местами переноса (setNameText): узел без тега со своим текстом
	createTextNode: (text: string): Node => new Node('#text', '', text),
};

const el = (tag: string, className?: string, text?: string): Node => new Node(tag, className, text);
const keyed = (node: Node, key: string): Node => {
	node.setAttribute('data-dcs-key', key);
	return node;
};
const focusKey = (parts: string[]): string => parts.join('\n');

/** Кнопка-пиктограмма заглушкой: те же атрибуты, что у iconButton (имя, подсказка, причина, недоступность). */
function iconButtonStub(spec: { icon: string; name: string; shortcut?: string; note?: string; unavailable?: boolean; disabled?: boolean; className?: string; onClick: () => void }): Node {
	const node = el('button', (spec.className || 'ghost-btn dcs-btn-small') + ' dcs-icon-btn');
	node.setAttribute('data-icon', spec.icon);
	node.setAttribute('aria-label', spec.name);
	const head = spec.shortcut ? spec.name + ' (' + spec.shortcut + ')' : spec.name;
	node.title = spec.note ? head + '\n' + spec.note : head;
	if (spec.note || spec.shortcut) {
		// Как spokenReason: у недоступной «Недоступно» читалка говорит сама, в описании — только причина
		const reason = spec.unavailable && spec.note ? spec.note.replace(/^Недоступно[:,]?\s*/u, '') : spec.note || '';
		node.setAttribute('aria-description', reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : 'Клавиша в списке: ' + spec.shortcut);
	}
	if (spec.unavailable) {
		node.setAttribute('aria-disabled', 'true');
	}
	node.disabled = Boolean(spec.disabled);
	node.addEventListener('click', spec.onClick);
	return node;
}

const SAMPLE_SELECTION = [
	{ kind: 'field', field: 'Склад' },
	{ kind: 'folder', title: 'Суммы', items: [{ kind: 'field', field: 'Сумма' }, { kind: 'auto' }] },
	{ kind: 'auto' },
];

describe('«Настройки»: раскладка и порядок вкладок как в конфигураторе', () => {
	test('вкладки узла: Параметры, Выбранные поля, Отбор, Сортировка, Условное оформление, Пользовательские поля, Другие настройки; «Поля группировки» — у группировки первыми', () => {
		const block = topBlock('NODE_PANELS', '];');
		const panels = [...block.matchAll(/\{ id: '(\w+)', title: '([^']+)', kinds: \[([^\]]*)\]/g)].map((m) => ({
			id: m[1],
			title: m[2],
			kinds: m[3].split(',').map((kind) => kind.trim().replace(/'/g, '')),
		}));
		const titlesOf = (kind: string): string[] => panels.filter((panel) => panel.kinds.includes(kind)).map((panel) => panel.title);
		assert.deepEqual(titlesOf('root'), ['Параметры', 'Выбранные поля', 'Отбор', 'Сортировка', 'Условное оформление', 'Пользовательские поля', 'Другие настройки']);
		assert.deepEqual(titlesOf('group'), ['Поля группировки', 'Выбранные поля', 'Отбор', 'Сортировка', 'Условное оформление', 'Другие настройки']);
		// Состав по видам узла: у таблицы и диаграммы нет отбора, сортировки, параметров и полей группировки
		assert.deepEqual(titlesOf('table'), ['Выбранные поля', 'Условное оформление', 'Другие настройки']);
		assert.deepEqual(titlesOf('chart'), titlesOf('table'));
		assert.ok(topLine('DEFAULT_NODE_PANEL').includes("'selection'"));
		// Выбранной вкладки у узла нет — «Выбранные поля», а не первая по порядку («Параметры»)
		const render = topFunction('renderNodePanels(host, settings, variantName) {');
		assert.ok(render.includes('uiState.panel = panels.some((panel) => panel.id === DEFAULT_NODE_PANEL) ? DEFAULT_NODE_PANEL : panels[0].id;'));
	});

	test('раскладка: верх — варианты и структура, низ на всю ширину — «Настройки: <узел>» и вкладки; фокус после перерисовки — на новой строке', () => {
		const render = topFunction('renderVariants(host) {');
		const order = ["el('div', 'dcs-setv')", "el('div', 'dcs-setv-top')", 'renderVariantList(variantPane, variants, name);', "el('div', 'dcs-setv-bottom')", 'renderStructureTree(structurePane, settings, name);', 'renderNodePanels(bottom, settings, name);'];
		let at = -1;
		for (const piece of order) {
			const next = render.indexOf(piece);
			assert.ok(next > at, `не на месте: ${piece}`);
			at = next;
		}
		assert.ok(render.includes("const row = focusKeys.get(focusKey(['varrow', name]));") && render.includes("focusKeyed(focusKey(['node', pathKey(uiState.nodePath)]));"));
		const panels = topFunction('renderNodePanels(host, settings, variantName) {');
		assert.ok(panels.includes("const captionText = 'Настройки: ' + nodeCaption(settings, path);"));
		assert.ok(panels.includes("strip.setAttribute('role', 'tablist');") && panels.includes("strip.setAttribute('aria-label', captionText);"));
		assert.ok(panels.includes("button.tabIndex = active ? 0 : -1;") && panels.includes("keyed(button, focusKey(['subtab', panel.id]));"));
		assert.ok(panels.includes("body.setAttribute('role', 'tabpanel');"));
		// Область вкладки и колонки «Доступные поля» — список — в документе до отрисовки: фокус, который ставит список
		// (строка после удаления клавишей), у неподключённого узла пропал бы
		assert.ok(panels.indexOf('host.appendChild(body);') >= 0 && panels.indexOf('host.appendChild(body);') < panels.indexOf('active.render(body, node, path, variantName);'));
		const fieldsLayout = topFunction('settingsFieldsLayout(host, spec) {');
		assert.ok(fieldsLayout.includes("const layout = host.appendChild(el('div', 'dcs-setv-fields'));"));
		assert.ok(fieldsLayout.includes("spec.list(layout.appendChild(el('div', 'dcs-setv-col')), {"));
		assert.ok(render.indexOf('host.appendChild(layout);') < render.indexOf('loadedVariantSettings(structurePane, name)'), 'дерево и вкладки рисуются вне документа');
		// Вкладка узла при смене варианта остаётся
		assert.ok(!topFunction('selectVariant(name) {').includes('uiState.panel'), 'смена варианта сбрасывает вкладку');
	});

	test('удаление клавишей Delete и переименование из таблицы: фокус ждёт ответа правки (replyFocus), смена варианта, узла и вкладки его сбрасывает', () => {
		assert.ok(topFunction('removeVariant(name, total, fromGrid) {').includes('replyFocus.variant = Boolean(fromGrid);'));
		assert.ok(topFunction('removeNode(variantName, path, node, fromTree) {').includes('replyFocus.structure = Boolean(fromTree);'));
		assert.ok(topFunction('openVariantPropsDialog(variant, fromGrid) {').includes('replyFocus.variant = Boolean(fromGrid);'));
		assert.ok(topFunction('onVariantKey(event, names, index, item) {').includes("removeVariant(item.name || '', names.length, true);"));
		assert.ok(topFunction('onVariantKey(event, names, index, item) {').includes('openVariantPropsDialog(item, true);'));
		assert.ok(topFunction('renderVariantList(host, variants, name) {').includes('openVariantPropsDialog(item, true);'), 'двойной щелчок по строке');
		assert.ok(topFunction('onStructureKey(event, key) {').includes('removeNode(structureCtx.variantName, row.path, row.node, true);'));
		for (const panel of ['renderSelectionPanel(host, node, path, variantName) {', 'renderOrderPanel(host, node, path, variantName) {', 'renderFilterPanel(host, node, path, variantName) {']) {
			assert.ok(topFunction(panel).includes('replyFocus.list = stateKey;'), panel);
		}
		for (const fn of ['selectVariant(name) {', 'selectNode(path) {', 'pickNodePanel(id, focus) {']) {
			assert.ok(topFunction(fn).includes('clearReplyFocus();'), fn + ' не сбросил фокус ответа');
		}
		// Список сравнивает флажок с ключом своего состояния (вариант, узел, панель), а не с id панели
		assert.equal((topFunction('settingsListGrid(host, spec) {').match(/core\.focusListPanel === spec\.stateKey/g) || []).length, 2);
	});

	test('ответ saved: флажки фокуса — только в отрисовке удачного ответа, после неё гаснут; отказ сбрасывает ждущий фокус', () => {
		const rendered: Array<[boolean, boolean, string]> = [];
		const code =
			'let saving = true; const background = false; let pendingVariant = ""; let pendingSelect = null; let pendingPathCommit = null;\n' +
			'let pendingRename = null; let pendingDataSet = ""; let model = null; let activeTabId = "variants";\n' +
			'let focusVariantRow = false; let focusStructureRow = false; let focusListPanel = ""; let focusResourceRow = false; let editOrigin = null;\n' +
			'let resourceReply = null; const resourceUi = { selected: 0 };\n' +
			topLine('replyFocus') +
			topFunction('clearReplyFocus() {') +
			topFunction('resourceRefusalText(reply, error) {') +
			topFunction('onSaved(msg) {') +
			'\nreturn { onSaved, replyFocus, flags: () => [focusVariantRow, focusStructureRow, focusListPanel], setTab: (id) => { activeTabId = id; },' +
			' setOrigin: (level) => { editOrigin = level; }, resourceFlag: () => focusResourceRow,' +
			' setResourceReply: (value) => { resourceReply = value; }, resourceReply: () => resourceReply, resourceUi, model: () => model };';
		const noop = (): void => undefined;
		const focused: string[] = [];
		const closed: string[] = [];
		const errors: string[] = [];
		const spoken: string[] = [];
		// Плашки ответа: тон, заголовок, строки и сколько отрисовок было до неё
		const notices: Array<[string, string, Array<{ text: string }>, number]> = [];
		// Плашку итога «Ресурсов» собирает resourceReplyNotice по модели ответа: с каким итогом и при какой модели она звана
		const replyNotices: Array<[unknown, unknown]> = [];
		const statuses: string[] = [];
		const pageFocus: { body: unknown; active: unknown } = { body: { tagName: 'BODY' }, active: null };
		const stubs: Record<string, unknown> = {
			document: {
				get body(): unknown {
					return pageFocus.body;
				},
				get activeElement(): unknown {
					return pageFocus.active;
				},
			},
			focusKeyed: (key: string) => focused.push(key),
			focusKey,
			onBackgroundSaved: noop,
			setStatus: (value: string) => statuses.push(value),
			closeDialog: () => closed.push('все'),
			showNotice: (tone: string, title: string, lines: Array<{ text: string }>) => notices.push([tone, title, lines, rendered.length]),
			queryAppliedNoticeLines: noop,
			autofillNoticeLines: noop,
			uiState: { variant: 'Основной', nodePath: [], panel: 'selection' },
			variantCache: {},
			variantErrors: {},
			expandTo: noop,
			withTypeCompositions: (value: unknown) => value,
			pruneVariantCache: noop,
			reconcileQueryDrafts: noop,
			pruneFieldPathDrafts: noop,
			renderTabs: noop,
			retryQueryDrafts: noop,
			dialogOpen: () => false,
			dialogStack: { top: () => ({ setError: (text: string) => errors.push(text) }) },
			fieldPathDrafts: new Map(),
			announceCompletion: (text: string) => spoken.push(text),
			resourceReplyNotice: (reply: { add?: unknown; batch?: unknown }) => {
				replyNotices.push([reply, api.model()]);
				return reply.add || reply.batch ? { tone: 'ok', lines: [{ text: 'Добавлен ресурс Сумма(Склад).' }] } : null;
			},
		};
		let api: {
			onSaved(msg: unknown): void;
			replyFocus: { variant: boolean; structure: boolean; list: string; fallback: string; resources: boolean };
			flags(): [boolean, boolean, string];
			setTab(id: string): void;
			setOrigin(level: unknown): void;
			resourceFlag(): boolean;
			setResourceReply(value: unknown): void;
			resourceReply(): unknown;
			resourceUi: { selected: number };
			model(): unknown;
		};
		const resourceSeen: boolean[] = [];
		stubs.renderContent = () => {
			rendered.push(api.flags());
			resourceSeen.push(api.resourceFlag());
		};
		api = new Function(...Object.keys(stubs), code)(...Object.values(stubs)) as typeof api;
		// Delete в списке, затем ответ: фокус — в отрисовке ответа, после неё флажок погашен
		api.replyFocus.list = 'Основной\n[]\nselection';
		api.onSaved({ ok: true, model: {} });
		assert.deepEqual(rendered, [[false, false, 'Основной\n[]\nselection']]);
		assert.deepEqual(api.flags(), [false, false, ''], 'флажок пережил ответ и сработает на чужой отрисовке');
		assert.deepEqual(api.replyFocus, { variant: false, structure: false, list: '', fallback: '', resources: false });
		// Ответ без модели при открытых «Настройках» тоже отрисовывает вкладку
		api.replyFocus.variant = true;
		api.replyFocus.structure = true;
		api.onSaved({ ok: true });
		assert.deepEqual(rendered[1], [true, true, '']);
		assert.deepEqual(api.flags(), [false, false, '']);
		// Отказ правки со страницы: ждущий фокус сброшен; вкладка перерисована (флажок в строке возвращается к модели) без
		// флажков фокуса, причину слышит читалка; окно, открытое после правки, отказ себе не берёт
		api.replyFocus.list = 'k';
		api.replyFocus.resources = true;
		api.onSaved({ ok: false, error: 'нет' });
		assert.deepEqual(rendered[2], [false, false, '']);
		assert.deepEqual(api.replyFocus, { variant: false, structure: false, list: '', fallback: '', resources: false });
		assert.deepEqual(focused, []);
		assert.deepEqual(spoken, ['Не сохранено: нет']);
		assert.deepEqual(errors, []);
		// Отказ правки из окна — в окне, вкладка не перерисовывается
		let open = true;
		const level = { isOpen: () => open };
		api.setOrigin(level);
		api.onSaved({ ok: false, error: 'занято' });
		assert.deepEqual(errors, ['занято']);
		assert.equal(rendered.length, 3);
		// Удачный ответ закрывает окна, только если правка ушла из окна и оно ещё открыто: ответ правки со страницы,
		// ждавшей фоновой записи, не закрывает конструктор, открытый после неё
		closed.length = 0;
		api.onSaved({ ok: true, model: {} });
		assert.deepEqual(closed, [], 'правка со страницы закрыла окно');
		api.setOrigin(level);
		api.onSaved({ ok: true, model: {} });
		assert.deepEqual(closed, ['все']);
		open = false;
		api.setOrigin(level);
		api.onSaved({ ok: true, model: {} });
		assert.deepEqual(closed, ['все'], 'окно правки уже закрыто — новое окно не её');
		// Фокус «Ресурсов» после удаления из таблицы — тоже только в отрисовке удачного ответа: флажок, поставленный при
		// отправке, не переживает отказ и не срабатывает на чужой отрисовке; отказ выше его не зажёг
		assert.ok(!resourceSeen.includes(true), 'флажок «Ресурсов» зажёгся без удачного ответа');
		api.replyFocus.resources = true;
		api.onSaved({ ok: true, model: {} });
		assert.equal(resourceSeen[resourceSeen.length - 1], true, 'отрисовка ответа не вернула фокус в таблицу');
		assert.equal(api.resourceFlag(), false, 'флажок «Ресурсов» пережил ответ');
		// Ресурс, добавленный «>» или «>>»: строка выбрана до отрисовки удачного ответа, итог — плашкой после неё,
		// собранной по модели ответа (описания, пришедшие за время сохранения, уже в ней)
		const lines = [{ text: 'Добавлен ресурс Сумма(Склад).' }];
		api.resourceUi.selected = 0;
		const added = { row: 4, add: { path: 'Склад', kind: 'field', expression: 'Сумма(Склад)' } };
		api.setResourceReply(added);
		const drawn = rendered.length;
		const answerModel = { totalFields: [] };
		api.onSaved({ ok: true, model: answerModel });
		assert.equal(api.resourceUi.selected, 4);
		assert.deepEqual(replyNotices[replyNotices.length - 1], [added, answerModel], 'плашка собрана не по модели ответа');
		assert.deepEqual(notices[notices.length - 1], ['ok', 'Ресурсы', lines, drawn + 1], 'плашка до отрисовки или без неё');
		assert.equal(api.resourceReply(), null, 'итог пережил ответ');
		// У окна «Новый ресурс» итога плашкой нет; отказ выбор не сдвигает и итог сбрасывает
		const said = notices.length;
		api.setResourceReply({ row: 5 });
		api.onSaved({ ok: true, model: {} });
		assert.equal(api.resourceUi.selected, 5);
		assert.equal(notices.length, said, 'плашка у окна');
		api.setResourceReply({ row: 6, add: added.add });
		api.onSaved({ ok: false, error: 'отказ' });
		assert.equal(api.resourceUi.selected, 5, 'отказ выбрал строку, которой нет');
		assert.equal(api.resourceReply(), null);
		assert.equal(notices.length, said, 'плашка итога у отказа');
		assert.equal(spoken[spoken.length - 1], 'Не сохранено: отказ', 'отказ одиночного ресурса — не как есть');
		// Отказ пакета «>>»: строка состояния и читалка называют поле плана, а не номер операции, которого пользователь не видел
		api.setResourceReply({ row: 6, batch: { add: ['Сумма', 'Наценка'], unknown: [], unsafe: [] } });
		api.onSaved({ ok: false, error: 'Операция 2 (cf-dcs-add-total-field): Схема после правки не читается моделью' });
		const named = 'Ресурсы не добавлены, ресурс по полю «Наценка»: Схема после правки не читается моделью';
		assert.equal(statuses[statuses.length - 1], named);
		assert.equal(spoken[spoken.length - 1], named, 'читалка не слышит поле отказа');
		assert.equal(api.resourceReply(), null);
		assert.equal(api.resourceUi.selected, 5);
		// Удалён последний вариант клавишей: закладка «Настройки» остаётся — фокус ставит её отрисовка
		// («Добавить вариант…»), ярлык закладки его не забирает, открыта она или другая
		for (const tab of ['variants', 'dataSets']) {
			api.setTab(tab);
			api.replyFocus.variant = true;
			api.onSaved({ ok: true, model: { settingsVariants: [] } });
			assert.deepEqual(focused, [], `ярлык забрал фокус (${tab})`);
		}
		// Удалена последняя строка кнопкой в строке: фокус ушёл в никуда — запасная цель; фокус на месте — её не трогаем
		api.replyFocus.fallback = 'grpf\ndelete\n0';
		pageFocus.active = pageFocus.body;
		api.onSaved({ ok: true, model: {} });
		assert.deepEqual(focused, ['grpf\ndelete\n0']);
		api.replyFocus.fallback = 'grpf\ndelete\n0';
		pageFocus.active = { tagName: 'BUTTON' };
		api.onSaved({ ok: true, model: {} });
		assert.equal(focused.length, 1, 'запасная цель перебила фокус, который нашёлся');
	});

	test('подпись узла: «Отчет», группировка — её полями, таблица и диаграмма — видом, список таблицы — его названием', () => {
		const code =
			topLine('PSEUDO_TITLES') +
			topFunction('isPseudoPath(path) {') +
			topFunction('nodeAt(settings, path) {') +
			topFunction('nodeCaption(settings, path) {') +
			'\nreturn nodeCaption;';
		const nodeCaption = new Function('nodeLabel', code)((node: { kind?: string; name?: string }) => (node.kind === 'table' ? 'Таблица' : 'Склад')) as (s: unknown, p: unknown[]) => string;
		const settings = { structure: [{ kind: 'group' }, { kind: 'table', rows: [] }] };
		assert.equal(nodeCaption(settings, []), 'Отчет');
		assert.equal(nodeCaption(settings, [{ list: 'structure', index: 0 }]), 'Склад');
		assert.equal(nodeCaption(settings, [{ list: 'structure', index: 1 }]), 'Таблица');
		assert.equal(nodeCaption(settings, [{ list: 'structure', index: 1 }, { list: 'rows', index: -1 }]), 'Строки');
	});

	test('стили: верх около 40 %, низ около 60 % высоты; уже 760 px — столбиком; «Доступные поля» и список — в три колонки', () => {
		assert.match(CSS, /\.dcs-setv-top \{[^}]*grid-template-columns: minmax\(0, 2fr\) minmax\(0, 3fr\);[^}]*height: max\(200px, calc\(\(100vh - 240px\) \* 0\.4\)\);/);
		assert.match(CSS, /\.dcs-setv-bottom \{[^}]*min-height: max\(280px, calc\(\(100vh - 240px\) \* 0\.6\)\);/);
		assert.match(CSS, /\.dcs-setv-fields \{[^}]*grid-template-columns: minmax\(180px, 260px\) auto minmax\(0, 1fr\);/);
		const narrow = CSS.indexOf('@media (max-width: 760px) {\n\t.dcs-setv-top {');
		assert.ok(narrow > CSS.indexOf('.dcs-setv-top {'), 'правило узкого окна перекрыто основным');
		const media = CSS.slice(narrow, CSS.indexOf('\n}\n', narrow));
		assert.match(media, /\.dcs-setv-top \{\n\t\tgrid-template-columns: minmax\(0, 1fr\);\n\t\theight: auto;/);
		assert.match(media, /\.dcs-setv-fields \{\n\t\tgrid-template-columns: minmax\(0, 1fr\);/);
		// Недоступная команда панели — приглушена, рамка фокуса остаётся
		assert.match(CSS, /\.dcs-list-toolbar \.ghost-btn\[aria-disabled='true'\] \{\n\tcolor: var\(--vscode-disabledForeground\);/);
		// Классы раскладки — в стилях
		for (const name of ['dcs-setv', 'dcs-setv-pane', 'dcs-setv-caption', 'dcs-setv-scroll', 'dcs-setv-grid', 'dcs-setv-tree', 'dcs-setv-node', 'dcs-setv-col']) {
			assert.ok(CSS.includes('.' + name + ' ') || CSS.includes('.' + name + ',') || CSS.includes('.' + name + ':') || CSS.includes('.' + name + '\n'), name);
		}
	});
});

describe('«Настройки»: таблица вариантов', () => {
	interface VariantHarness {
		host: Node;
		calls: string[];
		picked: Array<[string, boolean]>;
		state: () => { focusVariantRow: boolean };
		rows(): Node[];
		tool(name: string): Node;
	}

	function variants(list: Array<{ name: string; value?: string }>, active: string, loaded: boolean, extra: { failed?: boolean } = {}): VariantHarness {
		const calls: string[] = [];
		const picked: Array<[string, boolean]> = [];
		const code =
			'let focusVariantRow = false;\n' +
			topLine('VARIANT_COPY_NOTE') +
			topLine('VARIANT_MOVE_NOTE') +
			topLine('WIZARD_NOTE') +
			NAME_HELPERS +
			topFunction('cell(tr, text, className) {') +
			topFunction('renderVariantList(host, variants, name) {') +
			topFunction('onVariantKey(event, names, index, item) {') +
			topFunction('pickVariant(variantName, focus) {') +
			'\nreturn { renderVariantList, state: () => ({ focusVariantRow }) };';
		const uiState = { variant: active };
		const api = new Function(
			'el',
			'document',
			'keyed',
			'focusKey',
			'iconButton',
			'emptyNote',
			'variantCache',
			'variantErrors',
			'uiState',
			'settingsNotice',
			'openAddVariantDialog',
			'removeVariant',
			'openVariantPropsDialog',
			'startSettingsWizard',
			'focusKeyed',
			'selectVariant',
			withCoreAccessors(code)
		)(
			el,
			doc,
			keyed,
			focusKey,
			iconButtonStub,
			(host: Node, text: string) => host.appendChild(el('div', 'dcs-empty', text)),
			loaded ? { [active]: {} } : {},
			extra.failed ? { [active]: 'нет связи' } : {},
			uiState,
			(title: string, text: string) => calls.push('notice:' + title + ':' + text),
			() => calls.push('add'),
			(name: string, total: number) => calls.push('remove:' + name + ':' + total),
			(item: { name: string }) => calls.push('props:' + item.name),
			(name: string) => calls.push('wizard:' + name),
			(key: string) => calls.push('focus:' + key),
			(name: string) => picked.push([name, true])
		) as { renderVariantList(host: Node, list: unknown[], name: string): void; state(): { focusVariantRow: boolean } };
		const host = doc.body.appendChild(el('div'));
		api.renderVariantList(host, list, active);
		return {
			host,
			calls,
			picked,
			state: api.state,
			rows: () => host.find((node) => node.tagName === 'TR' && node.getAttribute('role') === 'row' && Boolean(node.parentElement) && node.parentElement?.tagName === 'TBODY'),
			tool: (name: string) => host.find((node) => node.getAttribute('aria-label') === name)[0],
		};
	}

	const LIST = [{ name: 'Основной', value: 'Основной вариант' }, { name: 'Подробный', value: 'Подробно' }, { name: 'Краткий' }];

	test('схема без вариантов: закладка «Настройки» видна, таблица пуста, «Добавить вариант…» работает, остальное — с причиной', () => {
		// Закладка видна и без вариантов: иначе первый вариант из редактора не добавить
		const tabsOf = new Function(
			'list',
			'renderDataSets',
			'renderLinks',
			'renderCalculated',
			'renderResources',
			'renderParameters',
			'renderNested',
			'renderVariants',
			topBlock('TABS', '];') + topFunction('visibleTabs() {') + '\nreturn visibleTabs;'
		)(() => [], ...Array(7).fill(() => undefined)) as () => Array<{ id: string; title: string; count(): number }>;
		const visible = tabsOf();
		assert.deepEqual(
			visible.map((tab) => tab.id),
			['dataSets', 'links', 'calculated', 'resources', 'parameters', 'variants'],
			'пустая схема: «Вложенные схемы» скрыты, «Настройки» — нет'
		);
		assert.equal(visible[5].title + (visible[5].count() > 0 ? ' (' + visible[5].count() + ')' : ''), 'Настройки');
		const h = variants([], '', false);
		assert.equal(h.rows().length, 0, 'строк вариантов нет');
		assert.ok(h.host.find((node) => node.textContent === 'Вариантов нет: добавьте вариант кнопкой «Добавить вариант…».').length > 0);
		const add = h.tool('Добавить вариант…');
		assert.equal(add.getAttribute('aria-disabled'), null, '«Добавить вариант…» недоступна');
		add.fire('click');
		assert.deepEqual(h.calls, ['add']);
		for (const name of ['Удалить вариант', 'Свойства варианта…', 'Конструктор настроек…']) {
			assert.equal(h.tool(name).getAttribute('aria-description'), 'Вариантов нет.', name);
		}
	});

	test('пиктограммы: добавить, скопировать, удалить, выше, ниже, свойства, конструктор; копирование и порядок — недоступны с причиной (у md-sparrow нет операций)', () => {
		const h = variants(LIST, 'Основной', true);
		const bar = h.host.children[0];
		assert.equal(bar.className, 'dcs-list-toolbar');
		assert.deepEqual(
			bar.children.map((b) => [b.getAttribute('data-icon'), b.getAttribute('aria-label')]),
			[
				['add', 'Добавить вариант…'],
				['add-copy', 'Скопировать вариант'],
				['delete', 'Удалить вариант'],
				['up', 'Переместить вариант выше'],
				['down', 'Переместить вариант ниже'],
				['edit', 'Свойства варианта…'],
				['wizard', 'Конструктор настроек…'],
			]
		);
		assert.deepEqual(bar.children.map((b) => b.getAttribute('data-dcs-key')), ['add', 'copy', 'delete', 'up', 'down', 'props', 'wizard'].map((id) => 'vartool\n' + id));
		for (const name of ['Скопировать вариант', 'Переместить вариант выше', 'Переместить вариант ниже']) {
			const button = h.tool(name);
			assert.equal(button.getAttribute('aria-disabled'), 'true', name);
			assert.equal(button.disabled, false, name + ': выпала из обхода Tab');
			// «Недоступно» читалка говорит сама (aria-disabled): в описании — только причина, в подсказке для глаза — целиком
			assert.ok(!/^Недоступно/.test(button.getAttribute('aria-description') || 'Недоступно'), name);
			assert.match(button.title, /\nНедоступно: /, name);
			button.fire('click');
		}
		assert.deepEqual(h.calls, [
			'notice:Скопировать вариант:Недоступно: варианты копируют в конфигураторе.',
			'notice:Переместить вариант выше:Недоступно: порядок вариантов меняют в конфигураторе.',
			'notice:Переместить вариант ниже:Недоступно: порядок вариантов меняют в конфигураторе.',
		]);
		h.tool('Добавить вариант…').fire('click');
		h.tool('Удалить вариант').fire('click');
		h.tool('Свойства варианта…').fire('click');
		h.tool('Конструктор настроек…').fire('click');
		assert.deepEqual(h.calls.slice(3), ['add', 'remove:Основной:3', 'props:Основной', 'wizard:Основной']);
		assert.equal(h.tool('Удалить вариант').title, 'Удалить вариант (Delete)');
		assert.equal(h.tool('Конструктор настроек…').getAttribute('aria-disabled'), null);
		// Пока вариант не загружен, конструктору строить не из чего: недоступен, но в обходе Tab, как соседи; причина — по
		// состоянию, щелчок называет её плашкой
		const wizardOf = (state: VariantHarness): Node => state.tool('Конструктор настроек…');
		const cold = variants(LIST, 'Основной', false);
		assert.equal(wizardOf(cold).disabled, false, 'конструктор выпал из обхода Tab');
		assert.equal(wizardOf(cold).getAttribute('aria-disabled'), 'true');
		assert.equal(wizardOf(cold).getAttribute('aria-description'), 'Пока настройки варианта загружаются.');
		wizardOf(cold).fire('click');
		assert.deepEqual(cold.calls, ['notice:Конструктор настроек…:Недоступно, пока настройки варианта загружаются.']);
		assert.equal(wizardOf(variants(LIST, 'Основной', false, { failed: true })).getAttribute('aria-description'), 'Вариант не загружен.');
		assert.equal(wizardOf(variants([], '', false)).getAttribute('aria-description'), 'Вариантов нет.');
		doc.body.textContent = '';
	});

	test('фокус после ответа: переименованный вариант — на строке под новым именем, удалён последний — на «Добавить вариант…»', () => {
		const focusKeys = new Map<string, Node>();
		const keyedHere = (node: Node, key: string): Node => {
			focusKeys.set(key, node);
			return keyed(node, key);
		};
		let variantsList: Array<{ name: string }> = [];
		const code =
			'let focusVariantRow = false; let focusStructureRow = false;\n' +
			topFunction('focusKeyed(key) {') +
			topFunction('renderVariants(host) {') +
			topFunction('focusGridRow(tr) {') +
			'\nreturn { renderVariants, setFocus: (on) => { focusVariantRow = on; } };';
		const api = new Function(
			'list',
			'activeVariantName',
			'el',
			'renderVariantList',
			'loadedVariantSettings',
			'emptyNote',
			'focusKey',
			'focusKeys',
			withCoreAccessors(code)
		)(
			() => variantsList,
			() => (variantsList[0] ? variantsList[0].name : ''),
			el,
			(host: Node, list: Array<{ name: string }>) => {
				host.appendChild(keyedHere(el('button', '', 'Добавить вариант…'), 'vartool\nadd'));
				for (const item of list) {
					host.appendChild(keyedHere(el('tr', '', item.name), 'varrow\n' + item.name));
				}
			},
			() => null,
			(host: Node, text: string) => host.appendChild(el('div', 'dcs-empty', text)),
			focusKey,
			focusKeys
		) as { renderVariants(host: Node): void; setFocus(on: boolean): void };
		const host = doc.body.appendChild(el('div'));
		// Переименование из таблицы: ответ принёс новое имя — фокус на его строке
		variantsList = [{ name: 'Новое' }, { name: 'Другой' }];
		api.setFocus(true);
		api.renderVariants(host);
		assert.equal(doc.activeElement.textContent, 'Новое');
		// Удалён последний вариант: строк нет — фокус на «Добавить вариант…», а не в никуда
		host.textContent = '';
		variantsList = [];
		api.setFocus(true);
		api.renderVariants(host);
		assert.equal(doc.activeElement.getAttribute('data-dcs-key'), 'vartool\nadd');
		doc.body.textContent = '';
	});

	test('таблица «Имя варианта | Представление»: одна остановка Tab, ↑ ↓ Home End выбирают вариант с фокусом, Enter и F2 — свойства, Delete — удаление', () => {
		const h = variants(LIST, 'Подробный', true);
		const table = h.host.find((node) => node.tagName === 'TABLE')[0];
		assert.equal(table.getAttribute('role'), 'grid');
		assert.equal(table.getAttribute('aria-label'), 'Варианты отчета');
		assert.deepEqual(table.find((node) => node.getAttribute('role') === 'columnheader').map((th) => th.textContent), ['Имя варианта', 'Представление']);
		const rows = h.rows();
		assert.deepEqual(rows.map((tr) => [tr.children[0].textContent, tr.children[1].textContent]), [['Основной', 'Основной вариант'], ['Подробный', 'Подробно'], ['Краткий', '']]);
		assert.deepEqual(rows.map((tr) => tr.tabIndex), [-1, 0, -1]);
		assert.deepEqual(rows.map((tr) => tr.getAttribute('aria-selected')), ['false', 'true', 'false']);
		assert.deepEqual(rows.map((tr) => tr.getAttribute('data-dcs-key')), ['varrow\nОсновной', 'varrow\nПодробный', 'varrow\nКраткий']);
		assert.equal(rows[1].fire('keydown', { key: 'ArrowDown' }), true);
		assert.deepEqual(h.picked, [['Краткий', true]]);
		assert.equal(h.state().focusVariantRow, true, 'после перерисовки фокус не встанет на новую строку');
		rows[1].fire('keydown', { key: 'Home' });
		rows[1].fire('keydown', { key: 'End' });
		rows[0].fire('keydown', { key: 'ArrowUp' });
		assert.deepEqual(h.picked.map((p) => p[0]), ['Краткий', 'Основной', 'Краткий', 'Основной']);
		// Стрелка на уже выбранный вариант: перерисовки нет, фокус — на его строке
		const before = h.picked.length;
		rows[2].fire('keydown', { key: 'ArrowUp' });
		assert.equal(h.picked.length, before, 'выбранный вариант выбран заново');
		assert.equal(rows[1].fire('keydown', { key: 'Enter' }), true);
		rows[2].fire('keydown', { key: 'F2' });
		rows[0].fire('keydown', { key: 'Delete' });
		rows[0].fire('dblclick');
		assert.deepEqual(h.calls, ['focus:varrow\nПодробный', 'props:Подробный', 'props:Краткий', 'remove:Основной:3', 'props:Основной']);
		assert.equal(rows[0].fire('keydown', { key: 'a' }), false, 'чужая клавиша');
		assert.equal(rows[0].fire('keydown', { key: 'ArrowDown', defaultPrevented: true }), false, 'обработанная клавиша');
		// Щелчок выбирает без фокуса; щелчок по выбранному — ничего
		const clicks = h.picked.length;
		rows[2].fire('click');
		assert.deepEqual(h.picked[clicks], ['Краткий', true]);
		assert.equal(h.state().focusVariantRow, false);
		rows[1].fire('click');
		assert.equal(h.picked.length, clicks + 1, 'щелчок по выбранному варианту перерисовал вкладку');
		doc.body.textContent = '';
	});
});

describe('«Настройки»: дерево структуры с клавиатуры и пиктограммы над ним', () => {
	interface DragPayload {
		zone: string;
		key: string;
	}

	interface StructureZone {
		id: string;
		keyOf(row: Node): string | null;
		drag(key: string): string;
		pick(key: string): void;
		accept(payload: DragPayload): boolean;
		rowAccept(payload: DragPayload, key: string | null): boolean;
		place(payload: DragPayload): string;
		effect(payload: DragPayload): string;
		markRow(key: string, place: string): Node | null;
		from: Record<string, (payload: DragPayload, spot: { key: string; place: string }) => unknown>;
	}

	interface StructureHarness {
		host: Node;
		calls: string[];
		uiState: { nodePath: Array<{ list: string; index: number }>; expanded: Set<string> };
		zones: Array<{ node: Node; spec: StructureZone }>;
		replyFocus: { structure: boolean };
		rows(): Node[];
		state(): { focusStructureRow: boolean };
		renders: () => number;
		avail: Map<string, (key: string) => unknown>;
	}

	const SETTINGS = {
		structure: [
			{ kind: 'group', name: 'Склад', structure: [{ kind: 'group' }] },
			{ kind: 'table', name: 'Таблица', columns: [], rows: [{ kind: 'group' }] },
		],
	};

	function structure(nodePath: Array<{ list: string; index: number }>, expandedPaths: unknown[]): StructureHarness {
		const calls: string[] = [];
		const replyFocus = { structure: false };
		let renders = 0;
		const uiState = { nodePath, expanded: new Set(expandedPaths.map((p) => JSON.stringify(p))) };
		const code =
			'let focusStructureRow = false;\n' +
			NAME_HELPERS +
			topLine('PSEUDO_TITLES') +
			topLine('NODE_FIXED_NOTE') +
			topFunction('pathKey(path) {') +
			topFunction('isPseudoPath(path) {') +
			section('\t/**\n\t * Видимые строки дерева структуры по порядку', '\t/** Контекст добавления узла') +
			topFunction('nodeKindAt(settings, path) {') +
			topFunction('addTarget(settings, nodePath) {') +
			'\nfunction structureToolbar() { return el("div", "dcs-list-toolbar"); }\nreturn { renderStructureTree, settingsAvailNodes, state: () => ({ focusStructureRow }) };';
		const zones: Array<{ node: Node; spec: StructureZone }> = [];
		const api = new Function(
			'el',
			'document',
			'keyed',
			'focusKey',
			'uiState',
			'sectionBadges',
			'nodeLabel',
			'selectNode',
			'renderContent',
			'removeNode',
			'settingsNotice',
			'startSettingsWizard',
			'dragZone',
			'dropIndex',
			'nodeAt',
			'moveNode',
			'replyFocus',
			'settingsPickable',
			'openAddGroupDialog',
			withCoreAccessors(code)
		)(
			el,
			doc,
			keyed,
			focusKey,
			uiState,
			(node: { kind?: string; name?: string }) => (node.name === 'Склад' ? [{ text: 'О', hint: 'Отбор: 1' }] : []),
			(node: { kind?: string; name?: string }) => node.name || (node.kind === 'group' ? '<Детальные записи>' : node.kind),
			(path: unknown) => {
				calls.push('select:' + JSON.stringify(path));
				uiState.nodePath = path as typeof nodePath;
			},
			() => {
				renders++;
			},
			(variant: string, path: unknown) => calls.push('remove:' + variant + ':' + JSON.stringify(path)),
			(title: string, text: string) => calls.push('notice:' + title + ':' + text),
			() => calls.push('wizard'),
			(node: Node, spec: StructureZone) => {
				zones.push({ node, spec });
				return node;
			},
			DROP_INDEX,
			NODE_AT,
			(variant: string, path: unknown, newIndex: number) => {
				calls.push('move:' + variant + ':' + JSON.stringify(path) + ':' + newIndex);
				return true;
			},
			replyFocus,
			(node: { kind?: string } | null) => Boolean(node) && ['field', 'calc', 'total', 'dataParam', 'userField', 'system'].includes(String(node?.kind)),
			(_settings: unknown, variant: string, target: unknown, preset: string) => calls.push('group-dialog:' + variant + ':' + JSON.stringify(target) + ':' + preset)
		) as {
			renderStructureTree(host: Node, settings: unknown, variant: string): void;
			settingsAvailNodes: Map<string, (key: string) => unknown>;
			state(): { focusStructureRow: boolean };
		};
		const host = doc.body.appendChild(el('div'));
		api.renderStructureTree(host, SETTINGS, 'Основной');
		return {
			host,
			calls,
			uiState,
			zones,
			replyFocus,
			rows: () => host.find((node) => node.getAttribute('role') === 'treeitem'),
			state: api.state,
			renders: () => renders,
			avail: api.settingsAvailNodes,
		};
	}

	function section(from: string, to: string): string {
		const start = SCRIPT.indexOf(from);
		const end = SCRIPT.indexOf(to, start + from.length);
		assert.ok(start >= 0 && end > start, `нет раздела ${from}`);
		return SCRIPT.slice(start, end);
	}

	const S0 = [{ list: 'structure', index: 0 }];
	const T = [{ list: 'structure', index: 1 }];
	const ALL = [[], S0, T, T.concat([{ list: 'rows', index: -1 }])];

	test('строки: role treeitem, уровни, одна остановка Tab, раскрытость, имя для читалки — подпись, имя узла, бейджи словами', () => {
		const h = structure(S0, ALL);
		const tree = h.host.find((node) => node.getAttribute('role') === 'tree')[0];
		assert.equal(tree.getAttribute('aria-label'), 'Структура варианта');
		const rows = h.rows();
		const labels = rows.map((row) => row.find((c) => c.className === 'dcs-tree-label')[0].textContent);
		assert.deepEqual(labels, ['Отчет', 'Склад', '<Детальные записи>', 'Таблица', 'Колонки', 'Строки', '<Детальные записи>']);
		assert.deepEqual(rows.map((row) => row.getAttribute('aria-level')), ['1', '2', '3', '2', '3', '3', '4']);
		assert.deepEqual(rows.map((row) => row.tabIndex), [-1, 0, -1, -1, -1, -1, -1]);
		assert.deepEqual(rows.map((row) => row.getAttribute('aria-expanded')), ['true', 'true', null, 'true', null, 'true', null]);
		assert.equal(rows[1].getAttribute('aria-label'), 'Склад, Склад, Отбор: 1');
		assert.equal(rows[1].getAttribute('data-dcs-key'), 'node\n' + JSON.stringify(S0));
		// Галка использования только показывает use: читалка слышит его в имени строки, а не отдельным флажком
		assert.equal(rows[1].find((c) => c.tagName === 'INPUT')[0].getAttribute('aria-hidden'), 'true');
		doc.body.textContent = '';
	});

	test('клавиши: ↑ ↓ Home End — соседний узел с фокусом после перерисовки, → раскрывает и идёт к ребёнку, ← сворачивает и идёт к родителю, Delete — удаление', () => {
		// «Склад» свёрнут: строки — Отчет, Склад, Таблица, Колонки, Строки, группа строк
		let h = structure([], [[], T, T.concat([{ list: 'rows', index: -1 }])]);
		let rows = h.rows();
		assert.equal(rows.length, 6);
		assert.equal(rows[0].fire('keydown', { key: 'ArrowDown' }), true);
		assert.deepEqual(h.calls, ['select:' + JSON.stringify(S0)]);
		assert.equal(h.state().focusStructureRow, true);
		rows[0].fire('keydown', { key: 'End' });
		assert.equal(h.calls[1], 'select:' + JSON.stringify(T.concat([{ list: 'rows', index: 0 }])));
		rows[5].fire('keydown', { key: 'Home' });
		assert.equal(h.calls[2], 'select:[]');
		// ← у ребёнка — к родителю (у строки группы таблицы родитель — список «Строки»)
		rows[5].fire('keydown', { key: 'ArrowLeft' });
		assert.equal(h.calls[3], 'select:' + JSON.stringify(T.concat([{ list: 'rows', index: -1 }])));
		// → у свёрнутого — раскрывает, выбор и фокус — на нём
		rows[1].fire('keydown', { key: 'ArrowRight' });
		assert.ok(h.uiState.expanded.has(JSON.stringify(S0)));
		assert.deepEqual(h.uiState.nodePath, S0);
		assert.equal(h.renders(), 1);
		doc.body.textContent = '';
		h = structure(S0, ALL.concat([S0]));
		rows = h.rows();
		// → у раскрытого — к первому ребёнку; ← у раскрытого — сворачивает, выбор остаётся на нём
		rows[1].fire('keydown', { key: 'ArrowRight' });
		assert.equal(h.calls[0], 'select:' + JSON.stringify(S0.concat([{ list: 'structure', index: 0 }])));
		h.uiState.nodePath = S0;
		rows[1].fire('keydown', { key: 'ArrowLeft' });
		assert.equal(h.uiState.expanded.has(JSON.stringify(S0)), false);
		assert.deepEqual(h.uiState.nodePath, S0);
		// Delete: у узла — удаление, у «Отчета» и списка таблицы — причина
		rows[1].fire('keydown', { key: 'Delete' });
		rows[0].fire('keydown', { key: 'Delete' });
		rows[5].fire('keydown', { key: 'Delete' });
		assert.deepEqual(h.calls.slice(1), [
			'remove:Основной:' + JSON.stringify(S0),
			'notice:Удалить узел:Недоступно: «Отчет» и списки таблицы и диаграммы не удаляются.',
			'notice:Удалить узел:Недоступно: «Отчет» и списки таблицы и диаграммы не удаляются.',
		]);
		assert.equal(rows[1].fire('keydown', { key: 'x' }), false);
		doc.body.textContent = '';
	});

	test('перенос мышью: узел — источник, переставляется среди соседей той же правкой, что «Переместить узел выше/ниже»; к другому родителю, на список таблицы и «Отчет» — отказ', () => {
		// Строки: Отчет, Склад, его группа, Таблица, Колонки, Строки, группа строк
		const h = structure([], [[], S0, T, T.concat([{ list: 'rows', index: -1 }])]);
		assert.equal(h.zones.length, 1, 'зона — одна, у дерева');
		const zone = h.zones[0].spec;
		assert.equal(zone.id, 'struct');
		assert.equal(h.zones[0].node.getAttribute('aria-label'), 'Структура варианта');
		const rows = h.rows();
		const keys = rows.map((row) => zone.keyOf(row));
		const key = (path: unknown[]) => JSON.stringify(path);
		const NESTED = S0.concat([{ list: 'structure', index: 0 }]);
		const ROWS = T.concat([{ list: 'rows', index: -1 }]);
		const ROW0 = T.concat([{ list: 'rows', index: 0 }]);
		assert.deepEqual(keys, [key([]), key(S0), key(NESTED), key(T), key(T.concat([{ list: 'columns', index: -1 }])), key(ROWS), key(ROW0)]);
		assert.deepEqual(
			rows.map((row) => (row as unknown as { draggable?: boolean }).draggable === true),
			[false, true, true, true, false, false, true],
			'тащатся узлы, не «Отчет» и не списки таблицы'
		);
		assert.deepEqual(keys.map((k) => zone.drag(k as string)), ['', 'node', 'node', 'node', '', '', 'node']);
		assert.deepEqual(rows.map((row) => Object.keys((row as unknown as { listeners: Record<string, unknown> }).listeners).filter((type) => type.startsWith('drag') || type === 'drop')), rows.map(() => []), 'слушателей переноса у строк нет');
		// Соседи — в одном списке одного родителя
		const accept = (from: unknown[], to: unknown[] | null) => zone.rowAccept({ zone: 'struct', key: key(from) }, to === null ? null : key(to));
		assert.equal(accept(S0, T), true);
		assert.equal(accept(S0, NESTED), false, 'вложенный узел — другой родитель');
		assert.equal(accept(NESTED, S0), false);
		assert.equal(accept(S0, []), false, '«Отчет»');
		assert.equal(accept(ROW0, ROWS), false, 'список «Строки»');
		assert.equal(accept(ROW0, T), false);
		assert.equal(accept(S0, null), false, 'мимо строк');
		// Сброс: одна правка с новым номером, после ответа — фокус на узле; на своё место — правки нет
		assert.equal(zone.from.struct({ zone: 'struct', key: key(S0) }, { key: key(T), place: 'before' }), false);
		assert.deepEqual(h.calls, []);
		zone.from.struct({ zone: 'struct', key: key(S0) }, { key: key(T), place: 'after' });
		assert.deepEqual(h.calls, ['move:Основной:' + key(S0) + ':1']);
		assert.equal(h.replyFocus.structure, true);
		// Строку, которую тащили без сброса, выбирает щелчковый путь
		zone.pick(key(T));
		assert.equal(h.calls[1], 'select:' + key(T));
		// Линия «после» раскрытого узла — под его последним видимым потомком (туда узел и встанет), «до» и у свёрнутого — у
		// самой строки (null)
		assert.equal(zone.markRow(key(S0), 'after'), rows[2], '«Склад» раскрыт: линия под его вложенной группой');
		assert.equal(zone.markRow(key(T), 'after'), rows[6], 'таблица: под последней строкой её списков');
		assert.equal(zone.markRow(key(S0), 'before'), null);
		assert.equal(zone.markRow(key(NESTED), 'after'), null, 'без детей');
		assert.equal(zone.place({ zone: 'struct', key: key(S0) }), 'line');
		assert.equal(zone.effect({ zone: 'struct', key: key(S0) }), 'move');
		doc.body.textContent = '';
	});

	test('поле из «Доступных полей» на дерево структуры — то же окно «Новая группировка», что пиктограмма при выбранном узле, с полем', () => {
		const h = structure([], [[], S0, T, T.concat([{ list: 'rows', index: -1 }])]);
		const zone = h.zones[0].spec;
		const key = (path: unknown[]) => JSON.stringify(path);
		const nodes: Record<string, { kind: string; path: string; restrict?: Record<string, boolean> }> = {
			склад: { kind: 'field', path: 'Склад' },
			сумма: { kind: 'total', path: 'Сумма' },
			запрет: { kind: 'field', path: 'Запрет', restrict: { group: true } },
			папка: { kind: 'folder', path: 'Папка' },
		};
		h.avail.set('setavail:filter', (k: string) => nodes[k] || null);
		const field = (k: string) => ({ zone: 'setavail:filter', key: k });
		// Зона принимает поле, по которому можно группировать; ресурс, запрет группировки и папку — нет; чужие панели — нет
		assert.equal(zone.accept(field('склад')), true);
		assert.equal(zone.accept(field('сумма')), false, 'по ресурсу не группируют');
		assert.equal(zone.accept(field('запрет')), false, 'ограничение использования');
		assert.equal(zone.accept(field('папка')), false);
		assert.equal(zone.accept({ zone: 'setavail:order', key: 'склад' }), false, 'дерево панели, которой нет на экране');
		assert.equal(zone.place(field('склад')), 'into');
		assert.equal(zone.effect(field('склад')), 'copy');
		// Узлы: «Отчет», группировка и списки таблицы принимают группировку; таблица сама — нет
		const ROWS = T.concat([{ list: 'rows', index: -1 }]);
		const ROW0 = T.concat([{ list: 'rows', index: 0 }]);
		assert.deepEqual(
			[[], S0, T, ROWS, ROW0].map((path) => zone.rowAccept(field('склад'), key(path))),
			[true, true, false, true, true]
		);
		assert.equal(zone.rowAccept(field('склад'), null), false, 'мимо строк');
		// Сброс — окно с узлом сброса (не выбранным) и полем
		zone.from['setavail:filter'](field('склад'), { key: key(ROWS), place: 'into' });
		assert.deepEqual(h.calls, ['group-dialog:Основной:' + JSON.stringify({ parentPath: T, list: 'rows', kinds: ['group'] }) + ':Склад']);
		zone.from['setavail:filter'](field('склад'), { key: key([]), place: 'into' });
		assert.equal(h.calls[1], 'group-dialog:Основной:' + JSON.stringify({ parentPath: [], list: 'structure', kinds: ['group', 'table', 'chart'] }) + ':Склад');
		assert.equal(zone.from['setavail:filter'](field('склад'), { key: key(T), place: 'into' }), false, 'в таблицу — некуда');
		assert.equal(h.calls.length, 2);
		doc.body.textContent = '';
	});

	test('свёрнутый узел забирает выделение у скрытого внутри него (и у строк списка таблицы)', () => {
		const code = topFunction('isPseudoPath(path) {') + topFunction('isUnderPath(path, under) {') + '\nreturn isUnderPath;';
		const isUnderPath = new Function(code)() as (path: unknown[], under: unknown[]) => boolean;
		const rowsList = T.concat([{ list: 'rows', index: -1 }]);
		assert.equal(isUnderPath(S0.concat([{ list: 'structure', index: 0 }]), S0), true);
		assert.equal(isUnderPath(T.concat([{ list: 'rows', index: 0 }]), rowsList), true, 'группа строк — внутри списка «Строки»');
		assert.equal(isUnderPath(T.concat([{ list: 'rows', index: 0 }, { list: 'structure', index: 0 }]), rowsList), true, 'вложенная группа строк');
		assert.equal(isUnderPath(rowsList, rowsList), false, 'список — не внутри себя');
		assert.equal(isUnderPath(T.concat([{ list: 'columns', index: 0 }]), rowsList), false);
		assert.equal(isUnderPath(S0, S0), false);
		assert.equal(isUnderPath(T, S0), false);
		assert.equal(isUnderPath(S0, []), true);
	});

	test('пиктограммы над деревом: что допустимо в выделенном узле, выше и ниже у края, удалить — с причинами недоступности', () => {
		const settings = {
			structure: [
				{ kind: 'group', structure: [] },
				{ kind: 'table', columns: [], rows: [{ kind: 'group' }] },
			],
		};
		const calls: string[] = [];
		const uiState = { nodePath: [] as unknown[] };
		const code =
			topLine('ADD_NODE_NOTE') +
			topLine('ADD_GROUP_ONLY_NOTE') +
			topLine('NODE_PICK_NOTE') +
			topLine('NODE_FIXED_NOTE') +
			topFunction('isPseudoPath(path) {') +
			topFunction('nodeAt(settings, path) {') +
			topFunction('nodeKindAt(settings, path) {') +
			topFunction('addTarget(settings, nodePath) {') +
			topFunction('structureToolbar(settings, variantName) {') +
			'\nreturn structureToolbar;';
		const toolbar = new Function('el', 'keyed', 'focusKey', 'iconButton', 'uiState', 'settingsNotice', 'openAddGroupDialog', 'addStructureItem', 'setStatus', 'BUSY', 'moveNode', 'removeNode', code)(
			el,
			keyed,
			focusKey,
			iconButtonStub,
			uiState,
			(title: string, text: string) => calls.push('notice:' + title + ':' + text),
			(_s: unknown, _v: string, target: { kinds: string[] }) => calls.push('group:' + target.kinds.join(',')),
			(_s: unknown, _v: string, target: { list: string }, kind: string) => {
				calls.push('add:' + target.list + ':' + kind);
				return true;
			},
			() => calls.push('status'),
			'busy',
			(_v: string, path: unknown, index: number) => calls.push('move:' + JSON.stringify(path) + ':' + index),
			(_v: string, path: unknown) => calls.push('remove:' + JSON.stringify(path))
		) as (s: unknown, v: string) => Node;
		const notes = (bar: Node): Array<[string | null, string | null]> => bar.children.map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-description')]);
		// Корень: добавить можно всё, двигать и удалять нельзя
		let bar = toolbar(settings, 'Основной');
		assert.deepEqual(notes(bar), [
			['Новая группировка…', null],
			['Новая таблица', null],
			['Новая диаграмма', null],
			['Переместить узел выше', 'Выберите группировку, таблицу или диаграмму.'],
			['Переместить узел ниже', 'Выберите группировку, таблицу или диаграмму.'],
			['Удалить узел', '«Отчет» и списки таблицы и диаграммы не удаляются.'],
		]);
		assert.deepEqual(bar.children.map((b) => b.getAttribute('data-icon')), ['group', 'table', 'chart', 'up', 'down', 'delete']);
		assert.deepEqual(bar.children.map((b) => b.getAttribute('data-dcs-key')), ['group', 'table', 'chart', 'up', 'down', 'delete'].map((id) => 'structool\n' + id));
		bar.children[1].fire('click');
		bar.children[0].fire('click');
		bar.children[5].fire('click');
		assert.deepEqual(calls, ['add:structure:table', 'group:group,table,chart', 'notice:Удалить узел:Недоступно: «Отчет» и списки таблицы и диаграммы не удаляются.']);
		// Первая группировка: выше нельзя, ниже — на одну позицию
		uiState.nodePath = [{ list: 'structure', index: 0 }];
		bar = toolbar(settings, 'Основной');
		assert.equal(notes(bar)[3][1], 'Узел уже первый.');
		assert.equal(notes(bar)[4][1], null);
		bar.children[4].fire('click');
		assert.equal(calls[calls.length - 1], 'move:' + JSON.stringify(uiState.nodePath) + ':1');
		// Последний узел — ниже нельзя; у таблицы добавлять некуда
		uiState.nodePath = [{ list: 'structure', index: 1 }];
		bar = toolbar(settings, 'Основной');
		assert.equal(notes(bar)[4][1], 'Узел уже последний.');
		assert.equal(notes(bar)[0][1], 'Узлы добавляются в «Отчет», в группировку и в списки таблицы и диаграммы.');
		// Список таблицы и группа в нём — только группировки
		uiState.nodePath = [{ list: 'structure', index: 1 }, { list: 'rows', index: -1 }];
		bar = toolbar(settings, 'Основной');
		assert.deepEqual(notes(bar).slice(0, 3).map((n) => n[1]), [null, 'В таблице и диаграмме бывают только группировки.', 'В таблице и диаграмме бывают только группировки.']);
		uiState.nodePath = [{ list: 'structure', index: 1 }, { list: 'rows', index: 0 }];
		bar = toolbar(settings, 'Основной');
		assert.equal(notes(bar)[1][1], 'В таблице и диаграмме бывают только группировки.');
		assert.equal(notes(bar)[5][1], 'Клавиша в списке: Delete', 'группу строк удалить нельзя');
	});
});

describe('«Настройки»: списки «Выбранных полей», «Отбора» и «Сортировки»', () => {
	interface ListHelpers {
		flattenItems(items: unknown[], nested: (item: { kind: string }) => boolean): Array<{ pos: number[]; depth: number; item: { kind: string }; first: boolean; last: boolean; container: boolean }>;
		levelItems(items: unknown[], pos: number[]): unknown[];
		insertionParent(row: { pos: number[]; item: unknown } | null, isContainer: (item: { kind: string }) => boolean): number[];
		insertionNote(row: { pos: number[]; item: unknown } | null, isContainer: (item: { kind: string }) => boolean, items: unknown[], ownerName: (item: { title?: string }) => string): string;
		posAfterRemoval(items: unknown[], pos: number[]): number[];
		listMoveNote(row: { first: boolean; last: boolean; depth: number } | null, delta: number, place: string): string;
		rememberListRow(stateKey: string, pos: number[] | null, index?: number): void;
		clearListRow(stateKey: string, index: number): void;
		listSelection(stateKey: string, rows: Array<{ pos: number[] }>): number;
		listStateKey(variant: string, path: unknown[], panel: string): string;
		settingsListUi: Map<string, { key: string; index: number; none?: boolean }>;
	}

	function helpers(): ListHelpers {
		const code =
			'const settingsListUi = new Map();\n' +
			topLine('LIST_EMPTY_NOTE') +
			topFunction('pathKey(path) {') +
			topFunction('listStateKey(variantName, path, panelId) {') +
			topFunction('posKey(pos) {') +
			topFunction('rememberListRow(stateKey, pos, index) {') +
			topFunction('clearListRow(stateKey, index) {') +
			topFunction('listSelection(stateKey, rows) {') +
			topFunction('flattenItems(items, nested) {') +
			topFunction('levelItems(items, pos) {') +
			topFunction('insertionParent(row, isContainer) {') +
			topFunction('selItemAt(items, pos) {') +
			topFunction('insertionNote(row, isContainer, items, ownerName) {') +
			topFunction('posAfterRemoval(items, pos) {') +
			topFunction('listMoveNote(row, delta, place) {') +
			'\nreturn { flattenItems, levelItems, insertionParent, insertionNote, posAfterRemoval, listMoveNote, rememberListRow, clearListRow, listSelection, listStateKey, settingsListUi };';
		return new Function(code)() as ListHelpers;
	}

	const isFolder = (item: { kind: string }): boolean => item.kind === 'folder';

	test('строки по дереву элементов: папки раскрыты, адрес, глубина, края уровня', () => {
		const h = helpers();
		const rows = h.flattenItems(SAMPLE_SELECTION, isFolder);
		assert.deepEqual(
			rows.map((row) => [row.pos, row.depth, row.first, row.last]),
			[
				[[0], 0, true, false],
				[[1], 0, false, false],
				[[1, 0], 1, true, false],
				[[1, 1], 1, false, true],
				[[2], 0, false, true],
			]
		);
		assert.deepEqual(h.flattenItems(SAMPLE_SELECTION, () => false).map((row) => row.pos), [[0], [1], [2]], 'плоский список (сортировка)');
		assert.equal(h.levelItems(SAMPLE_SELECTION, [1, 1]), (SAMPLE_SELECTION[1] as { items: unknown[] }).items);
	});

	test('куда встаёт новый элемент: в выбранную папку (группу), иначе — на уровень выбранной строки; без строк — на верхний уровень', () => {
		const h = helpers();
		const rows = h.flattenItems(SAMPLE_SELECTION, isFolder);
		assert.deepEqual(h.insertionParent(rows[1], isFolder), [1], 'выбрана папка — в неё');
		assert.deepEqual(h.insertionParent(rows[2], isFolder), [1], 'строка в папке — в ту же папку');
		assert.deepEqual(h.insertionParent(rows[0], isFolder), []);
		assert.deepEqual(h.insertionParent(null, isFolder), [], 'выбор снят — на верхний уровень');
		assert.ok(topFunction('renderFilterPanel(host, node, path, variantName) {').includes('const parentPos = insertionParent(row, isGroup);'), 'у отбора контейнер — не группа условий');
		// Пояснение у пиктограмм добавления: куда встанет, если не на верхний уровень, и как добавить на верхний
		const owner = (folder: { title?: string }): string => 'папку «' + (folder.title || '') + '»';
		assert.equal(h.insertionNote(rows[1], isFolder, SAMPLE_SELECTION, owner), 'Встанет в папку «Суммы». Чтобы добавить на верхний уровень, нажмите Esc в списке.');
		assert.equal(h.insertionNote(rows[3], isFolder, SAMPLE_SELECTION, owner), 'Встанет в папку «Суммы». Чтобы добавить на верхний уровень, нажмите Esc в списке.');
		assert.equal(h.insertionNote(rows[0], isFolder, SAMPLE_SELECTION, owner), '');
		assert.equal(h.insertionNote(null, isFolder, SAMPLE_SELECTION, owner), '');
	});

	test('выбор после удаления — следующая строка на месте удалённой, иначе предыдущая, иначе владелец; причины выше и ниже у края', () => {
		const h = helpers();
		assert.deepEqual(h.posAfterRemoval(SAMPLE_SELECTION, [0]), [0]);
		assert.deepEqual(h.posAfterRemoval(SAMPLE_SELECTION, [2]), [1]);
		assert.deepEqual(h.posAfterRemoval(SAMPLE_SELECTION, [1, 1]), [1, 0]);
		assert.deepEqual(h.posAfterRemoval([{ kind: 'folder', items: [{ kind: 'auto' }] }], [0, 0]), [0]);
		assert.deepEqual(h.posAfterRemoval([{ kind: 'auto' }], [0]), [], 'последняя строка — выбора нет');
		const rows = h.flattenItems(SAMPLE_SELECTION, isFolder);
		assert.equal(h.listMoveNote(rows[0], -1, 'папке'), 'Недоступно: строка уже первая.');
		assert.equal(h.listMoveNote(rows[0], 1, 'папке'), '');
		assert.equal(h.listMoveNote(rows[2], -1, 'папке'), 'Недоступно: строка уже первая в папке.');
		assert.equal(h.listMoveNote(rows[3], 1, 'группе'), 'Недоступно: строка уже последняя в группе.');
		assert.equal(h.listMoveNote(null, 1, ''), 'Недоступно: список пуст.');
	});

	test('выбранная строка переживает перерисовку: по адресу, иначе по номеру (у края — последняя); состояние на вариант, узел и панель', () => {
		const h = helpers();
		const rows = h.flattenItems(SAMPLE_SELECTION, isFolder);
		const key = h.listStateKey('Основной', [{ list: 'structure', index: 0 }], 'selection');
		assert.equal(key, 'Основной\n[{"list":"structure","index":0}]\nselection');
		assert.equal(h.listSelection(key, rows), 0, 'без выбора — первая');
		h.rememberListRow(key, [1, 1], 3);
		assert.equal(h.listSelection(key, rows), 3);
		h.rememberListRow(key, [7], 2);
		assert.equal(h.listSelection(key, rows), 2, 'адреса нет — номер');
		h.rememberListRow(key, [7]);
		assert.equal(h.listSelection(key, rows), 4, 'новый элемент без номера — последняя строка');
		assert.equal(h.listSelection(key, []), -1);
		h.rememberListRow(key, []);
		assert.equal(h.settingsListUi.has(key), false, 'пустой адрес — выбор забыт');
		// Снятый выбор переживает перерисовку: строк не выбрано, остановка Tab — запомненная строка
		h.clearListRow(key, 2);
		assert.equal(h.listSelection(key, rows), -1);
		assert.deepEqual(h.settingsListUi.get(key), { key: '', index: 2, none: true });
		h.rememberListRow(key, [0], 0);
		assert.equal(h.listSelection(key, rows), 0, 'новый выбор не вернулся');
	});

	interface GridHarness {
		host: Node;
		table: Node | undefined;
		rows(): Node[];
		calls: string[];
		api: { settingsListUi: Map<string, { key: string; index: number; none?: boolean }>; setFocusList(id: string): void; focusList(): string };
		build(rowsData: unknown[], useResult?: boolean): { selected(): { pos: number[] } | null };
	}

	/** settingsListGrid как есть: кнопка строки (actionsCell), пустой список и фокус по ключу — заглушки. */
	function grid(): GridHarness {
		const calls: string[] = [];
		const code =
			'const settingsListUi = new Map();\nlet focusListPanel = "";\n' +
			topFunction('posKey(pos) {') +
			topFunction('rememberListRow(stateKey, pos, index) {') +
			topFunction('clearListRow(stateKey, index) {') +
			topFunction('listSelection(stateKey, rows) {') +
			NAME_HELPERS +
			topFunction('cell(tr, text, className) {') +
			topLine('ROW_CONTROL_TAGS') +
			topFunction('settingsListGrid(host, spec) {') +
			topFunction('focusGridRow(tr) {') +
			'\nreturn { settingsListGrid, settingsListUi, setFocusList: (id) => { focusListPanel = id; }, focusList: () => focusListPanel };';
		const api = new Function('el', 'document', 'keyed', 'focusKey', 'actionsCell', 'emptyNote', 'focusKeyed', withCoreAccessors(code))(
			el,
			doc,
			keyed,
			focusKey,
			(tr: Node, actions: Array<{ title: string; key?: string; onClick: () => void }>) => {
				const td = tr.appendChild(el('td', 'dcs-cell-actions'));
				for (const action of actions) {
					const button = td.appendChild(el('button'));
					button.setAttribute('aria-label', action.title);
					if (action.key) {
						keyed(button, action.key);
					}
					button.addEventListener('click', action.onClick);
				}
			},
			(host: Node, text: string) => host.appendChild(el('div', 'dcs-empty', text)),
			(key: string) => calls.push('focus:' + key)
		) as { settingsListGrid(host: Node, spec: Record<string, unknown>): { selected(): { pos: number[] } | null } } & GridHarness['api'];
		const out = {
			host: doc.body.appendChild(el('div')),
			table: undefined as Node | undefined,
			rows: (): Node[] => (out.table ? out.table.find((node) => node.tagName === 'TR' && node.parentElement?.tagName === 'TBODY') : []),
			calls,
			api,
			build: (rowsData: unknown[], useResult = true) => {
				out.host.textContent = '';
				const made = api.settingsListGrid(out.host, {
					id: 'selection',
					label: 'Выбранные поля',
					tree: true,
					headers: ['', 'Поле / элемент', ''],
					rows: rowsData,
					stateKey: 'k',
					cells: (tr: Node, row: { item: { field?: string; kind: string } }) => {
						tr.appendChild(el('td', '', row.item.field || row.item.kind));
					},
					rowLabel: (row: { item: { field?: string; kind: string } }) => 'строка ' + (row.item.field || row.item.kind),
					useLabel: (row: { item: { field?: string; kind: string } }) => row.item.field || row.item.kind,
					onUse: (row: { pos: number[] }, checked: boolean) => {
						calls.push('use:' + JSON.stringify(row.pos) + ':' + checked);
						return useResult;
					},
					editable: (row: { item: { kind: string } }) => row.item.kind !== 'auto',
					onEdit: (row: { pos: number[] }) => calls.push('edit:' + JSON.stringify(row.pos)),
					onDelete: (row: { pos: number[] }, fromGrid: boolean) => calls.push('delete:' + JSON.stringify(row.pos) + ':' + fromGrid),
					onSelect: (row: { pos: number[] } | null) => calls.push('select:' + (row ? JSON.stringify(row.pos) : 'null')),
					empty: 'Выбранных полей нет.',
				});
				out.table = out.host.find((node) => node.tagName === 'TABLE')[0];
				return made;
			},
		};
		return out;
	}

	test('сетка: treegrid с уровнями, одна остановка Tab, флажок и кнопка — в обходе Tab только у выбранной строки, имена для читалки', () => {
		const g = grid();
		const made = g.build(helpers().flattenItems(SAMPLE_SELECTION, isFolder));
		assert.equal(g.table?.getAttribute('role'), 'treegrid');
		assert.equal(g.table?.getAttribute('aria-label'), 'Выбранные поля');
		assert.deepEqual(g.table?.find((node) => node.getAttribute('role') === 'columnheader').map((th) => th.getAttribute('aria-label')), ['Использовать', null, 'Команды строки']);
		const rows = g.rows();
		assert.deepEqual(rows.map((tr) => tr.getAttribute('aria-level')), ['1', '1', '2', '2', '1']);
		assert.deepEqual(rows.map((tr) => tr.tabIndex), [0, -1, -1, -1, -1]);
		assert.deepEqual(rows.map((tr) => tr.getAttribute('data-dcs-key')), ['[0]', '[1]', '[1,0]', '[1,1]', '[2]'].map((pos) => 'setrow\nselection\n' + pos));
		const controls = (tr: Node): Node[] => tr.find((node) => node.tagName === 'INPUT' || node.tagName === 'BUTTON');
		assert.deepEqual(rows.map((tr) => controls(tr).map((c) => c.tabIndex)), [[0, 0], [-1, -1], [-1, -1], [-1], [-1]], 'у «Авто» нет кнопки «Править»');
		const box = controls(rows[0])[0];
		assert.equal(box.getAttribute('aria-label'), 'Использовать: Склад');
		assert.equal(box.getAttribute('data-dcs-key'), 'setuse\nselection\n[0]');
		assert.equal(controls(rows[0])[1].getAttribute('data-dcs-key'), 'setedit\nselection\n[0]');
		assert.ok(rows.every((tr) => tr.children.every((td) => td.getAttribute('role') === 'gridcell')));
		assert.deepEqual(g.calls, ['select:[0]'], 'панель пиктограмм не узнала о выборе');
		assert.deepEqual(made.selected()?.pos, [0]);
		doc.body.textContent = '';
	});

	test('сетка: стрелки, Home, End — выбор и фокус без перерисовки; Enter — окно; пробел — флажок; Delete — удаление; фокус в флажок переносит остановку', () => {
		const g = grid();
		const made = g.build(helpers().flattenItems(SAMPLE_SELECTION, isFolder));
		const rows = g.rows();
		rows[0].focus();
		assert.equal(rows[0].fire('keydown', { key: 'ArrowDown', target: rows[0] }), true);
		assert.equal(g.rows()[0], rows[0], 'стрелка перерисовала список');
		assert.equal(doc.activeElement, rows[1]);
		assert.deepEqual(rows.map((tr) => tr.tabIndex), [-1, 0, -1, -1, -1]);
		assert.deepEqual(g.api.settingsListUi.get('k'), { key: '[1]', index: 1 });
		assert.deepEqual(made.selected()?.pos, [1]);
		rows[1].fire('keydown', { key: 'End', target: rows[1] });
		assert.equal(doc.activeElement, rows[4]);
		rows[4].fire('keydown', { key: 'ArrowDown', target: rows[4] });
		assert.equal(doc.activeElement, rows[4], 'край списка');
		rows[4].fire('keydown', { key: 'Home', target: rows[4] });
		assert.equal(doc.activeElement, rows[0]);
		rows[0].fire('keydown', { key: 'ArrowUp', target: rows[0] });
		assert.equal(doc.activeElement, rows[0]);
		g.calls.length = 0;
		assert.equal(rows[0].fire('keydown', { key: 'Enter', target: rows[0] }), true);
		rows[4].fire('keydown', { key: 'Enter', target: rows[4] });
		rows[0].fire('dblclick', { target: rows[0].children[1] });
		rows[0].fire('dblclick', { target: rows[0].children[0].children[0] });
		// Enter на строке с фокусом выбирает её (панель пиктограмм — за ней); у «Авто» окна нет
		assert.deepEqual(g.calls, ['edit:[0]', 'select:[2]', 'edit:[0]'], 'у «Авто» открылось окно или двойной щелчок по флажку открыл окно строки');
		g.calls.length = 0;
		const box = rows[0].find((node) => node.tagName === 'INPUT')[0];
		box.checked = true;
		assert.equal(rows[0].fire('keydown', { key: ' ', target: rows[0] }), true);
		assert.equal(box.checked, false);
		assert.equal(rows[0].fire('keydown', { key: 'Delete', target: rows[0] }), true);
		assert.deepEqual(g.calls, ['select:[0]', 'use:[0]:false', 'delete:[0]:true']);
		// Клавиши флажка и уже обработанные — не сетки
		assert.equal(rows[0].fire('keydown', { key: 'ArrowDown', target: box }), false);
		assert.equal(rows[0].fire('keydown', { key: 'ArrowDown', target: rows[0], defaultPrevented: true }), false);
		// Флажок: отказ правки возвращает галку
		box.checked = false;
		box.fire('change');
		g.calls.length = 0;
		const refused = grid();
		refused.build(helpers().flattenItems(SAMPLE_SELECTION, isFolder), false);
		const refusedBox = refused.rows()[0].find((node) => node.tagName === 'INPUT')[0];
		refusedBox.checked = false;
		refusedBox.fire('change');
		assert.equal(refusedBox.checked, true, 'отказ правки не вернул галку');
		// Фокус в флажок другой строки щелчком — остановка Tab переезжает туда
		rows[2].fire('focusin', { target: rows[2].find((node) => node.tagName === 'INPUT')[0] });
		assert.deepEqual(rows.map((tr) => tr.tabIndex), [-1, -1, 0, -1, -1]);
		rows[3].fire('click', { target: rows[3].children[1] });
		assert.equal(rows[3].tabIndex, 0);
		doc.body.textContent = '';
	});

	test('сетка для читалки: имя строки (и «не используется»), у папки с вложенными aria-expanded, ← — к владельцу, → — к первому вложенному', () => {
		const g = grid();
		const items: unknown[] = [{ kind: 'field', field: 'Склад', use: false }, ...SAMPLE_SELECTION.slice(1)];
		g.build(helpers().flattenItems(items, isFolder));
		const rows = g.rows();
		assert.deepEqual(
			rows.map((tr) => tr.getAttribute('aria-label')),
			['строка Склад, не используется', 'строка folder', 'строка Сумма', 'строка auto', 'строка auto']
		);
		assert.deepEqual(rows.map((tr) => tr.getAttribute('aria-expanded')), [null, 'true', null, null, null], 'папка без признака вложенных');
		// Пустая папка — не контейнер для читалки
		assert.equal(helpers().flattenItems([{ kind: 'folder', items: [] }], isFolder)[0].container, false);
		rows[2].focus();
		assert.equal(rows[2].fire('keydown', { key: 'ArrowLeft', target: rows[2] }), true);
		assert.equal(doc.activeElement, rows[1], '← не к папке');
		assert.equal(rows[1].fire('keydown', { key: 'ArrowRight', target: rows[1] }), true);
		assert.equal(doc.activeElement, rows[2], '→ не к первому вложенному');
		// ← на верхнем уровне и → у строки без вложенных — не наши клавиши
		assert.equal(rows[0].fire('keydown', { key: 'ArrowLeft', target: rows[0] }), false);
		assert.equal(rows[2].fire('keydown', { key: 'ArrowRight', target: rows[2] }), false);
		doc.body.textContent = '';
	});

	test('сетка: выбор и фокус после перерисовки (удаление клавишей), пустой список — текст и фокус на «Удалить»', () => {
		const g = grid();
		g.api.settingsListUi.set('k', { key: '[2]', index: 4 });
		g.api.setFocusList('k');
		g.build(helpers().flattenItems(SAMPLE_SELECTION, isFolder));
		assert.equal(doc.activeElement, g.rows()[4], 'фокус не на выбранной строке');
		assert.equal(g.api.focusList(), '');
		g.api.setFocusList('Другой\n[]\nselection');
		g.build(helpers().flattenItems(SAMPLE_SELECTION, isFolder));
		assert.equal(g.api.focusList(), 'Другой\n[]\nselection', 'список другого узла или варианта (тот же id панели) забрал фокус');
		g.api.setFocusList('k');
		const empty = g.build([]);
		assert.equal(empty.selected(), null);
		assert.equal(g.host.find((node) => node.className === 'dcs-empty')[0].textContent, 'Выбранных полей нет.');
		assert.deepEqual(g.calls.slice(-1), ['focus:nodetool\nselection\ndelete']);
		doc.body.textContent = '';
	});

	test('сетка: выбор снимается Escape, щелчком под строками и Ctrl+щелчком по выбранной; остановка Tab остаётся, снятый выбор переживает перерисовку', () => {
		const g = grid();
		const rowsData = helpers().flattenItems(SAMPLE_SELECTION, isFolder);
		let made = g.build(rowsData);
		let rows = g.rows();
		rows[0].fire('keydown', { key: 'ArrowDown', target: rows[0] });
		g.calls.length = 0;
		// Escape: выбора нет, панель пиктограмм узнала об этом, фокус и остановка Tab — на той же строке
		assert.equal(rows[1].fire('keydown', { key: 'Escape', target: rows[1] }), true);
		assert.equal(made.selected(), null);
		assert.deepEqual(g.calls, ['select:null']);
		assert.deepEqual(rows.map((tr) => tr.getAttribute('aria-selected')), ['false', 'false', 'false', 'false', 'false']);
		assert.deepEqual(rows.map((tr) => tr.tabIndex), [-1, 0, -1, -1, -1]);
		assert.ok(rows.every((tr) => !tr.classList.contains('dcs-tree-selected')));
		assert.deepEqual(g.api.settingsListUi.get('k'), { key: '', index: 1, none: true });
		// Без выбора Escape не наш — его разбирают окна выше
		assert.equal(rows[1].fire('keydown', { key: 'Escape', target: rows[1] }), false);
		// Перерисовка: выбор так и снят, остановка — та же строка; фокус на самой строке выбор не возвращает
		made = g.build(rowsData);
		rows = g.rows();
		assert.equal(made.selected(), null);
		assert.deepEqual(rows.map((tr) => tr.tabIndex), [-1, 0, -1, -1, -1]);
		assert.deepEqual(g.calls.slice(-1), ['select:null']);
		rows[1].fire('focusin', { target: rows[1] });
		assert.equal(made.selected(), null, 'фокус на строке вернул выбор');
		// Стрелка выбирает соседнюю строку
		rows[1].fire('keydown', { key: 'ArrowDown', target: rows[1] });
		assert.deepEqual(made.selected()?.pos, [1, 0]);
		// Щелчок по пустому месту под строками — выбор снят, остановка — бывшая выбранная
		const wrap = g.table?.parentElement as Node;
		wrap.fire('click', { target: wrap });
		assert.equal(made.selected(), null);
		assert.deepEqual(rows.map((tr) => tr.tabIndex), [-1, -1, 0, -1, -1]);
		// Ctrl+щелчок по невыбранной строке выбирает, по выбранной — снимает
		rows[3].fire('click', { target: rows[3].children[1], ctrlKey: true });
		assert.deepEqual(made.selected()?.pos, [1, 1]);
		rows[3].fire('click', { target: rows[3].children[1], ctrlKey: true });
		assert.equal(made.selected(), null);
		// Клавиши действия на строке с фокусом без выбора выбирают её: панель пиктограмм идёт за ней
		g.calls.length = 0;
		rows[3].fire('keydown', { key: 'Delete', target: rows[3] });
		assert.deepEqual(g.calls, ['select:[1,1]', 'delete:[1,1]:true']);
		// Удаление клавишей при снятом выборе: фокус после ответа — на остановке Tab
		g.api.settingsListUi.set('k', { key: '', index: 2, none: true });
		g.api.setFocusList('k');
		g.build(rowsData);
		assert.equal(doc.activeElement, g.rows()[2]);
		doc.body.textContent = '';
	});

	test('панель пиктограмм списка: недоступность и причина пересчитываются при выборе без перерисовки, щелчок недоступной называет причину', () => {
		const calls: string[] = [];
		const code = topFunction('shortcutSpoken(shortcut) {') + topFunction('spokenReason(note, unavailable) {') + topFunction('setIconState(node, name, shortcut, unavailable, note) {') + topFunction('settingsListToolbar(host, panelId, tools) {') + '\nreturn settingsListToolbar;';
		const toolbarOf = new Function('el', 'keyed', 'focusKey', 'iconButton', 'settingsNotice', code)(el, keyed, focusKey, iconButtonStub, (title: string, text: string) =>
			calls.push('notice:' + title + ':' + text)
		) as (host: Node, id: string, tools: unknown[]) => { sync(row: unknown): void };
		const host = el('div');
		const bar = toolbarOf(host, 'order', [
			{ id: 'auto', icon: 'auto', name: 'Добавить «Авто»', hint: 'Пояснение.', run: () => calls.push('auto') },
			{ id: 'delete', icon: 'delete', name: 'Удалить', shortcut: 'Delete', danger: true, state: (row: unknown) => (row ? '' : 'Недоступно: список пуст.'), run: (row: { n: number }) => calls.push('delete:' + row.n) },
		]);
		const [auto, remove] = host.children[0].children;
		assert.equal(auto.getAttribute('data-dcs-key'), 'nodetool\norder\nauto');
		assert.equal(remove.className, 'ghost-btn dcs-btn-small dcs-btn-danger dcs-icon-btn');
		bar.sync(null);
		assert.equal(remove.getAttribute('aria-disabled'), 'true');
		assert.equal(remove.getAttribute('aria-description'), 'Список пуст.');
		assert.equal(remove.title, 'Удалить (Delete)\nНедоступно: список пуст.');
		assert.equal(auto.getAttribute('aria-disabled'), null);
		assert.equal(auto.title, 'Добавить «Авто»\nПояснение.');
		remove.fire('click');
		bar.sync({ n: 2 });
		assert.equal(remove.getAttribute('aria-disabled'), null);
		assert.equal(remove.getAttribute('aria-description'), 'Клавиша в списке: Delete', 'без пояснения описанием стал бы title с именем и клавишей');
		assert.equal(remove.title, 'Удалить (Delete)');
		remove.fire('click');
		auto.fire('click');
		assert.deepEqual(calls, ['notice:Удалить:Недоступно: список пуст.', 'delete:2', 'auto']);
	});

	test('«Доступные поля» — тот же каталог, что у окна поля раздела; выбираются поля, ресурсы, параметры, системные и пользовательские, а не папки', () => {
		assert.ok(topFunction('settingsFieldNodes(section) {').includes("completionCatalog('settings:' + section).nodes"));
		assert.ok(topFunction('attachFieldList(input, section) {').includes("'settings:' + (section || 'any')"), 'окно поля берёт другой каталог');
		const pick = new Function('WIZARD_PICK_KINDS', topFunction('settingsPickable(node) {') + '\nreturn settingsPickable;')(['field', 'calc', 'total', 'dataParam', 'userField', 'system']) as (
			node: { kind: string } | null
		) => boolean;
		assert.deepEqual(['field', 'calc', 'total', 'dataParam', 'userField', 'system', 'folder', 'path'].map((kind) => pick({ kind })), [true, true, true, true, true, true, false, false]);
		assert.equal(pick(null), false);
		const layout = topFunction('settingsFieldsLayout(host, spec) {');
		assert.ok(layout.includes('nodes: settingsFieldNodes(spec.id),') && layout.includes('pickable: settingsPickable,') && layout.includes('onActivate: add,'));
		assert.ok(layout.includes("transferButtons(layout, [{ label: '>', title: spec.addTitle, onClick: () => add(tree.selected()) }])"));
		assert.ok(layout.includes("addBtn = keyed(moves.buttons[0], focusKey(['setmove', spec.id]));"), '«>» без ключа фокуса');
		// Разделы панелей совпадают с разделами окон «Добавить поле…»
		assert.ok(topFunction('openSelFieldDialog(variantName, path, original, item, pos, folderPos) {').includes("attachFieldList(fieldInput, 'selection');"));
		assert.ok(topFunction('openOrderFieldDialog(variantName, path, items, original, index) {').includes("attachFieldList(fieldInput, 'order');"));
		assert.ok(topFunction('buildComparisonForm(body, item) {').includes("attachFieldList(fieldInput, 'filter');"));
		for (const [render, id] of [
			['renderSelectionPanel(host, node, path, variantName) {', 'selection'],
			['renderOrderPanel(host, node, path, variantName) {', 'order'],
			['renderFilterPanel(host, node, path, variantName) {', 'filter'],
		]) {
			assert.ok(topFunction(render).includes(`settingsFieldsLayout(host, {\n\t\t\tid: '${id}',`), render);
		}
		// Дерево выбирает поле Enter у поля с детьми не раскрывая, если spec.pickable так считает
		const tree = topFunction('fieldTree(host, spec) {');
		assert.ok(tree.includes("const pickable = (node) => (spec.pickable ? spec.pickable(node) : node.kind === 'field' || node.kind === 'calc');"));
		assert.ok(tree.includes('if (row.expandable && !pickable(row.node)) {'));
	});

	test('что уходит в правке: «>» — поле в «Выбранные поля» и в «Сортировку» по возрастанию, в «Отбор» — окно нового условия с полем', () => {
		const selection = topFunction('renderSelectionPanel(host, node, path, variantName) {');
		assert.ok(selection.includes("onAdd: (field) => addItem(grid.selected(), { kind: 'field', field: field.path }),"));
		assert.ok(selection.includes("run: (row) => addItem(row, { kind: 'auto' })"));
		assert.ok(selection.includes("run: (row) => openSelFolderDialog(variantName, path, items, null, null, folderOf(row))"));
		assert.ok(selection.includes("const sendItems = (next) => sendPanelItems('dcs/set-selection', variantName, path, next);"));
		const order = topFunction('renderOrderPanel(host, node, path, variantName) {');
		assert.ok(order.includes("onAdd: (field) => append({ kind: 'field', field: field.path, orderType: 'Asc' }),"));
		assert.ok(order.includes("const sendItems = (next) => sendPanelItems('dcs/set-order', variantName, path, next);"));
		const filter = topFunction('renderFilterPanel(host, node, path, variantName) {');
		assert.ok(filter.includes("onAdd: (field) => ctx.add('comparison', parentOf(grid.selected()), { left: field.path }),"));
		assert.ok(filter.includes("return sendPanelItems('dcs/set-filter', variantName, path, next);"));
		// Окно условия с полем «>»: поле заполнено, фокус — на виде сравнения
		const dialog = topFunction('openFilterItemDialog(ctx, pos, kind, parentPos, preset, index) {');
		assert.ok(dialog.includes('buildComparisonForm(body, item || preset || null)'));
		assert.ok(dialog.includes('if (!item && preset && form && form.focusComparison) {\n\t\t\tform.focusComparison();'));
	});

	test('новый элемент окна выбран после ответа: папка выбранных полей — в выбранную папку; условие отбора сообщает адрес', () => {
		const calls: Array<[string, unknown]> = [];
		const items = [{ kind: 'folder', items: [{ kind: 'field', field: 'Сумма' }] }];
		const code = topFunction('itemsLevel(items, parent) {') + topFunction('applyFilterForm(ctx, form, pos, parentPos, index) {') + '\nreturn applyFilterForm;';
		const apply = new Function('cloneItems', 'selItemAt', code)(
			(list: unknown) => JSON.parse(JSON.stringify(list)),
			(list: Array<{ items: unknown[] }>, pos: number[]) => {
				let ref: { items?: unknown[] } = { items: list };
				for (const index of pos) {
					ref = (ref.items as Array<{ items?: unknown[] }>)[index];
				}
				return ref;
			}
		) as (ctx: unknown, form: unknown, pos: number[] | null, parentPos: number[] | null) => boolean;
		const form = { apply: (ref: Record<string, unknown>) => Object.assign(ref, { kind: 'comparison', left: 'Склад' }) };
		const ctx = (sent: boolean) => ({
			items,
			commit: (next: unknown) => {
				calls.push(['commit', next]);
				return sent;
			},
			added: (pos: unknown) => calls.push(['added', pos]),
		});
		assert.equal(apply(ctx(true), form, null, [0]), true);
		assert.deepEqual(calls[1], ['added', [0, 1]]);
		calls.length = 0;
		apply(ctx(true), form, null, null);
		assert.deepEqual(calls[1], ['added', [1]]);
		calls.length = 0;
		apply(ctx(false), form, null, null);
		assert.equal(calls.length, 1, 'отказ правки выбрал несуществующую строку');
		calls.length = 0;
		apply(ctx(true), form, [0, 0], null);
		assert.equal(calls.length, 1, 'правка сообщила адрес как новый');
		// Мини-редактор оформления без added — без ошибки
		apply({ items, commit: () => true }, form, null, null);
		const folder = topFunction('openSelFolderDialog(variantName, path, original, item, pos, folderPos) {');
		assert.ok(folder.includes('freshPos = folderPos.concat([owner.items.length - 1]);') && folder.includes("rememberListRow(listStateKey(variantName, path, 'selection'), freshPos);"));
		const field = topFunction('openSelFieldDialog(variantName, path, original, item, pos, folderPos) {');
		assert.ok(field.includes("rememberListRow(listStateKey(variantName, path, 'selection'), freshPos);"));
		assert.ok(topFunction('openOrderFieldDialog(variantName, path, items, original, index) {').includes("rememberListRow(listStateKey(variantName, path, 'order'), [next.length - 1]);"));
	});
});

describe('«Настройки»: правки списков «Выбранных полей», «Отбора» и «Сортировки» исполняются', () => {
	interface Sent {
		type: string;
		path: unknown;
		items: Array<Record<string, unknown>>;
	}
	interface PanelHarness {
		host: Node;
		sent: Sent[];
		calls: string[];
		ui: Map<string, { key: string; index: number; none?: boolean }>;
		layout(): { onAdd(field: { path: string; kind: string }): void; onRemove(key: string): void };
		render(panel: 'selection' | 'order' | 'filter', node: Record<string, unknown>): void;
		rows(): Node[];
		tool(name: string): Node;
		focusList(): string;
		zone(id: string): DropZone;
	}
	interface DropZone {
		from: Record<string, (payload: { zone: string; key: string }, target: { key: string | null; place: string }) => unknown>;
		place(payload: unknown, key: string | null): string;
		effect(payload: { zone: string }): string;
		drag?(key: string): string;
	}

	/**
	 * renderSelectionPanel, renderOrderPanel и renderFilterPanel как есть, со своими панелью пиктограмм и сеткой; заглушки —
	 * раскладка «Доступные поля» (отдаёт spec, «>» — spec.onAdd), канал правки, окна и подтверждение удаления.
	 */
	function panels(answer = true): PanelHarness {
		const sent: Sent[] = [];
		const calls: string[] = [];
		const zones = new Map<string, Record<string, unknown>>();
		let layout: { onAdd(field: { path: string; kind: string }): void; onRemove(key: string): void } | null = null;
		const code =
			'const settingsListUi = new Map();\nlet focusListPanel = "";\n' +
			topLine('replyFocus') +
			topLine('LIST_EMPTY_NOTE') +
			topLine('LIST_NO_ROW_NOTE') +
			topLine('ROW_CONTROL_TAGS') +
			topLine('SEL_AUTO_HINT') +
			topBlock('LEVEL_WORDS', '});') +
			[
				'pathKey(path) {',
				'cloneItems(items) {',
				'sectionItems(section) {',
				'fieldTreeKey(path) {',
				'listStateKey(variantName, path, panelId) {',
				'posKey(pos) {',
				'rememberListRow(stateKey, pos, index) {',
				'clearListRow(stateKey, index) {',
				'listSelection(stateKey, rows) {',
				'flattenItems(items, nested) {',
				'levelItems(items, pos) {',
				'insertionParent(row, isContainer) {',
				'insertionNote(row, isContainer, items, ownerName) {',
				'posAfterRemoval(items, pos) {',
				'listMoveNote(row, delta, place) {',
				'shortcutSpoken(shortcut) {',
				'spokenReason(note, unavailable) {',
				'setIconState(node, name, shortcut, unavailable, note) {',
				'settingsListToolbar(host, panelId, tools) {',
				'setNameText(node, text) {',
				'nameEl(tag, className, text) {',
				'cell(tr, text, className) {',
				'settingsListGrid(host, spec) {',
				'focusGridRow(tr) {',
				'selRowLabel(item) {',
				'orderRowLabel(item) {',
				'movedCopy(items, index, delta) {',
				'selItemAt(items, pos) {',
				'selListAt(items, pos) {',
				'countSelItems(items) {',
				'selItemName(item) {',
				'takenFieldKeys(items, fieldOf) {',
				'renderSelectionPanel(host, node, path, variantName) {',
				'moveSelItem(original, pos, delta, sendItems) {',
				'removeSelItem(original, item, pos, sendItems, onSent) {',
				'orderItemExtras(item) {',
				'renderOrderPanel(host, node, path, variantName) {',
				'moveFilterItem(ctx, pos, delta) {',
				'removeFilterItem(ctx, item, pos, onSent) {',
				'filterRowLabel(item) {',
				'renderFilterPanel(host, node, path, variantName) {',
				'itemsLevel(items, parent) {',
				'itemsDropSlot(items, target, place) {',
				'itemsInsert(items, slot, fresh) {',
				'itemsMove(items, from, slot) {',
				'itemAtPos(items, pos) {',
				'listDropSlot(items, target, place, container) {',
				'itemsOutdentSlot(items, pos) {',
				'itemsIndentSlot(items, pos, container) {',
				'listLevelTools(items, container, words, noRow, move) {',
				'settingsListDrop(panelId, avail, items, h) {',
			]
				.map(topFunction)
				.join('') +
			'\nreturn { renderSelectionPanel, renderOrderPanel, renderFilterPanel, settingsListUi, focusList: () => replyFocus.list };';
		const stubs: Record<string, unknown> = {
			el,
			document: doc,
			keyed,
			focusKey,
			iconButton: iconButtonStub,
			settingsNotice: (title: string, text: string) => calls.push('notice:' + title + ':' + text),
			actionsCell: (tr: Node, actions: Array<{ title: string; key?: string; onClick: () => void }>) => {
				const td = tr.appendChild(el('td', 'dcs-cell-actions'));
				for (const action of actions) {
					const button = td.appendChild(el('button'));
					button.setAttribute('aria-label', action.title);
					if (action.key) {
						keyed(button, action.key);
					}
					button.addEventListener('click', action.onClick);
				}
			},
			emptyNote: (host: Node, text: string) => host.appendChild(el('div', 'dcs-empty', text)),
			focusKeyed: (key: string) => calls.push('focus:' + key),
			sendPanelItems: (type: string, _variant: string, path: unknown, items: Array<Record<string, unknown>>) => {
				if (!items) {
					return false;
				}
				sent.push({ type, path, items });
				return true;
			},
			settingsFieldsLayout: (host: Node, spec: { onAdd(field: { path: string; kind: string }): void; onRemove(key: string): void; list(host: Node, avail: unknown): void }) => {
				layout = spec;
				spec.list(host.appendChild(el('div', 'dcs-setv-col')), { zone: 'setavail:test', node: (key: string) => ({ path: key, kind: 'field' }) });
			},
			tableDropZone: (node: Node, spec: Record<string, unknown>) => {
				zones.set(String(spec.id), spec);
				return node;
			},
			openSelFieldDialog: (_v: string, _p: unknown, _items: unknown, _item: unknown, _pos: unknown, folderPos: unknown) => calls.push('field-dialog:' + JSON.stringify(folderPos)),
			openSelFolderDialog: (_v: string, _p: unknown, _items: unknown, _item: unknown, _pos: unknown, folderPos: unknown) => calls.push('folder-dialog:' + JSON.stringify(folderPos)),
			openOrderFieldDialog: () => calls.push('order-dialog'),
			openFilterItemDialog: (_ctx: unknown, _pos: unknown, kind: string, parentPos: unknown, preset: unknown, index?: number) =>
				calls.push('filter-dialog:' + kind + ':' + JSON.stringify(parentPos) + (preset ? ':' + JSON.stringify(preset) : '') + (index === undefined ? '' : ':' + index)),
			confirmRemove: (question: string, submit: () => unknown) => {
				calls.push('confirm:' + question);
				if (answer) {
					submit();
				}
			},
			BUSY: 'busy',
			placementLabel: (value: string) => (value === 'Auto' ? 'Авто' : value),
			selectInput: (_options: unknown, value: string) => {
				const select = el('select');
				select.value = value;
				return select;
			},
			ORDER_TYPE_OPTIONS: [
				{ value: 'Asc', label: 'По возрастанию' },
				{ value: 'Desc', label: 'По убыванию' },
			],
			filterGroupTypeLabel: (value: string) => (value === 'OrGroup' ? 'ИЛИ' : 'И'),
			comparisonLabel: (value: string) => value,
			valuesSummary: () => '',
			userSettingBadge: () => null,
			filterItemSummary: (item: { left?: string }) => item.left || '',
		};
		const api = new Function(...Object.keys(stubs), withCoreAccessors(code))(...Object.values(stubs)) as {
			renderSelectionPanel(host: Node, node: unknown, path: unknown[], variant: string): void;
			renderOrderPanel(host: Node, node: unknown, path: unknown[], variant: string): void;
			renderFilterPanel(host: Node, node: unknown, path: unknown[], variant: string): void;
			settingsListUi: PanelHarness['ui'];
			focusList(): string;
		};
		const host = doc.body.appendChild(el('div'));
		return {
			host,
			sent,
			calls,
			ui: api.settingsListUi,
			layout: () => {
				assert.ok(layout, 'раскладка «Доступные поля» не нарисована');
				return layout;
			},
			render: (panel, node) => {
				host.textContent = '';
				const render = panel === 'selection' ? api.renderSelectionPanel : panel === 'order' ? api.renderOrderPanel : api.renderFilterPanel;
				render(host, node, [], 'Основной');
			},
			rows: () => host.find((node) => node.tagName === 'TR' && node.parentElement?.tagName === 'TBODY'),
			tool: (name: string) => {
				const found = host.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === name);
				assert.ok(found.length > 0, 'нет пиктограммы «' + name + '»');
				return found[0];
			},
			focusList: api.focusList,
			zone: (id: string) => {
				const found = zones.get(id);
				assert.ok(found, 'нет зоны переноса ' + id);
				return found as unknown as DropZone;
			},
		};
	}

	const FIELD = { path: 'Наценка', kind: 'calc' };
	const SELECTION = { selection: { items: SAMPLE_SELECTION } };
	const FILTER = {
		filter: {
			items: [{ kind: 'group', groupType: 'OrGroup', items: [{ kind: 'comparison', left: 'Склад' }, { kind: 'comparison', left: 'Сумма' }] }],
		},
	};
	const click = (row: Node, extra: Record<string, unknown> = {}): void => {
		row.fire('click', Object.assign({ target: row }, extra));
	};

	test('«Выбранные поля»: «>» и «Авто» — в выбранную папку или на уровень строки, без выбора — на верхний уровень; новое выбрано', () => {
		const h = panels();
		h.render('selection', SELECTION);
		// Выбрана папка: «>» — последним в неё
		click(h.rows()[1]);
		h.layout().onAdd(FIELD);
		assert.equal(h.sent[0].type, 'dcs/set-selection');
		assert.deepEqual((h.sent[0].items[1] as { items: unknown[] }).items, [{ kind: 'field', field: 'Сумма' }, { kind: 'auto' }, { kind: 'field', field: 'Наценка' }]);
		assert.equal(h.sent[0].items.length, 3);
		assert.deepEqual(h.ui.get('Основной\n[]\nselection'), { key: '[1,2]', index: Number.MAX_SAFE_INTEGER }, 'после ответа не выбрано новое');
		// Строка в папке: «Авто» — в ту же папку
		h.render('selection', SELECTION);
		click(h.rows()[2]);
		h.tool('Добавить «Авто»').fire('click');
		assert.deepEqual((h.sent[1].items[1] as { items: unknown[] }).items.slice(-1), [{ kind: 'auto' }]);
		// Строка верхнего уровня: в конец верхнего уровня
		click(h.rows()[0]);
		h.layout().onAdd(FIELD);
		assert.deepEqual(h.sent[2].items[3], { kind: 'field', field: 'Наценка' });
		// Пиктограммы добавления говорят, куда встанет новый элемент
		click(h.rows()[1]);
		assert.equal(h.tool('Добавить папку…').getAttribute('aria-description'), 'Встанет в папку «Суммы». Чтобы добавить на верхний уровень, нажмите Esc в списке.');
		assert.equal(h.tool('Добавить «Авто»').getAttribute('aria-description'), 'Состав элемента «Авто» наследуется от родителя. Встанет в папку «Суммы». Чтобы добавить на верхний уровень, нажмите Esc в списке.');
		// Выбор снят Escape: «>», «Авто», окна поля и папки — на верхний уровень
		h.rows()[1].fire('keydown', { key: 'Escape', target: h.rows()[1] });
		assert.equal(h.tool('Добавить папку…').getAttribute('aria-description'), null, 'без выбора — на верхний уровень, пояснять нечего');
		assert.equal(h.tool('Удалить').getAttribute('aria-description'), 'Строка не выбрана.');
		assert.equal(h.tool('Переместить выше').getAttribute('aria-description'), 'Строка не выбрана.');
		// Перерисовка без правки (другой вкладкой и обратно): выбор так и снят
		h.render('selection', SELECTION);
		assert.ok(h.rows().every((tr) => tr.getAttribute('aria-selected') === 'false'), 'снятый выбор не пережил перерисовку');
		h.layout().onAdd(FIELD);
		assert.deepEqual(h.sent[3].items.map((item) => item.kind), ['field', 'folder', 'auto', 'field']);
		// После ответа выбран новый элемент (здесь его адреса нет — последняя строка)
		h.render('selection', SELECTION);
		assert.equal(h.rows()[4].getAttribute('aria-selected'), 'true');
		h.rows()[4].fire('keydown', { key: 'Escape', target: h.rows()[4] });
		h.tool('Добавить «Авто»').fire('click');
		assert.deepEqual(h.sent[4].items.slice(-1), [{ kind: 'auto' }]);
		assert.equal(h.sent[4].items.length, 4);
		h.render('selection', SELECTION);
		h.rows()[0].fire('keydown', { key: 'Escape', target: h.rows()[0] });
		h.tool('Добавить папку…').fire('click');
		h.tool('Добавить поле…').fire('click');
		click(h.rows()[3]);
		h.tool('Добавить папку…').fire('click');
		assert.deepEqual(h.calls.filter((c) => c.includes('-dialog:')), ['folder-dialog:null', 'field-dialog:null', 'folder-dialog:[1]']);
		doc.body.textContent = '';
	});

	test('«Выбранные поля»: удаление и перестановка — что уходит и какая строка выбрана после ответа; Delete в списке возвращает фокус', () => {
		const h = panels();
		h.render('selection', SELECTION);
		click(h.rows()[3]);
		h.tool('Переместить выше').fire('click');
		assert.deepEqual((h.sent[0].items[1] as { items: unknown[] }).items, [{ kind: 'auto' }, { kind: 'field', field: 'Сумма' }]);
		assert.equal(h.ui.get('Основной\n[]\nselection')?.key, '[1,0]', 'выбор не пошёл за строкой');
		h.render('selection', SELECTION);
		h.rows()[2].fire('keydown', { key: 'Delete', target: h.rows()[2] });
		assert.deepEqual((h.sent[1].items[1] as { items: unknown[] }).items, [{ kind: 'auto' }]);
		assert.equal(h.ui.get('Основной\n[]\nselection')?.key, '[1,0]', 'после удаления выбрана не строка на том же месте');
		assert.equal(h.focusList(), 'Основной\n[]\nselection', 'Delete в списке не попросил вернуть фокус после ответа');
		// Папка с вложенными — подтверждение
		h.render('selection', SELECTION);
		click(h.rows()[1]);
		h.tool('Удалить').fire('click');
		assert.ok(h.calls.includes('confirm:Удалить папку «Суммы»? Вместе с ней удалятся вложенные элементы: 2.'));
		assert.deepEqual(h.sent[2].items.map((item) => item.kind), ['field', 'auto']);
		doc.body.textContent = '';
	});

	test('«Отбор» из одной группы: условие и группа встают в группу, без выбора — на верхний уровень рядом с ней', () => {
		const h = panels();
		h.render('filter', FILTER);
		click(h.rows()[0]);
		h.layout().onAdd(FIELD);
		h.tool('Добавить условие…').fire('click');
		click(h.rows()[2]);
		h.tool('Добавить группу условий…').fire('click');
		assert.equal(h.tool('Добавить условие…').getAttribute('aria-description'), 'Встанет в группу «ИЛИ». Чтобы добавить на верхний уровень, нажмите Esc в списке.');
		h.rows()[2].fire('keydown', { key: 'Escape', target: h.rows()[2] });
		h.layout().onAdd(FIELD);
		h.tool('Добавить условие…').fire('click');
		h.tool('Добавить группу условий…').fire('click');
		assert.deepEqual(
			h.calls.filter((c) => c.startsWith('filter-dialog:')),
			[
				'filter-dialog:comparison:[0]:{"left":"Наценка"}',
				'filter-dialog:comparison:[0]',
				'filter-dialog:group:[0]',
				'filter-dialog:comparison:null:{"left":"Наценка"}',
				'filter-dialog:comparison:null',
				'filter-dialog:group:null',
			]
		);
		// Щелчок по пустому месту под строками тоже снимает выбор
		h.render('filter', FILTER);
		click(h.rows()[1]);
		const wrap = h.host.find((node) => node.tagName === 'TABLE')[0].parentElement as Node;
		wrap.fire('click', { target: wrap });
		h.tool('Добавить условие…').fire('click');
		assert.equal(h.calls[h.calls.length - 1], 'filter-dialog:comparison:null');
		// Перестановка и удаление в группе
		click(h.rows()[1]);
		h.tool('Переместить ниже').fire('click');
		assert.equal(h.sent[0].type, 'dcs/set-filter');
		assert.deepEqual((h.sent[0].items[0] as { items: Array<{ left: string }> }).items.map((item) => item.left), ['Сумма', 'Склад']);
		h.render('filter', FILTER);
		h.rows()[2].fire('keydown', { key: 'Delete', target: h.rows()[2] });
		assert.deepEqual((h.sent[1].items[0] as { items: Array<{ left: string }> }).items.map((item) => item.left), ['Склад']);
		assert.equal(h.ui.get('Основной\n[]\nfilter')?.key, '[0,0]');
		assert.equal(h.focusList(), 'Основной\n[]\nfilter', 'Delete в списке не попросил вернуть фокус после ответа');
		doc.body.textContent = '';
	});

	test('перенос мышью, «Выбранные поля»: поле — та же вставка, что «>» (в папку, в место сброса), перестановка в папку и из неё, удаление сбросом на дерево — как «Удалить»', () => {
		const h = panels();
		h.render('selection', SELECTION);
		const zone = h.zone('setlist:selection');
		const avail = { zone: 'setavail:test', key: 'Наценка' };
		// Папка принимает «в строку», поле — до и после; курсор: из дерева — копия, внутри списка — перенос
		assert.equal(zone.place(avail, '[1]'), 'both');
		assert.equal(zone.place(avail, '[0]'), 'line');
		assert.equal(zone.place(avail, '[1,0]'), 'line');
		assert.equal(zone.place(avail, null), 'line');
		assert.equal(zone.effect(avail), 'copy');
		assert.equal(zone.effect({ zone: 'setlist:selection' }), 'move');
		assert.ok(h.rows().every((tr) => (tr.children[1] as unknown as { draggable?: boolean }).draggable === true && (tr as unknown as { draggable?: boolean }).draggable !== true), 'ручка — ячейка имени');
		// «>» при выбранной папке и сброс в папку — один текст правки и один выбор после ответа
		click(h.rows()[1]);
		h.layout().onAdd(FIELD);
		const viaButton = h.sent[h.sent.length - 1];
		const rememberedButton = h.ui.get('Основной\n[]\nselection');
		h.render('selection', SELECTION);
		h.zone('setlist:selection').from['setavail:test'](avail, { key: '[1]', place: 'into' });
		assert.deepEqual(h.sent[h.sent.length - 1], viaButton);
		assert.deepEqual(h.ui.get('Основной\n[]\nselection'), rememberedButton);
		// До строки — на её место, под строками — в конец верхнего уровня
		h.render('selection', SELECTION);
		h.zone('setlist:selection').from['setavail:test'](avail, { key: '[1,1]', place: 'before' });
		assert.deepEqual((h.sent[h.sent.length - 1].items[1] as { items: Array<{ field?: string; kind: string }> }).items.map((i) => i.field || i.kind), ['Сумма', 'Наценка', 'auto']);
		h.zone('setlist:selection').from['setavail:test'](avail, { key: null, place: 'end' });
		assert.deepEqual(h.sent[h.sent.length - 1].items.map((i) => (i.field as string) || (i.kind as string)), ['Склад', 'folder', 'auto', 'Наценка']);
		// Перестановка: «Склад» в папку серединой её строки — последним в неё; фокус после ответа — за строкой
		h.render('selection', SELECTION);
		h.zone('setlist:selection').from['setlist:selection']({ zone: 'setlist:selection', key: '[0]' }, { key: '[1]', place: 'into' });
		const moved = h.sent[h.sent.length - 1];
		assert.equal(moved.type, 'dcs/set-selection');
		assert.deepEqual(moved.items.map((i) => i.kind), ['folder', 'auto']);
		assert.deepEqual((moved.items[0] as { items: Array<{ field?: string; kind: string }> }).items.map((i) => i.field || i.kind), ['Сумма', 'auto', 'Склад']);
		assert.deepEqual(h.ui.get('Основной\n[]\nselection'), { key: '[0,2]', index: Number.MAX_SAFE_INTEGER });
		assert.equal(h.focusList(), 'Основной\n[]\nselection');
		// Папка в саму себя и строка на своё место — правки нет (false: строку выберет обвязка)
		const count = h.sent.length;
		h.render('selection', SELECTION);
		assert.equal(h.zone('setlist:selection').from['setlist:selection']({ zone: 'setlist:selection', key: '[1]' }, { key: '[1,0]', place: 'after' }), false);
		assert.equal(h.zone('setlist:selection').from['setlist:selection']({ zone: 'setlist:selection', key: '[0]' }, { key: '[1]', place: 'before' }), false);
		assert.equal(h.sent.length, count);
		// Сброс на «Доступные поля» — то же, что «Удалить» по строке (с клавиатуры — фокус после ответа на выбранной)
		click(h.rows()[0]);
		h.tool('Удалить').fire('click');
		const viaDelete = h.sent[h.sent.length - 1];
		h.render('selection', SELECTION);
		h.layout().onRemove('[0]');
		assert.deepEqual(h.sent[h.sent.length - 1], viaDelete);
		h.render('selection', SELECTION);
		h.layout().onRemove('[1]');
		assert.ok(h.calls.some((call) => call.startsWith('confirm:Удалить папку «Суммы»?')), 'папка с вложенными — с вопросом');
		doc.body.textContent = '';
	});

	test('перенос мышью, «Сортировка» и «Отбор»: поле в место сброса, перестановка — та же копия, что ↑ ↓; поле в отбор — окно условия с местом', () => {
		const h = panels();
		const ORDER = { order: { items: [{ kind: 'field', field: 'Склад', orderType: 'Asc' }, { kind: 'auto' }, { kind: 'field', field: 'Сумма', orderType: 'Desc' }] } };
		h.render('order', ORDER);
		const avail = { zone: 'setavail:test', key: 'Наценка' };
		assert.equal(h.zone('setlist:order').place(avail, '[1]'), 'line', 'в сортировке папок нет');
		h.zone('setlist:order').from['setavail:test'](avail, { key: '[1]', place: 'before' });
		assert.deepEqual(h.sent[h.sent.length - 1].items[1], { kind: 'field', field: 'Наценка', orderType: 'Asc' });
		assert.deepEqual(h.ui.get('Основной\n[]\norder'), { key: '[1]', index: Number.MAX_SAFE_INTEGER });
		// «Склад» в конец: та же копия, что ↓ ↓ (movedCopy со сдвигом 2)
		h.render('order', ORDER);
		h.zone('setlist:order').from['setlist:order']({ zone: 'setlist:order', key: '[0]' }, { key: null, place: 'end' });
		assert.deepEqual(h.sent[h.sent.length - 1].items.map((i) => (i.field as string) || (i.kind as string)), ['auto', 'Сумма', 'Склад']);
		assert.equal(h.focusList(), 'Основной\n[]\norder');
		// «Отбор»: поле в группу — окно нового условия с полем, родитель — группа, номер — последним в ней
		h.render('filter', FILTER);
		assert.equal(h.zone('setlist:filter').place(avail, '[0]'), 'both', 'группа принимает «в строку»');
		assert.equal(h.zone('setlist:filter').place(avail, '[0,0]'), 'line');
		click(h.rows()[0]);
		h.layout().onAdd(FIELD);
		assert.equal(h.calls[h.calls.length - 1], 'filter-dialog:comparison:[0]:{"left":"Наценка"}', '«>» с выбранной группой');
		h.zone('setlist:filter').from['setavail:test'](avail, { key: '[0]', place: 'into' });
		assert.equal(h.calls[h.calls.length - 1], 'filter-dialog:comparison:[0]:{"left":"Наценка"}:2', 'то же окно, место — последним в группе');
		h.zone('setlist:filter').from['setavail:test'](avail, { key: '[0]', place: 'before' });
		assert.equal(h.calls[h.calls.length - 1], 'filter-dialog:comparison:null:{"left":"Наценка"}:0', 'до группы — первым на верхнем уровне');
		// Условие из группы — на верхний уровень после неё (под строками — последним на верхнем уровне)
		h.zone('setlist:filter').from['setlist:filter']({ zone: 'setlist:filter', key: '[0,1]' }, { key: null, place: 'end' });
		const sent = h.sent[h.sent.length - 1];
		assert.equal(sent.type, 'dcs/set-filter');
		assert.deepEqual(sent.items.map((i) => (i.left as string) || (i.kind as string)), ['group', 'Сумма']);
		// Под строкой группы с вложенными линия — над её первым условием: условие встаёт первым в группу, как «до» первого
		h.render('filter', FILTER);
		h.zone('setlist:filter').from['setlist:filter']({ zone: 'setlist:filter', key: '[0,1]' }, { key: '[0]', place: 'after' });
		const first = h.sent[h.sent.length - 1].items[0] as { items: Array<{ left: string }> };
		assert.deepEqual(first.items.map((i) => i.left), ['Сумма', 'Склад']);
		h.zone('setlist:filter').from['setavail:test'](avail, { key: '[0]', place: 'after' });
		assert.equal(h.calls[h.calls.length - 1], 'filter-dialog:comparison:[0]:{"left":"Наценка"}:0', 'новое условие — первым в группу');
		doc.body.textContent = '';
	});

	test('пиктограммы уровня — без мыши то же, что перенос строки в папку (группу) и из неё: та же правка, выбор за строкой, фокус — на кнопке', () => {
		const h = panels();
		// [Склад, Суммы[Сумма, Авто], Авто]: «Склад» в папку выше — нельзя (над ним ничего), «Авто» (2) — последним в «Суммы»
		h.render('selection', SELECTION);
		const reason = (name: string) => h.tool(name).getAttribute('aria-description');
		click(h.rows()[0]);
		assert.equal(reason('Вынести из папки'), 'Строка не в папке.');
		assert.equal(reason('Перенести в папку выше'), 'Над строкой на её уровне нет папки.');
		const before = h.sent.length;
		h.tool('Перенести в папку выше').fire('click');
		assert.equal(h.sent.length, before, 'недоступная команда дала правку');
		assert.equal(h.calls[h.calls.length - 1], 'notice:Перенести в папку выше:Недоступно: над строкой на её уровне нет папки.');
		click(h.rows()[4]);
		assert.equal(reason('Перенести в папку выше'), null, 'над «Авто» — папка: команда доступна');
		h.tool('Перенести в папку выше').fire('click');
		const viaTool = h.sent[h.sent.length - 1];
		assert.deepEqual(viaTool.items.map((i) => i.kind), ['field', 'folder']);
		assert.deepEqual((viaTool.items[1] as { items: Array<{ field?: string; kind: string }> }).items.map((i) => i.field || i.kind), ['Сумма', 'auto', 'auto']);
		assert.deepEqual(h.ui.get('Основной\n[]\nselection'), { key: '[1,2]', index: Number.MAX_SAFE_INTEGER }, 'выбор — за строкой');
		assert.equal(h.focusList(), '', 'фокус остаётся на кнопке, как у ↑ ↓');
		// Та же правка, что сброс мышью серединой строки папки
		h.render('selection', SELECTION);
		h.zone('setlist:selection').from['setlist:selection']({ zone: 'setlist:selection', key: '[2]' }, { key: '[1]', place: 'into' });
		assert.deepEqual(h.sent[h.sent.length - 1].items, viaTool.items);
		// «Сумма» из папки — сразу за ней на верхний уровень
		h.render('selection', SELECTION);
		click(h.rows()[2]);
		assert.equal(reason('Вынести из папки'), null);
		h.tool('Вынести из папки').fire('click');
		assert.deepEqual(h.sent[h.sent.length - 1].items.map((i) => (i.field as string) || (i.kind as string)), ['Склад', 'folder', 'Сумма', 'auto']);
		assert.deepEqual(h.ui.get('Основной\n[]\nselection'), { key: '[2]', index: Number.MAX_SAFE_INTEGER });
		// «Отбор»: свои слова; условие с пользовательской настройкой переносится со всеми свойствами
		const kept = { kind: 'comparison', left: 'Склад', userSettingID: 'u1', viewMode: 'QuickAccess', userSettingPresentation: 'Склад' };
		h.render('filter', { filter: { items: [kept, { kind: 'group', groupType: 'AndGroup', items: [] }, { kind: 'comparison', left: 'Сумма' }] } });
		click(h.rows()[2]);
		assert.equal(reason('Вынести из группы'), 'Строка не в группе.');
		h.tool('Перенести в группу выше').fire('click');
		assert.deepEqual(h.sent[h.sent.length - 1].items[1], { kind: 'group', groupType: 'AndGroup', items: [{ kind: 'comparison', left: 'Сумма' }] }, 'в пустую группу');
		h.render('filter', { filter: { items: [{ kind: 'group', groupType: 'AndGroup', items: [kept] }] } });
		click(h.rows()[1]);
		h.tool('Вынести из группы').fire('click');
		assert.deepEqual(h.sent[h.sent.length - 1].items[1], kept, 'пользовательская настройка условия потерялась');
		doc.body.textContent = '';
	});

	test('строка, брошенная на «Доступные поля», сначала выбрана, как перед Delete: после отмены вопроса пиктограммы действуют на неё', () => {
		// Вопрос об удалении отменён: правки нет, выбрана брошенная строка, «Удалить» спрашивает о ней же
		const h = panels(false);
		h.render('selection', SELECTION);
		click(h.rows()[0]);
		h.layout().onRemove('[1]');
		assert.equal(h.sent.length, 0);
		assert.equal(h.ui.get('Основной\n[]\nselection')?.key, '[1]', 'выбрана не брошенная строка');
		h.tool('Удалить').fire('click');
		assert.deepEqual(
			h.calls.filter((call) => call.startsWith('confirm:')).map((call) => call.slice(0, 'confirm:Удалить папку «Суммы»?'.length)),
			['confirm:Удалить папку «Суммы»?', 'confirm:Удалить папку «Суммы»?']
		);
		h.render('filter', FILTER);
		click(h.rows()[1]);
		h.layout().onRemove('[0]');
		assert.equal(h.ui.get('Основной\n[]\nfilter')?.key, '[0]');
		// Ответ «да»: после удаления выбрана строка на месте удалённой, как после Delete
		const g = panels();
		g.render('order', { order: { items: [{ kind: 'field', field: 'Склад', orderType: 'Asc' }, { kind: 'auto' }, { kind: 'field', field: 'Сумма', orderType: 'Asc' }] } });
		click(g.rows()[2]);
		g.layout().onRemove('[0]');
		assert.deepEqual(g.sent[g.sent.length - 1].items.map((i) => (i.field as string) || (i.kind as string)), ['auto', 'Сумма']);
		assert.equal(g.ui.get('Основной\n[]\norder')?.key, '[0]');
		doc.body.textContent = '';
	});

	test('«Сортировка»: «>» и «Авто» — в конец по возрастанию, перестановка и удаление — по номеру', () => {
		const h = panels();
		const ORDER = { order: { items: [{ kind: 'field', field: 'Склад', orderType: 'Asc' }, { kind: 'auto' }] } };
		h.render('order', ORDER);
		h.layout().onAdd(FIELD);
		assert.deepEqual(h.sent[0], { type: 'dcs/set-order', path: [], items: [ORDER.order.items[0], ORDER.order.items[1], { kind: 'field', field: 'Наценка', orderType: 'Asc' }] });
		assert.equal(h.ui.get('Основной\n[]\norder')?.key, '[2]');
		h.render('order', ORDER);
		h.tool('Добавить «Авто»').fire('click');
		assert.deepEqual(h.sent[1].items.slice(-1), [{ kind: 'auto' }]);
		click(h.rows()[0]);
		h.tool('Переместить ниже').fire('click');
		assert.deepEqual(h.sent[2].items.map((item) => item.kind), ['auto', 'field']);
		assert.equal(h.ui.get('Основной\n[]\norder')?.key, '[1]');
		h.render('order', ORDER);
		h.rows()[1].fire('keydown', { key: 'Delete', target: h.rows()[1] });
		assert.deepEqual(h.sent[3].items, [ORDER.order.items[0]]);
		assert.equal(h.ui.get('Основной\n[]\norder')?.key, '[0]', 'удалена последняя — выбрана предыдущая');
		// Без выбора удалять и двигать нечего — причина; без строк — «список пуст»
		h.render('order', ORDER);
		h.rows()[0].fire('keydown', { key: 'Escape', target: h.rows()[0] });
		assert.equal(h.tool('Удалить').getAttribute('aria-description'), 'Строка не выбрана.');
		h.render('order', { order: { items: [] } });
		assert.equal(h.tool('Удалить').getAttribute('aria-description'), 'Список пуст.');
		doc.body.textContent = '';
	});

	test('имя строки для читалки: поле и заголовок, папка, условие, группа, направление; пробел снимает флажок — после ответа «не используется»', () => {
		const h = panels();
		const selection = { selection: { items: [{ kind: 'field', field: 'Склад', title: 'Место' }, { kind: 'folder', title: 'Суммы', placement: 'Vertically', items: [{ kind: 'auto' }] }] } };
		h.render('selection', selection);
		assert.deepEqual(h.rows().map((tr) => tr.getAttribute('aria-label')), ['Склад, заголовок «Место»', 'Папка «Суммы», расположение: vertically', 'Авто']);
		const first = h.rows()[0];
		first.focus();
		first.fire('keydown', { key: ' ', target: first });
		assert.equal(h.sent[0].items[0].use, false);
		// Ответ: та же строка (тот же ключ фокуса) с другим именем — читалка слышит новое состояние
		h.render('selection', { selection: { items: h.sent[0].items } });
		assert.equal(h.rows()[0].getAttribute('aria-label'), 'Склад, заголовок «Место», не используется');
		assert.equal(h.rows()[0].getAttribute('data-dcs-key'), first.getAttribute('data-dcs-key'));
		h.render('filter', { filter: { items: [{ kind: 'group', groupType: 'OrGroup', presentation: 'Остатки', items: [{ kind: 'comparison', left: 'Склад', use: false }] }] } });
		assert.deepEqual(h.rows().map((tr) => tr.getAttribute('aria-label')), ['Группа ИЛИ, условий: 1, представление «Остатки»', 'Склад, не используется']);
		h.render('order', { order: { items: [{ kind: 'field', field: 'Склад', orderType: 'Desc', autoOrder: true }, { kind: 'auto' }] } });
		assert.deepEqual(h.rows().map((tr) => tr.getAttribute('aria-label')), ['Склад, по убыванию, авто-упорядочивание', 'Авто']);
		doc.body.textContent = '';
	});
});

describe('«Настройки»: кнопки в строках «Полей группировки» и «Условного оформления»', () => {
	function rowsPanel(render: 'renderGroupFieldsPanel(host, node, path, variantName) {' | 'renderAppearancePanel(host, node, path, variantName) {', node: unknown) {
		const calls: string[] = [];
		const sent: unknown[] = [];
		const zones: Array<Record<string, unknown>> = [];
		const code =
			topLine('replyFocus') +
			topFunction('rowRemovalFocus(keyOf, index, emptyKey) {') +
			NAME_HELPERS +
			topFunction('cell(tr, text, className) {') +
			topFunction('actionsCell(tr, actions) {') +
			topFunction('movedCopy(items, index, delta) {') +
			topFunction('sectionItems(section) {') +
			topFunction(render) +
			'\nreturn { render: ' + render.slice(0, render.indexOf('(')) + ', replyFocus };';
		const stubs: Record<string, unknown> = {
			el,
			document: doc,
			keyed,
			focusKey,
			iconButton: iconButtonStub,
			listToolbar: (host: Node, buttons: Array<{ name: string; key: string }>) => {
				const bar = host.appendChild(el('div', 'dcs-list-toolbar'));
				for (const spec of buttons) {
					bar.appendChild(keyed(el('button', '', spec.name), spec.key));
				}
				return bar;
			},
			dataTable: (host: Node) => host.appendChild(el('table')).appendChild(el('tbody')),
			groupTypeLabel: () => '',
			periodAdditionLabel: () => '',
			boundarySummary: () => '',
			settingsNotice: (title: string, text: string) => calls.push('notice:' + title + ':' + text),
			sendPanelItems: (_type: string, _v: string, _p: unknown, items: unknown) => {
				sent.push(items);
				return true;
			},
			openGroupFieldDialog: () => calls.push('dialog'),
			openAppearanceDialog: () => calls.push('dialog'),
			cloneItems: (items: unknown) => JSON.parse(JSON.stringify(items)),
			send: (type: string, fields: unknown) => {
				sent.push([type, fields]);
				return true;
			},
			setStatus: () => undefined,
			BUSY: 'busy',
			appearanceSummary: () => 'Цвет',
			filterSummary: () => '',
			caFieldsSummary: () => '',
			userSettingBadge: () => null,
			useInSummary: () => '',
			confirmRemove: (_question: string, submit: () => unknown) => submit(),
			tableDropZone: (node: Node, spec: Record<string, unknown>) => {
				zones.push(spec);
				return node;
			},
			dropIndex: DROP_INDEX,
		};
		const api = new Function(...Object.keys(stubs), code)(...Object.values(stubs)) as { render(host: Node, node: unknown, path: unknown[], variant: string): void; replyFocus: { fallback: string } };
		const host = doc.body.appendChild(el('div'));
		api.render(host, node, [], 'Основной');
		const button = (row: number, name: string): Node => host.find((n) => n.tagName === 'TR')[row].find((n) => n.getAttribute('aria-label') === name)[0];
		return { host, calls, sent, replyFocus: api.replyFocus, button, zones };
	}

	test('«Поля группировки»: ключи фокуса (по полю у «Править», «Выше», «Ниже», по номеру у «Удалить»), у края — недоступны в обходе Tab с причиной, запасной фокус после удаления последней строки', () => {
		const fields = { groupFields: [{ field: 'Склад' }, { field: 'Сумма' }, { field: 'Склад' }] };
		const p = rowsPanel('renderGroupFieldsPanel(host, node, path, variantName) {', fields);
		assert.deepEqual(
			[0, 1, 2].map((row) => ['Править', 'Выше', 'Ниже', 'Удалить'].map((name) => p.button(row, name).getAttribute('data-dcs-key'))),
			[
				['grpf\nedit\nСклад\n1', 'grpf\nup\nСклад\n1', 'grpf\ndown\nСклад\n1', 'grpf\ndelete\n0'],
				['grpf\nedit\nСумма\n1', 'grpf\nup\nСумма\n1', 'grpf\ndown\nСумма\n1', 'grpf\ndelete\n1'],
				['grpf\nedit\nСклад\n2', 'grpf\nup\nСклад\n2', 'grpf\ndown\nСклад\n2', 'grpf\ndelete\n2'],
			]
		);
		const up = p.button(0, 'Выше');
		assert.equal(up.getAttribute('aria-disabled'), 'true');
		assert.equal(up.disabled, false, '«Выше» у первой строки выпала из обхода Tab');
		assert.equal(up.getAttribute('aria-description'), 'Поле уже первое.');
		up.fire('click');
		assert.deepEqual(p.calls, ['notice:Выше:Недоступно: поле уже первое.']);
		assert.equal(p.sent.length, 0);
		assert.equal(p.button(2, 'Ниже').getAttribute('aria-description'), 'Поле уже последнее.');
		p.button(1, 'Выше').fire('click');
		assert.deepEqual(p.sent[0], [{ field: 'Сумма' }, { field: 'Склад' }, { field: 'Склад' }]);
		// Удаление последней строки: преемника нет — запасной фокус на «Удалить» предыдущей; единственной — на «Добавить поле…»
		p.button(2, 'Удалить').fire('click');
		assert.equal(p.replyFocus.fallback, 'grpf\ndelete\n1');
		const single = rowsPanel('renderGroupFieldsPanel(host, node, path, variantName) {', { groupFields: [{ field: 'Склад' }] });
		single.button(0, 'Удалить').fire('click');
		assert.equal(single.replyFocus.fallback, 'nodetool\ngroupFields\nadd');
		doc.body.textContent = '';
	});

	test('«Поля группировки», перенос мышью: за ячейку поля, та же копия списка, что «Выше» и «Ниже»; фокус после ответа — на «Править» переставленного поля', () => {
		const fields = { groupFields: [{ field: 'Склад' }, { field: 'Сумма' }, { field: 'Склад' }] };
		const p = rowsPanel('renderGroupFieldsPanel(host, node, path, variantName) {', fields);
		assert.equal(p.zones.length, 1);
		const zone = p.zones[0] as { id: string; drag(): string; from: { setgrpf(payload: { key: string }, spot: { key: string | null; place: string }): unknown } };
		assert.equal(zone.id, 'setgrpf');
		assert.equal(zone.drag(), 'field');
		const trs = p.host.find((n) => n.tagName === 'TR');
		assert.ok(trs.every((tr) => (tr.children[0] as unknown as { draggable?: boolean }).draggable === true), 'ручка — ячейка поля');
		assert.equal(zone.from.setgrpf({ key: '0' }, { key: '1', place: 'before' }), false, 'своё место — без правки');
		assert.equal(p.sent.length, 0);
		zone.from.setgrpf({ key: '0' }, { key: null, place: 'end' });
		assert.deepEqual(p.sent[0], [{ field: 'Сумма' }, { field: 'Склад' }, { field: 'Склад' }], 'копия списка со сдвигом на две строки');
		assert.equal(p.replyFocus.fallback, 'grpf\nedit\nСклад\n2', 'переставленное «Склад» — второе по счёту');
		zone.from.setgrpf({ key: '2' }, { key: '0', place: 'before' });
		assert.deepEqual(p.sent[1], [{ field: 'Склад' }, { field: 'Склад' }, { field: 'Сумма' }]);
		assert.equal(p.replyFocus.fallback, 'grpf\nedit\nСклад\n1');
		doc.body.textContent = '';
	});

	test('«Условное оформление»: ключи «Править» и «Удалить» по номеру, запасной фокус после удаления последнего элемента', () => {
		const p = rowsPanel('renderAppearancePanel(host, node, path, variantName) {', { conditionalAppearance: { items: [{ appearance: [] }, { appearance: [] }] } });
		assert.deepEqual([0, 1].map((row) => [p.button(row, 'Править').getAttribute('data-dcs-key'), p.button(row, 'Удалить').getAttribute('data-dcs-key')]), [
			['appr\nedit\n0', 'appr\ndelete\n0'],
			['appr\nedit\n1', 'appr\ndelete\n1'],
		]);
		p.button(1, 'Удалить').fire('click');
		assert.deepEqual(p.sent[0], ['dcs/remove-appearance-item', { variant: 'Основной', payload: { path: [], index: 1 } }]);
		assert.equal(p.replyFocus.fallback, 'appr\ndelete\n0');
		// Флажок строки: имя — элемент (у колонки нет заголовка), ключ — по номеру, как у кнопок: ответ перерисует панель
		const boxes = p.host.find((n) => n.tagName === 'INPUT');
		assert.deepEqual(
			boxes.map((box) => [box.getAttribute('aria-label'), box.getAttribute('data-dcs-key')]),
			[
				['Использовать: Цвет', 'appr\nuse\n0'],
				['Использовать: Цвет', 'appr\nuse\n1'],
			]
		);
		doc.body.textContent = '';
	});

	test('«Другие настройки», «Параметры», окна оформления и списка значений: ключи, имена и фокус после «Убрать»', () => {
		const output = topFunction('appendOutputRow(tbody, record, path, variantName, level, removable) {');
		assert.ok(output.includes("key: focusKey(['outp', 'remove', name]),"));
		assert.ok(output.includes("replyFocus.fallback = neighbour ? focusKey(['outp', 'remove', neighbour]) : focusKey(['nodetool', 'output', 'add']);"));
		assert.ok(SCRIPT.includes("key: focusKey(['dparam', 'edit', row.name]),"), '«Править» параметра данных без ключа');
		const appearance = topFunction('caAppearanceEditor(body, initialItems) {');
		assert.ok(appearance.indexOf("addSelect.setAttribute('aria-label', 'Добавить параметр оформления');") < appearance.indexOf('const tbody = dataTable(host'), '«+ Добавить параметр» не над таблицей');
		assert.ok(appearance.includes("title: 'Убрать параметр «' + (row.item.parameter || '') + '»',"));
		assert.ok(appearance.includes('neighbour.removeBtn.focus();') && appearance.includes('addSelect.focus();'));
		const fieldsEditor = topFunction('caFieldsEditor(body, initialFields) {');
		assert.ok(fieldsEditor.includes("name: 'Добавить поле',"));
		assert.ok(SCRIPT.includes("name: 'Убрать значение',") && SCRIPT.includes("name: 'Добавить значение',"));
		// Своё display пиктограммы не перебивает общее .hidden
		assert.match(CSS, /\.dcs-icon-btn\.hidden \{\n\tdisplay: none;\n\}/);
	});
});

describe('список-действие «+ Добавить параметр»: стрелки на закрытом списке не действуют', () => {
	test('change от стрелки или буквы — только выбор имени, действует Enter; выбор мышью и в раскрытом списке — сразу', async () => {
		const picked: string[] = [];
		const actionSelect = new Function(topLine('SELECT_BROWSE_KEYS') + topFunction('actionSelect(select, onPick) {') + '\nreturn actionSelect;')() as (select: Node, onPick: (value: string) => void) => void;
		const select = el('select');
		actionSelect(select, (value) => picked.push(value));
		// Стрелка на закрытом списке (Chromium под Windows): значение сменилось и change пришёл в той же задаче
		select.fire('keydown', { key: 'ArrowDown' });
		select.value = 'Заголовок';
		select.fire('change');
		assert.deepEqual(picked, [], 'стрелка открыла окно для первого же имени');
		assert.equal(select.value, 'Заголовок', 'выбранное стрелкой имя сброшено');
		select.fire('keydown', { key: 'К' });
		select.value = 'КоличествоЗаписей';
		select.fire('change');
		assert.deepEqual(picked, []);
		// Enter действует на выбранное имя
		assert.equal(select.fire('keydown', { key: 'Enter' }), true);
		assert.deepEqual(picked, ['КоличествоЗаписей']);
		assert.equal(select.value, '', 'список не вернулся к подсказке');
		assert.equal(select.fire('keydown', { key: 'Enter' }), false, 'Enter без имени');
		// Выбор в раскрытом списке или мышью: change без клавиши на самом списке — сразу (после задачи клавиши)
		await new Promise((resolve) => setTimeout(resolve, 0));
		select.value = 'ТипМакета';
		select.fire('change');
		assert.deepEqual(picked, ['КоличествоЗаписей', 'ТипМакета']);
		// Alt+↓ раскрывает список: последующий выбор — сразу
		select.fire('keydown', { key: 'ArrowDown', altKey: true });
		select.value = 'Заголовок';
		select.fire('change');
		assert.deepEqual(picked.slice(-1), ['Заголовок']);
		// Имя, выбранное стрелкой, сбрасывается щелчком (то же имя мышью иначе не дало бы change) и уходом из списка
		await new Promise((resolve) => setTimeout(resolve, 0));
		select.fire('keydown', { key: 'ArrowDown' });
		select.value = 'Заголовок';
		select.fire('change');
		select.fire('mousedown');
		assert.equal(select.value, '');
		select.value = 'Заголовок';
		select.fire('blur');
		assert.equal(select.value, '');
		// Все три списка-действия — через него
		assert.ok(topFunction('renderOutputPanel(host, node, path, variantName) {').includes('actionSelect(select, (name) => {'));
		assert.ok(topFunction('caAppearanceEditor(body, initialItems) {').includes('actionSelect(addSelect, (name) => {'));
		assert.ok(topFunction('addSetControl() {').includes('actionSelect(select, (type) => {'));
	});

	test('значение параметра вывода списком: стрелки только листают, запись — Enter, уходом или мышью; Esc возвращает; имя и ключ фокуса', async () => {
		const sent: unknown[] = [];
		const code =
			'let renderingContent = false;\n' +
			topLine('SELECT_BROWSE_KEYS') +
			topFunction('browseSelect(select, commit, revert) {') +
			topFunction('outputValueControl(dict, values, path, variantName, name) {') +
			'\nreturn outputValueControl;';
		const selectInput = (options: Array<{ value: string }>, value: string): Node => {
			const select = el('select');
			select.value = value;
			select.setAttribute('data-options', options.map((option) => option.value).join(','));
			return select;
		};
		const outputValueControl = new Function('selectInput', 'numberInput', 'textInput', 'valueRaw', 'sendParameterValue', 'keyed', 'focusKey', 'document', code)(
			selectInput,
			() => el('input'),
			() => el('input'),
			(value: { decoded: string }) => value.decoded,
			(_variant: string, _section: string, _path: unknown, name: string, patch: unknown) => {
				sent.push([name, patch]);
				return true;
			},
			keyed,
			focusKey,
			doc
		) as (dict: unknown, values: unknown[], path: unknown[], variant: string, name: string) => Node;
		const dict = { control: 'enum', type: 'dcsset:DataCompositionTextPlacementType', options: [{ value: 'Auto' }, { value: 'Wrap' }, { value: 'Cut' }] };
		const select = doc.body.appendChild(outputValueControl(dict, [{ decoded: 'Auto' }], [], 'Основной', 'РасположениеТекста'));
		assert.equal(select.getAttribute('aria-label'), 'Значение «РасположениеТекста»');
		assert.equal(select.getAttribute('data-dcs-key'), 'outp\nvalue\nРасположениеТекста', 'фокус после ответа не вернётся в список');
		// Стрелка на закрытом списке (Chromium под Windows): change в той же задаче — файл не пишется
		select.fire('keydown', { key: 'ArrowDown' });
		select.value = 'Wrap';
		select.fire('change');
		assert.deepEqual(sent, [], 'первая же стрелка записала файл');
		select.fire('keydown', { key: 'ArrowDown' });
		select.value = 'Cut';
		select.fire('change');
		assert.equal(select.fire('keydown', { key: 'Enter' }), true);
		assert.deepEqual(sent, [['РасположениеТекста', { value: { type: dict.type, decoded: 'Cut' } }]]);
		// Пролистал и ушёл из списка — запись; пролистал и Esc — значение прежнее, записи нет
		await new Promise((resolve) => setTimeout(resolve, 0));
		select.fire('keydown', { key: 'ArrowUp' });
		select.value = 'Wrap';
		select.fire('change');
		select.fire('blur');
		assert.equal(sent.length, 2);
		await new Promise((resolve) => setTimeout(resolve, 0));
		select.fire('keydown', { key: 'ArrowUp' });
		select.value = 'Cut';
		select.fire('change');
		assert.equal(select.fire('keydown', { key: 'Escape' }), true);
		assert.equal(select.value, 'Auto', 'Esc не вернул значение');
		select.fire('blur');
		assert.equal(sent.length, 2, 'после Esc уход из списка записал значение');
		// Выбор мышью или в раскрытом списке — сразу; то же значение — без записи
		await new Promise((resolve) => setTimeout(resolve, 0));
		select.value = 'Wrap';
		select.fire('change');
		assert.equal(sent.length, 3);
		select.value = 'Auto';
		select.fire('change');
		assert.equal(sent.length, 3, 'прежнее значение записано заново');
		// Число и строка — с тем же именем и ключом
		const number = outputValueControl({ control: 'number', type: 'xs:decimal' }, [], [], 'Основной', 'МаксимальнаяШирина');
		assert.equal(number.getAttribute('aria-label'), 'Значение «МаксимальнаяШирина»');
		assert.equal(number.getAttribute('data-dcs-key'), 'outp\nvalue\nМаксимальнаяШирина');
		doc.body.textContent = '';
	});

	test('флажок «Параметров»: имя для читалки — параметр, ключ фокуса — по параметру; отказ канала возвращает флажок', () => {
		let accept = true;
		const sent: unknown[] = [];
		const code = NAME_HELPERS + topFunction('cell(tr, text, className) {') + topFunction('appendDataParamRow(tbody, row, path, variantName) {') + '\nreturn appendDataParamRow;';
		const stubs: Record<string, unknown> = {
			el,
			document: doc,
			keyed,
			focusKey,
			sendParameterValue: (_variant: string, section: string, _path: unknown, name: string, patch: unknown) => {
				sent.push([section, name, patch]);
				return accept;
			},
			userSettingBadge: () => null,
			paramItemsSummary: () => '',
			valuesSummary: () => '1',
			emptyParamValue: () => false,
			editableValues: () => true,
			actionsCell: (tr: Node) => tr.appendChild(el('td')),
			openParamValueDialog: () => undefined,
		};
		const appendDataParamRow = new Function(...Object.keys(stubs), code)(...Object.values(stubs)) as (tbody: Node, row: unknown, path: unknown[], variant: string) => void;
		const tbody = doc.body.appendChild(el('tbody'));
		appendDataParamRow(tbody, { name: 'Период', param: null, record: { parameter: 'Период', value: [] } }, [], 'Основной');
		const box = tbody.find((node) => node.tagName === 'INPUT')[0];
		assert.equal(box.getAttribute('aria-label'), 'Использовать: Период');
		assert.equal(box.getAttribute('data-dcs-key'), 'dparam\nuse\nПериод');
		box.checked = false;
		box.fire('change');
		assert.deepEqual(sent, [['data', 'Период', { use: false }]]);
		accept = false;
		box.checked = true;
		box.fire('change');
		assert.equal(box.checked, false, 'флажок не вернулся после отказа канала');
		doc.body.textContent = '';
		// «Другие настройки»: ключ фокуса флажка — по параметру
		assert.ok(topFunction('appendOutputRow(tbody, record, path, variantName, level, removable) {').includes("keyed(box, focusKey(['outp', 'use', name]));"));
	});
});

describe('«Настройки»: полоса вкладок узла исполняется', () => {
	function strip(kind: string, panel: string): { tabs(): Node[]; body(): Node; focused: string[]; renders(): number } {
		const focused: string[] = [];
		let renders = 0;
		const uiState = { panel, nodePath: [] as unknown[] };
		const host = doc.body.appendChild(el('div'));
		const panelStub = (withButton: boolean) => (body: Node): void => {
			body.appendChild(el('div', 'dcs-plate', 'текст'));
			if (withButton) {
				body.appendChild(el('button', '', 'команда'));
			}
		};
		const code =
			topBlock('NODE_PANELS', '];') +
			topLine('DEFAULT_NODE_PANEL') +
			topLine('FOCUSABLE') +
			NAME_HELPERS +
			topFunction('renderNodePanels(host, settings, variantName) {') +
			topFunction('pickNodePanel(id, focus) {') +
			'\nreturn { renderNodePanels };';
		const stubs: Record<string, unknown> = {
			el,
			document: doc,
			keyed,
			focusKey,
			uiState,
			nodeCaption: () => 'Отчет',
			isPseudoPath: () => false,
			nodeAt: () => ({}),
			nodeKindAt: () => kind,
			clearReplyFocus: () => undefined,
			focusKeyed: (key: string) => focused.push(key),
			renderGroupFieldsPanel: panelStub(true),
			renderDataParametersPanel: panelStub(true),
			renderSelectionPanel: panelStub(true),
			renderFilterPanel: panelStub(true),
			renderOrderPanel: panelStub(true),
			renderAppearancePanel: panelStub(true),
			renderUserFieldsPanel: panelStub(false),
			renderOutputPanel: panelStub(true),
		};
		let api: { renderNodePanels(host: Node, settings: unknown, variant: string): void };
		stubs.renderContent = () => {
			renders++;
			host.textContent = '';
			api.renderNodePanels(host, {}, 'Основной');
		};
		api = new Function(...Object.keys(stubs), code)(...Object.values(stubs)) as typeof api;
		api.renderNodePanels(host, {}, 'Основной');
		return {
			tabs: () => host.find((node) => node.getAttribute('role') === 'tab'),
			body: () => host.find((node) => node.getAttribute('role') === 'tabpanel')[0],
			focused,
			renders: () => renders,
		};
	}

	test('← → по кругу, Home, End: вкладка выбрана, фокус — на её ярлыке; одна остановка Tab; область связана с активным ярлыком', () => {
		const s = strip('root', 'selection');
		const titles = (): string[] => s.tabs().map((tab) => tab.textContent);
		assert.deepEqual(titles(), ['Параметры', 'Выбранные поля', 'Отбор', 'Сортировка', 'Условное оформление', 'Пользовательские поля', 'Другие настройки']);
		const check = (title: string): void => {
			const tabs = s.tabs();
			const active = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') as Node;
			assert.equal(active.textContent, title);
			assert.deepEqual(tabs.map((tab) => tab.tabIndex), tabs.map((tab) => (tab === active ? 0 : -1)), 'не одна остановка Tab');
			assert.deepEqual(tabs.filter((tab) => tab.getAttribute('aria-controls')), [active], 'aria-controls не только у активной');
			assert.equal(active.getAttribute('aria-controls'), s.body().id);
			assert.equal(s.body().getAttribute('aria-labelledby'), active.id);
		};
		check('Выбранные поля');
		const key = (k: string): boolean => {
			const active = s.tabs().find((tab) => tab.getAttribute('aria-selected') === 'true') as Node;
			return active.fire('keydown', { key: k });
		};
		assert.equal(key('ArrowLeft'), true);
		check('Параметры');
		assert.deepEqual(s.focused, ['subtab\ndataParameters']);
		key('ArrowLeft');
		check('Другие настройки');
		assert.equal(s.focused[1], 'subtab\noutput', '← с первой — на последнюю');
		key('ArrowRight');
		check('Параметры');
		key('End');
		check('Другие настройки');
		key('Home');
		check('Параметры');
		assert.equal(key('x'), false);
		assert.equal(s.renders(), 5);
		// Щелчок по активной — без перерисовки
		s.tabs()[0].fire('click');
		assert.equal(s.renders(), 5);
		doc.body.textContent = '';
	});

	test('область без элементов управления сама встаёт в обход Tab, с ними — нет', () => {
		const s = strip('root', 'userFields');
		assert.equal(s.body().tabIndex, 0);
		assert.equal(s.body().tabIndexSet, true);
		s.tabs()[1].fire('click');
		assert.equal(s.body().tabIndexSet, false, 'у области с кнопкой tabindex лишний');
		doc.body.textContent = '';
	});
});

describe('Без постоянных пояснений: вкладки схемы, «Настройки», их окна, конструктор настроек', () => {
	test('постоянная подпись struct-hint — только у сводки в подтверждении мастера', () => {
		const left = [...SCRIPT.matchAll(/'struct-hint[^']*',\s*'([^']{0,20})/g)].map((match) => match[1]);
		assert.deepEqual(left, ['Останутся как были: ']);
	});

	test('смысл неочевидного элемента — подсказкой и описанием для читалки (setHint), пустой список — своим текстом', () => {
		const setHint = topFunction('setHint(node, text) {');
		assert.ok(setHint.includes('node.title = text;') && setHint.includes("node.setAttribute('aria-description', text);"));
		const total = topFunction('openTotalFieldDialog(item, index) {');
		assert.ok(total.includes("listEl.setAttribute('role', 'group');") && total.includes("listEl.setAttribute('aria-label', 'Рассчитывать по');"));
		assert.ok(total.includes("setHint(listEl, 'Без отметок ресурс считается по всем группировкам.');"));
		assert.ok(total.includes("emptyNote(body, 'Полей нет: ресурс считается по всем группировкам.');"));
		const group = topFunction('openAddGroupDialog(settings, variantName, target, preset) {');
		assert.ok(group.includes("const noFieldsHint = 'Без полей группировка выводит детальные записи.';"));
		assert.ok(group.includes('setHint(listEl, noFieldsHint);') && group.includes('setHint(extraInput, noFieldsHint);'));
		assert.ok(topFunction('boundaryEditor(body, labelText, original) {').includes("setHint(fieldInput, 'Граница-поле видна пользователю, если параметр включён в доступные поля.');"));
		assert.ok(topFunction('caFieldsEditor(body, initialFields) {').includes("el('div', 'empty', 'Полей нет: оформляется вся область действия элемента.')"));
		// Мастер: вид отчёта — подсказка карточки и описание переключателя, вложенность — подсказка списка цели
		assert.ok(SCRIPT.includes('card.title = WIZARD_TYPE_HINTS[type.value];'));
		assert.ok(SCRIPT.includes("radio.setAttribute('aria-description', WIZARD_TYPE_HINTS[type.value]);"));
		assert.ok(SCRIPT.includes('setHint(listEl, WIZARD_NESTING_HINT);'));
		// Объединение: остаётся только текст пустого объединения
		assert.ok(topFunction('renderDataSetBody(host, dataSet, nested) {').includes("el('div', 'dcs-sets-note', 'В объединении нет наборов.')"));
	});

	test('свойства варианта: предупреждение о переименовании — только пока имя другое, живой областью', () => {
		const dialog: { build?: (body: Node) => void } = {};
		const inputs: Node[] = [];
		const open = new Function(
			'el',
			'list',
			'openDialog',
			'formRow',
			'textInput',
			'send',
			'BUSY',
			'closeDialog',
			'replyFocus',
			topFunction('openVariantPropsDialog(variant, fromGrid) {') + '\nreturn openVariantPropsDialog;'
		)(
			el,
			() => [{ name: 'Основной' }, { name: 'Сводный' }],
			(_title: string, _ok: string, build: (body: Node) => void) => {
				dialog.build = build;
			},
			(host: Node, _label: string, control: Node) => {
				host.appendChild(control);
				inputs.push(control);
				return control;
			},
			(value: string) => {
				const input = el('input');
				input.value = value || '';
				return input;
			},
			() => true,
			'busy',
			() => undefined,
			{ variant: false }
		) as (variant: unknown, fromGrid: boolean) => void;
		open({ name: 'Основной', value: 'Основной вариант' }, false);
		const body = el('div');
		assert.ok(dialog.build, 'окно не открылось');
		dialog.build(body);
		const warn = body.find((node) => node.className === 'dcs-warn')[0];
		assert.ok(warn, 'места предупреждения нет');
		assert.equal(warn.getAttribute('aria-live'), 'polite');
		assert.equal(warn.textContent, '', 'без переименования предупреждения нет');
		inputs[1].value = 'Другое представление';
		inputs[1].fire('input');
		assert.equal(warn.textContent, '', 'правка представления не предупреждает');
		inputs[0].value = 'Основной2';
		inputs[0].fire('input');
		assert.equal(warn.textContent, 'На имя варианта могут ссылаться код конфигурации и сохранённые настройки пользователей.');
		inputs[0].value = ' Основной ';
		inputs[0].fire('input');
		assert.equal(warn.textContent, '', 'имя вернули — предупреждение ушло');
	});
});

describe('«Условие» в окне условного оформления: фокус после правки, флажки, кнопки у края и форма', () => {
	interface MiniEditor {
		current(): Array<Record<string, unknown>>;
		formOpen(): boolean;
	}

	/** filterMiniEditor как есть, с таблицей, строками и правками копии; формы условия и вид ячеек — заглушки. */
	function mini(items: unknown[]): { editor: MiniEditor; host: Node; zones: Array<{ drag(): string }> } {
		const zones: Array<{ drag(): string }> = [];
		const code =
			'let filterTableSeq = 0;\n' +
			NAME_HELPERS +
			topLine('MINI_FIRST_NOTE') +
			topLine('MINI_LAST_NOTE') +
			topLine('MINI_FORM_OPEN') +
			topBlock('LEVEL_WORDS', '});') +
			[
				'posKey(pos) {',
				'miniKey(pos, action) {',
				'itemsLevel(items, parent) {',
				'itemAtPos(items, pos) {',
				'itemsOutdentSlot(items, pos) {',
				'itemsIndentSlot(items, pos, container) {',
				'itemsMove(items, from, slot) {',
				'levelItems(items, pos) {',
				'posAfterRemoval(items, pos) {',
				'selItemAt(items, pos) {',
				'selListAt(items, pos) {',
				'countSelItems(items) {',
				'cell(tr, text, className) {',
				'actionsCell(tr, actions) {',
				'renderFilterTable(host, ctx) {',
				'appendFilterRows(tbody, ctx, listItems, posPrefix, depth, drag) {',
				'moveFilterItem(ctx, pos, delta) {',
				'removeFilterItem(ctx, item, pos, onSent) {',
				'applyFilterForm(ctx, form, pos, parentPos, index) {',
				'firstControl(root) {',
				'findByAttribute(root, name, value) {',
				'filterMiniEditor(host, initialItems, emptyText) {',
			]
				.map(topFunction)
				.join('') +
			'\nreturn filterMiniEditor;';
		/** Форма условия: одно поле «Поле»; apply пишет его в элемент. */
		const form = (body: Node, item: { left?: string } | null) => {
			const input = body.appendChild(el('input'));
			input.value = item && item.left ? item.left : '';
			return {
				validate: () => undefined,
				apply: (ref: Record<string, unknown>) => {
					ref.kind = 'comparison';
					ref.left = input.value;
				},
			};
		};
		const stubs: Record<string, unknown> = {
			el,
			document: doc,
			keyed,
			iconButton: iconButtonStub,
			dataTable: (host: Node) => {
				const table = host.appendChild(el('table'));
				table.appendChild(el('thead')).appendChild(el('tr'));
				return table.appendChild(el('tbody'));
			},
			tableDropZone: (_host: Node, spec: { drag(): string }) => zones.push(spec),
			listDropSlot: () => null,
			cloneItems: (list: unknown) => JSON.parse(JSON.stringify(list)),
			filterGroupTypeLabel: () => 'И',
			comparisonLabel: () => 'Равно',
			valuesSummary: () => '',
			userSettingBadge: () => null,
			filterRowLabel: (item: { kind: string; left?: string }) => (item.kind === 'group' ? 'Группа И' : String(item.left)),
			confirmRemove: (_question: string, submit: () => unknown) => submit(),
			buildComparisonForm: form,
			buildGroupForm: form,
			BUSY: 'busy',
		};
		const factory = new Function(...Object.keys(stubs), code)(...Object.values(stubs)) as (host: Node, list: unknown[], empty: string) => MiniEditor;
		const host = doc.body.appendChild(el('div'));
		return { editor: factory(host, items, 'Условий нет.'), host, zones };
	}

	const key = (node: Node): string | null => node.getAttribute('data-mini-key');
	const byKey = (host: Node, value: string): Node => {
		const found = host.find((node) => node.getAttribute('data-mini-key') === value)[0];
		assert.ok(found, 'нет элемента ' + value);
		return found;
	};
	const note = (host: Node): Node => host.find((node) => node.className === 'dcs-mini-note')[0];
	const SAMPLE = [
		{ kind: 'comparison', left: 'А' },
		{ kind: 'group', items: [{ kind: 'comparison', left: 'Б' }, { kind: 'comparison', left: 'В' }] },
	];

	test('«Вынести из группы» и «Перенести в группу выше» с клавиатуры: фокус — за строкой, на её новом месте (не на body)', () => {
		const m = mini(SAMPLE);
		const out = byKey(m.host, '[1,0]|outdent');
		assert.equal(out.getAttribute('aria-label'), 'Вынести из группы');
		out.focus();
		out.fire('click');
		assert.deepEqual(
			m.editor.current().map((item) => item.left || 'группа'),
			['А', 'группа', 'Б'],
			'«Б» не встало за группу'
		);
		// У строки на верхнем уровне «Вынести из группы» нет: фокус — на её «Править»
		assert.notEqual(doc.activeElement, doc.body, 'фокус ушёл на body');
		assert.equal(key(doc.activeElement), '[2]|edit');
		const into = byKey(m.host, '[2]|indent');
		into.focus();
		into.fire('click');
		assert.deepEqual((m.editor.current()[1].items as Array<{ left: string }>).map((item) => item.left), ['В', 'Б']);
		assert.ok(String(key(doc.activeElement)).startsWith('[1,1]|'), 'фокус не у перенесённой строки: ' + key(doc.activeElement));
		doc.body.textContent = '';
	});

	test('флажок строки: имя — условие; после переключения фокус на нём же; «Выше» у края — недоступна с причиной в живой строке', () => {
		const m = mini(SAMPLE);
		const box = byKey(m.host, '[0]|use');
		assert.equal(box.getAttribute('aria-label'), 'Использовать: А');
		box.focus();
		box.checked = false;
		box.fire('change');
		assert.equal(m.editor.current()[0].use, false);
		assert.equal(key(doc.activeElement), '[0]|use', 'фокус после флажка потерян');
		assert.notEqual(doc.activeElement, box, 'таблица не перерисована');
		const up = byKey(m.host, '[0]|up');
		assert.equal(up.getAttribute('aria-disabled'), 'true');
		assert.equal(up.disabled, false, '«Выше» у края выпала из обхода Tab');
		assert.equal(up.getAttribute('aria-description'), 'Условие уже первое на своём уровне.');
		const note0 = note(m.host);
		assert.equal(note0.getAttribute('role'), 'status');
		assert.equal(note0.getAttribute('aria-live'), 'polite');
		up.fire('click');
		assert.equal(note0.textContent, 'Недоступно: условие уже первое на своём уровне.');
		assert.deepEqual(m.editor.current().map((item) => item.left || 'группа'), ['А', 'группа']);
		// «Ниже» — та же кнопка на новом месте строки
		const down = byKey(m.host, '[0]|down');
		down.focus();
		down.fire('click');
		assert.deepEqual(m.editor.current().map((item) => item.left || 'группа'), ['группа', 'А']);
		assert.equal(key(doc.activeElement), '[1]|down');
		assert.equal(doc.activeElement.getAttribute('aria-disabled'), 'true', 'строка теперь последняя');
		doc.body.textContent = '';
	});

	test('открытая форма: фокус в первое поле; перестановки, флажки и перенос мышью ждут «Применить» или «Отмена»; фокус возвращается', () => {
		const m = mini(SAMPLE);
		const edit = byKey(m.host, '[0]|edit');
		edit.focus();
		edit.fire('click');
		assert.equal(m.editor.formOpen(), true);
		const field = doc.activeElement;
		assert.equal(field.tagName, 'INPUT', 'фокус не в форме');
		assert.equal(field.value, 'А');
		field.value = 'Сумма';
		// Флажок другой строки: правка не уходит, набранное в форме не пропадает
		const box = byKey(m.host, '[1]|use');
		box.checked = false;
		box.fire('change');
		assert.equal(box.checked, true, 'флажок не вернулся');
		assert.equal(m.editor.current()[1].use, undefined);
		assert.equal(note(m.host).textContent, 'Примените или отмените правку условия.');
		assert.equal(m.editor.formOpen(), true, 'форма закрыта перерисовкой');
		assert.equal(field.value, 'Сумма');
		byKey(m.host, '[1,0]|outdent').fire('click');
		assert.equal((m.editor.current()[1].items as unknown[]).length, 2, 'строка вынесена при открытой форме');
		assert.equal(m.zones[m.zones.length - 1].drag(), '', 'строку можно тащить при открытой форме');
		// «Отмена» — фокус на «Править», которая открыла форму
		const buttons = m.host.find((node) => node.tagName === 'BUTTON');
		buttons.find((node) => node.textContent === 'Отмена')?.fire('click');
		assert.equal(m.editor.formOpen(), false);
		assert.equal(key(doc.activeElement), '[0]|edit');
		assert.equal(m.zones[m.zones.length - 1].drag(), 'item');
		// «Применить» — фокус на «Править» той же строки, правка в копии
		const again = byKey(m.host, '[0]|edit');
		again.focus();
		again.fire('click');
		doc.activeElement.value = 'Цена';
		m.host.find((node) => node.tagName === 'BUTTON' && node.textContent === 'Применить')[0].fire('click');
		assert.equal(m.editor.current()[0].left, 'Цена');
		assert.equal(key(doc.activeElement), '[0]|edit');
		doc.body.textContent = '';
	});

	test('удаление: фокус — на «Удалить» строки, занявшей место (у последней — предыдущей), без строк — на «Добавить условие…»', () => {
		const m = mini([{ kind: 'comparison', left: 'А' }, { kind: 'comparison', left: 'Б' }]);
		const last = byKey(m.host, '[1]|delete');
		last.focus();
		last.fire('click');
		assert.equal(key(doc.activeElement), '[0]|delete');
		doc.activeElement.fire('click');
		assert.equal(m.editor.current().length, 0);
		assert.equal(key(doc.activeElement), '|add-comparison');
		assert.equal(doc.activeElement.getAttribute('aria-label'), 'Добавить условие…');
		doc.body.textContent = '';
	});
});

describe('«Доступные поля» «Настроек»: реквизиты ссылочных полей по типу', () => {
	interface Level {
		children: Array<{ name: string; path: string; kind: string; typeExpandable: boolean; typeChain: unknown[] }>;
		pending: unknown[];
	}

	/** settingsTypeLevel и typeAttributeLevel как есть: каталог раздела, модуль типов и окружение подсказки — заглушки. */
	function typeLevels(catalog: { nodes: unknown[] }) {
		const asked: Array<[string, string, string]> = [];
		const state = { stamp: 0 };
		const code =
			'let model = {};\n' +
			topLine('WIZARD_TYPE_KINDS') +
			topLine('SETTINGS_ATTRIBUTE_FLAGS') +
			topLine('settingsTypeCaches') +
			['wizardKey(path) {', 'wizardNodeIndex(catalog) {', 'typeAttributeLevel(node, chain, scope, flag, fieldIndex) {', 'settingsTypeLevel(section, node) {'].map(topFunction).join('') +
			'\nreturn settingsTypeLevel;';
		const fieldTypes = {
			extraChildrenFor: (info: { chain: Array<{ path: string }> }, path: string, env: { scope: string }) => {
				asked.push([path, env.scope, info.chain.map((node) => node.path).join(' > ')]);
				if (path === 'Контрагент') {
					return { children: [{ name: 'ИНН', title: 'ИНН', valueType: { types: ['xs:string'] } }, { name: 'Ответственный', expandable: true }], pending: [] };
				}
				if (path === 'Склад') {
					return { children: [{ name: 'Код' }], pending: [{ key: 'Справочник.Склады' }] };
				}
				return { children: [], pending: [] };
			},
		};
		const factory = new Function('fieldTypes', 'completionCatalog', 'typeChildrenEnv', 'describeStamp', withCoreAccessors(code));
		// describeStamp — значение на момент сборки: отметку проверяет кэш, сам расчёт её не меняет
		const level = factory(
			fieldTypes,
			() => catalog,
			(scope: string) => ({ scope }),
			state.stamp
		) as (section: string, node: unknown) => Level | null;
		return { level, asked };
	}

	const CATALOG = {
		nodes: [
			{ name: 'Контрагент', path: 'Контрагент', kind: 'field', children: [], attributeRestrict: null },
			{ name: 'Склад', path: 'Склад', kind: 'field', children: [{ name: 'Код', path: 'Склад.Код', kind: 'field', children: [] }], attributeRestrict: { field: false, condition: true, group: false, order: false } },
			{ name: 'Папка', path: 'Папка', kind: 'folder', children: [] },
			{ name: 'Сумма', path: 'Сумма', kind: 'total', children: [] },
		],
	};

	test('реквизиты поля — тот же расчёт, что у конструктора настроек: путь через точку, вид «поле», цепочка каталога; кэш на каталог', () => {
		const { level, asked } = typeLevels(CATALOG);
		const contractor = level('selection', CATALOG.nodes[0]);
		assert.ok(contractor);
		assert.deepEqual(
			contractor.children.map((child) => [child.path, child.kind, child.typeExpandable]),
			[
				['Контрагент.ИНН', 'field', false],
				['Контрагент.Ответственный', 'field', true],
			]
		);
		assert.deepEqual(asked, [['Контрагент', 'settings:selection', 'Контрагент']], 'окружение подсказки раздела');
		assert.equal(level('selection', CATALOG.nodes[0]), contractor, 'повторная отрисовка считает заново');
		// Реквизит реквизита: цепочка — та же, путь идёт по типам
		level('selection', contractor.children[1]);
		assert.deepEqual(asked[1], ['Контрагент.Ответственный', 'settings:selection', 'Контрагент']);
		// Не раскрываются по типу: папка и ресурс (его путь — путь поля набора)
		assert.equal(level('selection', CATALOG.nodes[2]), null);
		assert.equal(level('selection', CATALOG.nodes[3]), null);
	});

	test('ограничение реквизитов раздела: в «Отборе» у «Склада» реквизиты запрещены — не предлагаются; свои поля схемы не повторяются', () => {
		const { level } = typeLevels(CATALOG);
		const filter = level('filter', CATALOG.nodes[1]);
		assert.deepEqual(filter, { children: [], pending: [] }, 'запрещённый в отборе реквизит предложен');
		const selection = level('selection', CATALOG.nodes[1]);
		assert.ok(selection);
		// «Склад.Код» уже есть в схеме (строка каталога): по типу второй раз не идёт; описание ещё читается — pending
		assert.deepEqual(selection.children, []);
		assert.deepEqual(selection.pending, [{ key: 'Справочник.Склады' }]);
	});
});
