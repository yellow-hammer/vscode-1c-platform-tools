/**
 * Вкладки схемы редактора СКД: таблица полей набора, текст запроса набора, закладка «Ресурсы».
 *
 * Функции dcs-editor.js исполняются как есть, вырезанные по сигнатуре: DOM и канал панели — мини-заглушки. Здесь —
 * правила и обработчики, на которых держится поведение; скрипт целиком, с настоящей перерисовкой страницы и окнами
 * VS Code, эти тесты не запускают: вид, фокус в настоящем окне и читалка проверяются вручную.
 * Функции закладок лежат в модулях рядом с ядром dcs-editor.js (общий текст частей даёт dcsEditorScript.ts). Код закладки
 * берёт общее изменяемое состояние полями объекта ядра (core.model…): в тесте это аксессоры к переменным теста.
 * Запуск: npm run compile && node --test out/test/metadata/dcsSchemaTabs.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { readEditorPart, readEditorScript, withCoreAccessors } from '../fixtures/helpers/dcsEditorScript';

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const ROOT = path.resolve(__dirname, '../../..');
const WEBVIEW = path.join(ROOT, 'resources', 'webview');
const SCRIPT = readEditorScript();

/**
 * Модуль webview без DOM в текущем realm, как в остальных node-тестах: обёртка-функция вместо нового контекста vm (объекты
 * чужого realm не проходят deepStrictEqual), параметр window не даёт модулю писать в глобалы теста.
 */
function loadModule(name: string): unknown {
	const file = path.join(WEBVIEW, name);
	const factory = vm.runInThisContext(`(function (module, window) {\n${fs.readFileSync(file, 'utf8')}\n})`, { filename: file }) as (
		moduleShim: { exports: unknown },
		windowShim: Record<string, unknown>
	) => void;
	const moduleShim: { exports: unknown } = { exports: {} };
	factory(moduleShim, {});
	return moduleShim.exports;
}

/** Функция верхнего уровня скрипта (отступ — один таб) по началу сигнатуры, с телом. */
function topFunction(signature: string): string {
	const start = SCRIPT.indexOf('\n\tfunction ' + signature);
	assert.ok(start >= 0, `нет function ${signature}`);
	const end = SCRIPT.indexOf('\n\t}\n', start);
	return SCRIPT.slice(start, end + 4);
}

/** Массив-константа верхнего уровня: от «const ИМЯ = [» до «];» на отступе один таб. */
function topConst(name: string): string {
	const start = SCRIPT.indexOf('\n\tconst ' + name + ' = [\n');
	assert.ok(start >= 0, `нет const ${name} = [`);
	const end = SCRIPT.indexOf('\n\t];\n', start);
	return SCRIPT.slice(start, end + 4);
}

/** Однострочная константа верхнего уровня («const ИМЯ = …;»). */
function topLine(name: string): string {
	const start = SCRIPT.indexOf('\n\tconst ' + name + ' = ');
	assert.ok(start >= 0, `нет const ${name}`);
	return SCRIPT.slice(start, SCRIPT.indexOf('\n', start + 1) + 1);
}

/** Раздел скрипта между заголовками-комментариями. */
function section(from: string, to: string): string {
	const start = SCRIPT.indexOf(from);
	const end = SCRIPT.indexOf(to, start + from.length);
	assert.ok(start >= 0 && end > start, `нет раздела ${from}`);
	return SCRIPT.slice(start, end);
}

/** Узел мини-DOM: атрибуты, дети с родителем, события, фокус и значение поля. */
class Node {
	tagName: string;
	className: string;
	children: Node[] = [];
	parentElement: Node | null = null;
	id = '';
	title = '';
	type = '';
	value = '';
	placeholder = '';
	checked = false;
	disabled = false;
	spellcheck = true;
	tabIndex = 0;
	scrollTop = 0;
	selectionStart: number | null = null;
	selectionEnd: number | null = null;
	style: Record<string, string> = {};
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

	/** Классы поверх className: toggle и contains, как у DOMTokenList. */
	get classList(): { toggle(name: string, on?: boolean): boolean; contains(name: string): boolean } {
		return {
			toggle: (name: string, on?: boolean): boolean => {
				const names = new Set(this.className.split(/\s+/).filter(Boolean));
				const want = on === undefined ? !names.has(name) : on;
				if (want) {
					names.add(name);
				} else {
					names.delete(name);
				}
				this.className = [...names].join(' ');
				return want;
			},
			contains: (name: string): boolean => this.className.split(/\s+/).includes(name),
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

	contains(node: Node | null): boolean {
		for (let current = node; current; current = current.parentElement) {
			if (current === this) {
				return true;
			}
		}
		return false;
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
				isComposing: false,
				altKey: false,
				ctrlKey: false,
				metaKey: false,
				shiftKey: false,
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

	setSelectionRange(start: number, end: number): void {
		this.selectionStart = start;
		this.selectionEnd = end;
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

/** Документ заглушки: body и активный узел (отключённый от документа фокус теряет — остаётся body). */
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

/** Имена с местами переноса (setNameText, nameEl) — как есть: ими строят ячейки (cell) и подписи дерева полей. */
const NAME_HELPERS = topFunction('setNameText(node, text) {') + topFunction('nameEl(tag, className, text) {');

describe('Таблица полей набора: путь к данным и флажки ограничений прямо в строке', () => {
	test('проверка пути — одна у ячейки и окна поля: пусто, занятый без учёта регистра; свой путь и смена его регистра — можно', () => {
		const factory = new Function(topFunction('nameTaken(names, name, own) {') + topFunction('fieldPathProblem(paths, dataPath, original) {') + '\nreturn fieldPathProblem;') as () => (
			paths: string[],
			dataPath: string,
			original?: string
		) => string | undefined;
		const problem = factory();
		const paths = ['Склад', 'Сумма', 'Папка'];
		assert.equal(problem(paths, '', 'Сумма'), 'Укажите путь к данным.');
		assert.equal(problem(paths, 'склад', 'Сумма'), 'Поле с таким путём к данным уже есть в наборе.');
		assert.equal(problem(paths, 'ПАПКА', 'Сумма'), 'Поле с таким путём к данным уже есть в наборе.', 'папка — тоже путь набора');
		assert.equal(problem(paths, 'Сумма', 'Сумма'), undefined);
		assert.equal(problem(paths, 'сумма', 'Сумма'), undefined, 'смена регистра своего пути');
		assert.equal(problem(paths, 'Выручка', 'Сумма'), undefined);
		assert.equal(problem(paths, 'Склад', undefined), 'Поле с таким путём к данным уже есть в наборе.', 'новое поле окна');
		// Окно поля зовёт ту же функцию, а не свою копию текстов
		const dialog = topFunction('openFieldDialog(setName, field) {');
		assert.ok(dialog.includes('fieldPathProblem(dataSetFieldPaths(setName), dataPath, original.dataPath)'), 'окно поля проверяет путь не той функцией');
		assert.ok(!dialog.includes("'Укажите путь к данным.'"), 'у окна своя копия проверки');
	});

	test('флажки: в шапке названия целиком, как у конфигуратора, смысл — в подсказке; две группы', () => {
		const factory = new Function(
			topConst('RESTRICTION_COLUMNS') + topConst('RESTRICTION_GROUPS') + topFunction('restrictionHint(group, column) {') + '\nreturn { RESTRICTION_COLUMNS, RESTRICTION_GROUPS, restrictionHint };'
		) as () => {
			RESTRICTION_COLUMNS: Array<{ key: string; label: string; name: string; hint: string }>;
			RESTRICTION_GROUPS: Array<{ key: string; title: string; subject: string }>;
			restrictionHint(group: unknown, column: unknown): string;
		};
		const { RESTRICTION_COLUMNS, RESTRICTION_GROUPS, restrictionHint } = factory();
		assert.deepEqual(
			RESTRICTION_COLUMNS.map((column) => [column.key, column.label, column.name]),
			[
				['field', 'Поле', 'Поле'],
				['condition', 'Условие', 'Условие'],
				['group', 'Группа', 'Группа'],
				['order', 'Упорядочивание', 'Упорядочивание'],
			]
		);
		// Заголовок колонки флажка — только название: группу читалка называет заголовком над колонками
		const table = section('\tfunction renderFieldsTable(host, dataSet, readOnly) {', '\tfunction fieldRow(');
		assert.ok(table.includes("headCell(sub, column.label, {\n\t\t\t\t\t\tclassName: 'dcs-th-check' + (index === 0 ? ' dcs-col-sep' : ''),\n\t\t\t\t\t\ttitle: restrictionHint(group, column),\n\t\t\t\t\t});"));
		assert.ok(!table.includes("label: group.title + ': ' + column.name"), 'группа в заголовке колонки звучит дважды');
		assert.deepEqual(
			RESTRICTION_GROUPS.map((group) => [group.key, group.title]),
			[
				['useRestriction', 'Ограничение поля'],
				['attributeUseRestriction', 'Ограничение реквизитов'],
			]
		);
		assert.equal(restrictionHint(RESTRICTION_GROUPS[0], RESTRICTION_COLUMNS[1]), 'Ограничение поля «Условие»: поле нельзя использовать в отборе');
		assert.equal(restrictionHint(RESTRICTION_GROUPS[1], RESTRICTION_COLUMNS[3]), 'Ограничение реквизитов «Упорядочивание»: реквизиты поля нельзя упорядочивать');
		// Флажок шлёт всё ограничение, как окно поля (restrictionOf): четыре ключа
		const cells = topFunction('restrictionCells(tr, setName, field, group, readOnly) {');
		assert.ok(cells.includes('for (const flag of RESTRICTION_COLUMNS) {\n\t\t\t\t\tnext[flag.key] = Boolean(current[flag.key]);'), 'флажок шлёт не всё ограничение');
		assert.ok(cells.includes("box.setAttribute('aria-label', group.title + ' «' + (field.dataPath || '') + '»: ' + column.name);"));
	});

	interface FocusApi {
		focusKey(parts: string[]): string;
		keyed(node: Node, key: string): Node;
		renamedFocusKey(key: string, rename: { scope: string; from: string; to: string } | null): string | null;
		captureFocus(roots: Node[]): Record<string, unknown> | null;
		restoreFocus(snap: Record<string, unknown> | null): void;
		setRename(rename: { scope: string; from: string; to: string } | null): void;
		keys: Map<string, Node>;
	}

	/** Раздел фокуса dcs-editor.js как есть: document — заглушка. */
	function focusApi(): FocusApi {
		const code = section('// ---------- фокус после перерисовки вкладки схемы ----------', '// ---------- каркас вкладок ----------');
		const factory = new Function(
			'document',
			code + '\nreturn { focusKey, keyed, renamedFocusKey, captureFocus, restoreFocus, setRename: (r) => { pendingRename = r; }, keys: focusKeys };'
		) as (document: typeof doc) => FocusApi;
		return factory(doc);
	}

	test('ключ узла после переименования: подменяется только прежнее имя в своём наборе', () => {
		const api = focusApi();
		const rename = { scope: 'Продажи', from: 'Сумма', to: 'Выручка' };
		assert.equal(api.renamedFocusKey(api.focusKey(['fpath', 'Продажи', 'Сумма']), rename), 'fpath\nПродажи\nВыручка');
		assert.equal(api.renamedFocusKey(api.focusKey(['fflag', 'Продажи', 'Сумма', 'useRestriction', 'order']), rename), 'fflag\nПродажи\nВыручка\nuseRestriction\norder');
		assert.equal(api.renamedFocusKey(api.focusKey(['fpath', 'Остатки', 'Сумма']), rename), null, 'чужой набор');
		assert.equal(api.renamedFocusKey(api.focusKey(['fpath', 'Продажи', 'СуммаНДС']), rename), null, 'другое поле');
		assert.equal(api.renamedFocusKey(api.focusKey(['tab', 'resources']), rename), null);
		assert.equal(api.renamedFocusKey('fpath\nПродажи\nСумма', null), null);
	});

	test('фокус после перерисовки: тот же ключ, под новым именем после переименования, недописанное и выделение остаются', () => {
		const api = focusApi();
		const content = doc.body.appendChild(el('section'));
		const draw = (pathValue: string, titleValue: string): { path: Node; title: Node } => {
			content.textContent = '';
			api.keys.clear();
			const path = el('input');
			path.type = 'text';
			path.value = pathValue;
			const title = el('input');
			title.type = 'text';
			title.value = titleValue;
			content.appendChild(api.keyed(path, api.focusKey(['fpath', 'Продажи', pathValue])));
			content.appendChild(api.keyed(title, api.focusKey(['ftitle', 'Продажи', pathValue])));
			return { path, title };
		};
		// Недописанный заголовок: перерисовка от чужой правки (значение в модели то же) его не стирает
		let nodes = draw('Сумма', 'Сумма продаж');
		nodes.title.focus();
		nodes.title.value = 'Сумма прод';
		nodes.title.setSelectionRange(4, 10);
		let snap = api.captureFocus([content]);
		nodes = draw('Сумма', 'Сумма продаж');
		api.restoreFocus(snap);
		assert.equal(doc.activeElement, nodes.title);
		assert.equal(nodes.title.value, 'Сумма прод');
		assert.deepEqual([nodes.title.selectionStart, nodes.title.selectionEnd], [4, 10]);
		// Правка поменяла само значение (пришёл новый заголовок): набранное не навязывается
		nodes.title.value = 'Черновик';
		snap = api.captureFocus([content]);
		nodes = draw('Сумма', 'Выручка за месяц');
		api.restoreFocus(snap);
		assert.equal(nodes.title.value, 'Выручка за месяц');
		// Переименование: ключи строки содержат путь — узел ищется под новым
		nodes.path.focus();
		nodes.path.setSelectionRange(1, 3);
		snap = api.captureFocus([content]);
		api.setRename({ scope: 'Продажи', from: 'Сумма', to: 'Выручка' });
		nodes = draw('Выручка', 'Выручка за месяц');
		api.restoreFocus(snap);
		assert.equal(doc.activeElement, nodes.path, 'фокус не нашёл ячейку под новым путём');
		assert.deepEqual([nodes.path.selectionStart, nodes.path.selectionEnd], [1, 3]);
		// Отрисовка сама поставила фокус — снимок с ней не спорит
		snap = api.captureFocus([content]);
		nodes = draw('Выручка', 'Выручка за месяц');
		nodes.title.focus();
		api.restoreFocus(snap);
		assert.equal(doc.activeElement, nodes.title);
		// Фокус вне корней и узел без ключа — снимка нет
		const outside = doc.body.appendChild(el('button'));
		outside.focus();
		assert.equal(api.captureFocus([content]), null);
		const plain = content.appendChild(el('button'));
		plain.focus();
		assert.equal(api.captureFocus([content]), null);
		doc.body.textContent = '';
	});

	interface EditorHarness {
		input: Node;
		error: Node;
		sent: Array<Record<string, unknown>>;
		rename(): unknown;
		pathCommit(): unknown;
		setSaving(value: boolean): void;
		setRendering(value: boolean): void;
		setWindowFocus(value: boolean): void;
		drafts: Map<string, unknown>;
	}

	/** fieldPathEditor как есть: канал (send/saving), пути набора, ключи и фокус окна (document.hasFocus) — заглушки. */
	function pathEditor(original: string, paths: string[], busy = false, drafts?: Array<[string, unknown]>): EditorHarness {
		const sent: Array<Record<string, unknown>> = [];
		const code =
			'let saving = false;\nlet renderingContent = false;\nlet pendingRename = null;\nlet pendingPathCommit = null;\nlet cellErrorCount = 0;\nconst fieldPathDrafts = new Map(initialDrafts);\n' +
			topFunction('windowHasFocus() {') +
			topFunction('nameTaken(names, name, own) {') +
			topFunction('fieldPathProblem(paths, dataPath, original) {') +
			topFunction('cellCommitter(commit) {') +
			topLine('PATH_BUSY') +
			topFunction('fieldPathEditor(td, setName, original) {') +
			'\nreturn { fieldPathEditor, rename: () => pendingRename, pathCommit: () => pendingPathCommit, setSaving: (v) => { saving = v; }, setRendering: (v) => { renderingContent = v; }, drafts: fieldPathDrafts };';
		const factory = new Function('el', 'keyed', 'focusKey', 'dataSetFieldPaths', 'send', 'document', 'initialDrafts', withCoreAccessors(code)) as (...args: unknown[]) => {
			fieldPathEditor(td: Node, setName: string, original: string): void;
			rename(): unknown;
			pathCommit(): unknown;
			setSaving(value: boolean): void;
			setRendering(value: boolean): void;
			drafts: Map<string, unknown>;
		};
		let harness: ReturnType<typeof factory>;
		let windowFocus = true;
		const api = factory(
			el,
			(node: Node, key: string) => {
				node.setAttribute('data-dcs-key', key);
				return node;
			},
			(parts: string[]) => parts.join('\n'),
			() => paths,
			(type: string, fields: Record<string, unknown>) => {
				if (busy) {
					return false;
				}
				sent.push(Object.assign({ type }, fields));
				harness.setSaving(true);
				return true;
			},
			{ hasFocus: () => windowFocus },
			drafts || []
		);
		harness = api;
		const td = doc.body.appendChild(el('td'));
		api.fieldPathEditor(td, 'Продажи', original);
		return {
			input: td.children[0],
			error: td.children[1],
			sent,
			rename: api.rename,
			pathCommit: api.pathCommit,
			setSaving: api.setSaving,
			setRendering: api.setRendering,
			setWindowFocus: (value: boolean) => {
				windowFocus = value;
			},
			drafts: api.drafts,
		};
	}

	test('путь в ячейке: отказ проверки — под полем, связан с ним, текст остаётся, ничего не уходит; Esc откатывает', () => {
		const h = pathEditor('Сумма', ['Склад', 'Сумма']);
		assert.equal(h.input.value, 'Сумма');
		assert.equal(h.input.getAttribute('aria-label'), 'Путь к данным поля Сумма');
		assert.equal(h.input.getAttribute('data-dcs-key'), 'fpath\nПродажи\nСумма');
		assert.equal(h.error.className, 'dcs-cell-error');
		assert.equal(h.error.getAttribute('aria-live'), 'polite', 'причина у поля с фокусом не была бы слышна');
		h.input.value = 'СКЛАД';
		assert.equal(h.input.fire('keydown', { key: 'Enter' }), true);
		assert.equal(h.sent.length, 0);
		assert.equal(h.error.textContent, 'Поле с таким путём к данным уже есть в наборе.');
		assert.equal(h.input.getAttribute('aria-invalid'), 'true');
		assert.equal(h.input.getAttribute('aria-describedby'), h.error.id);
		assert.ok(h.error.id.startsWith('dcsCellError'));
		assert.equal(h.input.value, 'СКЛАД');
		assert.deepEqual(h.drafts.get('Продажи\nСумма'), { text: 'СКЛАД', problem: 'Поле с таким путём к данным уже есть в наборе.' });
		h.input.value = '';
		h.input.fire('change');
		assert.equal(h.error.textContent, 'Укажите путь к данным.');
		assert.equal(h.sent.length, 0);
		assert.equal(h.input.fire('keydown', { key: 'Escape' }), true);
		assert.equal(h.input.value, 'Сумма');
		assert.equal(h.error.textContent, '');
		assert.equal(h.input.getAttribute('aria-invalid'), null);
		assert.equal(h.input.getAttribute('aria-describedby'), null);
		assert.equal(h.drafts.size, 0);
		assert.equal(h.input.fire('keydown', { key: 'Escape' }), false, 'Esc без правки — клавиша страницы');
		// IME: Enter при наборе иероглифов не коммитит
		h.input.value = 'Выручка';
		assert.equal(h.input.fire('keydown', { key: 'Enter', isComposing: true }), false);
		assert.equal(h.sent.length, 0);
		doc.body.textContent = '';
	});

	test('путь в ячейке: новый путь — dcs/set-field с newDataPath, переименование для фокуса; пока ответа нет, второй раз не уходит', () => {
		const h = pathEditor('Сумма', ['Склад', 'Сумма']);
		h.input.value = '  Выручка ';
		h.input.fire('keydown', { key: 'Enter' });
		assert.deepEqual(h.sent, [{ type: 'dcs/set-field', dataSet: 'Продажи', dataPath: 'Сумма', payload: { newDataPath: 'Выручка' } }]);
		assert.deepEqual(h.rename(), { scope: 'Продажи', from: 'Сумма', to: 'Выручка' });
		h.input.fire('change');
		assert.equal(h.sent.length, 1, 'Enter и уход из поля — одна правка');
		// Ответ пришёл с отказом (перерисовки нет): тот же текст можно отправить снова
		h.setSaving(false);
		h.input.fire('change');
		assert.equal(h.sent.length, 2);
		doc.body.textContent = '';
		// Тот же путь (после обрезки) ничего не шлёт и снимает старую причину
		const same = pathEditor('Сумма', ['Сумма']);
		same.input.value = ' Сумма ';
		same.input.fire('change');
		assert.equal(same.sent.length, 0);
		assert.equal(same.input.value, 'Сумма');
		doc.body.textContent = '';
		// Уход из поля коммитит и без change (набранное, перенесённое перерисовкой); поле, которое убирает перерисовка, — нет
		const blur = pathEditor('Сумма', ['Сумма']);
		blur.input.value = 'Выручка';
		blur.setRendering(true);
		blur.input.fire('blur');
		assert.equal(blur.sent.length, 0, 'уход поля, которое убирает перерисовка, записал правку');
		blur.setRendering(false);
		blur.input.fire('blur');
		assert.deepEqual(blur.sent, [{ type: 'dcs/set-field', dataSet: 'Продажи', dataPath: 'Сумма', payload: { newDataPath: 'Выручка' } }]);
		doc.body.textContent = '';
		// Канал занят: набранное остаётся в ячейке с причиной под ней, переименования для
		// фокуса нет, ожидание ответа другой правки не тронуто; это не отказ md-sparrow — уход из ячейки шлёт путь снова
		const busy = pathEditor('Сумма', ['Сумма'], true);
		busy.input.value = 'Выручка';
		busy.input.fire('change');
		assert.equal(busy.input.value, 'Выручка', 'набранный путь пропал');
		assert.equal(busy.error.textContent, 'Не отправлено: предыдущая правка ещё сохранялась. Нажмите Enter ещё раз.');
		assert.equal(busy.input.getAttribute('aria-invalid'), 'true');
		assert.deepEqual(busy.drafts.get('Продажи\nСумма'), { text: 'Выручка', problem: 'Не отправлено: предыдущая правка ещё сохранялась. Нажмите Enter ещё раз.' });
		assert.equal(busy.rename(), null);
		assert.equal(busy.pathCommit(), null);
		doc.body.textContent = '';
	});

	test('путь в ячейке: уход в другое окно правку не заканчивает; отказ md-sparrow — под ячейкой, уход из ячейки его не повторяет, Enter — повторяет', () => {
		// Окно потеряло фокус: браузер шлёт полю blur (и change), но недописанный путь не пишется
		const away = pathEditor('Сумма', ['Сумма']);
		away.input.value = 'Выру';
		away.setWindowFocus(false);
		away.input.fire('blur');
		away.input.fire('change');
		assert.equal(away.sent.length, 0, 'уход в другое окно записал недописанный путь');
		assert.equal(away.input.value, 'Выру', 'набранное потеряно');
		away.setWindowFocus(true);
		away.input.value = 'Выручка';
		away.input.fire('blur');
		assert.deepEqual(away.sent, [{ type: 'dcs/set-field', dataSet: 'Продажи', dataPath: 'Сумма', payload: { newDataPath: 'Выручка' } }]);
		// Отправленный путь помнится до ответа: отказ панель покажет под этой ячейкой
		assert.deepEqual(away.pathCommit(), { draftKey: 'Продажи\nСумма', value: 'Выручка' });
		doc.body.textContent = '';
		// Перерисовка после отказа: текст и причина под ячейкой, поле помечено
		const refused = pathEditor('Сумма', ['Сумма'], false, [['Продажи\nСумма', { text: 'Выручка', problem: 'Не переименовано: файл занят', refused: true }]]);
		assert.equal(refused.input.value, 'Выручка');
		assert.equal(refused.error.textContent, 'Не переименовано: файл занят');
		assert.equal(refused.input.getAttribute('aria-invalid'), 'true');
		assert.equal(refused.input.getAttribute('aria-describedby'), refused.error.id);
		refused.input.fire('blur');
		refused.input.fire('change');
		assert.equal(refused.sent.length, 0, 'отклонённый путь ушёл заново по уходу из ячейки');
		refused.input.fire('keydown', { key: 'Enter' });
		assert.equal(refused.sent.length, 1, 'Enter не повторил отклонённый путь');
		assert.equal(refused.drafts.size, 0, 'повтор не снял прежнюю причину');
		doc.body.textContent = '';
		// Другой путь после отказа уходит и по уходу из ячейки
		const changed = pathEditor('Сумма', ['Сумма'], false, [['Продажи\nСумма', { text: 'Выручка', problem: 'Не переименовано: файл занят', refused: true }]]);
		changed.input.value = 'Выручка2';
		changed.input.fire('blur');
		assert.equal(changed.sent.length, 1);
		doc.body.textContent = '';
	});

	test('черновики пути в ячейке: поле, которого в модели больше нет, забывается', () => {
		const code =
			'const fieldPathDrafts = new Map([["Продажи\\nСумма", {}], ["Продажи\\nСклад", {}], ["Остатки\\nСумма", {}]]);\n' +
			topFunction('pruneFieldPathDrafts() {') +
			'\nreturn { pruneFieldPathDrafts, drafts: fieldPathDrafts };';
		const paths: Record<string, string[]> = { Продажи: ['Сумма', 'Выручка'] };
		const api = (new Function('dataSetFieldPaths', code) as (fn: (set: string) => string[]) => { pruneFieldPathDrafts(): void; drafts: Map<string, unknown> })(
			(set: string) => paths[set] || []
		);
		api.pruneFieldPathDrafts();
		assert.deepEqual([...api.drafts.keys()], ['Продажи\nСумма'], 'остался черновик переименованного поля или ушедшего набора');
		// Обе ветки ответа saved чистят черновики по новой модели
		assert.ok(SCRIPT.includes('reconcileQueryDrafts();\n\t\t\t\t// Набранный в ячейке путь поля, которого больше нет'));
		assert.ok(topFunction('onBackgroundSaved(msg) {').includes('pruneFieldPathDrafts();'));
	});

	test('стрелки в таблице полей: колонка соседней строки, у флажков — соседний флажок; Shift и края — как у поля', () => {
		const code =
			topConst('RESTRICTION_COLUMNS') +
			topConst('RESTRICTION_GROUPS') +
			topFunction('rowOf(node) {') +
			topFunction('cellControl(row, col) {') +
			topFunction('onFieldCellKey(event) {') +
			'\nreturn onFieldCellKey;';
		const onKey = (new Function(code) as () => (event: unknown) => void)();
		const tbody = doc.body.appendChild(el('tbody'));
		tbody.addEventListener('keydown', onKey);
		const rows: Node[] = [];
		for (const name of ['А', 'Б', 'Папка', 'В']) {
			const tr = tbody.appendChild(el('tr'));
			rows.push(tr);
			const td = tr.appendChild(el('td'));
			if (name !== 'Папка') {
				const input = td.appendChild(el('input'));
				input.type = 'text';
				input.setAttribute('data-dcs-col', 'path');
			}
			for (const flag of ['flag:useRestriction:order', 'flag:attributeUseRestriction:field']) {
				const box = tr.appendChild(el('td')).appendChild(el('input'));
				box.type = 'checkbox';
				box.disabled = name === 'Папка';
				box.setAttribute('data-dcs-col', flag);
			}
		}
		const control = (row: number, col: string): Node => rows[row].find((node) => node.getAttribute('data-dcs-col') === col)[0];
		const press = (target: Node, key: string, extra: Record<string, unknown> = {}): boolean => tbody.fire('keydown', Object.assign({ key, target }, extra));
		control(0, 'path').focus();
		assert.equal(press(control(0, 'path'), 'ArrowDown'), true);
		assert.equal(doc.activeElement, control(1, 'path'));
		press(control(1, 'path'), 'ArrowDown');
		assert.equal(doc.activeElement, control(3, 'path'), 'строка папки без поля пути пропускается');
		assert.equal(press(control(3, 'path'), 'ArrowDown'), true, 'край: клавиша гасится');
		assert.equal(doc.activeElement, control(3, 'path'));
		press(control(3, 'flag:useRestriction:order'), 'ArrowUp');
		assert.equal(doc.activeElement, control(1, 'flag:useRestriction:order'), 'недоступный флажок папки пропускается');
		press(control(1, 'flag:useRestriction:order'), 'ArrowRight');
		assert.equal(doc.activeElement, control(1, 'flag:attributeUseRestriction:field'));
		assert.equal(press(control(1, 'path'), 'ArrowRight'), false, 'вправо в поле пути — каретка');
		assert.equal(press(control(1, 'path'), 'ArrowDown', { shiftKey: true }), false, 'Shift+вниз — выделение');
		assert.equal(press(control(1, 'path'), 'ArrowDown', { defaultPrevented: true }), false, 'клавишу уже обработала подсказка');
		// Кнопки строки (тип, «Свойства поля», «Удалить поле») — тоже колонки: из конца строки в соседнюю без Shift+Tab
		for (const [row, cols] of [
			[0, ['type', 'edit', 'delete']],
			[1, ['type', 'edit', 'delete']],
			[3, ['edit', 'delete']],
		] as Array<[number, string[]]>) {
			const td = rows[row].appendChild(el('td'));
			for (const col of cols) {
				td.appendChild(el('button')).setAttribute('data-dcs-col', col);
			}
		}
		control(0, 'delete').focus();
		assert.equal(press(control(0, 'delete'), 'ArrowDown'), true);
		assert.equal(doc.activeElement, control(1, 'delete'));
		control(1, 'type').focus();
		assert.equal(press(control(1, 'type'), 'ArrowDown'), true, 'край: клавиша гасится');
		assert.equal(doc.activeElement, control(1, 'type'), 'ниже кнопки типа нет (папка, у В тип без окна): фокус на месте');
		press(control(3, 'edit'), 'ArrowUp');
		assert.equal(doc.activeElement, control(1, 'edit'), 'строка папки без кнопок пропускается');
		assert.equal(press(control(1, 'edit'), 'ArrowRight'), false, 'вправо на кнопке — не стрелка таблицы');
		const row = topFunction('fieldRow(setName, field, readOnly, nestedSet) {');
		assert.ok(row.includes("typeTd.children[0].setAttribute('data-dcs-col', 'type');") && row.includes("['edit', 'delete'].forEach((col, at) => {"), 'кнопки строки без колонки');
		doc.body.textContent = '';
	});

	/** Строки таблицы полей заглушкой: в ячейках поля ввода, флажки и кнопки — как у fieldRow. */
	function fieldRows(tbody: Node, paths: Array<string | null>): Node[] {
		return paths.map((dataPath) => {
			const tr = tbody.appendChild(el('tr'));
			tr.setAttribute('data-dcs-row', dataPath || '');
			tr.appendChild(el('td', 'dcs-col-pin', dataPath || 'папка'));
			if (dataPath === null) {
				// У папки флажки недоступны: в обходе Tab их нет
				const box = tr.appendChild(el('td')).appendChild(el('input'));
				box.type = 'checkbox';
				box.disabled = true;
			} else {
				const pathTd = tr.appendChild(el('td'));
				pathTd.appendChild(el('input'));
				pathTd.appendChild(el('div', 'dcs-cell-error'));
				tr.appendChild(el('td')).appendChild(el('input')).type = 'checkbox';
				const actions = tr.appendChild(el('td'));
				actions.appendChild(el('button'));
				actions.appendChild(el('button'));
			}
			return tr;
		});
	}

	function rowStopsApi(): { fieldRowStops(tbody: Node, setName: string): void; fieldRowControls(tr: Node): Node[]; revealFromUnderPin(wrap: unknown, target: unknown): void } {
		const code =
			"let fieldsRowStop = { set: '', path: '' };\n" +
			topFunction('rowOf(node) {') +
			topFunction('fieldRowControls(tr) {') +
			topFunction('fieldRowStops(tbody, setName) {') +
			topFunction('revealFromUnderPin(wrap, target) {') +
			'\nreturn { fieldRowStops, fieldRowControls, revealFromUnderPin };';
		return (new Function(code) as () => ReturnType<typeof rowStopsApi>)();
	}

	test('таблица полей: в обходе Tab одна строка — та, где был фокус; переживает перерисовку', () => {
		const api = rowStopsApi();
		const draw = (): Node[] => {
			doc.body.textContent = '';
			const tbody = doc.body.appendChild(el('tbody'));
			const rows = fieldRows(tbody, ['Склад', null, 'Сумма', 'Цена']);
			api.fieldRowStops(tbody, 'Продажи');
			return rows;
		};
		const stops = (rows: Node[]): number[][] => rows.map((tr) => api.fieldRowControls(tr).map((control) => control.tabIndex));
		let rows = draw();
		assert.deepEqual(api.fieldRowControls(rows[0]).map((node) => node.tagName), ['INPUT', 'INPUT', 'BUTTON', 'BUTTON'], 'строка ошибки под полем — не остановка');
		assert.deepEqual(stops(rows), [[0, 0, 0, 0], [], [-1, -1, -1, -1], [-1, -1, -1, -1]], 'без выбора — первая строка');
		// Фокус в строку (стрелка, щелчок): остановка переезжает за ним
		const flag = api.fieldRowControls(rows[2])[1];
		rows[2].parentElement?.fire('focusin', { target: flag });
		assert.deepEqual(stops(rows), [[-1, -1, -1, -1], [], [0, 0, 0, 0], [-1, -1, -1, -1]]);
		// Перерисовка (ответ правки) оставляет ту же строку
		rows = draw();
		assert.deepEqual(stops(rows), [[-1, -1, -1, -1], [], [0, 0, 0, 0], [-1, -1, -1, -1]]);
		// Фокус на самой строке или вне строк остановку не трогает
		rows[0].parentElement?.fire('focusin', { target: rows[0] });
		assert.deepEqual(stops(rows)[2], [0, 0, 0, 0]);
		// Другой набор — с первой строки, где есть что править (строка папки остановкой не становится)
		doc.body.textContent = '';
		const other = doc.body.appendChild(el('tbody'));
		const otherRows = fieldRows(other, [null, 'А', 'Б']);
		api.fieldRowStops(other, 'Остатки');
		assert.deepEqual(stops(otherRows), [[], [0, 0, 0, 0], [-1, -1, -1, -1]]);
		assert.equal(otherRows[0].find((node) => node.tagName === 'INPUT')[0].tabIndex, 0, 'недоступный флажок папки трогать незачем');
		doc.body.textContent = '';
	});

	test('таблица полей: ячейка под закреплённой колонкой «Поле» при фокусе выезжает из-под неё', () => {
		const api = rowStopsApi();
		const tbody = doc.body.appendChild(el('tbody'));
		const [tr] = fieldRows(tbody, ['Склад']);
		const pin = tr.children[0] as Node & { getBoundingClientRect?: () => { left: number; right: number } };
		const input = tr.children[1].children[0] as Node & { getBoundingClientRect?: () => { left: number; right: number } };
		pin.getBoundingClientRect = () => ({ left: 0, right: 120 });
		const wrap = { scrollLeft: 300 };
		// Поле начинается под закреплённой ячейкой (левый край 40 при правом крае «Поля» 120): сдвиг на 84
		input.getBoundingClientRect = () => ({ left: 40, right: 200 });
		api.revealFromUnderPin(wrap, input);
		assert.equal(wrap.scrollLeft, 216);
		// Поле видно — прокрутка та же; сама закреплённая ячейка и узел без замеров — не трогаются
		input.getBoundingClientRect = () => ({ left: 130, right: 290 });
		api.revealFromUnderPin(wrap, input);
		assert.equal(wrap.scrollLeft, 216);
		api.revealFromUnderPin(wrap, pin.appendChild(el('span')));
		assert.equal(wrap.scrollLeft, 216);
		// У края рамки — не меньше нуля
		input.getBoundingClientRect = () => ({ left: -500, right: -300 });
		api.revealFromUnderPin(wrap, input);
		assert.equal(wrap.scrollLeft, 0);
		doc.body.textContent = '';
		const table = section('\tfunction renderFieldsTable(host, dataSet, readOnly) {', '\tfunction fieldRow(');
		assert.ok(table.includes('fieldRowStops(tbody, setName);'));
		assert.ok(table.includes("wrap.addEventListener('focusin', (event) => {\n\t\t\t\trevealFromUnderPin(wrap, event && event.target);"));
	});

	test('таблица полей: «Поле» закреплена, путь и заголовок правятся в строке, у карандаша — ключ возврата фокуса', () => {
		const table = section('\tfunction renderFieldsTable(host, dataSet, readOnly) {', '\tfunction fieldRow(');
		assert.ok(table.includes("headCell(top, 'Поле', { rowSpan: 2, className: 'dcs-col-pin' });"));
		assert.ok(table.includes("tbody.addEventListener('keydown', onFieldCellKey);"));
		const row = topFunction('fieldRow(setName, field, readOnly, nestedSet) {');
		assert.ok(row.includes("cell(tr, fieldKindText(field), 'dcs-col-pin');"));
		assert.ok(row.includes("tr.setAttribute('data-dcs-row', dataPath);"));
		assert.ok(row.includes('fieldPathEditor(pathTd, setName, dataPath);') && row.includes('fieldTitleEditor(titleTd, setName, field);'));
		// Значок окна поля остаётся; у кнопок строки — ключи возврата фокуса после перерисовки
		assert.ok(row.includes("svg: 'edit',") && row.includes("key: focusKey(['fedit', setName, dataPath]),"));
		assert.ok(row.includes("key: focusKey(['fdel', setName, dataPath]),"), 'у «Удалить поле» нет ключа: фокус пропадёт после перерисовки');
		// Уход в другое окно заголовок не записывает
		const title = topFunction('fieldTitleEditor(td, setName, field) {');
		assert.ok(title.includes('if (!core.renderingContent && input.isConnected && windowHasFocus()) {'));
		assert.ok(/addEventListener\('change', \(\) => \{\n\t+if \(windowHasFocus\(\)\) \{/.test(title));
		const css = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.css'), 'utf8');
		assert.match(css, /\.dcs-fields-table \.dcs-col-pin \{[^}]*position: sticky;[^}]*left: 0;[^}]*background: var\(--vscode-input-background\);/);
		// Подсветка строки под мышью — и у закреплённой ячейки, фон под ней непрозрачный
		assert.match(css, /\.dcs-fields-table tbody tr:hover \.dcs-col-pin \{[^}]*color-mix\(in srgb, var\(--vscode-focusBorder\) 10%, transparent\)[^}]*var\(--vscode-input-background\);/);
		assert.match(css, /\.dcs-cell-error \{[^}]*color: var\(--vscode-errorForeground\);/);
		// Таблица прокручивается внутри своей рамки, а не страница
		assert.match(css, /\.dcs-table-wrap \{[^}]*overflow-x: auto;/);
		assert.match(css, /\.dcs-sets-body \{[^}]*min-width: 0;/);
	});
});

describe('Текст запроса набора: запись по концу правки', () => {
	interface Draft {
		text: string;
		base: string;
		retry: string | false;
	}

	interface QueryApi {
		send(type: string, fields?: Record<string, unknown>): boolean;
		editBusy(): boolean;
		noteQueryDraft(key: string, text: string): void;
		commitQueryDraft(key: string, mode?: string): boolean;
		flushQueryEdits(mode?: string): void;
		retryQueryDrafts(): void;
		reconcileQueryDrafts(): void;
		queryStatusText(key: string, text: string, autoFill: boolean): { tone: string; text: string; kind: string } | null;
		renderQueryStatus(line: Node, key: string, text: string, autoFill: boolean, input?: Node): unknown;
		modelShapeWithoutQuery(source: unknown, key: string): string | null;
		drafts: Map<string, Draft>;
		errors: Map<string, { text: string; message: string; refused?: boolean }>;
		pendingFills: Map<string, { retry: boolean }>;
		state(): { saving: boolean; background: Record<string, unknown> | null; deferred: Record<string, unknown> | null; editOrigin: unknown };
		setModel(next: unknown): void;
		setSaving(value: boolean): void;
		setStatusRefresh(value: unknown): void;
		saved(msg: Record<string, unknown>): void;
	}

	interface QueryHarness {
		posted: Array<Record<string, unknown>>;
		notices: Array<[string, string]>;
		renders: number;
		prunes: number;
		model: { dataSets: Array<Record<string, unknown>> };
		api: QueryApi;
		/** Окна стека (заглушка dialogStack): верхнее — последнее. */
		dialogs: unknown[];
	}

	/**
	 * Раздел записи текста dcs-editor.js как есть, с send/postEdit/editBusy: модель, отрисовка, плашка и канал — заглушки;
	 * разбор — настоящий разборщик конструктора (dcs-editor-query-model.js).
	 */
	function harness(dataSets: Array<Record<string, unknown>>): QueryHarness {
		const Q = loadModule('dcs-editor-query-model.js') as { parse(text: string): { diagnostics: unknown[] } };
		const out: QueryHarness = { posted: [], notices: [], renders: 0, prunes: 0, model: { dataSets }, api: null as unknown as QueryApi, dialogs: [] };
		const code =
			'let saving = false;\nlet background = null;\nlet deferred = null;\nlet editOrigin = null;\nlet pendingVariant = "";\nlet model = initialModel;\n' +
			'let queryStatusRefresh = null;\nlet renderingContent = false;\n' +
			topFunction('send(type, fields) {') +
			topFunction('editSource() {') +
			topFunction('postEdit(type, fields) {') +
			topFunction('editBusy() {') +
			section('// ---------- запись текста запроса по концу правки ----------', '\t/** Пауза перепроверки имён после ввода') +
			'\nreturn { send, editBusy, noteQueryDraft, commitQueryDraft, flushQueryEdits, retryQueryDrafts, reconcileQueryDrafts, queryStatusText,' +
			' renderQueryStatus, modelShapeWithoutQuery, drafts: queryDrafts, errors: queryErrors, pendingFills, state: () => ({ saving, background, deferred, editOrigin }),' +
			' setModel: (next) => { model = next; }, setSaving: (v) => { saving = v; }, setStatusRefresh: (v) => { queryStatusRefresh = v; },' +
			// Ответ saved, как его разбирает обработчик сообщений: канал свободен, ответ — фоновой записи
			' saved: (msg) => { saving = false; onBackgroundSaved(msg); } };';
		const factory = new Function(
			'vscode',
			'window',
			'document',
			'setTimeout',
			'clearTimeout',
			'affectedVariant',
			'setStatus',
			'dataSetAt',
			'queryModelApi',
			'parseQueryCached',
			'withTypeCompositions',
			'pruneVariantCache',
			'renderTabs',
			'renderContent',
			'showNotice',
			'autofillNoticeLines',
			'pruneFieldPathDrafts',
			'initialModel',
			'dialogStack',
			withCoreAccessors(code)
		) as (...args: unknown[]) => QueryApi;
		const listeners: Record<string, unknown> = {};
		const api = factory(
			{ postMessage: (msg: Record<string, unknown>) => out.posted.push(msg) },
			{ addEventListener: (type: string, fn: unknown) => (listeners['window:' + type] = fn) },
			{ addEventListener: (type: string, fn: unknown) => (listeners['document:' + type] = fn), visibilityState: 'visible' },
			(fn: () => void) => {
				fn();
				return 1;
			},
			() => undefined,
			() => '',
			() => undefined,
			(names: string[]) => {
				let level = out.model.dataSets || [];
				let found: Record<string, unknown> | null = null;
				for (const name of names) {
					found = level.find((item) => item.name === name) || null;
					if (!found) {
						return null;
					}
					level = (found.items as Array<Record<string, unknown>>) || [];
				}
				return found;
			},
			Q,
			(text: string) => Q.parse(text),
			(next: unknown) => next,
			() => undefined,
			() => undefined,
			() => {
				out.renders += 1;
			},
			(tone: string, title: string) => out.notices.push([tone, title]),
			() => [],
			() => {
				out.prunes += 1;
			},
			out.model,
			{ depth: () => out.dialogs.length, top: () => out.dialogs[out.dialogs.length - 1] || null }
		);
		assert.ok(listeners['window:pagehide'] && listeners['window:blur'] && listeners['document:visibilitychange'], 'уход со страницы не записывает текст');
		// Ответ меняет модель скрипта и то, что видит заглушка dataSetAt
		out.api = Object.assign(Object.create(api) as QueryApi, {
			setModel(next: { dataSets: Array<Record<string, unknown>> }) {
				out.model = next;
				api.setModel(next);
			},
		});
		return out;
	}

	const GOOD = 'ВЫБРАТЬ\n\tВал.Ссылка КАК Ссылка\nИЗ\n\tСправочник.Валюты КАК Вал';
	const BROKEN = 'ВЫБРАТЬ\n\tВал.Ссылка КАК Ссылка\nИЗ';

	test('конец правки: изменённый текст — setQuery и фоновая запись; неизменённый, пустой и тот же в полёте — ничего', () => {
		const h = harness([{ name: 'Продажи', type: 'query', query: 'ВЫБРАТЬ 1 КАК А', autoFillFields: true }]);
		h.api.commitQueryDraft('Продажи');
		assert.equal(h.posted.length, 0, 'без черновика');
		h.api.noteQueryDraft('Продажи', 'ВЫБРАТЬ 1 КАК А');
		assert.equal(h.api.drafts.size, 0, 'текст модели — не черновик');
		h.api.noteQueryDraft('Продажи', '');
		assert.equal(h.api.commitQueryDraft('Продажи'), true, 'вызывающий не узнал, что пустой текст не ушёл');
		assert.equal(h.posted.length, 0, 'пустой текст ушёл');
		assert.equal(h.api.errors.get('Продажи')?.message, 'Запрос пуст: пустой текст не сохраняется.');
		assert.equal(h.api.drafts.get('Продажи')?.text, '', 'черновик пустого текста потерян');
		h.api.noteQueryDraft('Продажи', GOOD);
		assert.equal(h.api.commitQueryDraft('Продажи'), false);
		assert.deepEqual(h.posted, [{ type: 'setQuery', dataSet: 'Продажи', text: GOOD }]);
		assert.deepEqual(h.api.state().background, { key: 'Продажи', text: GOOD, autofill: true, fillLater: false, stage: 'text' });
		h.api.commitQueryDraft('Продажи');
		h.api.flushQueryEdits();
		assert.equal(h.posted.length, 1, 'тот же текст ушёл второй раз');
		assert.equal(h.api.editBusy(), false, 'за фоновой записью правке есть место');
	});

	test('ошибка разбора: текст пишется, заполнения не будет; строка под полем — ошибкой, с оговоркой при «Автозаполнении»', () => {
		const h = harness([{ name: 'Продажи', type: 'query', query: GOOD, autoFillFields: true }]);
		h.api.noteQueryDraft('Продажи', BROKEN);
		h.api.commitQueryDraft('Продажи');
		assert.deepEqual(h.posted, [{ type: 'setQuery', dataSet: 'Продажи', text: BROKEN }]);
		assert.equal(h.api.state().background?.autofill, false, 'по тексту с ошибкой поля заполнялись бы');
		const status = h.api.queryStatusText('Продажи', BROKEN, true);
		assert.equal(status?.tone, 'error');
		assert.equal(status?.kind, 'parse');
		assert.match(status?.text || '', /^Ошибка в запросе, строка 3: .+\. Поля по нему не заполняются, пока ошибка есть\.$/);
		assert.match(h.api.queryStatusText('Продажи', BROKEN, false)?.text || '', /^Ошибка в запросе, строка 3: [^.]+\.$/, 'без «Автозаполнения» — без оговорки');
		assert.equal(h.api.queryStatusText('Продажи', GOOD, true), null);
		// Строка под полем помечает и само поле: aria-invalid при ошибке, снят без неё
		const line = el('div');
		const input = el('textarea');
		h.api.renderQueryStatus(line, 'Продажи', BROKEN, true, input);
		assert.equal(input.getAttribute('aria-invalid'), 'true');
		assert.equal(line.className, 'dcs-query-status dcs-query-status-error');
		h.api.renderQueryStatus(line, 'Продажи', GOOD, true, input);
		assert.equal(input.getAttribute('aria-invalid'), null);
		assert.equal(line.className, 'dcs-query-status');
		assert.equal(line.textContent, '');
		h.api.saved({ ok: true, model: { dataSets: [{ name: 'Продажи', type: 'query', query: BROKEN, autoFillFields: true }] } });
		assert.equal(h.posted.length, 1, 'после записи с ошибкой ушло заполнение');
		assert.equal(h.api.state().background, null);
	});

	test('правка в очереди за фоновой записью помнит, откуда ушла: со страницы — окно, открытое после неё, ей не принадлежит', () => {
		const h = harness([{ name: 'Продажи', type: 'query', query: 'ВЫБРАТЬ 1 КАК А', autoFillFields: false }]);
		h.api.noteQueryDraft('Продажи', GOOD);
		h.api.commitQueryDraft('Продажи');
		// Щелчок по флажку на странице сразу после ухода из поля запроса: правка встаёт в очередь, окон нет
		assert.equal(h.api.send('dcs/set-data-set-props', { name: 'Продажи', payload: { autoFillFields: true } }), true);
		assert.equal(h.api.state().deferred?.origin, null);
		// Пока запись идёт, пользователь открыл окно (конструктор запроса): очередь его себе не берёт
		const builder = { title: 'Конструктор запроса' };
		h.dialogs.push(builder);
		const next = { dataSets: [{ name: 'Продажи', type: 'query', query: GOOD, autoFillFields: false }] };
		h.api.setModel(next);
		h.api.saved({ ok: true, model: next });
		assert.deepEqual(h.posted[1], { type: 'dcs/set-data-set-props', name: 'Продажи', payload: { autoFillFields: true } });
		assert.equal(h.api.state().editOrigin, null, 'ответ правки со страницы закрыл бы окно, открытое после неё');
		// Правка из окна помнит окно: её удачный ответ закрывает окна, отказ пишется в окно
		h.api.setSaving(false);
		assert.equal(h.api.send('dcs/remove-field', { dataSet: 'Продажи', dataPath: 'А' }), true);
		assert.equal(h.api.state().editOrigin, builder);
		// Фоновая запись сбрасывает признак: её ответ окон не закрывает
		h.api.setSaving(false);
		h.dialogs.length = 0;
		h.api.noteQueryDraft('Продажи', 'ВЫБРАТЬ 2 КАК Б');
		h.api.commitQueryDraft('Продажи');
		assert.equal(h.api.state().editOrigin, null);
		// Правка из окна в очереди за фоновой записью уходит с этим окном
		const props = { title: 'Свойства набора' };
		h.dialogs.push(props);
		assert.equal(h.api.send('dcs/set-data-set-props', { name: 'Продажи', payload: { autoFillFields: false } }), true);
		assert.equal(h.api.state().deferred?.origin, props);
		h.api.saved({ ok: true, model: next });
		assert.equal(h.api.state().editOrigin, props);
	});

	test('ответ записи: при «Автозаполнении» — dcs/autofill-fields, итог плашкой только с новостями, затем правка из очереди', () => {
		const h = harness([{ name: 'Продажи', type: 'query', query: 'ВЫБРАТЬ 1 КАК А', autoFillFields: true }]);
		h.api.noteQueryDraft('Продажи', GOOD);
		h.api.commitQueryDraft('Продажи');
		// Правка пользователя во время записи встаёт в очередь, вторая получает отказ
		assert.equal(h.api.send('dcs/set-data-set-props', { name: 'Продажи', payload: { autoFillFields: false } }), true);
		assert.equal(h.api.editBusy(), true, 'место в очереди одно');
		assert.equal(h.api.send('dcs/remove-field', { dataSet: 'Продажи', dataPath: 'А' }), false);
		assert.equal(h.posted.length, 1);
		const next = { dataSets: [{ name: 'Продажи', type: 'query', query: GOOD, autoFillFields: true }] };
		h.api.setModel(next);
		h.api.saved({ ok: true, model: next });
		assert.deepEqual(h.posted[1], { type: 'dcs/autofill-fields', dataSet: 'Продажи' });
		assert.equal(h.api.state().background?.stage, 'fill');
		assert.equal(h.api.drafts.size, 0, 'записанный черновик не забыт');
		h.api.saved({ ok: true, model: next, autofill: { added: [], skipped: [] } });
		assert.deepEqual(h.notices, [], 'пустой итог заполнения — плашкой');
		assert.deepEqual(h.posted[2], { type: 'dcs/set-data-set-props', name: 'Продажи', payload: { autoFillFields: false } }, 'правка из очереди не ушла');
		assert.equal(h.api.state().background, null);
		assert.equal(h.api.state().deferred, null);
		assert.equal(h.api.state().editOrigin, null, 'правка со страницы помнит окно');
		// Модель поменялась только текстом набора: вкладка не перерисовывается (фокус и узлы на месте)
		assert.equal(h.renders, 0, 'перерисовка без перемен: узел с фокусом заменён, читалка назвала его заново');
		assert.ok(h.prunes >= 2, 'черновики пути в ячейках не сверены с новой моделью');
		// С новостями — плашка; поля добавлены — вкладка перерисовывается
		h.api.setSaving(false);
		const withB = 'ВЫБРАТЬ\n\tВал.Ссылка КАК Ссылка,\n\t2 КАК Б\nИЗ\n\tСправочник.Валюты КАК Вал';
		h.api.noteQueryDraft('Продажи', withB);
		h.api.commitQueryDraft('Продажи');
		const textOnly = { dataSets: [{ name: 'Продажи', type: 'query', query: withB, autoFillFields: true }] };
		h.api.setModel(textOnly);
		h.api.saved({ ok: true, model: textOnly });
		assert.equal(h.renders, 0);
		// Модель скрипта меняет сам ответ: сравнение идёт с моделью до него
		const filled = { dataSets: [{ name: 'Продажи', type: 'query', query: withB, autoFillFields: true, fields: [{ dataPath: 'Б' }] }] };
		h.api.saved({ ok: true, model: filled, autofill: { added: ['Б'], skipped: [] } });
		h.api.setModel(filled);
		assert.deepEqual(h.notices, [['ok', 'Заполнение из запроса']]);
		assert.equal(h.renders, 1, 'добавленные поля не показаны');
	});

	test('сравнение моделей: только текст набора — без перерисовки; набор внутри объединения и новые поля — с ней', () => {
		const h = harness([]);
		const a = { dataSets: [{ name: 'А', query: 'ВЫБРАТЬ 1', fields: [] }, { name: 'Б', query: 'ВЫБРАТЬ 2' }], parameters: [] };
		const b = { dataSets: [{ name: 'А', query: 'ВЫБРАТЬ 3', fields: [] }, { name: 'Б', query: 'ВЫБРАТЬ 2' }], parameters: [] };
		assert.equal(h.api.modelShapeWithoutQuery(a, 'А'), h.api.modelShapeWithoutQuery(b, 'А'));
		assert.notEqual(h.api.modelShapeWithoutQuery(a, 'Б'), h.api.modelShapeWithoutQuery(b, 'Б'), 'текст чужого набора не в счёт');
		const c = { dataSets: [{ name: 'А', query: 'ВЫБРАТЬ 3', fields: [{ dataPath: 'Поле' }] }, { name: 'Б', query: 'ВЫБРАТЬ 2' }], parameters: [] };
		assert.notEqual(h.api.modelShapeWithoutQuery(a, 'А'), h.api.modelShapeWithoutQuery(c, 'А'));
		assert.equal(h.api.modelShapeWithoutQuery(a, 'Объединение/Часть'), null);
		assert.equal(h.api.modelShapeWithoutQuery(null, 'А'), null);
		assert.equal(a.dataSets[0].query, 'ВЫБРАТЬ 1', 'сравнение испортило модель');
	});

	test('ответ без перерисовки: строка под полем и проверка имён узнают записанный текст', () => {
		const h = harness([{ name: 'Продажи', type: 'query', query: 'ВЫБРАТЬ 1 КАК А', autoFillFields: false }]);
		const calls: string[] = [];
		h.api.setStatusRefresh({ key: 'Продажи', repaint: () => calls.push('repaint'), rebase: (text: string) => calls.push('rebase:' + text) });
		h.api.noteQueryDraft('Продажи', GOOD);
		h.api.commitQueryDraft('Продажи');
		const next = { dataSets: [{ name: 'Продажи', type: 'query', query: GOOD, autoFillFields: false }] };
		h.api.setModel(next);
		h.api.saved({ ok: true, model: next });
		assert.deepEqual(calls, ['repaint', 'rebase:' + GOOD]);
		assert.equal(h.renders, 0);
		// Строка другого набора не трогается
		calls.length = 0;
		h.api.setStatusRefresh({ key: 'Остатки', repaint: () => calls.push('repaint') });
		h.api.noteQueryDraft('Продажи', 'ВЫБРАТЬ 2 КАК Б');
		h.api.commitQueryDraft('Продажи');
		h.api.saved({ ok: true, model: next });
		assert.deepEqual(calls, []);
	});

	test('отказ записи: причина под полем этого текста, черновик остаётся; отказ заполнения — своя причина', () => {
		const h = harness([{ name: 'Продажи', type: 'query', query: 'ВЫБРАТЬ 1 КАК А', autoFillFields: true }]);
		h.api.noteQueryDraft('Продажи', GOOD);
		h.api.commitQueryDraft('Продажи');
		h.api.saved({ ok: false, error: 'текст не принят' });
		assert.deepEqual(h.api.errors.get('Продажи'), { text: GOOD, message: 'Запрос не сохранён: текст не принят', refused: true });
		// Отказ слышен и тому, кто уже ушёл из поля: плашка в живой области
		assert.deepEqual(h.notices, [['error', 'Запрос не сохранён']]);
		// Отклонённый текст уход со страницы и из окна, смена набора и закладки заново не шлют; уход из поля — шлёт (отказ мог быть временным)
		const sentBefore = h.posted.length;
		h.api.flushQueryEdits('passive');
		assert.equal(h.posted.length, sentBefore, 'отклонённый текст ушёл заново на переключение окна');
		h.api.flushQueryEdits('nav');
		assert.equal(h.posted.length, sentBefore, 'отклонённый текст ушёл заново на смену набора (каждая стрелка в дереве)');
		h.api.commitQueryDraft('Продажи', 'edit');
		assert.equal(h.posted.length, sentBefore + 1, 'уход из поля не повторил запись');
		h.api.saved({ ok: false, error: 'текст не принят' });
		assert.equal(h.api.drafts.get('Продажи')?.text, GOOD, 'набранный текст потерян');
		assert.deepEqual(h.api.queryStatusText('Продажи', GOOD, true), { tone: 'error', text: 'Запрос не сохранён: текст не принят', kind: 'saved' });
		assert.notEqual(h.api.queryStatusText('Продажи', GOOD + ' ', true)?.text, 'Запрос не сохранён: текст не принят', 'причина у другого текста');
		// Изменённый после отказа текст уходит и при смене набора
		h.api.noteQueryDraft('Продажи', GOOD + ' ');
		h.api.flushQueryEdits('nav');
		assert.equal(h.posted.length, sentBefore + 2);
		h.api.saved({ ok: false, error: 'текст не принят' });
		h.api.noteQueryDraft('Продажи', GOOD);
		// Заполнение после удачной записи текста отклонено — повторит следующий уход из поля, текст менять не нужно
		h.api.commitQueryDraft('Продажи');
		const next = { dataSets: [{ name: 'Продажи', type: 'query', query: GOOD, autoFillFields: true }] };
		h.api.setModel(next);
		h.api.saved({ ok: true, model: next });
		h.api.saved({ ok: false, error: 'набор занят' });
		assert.equal(h.api.errors.get('Продажи')?.message, 'Поля из запроса не заполнены: набор занят');
		assert.deepEqual(h.notices[h.notices.length - 1], ['error', 'Поля из запроса не заполнены']);
		assert.equal(h.api.drafts.size, 0);
		const atRetry = h.posted.length;
		h.api.commitQueryDraft('Продажи', 'passive');
		assert.equal(h.posted.length, atRetry, 'уход из окна заполнил поля');
		h.api.commitQueryDraft('Продажи');
		assert.deepEqual(h.posted[atRetry], { type: 'dcs/autofill-fields', dataSet: 'Продажи' }, 'уход из поля не повторил заполнение');
		assert.equal(h.api.state().background?.stage, 'fill');
		h.api.saved({ ok: true, model: next, autofill: { added: [], skipped: [] } });
		assert.equal(h.api.pendingFills.size, 0);
	});

	test('уход из окна: пишется только текст, поля заполняются при следующем уходе из поля; отложенная запись — с тем же видом', () => {
		const h = harness([{ name: 'Продажи', type: 'query', query: 'ВЫБРАТЬ 1 КАК А', autoFillFields: true }]);
		h.api.noteQueryDraft('Продажи', 'ВЫБРАТЬ 1 КАК А, 2 КАК Сум');
		h.api.commitQueryDraft('Продажи', 'passive');
		assert.deepEqual(h.api.state().background, { key: 'Продажи', text: 'ВЫБРАТЬ 1 КАК А, 2 КАК Сум', autofill: false, fillLater: true, stage: 'text' });
		const typed = { dataSets: [{ name: 'Продажи', type: 'query', query: 'ВЫБРАТЬ 1 КАК А, 2 КАК Сум', autoFillFields: true }] };
		h.api.setModel(typed);
		h.api.saved({ ok: true, model: typed });
		assert.deepEqual(h.posted.map((msg) => msg.type), ['setQuery'], 'по недописанному тексту ушло заполнение');
		assert.deepEqual([...h.api.pendingFills.keys()], ['Продажи']);
		// Вернулся, дописал и ушёл из поля — уходят текст и заполнение (отложенное больше не нужно)
		h.api.noteQueryDraft('Продажи', 'ВЫБРАТЬ 1 КАК А, 2 КАК Сумма');
		h.api.commitQueryDraft('Продажи');
		assert.equal(h.api.state().background?.autofill, true);
		assert.equal(h.api.pendingFills.size, 0);
		const done = { dataSets: [{ name: 'Продажи', type: 'query', query: 'ВЫБРАТЬ 1 КАК А, 2 КАК Сумма', autoFillFields: true }] };
		h.api.setModel(done);
		h.api.saved({ ok: true, model: done });
		h.api.saved({ ok: true, model: done, autofill: { added: ['Сумма'], skipped: [] } });
		assert.deepEqual(h.posted.map((msg) => msg.type), ['setQuery', 'setQuery', 'dcs/autofill-fields']);
		// Вернулся и ушёл из поля, ничего не меняя: отложенное заполнение уходит без записи текста
		h.api.noteQueryDraft('Продажи', 'ВЫБРАТЬ 1 КАК А, 2 КАК Сумма, 3 КАК В');
		h.api.commitQueryDraft('Продажи', 'passive');
		const third = { dataSets: [{ name: 'Продажи', type: 'query', query: 'ВЫБРАТЬ 1 КАК А, 2 КАК Сумма, 3 КАК В', autoFillFields: true }] };
		h.api.setModel(third);
		h.api.saved({ ok: true, model: third });
		h.api.commitQueryDraft('Продажи');
		assert.deepEqual(h.posted.slice(-2), [{ type: 'setQuery', dataSet: 'Продажи', text: 'ВЫБРАТЬ 1 КАК А, 2 КАК Сумма, 3 КАК В' }, { type: 'dcs/autofill-fields', dataSet: 'Продажи' }]);
		h.api.saved({ ok: true, model: third, autofill: { added: ['В'], skipped: [] } });
		// Уход из окна, пока идёт чужая правка: отложенная запись уходит тоже без заполнения
		h.api.send('dcs/remove-field', { dataSet: 'Продажи', dataPath: 'А' });
		h.api.noteQueryDraft('Продажи', 'ВЫБРАТЬ 1 КАК А, 2 КАК Сумма, 3 КАК В, 4 КАК Г');
		h.api.commitQueryDraft('Продажи', 'passive');
		assert.equal(h.api.drafts.get('Продажи')?.retry, 'passive');
		h.api.setSaving(false);
		h.api.retryQueryDrafts();
		assert.equal(h.api.state().background?.autofill, false, 'отложенная запись ухода из окна заполнила поля');
		assert.equal(h.api.state().background?.fillLater, true);
	});

	test('включённое «Автозаполнение» заполняет поля сразу после записи флажка; без флажка, с ошибкой или пустым текстом — нет', () => {
		const h = harness([{ name: 'Продажи', type: 'query', query: GOOD, autoFillFields: false }]);
		const props = section('\tfunction dataSetProps(dataSet) {', '\tfunction fieldKindText(');
		assert.ok(props.includes("if (auto.input.checked && dataSet.type === 'query') {") && props.includes('pendingFills.set(setName, { retry: true });'));
		h.api.pendingFills.set('Продажи', { retry: true });
		// Ответ на флажок: канал свободен, модель с включённым флажком — уходит заполнение
		h.api.setModel({ dataSets: [{ name: 'Продажи', type: 'query', query: GOOD, autoFillFields: true }] });
		h.api.retryQueryDrafts();
		assert.deepEqual(h.posted, [{ type: 'dcs/autofill-fields', dataSet: 'Продажи' }]);
		assert.deepEqual(h.api.state().background, { key: 'Продажи', text: GOOD, autofill: true, fillLater: false, stage: 'fill' });
		h.api.saved({ ok: true, autofill: { added: ['Ссылка'], skipped: [] } });
		assert.deepEqual(h.notices, [['ok', 'Заполнение из запроса']]);
		// Флажок не записался (модель без него), текст с ошибкой, пустой текст — отложенное заполнение забывается
		for (const set of [
			{ name: 'Продажи', type: 'query', query: GOOD, autoFillFields: false },
			{ name: 'Продажи', type: 'query', query: BROKEN, autoFillFields: true },
			{ name: 'Продажи', type: 'query', query: '', autoFillFields: true },
		]) {
			h.api.setModel({ dataSets: [set] });
			h.api.pendingFills.set('Продажи', { retry: true });
			h.api.retryQueryDrafts();
			assert.equal(h.posted.length, 1, 'заполнение ушло: ' + JSON.stringify(set));
			assert.equal(h.api.pendingFills.size, 0);
		}
		// Канал занят — заполнение ждёт ответа
		h.api.setModel({ dataSets: [{ name: 'Продажи', type: 'query', query: GOOD, autoFillFields: true }] });
		h.api.pendingFills.set('Продажи', { retry: false });
		h.api.send('dcs/remove-field', { dataSet: 'Продажи', dataPath: 'А' });
		h.api.commitQueryDraft('Продажи');
		assert.equal(h.api.pendingFills.get('Продажи')?.retry, true);
		h.api.setSaving(false);
		h.api.retryQueryDrafts();
		assert.deepEqual(h.posted[h.posted.length - 1], { type: 'dcs/autofill-fields', dataSet: 'Продажи' });
	});

	test('итог заполнения: плашка — при новых полях или новых пропусках; те же пропуски после каждой правки не повторяются', () => {
		const h = harness([{ name: 'Продажи', type: 'query', query: 'ВЫБРАТЬ 1 КАК А', autoFillFields: true }]);
		const round = (text: string, autofill: Record<string, unknown>): void => {
			h.api.noteQueryDraft('Продажи', text);
			h.api.commitQueryDraft('Продажи');
			const next = { dataSets: [{ name: 'Продажи', type: 'query', query: text, autoFillFields: true }] };
			h.api.setModel(next);
			h.api.saved({ ok: true, model: next });
			h.api.saved({ ok: true, model: next, autofill });
		};
		const skip = { expression: '1 + 1', reason: 'нет псевдонима' };
		round('ВЫБРАТЬ 1 КАК А, 1 + 1', { added: [], skipped: [skip] });
		assert.equal(h.notices.length, 1, 'новый пропуск не показан');
		round('ВЫБРАТЬ 1 КАК А, 1 + 1 ', { added: [], skipped: [skip] });
		assert.equal(h.notices.length, 1, 'тот же пропуск показан после каждой правки');
		round('ВЫБРАТЬ 1 КАК А, 1 + 1, 2 КАК Б', { added: ['Б'], skipped: [skip] });
		assert.equal(h.notices.length, 2, 'новое поле не показано');
		round('ВЫБРАТЬ 1 КАК А, 1 + 1, 2 + 2', { added: [], skipped: [skip, { expression: '2 + 2', reason: 'нет псевдонима' }] });
		assert.equal(h.notices.length, 3, 'новый пропуск не показан');
	});

	test('черновики после новой модели: записанный и ушедший набор забываются, переписанный конструктором уступает, набранное во время записи живёт', () => {
		const h = harness([{ name: 'Продажи', type: 'query', query: 'ВЫБРАТЬ 1 КАК А', autoFillFields: false }]);
		// Набор во время записи: возврат к тексту модели — тоже черновик, пока запись в полёте
		h.api.noteQueryDraft('Продажи', GOOD);
		h.api.commitQueryDraft('Продажи');
		h.api.noteQueryDraft('Продажи', 'ВЫБРАТЬ 1 КАК А');
		assert.equal(h.api.drafts.get('Продажи')?.text, 'ВЫБРАТЬ 1 КАК А', 'возврат к прежнему тексту во время записи потерян');
		h.api.commitQueryDraft('Продажи');
		assert.equal(h.api.drafts.get('Продажи')?.retry, 'edit', 'запись во время чужой отложена не была');
		const next = { dataSets: [{ name: 'Продажи', type: 'query', query: GOOD, autoFillFields: false }] };
		h.api.setModel(next);
		h.api.saved({ ok: true, model: next });
		assert.deepEqual(h.posted.map((msg) => msg.text), [GOOD, 'ВЫБРАТЬ 1 КАК А'], 'отложенная запись не ушла после ответа');
		h.api.saved({ ok: true, model: { dataSets: [{ name: 'Продажи', type: 'query', query: 'ВЫБРАТЬ 1 КАК А' }] } });
		// Конструктор записал свой текст поверх черновика — черновик уступает; ушедший набор — тоже
		h.api.setModel({ dataSets: [{ name: 'Продажи', type: 'query', query: 'ВЫБРАТЬ 1 КАК А' }, { name: 'Остатки', type: 'query', query: 'ВЫБРАТЬ 2' }] });
		h.api.noteQueryDraft('Продажи', 'черновик');
		h.api.noteQueryDraft('Остатки', 'черновик 2');
		assert.equal(h.api.drafts.size, 2);
		h.api.setModel({ dataSets: [{ name: 'Продажи', type: 'query', query: 'ВЫБРАТЬ 3 КАК В' }] });
		h.api.reconcileQueryDrafts();
		assert.equal(h.api.drafts.size, 0);
	});

	test('разметка и связи: у поля «Конструктор…»; окна, мастер и API ждут не фоновую запись; запись перед сменой набора, закладки и конструктором', () => {
		const editor = topFunction('renderQueryEditor(host, dataSet, readOnly) {');
		assert.ok(editor.includes('queryConstructorButton(dataSet, setName, editor.input)'));
		assert.ok(editor.includes("editor.input.addEventListener('blur', () => {") && editor.includes('const emptyRefused = commitQueryDraft(key, mode);'));
		// blur поля при уходе окна (document.hasFocus() — false) — не конец правки: только текст, без заполнения
		assert.ok(editor.includes("const mode = windowHasFocus() ? 'edit' : 'passive';"));
		// О незаписанном пустом тексте — плашкой, об ошибке разбора — скрытой живой строкой, один раз при уходе из поля
		assert.ok(editor.includes("showNotice('error', 'Запрос не сохранён', [{ text: EMPTY_QUERY_PROBLEM }]);"));
		assert.ok(editor.includes("} else if (state.kind === 'parse') {"));
		assert.ok(editor.includes("status.id = 'dcsQueryStatus';") && editor.includes("editor.input.setAttribute('aria-describedby', described.join(' '));"));
		assert.ok(editor.includes('attachNameCheck(editor.box, editor.input, dataSet.query);'), 'черновик проверка имён считала бы записанным');
		assert.ok(editor.includes('renderQueryStatus(status, key, editor.input.value, autoFill, editor.input)'), 'поле без aria-invalid');
		// «⋯» — следующая остановка Tab после поля: с ключом, фокус на ней переживает перерисовку
		assert.ok(editor.includes("keyed(completion.more, focusKey(['qmore', key]));"));
		assert.ok(topFunction('selectDataSet(names, keepFocus) {').includes("flushQueryEdits('nav');"));
		assert.ok(topFunction('renderTabs() {').includes("flushQueryEdits('nav');"));
		assert.ok(topFunction('queryConstructorButton(dataSet, path, queryInput) {').includes("flushQueryEdits('nav');"));
		// Уход со страницы и из окна — только текст
		const tail = section('\tfunction afterBackground(changed, key) {', '\t/** Пауза перепроверки имён после ввода');
		assert.equal((tail.match(/flushQueryEdits\('passive'\)/g) || []).length, 3);
		assert.ok(topFunction('openBaseDialog(width, title, okLabel, build, onSubmit) {').includes('onClick: (level) => (editBusy() ? level.shell.errorEl.textContent : onSubmit()),'));
		assert.ok(SCRIPT.includes('\t\tisSaving: editBusy,'), 'конструктор запроса видит фоновую запись как занятость');
		assert.ok(topFunction('startSettingsWizard(variantName) {').includes('if (editBusy()) {'));
		// Ответ фоновой записи — до обычной обработки saved: окна он не закрывает
		const handler = SCRIPT.slice(SCRIPT.indexOf("\t\tif (msg.type !== 'saved') {"));
		assert.ok(/saving = false;\n\t\tif \(background\) \{\n[^\n]*\n\t\t\tonBackgroundSaved\(msg\);\n\t\t\treturn;\n\t\t\}/.test(handler), 'ответ фоновой записи идёт обычным путём');
		const css = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.css'), 'utf8');
		assert.match(css, /\.dcs-query-status-error \{[^}]*color: var\(--vscode-errorForeground\);/);
		// Строка ошибок — первая под полем и во всю ширину, за ней скобки, затем проверка имён
		assert.match(css, /\.dcs-hl-box\.dcs-complete-host > \.dcs-query-status \{\n\tgrid-column: 1 \/ -1;\n\tgrid-row: 2;\n\}/);
		assert.match(css, /\.dcs-hl-box\.dcs-complete-host > \.dcs-hl-warn \{\n\tgrid-column: 1;\n\tgrid-row: 3;\n\}/);
		assert.match(css, /\.dcs-hl-box\.dcs-complete-host > \.dcs-query-names \{\n\tgrid-column: 1;\n\tgrid-row: 4;\n\}/);
		assert.equal((css.match(/\.dcs-hl-box\.dcs-complete-host > \.dcs-query-names/g) || []).length, 1, 'правило строки имён задано дважды');
	});

	test('ключи фокуса на вкладке наборов: «⋯», свойства набора, панель и строки дерева, пиктограммы над списками', () => {
		const props = section('\tfunction dataSetProps(dataSet) {', '\tfunction fieldKindText(');
		for (const part of ['source', 'auto', 'object']) {
			assert.ok(props.includes("focusKey(['setprop', setName, '" + part + "'])"), 'у свойства ' + part + ' нет ключа');
		}
		const tree = topFunction('renderDataSetTree(host) {');
		for (const part of ['add', 'rename', 'delete']) {
			assert.ok(tree.includes("focusKey(['settool', '" + part + "'])"), 'у команды дерева ' + part + ' нет ключа');
		}
		assert.ok(topFunction('appendSetRows(tree, items, prefix, depth) {').includes("keyed(row, focusKey(['set', key]));"));
		assert.ok(topFunction('listToolbar(host, buttons) {').includes("keyed(iconButton(spec), spec.key || focusKey(['tool', activeTabId, spec.name]))"));
	});

	test('возврат фокуса после окна: вызвавший узел, убранный перерисовкой, заменяет его преемник с тем же ключом', () => {
		const code =
			section('// ---------- фокус после перерисовки вкладки схемы ----------', '// ---------- кнопки переноса между списками ----------') +
			topFunction('liveFocusNode(node) {') +
			'\nreturn { liveFocusNode, keyed, focusKey, keys: focusKeys };';
		const api = (new Function('document', code) as (d: typeof doc) => { liveFocusNode(node: unknown): unknown; keyed(node: Node, key: string): Node; focusKey(parts: string[]): string })(doc);
		const content = doc.body.appendChild(el('section'));
		const pencil = content.appendChild(api.keyed(el('button'), api.focusKey(['fedit', 'Продажи', 'Сумма'])));
		assert.equal(api.liveFocusNode(pencil), pencil, 'живой узел подменён');
		// Фоновая запись перерисовала вкладку, пока окно было открыто
		content.textContent = '';
		const fresh = content.appendChild(api.keyed(el('button'), api.focusKey(['fedit', 'Продажи', 'Сумма'])));
		assert.equal(api.liveFocusNode(pencil), fresh);
		// Узел без ключа и без преемника остаётся собой; пустой — пустым
		const plain = el('button');
		assert.equal(api.liveFocusNode(plain), plain);
		content.textContent = '';
		assert.equal(api.liveFocusNode(fresh), fresh);
		assert.equal(api.liveFocusNode(null), null);
		doc.body.textContent = '';
		assert.ok(topFunction('restoreDialogFocus(closed, focusLeft) {').includes('level.returnFocus = liveFocusNode(level.returnFocus);'));
	});

	test('«Проверить схему» ждёт правку в полёте: сначала запись текста запроса, проверка — когда канал свободен', () => {
		const code =
			'let validating = false;\nlet saving = false;\n' +
			section('\t/**\n\t * Проверка схемы ждёт правку в полёте', '\t// ---------- конструктор запроса ----------') +
			'\nreturn { runQueuedValidate, setSaving: (v) => { saving = v; }, state: () => ({ validating, saving }) };';
		interface ValidateApi {
			runQueuedValidate(): void;
			setSaving(value: boolean): void;
			state(): { validating: boolean; saving: boolean };
		}
		const posted: string[] = [];
		const flushes: string[] = [];
		/** Экземпляр кода кнопки; startsSave — правленый текст есть, и flush начинает его запись. */
		const make = (button: Node, startsSave: boolean): ValidateApi => {
			let api: ValidateApi | null = null;
			api = (new Function('validateBtn', 'post', 'flushQueryEdits', code) as (...args: unknown[]) => ValidateApi)(
				button,
				(type: string) => posted.push(type),
				(mode: string) => {
					flushes.push(mode);
					if (startsSave && api) {
						api.setSaving(true);
					}
				}
			);
			return api;
		};
		// Канал свободен — проверка сразу
		const button = el('button');
		make(button, false);
		button.fire('click');
		assert.deepEqual(posted, ['dcs/validate']);
		assert.deepEqual(flushes, ['nav'], 'правленый текст не записан перед проверкой');
		assert.equal(button.disabled, true);
		// Ответа проверки нет — второй щелчок ничего не шлёт
		button.fire('click');
		assert.deepEqual(posted, ['dcs/validate']);
		// Щелчок ушёл с правленым текстом (запись началась): проверка ждёт конца записи
		posted.length = 0;
		const button2 = el('button');
		const api2 = make(button2, true);
		button2.fire('click');
		assert.deepEqual(posted, [], 'проверка ушла поверх записи текста запроса');
		api2.runQueuedValidate();
		assert.deepEqual(posted, [], 'проверка ушла, пока канал занят');
		api2.setSaving(false);
		api2.runQueuedValidate();
		assert.deepEqual(posted, ['dcs/validate']);
		api2.runQueuedValidate();
		assert.deepEqual(posted, ['dcs/validate'], 'проверка ушла дважды');
		// Обработчик сообщений зовёт отложенную проверку после каждого ответа saved (обработчик — именованная
		// функция onHostMessage: ответ во время перетаскивания ждёт его конца)
		assert.ok(SCRIPT.includes("\t\tonSaved(msg);\n\t\t// Проверка схемы, отложенная до конца правки (validateQueued), уходит, когда канал свободен\n\t\trunQueuedValidate();\n\t}\n"));
		assert.ok(SCRIPT.includes("window.addEventListener('message', (event) => whenIdle(() => onHostMessage(event)));"));
	});
});

describe('«Ресурсы» как в конфигураторе: «Доступные поля», кнопки переноса, таблица ресурсов', () => {
	interface TreeApi {
		element: Node;
		selected(): { path: string } | null;
		select(path: string, focus: boolean): void;
	}

	interface Helpers {
		transferButtons(host: Node, items: Array<Record<string, unknown>>): { box: Node; buttons: Node[] };
		setTransferState(node: Node, title: string, unavailable: boolean, note: string): void;
		fieldTree(host: Node, spec: Record<string, unknown>): TreeApi;
		fieldTreeKey(path: string): string;
	}

	/** Разделы кнопок переноса и дерева dcs-editor.js как есть: el, keyed и focusKey — заглушки. */
	function helpers(): Helpers {
		const code =
			NAME_HELPERS +
			topFunction('spokenReason(note, unavailable) {') +
			section('// ---------- кнопки переноса между списками ----------', '// ---------- каркас вкладок ----------') +
			'\nreturn { transferButtons, setTransferState, fieldTree, fieldTreeKey };';
		const factory = new Function('el', 'document', 'keyed', 'focusKey', code) as (...args: unknown[]) => Helpers;
		return factory(
			el,
			doc,
			(node: Node, key: string) => {
				node.setAttribute('data-dcs-key', key);
				return node;
			},
			(parts: string[]) => parts.join('\n')
		);
	}

	const NODES = [
		{ name: 'Склад', path: 'Склад', kind: 'field', title: 'Склад товара', children: [] },
		{ name: 'Папка', path: 'Папка', kind: 'folder', children: [{ name: 'Цена', path: 'Папка.Цена', kind: 'field', children: [] }] },
		{ name: 'Контрагент', path: 'Контрагент', kind: 'field', children: [{ name: 'ИНН', path: 'Контрагент.ИНН', kind: 'field', children: [] }] },
		{ name: 'Наценка', path: 'Наценка', kind: 'calc', children: [] },
	];

	const labelOf = (row: Node): string => row.find((child) => child.className === 'dcs-tree-label')[0].textContent;

	test('кнопки переноса: знак, имя — в aria-label, недоступная остаётся в обходе Tab с причиной; состояние меняется без перерисовки', () => {
		const { transferButtons, setTransferState } = helpers();
		const host = el('div');
		const clicks: string[] = [];
		const made = transferButtons(host, [
			{ label: '>', title: 'Добавить', onClick: () => clicks.push('>') },
			{ label: '>>', title: 'Добавить все', unavailable: true, note: 'Недоступно: причина.', onClick: () => clicks.push('>>') },
		]);
		assert.equal(made.box.className, 'dcs-qd-moves');
		assert.equal(host.children[0], made.box);
		const [one, all] = made.buttons;
		assert.equal(one.className, 'ghost-btn dcs-qd-move');
		assert.equal(one.type, 'button');
		assert.equal(one.textContent, '>');
		assert.equal(one.getAttribute('aria-label'), 'Добавить');
		assert.equal(one.title, 'Добавить');
		assert.equal(one.getAttribute('aria-disabled'), null);
		assert.equal(all.getAttribute('aria-disabled'), 'true');
		assert.equal(all.disabled, false, 'недоступная выпала бы из обхода Tab');
		assert.equal(all.title, 'Добавить все\nНедоступно: причина.');
		// «Недоступно» читалка говорит сама (aria-disabled): в описании — только причина, подсказка для глаза — полная
		assert.equal(all.getAttribute('aria-description'), 'Причина.');
		all.fire('click');
		assert.deepEqual(clicks, ['>>'], 'щелчок недоступной не дошёл до обработчика — причину некому сказать');
		setTransferState(one, 'Добавить', true, 'Выберите поле.');
		assert.equal(one.getAttribute('aria-disabled'), 'true');
		assert.equal(one.getAttribute('aria-description'), 'Выберите поле.');
		setTransferState(one, 'Добавить', false, '');
		assert.equal(one.getAttribute('aria-disabled'), null);
		assert.equal(one.getAttribute('aria-description'), null);
		assert.equal(one.title, 'Добавить');
	});

	test('дерево «Доступные поля»: строки, «f(x)» у вычисляемого (словами для читалки), пометка, одна остановка Tab, крючок источника', () => {
		const { fieldTree } = helpers();
		const host = doc.body.appendChild(el('div'));
		const decorated: string[] = [];
		const state = { selected: '', expanded: new Set<string>() };
		const tree = fieldTree(host, {
			label: 'Доступные поля',
			nodes: NODES,
			state,
			keyPrefix: 'resavail',
			note: (node: { path: string }) => (node.path === 'Склад' ? 'ресурс' : ''),
			onActivate: () => undefined,
			decorate: (_row: Node, node: { path: string }) => decorated.push(node.path),
		});
		assert.equal(tree.element.getAttribute('role'), 'tree');
		assert.equal(tree.element.getAttribute('aria-label'), 'Доступные поля');
		assert.equal(tree.element.className, 'dcs-tree dcs-qd-tree dcs-field-tree');
		const rows = tree.element.children;
		assert.deepEqual(rows.map(labelOf), ['Склад', 'Папка', 'Контрагент', 'Наценка']);
		assert.deepEqual(decorated, ['Склад', 'Папка', 'Контрагент', 'Наценка']);
		assert.deepEqual(rows.map((row) => row.tabIndex), [0, -1, -1, -1], 'без выбора остановка — первая строка');
		assert.deepEqual(rows.map((row) => row.getAttribute('aria-level')), ['1', '1', '1', '1']);
		assert.equal(rows[1].getAttribute('aria-expanded'), 'false');
		assert.equal(rows[0].getAttribute('aria-expanded'), null);
		assert.equal(rows[0].getAttribute('aria-label'), 'Склад, Склад товара, ресурс');
		assert.equal(rows[0].getAttribute('data-dcs-key'), 'resavail\nсклад');
		const badge = rows[3].find((child) => child.className === 'dcs-field-badge')[0];
		assert.equal(badge.textContent, 'f(x)');
		assert.equal(badge.getAttribute('aria-hidden'), 'true');
		assert.equal(rows[3].getAttribute('aria-label'), 'Наценка, вычисляемое поле');
		// У строки нет title: он стал бы описанием и повторил имя («Наценка — вычисляемое поле»); путь — у подписи
		assert.deepEqual(rows.map((row) => row.title), ['', '', '', '']);
		assert.equal(badge.title, 'Вычисляемое поле');
		assert.equal(rows[0].find((child) => child.className === 'dcs-field-badge').length, 0, '«f(x)» у поля набора');
		state.expanded.add('папка');
		tree.select('Папка', false);
		const nested = fieldTree(doc.body.appendChild(el('div')), { label: 'Доступные поля', nodes: NODES, state, keyPrefix: 'resavail', onActivate: () => undefined });
		const child = nested.element.children[2];
		assert.equal(child.find((node) => node.className === 'dcs-tree-label')[0].title, 'Папка.Цена', 'полный путь поля через точку не виден подсказкой');
		assert.equal(child.title, '');
		assert.equal(rows[0].find((node) => node.className === 'dcs-tree-label')[0].title, '', 'путь, равный имени, подсказкой не повторяется');
		doc.body.textContent = '';
	});

	test('дерево: стрелки выбирают без перерисовки, → ← раскрывают и ходят по уровням, Enter — действие поля, у папки — раскрытие', () => {
		const { fieldTree } = helpers();
		const host = doc.body.appendChild(el('div'));
		const state = { selected: '', expanded: new Set<string>() };
		const activated: string[] = [];
		const selected: Array<string | null> = [];
		const tree = fieldTree(host, {
			label: 'Доступные поля',
			nodes: NODES,
			state,
			keyPrefix: 'resavail',
			onActivate: (node: { path: string }) => activated.push(node.path),
			onSelect: (node: { path: string } | null) => selected.push(node ? node.path : null),
		});
		const rows = (): Node[] => tree.element.children;
		const first = rows()[0];
		first.focus();
		assert.equal(first.fire('keydown', { key: 'ArrowDown' }), true);
		assert.equal(rows()[0], first, 'стрелка перерисовала дерево');
		assert.equal(state.selected, 'папка');
		assert.equal(doc.activeElement, rows()[1]);
		assert.deepEqual(rows().map((row) => row.tabIndex), [-1, 0, -1, -1]);
		assert.deepEqual(rows().map((row) => row.getAttribute('aria-selected')), ['false', 'true', 'false', 'false']);
		assert.ok(rows()[1].classList.contains('dcs-tree-selected'));
		// Enter у папки — раскрытие (действия у неё нет), фокус остаётся на ней
		rows()[1].fire('keydown', { key: 'Enter' });
		assert.deepEqual(activated, []);
		assert.ok(state.expanded.has('папка'));
		assert.deepEqual(rows().map(labelOf), ['Склад', 'Папка', 'Цена', 'Контрагент', 'Наценка']);
		assert.equal(rows()[2].getAttribute('aria-level'), '2');
		assert.equal(doc.activeElement, rows()[1]);
		// → у раскрытой — к первому ребёнку; ← у ребёнка — к родителю; ← у раскрытой — сворачивает
		rows()[1].fire('keydown', { key: 'ArrowRight' });
		assert.equal(doc.activeElement, rows()[2]);
		rows()[2].fire('keydown', { key: 'ArrowLeft' });
		assert.equal(doc.activeElement, rows()[1]);
		rows()[1].fire('keydown', { key: 'ArrowLeft' });
		assert.equal(state.expanded.has('папка'), false);
		assert.deepEqual(rows().map(labelOf), ['Склад', 'Папка', 'Контрагент', 'Наценка']);
		// → у свёрнутого поля с реквизитами раскрывает, Enter у поля с детьми — действие поля
		rows()[2].fire('click');
		rows()[2].fire('keydown', { key: 'ArrowRight' });
		assert.ok(state.expanded.has('контрагент'));
		rows()[2].fire('keydown', { key: 'Enter' });
		assert.deepEqual(activated, ['Контрагент']);
		// Повтор зажатого Enter строку снова не активирует (на «Ресурсах» каждое Enter пишет ресурс), но и не уходит наружу
		assert.equal(rows()[2].fire('keydown', { key: 'Enter', repeat: true }), true);
		assert.deepEqual(activated, ['Контрагент'], 'повтор Enter активировал строку');
		rows()[3].fire('dblclick');
		assert.deepEqual(activated, ['Контрагент', 'Контрагент.ИНН']);
		// End и Home — края; выбор с клавиатуры сообщает onSelect
		rows()[0].fire('keydown', { key: 'End' });
		assert.equal(doc.activeElement, rows()[rows().length - 1]);
		rows()[rows().length - 1].fire('keydown', { key: 'Home' });
		assert.equal(doc.activeElement, rows()[0]);
		assert.equal(selected[selected.length - 1], 'Склад');
		// Выбор снаружи: путь без учёта регистра
		tree.select('КОНТРАГЕНТ.инн', true);
		assert.equal(tree.selected()?.path, 'Контрагент.ИНН');
		assert.equal(doc.activeElement?.getAttribute('aria-level'), '2');
		// Клавиша, которую уже обработали, не трогается
		assert.equal(rows()[0].fire('keydown', { key: 'ArrowDown', defaultPrevented: true }), false);
		// Выбор идёт за фокусом: Tab в дерево выбирает строку-остановку
		rows()[0].fire('focus');
		assert.equal(state.selected, 'склад');
		assert.equal(selected[selected.length - 1], 'Склад');
		doc.body.textContent = '';
	});

	interface GridHarness {
		table: Node;
		rows(): Node[];
		buttons(row: Node): Node[];
		ui: { selected: number; focusGrid: boolean };
		opened: Array<[string, number]>;
		removed: Array<[number, string]>;
	}

	/** resourceGrid как есть: кнопки строки (actionsCell), окна ресурса и удаление — заглушки. */
	function grid(totals: Array<Record<string, unknown>>, selected = 0): GridHarness {
		const out = { opened: [] as Array<[string, number]>, removed: [] as Array<[number, string]> };
		const ui = { tree: { selected: '', expanded: new Set() }, selected, focusGrid: false };
		const keyed = (node: Node, key: string): Node => {
			node.setAttribute('data-dcs-key', key);
			return node;
		};
		const code =
			NAME_HELPERS +
			topFunction('cell(tr, text, className) {') +
			topFunction('totalFieldPath(item) {') +
			topFunction('totalFieldExpression(item) {') +
			topFunction('resourceGrid(host, totals) {') +
			'\nreturn resourceGrid;';
		const resourceGrid = (new Function('el', 'document', 'keyed', 'focusKey', 'actionsCell', 'resourceUi', 'openTotalFieldDialog', 'removeResource', code) as (
			...args: unknown[]
		) => (host: Node, items: unknown[]) => void)(
			el,
			doc,
			keyed,
			(parts: string[]) => parts.join('\n'),
			(tr: Node, actions: Array<{ title: string; key?: string; onClick: () => void }>) => {
				const td = tr.appendChild(el('td', 'dcs-cell-actions'));
				for (const action of actions) {
					const button = td.appendChild(el('button'));
					button.title = action.title;
					if (action.key) {
						keyed(button, action.key);
					}
					button.addEventListener('click', action.onClick);
				}
			},
			ui,
			(item: { name: string }, index: number) => out.opened.push([item.name, index]),
			(index: number, from: string) => out.removed.push([index, from])
		);
		const host = doc.body.appendChild(el('div'));
		resourceGrid(host, totals);
		const table = host.children[0].children[0];
		const rows = (): Node[] => table.children[1].children;
		return {
			table,
			rows,
			buttons: (row: Node) => row.children[row.children.length - 1].children,
			ui,
			opened: out.opened,
			removed: out.removed,
		};
	}

	const TOTALS = [
		{ name: 'Сумма', value: 'Сумма(Сумма)' },
		{ name: 'Количество', value: 'ВЫБОР\n\tКОГДА Истина\n\tТОГДА Сумма(Количество)\nКОНЕЦ', groups: ['Склад', 'Номенклатура'] },
		{ name: 'Цена', value: 'Максимум(Цена)' },
	];

	test('таблица ресурсов: сетка с одной остановкой Tab, кнопки — только у выбранной строки, имя строки — все три колонки', () => {
		const g = grid(TOTALS, 1);
		assert.equal(g.table.getAttribute('role'), 'grid');
		assert.equal(g.table.getAttribute('aria-label'), 'Ресурсы');
		const rows = g.rows();
		assert.deepEqual(rows.map((row) => row.tabIndex), [-1, 0, -1], 'остановка — выбранная строка');
		assert.deepEqual(rows.map((row) => row.getAttribute('aria-selected')), ['false', 'true', 'false']);
		assert.deepEqual(rows.map((row) => g.buttons(row).map((button) => button.tabIndex)), [[-1, -1], [0, 0], [-1, -1]], 'кнопки невыбранных строк в обходе Tab');
		assert.deepEqual(rows.map((row) => row.getAttribute('data-dcs-key')), ['resrow\n0', 'resrow\n1', 'resrow\n2']);
		assert.deepEqual(g.buttons(rows[2]).map((button) => button.getAttribute('data-dcs-key')), ['resedit\n2', 'resdel\n2']);
		assert.equal(rows[0].getAttribute('aria-label'), 'Сумма: Сумма(Сумма)');
		assert.equal(rows[1].getAttribute('aria-label'), 'Количество: ВЫБОР КОГДА Истина ТОГДА Сумма(Количество) КОНЕЦ; рассчитывать по: Склад, Номенклатура', '«Рассчитывать по…» не слышно');
		// Многострочное выражение — в ячейке как есть, с переносами строк
		assert.equal(rows[1].children[1].textContent, TOTALS[1].value);
		doc.body.textContent = '';
	});

	test('таблица ресурсов: стрелки, Home, End — выбор и фокус; Enter — окно; Delete — удаление; фокус в кнопку переносит остановку', () => {
		const g = grid(TOTALS, 0);
		const rows = g.rows();
		rows[0].focus();
		assert.equal(rows[0].fire('keydown', { key: 'ArrowDown', target: rows[0] }), true);
		assert.equal(doc.activeElement, rows[1]);
		assert.equal(g.ui.selected, 1);
		assert.deepEqual(rows.map((row) => row.tabIndex), [-1, 0, -1]);
		rows[1].fire('keydown', { key: 'End', target: rows[1] });
		assert.equal(doc.activeElement, rows[2]);
		rows[2].fire('keydown', { key: 'ArrowDown', target: rows[2] });
		assert.equal(doc.activeElement, rows[2], 'край таблицы');
		rows[2].fire('keydown', { key: 'Home', target: rows[2] });
		assert.equal(doc.activeElement, rows[0]);
		rows[0].fire('keydown', { key: 'ArrowUp', target: rows[0] });
		assert.equal(g.ui.selected, 0);
		assert.equal(rows[0].fire('keydown', { key: 'Enter', target: rows[0] }), true);
		assert.deepEqual(g.opened, [['Сумма', 0]]);
		assert.equal(rows[0].fire('keydown', { key: 'Delete', target: rows[0] }), true);
		assert.deepEqual(g.removed, [[0, 'grid']], 'Delete в сетке не вернёт фокус в таблицу');
		// Клавиши кнопок строки и уже обработанные — не сетки
		const edit = g.buttons(rows[0])[0];
		assert.equal(rows[0].fire('keydown', { key: 'ArrowDown', target: edit }), false);
		assert.equal(rows[0].fire('keydown', { key: 'ArrowDown', target: rows[0], defaultPrevented: true }), false);
		// Щелчок по кнопке другой строки: фокус в неё переносит остановку Tab
		rows[2].fire('focusin', { target: g.buttons(rows[2])[1] });
		assert.equal(g.ui.selected, 2);
		assert.deepEqual(rows.map((row) => g.buttons(row).map((button) => button.tabIndex)), [[-1, -1], [-1, -1], [0, 0]]);
		g.buttons(rows[2])[1].fire('click');
		assert.deepEqual(g.removed[1], [2, 'row'], 'кнопка «Удалить» строки — своё происхождение');
		// Щелчок по ячейке выбирает строку без фокуса
		rows[1].fire('click', { target: rows[1].children[0] });
		assert.equal(g.ui.selected, 1);
		doc.body.textContent = '';
	});

	test('удаление ресурса: фокус после ответа — строка на том же месте, а без строк — «<»', () => {
		const replyFocusStub = { resources: false };
		const render = topFunction('renderResources(host) {');
		assert.ok(render.includes("const row = focusKeys.get(focusKey(['resrow', resourceUi.selected])) || focusKeys.get(focusKey(['resmove', '<']));"), 'удаление последнего ресурса теряет фокус');
		assert.ok(render.includes('if (core.focusResourceRow) {\n\t\t\tcore.focusResourceRow = false;'), 'фокус «Ресурсов» не по ответу правки');
		// Фокус на строку ждёт удачного ответа (replyFocus.resources): из таблицы — всегда, с кнопки последней строки — потому
		// что её после ответа нет; нажатая «<» фокус сохраняет
		const removeResource = new Function(
			'list',
			'confirmRemove',
			'send',
			'replyFocus',
			'showNotice',
			'totalFieldPath',
			'BUSY',
			topFunction('removeResource(index, from) {') + '\nreturn removeResource;'
		)(
			() => TOTALS,
			(_question: string, submit: () => unknown) => submit(),
			() => true,
			replyFocusStub,
			() => undefined,
			(item: { name: string }) => item.name,
			'busy'
		) as (index: number, from: string) => void;
		const cases: Array<[number, string, boolean]> = [
			[0, 'grid', true],
			[2, 'grid', true],
			[2, 'row', true],
			[1, 'row', false],
			[2, '', false],
			[0, '', false],
		];
		for (const [index, from, want] of cases) {
			replyFocusStub.resources = !want;
			removeResource(index, from);
			assert.equal(replyFocusStub.resources, want, `удаление ${index} (${from || '«<» или перенос'})`);
		}
		const css = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.css'), 'utf8');
		// Колонки друг под другом: дерево не на весь экран, и правило стоит после основного (иначе основное его перекрыло бы)
		const base = css.indexOf('.dcs-res .dcs-field-tree {\n\tmax-height: calc(100vh - 220px);');
		const narrow = css.indexOf('@media (max-width: 760px) {\n\t/* Колонки друг под другом: дерево не занимает весь экран');
		assert.ok(base > 0 && narrow > base, 'высота дерева на узком окне перекрыта основным правилом');
		assert.match(css.slice(narrow), /^@media \(max-width: 760px\) \{\n[^\n]*\n\t\.dcs-res \.dcs-field-tree \{\n\t\tmax-height: 40vh;/);
	});

	test('пустое дерево: текст пустого списка, фокус принимает сам список', () => {
		const { fieldTree } = helpers();
		const host = el('div');
		const tree = fieldTree(host, { label: 'Доступные поля', nodes: [], state: { selected: '', expanded: new Set() }, keyPrefix: 'x', empty: 'Полей нет.', onActivate: () => undefined });
		assert.equal(tree.element.tabIndex, -1);
		assert.equal(tree.element.children[0].className, 'dcs-qd-empty');
		assert.equal(tree.element.children[0].textContent, 'Полей нет.');
		assert.equal(tree.selected(), null);
	});

	test('закладка: дерево — каталог поля ресурса; «>», Enter, двойной щелчок и перенос — ресурс Сумма(Поле) без окна; «>>» — пакет; «+» — пустое окно', () => {
		const render = topFunction('renderResources(host) {');
		assert.ok(render.includes("const layout = el('div', 'dcs-res');"));
		assert.ok(render.includes("label: 'Доступные поля',") && render.includes("keyPrefix: 'resavail',"));
		assert.ok(render.includes('onActivate: (node) => addResourceFor(node),'));
		assert.ok(render.includes("{ label: '>', title: RESOURCE_ADD_TITLE, onClick: () => addResourceFor(tree.selected()) },"));
		// «>>» доступна, пока в дереве есть поля: итог (и «добавить нечего») говорит плашка; недоступна — только без полей
		assert.ok(render.includes('const noFields = !hasResourceFields(nodes);'));
		assert.ok(/label: '>>',\n\t+title: RESOURCE_ADD_ALL_TITLE,\n\t+unavailable: noFields,\n\t+note: noFields \? RESOURCE_NO_FIELDS_NOTE : '',/.test(render), '«>>» недоступна не только без полей');
		assert.ok(render.includes("onClick: () => (noFields ? showNotice('info', 'Ресурсы', [{ text: RESOURCE_NO_FIELDS_NOTE }]) : addAllResources(nodes, taken)),"));
		// «>» и «>>» пишут файл сразу: выражение — в имени кнопки (aria-label и title берут его из title), а Enter и двойной
		// щелчок по дереву — в его подсказке; повтор зажатого Enter на кнопках не жмёт их снова
		assert.ok(SCRIPT.includes("const RESOURCE_ADD_TITLE = 'Добавить ресурс Сумма(поле) по выбранному полю';"));
		assert.ok(SCRIPT.includes("const RESOURCE_ADD_ALL_TITLE = 'Добавить ресурсы Сумма(поле) по всем числовым полям';"));
		assert.ok(render.includes('setHint(tree.element, RESOURCE_TREE_HINT);'));
		assert.ok(SCRIPT.includes("const RESOURCE_TREE_HINT = 'Enter и двойной щелчок по полю добавляют ресурс Сумма(поле).';"));
		assert.ok(render.includes('ignoreEnterRepeat(moves.buttons[0]);\n\t\tignoreEnterRepeat(moves.buttons[1]);'), '«>» и «>>» жмутся повтором Enter');
		const repeat = topFunction('ignoreEnterRepeat(button) {');
		assert.ok(repeat.includes("if (event.key === 'Enter' && event.repeat) {\n\t\t\t\tevent.preventDefault();"));
		// Типы полей читаются заранее, после отрисовки (как проверка имён строки набора): к «>» описания обычно уже есть
		assert.ok(
			render.includes('setTimeout(() => requestDescriptions(resourceAddAllPlan(nodes, new Set(), resourceFieldKind, resourcePathPlain).pending), HIGHLIGHT_DEBOUNCE_MS);'),
			'описания полей не читаются заранее'
		);
		assert.ok(/resavail: \(payload\) => \{\n\t+const node = tree\.nodeOf\(payload\.key\);[\s\S]*?addResourceFor\(node\);\n\t+return undefined;/.test(render), 'перенос поля — не «>»');
		assert.ok(render.includes("listToolbar(right, [{ icon: 'add', name: 'Добавить ресурс…', onClick: () => openTotalFieldDialog(null, -1) }]);"), 'команда «Добавить ресурс…» пропала');
		assert.ok(topFunction('resourceFieldNodes() {').includes("completer.buildCatalog(core.model, null, 'total-field', completionTypeOptions()).nodes"), 'дерево не по каталогу поля ресурса');
		// Окно ресурса выражения по умолчанию не подставляет и поле из дерева не берёт: оно для своего выражения
		const dialog = topFunction('openTotalFieldDialog(item, index) {');
		assert.ok(dialog.includes("exprInput = expressionInput(body, 'Выражение', totalFieldExpression(original), () => 'expr-total');"));
		assert.ok(dialog.includes("pathInput = formRow(body, 'Поле', textInput(totalFieldPath(original)));"));
		assert.ok(!/Сумма\(|preset/.test(dialog), 'окно подставляет выражение или поле');
		// Новый ресурс из окна выбран после удачного ответа, а не до него: отказ выбор не сдвигает
		assert.ok(dialog.includes("core.resourceReply = { row: list('totalFields').length };"));
		assert.ok(!dialog.includes('resourceUi.selected ='), 'выбор строки — до ответа');
		// Ответ saved: выбор нового ресурса до отрисовки, плашка итога — после неё; отказ итог сбрасывает
		const onSaved = topFunction('onSaved(msg) {');
		const pick = onSaved.indexOf('resourceUi.selected = resourceDone.row;');
		const draw = onSaved.indexOf('renderContent();', pick);
		const model = onSaved.indexOf('model = withTypeCompositions(msg.model);');
		const say = onSaved.indexOf('const resourceNotice = resourceDone ? resourceReplyNotice(resourceDone) : null;');
		assert.ok(pick > 0 && draw > pick && say > draw && say > model, 'выбор и плашка «Ресурсов» не по ответу');
		assert.ok(onSaved.includes("if (resourceNotice) {\n\t\t\t\tshowNotice(resourceNotice.tone, 'Ресурсы', resourceNotice.lines);"), 'у окна без плашки — пустая плашка');
		// Отказ «>>» называет поле: текст отказа считается до сброса итога
		const refusal = onSaved.indexOf("const refusal = msg.ok ? '' : resourceRefusalText(resourceReply, msg.error);");
		assert.ok(refusal > 0 && refusal < onSaved.indexOf('resourceReply = null;'), 'текст отказа — после сброса итога');
		assert.ok(onSaved.slice(onSaved.lastIndexOf('pendingRename = null;')).includes('resourceReply = null;'), 'отказ не сбросил итог «Ресурсов»');
		assert.ok(topFunction('removeAllResources() {').includes("send('dcs/remove-total-fields', { indexes: totals.map((item, index) => index) })"));
		assert.ok(topFunction('removeAllResources() {').includes("confirmRemove('Удалить все ресурсы (' + totals.length + ')?'"), '«<<» без подтверждения');
		assert.ok(topFunction('removeResource(index, from) {').includes("confirmRemove('Удалить ресурс «' + totalFieldPath(item) + '»?'"), '«<» без подтверждения');
		const grid = topFunction('resourceGrid(host, totals) {');
		assert.ok(grid.includes("table.setAttribute('role', 'grid');") && grid.includes("['Поле', 'Выражение', 'Рассчитывать по…', '']"));
		assert.ok(grid.includes("cell(tr, totalFieldExpression(item), 'dcs-res-expr'),"));
		const css = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.css'), 'utf8');
		assert.match(css, /\.dcs-res \{[^}]*grid-template-columns: minmax\(200px, 280px\) auto minmax\(0, 1fr\);/);
		assert.match(css, /@media \(max-width: 760px\) \{\n\t\.dcs-res \{\n\t\tgrid-template-columns: minmax\(0, 1fr\);/);
		assert.match(css, /\.dcs-res-table td\.dcs-res-expr \{[^}]*white-space: pre-wrap;/);
		assert.match(css, /\.dcs-field-badge \{[^}]*color: var\(--vscode-descriptionForeground\);/);
		assert.match(css, /\.dcs-qd-moves \.ghost-btn\[aria-disabled='true'\] \{/);
		// Кнопки переноса — в API редактора (их берёт конструктор запроса); дерево «Доступные поля» конструктору не нужно,
		// мёртвого члена в замороженном API нет
		assert.ok(SCRIPT.includes('\t\ttransferButtons: transferButtons,\n'));
		assert.ok(!SCRIPT.includes('\t\tfieldTree: fieldTree,'), 'неиспользуемый fieldTree в API редактора');
	});

	interface Typing {
		kind: string;
		type?: unknown;
		pending?: Array<{ key: string }>;
	}
	interface ResourceNode {
		name?: string;
		path: string;
		kind: string;
		children?: ResourceNode[];
	}
	interface Plan {
		add: string[];
		unknown: string[];
		unsafe: string[];
		pending: Array<{ key: string }>;
	}
	interface Reply {
		row: number;
		add?: { path: string; kind: string; expression: string };
		batch?: { add: string[]; unknown: string[]; unsafe: string[] };
	}
	type Lines = Array<{ text: string }>;
	interface AddHarness {
		addResourceFor(node: ResourceNode | null): void;
		addAllResources(nodes: ResourceNode[], taken: Set<string>): void;
		resourceExpression(path: string): string;
		resourcePathPlain(path: string): boolean;
		resourceAddAllPlan(nodes: ResourceNode[], taken: Set<string>, kindOf: (node: ResourceNode) => Typing, plainOf: (path: string) => boolean): Plan;
		resourceAddAllLines(added: string[], unknown: string[], unsafe: string[]): Lines;
		resourceReplyNotice(reply: Reply): { tone: string; lines: Lines } | null;
		resourceRefusalText(reply: Reply | null, error: unknown): unknown;
		hasResourceFields(nodes: ResourceNode[]): boolean;
		reply(): Reply | null;
		/** Ответ saved: плашка итога, как её соберёт onSaved (по видам типов на момент ответа). */
		answer(): { tone: string; lines: Lines } | null;
		typings: Record<string, Typing>;
		totals: Array<{ name: string; value: string; groups?: string[] }>;
		sent: Array<[string, unknown]>;
		notices: Array<[string, string, Lines]>;
		requested: Array<Array<{ key: string }>>;
		busy: number;
	}

	const fieldTypesModule = loadModule('dcs-editor-field-types.js');

	/**
	 * «>» и «>>» закладки как есть (константы, план, тексты, добавление, плашка ответа, текст отказа): канал правок, модель,
	 * вид типа поля, запрос описаний, плашка и подпись типа — заглушки; правило пути — настоящий DcsFieldTypes.
	 * typings — вид типа по пути поля (его можно поменять до ответа: так приходят описания); totals — число ресурсов в
	 * схеме или сами ресурсы; free — канал свободен.
	 */
	function adding(typings: Record<string, Typing>, totals: number | AddHarness['totals'] = 2, free = true): AddHarness {
		const h = {
			sent: [],
			notices: [],
			requested: [],
			busy: 0,
			typings,
			totals: Array.isArray(totals) ? totals : Array.from({ length: totals }, (_, index) => ({ name: 'Р' + index, value: 'Сумма(Р' + index + ')' })),
		} as unknown as AddHarness;
		const code =
			'let resourceReply = null;\n' +
			topLine('RESOURCE_PICK_NOTE') +
			topLine('RESOURCE_TYPES_LOADING') +
			topLine('RESOURCE_NAMES_SHOWN') +
			topFunction('fieldTreeKey(path) {') +
			topFunction('totalFieldPath(item) {') +
			topFunction('totalFieldExpression(item) {') +
			topFunction('resourcePickable(node) {') +
			topFunction('resourceExpression(path) {') +
			topFunction('resourcePathPlain(path) {') +
			topFunction('resourceAddedLines(path, expression, typing, plain) {') +
			topFunction('resourceAddAllPlan(nodes, taken, kindOf, plainOf) {') +
			topFunction('resourceNameList(paths) {') +
			topFunction('resourceAddAllLines(added, unknown, unsafe) {') +
			topFunction('resourceRepeats(totals, path, expression) {') +
			topFunction('resourceReplyNotice(reply) {') +
			topFunction('resourceRefusalText(reply, error) {') +
			topFunction('hasResourceFields(nodes) {') +
			topFunction('addResourceFor(node) {') +
			topFunction('addAllResources(nodes, taken) {') +
			'\nreturn { addResourceFor, addAllResources, resourceExpression, resourcePathPlain, resourceAddAllPlan, resourceAddAllLines, resourceReplyNotice,' +
			' resourceRefusalText, hasResourceFields, reply: () => resourceReply, answer: () => (resourceReply ? resourceReplyNotice(resourceReply) : null) };';
		const api = new Function('send', 'list', 'resourceFieldKind', 'requestDescriptions', 'showNotice', 'resourceBusy', 'typeLabelOf', 'fieldTypes', withCoreAccessors(code))(
			(type: string, fields: unknown) => {
				if (!free) {
					return false;
				}
				h.sent.push([type, fields]);
				return true;
			},
			(name: string) => (name === 'totalFields' ? h.totals : []),
			(node: ResourceNode) => h.typings[node.path] ?? { kind: 'unknown', type: null, pending: [] },
			(pending: Array<{ key: string }>) => h.requested.push(pending),
			(tone: string, title: string, lines: Lines) => h.notices.push([tone, title, lines]),
			() => {
				h.busy += 1;
			},
			(type: { types?: string[] } | null) => (type && type.types && type.types[0] === 'xs:string' ? 'Строка' : ''),
			fieldTypesModule
		) as Omit<AddHarness, 'sent' | 'notices' | 'requested' | 'busy' | 'typings' | 'totals'>;
		return Object.assign(h, api);
	}

	const STRING = { types: ['xs:string'], typeSets: [], typeIds: [] };
	const DECIMAL = { types: ['xs:decimal'], typeSets: [], typeIds: [] };

	test('«>»: ресурс Сумма(путь как есть) сразу — правкой окна «Новый ресурс» без «Рассчитывать по»; итог и выбор — после ответа', () => {
		const h = adding({ Склад: { kind: 'numeric', type: DECIMAL, pending: [] } });
		assert.equal(h.resourceExpression('Контрагент.ИНН'), 'Сумма(Контрагент.ИНН)', 'путь — как есть, без скобок');
		h.addResourceFor({ path: 'Склад', kind: 'field' });
		assert.deepEqual(h.sent, [['dcs/add-total-field', { payload: { dataPath: 'Склад', expression: 'Сумма(Склад)' } }]]);
		assert.deepEqual(h.reply(), { row: 2, add: { path: 'Склад', kind: 'field', expression: 'Сумма(Склад)' } }, 'новый ресурс — последним');
		assert.deepEqual(h.answer(), { tone: 'ok', lines: [{ text: 'Добавлен ресурс Сумма(Склад).' }] }, 'итог — плашкой после ответа');
		assert.equal(h.notices.length, 0, 'плашка до ответа');
		// Вычисляемое поле — та же правка
		h.addResourceFor({ path: 'Наценка', kind: 'calc' });
		assert.deepEqual(h.sent[1], ['dcs/add-total-field', { payload: { dataPath: 'Наценка', expression: 'Сумма(Наценка)' } }]);
		assert.deepEqual(h.reply()?.add, { path: 'Наценка', kind: 'calc', expression: 'Сумма(Наценка)' }, 'вид узла нужен, чтобы тип пересчитать в ответе');
		// Папка и промежуточный узел — подсказка, без правки
		h.addResourceFor({ path: 'Папка', kind: 'folder' });
		h.addResourceFor(null);
		assert.equal(h.sent.length, 2);
		assert.deepEqual(
			h.notices.map((notice) => notice[2][0].text),
			['Выберите поле в «Доступных полях» (не папку).', 'Выберите поле в «Доступных полях» (не папку).']
		);
		// Канал занят: правки нет, итога нет, занятость сказана
		const busy = adding({}, 0, false);
		busy.addResourceFor({ path: 'Склад', kind: 'field' });
		assert.equal(busy.busy, 1);
		assert.equal(busy.reply(), null);
	});

	test('«>» по полю, у которого уже есть ровно такой ресурс, второй не пишет и говорит, как добавить другой; иной ресурс по полю — пишет', () => {
		const repeat = 'Ресурс Сумма(Склад) уже есть. Второй ресурс по этому полю нужен с другим «Рассчитывать по», добавьте его окном «Добавить ресурс…».';
		// Тот же путь (без учёта регистра) и то же выражение (без учёта регистра и пробелов), по всем группировкам
		for (const existing of [
			{ name: 'Склад', value: 'Сумма(Склад)' },
			{ name: 'склад', value: 'СУММА( Склад )' },
			{ name: 'Склад', value: 'Сумма(Склад)', groups: [] },
			{ name: 'Склад', value: 'Сумма(Склад)', groups: [''] },
		]) {
			const h = adding({}, [existing]);
			h.addResourceFor({ path: 'Склад', kind: 'field' });
			assert.deepEqual(h.sent, [], JSON.stringify(existing) + ': записан повтор');
			assert.equal(h.reply(), null);
			assert.deepEqual(h.notices, [['info', 'Ресурсы', [{ text: repeat }]]], JSON.stringify(existing));
		}
		// Ресурс по тому же полю со своими группировками или другим выражением — не повтор: «>» пишет ещё один
		for (const existing of [
			{ name: 'Склад', value: 'Сумма(Склад)', groups: ['Организация'] },
			{ name: 'Склад', value: 'Количество(Склад)' },
			{ name: 'Склад.Код', value: 'Сумма(Склад)' },
		]) {
			const h = adding({}, [existing]);
			h.addResourceFor({ path: 'Склад', kind: 'field' });
			assert.equal(h.sent.length, 1, JSON.stringify(existing) + ': не записан');
			assert.deepEqual(h.notices, [], JSON.stringify(existing));
		}
	});

	test('«>» по полю с известным нечисловым типом добавляет Сумма и предупреждает — по типу на момент ответа; составной и неизвестный тип — без предупреждения', () => {
		const pending = [{ key: 'РЕГИСТР' }];
		const h = adding({
			Имя: { kind: 'other', type: STRING, pending: [] },
			Смесь: { kind: 'mixed', type: { types: ['xs:decimal', 'xs:string'], typeSets: [], typeIds: [] }, pending: [] },
			Остаток: { kind: 'waiting', type: null, pending },
			Склад: { kind: 'waiting', type: null, pending },
		});
		h.addResourceFor({ path: 'Имя', kind: 'field' });
		assert.deepEqual(h.sent[0], ['dcs/add-total-field', { payload: { dataPath: 'Имя', expression: 'Сумма(Имя)' } }], 'Сумма пишется и у нечислового');
		const warning = 'Поле «Имя» не числовое (Строка): при формировании отчёта Сумма по нему выдаст ошибку. Замените выражение, например на Количество(Имя).';
		assert.deepEqual(h.answer(), { tone: 'info', lines: [{ text: 'Добавлен ресурс Сумма(Имя).' }, { text: warning }] });
		for (const path of ['Смесь', 'Остаток', 'БезТипа']) {
			h.addResourceFor({ path, kind: 'field' });
			assert.deepEqual(h.answer(), { tone: 'ok', lines: [{ text: 'Добавлен ресурс Сумма(' + path + ').' }] }, path);
		}
		// Ждущий тип: ресурс добавлен сразу, описания запрошены
		assert.deepEqual(h.requested, [pending]);
		assert.equal(h.sent.length, 4);
		// Описание пришло, пока ресурс сохранялся: плашка ответа уже предупреждает (вид типа считается в ответе, а не при нажатии)
		h.addResourceFor({ path: 'Склад', kind: 'field' });
		h.typings.Склад = { kind: 'other', type: STRING, pending: [] };
		assert.equal(h.answer()?.tone, 'info');
		assert.ok(h.answer()?.lines[1].text.startsWith('Поле «Склад» не числовое (Строка): '), JSON.stringify(h.answer()));
	});

	test('«>» по полю с путём, который выражение может прочитать не как поле: ресурс добавлен, плашка просит проверить выражение', () => {
		const h = adding({ 'Сумма руб': { kind: 'numeric', type: DECIMAL, pending: [] } });
		h.addResourceFor({ path: 'Сумма руб', kind: 'field' });
		assert.deepEqual(h.sent[0], ['dcs/add-total-field', { payload: { dataPath: 'Сумма руб', expression: 'Сумма(Сумма руб)' } }], 'ресурс добавляется и с таким путём');
		assert.deepEqual(h.answer(), {
			tone: 'info',
			lines: [{ text: 'Добавлен ресурс Сумма(Сумма руб).' }, { text: 'Путь «Сумма руб» в выражении может прочитаться не как поле: проверьте выражение ресурса.' }],
		});
		for (const path of ['Выбор', 'истина', 'NULL', 'И', 'Case', 'А..Б', '.А', '1А', '']) {
			assert.equal(h.resourcePathPlain(path), false, path);
		}
		// Слово языка после точки — уже имя реквизита; Ссылка и Иерархии — имена полей на месте операнда
		for (const path of ['Т.Выбор', 'Ссылка', 'Иерархии', 'Контрагент.ИНН', 'Сумма_1', '_А']) {
			assert.equal(h.resourcePathPlain(path), true, path);
		}
	});

	test('«>>»: одним пакетом — поля дерева с известным числовым типом без ресурса, в порядке дерева, без повторов; пропущенные — по имени', () => {
		const nodes: ResourceNode[] = [
			{ path: 'Склад', kind: 'field' },
			{ path: 'Сумма', kind: 'field' },
			{ path: 'Папка', kind: 'folder', children: [{ path: 'Папка.Цена', kind: 'field' }] },
			{ path: 'Контрагент', kind: 'field', children: [{ path: 'Контрагент.Долг', kind: 'field' }] },
			{ path: 'Имя', kind: 'field' },
			{ path: 'Смесь', kind: 'field' },
			{ path: 'Наценка', kind: 'calc' },
			{ path: 'Без', kind: 'field' },
			{ path: 'Пусто', kind: 'path', children: [{ path: 'Пусто.Количество', kind: 'field' }] },
			{ path: 'Сумма руб', kind: 'field' },
			{ path: 'Выбор', kind: 'field' },
		];
		const typings: Record<string, Typing> = {
			Склад: { kind: 'other', type: STRING },
			Сумма: { kind: 'numeric', type: DECIMAL },
			'Папка.Цена': { kind: 'numeric', type: DECIMAL },
			Контрагент: { kind: 'other', type: STRING },
			'Контрагент.Долг': { kind: 'numeric', type: DECIMAL },
			Имя: { kind: 'other', type: STRING },
			Смесь: { kind: 'mixed', type: null },
			Наценка: { kind: 'numeric', type: DECIMAL },
			Без: { kind: 'unknown', type: null },
			'Пусто.Количество': { kind: 'unknown', type: null },
			// Число, но путь в выражении прочитается не как поле: «>>» такой не берёт и типа его не ждёт
			'Сумма руб': { kind: 'numeric', type: DECIMAL },
			Выбор: { kind: 'waiting', type: null, pending: [{ key: 'ВЫБОР' }] },
		};
		const h = adding(typings, 3);
		// «Сумма» уже ресурс (ключ без учёта регистра): её «>>» не берёт
		const taken = new Set(['сумма']);
		assert.deepEqual(h.resourceAddAllPlan(nodes, taken, (node) => typings[node.path], h.resourcePathPlain), {
			add: ['Папка.Цена', 'Контрагент.Долг', 'Наценка'],
			unknown: ['Без', 'Пусто.Количество'],
			unsafe: ['Сумма руб', 'Выбор'],
			pending: [],
		});
		h.addAllResources(nodes, taken);
		assert.deepEqual(h.sent, [
			[
				'dcs/add-total-fields',
				{
					payloads: [
						{ dataPath: 'Папка.Цена', expression: 'Сумма(Папка.Цена)' },
						{ dataPath: 'Контрагент.Долг', expression: 'Сумма(Контрагент.Долг)' },
						{ dataPath: 'Наценка', expression: 'Сумма(Наценка)' },
					],
				},
			],
		]);
		assert.deepEqual(h.reply(), { row: 3, batch: { add: ['Папка.Цена', 'Контрагент.Долг', 'Наценка'], unknown: ['Без', 'Пусто.Количество'], unsafe: ['Сумма руб', 'Выбор'] } });
		assert.deepEqual(h.answer(), {
			tone: 'ok',
			lines: [
				{ text: 'Добавлено ресурсов: 3 (Папка.Цена, Контрагент.Долг, Наценка).' },
				{ text: 'Пропущены поля без известного типа: Без, Пусто.Количество. Их можно добавить кнопкой «>».' },
				{ text: 'Пропущены поля, путь которых в выражении может прочитаться не как поле: Сумма руб, Выбор. Добавьте их кнопкой «>» и проверьте выражение.' },
			],
		});
		// Имена — первые пять, дальше числом
		assert.deepEqual(h.resourceAddAllLines(['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж'], [], []), [{ text: 'Добавлено ресурсов: 7 (А, Б, В, Г, Д и ещё 2).' }]);
		// Повтор пути (тёзки в дереве не повторяются, но план от этого не зависит) — одна строка
		assert.deepEqual(h.resourceAddAllPlan([{ path: 'А', kind: 'field' }, { path: 'а', kind: 'calc' }], new Set(), () => ({ kind: 'numeric' }), () => true).add, ['А']);
		assert.equal(h.hasResourceFields(nodes), true);
		assert.equal(h.hasResourceFields([{ path: 'Папка', kind: 'folder', children: [] }]), false);
		assert.equal(h.hasResourceFields([{ path: 'П', kind: 'path', children: [{ path: 'П.Х', kind: 'field' }] }]), true);
		// Чтение типов заранее (renderResources): план без «занятых» собирает описания всех ждущих полей, и с ресурсом тоже
		const ahead: Record<string, Typing> = { Имя: { kind: 'waiting', pending: [{ key: 'А' }] }, Без: { kind: 'waiting', pending: [{ key: 'Б' }] } };
		assert.deepEqual(
			h.resourceAddAllPlan([{ path: 'Имя', kind: 'field' }, { path: 'Без', kind: 'field' }], new Set(), (node) => ahead[node.path], () => true).pending,
			[{ key: 'А' }, { key: 'Б' }]
		);
	});

	test('«>>» без числовых полей — заметка без правки; пока типы ждут описаний — запрос описаний, заметка, без правки; канал занят — без итога', () => {
		const nodes: ResourceNode[] = [
			{ path: 'Имя', kind: 'field' },
			{ path: 'Без', kind: 'field' },
		];
		const none = adding({ Имя: { kind: 'other', type: STRING } });
		none.addAllResources(nodes, new Set());
		assert.deepEqual(none.sent, []);
		assert.deepEqual(none.notices, [
			[
				'info',
				'Ресурсы',
				[{ text: 'Полей с известным числовым типом без ресурса нет.' }, { text: 'Пропущены поля без известного типа: Без. Их можно добавить кнопкой «>».' }],
			],
		]);
		const all = adding({ Имя: { kind: 'numeric', type: DECIMAL } });
		all.addAllResources([{ path: 'Имя', kind: 'field' }], new Set(['имя']));
		assert.deepEqual(all.notices[0][2], [{ text: 'Полей с известным числовым типом без ресурса нет.' }], 'все числовые уже ресурсы');
		const pending = [{ key: 'РЕГИСТР.ОСТАТКИ' }];
		const waiting = adding({ Имя: { kind: 'numeric', type: DECIMAL }, Без: { kind: 'waiting', type: null, pending } });
		waiting.addAllResources(nodes, new Set());
		assert.deepEqual(waiting.sent, [], 'деление по недочитанному типу');
		assert.deepEqual(waiting.requested, [pending]);
		assert.deepEqual(waiting.notices, [['info', 'Ресурсы', [{ text: 'Типы полей ещё читаются из метаданных. Нажмите «>>» ещё раз через мгновение.' }]]]);
		assert.equal(waiting.reply(), null);
		const busy = adding({ Имя: { kind: 'numeric', type: DECIMAL } }, 0, false);
		busy.addAllResources(nodes, new Set());
		assert.equal(busy.busy, 1);
		assert.equal(busy.reply(), null);
	});

	test('отказ пакета «>>» называет поле вместо номера операции; прочие отказы и отказ одиночной правки — как есть; окно — без плашки', () => {
		const h = adding({});
		const batch: Reply = { row: 0, batch: { add: ['Сумма', 'Наценка'], unknown: [], unsafe: [] } };
		assert.equal(
			h.resourceRefusalText(batch, 'Операция 2 (cf-dcs-add-total-field): Схема после правки не читается моделью'),
			'Ресурсы не добавлены, ресурс по полю «Наценка»: Схема после правки не читается моделью'
		);
		assert.equal(h.resourceRefusalText(batch, 'Ресурсы не добавлены, ресурс 1: нет выражения.'), 'Ресурсы не добавлены, ресурс по полю «Сумма»: нет выражения.');
		// Номер вне плана, чужая операция, отказ без номера, одиночная правка, правка не «Ресурсов» — текст как есть
		assert.equal(h.resourceRefusalText(batch, 'Операция 3 (cf-dcs-add-total-field): отказ'), 'Операция 3 (cf-dcs-add-total-field): отказ');
		assert.equal(h.resourceRefusalText(batch, 'Операция 1 (cf-dcs-remove-total-field): отказ'), 'Операция 1 (cf-dcs-remove-total-field): отказ');
		assert.equal(h.resourceRefusalText(batch, 'отказ'), 'отказ');
		assert.equal(h.resourceRefusalText(batch, undefined), undefined);
		assert.equal(h.resourceRefusalText({ row: 0, add: { path: 'А', kind: 'field', expression: 'Сумма(А)' } }, 'Операция 1 (cf-dcs-add-total-field): отказ'), 'Операция 1 (cf-dcs-add-total-field): отказ');
		assert.equal(h.resourceRefusalText(null, 'Операция 1 (cf-dcs-add-total-field): отказ'), 'Операция 1 (cf-dcs-add-total-field): отказ');
		assert.equal(h.resourceReplyNotice({ row: 4 }), null, 'у окна «Новый ресурс» — плашка');
	});

	test('вид типа поля для ресурса — строгий тип DcsFieldTypes (resourceFieldType) и его numericKind', () => {
		const kind = topFunction('resourceFieldKind(node) {');
		assert.ok(kind.includes('fieldTypes.resourceFieldType(core.model, node.path, node.kind, describeLookup, {'));
		assert.ok(kind.includes("return { kind: result.state === 'known' ? fieldTypes.numericKind(result.type) : 'unknown', type: result.type, pending: [] };"));
		const resourceFieldKind = new Function('fieldTypes', 'model', 'describeLookup', 'queryModelApi', 'parseQueryCached', withCoreAccessors(kind + '\nreturn resourceFieldKind;'));
		const node = { path: 'Сумма', kind: 'field' };
		const fake = (state: string, type: unknown) => ({
			resourceFieldType: (_model: unknown, path: string, nodeKind: string) => {
				assert.deepEqual([path, nodeKind], ['Сумма', 'field']);
				return { state, type, pending: state === 'waiting' ? [{ key: 'К' }] : [] };
			},
			numericKind: (type: unknown) => (type === DECIMAL ? 'numeric' : 'other'),
		});
		assert.deepEqual(resourceFieldKind(fake('known', DECIMAL), {}, () => undefined, null, null)(node), { kind: 'numeric', type: DECIMAL, pending: [] });
		assert.deepEqual(resourceFieldKind(fake('waiting', null), {}, () => undefined, null, null)(node), { kind: 'waiting', type: null, pending: [{ key: 'К' }] });
		assert.deepEqual(resourceFieldKind(fake('unknown', null), {}, () => undefined, null, null)(node), { kind: 'unknown', type: null, pending: [] });
	});
});

describe('Длинные имена переносятся на границах слов', () => {
	const api = new Function('el', 'document', NAME_HELPERS + '\nreturn { setNameText, nameEl };')(el, doc) as {
		setNameText(node: Node, text: string): Node;
		nameEl(tag: string, className: string, text?: unknown): Node;
	};
	/** Части имени между местами переноса: текст узлов, wbr — разделитель. */
	const parts = (node: Node): string[] =>
		node.children.length === 0 ? [node.textContent] : node.children.filter((child) => child.tagName !== 'WBR').map((child) => child.textContent);
	const breaks = (node: Node): number => node.children.filter((child) => child.tagName === 'WBR').length;

	test('места переноса — перед заглавной после строчной или цифры и после точки, запятой, скобки, подчёркивания', () => {
		assert.deepEqual(parts(api.nameEl('span', 'dcs-tree-label', 'АнализАктивностиПользователей')), ['Анализ', 'Активности', 'Пользователей']);
		assert.deepEqual(parts(api.nameEl('td', '', 'СправочникСсылка.Пользователи')), ['Справочник', 'Ссылка.', 'Пользователи']);
		assert.deepEqual(parts(api.nameEl('td', '', 'Максимум(ОдновременноСессий)')), ['Максимум(', 'Одновременно', 'Сессий)']);
		assert.deepEqual(parts(api.nameEl('td', '', 'Поле_1, Запрос2Итог')), ['Поле_', '1, Запрос2', 'Итог']);
		// Подряд заглавные, слова через пробел и одно слово — без лишних мест переноса
		for (const text of ['ВТ_Остатки', 'ВЫБОР КОГДА Истина ТОГДА 1 КОНЕЦ', 'объект', 'Анализ активности пользователей']) {
			const node = api.nameEl('td', '', text);
			assert.equal(node.textContent, text);
			assert.equal(breaks(node), text === 'ВТ_Остатки' ? 1 : 0, text);
		}
	});

	test('wbr знаков не добавляет: текст узла (а с ним доступное имя) — имя целиком; пустое и null — без текста', () => {
		const node = api.nameEl('td', 'dcs-cell', 'ПродолжительностьРаботыРегламентныхЗаданий');
		assert.equal(node.textContent, 'ПродолжительностьРаботыРегламентныхЗаданий');
		assert.equal(node.className, 'dcs-cell');
		assert.equal(breaks(node), 3);
		// Повторная запись заменяет прежние части, а не дописывает
		api.setNameText(node, 'ВариантОтчета');
		assert.equal(node.textContent, 'ВариантОтчета');
		assert.equal(breaks(node), 1);
		api.setNameText(node, 'Отчет');
		assert.equal(node.textContent, 'Отчет');
		assert.equal(node.children.length, 0);
		for (const empty of ['', null, undefined]) {
			assert.equal(api.nameEl('td', '', empty).textContent, '');
		}
	});

	test('ячейки таблиц, подписи деревьев, тип и заголовки — через места переноса; в стилях посреди слова не рвётся, значки не переносятся', () => {
		assert.ok(topFunction('cell(tr, text, className) {').includes("const td = nameEl('td', className, text);"), 'ячейка таблицы без мест переноса');
		assert.ok(topFunction('appendSetRows(tree, items, prefix, depth) {').includes("row.appendChild(nameEl('span', 'dcs-tree-label', item.name));"));
		assert.ok(topFunction('appendSetRows(tree, items, prefix, depth) {').includes("el('span', 'dcs-tree-name dcs-tree-kind', kindLabel(item.type).toLowerCase())"), 'вид набора — значок без переноса');
		assert.ok(topFunction('typeCell(tr, valueType, fallback, what, onOpen) {').includes("nameEl('button', 'dcs-type-link', text || '…')"));
		assert.ok(!/el\('span', 'dcs-tree-label'/.test(SCRIPT.replace(/nameEl\('span', 'dcs-tree-label'/g, '')), 'подпись дерева без мест переноса');
		const css = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.css'), 'utf8').replace(/\r\n/g, '\n');
		const rule = (selector: string): string => {
			const start = css.indexOf('\n' + selector + ' {\n');
			assert.ok(start >= 0, `нет правила ${selector}`);
			return css.slice(start, css.indexOf('\n}', start));
		};
		for (const selector of ['.dcs-table td', '.dcs-tree-label', '.dcs-tree-name', '.dcs-set-title', '.dcs-setv-caption', '.dcs-type-link', '.dcs-type-chip', '.dcs-res-table td.dcs-res-expr']) {
			assert.ok(rule(selector).includes('overflow-wrap: break-word;'), `${selector}: перенос посреди слова`);
		}
		for (const selector of ['.dcs-kind', '.dcs-tree-kind', '.dcs-tree-badge', '.dcs-tree-ro', '.dcs-us-badge', '.dcs-field-badge']) {
			assert.ok(rule(selector).includes('white-space: nowrap;'), `${selector}: значок переносится`);
		}
		// Таблица полей набора — в одну строку с прокруткой вбок: Chromium переносит на wbr и при nowrap
		assert.ok(rule('.dcs-fields-table td:not(.dcs-cell-title) wbr').includes('display: none;'));
	});
});

describe('«Доступные поля» «Настроек»: раскрытие ссылочного поля реквизитами', () => {
	/** settingsFieldsLayout и дерево fieldTree как есть: каталог, реквизиты по типу и запрос описаний — заглушки. */
	function layout(pendingFirst: boolean) {
		const added: string[] = [];
		const requested: unknown[] = [];
		let pending = pendingFirst;
		const code =
			'let settingsTypeWaiting = false;\n' +
			NAME_HELPERS +
			topFunction('spokenReason(note, unavailable) {') +
			section('// ---------- кнопки переноса между списками ----------', '// ---------- каркас вкладок ----------') +
			topLine('WIZARD_PICK_KINDS') +
			topLine('SETTINGS_PICK_NOTE') +
			topFunction('settingsPickable(node) {') +
			topFunction('settingsFieldsLayout(host, spec) {') +
			'\nreturn { settingsFieldsLayout, waiting: () => settingsTypeWaiting };';
		const nodes = [
			{ name: 'Контрагент', path: 'Контрагент', kind: 'field', children: [] },
			{ name: 'Количество', path: 'Количество', kind: 'field', children: [] },
		];
		const typed = { name: 'ИНН', path: 'Контрагент.ИНН', kind: 'field', children: [], typeExpandable: false, typeChain: [] };
		const stubs: Record<string, unknown> = {
			el,
			document: doc,
			keyed: (node: Node, key: string) => {
				node.setAttribute('data-dcs-key', key);
				return node;
			},
			focusKey: (parts: string[]) => parts.join('\n'),
			settingsFieldNodes: () => nodes,
			settingsAvailUi: { selection: { selected: '', expanded: new Set() } },
			settingsNotice: () => undefined,
			settingsAvailNodes: new Map(),
			settingsTypeLevel: (_section: string, node: { path: string }) => {
				if (node.path === 'Контрагент') {
					return pending ? { children: [], pending: [{ key: 'Справочник.Контрагенты' }] } : { children: [typed], pending: [] };
				}
				return node.path === 'Количество' ? { children: [], pending: [] } : null;
			},
			requestDescriptions: (list: unknown[]) => requested.push(...list),
			dragZone: () => undefined,
		};
		const api = new Function(...Object.keys(stubs), withCoreAccessors(code))(...Object.values(stubs)) as {
			settingsFieldsLayout(host: Node, spec: Record<string, unknown>): void;
			waiting(): boolean;
		};
		const host = doc.body.appendChild(el('div'));
		const render = (): void => {
			host.textContent = '';
			api.settingsFieldsLayout(host, {
				id: 'selection',
				title: 'Выбранные поля',
				addTitle: 'Добавить выбранное поле',
				note: () => '',
				onAdd: (node: { path: string }) => added.push(node.path),
				onRemove: () => undefined,
				list: () => undefined,
			});
		};
		render();
		const rows = (): Node[] => host.find((node) => node.getAttribute('role') === 'treeitem');
		return {
			host,
			added,
			requested,
			rows,
			render,
			waiting: api.waiting,
			answer: () => {
				pending = false;
			},
		};
	}

	test('стрелка у ссылочного поля; → раскрывает, описания читаются (под полем — «Загрузка реквизитов…»), ответ дорисовывает реквизиты', () => {
		const t = layout(true);
		const [contractor, quantity] = t.rows();
		assert.equal(contractor.getAttribute('aria-expanded'), 'false', 'у ссылочного поля нет стрелки');
		assert.equal(contractor.children[0].textContent, '▸');
		assert.equal(quantity.getAttribute('aria-expanded'), null, 'у поля без реквизитов стрелка');
		contractor.focus();
		assert.equal(contractor.fire('keydown', { key: 'ArrowRight' }), true);
		const loading = t.rows().find((row) => row.textContent === 'Загрузка реквизитов…');
		assert.ok(loading, 'нет строки «Загрузка реквизитов…»');
		assert.equal(loading.getAttribute('aria-disabled'), 'true');
		assert.equal(loading.tabIndex, -1, '«Загрузка…» — остановка Tab');
		assert.deepEqual(t.requested, [{ key: 'Справочник.Контрагенты' }]);
		assert.equal(t.waiting(), true, 'ответ описания не перерисует вкладку');
		// → у раскрытого поля, под которым только «Загрузка…», не уходит на соседнее поле
		const open = t.rows()[0];
		open.focus();
		open.fire('keydown', { key: 'ArrowRight' });
		assert.equal(doc.activeElement, open);
		// Ответ: вкладка перерисовывается, раскрытие и выбор сохраняются, реквизит — строка-поле уровнем ниже
		t.answer();
		t.render();
		const after = t.rows();
		assert.deepEqual(
			after.map((row) => [row.getAttribute('aria-level'), row.getAttribute('aria-label')]),
			[
				['1', 'Контрагент'],
				['2', 'ИНН'],
				['1', 'Количество'],
			]
		);
		doc.body.textContent = '';
	});

	test('реквизит выбирается полем: Enter, двойной щелчок и «>» добавляют «Контрагент.ИНН»', () => {
		const t = layout(false);
		t.rows()[0].fire('keydown', { key: 'ArrowRight' });
		const inn = t.rows()[1];
		assert.equal(inn.getAttribute('aria-label'), 'ИНН');
		inn.focus();
		assert.equal(inn.fire('keydown', { key: 'Enter' }), true);
		inn.fire('dblclick');
		const add = t.host.find((node) => node.getAttribute('aria-label') === 'Добавить выбранное поле')[0];
		assert.equal(add.getAttribute('aria-disabled'), null, '«>» недоступна у реквизита');
		add.fire('click');
		assert.deepEqual(t.added, ['Контрагент.ИНН', 'Контрагент.ИНН', 'Контрагент.ИНН']);
		doc.body.textContent = '';
	});
});

describe('Модули закладок: подключение и объект ядра', () => {
	const html = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.html'), 'utf8');
	const panel = fs.readFileSync(path.join(ROOT, 'src', 'features', 'metadata', 'dcsEditorPanel.ts'), 'utf8');
	const MODULES = [
		{ file: 'dcs-editor-schema.js', placeholder: '{{SCHEMA_JS_URI}}', factory: 'DcsEditorSchema', params: 'core' },
		{ file: 'dcs-editor-settings-panels.js', placeholder: '{{SETTINGS_PANELS_JS_URI}}', factory: 'DcsEditorSettingsPanels', params: 'core, settingsTab' },
		{ file: 'dcs-editor-settings.js', placeholder: '{{SETTINGS_JS_URI}}', factory: 'DcsEditorSettings', params: 'core' },
	];
	const CORE_OBJECT = '\tconst core = Object.freeze({\n';

	/** Имена из «const { а, б } = источник;» на отступе один таб. */
	function destructured(text: string, source: string): string[] {
		const match = new RegExp('\\n\\tconst \\{([^}]*)\\} = ' + source + ';\\n').exec(text);
		assert.ok(match, `нет «const { … } = ${source};»`);
		return match[1]
			.split(',')
			.map((name) => name.trim())
			.filter(Boolean);
	}

	/** Поля объекта «Object.freeze({ … })» от head до close: имена короткой записью и аксессоры get/set. */
	function frozenKeys(text: string, head: string, close: string): Set<string> {
		const start = text.indexOf(head);
		assert.ok(start >= 0, `нет ${head.trim()}`);
		const body = text.slice(start + head.length, text.indexOf(close, start));
		const accessors = [...body.matchAll(/\b(?:get|set) ([A-Za-z_$][\w$]*)\(/g)].map((match) => match[1]);
		const plain = body
			.replace(/\b(?:get|set) [A-Za-z_$][\w$]*\([^)]*\) \{[^}]*\},/g, '')
			.split(',')
			.map((name) => name.trim())
			.filter(Boolean);
		return new Set([...plain, ...accessors]);
	}

	test('модули подключены до основного скрипта: он создаёт закладки в конце запуска; панель подставляет их адреса', () => {
		const main = html.indexOf('{{JS_URI}}');
		for (const { file, placeholder } of MODULES) {
			const at = html.indexOf(placeholder);
			assert.ok(at >= 0, `в шаблоне нет ${placeholder}`);
			assert.ok(at < main, `${file} подключён позже основного скрипта`);
			assert.ok(panel.includes(`'${file}'`), `панель не знает ${file}`);
			assert.ok(panel.includes(`replaceAll('${placeholder}'`), `панель не подставляет ${placeholder}`);
		}
		// Конструктор запроса берёт API редактора, поэтому он по-прежнему после основного скрипта
		assert.ok(html.indexOf('{{QUERY_DIALOG_JS_URI}}') > main, 'конструктор запроса подключён до основного скрипта');
	});

	test('модуль задаёт только свою фабрику; ядро зовёт фабрики с замороженным объектом ядра', () => {
		const win: Record<string, unknown> = {};
		for (const { file, factory, params } of MODULES) {
			const text = readEditorPart(file);
			assert.ok(text.includes(`\nwindow.${factory} = function (${params}) {\n\t'use strict';\n`), `${file}: фабрика не в начале файла`);
			assert.ok(text.endsWith('\n};\n'), `${file}: после фабрики есть код`);
			new Function('window', text)(win);
		}
		assert.deepEqual(Object.keys(win).sort(), MODULES.map((item) => item.factory).sort(), 'модули пишут в window что-то, кроме фабрик');
		const main = readEditorPart('dcs-editor.js');
		assert.ok(main.includes(CORE_OBJECT), 'объект ядра не заморожен');
		assert.ok(main.includes('\tconst schemaTabs = window.DcsEditorSchema(core);\n'), 'ядро не создаёт закладки схемы');
		assert.ok(main.includes('\tconst settingsTab = window.DcsEditorSettings(core);\n'), 'ядро не создаёт закладку «Настройки»');
		assert.ok(
			main.indexOf('const settingsTab = window.DcsEditorSettings(core);') < main.indexOf('\n\trenderTabs();\n\trenderContent();\n'),
			'закладки создаются после первой отрисовки'
		);
		assert.ok(
			readEditorPart('dcs-editor-settings.js').includes('\tconst settingsPanels = window.DcsEditorSettingsPanels(\n\t\tcore,\n'),
			'вкладки узла создаются не закладкой «Настройки»'
		);
	});

	test('закладки берут из ядра только то, что отдаёт объект ядра, а ядро у закладок только то, что они вернули', () => {
		const main = readEditorPart('dcs-editor.js');
		const schema = readEditorPart('dcs-editor-schema.js');
		const settings = readEditorPart('dcs-editor-settings.js');
		const panels = readEditorPart('dcs-editor-settings-panels.js');
		const coreKeys = frozenKeys(main, CORE_OBJECT, '\n\t});\n');
		// Изменяемое состояние ядра закладки берут только полем объекта: копия значения разошлась бы с ядром после присваивания
		const accessors = [...main.slice(main.indexOf(CORE_OBJECT)).matchAll(/\n\t\tget ([A-Za-z_$][\w$]*)\(\)/g)].map((match) => match[1]);
		assert.ok(accessors.includes('model') && accessors.includes('saving'), 'модель и правка в полёте не аксессоры');
		for (const [file, text] of [
			['dcs-editor-schema.js', schema],
			['dcs-editor-settings.js', settings],
			['dcs-editor-settings-panels.js', panels],
		]) {
			const taken = destructured(text, 'core');
			assert.deepEqual(
				taken.filter((name) => !coreKeys.has(name)),
				[],
				`${file} берёт из ядра то, чего нет в объекте ядра`
			);
			assert.deepEqual(
				taken.filter((name) => accessors.includes(name)),
				[],
				`${file} копирует изменяемое состояние ядра`
			);
		}
		const exportsOf = (text: string): Set<string> => frozenKeys(text, '\n\treturn Object.freeze({', '});\n};\n');
		assert.deepEqual(destructured(main, 'schemaTabs').filter((name) => !exportsOf(schema).has(name)), [], 'ядро берёт у закладок схемы то, чего они не вернули');
		assert.deepEqual(destructured(main, 'settingsTab').filter((name) => !exportsOf(settings).has(name)), [], 'ядро берёт у «Настроек» то, чего они не вернули');
		const settingsObject = frozenKeys(settings, '\t\tcore,\n\t\tObject.freeze({\n', '\n\t\t})\n');
		assert.deepEqual(destructured(panels, 'settingsTab').filter((name) => !settingsObject.has(name)), [], 'вкладки узла берут у «Настроек» то, чего им не отдали');
		assert.deepEqual(destructured(settings, 'settingsPanels').filter((name) => !exportsOf(panels).has(name)), [], '«Настройки» берут у вкладок узла то, чего они не вернули');
	});
});
