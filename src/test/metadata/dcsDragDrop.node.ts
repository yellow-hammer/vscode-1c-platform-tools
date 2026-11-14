/**
 * Перетаскивание в редакторе СКД: строки списков переносятся мышью как дополнение к кнопкам — сброс делает ту же
 * правку, что кнопка. Правила места сброса и приёма зоной, обвязка событий документа, зона у таблицы (строки — tr,
 * шапка ставит первым), место по ключу строки (папка — «в строку»), отказ строки (узел структуры у чужого родителя) и
 * правки дерева элементов списка «Настроек» по месту сброса (itemsDropSlot, itemsInsert, itemsMove).
 *
 * Разделы dcs-editor.js исполняются как есть (new Function): чистые правила — без заглушек, обвязка — с мини-DOM
 * (узлы с closest, документ со слушателями, кадр по запросу). Вкладки конструктора запроса («Группировка», «Порядок»,
 * части объединения, пакет) исполняются со своими помощниками и настоящими моделью и правками запроса: сброс даёт тот же
 * текст, что кнопка. Пока никто не тащит, у строки только атрибут draggable, слушатели — у документа.
 * Запуск: npm run compile && node --test out/test/metadata/dcsDragDrop.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { DCS_EDITOR_PARTS, readEditorPart, readEditorScript } from '../fixtures/helpers/dcsEditorScript';

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const ROOT = path.resolve(__dirname, '../../..');
const WEBVIEW = path.join(ROOT, 'resources', 'webview');

function read(name: string): string {
	return fs.readFileSync(path.join(WEBVIEW, name), 'utf8');
}

const SCRIPT = readEditorScript();
const DIALOG = read('dcs-editor-query-dialog.js');
const CSS = read('dcs-editor.css');

const RULES_START = '// ---------- перетаскивание: чистые правила ----------';
const EVENTS_START = '// ---------- перетаскивание: обвязка событий ----------';
const EVENTS_END = '// ---------- команды-пиктограммы над списками ----------';

function between(from: string, to: string): string {
	const start = SCRIPT.indexOf(from);
	const end = SCRIPT.indexOf(to, start + from.length);
	assert.ok(start >= 0 && end > start, `нет раздела ${from}`);
	return SCRIPT.slice(start, end);
}

interface Zone {
	id: string;
	scope?: number;
	from?: Record<string, unknown>;
	accept?: (payload: Payload) => boolean;
	place?: string | ((payload: Payload) => string);
	effect?: string | ((payload: Payload) => string);
}

interface Payload {
	zone: string;
	scope?: number;
	key: string;
	kind: string;
}

interface Rules {
	DRAG_TYPE: string;
	dropPlace(offset: number, size: number, mode: string): string;
	dropIndex(count: number, from: number, target: number, place: string): number;
	dropAccepted(zone: Zone | null | undefined, payload: Payload | null): boolean;
	dropMode(zone: Zone, payload: Payload): string;
	dropEffect(zone: Zone, payload: Payload): string;
	hasDragType(types: unknown): boolean;
}

function rules(): Rules {
	const factory = new Function(
		between(RULES_START, EVENTS_START) + '\nreturn { DRAG_TYPE, dropPlace, dropIndex, dropAccepted, dropMode, dropEffect, hasDragType };'
	) as () => Rules;
	return factory();
}

describe('Перетаскивание: место сброса и номер вставки (чистые правила)', () => {
	const R = rules();

	test('место у строки: половины — до и после, четверти по краям — до и после с серединой «в строку», «в строку» и «в список целиком»', () => {
		assert.equal(R.dropPlace(0, 20, 'line'), 'before');
		assert.equal(R.dropPlace(9.9, 20, 'line'), 'before');
		assert.equal(R.dropPlace(10, 20, 'line'), 'after');
		assert.equal(R.dropPlace(25, 20, 'line'), 'after', 'за нижним краем — после');
		assert.equal(R.dropPlace(-3, 20, 'line'), 'before', 'над верхним краем — до');
		assert.equal(R.dropPlace(4, 20, 'both'), 'before');
		assert.equal(R.dropPlace(10, 20, 'both'), 'into');
		assert.equal(R.dropPlace(15, 20, 'both'), 'after');
		assert.equal(R.dropPlace(1, 20, 'into'), 'into');
		assert.equal(R.dropPlace(1, 20, 'zone'), 'end');
		assert.equal(R.dropPlace(5, 0, 'line'), 'before', 'строка без высоты (скрыта) не делит на ноль');
	});

	test('номер вставки: перестановка вниз и вверх, сброс под строками, новые элементы, выход за края', () => {
		// [а, б, в, г, д]: «б» (1) до «г» (3) — встаёт на 2, после «г» — на 3
		assert.equal(R.dropIndex(5, 1, 3, 'before'), 2);
		assert.equal(R.dropIndex(5, 1, 3, 'after'), 3);
		// «г» (3) до «б» (1) — на 1, после «б» — на 2
		assert.equal(R.dropIndex(5, 3, 1, 'before'), 1);
		assert.equal(R.dropIndex(5, 3, 1, 'after'), 2);
		// На себя и к соседу с «своей» стороны — место то же
		assert.equal(R.dropIndex(5, 2, 2, 'before'), 2);
		assert.equal(R.dropIndex(5, 2, 2, 'after'), 2);
		assert.equal(R.dropIndex(5, 2, 1, 'after'), 2);
		assert.equal(R.dropIndex(5, 2, 3, 'before'), 2);
		// Под строками и за краем списка — в конец
		assert.equal(R.dropIndex(5, 0, -1, 'end'), 4);
		assert.equal(R.dropIndex(5, 0, 9, 'before'), 4);
		// Новый элемент (from -1): номер вставки до count включительно
		assert.equal(R.dropIndex(5, -1, 0, 'before'), 0);
		assert.equal(R.dropIndex(5, -1, 2, 'after'), 3);
		assert.equal(R.dropIndex(5, -1, 4, 'after'), 5);
		assert.equal(R.dropIndex(5, -1, -1, 'end'), 5);
		assert.equal(R.dropIndex(0, -1, -1, 'end'), 0, 'пустой список');
		assert.equal(R.dropIndex(1, 0, 0, 'after'), 0, 'единственный элемент остаётся на месте');
	});

	test('номер вставки сходится с перестановкой массива: элемент встаёт рядом со строкой сброса с её стороны', () => {
		for (let count = 1; count <= 6; count++) {
			const list = Array.from({ length: count }, (_, k) => 'e' + k);
			for (let from = 0; from < count; from++) {
				for (let target = 0; target < count; target++) {
					for (const place of ['before', 'after']) {
						const to = R.dropIndex(count, from, target, place);
						const moved = list.slice();
						const item = moved.splice(from, 1)[0];
						moved.splice(to, 0, item);
						assert.equal(moved.length, count);
						if (target === from) {
							assert.deepEqual(moved, list, `на себя: ${count} ${from} ${place}`);
							continue;
						}
						const at = moved.indexOf(list[target]);
						const expected = place === 'before' ? at - 1 : at + 1;
						assert.equal(moved.indexOf(item), expected, `${count}: ${from} ${place} ${target} → ${to}`);
					}
				}
				// Новый элемент: вставка по месту, конец — за последним
				for (let target = 0; target < count; target++) {
					for (const place of ['before', 'after']) {
						const to = R.dropIndex(count, -1, target, place);
						const grown = list.slice();
						grown.splice(to, 0, 'new');
						const at = grown.indexOf(list[target]);
						assert.equal(grown.indexOf('new'), place === 'before' ? at - 1 : at + 1, `новый: ${count} ${place} ${target}`);
					}
				}
			}
		}
	});

	test('приём зоной: обработчик для зоны-источника, то же окно, своё правило; чужие ключи объекта — не зоны', () => {
		const handler = () => undefined;
		const payload: Payload = { zone: 'db', scope: 1, key: 't:1', kind: 'table' };
		const zone: Zone = { id: 'tables', scope: 1, from: { db: handler } };
		assert.equal(R.dropAccepted(zone, payload), true);
		assert.equal(R.dropAccepted(zone, Object.assign({}, payload, { scope: 2 })), false, 'перенос из другого окна');
		assert.equal(R.dropAccepted(zone, Object.assign({}, payload, { zone: 'fields' })), false, 'источник без обработчика');
		assert.equal(R.dropAccepted(zone, Object.assign({}, payload, { zone: 'constructor' })), false, 'ключ прототипа');
		assert.equal(R.dropAccepted(zone, Object.assign({}, payload, { zone: 'toString' })), false, 'ключ прототипа');
		assert.equal(R.dropAccepted({ id: 'x', scope: 1, from: { db: 'не функция' } }, payload), false);
		assert.equal(R.dropAccepted({ id: 'x', scope: 1 }, payload), false, 'зона без from — только источник');
		assert.equal(R.dropAccepted(null, payload), false);
		assert.equal(R.dropAccepted(zone, null), false);
		const picky: Zone = { id: 'db', scope: 1, from: { tables: handler }, accept: (item) => item.kind === 'source' };
		assert.equal(R.dropAccepted(picky, { zone: 'tables', scope: 1, key: 's:Т', kind: 'source' }), true);
		assert.equal(R.dropAccepted(picky, { zone: 'tables', scope: 1, key: 'sf:Т|Код', kind: 'field' }), false, 'поле таблицы в «Базу данных» не бросают');
	});

	test('вид места и курсор: по умолчанию линия и перенос, правило зоны по переносу', () => {
		const payload: Payload = { zone: 'db', key: 'k', kind: 'table' };
		assert.equal(R.dropMode({ id: 'z' }, payload), 'line');
		assert.equal(R.dropMode({ id: 'z', place: 'чепуха' }, payload), 'line');
		assert.equal(R.dropMode({ id: 'z', place: (item) => (item.kind === 'table' ? 'zone' : 'line') }, payload), 'zone');
		assert.equal(R.dropMode({ id: 'z', place: 'into' }, payload), 'into');
		assert.equal(R.dropEffect({ id: 'z' }, payload), 'move');
		assert.equal(R.dropEffect({ id: 'z', effect: 'copy' }, payload), 'copy');
		assert.equal(R.dropEffect({ id: 'z', effect: () => 'link' }, payload), 'move', 'незнакомое — перенос');
	});

	test('свой тип данных: массив типов и DOMStringList; чужой перенос (файлы, текст) — без него', () => {
		assert.equal(R.DRAG_TYPE, 'application/x-dcs-row');
		assert.equal(R.hasDragType(['text/plain', 'application/x-dcs-row']), true);
		assert.equal(R.hasDragType({ length: 1, 0: 'application/x-dcs-row' }), true, 'DOMStringList');
		assert.equal(R.hasDragType(['Files']), false);
		assert.equal(R.hasDragType(['text/plain']), false);
		assert.equal(R.hasDragType(null), false);
	});
});

// ---------- обвязка событий на мини-DOM ----------

class Classes {
	readonly set = new Set<string>();
	add(...names: string[]): void {
		names.forEach((name) => this.set.add(name));
	}
	remove(...names: string[]): void {
		names.forEach((name) => this.set.delete(name));
	}
	contains(name: string): boolean {
		return this.set.has(name);
	}
}

type Listener = (event: FakeEvent) => void;

class El {
	parentElement: El | null = null;
	children: El[] = [];
	classList = new Classes();
	attributes: Record<string, string> = {};
	listeners: Record<string, Listener[]> = {};
	draggable = false;
	inert = false;
	connected = true;
	rect = { top: 0, height: 20 };

	constructor(readonly tagName: string) {}

	append(child: El): El {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}
	setAttribute(name: string, value: string): void {
		this.attributes[name] = value;
	}
	getAttribute(name: string): string | null {
		return name in this.attributes ? this.attributes[name] : null;
	}
	addEventListener(type: string, fn: Listener): void {
		(this.listeners[type] = this.listeners[type] || []).push(fn);
	}
	removeEventListener(type: string, fn: Listener): void {
		const left = (this.listeners[type] || []).filter((item) => item !== fn);
		if (left.length > 0) {
			this.listeners[type] = left;
		} else {
			delete this.listeners[type];
		}
	}
	/** Как Node.compareDocumentPosition: 2 — other раньше, 4 — позже, 8 — other предок, 16 — потомок. */
	compareDocumentPosition(other: El): number {
		const chain = (node: El): El[] => {
			const out: El[] = [];
			for (let at: El | null = node; at; at = at.parentElement) {
				out.unshift(at);
			}
			return out;
		};
		const mine = chain(this);
		const theirs = chain(other);
		if (mine.includes(other)) {
			return 8 | 2;
		}
		if (theirs.includes(this)) {
			return 16 | 4;
		}
		let depth = 0;
		while (mine[depth] === theirs[depth]) {
			depth++;
		}
		const parent = mine[depth - 1];
		return parent.children.indexOf(theirs[depth]) < parent.children.indexOf(mine[depth]) ? 2 : 4;
	}
	closest(selector: string): El | null {
		assert.equal(selector, '[data-dnd-zone]', 'обвязка ищет зону одним селектором');
		for (let node: El | null = this; node; node = node.parentElement) {
			if ('data-dnd-zone' in node.attributes) {
				return node;
			}
		}
		return null;
	}
	get isConnected(): boolean {
		return this.connected;
	}
	getBoundingClientRect(): { top: number; height: number } {
		return this.rect;
	}
}

interface FakeTransfer {
	types: string[];
	data: Record<string, string>;
	dropEffect: string;
	effectAllowed: string;
	setData(type: string, value: string): void;
}

interface FakeEvent {
	type: string;
	target: El;
	clientX: number;
	clientY: number;
	buttons: number;
	dataTransfer: FakeTransfer | null;
	defaultPrevented: boolean;
	preventDefault(): void;
}

function transfer(types: string[] = []): FakeTransfer {
	return {
		types: types.slice(),
		data: {},
		dropEffect: 'none',
		effectAllowed: 'uninitialized',
		setData(type: string, value: string) {
			this.data[type] = value;
			if (this.types.indexOf(type) < 0) {
				this.types.push(type);
			}
		},
	};
}

interface DragTarget {
	key: string | null;
	place: string;
}

interface Wiring {
	dragZone(node: El, spec: unknown): El;
	tableDropZone(node: El, spec: unknown): El;
	whenIdle(fn: () => void): void;
	finishDrag(keepHeld: boolean, pick?: boolean): void;
	rerenderSoon(fn: () => void): void;
	fire(type: string, target: El, options?: { clientX?: number; clientY?: number; buttons?: number; dataTransfer?: FakeTransfer | null }): FakeEvent;
	flushFrames(): void;
	frames(): number;
	dragging(): boolean;
	setBusy(value: boolean): void;
	documentListeners: Record<string, Listener[]>;
	body: El;
}

function wiring(): Wiring {
	const documentListeners: Record<string, Listener[]> = {};
	const body = new El('BODY');
	const all = (): El[] => {
		const out: El[] = [];
		const walk = (node: El) => {
			for (const child of node.children) {
				out.push(child);
				walk(child);
			}
		};
		walk(body);
		return out;
	};
	const documentStub = {
		addEventListener: (type: string, fn: Listener) => {
			(documentListeners[type] = documentListeners[type] || []).push(fn);
		},
		removeEventListener: (type: string, fn: Listener) => {
			documentListeners[type] = (documentListeners[type] || []).filter((item) => item !== fn);
		},
		querySelectorAll: (selector: string) => {
			assert.equal(selector, '[data-dnd-zone]');
			return all().filter((node) => 'data-dnd-zone' in node.attributes);
		},
	};
	let queued: Array<() => void> = [];
	let frameIds = 0;
	const windowStub = {
		requestAnimationFrame: (fn: () => void) => {
			queued.push(fn);
			return ++frameIds;
		},
		cancelAnimationFrame: () => {
			queued = [];
		},
	};
	let busy = false;
	const factory = new Function(
		'document',
		'window',
		'editBusy',
		between(RULES_START, EVENTS_END) + '\nreturn { dragZone, tableDropZone, whenIdle, finishDrag, rerenderSoon, dragging: () => Boolean(dragNow) };'
	) as (
		doc: unknown,
		win: unknown,
		editBusy: () => boolean
	) => {
		dragZone: Wiring['dragZone'];
		tableDropZone: Wiring['tableDropZone'];
		whenIdle: Wiring['whenIdle'];
		finishDrag: Wiring['finishDrag'];
		rerenderSoon: Wiring['rerenderSoon'];
		dragging: () => boolean;
	};
	const made = factory(documentStub, windowStub, () => busy);
	return {
		dragZone: made.dragZone,
		tableDropZone: made.tableDropZone,
		whenIdle: made.whenIdle,
		finishDrag: made.finishDrag,
		rerenderSoon: made.rerenderSoon,
		dragging: made.dragging,
		documentListeners: documentListeners,
		body: body,
		setBusy: (value: boolean) => {
			busy = value;
		},
		frames: () => queued.length,
		flushFrames: () => {
			const run = queued;
			queued = [];
			run.forEach((fn) => fn());
		},
		fire: (type, target, options = {}) => {
			const event: FakeEvent = {
				type: type,
				target: target,
				clientX: options.clientX ?? 0,
				clientY: options.clientY ?? 0,
				buttons: options.buttons ?? 0,
				dataTransfer: options.dataTransfer === undefined ? transfer() : options.dataTransfer,
				defaultPrevented: false,
				preventDefault() {
					this.defaultPrevented = true;
				},
			};
			// Всплытие: слушатели на пути (источник), затем документ
			for (let node: El | null = target; node; node = node.parentElement) {
				(node.listeners[type] || []).forEach((fn) => fn(event));
			}
			(documentListeners[type] || []).forEach((fn) => fn(event));
			return event;
		},
	};
}

/** Два списка в окне: «Источник» (строки a, b, c тащатся) и «Цель» (строки 0, 1, 2), строки — прямые дети. */
function lists(w: Wiring) {
	const dropped: Array<{ payload: Payload; target: DragTarget }> = [];
	const source = w.body.append(new El('DIV'));
	const target = w.body.append(new El('DIV'));
	const rowsOf = (host: El, keys: string[], top: number) =>
		keys.map((key, index) => {
			const row = host.append(new El('DIV'));
			row.setAttribute('data-key', key);
			row.rect = { top: top + index * 20, height: 20 };
			row.append(new El('SPAN'));
			return row;
		});
	const sourceRows = rowsOf(source, ['a', 'b', 'c'], 0);
	sourceRows[0].draggable = true;
	sourceRows[1].draggable = true;
	const targetRows = rowsOf(target, ['0', '1', '2'], 100);
	const keyOf = (row: El) => row.getAttribute('data-key');
	w.dragZone(source, { id: 'src', scope: 1, keyOf: keyOf, drag: (key: string) => (key === 'b' ? 'field' : key === 'a' ? 'table' : '') });
	w.dragZone(target, {
		id: 'dst',
		scope: 1,
		keyOf: keyOf,
		from: { src: (payload: Payload, spot: DragTarget) => dropped.push({ payload: payload, target: spot }) },
		place: (payload: Payload) => (payload.kind === 'table' ? 'zone' : 'line'),
		effect: 'copy',
	});
	return { source, target, sourceRows, targetRows, dropped };
}

describe('Перетаскивание: обвязка событий документа (мини-DOM)', () => {
	test('пять слушателей у документа и ни одного у строк и списков; зона — атрибут контейнера', () => {
		const w = wiring();
		assert.deepEqual(Object.keys(w.documentListeners).sort(), ['dragend', 'dragleave', 'dragover', 'dragstart', 'drop']);
		const made = lists(w);
		assert.equal(made.target.getAttribute('data-dnd-zone'), 'dst');
		for (const node of [made.source, made.target, ...made.sourceRows, ...made.targetRows]) {
			assert.deepEqual(Object.keys(node.listeners), [], 'регистрация зоны не вешает слушателей');
		}
	});

	test('перенос строки: нагрузка — данные, подсветка раз в кадр, сброс зовёт обработчик зоны с ключом и местом', () => {
		const w = wiring();
		const made = lists(w);
		const dt = transfer();
		const start = w.fire('dragstart', made.sourceRows[1], { dataTransfer: dt });
		assert.equal(start.defaultPrevented, false);
		assert.equal(w.dragging(), true);
		assert.deepEqual(dt.types, ['application/x-dcs-row']);
		assert.equal(dt.effectAllowed, 'copyMove');
		assert.ok(made.sourceRows[1].classList.contains('dcs-dnd-source'));
		assert.ok(made.target.classList.contains('dcs-dnd-can'), 'принимающая зона видна сразу');
		assert.ok(!made.source.classList.contains('dcs-dnd-can'), 'источник сам себя не принимает');
		assert.ok(made.sourceRows[1].listeners.dragend, 'конец переноса дойдёт и до строки, ушедшей из документа');
		// dragover над строкой цели: принят, курсор «копировать», подсветка — в кадре, не в событии
		const over = w.fire('dragover', made.targetRows[1].children[0], { clientY: 135, dataTransfer: dt });
		assert.equal(over.defaultPrevented, true);
		assert.equal(dt.dropEffect, 'copy');
		assert.ok(!made.targetRows[1].classList.contains('dcs-dnd-after'), 'до кадра классы не меняются');
		w.fire('dragover', made.targetRows[1], { clientY: 136, dataTransfer: dt });
		assert.equal(w.frames(), 1, 'частые dragover — один кадр');
		w.flushFrames();
		assert.ok(made.target.classList.contains('dcs-dnd-over'));
		assert.ok(made.targetRows[1].classList.contains('dcs-dnd-after'), 'нижняя половина строки — после неё');
		w.fire('dragover', made.targetRows[2], { clientY: 141, dataTransfer: dt });
		w.flushFrames();
		assert.ok(!made.targetRows[1].classList.contains('dcs-dnd-after'));
		assert.ok(made.targetRows[2].classList.contains('dcs-dnd-before'));
		const drop = w.fire('drop', made.targetRows[2], { clientY: 141, dataTransfer: dt });
		assert.equal(drop.defaultPrevented, true);
		assert.deepEqual(made.dropped, [{ payload: { zone: 'src', scope: 1, key: 'b', kind: 'field' }, target: { key: '2', place: 'before', offset: undefined } }]);
		assert.equal(w.dragging(), false);
		assert.ok(!made.targetRows[2].classList.contains('dcs-dnd-before'), 'подсветка снята');
		assert.ok(!made.target.classList.contains('dcs-dnd-can') && !made.target.classList.contains('dcs-dnd-over'));
		assert.ok(!made.sourceRows[1].classList.contains('dcs-dnd-source'));
		const endListeners = (): number => (made.sourceRows[1].listeners.dragend || []).length;
		assert.equal(endListeners(), 0, 'слушатель конца у источника — только на время переноса');
		w.fire('dragend', made.sourceRows[1], { dataTransfer: dt });
		assert.equal(made.dropped.length, 1, 'dragend после сброса ничего не повторяет');
		// Отмена (dragend без сброса) тоже снимает слушатель у источника
		const again = transfer();
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: again });
		assert.equal(endListeners(), 1);
		w.fire('dragend', made.sourceRows[1], { dataTransfer: again });
		assert.equal(endListeners(), 0);
		for (const node of [made.source, made.target, ...made.sourceRows, ...made.targetRows]) {
			assert.deepEqual(Object.keys(node.listeners), [], 'после переноса у узлов не осталось слушателей');
		}
	});

	test('сброс под строками — в конец (линия у последней строки), «список целиком» — без строки', () => {
		const w = wiring();
		const made = lists(w);
		const dt = transfer();
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: dt });
		w.fire('dragover', made.target, { clientY: 400, dataTransfer: dt });
		w.flushFrames();
		assert.ok(made.targetRows[2].classList.contains('dcs-dnd-after'), 'под строками — линия у последней');
		w.fire('drop', made.target, { clientY: 400, dataTransfer: dt });
		assert.deepEqual(made.dropped[0].target, { key: null, place: 'end', offset: undefined });
		const table = transfer();
		w.fire('dragstart', made.sourceRows[0], { dataTransfer: table });
		w.fire('dragover', made.targetRows[0], { clientY: 101, dataTransfer: table });
		w.flushFrames();
		assert.ok(!made.targetRows[0].classList.contains('dcs-dnd-before'), 'таблица — в список целиком, строка не важна');
		assert.ok(made.target.classList.contains('dcs-dnd-over'));
		w.fire('drop', made.targetRows[0], { clientY: 101, dataTransfer: table });
		assert.deepEqual(made.dropped[1].target, { key: null, place: 'end', offset: undefined });
	});

	test('вне зон и в зону, которая перенос не примет, — dropEffect none без отмены; чужой сброс не трогается', () => {
		const w = wiring();
		const made = lists(w);
		const outside = w.body.append(new El('DIV'));
		const dt = transfer();
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: dt });
		dt.dropEffect = 'copy';
		const over = w.fire('dragover', outside, { dataTransfer: dt });
		assert.equal(over.defaultPrevented, false);
		assert.equal(dt.dropEffect, 'none', 'вне зон курсор не обещает сброс (VS Code отменил dragover на всём документе)');
		dt.dropEffect = 'copy';
		w.fire('dragover', made.sourceRows[2], { dataTransfer: dt });
		assert.equal(dt.dropEffect, 'none', 'свой список без обработчика для себя — тоже нет');
		// Сброс мимо зон: перенос кончается, обработчик не зовётся
		w.fire('drop', outside, { dataTransfer: dt });
		assert.equal(w.dragging(), false);
		assert.equal(made.dropped.length, 0);
		// Чужой перенос (файл из проводника): нашего переноса нет — dragover 'none', drop не отменяется и ничего не зовёт
		const files = transfer(['Files']);
		files.dropEffect = 'copy';
		const foreignOver = w.fire('dragover', made.targetRows[0], { dataTransfer: files });
		assert.equal(foreignOver.defaultPrevented, false);
		assert.equal(files.dropEffect, 'none');
		const foreignDrop = w.fire('drop', made.targetRows[0], { dataTransfer: files });
		assert.equal(foreignDrop.defaultPrevented, false);
		assert.equal(made.dropped.length, 0);
	});

	test('сброс без своего типа данных (текст поверх нашего переноса) обработчик не зовёт', () => {
		const w = wiring();
		const made = lists(w);
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: transfer() });
		w.fire('drop', made.targetRows[0], { dataTransfer: transfer(['text/plain']) });
		assert.equal(made.dropped.length, 0);
		assert.equal(w.dragging(), false);
	});

	test('перенос не начинается: строка без атрибута draggable (выделенный текст), вид пустой, правка сохраняется, окно неактивно', () => {
		const w = wiring();
		const made = lists(w);
		// Выделенный текст в строке: не наш перенос — не отменяется и не начинается
		const text = w.fire('dragstart', made.sourceRows[2].children[0]);
		assert.equal(text.defaultPrevented, false);
		assert.equal(w.dragging(), false);
		// Строка помечена, но вид пустой — отмена
		made.sourceRows[2].draggable = true;
		const empty = w.fire('dragstart', made.sourceRows[2]);
		assert.equal(empty.defaultPrevented, true);
		assert.equal(w.dragging(), false);
		w.setBusy(true);
		const busy = w.fire('dragstart', made.sourceRows[1]);
		assert.equal(busy.defaultPrevented, true, 'пока правка сохраняется, перенос не начинается');
		assert.equal(w.dragging(), false);
		w.setBusy(false);
		made.source.inert = true;
		const inert = w.fire('dragstart', made.sourceRows[1]);
		assert.equal(inert.defaultPrevented, true, 'нижнее окно (inert)');
		made.source.inert = false;
		made.target.inert = true;
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: transfer() });
		assert.ok(!made.target.classList.contains('dcs-dnd-can'), 'зона неактивного окна не подсвечивается');
		const dt = transfer(['application/x-dcs-row']);
		w.fire('drop', made.targetRows[0], { dataTransfer: dt });
		assert.equal(made.dropped.length, 0, 'неактивное окно сброс не принимает');
	});

	test('ответы и перерисовки во время переноса ждут его конца и идут по порядку после действия сброса', () => {
		const w = wiring();
		const made = lists(w);
		const order: string[] = [];
		w.whenIdle(() => order.push('до переноса'));
		assert.deepEqual(order, ['до переноса'], 'без переноса — сразу');
		const dt = transfer();
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: dt });
		w.whenIdle(() => order.push('ответ 1'));
		w.whenIdle(() => order.push('ответ 2'));
		assert.deepEqual(order, ['до переноса'], 'во время переноса — ждут');
		const target = made.target;
		// Обработчик сброса — первым: он работает по модели, которую пользователь видел
		const zone = { id: 'dst2', scope: 1, keyOf: () => null, from: { src: () => order.push('сброс') } };
		w.dragZone(target, zone);
		w.fire('drop', target, { dataTransfer: dt });
		assert.deepEqual(order, ['до переноса', 'сброс', 'ответ 1', 'ответ 2']);
	});

	test('отмена (dragend без сброса) и Esc отдают отложенное и снимают подсветку', () => {
		const w = wiring();
		const made = lists(w);
		const order: string[] = [];
		const dt = transfer();
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: dt });
		w.fire('dragover', made.targetRows[0], { clientY: 101, dataTransfer: dt });
		w.flushFrames();
		w.whenIdle(() => order.push('ответ'));
		// Конец переноса доходит до строки-источника, даже если она уже не в документе
		made.sourceRows[1].connected = false;
		(made.sourceRows[1].listeners.dragend || []).forEach((fn) => fn({} as FakeEvent));
		assert.equal(w.dragging(), false);
		assert.deepEqual(order, ['ответ']);
		assert.ok(!made.targetRows[0].classList.contains('dcs-dnd-before'));
		assert.ok(!made.target.classList.contains('dcs-dnd-over') && !made.target.classList.contains('dcs-dnd-can'));
		// Esc: обработчик клавиш документа зовёт finishDrag(false) — то же, что отмена
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: transfer() });
		w.whenIdle(() => order.push('ответ 2'));
		w.finishDrag(false);
		assert.deepEqual(order, ['ответ', 'ответ 2']);
		assert.equal(made.dropped.length, 0);
	});

	test('строка-источник становится выбранной: отмена, Esc, сброс мимо зон, копия в другой список, сброс на себя и без изменений; перестановка — нет', () => {
		const w = wiring();
		const made = lists(w);
		const log: string[] = [];
		const keyOf = (row: El) => row.getAttribute('data-key');
		made.sourceRows[2].draggable = true;
		w.dragZone(made.source, {
			id: 'src',
			scope: 1,
			keyOf: keyOf,
			drag: (key: string) => (key === 'a' ? 'table' : 'field'),
			pick: (key: string) => log.push('выбор ' + key),
			// Перестановка в своём списке: строка «c» — «ничего не изменилось» (false), как сдвиг на своё же место
			from: { src: (payload: Payload, spot: DragTarget) => (log.push('перестановка ' + payload.key + ' к ' + spot.key), spot.key === 'c' ? false : undefined) },
		});
		w.dragZone(made.target, { id: 'dst', scope: 1, keyOf: keyOf, from: { src: (payload: Payload) => log.push('копия ' + payload.key) }, effect: 'copy' });
		const outside = w.body.append(new El('DIV'));
		const run = (steps: (dt: FakeTransfer) => void): string[] => {
			log.length = 0;
			const dt = transfer();
			w.fire('dragstart', made.sourceRows[1], { dataTransfer: dt });
			steps(dt);
			assert.equal(w.dragging(), false);
			return log.slice();
		};
		// Отмена: отложенный ответ — первым, выбор — после него (перерисовка по новым данным)
		assert.deepEqual(
			run((dt) => {
				w.whenIdle(() => log.push('ответ'));
				w.fire('dragend', made.sourceRows[1], { dataTransfer: dt });
			}),
			['ответ', 'выбор b']
		);
		assert.deepEqual(run(() => w.finishDrag(false, true)), ['выбор b'], 'Esc');
		assert.deepEqual(run((dt) => w.fire('drop', outside, { dataTransfer: dt })), ['выбор b'], 'сброс мимо зон');
		assert.deepEqual(run((dt) => w.fire('drop', made.targetRows[1], { clientY: 125, dataTransfer: dt })), ['выбор b', 'копия b'], 'копия: выбор до действия, фокус после — действия');
		assert.deepEqual(run((dt) => w.fire('drop', made.sourceRows[1], { clientY: 25, dataTransfer: dt })), ['выбор b'], 'на себя — это щелчок, правки нет');
		assert.deepEqual(run((dt) => w.fire('drop', made.sourceRows[0], { clientY: 5, dataTransfer: dt })), ['перестановка b к a'], 'перестановка выбирает сама');
		assert.deepEqual(run((dt) => w.fire('drop', made.sourceRows[2], { clientY: 45, dataTransfer: dt })), ['перестановка b к c', 'выбор b'], 'ничего не изменилось — как щелчок');
		// Потерянный конец переноса (нажатие кнопки мыши) строку не выбирает: щелчок выберет свою
		assert.deepEqual(run(() => w.fire('pointerdown', outside)), []);
	});

	test('шапка списка и отступ над строками — перед первой строкой, а не в конец; под строками — в конец', () => {
		const w = wiring();
		const made = lists(w);
		// Шапка сетки — ребёнок контейнера без ключа, над строками (строки цели — 100, 120, 140)
		const head = new El('DIV');
		head.parentElement = made.target;
		head.rect = { top: 80, height: 20 };
		made.target.children.unshift(head);
		const cell = head.append(new El('SPAN'));
		const dt = transfer();
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: dt });
		w.fire('dragover', cell, { clientY: 95, dataTransfer: dt });
		w.flushFrames();
		// Линия — у нижнего края шапки: закреплённая шапка видна и тогда, когда первая строка ушла вверх, за край списка
		assert.ok(head.classList.contains('dcs-dnd-after'), 'шапка — линия у её нижнего края');
		assert.ok(!made.targetRows[0].classList.contains('dcs-dnd-before'), 'не у первой строки, которая может быть прокручена за край');
		assert.ok(!made.targetRows[2].classList.contains('dcs-dnd-after'), 'не у последней строки');
		w.fire('drop', cell, { clientY: 95, dataTransfer: dt });
		assert.deepEqual(made.dropped[0].target, { key: '0', place: 'before', offset: undefined });
		// Отступ над строками (сам контейнер выше первой строки) — тоже первым; ниже строк — в конец
		const padding = transfer();
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: padding });
		w.fire('dragover', made.target, { clientY: 99, dataTransfer: padding });
		w.flushFrames();
		assert.ok(made.targetRows[0].classList.contains('dcs-dnd-before'));
		w.fire('drop', made.target, { clientY: 99, dataTransfer: padding });
		assert.deepEqual(made.dropped[1].target, { key: '0', place: 'before', offset: undefined });
		const below = transfer();
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: below });
		w.fire('dragover', made.target, { clientY: 400, dataTransfer: below });
		w.flushFrames();
		assert.ok(made.targetRows[2].classList.contains('dcs-dnd-after'));
		w.fire('drop', made.target, { clientY: 400, dataTransfer: below });
		assert.deepEqual(made.dropped[2].target, { key: null, place: 'end', offset: undefined });
		// Номер вставки по этим местам: шапка и отступ — 0, под строками — в конец
		const R = rules();
		assert.equal(R.dropIndex(3, -1, 0, 'before'), 0);
		assert.equal(R.dropIndex(3, 2, 0, 'before'), 0, 'перестановка последней строки на шапку — первой');
		assert.equal(R.dropIndex(3, -1, -1, 'end'), 3);
	});

	test('потерянный конец переноса: нажатие кнопки или движение без нажатой кнопки его заканчивают; слушатели — только на время переноса', () => {
		const w = wiring();
		const made = lists(w);
		const order: string[] = [];
		const count = (type: string) => (w.documentListeners[type] || []).length;
		assert.equal(count('pointerdown') + count('mousemove'), 0, 'пока никто не тащит — слушателей нет');
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: transfer() });
		assert.equal(count('pointerdown'), 1);
		assert.equal(count('mousemove'), 1);
		w.whenIdle(() => order.push('ответ'));
		w.fire('mousemove', w.body, { buttons: 1 });
		assert.equal(w.dragging(), true, 'движение с нажатой кнопкой (из очереди до начала переноса) перенос не кончает');
		w.fire('mousemove', w.body, { buttons: 0 });
		assert.equal(w.dragging(), false, 'кнопка отпущена, а dragend не пришёл');
		assert.deepEqual(order, ['ответ'], 'ответы не ждут вечно');
		assert.equal(count('pointerdown') + count('mousemove'), 0, 'слушатели сняты');
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: transfer() });
		w.whenIdle(() => order.push('ответ 2'));
		w.fire('pointerdown', w.body);
		assert.equal(w.dragging(), false);
		assert.deepEqual(order, ['ответ', 'ответ 2']);
		// Исключение посреди начала переноса (правило зоны): конец переноса всё равно доходит до источника
		w.dragZone(made.target, {
			id: 'dst',
			scope: 1,
			keyOf: (row: El) => row.getAttribute('data-key'),
			from: { src: () => undefined },
			accept: () => {
				throw new Error('правило зоны');
			},
		});
		assert.throws(() => w.fire('dragstart', made.sourceRows[1], { dataTransfer: transfer() }), /правило зоны/);
		assert.equal(w.dragging(), true);
		assert.ok(made.sourceRows[1].listeners.dragend, 'слушатель конца — до правил зон');
		(made.sourceRows[1].listeners.dragend || []).forEach((fn) => fn({} as FakeEvent));
		assert.equal(w.dragging(), false);
	});

	test('ответы, пришедшие во время переноса, перерисовывают окно один раз — после всех ответов; без переноса — сразу', () => {
		const w = wiring();
		const made = lists(w);
		const log: string[] = [];
		const render = () => log.push('перерисовка');
		const other = () => log.push('окно типа');
		w.rerenderSoon(render);
		assert.deepEqual(log, ['перерисовка'], 'без переноса — сразу');
		log.length = 0;
		const dt = transfer();
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: dt });
		w.whenIdle(() => {
			log.push('метаданные');
			w.rerenderSoon(render);
		});
		w.whenIdle(() => {
			log.push('описание');
			w.rerenderSoon(render);
			w.rerenderSoon(other);
		});
		w.fire('drop', made.targetRows[0], { clientY: 101, dataTransfer: dt });
		assert.equal(made.dropped.length, 1);
		assert.deepEqual(log, ['метаданные', 'описание', 'перерисовка', 'окно типа'], 'ответы — по порядку, перерисовка каждого окна — одна');
		log.length = 0;
		w.rerenderSoon(render);
		assert.deepEqual(log, ['перерисовка'], 'после — снова сразу');
	});

	test('зона со своим местом сброса (поле выражения): preview раз в кадр с точкой, preview(null) при уходе и в конце, до действия', () => {
		const w = wiring();
		const made = lists(w);
		const log: string[] = [];
		const box = w.body.append(new El('DIV'));
		const text = box.append(new El('TEXTAREA'));
		const outside = w.body.append(new El('DIV'));
		w.dragZone(box, {
			id: 'xexpr',
			scope: 1,
			keyOf: () => null,
			from: { src: (payload: Payload, spot: DragTarget & { offset?: number }) => log.push('вставка ' + spot.offset) },
			place: 'zone',
			effect: 'copy',
			target: () => ({ key: null, place: 'end', offset: 3 }),
			preview: (x: number | null, y: number | null) => log.push(x === null ? 'место снято' : 'место ' + x + ',' + y),
		});
		const dt = transfer();
		w.fire('dragstart', made.sourceRows[1], { dataTransfer: dt });
		w.fire('dragover', text, { clientX: 12, clientY: 34, dataTransfer: dt });
		w.fire('dragover', text, { clientX: 13, clientY: 35, dataTransfer: dt });
		assert.deepEqual(log, [], 'не в событии — в кадре');
		w.flushFrames();
		assert.deepEqual(log, ['место 13,35'], 'раз в кадр, по последней точке');
		assert.ok(box.classList.contains('dcs-dnd-over'), 'рамка — у зоны');
		w.fire('dragover', outside, { dataTransfer: dt });
		w.flushFrames();
		assert.deepEqual(log, ['место 13,35', 'место снято'], 'указатель ушёл');
		w.fire('dragover', text, { clientX: 20, clientY: 40, dataTransfer: dt });
		w.flushFrames();
		w.fire('drop', text, { clientX: 20, clientY: 40, dataTransfer: dt });
		assert.deepEqual(log, ['место 13,35', 'место снято', 'место 20,40', 'место снято', 'вставка 3'], 'место снято до действия: позицию вставке даёт target');
	});
});

interface Slot {
	parent: number[];
	index: number;
}
interface Item {
	name: string;
	kind?: string;
	items?: Item[];
}
interface ItemsRules {
	itemsDropSlot(items: Item[], target: number[] | null, place: string): Slot;
	itemsInsert(items: Item[], slot: Slot, fresh: Item): { items: Item[]; pos: number[] };
	itemsMove(items: Item[], from: number[], slot: Slot): { items: Item[]; pos: number[] } | null;
	listDropSlot(items: Item[], target: number[] | null, place: string, container?: (item: Item) => boolean): Slot;
	itemsOutdentSlot(items: Item[], pos: number[]): Slot | null;
	itemsIndentSlot(items: Item[], pos: number[], container: (item: Item) => boolean): Slot | null;
}

function itemsRules(): ItemsRules {
	return new Function(
		between(RULES_START, EVENTS_START) + '\nreturn { itemsDropSlot, itemsInsert, itemsMove, listDropSlot, itemsOutdentSlot, itemsIndentSlot };'
	)() as ItemsRules;
}

describe('Перетаскивание: правки списков «Настроек» по месту сброса (папки выбранных полей, группы отбора)', () => {
	const R = itemsRules();
	// [а, Папка[б, в], г, Пустая[]] — адреса строк по порядку отрисовки (папки раскрыты всегда)
	const tree = (): Item[] => [
		{ name: 'а' },
		{ name: 'Папка', kind: 'folder', items: [{ name: 'б' }, { name: 'в' }] },
		{ name: 'г' },
		{ name: 'Пустая', kind: 'folder' },
	];
	const names = (items: Item[]): unknown[] => items.map((item) => (item.items ? [item.name, names(item.items)] : item.name));

	test('место сброса: до и после строки — на её уровне, «в строку» — последним в папку, под строками и без строки — в конец верхнего уровня', () => {
		const items = tree();
		assert.deepEqual(R.itemsDropSlot(items, [0], 'before'), { parent: [], index: 0 });
		assert.deepEqual(R.itemsDropSlot(items, [0], 'after'), { parent: [], index: 1 });
		assert.deepEqual(R.itemsDropSlot(items, [1, 1], 'before'), { parent: [1], index: 1 });
		assert.deepEqual(R.itemsDropSlot(items, [1, 1], 'after'), { parent: [1], index: 2 });
		assert.deepEqual(R.itemsDropSlot(items, [1], 'into'), { parent: [1], index: 2 });
		assert.deepEqual(R.itemsDropSlot(items, [3], 'into'), { parent: [3], index: 0 }, 'пустая папка без items');
		assert.deepEqual(R.itemsDropSlot(items, null, 'end'), { parent: [], index: 4 });
		assert.deepEqual(R.itemsDropSlot(items, [2], 'end'), { parent: [], index: 4 });
		assert.deepEqual(R.itemsDropSlot([], null, 'end'), { parent: [], index: 0 }, 'пустой список');
		assert.deepEqual(names(items), names(tree()), 'исходное дерево не меняется');
	});

	test('новый элемент: копия дерева со вставкой и его адрес; в пустую папку — со списком; «>» в папку — то же место, что «в строку»', () => {
		const items = tree();
		let made = R.itemsInsert(items, R.itemsDropSlot(items, [1, 0], 'after'), { name: 'н' });
		assert.deepEqual(names(made.items), ['а', ['Папка', ['б', 'н', 'в']], 'г', 'Пустая']);
		assert.deepEqual(made.pos, [1, 1]);
		made = R.itemsInsert(items, R.itemsDropSlot(items, [3], 'into'), { name: 'н' });
		assert.deepEqual(names(made.items), ['а', ['Папка', ['б', 'в']], 'г', ['Пустая', ['н']]]);
		assert.deepEqual(made.pos, [3, 0]);
		made = R.itemsInsert(items, R.itemsDropSlot(items, [0], 'before'), { name: 'н' });
		assert.deepEqual(made.pos, [0]);
		assert.equal(made.items[0].name, 'н');
		assert.deepEqual(R.itemsInsert(items, { parent: [], index: 99 }, { name: 'н' }).pos, [4], 'номер за краем — в конец');
		assert.deepEqual(names(items), names(tree()), 'исходное дерево не меняется');
	});

	test('перенос: внутри уровня, в папку и из неё, на своё место и папка в саму себя — null', () => {
		const items = tree();
		const move = (from: number[], target: number[] | null, place: string) => R.itemsMove(items, from, R.itemsDropSlot(items, target, place));
		let made = move([0], [2], 'after');
		assert.deepEqual(names(made!.items), [['Папка', ['б', 'в']], 'г', 'а', 'Пустая']);
		assert.deepEqual(made!.pos, [2]);
		made = move([0], [1], 'into');
		assert.deepEqual(names(made!.items), [['Папка', ['б', 'в', 'а']], 'г', 'Пустая']);
		assert.deepEqual(made!.pos, [0, 2], 'папка поднялась на одну строку после изъятия');
		made = move([2], [1, 0], 'before');
		assert.deepEqual(names(made!.items), ['а', ['Папка', ['г', 'б', 'в']], 'Пустая']);
		assert.deepEqual(made!.pos, [1, 0]);
		made = move([1, 1], [0], 'before');
		assert.deepEqual(names(made!.items), ['в', 'а', ['Папка', ['б']], 'г', 'Пустая']);
		assert.deepEqual(made!.pos, [0]);
		made = move([1, 0], [3], 'into');
		assert.deepEqual(names(made!.items), ['а', ['Папка', ['в']], 'г', ['Пустая', ['б']]]);
		made = move([1], null, 'end');
		assert.deepEqual(names(made!.items), ['а', 'г', 'Пустая', ['Папка', ['б', 'в']]]);
		assert.deepEqual(made!.pos, [3]);
		assert.equal(move([1], [1, 0], 'before'), null, 'папка — в свою вложенную строку');
		assert.equal(move([1], [1], 'into'), null, 'папка — в саму себя');
		assert.equal(move([0], [0], 'after'), null, 'на себя');
		assert.equal(move([0], [1], 'before'), null, 'до следующей строки — то же место');
		assert.equal(move([1, 1], [1], 'into'), null, 'последняя в папке — в ту же папку');
		assert.deepEqual(names(items), names(tree()), 'исходное дерево не меняется');
	});

	test('место — там, где линия: «после» папки с вложенными — первым в неё (как «до» её первой строки), а не за её содержимым', () => {
		const items = tree();
		const folder = (item: Item) => item.kind === 'folder';
		// Линия под строкой «Папка» — между ней и «б»: тот же адрес, что «до» «б»
		assert.deepEqual(R.listDropSlot(items, [1], 'after', folder), { parent: [1], index: 0 });
		assert.deepEqual(R.listDropSlot(items, [1], 'after', folder), R.listDropSlot(items, [1, 0], 'before', folder));
		// Пустая папка, поле, «до» папки, «в строку», под строками — как itemsDropSlot
		for (const [target, place] of [
			[[3], 'after'],
			[[0], 'after'],
			[[1], 'before'],
			[[1], 'into'],
			[[1, 1], 'after'],
			[null, 'end'],
		] as Array<[number[] | null, string]>) {
			assert.deepEqual(R.listDropSlot(items, target, place, folder), R.itemsDropSlot(items, target, place), JSON.stringify(target) + ' ' + place);
		}
		// Без правила контейнера (сортировка) — как itemsDropSlot
		assert.deepEqual(R.listDropSlot(items, [1], 'after'), R.itemsDropSlot(items, [1], 'after'));
		// Новое поле и перенос: [а, Папка[б, в], г] — «после» папки встаёт первым в неё, рядом с линией
		const add = R.itemsInsert(items, R.listDropSlot(items, [1], 'after', folder), { name: 'н' });
		assert.deepEqual(names(add.items), ['а', ['Папка', ['н', 'б', 'в']], 'г', 'Пустая']);
		assert.deepEqual(add.pos, [1, 0]);
		const moved = R.itemsMove(items, [2], R.listDropSlot(items, [1], 'after', folder));
		assert.deepEqual(names(moved!.items), ['а', ['Папка', ['г', 'б', 'в']], 'Пустая']);
		assert.deepEqual(moved!.pos, [1, 0]);
		assert.equal(R.itemsMove(items, [1], R.listDropSlot(items, [1], 'after', folder)), null, 'папка — под свою же строку: в саму себя');
		assert.equal(R.itemsMove(items, [1, 0], R.listDropSlot(items, [1], 'after', folder)), null, 'первая строка папки — на своё место');
	});

	test('команды уровня: «Вынести из папки» — сразу за ней, «В папку выше» — последним в соседнюю папку над строкой', () => {
		const items = tree();
		const folder = (item: Item) => item.kind === 'folder';
		assert.equal(R.itemsOutdentSlot(items, [0]), null, 'строка верхнего уровня');
		assert.deepEqual(R.itemsOutdentSlot(items, [1, 1]), { parent: [], index: 2 });
		let made = R.itemsMove(items, [1, 0], R.itemsOutdentSlot(items, [1, 0])!);
		assert.deepEqual(names(made!.items), ['а', ['Папка', ['в']], 'б', 'г', 'Пустая']);
		assert.deepEqual(made!.pos, [2]);
		assert.equal(R.itemsIndentSlot(items, [0], folder), null, 'первая строка');
		assert.equal(R.itemsIndentSlot(items, [1], folder), null, 'над папкой — не папка');
		assert.deepEqual(R.itemsIndentSlot(items, [2], folder), { parent: [1], index: 2 });
		made = R.itemsMove(items, [2], R.itemsIndentSlot(items, [2], folder)!);
		assert.deepEqual(names(made!.items), ['а', ['Папка', ['б', 'в', 'г']], 'Пустая']);
		assert.deepEqual(made!.pos, [1, 2]);
		// В пустую папку (без items) — первым; папка в папку — вместе с содержимым
		const deep: Item[] = [{ name: 'Пустая', kind: 'folder' }, { name: 'Папка', kind: 'folder', items: [{ name: 'б' }] }];
		made = R.itemsMove(deep, [1], R.itemsIndentSlot(deep, [1], folder)!);
		assert.deepEqual(names(made!.items), [['Пустая', [['Папка', ['б']]]]]);
		assert.deepEqual(made!.pos, [0, 0]);
		// Вложенная: из второго уровня — в папку первого уровня, за её строкой
		made = R.itemsMove(made!.items, [0, 0, 0], R.itemsOutdentSlot(made!.items, [0, 0, 0])!);
		assert.deepEqual(names(made!.items), [['Пустая', [['Папка', []], 'б']]]);
		assert.deepEqual(names(items), names(tree()), 'исходное дерево не меняется');
	});

	test('перестановка в плоском списке сходится с dropIndex и перестановкой массива (как у ↑ ↓ — movedCopy)', () => {
		const D = rules();
		for (let count = 1; count <= 6; count++) {
			const list: Item[] = Array.from({ length: count }, (_, k) => ({ name: 'e' + k }));
			for (let from = 0; from < count; from++) {
				for (let target = 0; target < count; target++) {
					for (const place of ['before', 'after']) {
						const to = D.dropIndex(count, from, target, place);
						const made = R.itemsMove(list, [from], R.itemsDropSlot(list, [target], place));
						if (to === from) {
							assert.equal(made, null, count + ': ' + from + ' ' + place + ' ' + target);
							continue;
						}
						const expected = list.slice();
						expected.splice(to, 0, expected.splice(from, 1)[0]);
						assert.deepEqual(made!.items, expected, count + ': ' + from + ' ' + place + ' ' + target);
						assert.deepEqual(made!.pos, [to]);
					}
				}
			}
		}
	});
});

describe('Перетаскивание: зона у таблицы, место по ключу строки, отказ строки (мини-DOM)', () => {
	/** Колонка со списком: панель, таблица (thead > tr шапки, tbody > tr строк с ячейками), строки — 100, 120, 140. */
	function table(w: Wiring, keys: string[]) {
		const host = w.body.append(new El('DIV'));
		const bar = host.append(new El('DIV'));
		bar.rect = { top: 40, height: 20 };
		const tableEl = host.append(new El('DIV')).append(new El('TABLE'));
		const head = tableEl.append(new El('THEAD')).append(new El('TR'));
		head.rect = { top: 80, height: 20 };
		const th = head.append(new El('TH'));
		const tbody = tableEl.append(new El('TBODY'));
		const rowKeys = new WeakMap<El, string>();
		const rows = keys.map((key, index) => {
			const tr = tbody.append(new El('TR'));
			tr.rect = { top: 100 + index * 20, height: 20 };
			rowKeys.set(tr, key);
			tr.append(new El('TD'));
			const name = tr.append(new El('TD'));
			name.draggable = true;
			return tr;
		});
		return { host, bar, head, th, rows, rowKeys };
	}

	test('строки — tr в tbody: перенос за ячейку имени, шапка и панель над таблицей — первым, под строками — в конец; слушателей у узлов нет', () => {
		const w = wiring();
		const t = table(w, ['[0]', '[1]', '[2]']);
		const log: string[] = [];
		w.tableDropZone(t.host, {
			id: 'lst',
			scope: 1,
			head: t.head,
			rows: () => t.rows,
			keys: t.rowKeys,
			drag: () => 'item',
			pick: (key: string) => log.push('выбор ' + key),
			from: { lst: (payload: Payload, spot: DragTarget) => log.push(payload.key + ' ' + spot.place + ' ' + spot.key) },
		});
		assert.equal(t.host.getAttribute('data-dnd-zone'), 'lst');
		assert.deepEqual(Object.keys(t.host.listeners), []);
		const drop = (target: El, y: number) => {
			const dt = transfer();
			assert.equal(w.fire('dragstart', t.rows[2].children[1], { dataTransfer: dt }).defaultPrevented, false);
			assert.ok(t.rows[2].classList.contains('dcs-dnd-source'), 'строка-источник — tr');
			w.fire('dragover', target, { clientY: y, dataTransfer: dt });
			w.flushFrames();
			// Линии по порядку: шапка, строки
			const marked = [t.head, ...t.rows].map((tr) => ['dcs-dnd-before', 'dcs-dnd-after'].filter((c) => tr.classList.contains(c)).join(''));
			w.fire('drop', target, { clientY: y, dataTransfer: dt });
			return marked;
		};
		// Шапка и панель над таблицей — первым, линия у нижнего края шапки (закреплённая, она видна и в прокрутке)
		assert.deepEqual(drop(t.th, 85), ['dcs-dnd-after', '', '', ''], 'шапка');
		assert.deepEqual(drop(t.bar, 45), ['dcs-dnd-after', '', '', ''], 'панель над таблицей');
		assert.deepEqual(drop(t.rows[0].children[0], 115), ['', 'dcs-dnd-after', '', ''], 'нижняя половина строки');
		assert.deepEqual(drop(t.host, 400), ['', '', '', 'dcs-dnd-after'], 'под строками — линия у последней');
		assert.deepEqual(log, ['[2] before [0]', '[2] before [0]', '[2] after [0]', '[2] end null']);
		// Список прокручен: закреплённая шапка (80) — над строками, ушедшими вверх под неё (40, 60, 80). Сброс на шапку —
		// всё равно первым: шапка узнаётся строкой зоны, а не по высоте
		t.rows.forEach((tr, index) => {
			tr.rect = { top: 40 + index * 20, height: 20 };
		});
		assert.deepEqual(drop(t.th, 85), ['dcs-dnd-after', '', '', ''], 'прокрученный список: шапка — первым');
		assert.equal(log[log.length - 1], '[2] before [0]');
		// Панель (45) — над прокрученным списком, первая строка (40) ушла выше неё: панель всё равно ставит первым — она над
		// таблицей по порядку в документе, а не по высоте
		assert.deepEqual(drop(t.bar, 45), ['dcs-dnd-after', '', '', ''], 'прокрученный список: панель');
		assert.equal(log[log.length - 1], '[2] before [0]', 'панель над прокрученным списком — в конец');
		// Обёртка таблицы (место под строками) содержит шапку — она не «над таблицей»: в конец
		assert.deepEqual(drop(t.head.parentElement!.parentElement!.parentElement!, 400), ['', '', '', 'dcs-dnd-after']);
		assert.equal(log[log.length - 1], '[2] end null');
		// Ручки нет (ячейка флажка без draggable) — перенос не начинается
		const start = w.fire('dragstart', t.rows[0].children[0], { dataTransfer: transfer() });
		assert.equal(w.dragging(), false);
		assert.equal(start.defaultPrevented, false, 'чужой перенос не трогается');
	});

	test('пустая таблица — тоже зона: сброс в конец; место «в строку» — только у строк, которым правило по ключу его даёт', () => {
		const w = wiring();
		const src = w.body.append(new El('DIV'));
		const srcRow = src.append(new El('DIV'));
		srcRow.setAttribute('data-key', 'f');
		srcRow.draggable = true;
		w.dragZone(src, { id: 'src', scope: 1, keyOf: (row: El) => row.getAttribute('data-key'), drag: () => 'field' });
		const empty = w.body.append(new El('DIV'));
		const got: DragTarget[] = [];
		w.tableDropZone(empty, { id: 'e', scope: 1, head: null, keys: null, from: { src: (payload: Payload, spot: DragTarget) => got.push(spot) } });
		let dt = transfer();
		w.fire('dragstart', srcRow, { dataTransfer: dt });
		w.fire('drop', empty, { clientY: 10, dataTransfer: dt });
		assert.deepEqual(got[0], { key: null, place: 'end', offset: undefined });
		// Строка «папка» — 'both' (четверти), остальные — 'line'; правило зовут и без строки (key null)
		const t = table(w, ['[0]', '[1]']);
		const asked: Array<string | null> = [];
		w.tableDropZone(t.host, {
			id: 'f',
			scope: 1,
			head: t.head,
			rows: () => t.rows,
			keys: t.rowKeys,
			from: { src: (payload: Payload, spot: DragTarget) => got.push(spot) },
			place: (payload: Payload, key: string | null) => (asked.push(key), key === '[1]' ? 'both' : 'line'),
		});
		const at = (row: number, y: number) => {
			dt = transfer();
			w.fire('dragstart', srcRow, { dataTransfer: dt });
			w.fire('dragover', t.rows[row].children[1], { clientY: y, dataTransfer: dt });
			w.flushFrames();
			const mark = ['dcs-dnd-before', 'dcs-dnd-after', 'dcs-dnd-into'].find((c) => t.rows[row].classList.contains(c));
			w.fire('drop', t.rows[row].children[1], { clientY: y, dataTransfer: dt });
			return mark + ' ' + got[got.length - 1].place;
		};
		assert.equal(at(1, 130), 'dcs-dnd-into into', 'папка серединой — в строку');
		assert.equal(at(1, 122), 'dcs-dnd-before before');
		assert.equal(at(0, 110), 'dcs-dnd-after after', 'поле серединой — линия, не «в строку»');
		assert.ok(asked.includes(null) && asked.includes('[1]') && asked.includes('[0]'));
	});

	test('строка, которая перенос не примет: курсор «нельзя» без отмены dragover, ни рамки, ни линии; сброс на неё — как мимо зон', () => {
		const w = wiring();
		const zone = w.body.append(new El('DIV'));
		const keyOf = (row: El) => row.getAttribute('data-key');
		const rows = ['a1', 'a2', 'b1'].map((key, index) => {
			const row = zone.append(new El('DIV'));
			row.setAttribute('data-key', key);
			row.rect = { top: index * 20, height: 20 };
			row.draggable = true;
			row.append(new El('SPAN'));
			return row;
		});
		const log: string[] = [];
		w.dragZone(zone, {
			id: 'tree',
			scope: 1,
			keyOf: keyOf,
			drag: () => 'node',
			pick: (key: string) => log.push('выбор ' + key),
			// Соседи — с той же буквой: a1 и a2, но не b1; без строки — нельзя
			rowAccept: (payload: Payload, key: string | null) => key !== null && key[0] === payload.key[0],
			from: { tree: (payload: Payload, spot: DragTarget) => log.push(payload.key + ' ' + spot.place + ' ' + spot.key) },
		});
		const dt = transfer();
		w.fire('dragstart', rows[0], { dataTransfer: dt });
		let over = w.fire('dragover', rows[2].children[0], { clientY: 45, dataTransfer: dt });
		assert.equal(over.defaultPrevented, false, 'отказ не отменяет dragover');
		assert.equal(dt.dropEffect, 'none');
		w.flushFrames();
		assert.ok(!zone.classList.contains('dcs-dnd-over') && !rows[2].classList.contains('dcs-dnd-after'), 'ни рамки, ни линии');
		over = w.fire('dragover', rows[1], { clientY: 35, dataTransfer: dt });
		assert.equal(over.defaultPrevented, true);
		assert.equal(dt.dropEffect, 'move');
		w.flushFrames();
		assert.ok(zone.classList.contains('dcs-dnd-over') && rows[1].classList.contains('dcs-dnd-after'));
		// Уход на чужую строку снимает подсветку в следующем кадре
		w.fire('dragover', rows[2], { clientY: 45, dataTransfer: dt });
		w.flushFrames();
		assert.ok(!zone.classList.contains('dcs-dnd-over') && !rows[1].classList.contains('dcs-dnd-after'));
		// Сброс на чужую строку (оболочка VS Code отменила dragover сама) — как мимо зон: правки нет, строка выбрана
		w.fire('drop', rows[2], { clientY: 45, dataTransfer: dt });
		assert.deepEqual(log, ['выбор a1']);
		assert.equal(w.dragging(), false);
		const again = transfer();
		w.fire('dragstart', rows[0], { dataTransfer: again });
		w.fire('drop', rows[1], { clientY: 35, dataTransfer: again });
		assert.deepEqual(log, ['выбор a1', 'a1 after a2']);
	});

	test('своя строка линии (markRow): «после» раскрытого узла — под его последним потомком; место сброса — по строке под указателем', () => {
		const w = wiring();
		const zone = w.body.append(new El('DIV'));
		// a (раскрыт: a.1, a.2), b — строки 0, 20, 40, 60
		const rows = ['a', 'a.1', 'a.2', 'b'].map((key, index) => {
			const row = zone.append(new El('DIV'));
			row.setAttribute('data-key', key);
			row.rect = { top: index * 20, height: 20 };
			row.draggable = true;
			return row;
		});
		const got: DragTarget[] = [];
		const asked: string[] = [];
		w.dragZone(zone, {
			id: 'tree',
			scope: 1,
			keyOf: (row: El) => row.getAttribute('data-key'),
			drag: () => 'node',
			markRow: (key: string, place: string) => (asked.push(key + ' ' + place), key === 'a' && place === 'after' ? rows[2] : null),
			from: { tree: (payload: Payload, spot: DragTarget) => got.push(spot) },
		});
		const at = (row: number, y: number) => {
			const dt = transfer();
			w.fire('dragstart', rows[3], { dataTransfer: dt });
			w.fire('dragover', rows[row], { clientY: y, dataTransfer: dt });
			w.flushFrames();
			const marked = rows.map((r) => ['dcs-dnd-before', 'dcs-dnd-after'].filter((c) => r.classList.contains(c)).join(''));
			w.fire('drop', rows[row], { clientY: y, dataTransfer: dt });
			return marked;
		};
		assert.deepEqual(at(0, 15), ['', '', 'dcs-dnd-after', ''], 'линия — под последним потомком «a»');
		assert.deepEqual(got[got.length - 1], { key: 'a', place: 'after', offset: undefined }, 'место — по строке «a»');
		assert.deepEqual(at(0, 5), ['dcs-dnd-before', '', '', ''], '«до» — у самой строки');
		assert.ok(asked.includes('a after') && asked.includes('a before'));
	});
});

describe('Перетаскивание: место поля в «Полях» (QE.addField + QE.moveField)', () => {
	function loadModule<T>(file: string): T {
		const code = read(file);
		const factory = vm.runInThisContext(`(function (module, window) {\n${code}\n})`, { filename: file }) as (moduleShim: { exports: unknown }, windowShim: Record<string, unknown>) => void;
		const moduleShim: { exports: unknown } = { exports: {} };
		factory(moduleShim, {});
		return moduleShim.exports as T;
	}
	interface QueryModel {
		parse(text: string): { model: unknown; diagnostics: unknown[] };
		build(model: unknown): string;
	}
	interface Address {
		statement: number;
		part: number;
	}
	interface Added {
		model: unknown;
		index: number;
		error?: string;
	}
	interface QueryEdit {
		addField(model: unknown, address: Address, expr: string): Added;
		partAt(model: unknown, address: Address): { fields: Array<{ expr: string }> };
	}
	const Q = loadModule<QueryModel>('dcs-editor-query-model.js');
	const QE = loadModule<{ create(api: QueryModel): QueryEdit }>('dcs-editor-query-edit.js').create(Q);
	const start = DIALOG.indexOf('\tfunction placeField(');
	const end = DIALOG.indexOf('\n\t}\n', start) + 4;
	assert.ok(start > 0 && end > start, 'placeField в конструкторе');
	const placeField = new Function('QE', DIALOG.slice(start, end) + '\nreturn placeField;')(QE) as (ctx: unknown, base: unknown, added: Added, at?: number) => Added;
	const text = [
		'ВЫБРАТЬ\n\tТ.Код КАК Код,\n\tТ.Ссылка КАК Ссылка,\n\tТ.Наименование КАК Наименование\nИЗ\n\tСправочник.Пользователи КАК Т',
		'ВЫБРАТЬ\n\tП.Код,\n\tNULL,\n\tП.Наименование\nИЗ\n\tСправочник.Пользователи КАК П',
	].join('\n\nОБЪЕДИНИТЬ ВСЕ\n\n');
	const parsed = Q.parse(text);
	assert.deepEqual(parsed.diagnostics, []);
	const model = parsed.model;
	const ctxOf = (address: Address) => ({ address: () => address });

	test('поле второй части, занявшее пустую (NULL) ячейку своей колонки, остаётся в ней, куда бы его ни бросили, — как «>»', () => {
		const address = { statement: 0, part: 1 };
		const plain = QE.addField(model, address, 'П.Ссылка');
		assert.equal(plain.index, 1, 'addField занял ячейку колонки «Ссылка», а не добавил колонку');
		assert.equal(QE.partAt(plain.model, address).fields.length, 3);
		for (const at of [0, 1, 2, 3]) {
			const placed = placeField(ctxOf(address), model, QE.addField(model, address, 'П.Ссылка'), at);
			assert.equal(Q.build(placed.model), Q.build(plain.model), `сброс на место ${at}: колонки первой части не сдвинуты`);
			assert.equal(placed.index, 1);
		}
	});

	test('новая колонка встаёт в место сброса во всех частях; без места — в конец, как «>»', () => {
		const second = { statement: 0, part: 1 };
		const placed = placeField(ctxOf(second), model, QE.addField(model, second, 'П.Родитель'), 0);
		assert.equal(placed.index, 0);
		assert.equal(QE.partAt(placed.model, second).fields[0].expr, 'П.Родитель');
		assert.equal(QE.partAt(placed.model, { statement: 0, part: 0 }).fields[0].expr, 'NULL', 'первая часть получила NULL на том же месте');
		const first = { statement: 0, part: 0 };
		const top = placeField(ctxOf(first), model, QE.addField(model, first, 'Т.Родитель'), 1);
		assert.deepEqual(
			QE.partAt(top.model, first).fields.map((field) => field.expr),
			['Т.Код', 'Т.Родитель', 'Т.Ссылка', 'Т.Наименование']
		);
		const end = QE.addField(model, first, 'Т.Родитель');
		assert.equal(placeField(ctxOf(first), model, end, undefined), end, 'без места — результат «>» как есть');
		assert.equal(placeField(ctxOf(first), model, end, end.index), end);
	});
});

describe('Перетаскивание: подключение (текст скриптов)', () => {
	test('Esc во время переноса отменяет перенос раньше, чем закрывает окно', () => {
		const handler = SCRIPT.slice(SCRIPT.indexOf("\tdocument.addEventListener('keydown', (event) => {"));
		const esc = handler.indexOf("if (event.key === 'Escape' && dragNow)");
		const close = handler.indexOf('cancelDialogLevel(dialogStack.top())');
		assert.ok(esc > 0 && close > esc, 'проверка переноса — первой в обработчике Esc окна');
		assert.ok(/if \(event\.key === 'Escape' && dragNow\) \{\n\t\t\tevent\.preventDefault\(\);\n\t\t\tfinishDrag\(false, true\);\n\t\t\treturn;/.test(handler));
	});

	test('ответы расширения во время переноса ждут его конца; перерисовка после фоновой записи — тоже', () => {
		assert.ok(SCRIPT.includes("window.addEventListener('message', (event) => whenIdle(() => onHostMessage(event)));"));
		assert.ok(/setTimeout\(\(\) => \{\n\t\t\t\twhenIdle\(\(\) => \{\n\t\t\t\t\trenderTabs\(\);\n\t\t\t\t\trenderContent\(\);/.test(SCRIPT), 'releasePointer ждёт конца переноса');
	});

	test('API редактора отдаёт перенос конструктору; ни aria-grabbed, ни aria-dropeffect (устарели)', () => {
		assert.ok(/drag: Object\.freeze\(\{\n\t\t\tzone: dragZone,\n\t\t\tindex: dropIndex,\n\t\t\}\),/.test(SCRIPT));
		for (const text of [SCRIPT, DIALOG]) {
			assert.ok(!/aria-grabbed|aria-dropeffect/.test(text));
		}
	});

	test('конструктор: у строки — только атрибут draggable, слушателей переноса у строк и списков нет', () => {
		assert.ok(!/addEventListener\('drag|addEventListener\('drop/.test(DIALOG), 'слушатели переноса — только у документа (dcs-editor.js)');
		assert.ok(DIALOG.includes("if (spec.drag && spec.drag(row.key)) {\n\t\t\t\t\titem.draggable = true;"), 'строка дерева — атрибут');
		assert.ok(DIALOG.includes('dragHandle(item.children[0]);'), 'строка сетки — ручка в первой ячейке');
	});

	test('вкладки схемы, «Настройки» и мастер: у строк — только атрибут, сброс зовёт те же действия, что кнопки', () => {
		const fn = (signature: string): string => {
			const start = SCRIPT.indexOf('\n\tfunction ' + signature);
			assert.ok(start >= 0, 'нет function ' + signature);
			return SCRIPT.slice(start, SCRIPT.indexOf('\n\t}\n', start) + 4);
		};
		// Каждая часть скрипта целиком, у ядра без раздела обвязки: модули закладок идут в общем тексте до ядра,
		// и срез общего текста от конца обвязки их бы не захватил
		for (const name of DCS_EDITOR_PARTS) {
			let part = readEditorPart(name);
			if (name === 'dcs-editor.js') {
				const start = part.indexOf(EVENTS_START);
				const end = part.indexOf(EVENTS_END, start);
				assert.ok(start >= 0 && end > start, 'нет раздела обвязки переноса в ' + name);
				part = part.slice(0, start) + part.slice(end);
			}
			assert.ok(!/addEventListener\('drag|addEventListener\('drop/.test(part), 'слушатели переноса есть вне обвязки документа: ' + name);
		}
		// Мастер: доступные → выбранные — addPaths с номером; перестановка — moveChosen; обратно — removeChosen; цели — transferGroup
		const wizard = fn('openSettingsWizard(ctx) {');
		assert.ok(wizard.includes("addPaths(step, [node.path], dropIndex(items.length, -1, wizardDropRow(target), target.place));"));
		assert.ok(wizard.includes('\t\t\t\t\t\tmoveChosen(step, to - from);'));
		assert.ok(wizard.includes("\t\t\t\t\tui.chosen[step] = Number(payload.key);\n\t\t\t\t\tremoveChosen(step, false);"));
		assert.ok(/function transferGroup\(from, index, to, at\) \{[\s\S]*?source\.splice\(index, 1\);[\s\S]*?list\.splice\(place, 0, item\);/.test(wizard), 'в другую цель переносится сам элемент — с типом группировки');
		assert.ok(wizard.includes("accept: (payload) => payload.kind !== 'pinned',"), 'папки и «Авто» конструктор не убирает');
		// «Настройки»: «>» и сброс — одна правка списка (addAt / insertAt), «Отбор» — то же окно условия
		const selection = fn('renderSelectionPanel(host, node, path, variantName) {');
		assert.ok(selection.includes("addAt(itemsDropSlot(items, parentPos, 'into'), fresh);"), '«>» и «Авто» — через ту же вставку, что сброс');
		assert.ok(selection.includes("add: (field, slot) => addAt(slot, { kind: 'field', field: field.path }),"));
		const order = fn('renderOrderPanel(host, node, path, variantName) {');
		assert.ok(order.includes("const append = (fresh) => insertAt(itemsDropSlot(items, null, 'end'), fresh);"));
		assert.ok(order.includes('if (sendItems(movedCopy(items, from[0], made.pos[0] - from[0]))) {'), 'перестановка — та же копия, что у ↑ ↓');
		const filter = fn('renderFilterPanel(host, node, path, variantName) {');
		assert.ok(filter.includes("add: (field, slot) => ctx.add('comparison', slot.parent.length > 0 ? slot.parent : null, { left: field.path }, slot.index),"));
		// Дерево структуры: та же правка, что «Переместить узел выше/ниже»
		assert.ok(fn('structureDropZone(tree, settings, variantName) {').includes('if (moveNode(variantName, source.path, to)) {'));
		// «Ресурсы»: сброс поля — то же, что «>» (ресурс Сумма(Поле) без окна), сброс ресурса — «<» (удаление с вопросом)
		const resources = fn('renderResources(host) {');
		assert.ok(resources.includes('addResourceFor(node);') && resources.includes("removeResource(index, '');"));
		assert.ok(/table\.pick\(payload\.key\);[\s\S]*?removeResource\(index, ''\);/.test(resources), 'ресурс сначала выбран, как перед «<»');
		assert.ok(resources.includes("place: 'zone',"), 'порядка ресурсов операция не знает: линии места нет');
		// Сброс строки на «Доступные поля» — сначала выбор строки, как перед Delete
		for (const signature of ['renderSelectionPanel(host, node, path, variantName) {', 'renderFilterPanel(host, node, path, variantName) {', 'renderOrderPanel(host, node, path, variantName) {']) {
			assert.ok(/onRemove: \(key\) => \{\n\t+const pos = JSON\.parse\(key\);\n\t+grid\.pick\(key\);\n\t+remove\(/.test(fn(signature)), signature);
		}
		// Мини-редактор условия оформления: перенос — та же правка копии, что ↑ ↓ (ctx.commit)
		const filterTable = fn('renderFilterTable(host, ctx) {');
		assert.ok(filterTable.includes('const made = itemsMove(ctx.items, posOf(payload.key), listDropSlot(ctx.items, posOf(spot.key), spot.place, isGroup));'));
		assert.ok(filterTable.includes("ctx.commit(made.items, { pos: made.pos, action: 'edit' });"));
		// Поле на дерево структуры — то же окно, что пиктограмма «Новая группировка…»
		assert.ok(fn('structureDropZone(tree, settings, variantName) {').includes('openAddGroupDialog(settings, variantName, place, field.path);'));
		// Мастер: кнопки «⇑» «⇓» — тот же transferGroup, что перенос в другую цель
		assert.ok(wizard.includes('transferGroup(from, ui.groupSel.index, to, wz.groupings[to].length);'));
	});

	test('подсветка без сдвига раскладки: тени внутрь, цвета темы, без размеров и отступов', () => {
		const rule = (selector: string) => {
			const start = CSS.indexOf('\n' + selector + ' {');
			assert.ok(start >= 0, `нет правила ${selector}`);
			return CSS.slice(start, CSS.indexOf('}', start));
		};
		for (const selector of ['.dcs-dnd-can', '.dcs-dnd-over', '.dcs-dnd-before', '.dcs-dnd-after']) {
			const body = rule(selector);
			assert.match(body, /box-shadow: inset/);
			assert.match(body, /var\(--vscode-focusBorder\)/);
			assert.ok(!/(?:^|\s)(?:margin|padding|border|width|height|outline)(?:-[a-z]+)?:/m.test(body.replace(/box-shadow:[^;]*;/, '')), `${selector} меняет раскладку`);
		}
		assert.match(rule('.dcs-dnd-can'), /inset 0 0 0 1px/);
		assert.match(rule('.dcs-dnd-over'), /inset 0 0 0 2px/, '«под указателем» отличается от «примет» и толщиной, не только цветом');
		assert.match(CSS, /\.dcs-dnd-into,[\s\S]*?var\(--vscode-list-dropBackground/);
		// Строки таблиц — ещё и у ячеек (тени самой строки таблицы рисуют не все движки); ручки — курсор «взять»
		assert.match(CSS, /\ntr\.dcs-dnd-before > td \{\n\tbox-shadow: inset 0 2px 0 0 var\(--vscode-focusBorder\);/);
		assert.match(CSS, /\ntr\.dcs-dnd-after > td \{\n\tbox-shadow: inset 0 -2px 0 0 var\(--vscode-focusBorder\);/);
		assert.match(CSS, /td\[draggable='true'\],\n\.dcs-wizard-row \.dcs-tree-label\[draggable='true'\] \{\n\tcursor: grab;/);
	});

	test('строка, которую тащили, выбирается щелчковым путём списка (spec.onSelect)', () => {
		assert.ok(DIALOG.includes('pick: spec.drag && spec.onSelect ? (key) => spec.onSelect(key, true) : undefined,'));
	});

	test('ответы расширения перерисовывают окна через rerenderSoon: отложенные переносом — одной перерисовкой', () => {
		const handler = SCRIPT.slice(SCRIPT.indexOf('\tfunction onHostMessage(event) {'), SCRIPT.indexOf('\t/** Ответ правки (saved)'));
		assert.equal(handler.split('rerenderSoon(qcRerender);').length - 1, 3, 'метаданные, таблицы, описания');
		assert.ok(handler.includes('rerenderSoon(typeRerender);'));
		assert.ok(!/\bqcRerender\(\);|\btypeRerender\(\);/.test(handler), 'прямых перерисовок окон в обработчике ответов нет');
		assert.ok(/function onDescribed\(\) \{[\s\S]*?rerenderSoon\(wizardRerender\);/.test(SCRIPT));
	});

	test('поле выражения: зона — его рамка (.dcs-hl-wrap с непрозрачным фоном), место сброса показывает каретка', () => {
		assert.ok(DIALOG.includes('DRAG.zone(editor.input.parentElement, {'), 'зона — обёртка текста, чей фон закрыл бы рамку внешней');
		assert.ok(/target: \(event\) => \(\{ key: null, place: 'end', offset: caretAtPoint\(editor\.input, event\.clientX, event\.clientY\) \}\),\n\t+preview: previewDrop,/.test(DIALOG));
		assert.ok(/function previewDrop\(x, y\) \{[\s\S]*?input\.focus\(\{ preventScroll: true \}\);[\s\S]*?input\.setSelectionRange\(offset, offset\);/.test(DIALOG), 'каретка в месте сброса, без прокрутки');
		const wrap = CSS.slice(CSS.indexOf('\n.dcs-hl-wrap {'), CSS.indexOf('}', CSS.indexOf('\n.dcs-hl-wrap {')));
		assert.match(wrap, /background: var\(--vscode-input-background\)/, 'фон обёртки — причина, по которой зона на ней');
		assert.match(CSS, /\.dcs-hl-wrap > textarea \{[^}]*background: transparent;/, 'текст прозрачен: рамка зоны под ним видна');
	});

	test('принудительные цвета (контрастный режим): рамки — контуром внутрь, линия места — псевдоэлементом, без сдвига раскладки', () => {
		const start = CSS.indexOf('@media (forced-colors: active) {');
		assert.ok(start > 0, 'нет правил для forced-colors');
		const block = CSS.slice(start, CSS.indexOf('\n}\n', start));
		assert.match(block, /\.dcs-dnd-can,\n\t\.dcs-dnd-over,\n\t\.dcs-dnd-into \{\n\t\toutline: 2px solid Highlight;\n\t\toutline-offset: -2px;/);
		assert.match(block, /\.dcs-dnd-can \{\n\t\toutline-style: dashed;/, '«примет» — пунктир, «под указателем» — сплошной');
		assert.match(
			block,
			/\.dcs-dnd-before:not\(tr\)::after,\n\t\.dcs-dnd-after:not\(tr\)::after,\n\ttr\.dcs-dnd-before > td::after,\n\ttr\.dcs-dnd-after > td::after,\n\ttr\.dcs-dnd-after > th::after \{[^}]*position: absolute;[^}]*height: 2px;[^}]*background: Highlight;[^}]*forced-color-adjust: none;/
		);
		// Опора линии: у ячеек таблиц зон — всегда (смена position перестраивала бы таблицу), без веса (:where) — закреплённая
		// шапка остаётся закреплённой; у самой строки таблицы второй линии нет
		assert.match(block, /:where\(\.dcs-dnd-before, \.dcs-dnd-after\):not\(tr\),\n\t:where\(\[data-dnd-zone\] tr > td, \[data-dnd-zone\] tr > th\) \{\n\t\tposition: relative;\n\t\}/);
		assert.ok(!/tr\.dcs-dnd-(?:before|after) > td \{[^}]*position/.test(block), 'position ячеек не меняется со сменой класса');
		assert.ok(!/box-shadow|margin|padding|border/.test(block), 'тени браузер снимет, отступы и рамки сдвинули бы раскладку');
		// Закреплённая шапка списков «Настроек» — над относительными ячейками строк
		assert.match(CSS, /\.dcs-setv-grid th \{\n\tposition: sticky;\n\ttop: 0;\n[^}]*z-index: 1;/);
		assert.match(CSS, /\ntr\.dcs-dnd-after > th \{\n\tbox-shadow: inset 0 -2px 0 0 var\(--vscode-focusBorder\);/);
	});
});

describe('Перетаскивание в конструкторе запроса исполняется: сброс — та же правка, что кнопка («Группировка», «Порядок», части объединения, пакет)', () => {
	function loadModule<T>(file: string): T {
		const code = read(file);
		const factory = vm.runInThisContext(`(function (module, window) {\n${code}\n})`, { filename: file }) as (moduleShim: { exports: unknown }, windowShim: Record<string, unknown>) => void;
		const moduleShim: { exports: unknown } = { exports: {} };
		factory(moduleShim, {});
		return moduleShim.exports as T;
	}
	interface QueryModel {
		parse(text: string): { model: unknown; diagnostics: unknown[] };
		build(model: unknown): string;
	}
	// Модуль правок — как есть: его функции и вызывает и кнопка, и сброс
	type Edit = any;
	const Q = loadModule<QueryModel>('dcs-editor-query-model.js');
	const QE = loadModule<{ create(api: QueryModel): Edit }>('dcs-editor-query-edit.js').create(Q);
	const R = rules();

	/** Функция конструктора верхнего уровня (отступ — один таб) по началу сигнатуры, с телом. */
	function dialogFn(signature: string): string {
		const start = DIALOG.indexOf('\n\tfunction ' + signature);
		assert.ok(start >= 0, `нет function ${signature}`);
		const end = DIALOG.indexOf('\n\t}\n', start);
		return DIALOG.slice(start, end + 4);
	}

	/** Узел-заглушка: вкладке нужно только складывать узлы друг в друга. */
	class Stub {
		children: Stub[] = [];
		className = '';
		textContent = '';
		title = '';
		appendChild(child: Stub): Stub {
			this.children.push(child);
			return child;
		}
		setAttribute(): void {
			return undefined;
		}
		get classList(): { add(): void } {
			return { add: () => undefined };
		}
	}

	interface DropSpec {
		drop: { from: Record<string, (payload: { zone: string; key: string; kind: string }, target: { key: string | null; place: string }) => unknown> };
	}

	/**
	 * Вкладка как есть: её функция и помощники конструктора (toGroups, partOperation…) с настоящими моделью и правками;
	 * списки, кнопки и ячейки — заглушки, которые запоминают описания списков (spec.drop) и обработчики кнопок по названию.
	 */
	function renderTab(render: string, helpers: string[], ctx: ReturnType<typeof contextOf>) {
		const specs = new Map<string, DropSpec>();
		const buttons = new Map<string, () => void>();
		const stubs: Record<string, unknown> = {
			el: () => new Stub(),
			column: (host: Stub) => host.appendChild(new Stub()),
			moves: (_host: Stub, items: Array<{ title: string; onClick: () => void }>) => items.forEach((item) => buttons.set(item.title, item.onClick)),
			iconButton: (_icon: string, name: string, onClick: () => void) => {
				buttons.set(name, onClick);
				return new Stub();
			},
			treeView: (_host: Stub, spec: DropSpec & { id: string }) => specs.set(spec.id, spec),
			gridView: (_host: Stub, spec: DropSpec & { id: string }) => specs.set(spec.id, spec),
			gridSelect: () => new Stub(),
			gridCheck: () => new Stub(),
			cellInput: () => new Stub(),
			aliasCell: (_ctx: unknown, _column: unknown, input: Stub) => input,
			dragGrip: () => new Stub(),
			dragHandle: () => undefined,
			hint: (node: Stub) => node,
			flag: () => ({ wrap: new Stub() }),
			warningsPlate: () => undefined,
			choose: () => undefined,
			flipExpanded: () => undefined,
			selectPart: () => undefined,
			selectStatement: () => undefined,
			sourceFieldRows: () => ({ rows: [], info: new Map() }),
			oneLine: (value: string) => String(value || '').replace(/\s+/g, ' ').trim(),
			upper: (value: string) => String(value || '').toUpperCase(),
			// Тип выражения неизвестен: предупреждения о типах группировки здесь не проверяются
			api: { partExpressionType: () => ({ type: null, loading: false }) },
			FT: null,
			DRAG: { index: R.dropIndex },
			Q,
			QE,
		};
		const name = render.slice(0, render.indexOf('('));
		const code = helpers.map(dialogFn).join('') + dialogFn(render) + '\nreturn ' + name + ';';
		const fn = new Function(...Object.keys(stubs), code)(...Object.values(stubs)) as (container: Stub, ctx: unknown) => void;
		fn(new Stub(), ctx);
		return { specs, buttons };
	}

	/** Контекст окна как у конструктора: модель, адрес, правка (commit — '' или ошибка), заметки. */
	function contextOf(text: string, statement = 0, part = 0) {
		const parsed = Q.parse(text);
		assert.deepEqual(parsed.diagnostics, [], 'текст не разобран');
		const notes: string[] = [];
		const state = {
			model: parsed.model,
			statement,
			part,
			focus: '',
			outerTemp: [],
			stash: new Map(),
			pendingLinks: [] as unknown[],
			notes: [] as string[],
			tables: { selected: '', expanded: new Set() },
			fields: { selected: -1 },
			links: { selected: '', custom: new Set() },
			grouping: { selected: '', expanded: new Set(), collapsed: new Set(), groupSel: -1, sumSel: -1 },
			conditions: { selected: '', field: '', custom: new Set() },
			index: { selected: 0, avail: '', field: -1 },
			union: { column: -1 },
			order: { selected: '', expanded: new Set(), row: -1 },
			composition: { table: '', avail: '', field: -1, where: -1, whereField: '' },
		};
		const ctx = {
			state,
			notes,
			address: () => ({ statement: state.statement, part: state.part }),
			statement: () => (state.model as { statements: unknown[] }).statements[state.statement],
			part: () => QE.partAt(state.model, ctx.address()),
			commit: (result: { model?: unknown; error?: string } | null) => {
				if (!result || result.error) {
					notes.push(result ? String(result.error) : 'Правка не выполнена.');
					return result ? result.error : 'Правка не выполнена.';
				}
				state.model = result.model;
				return '';
			},
			note: (value: string) => notes.push(value),
			rerender: () => undefined,
			keys: {},
		};
		return ctx;
	}

	const GROUPING = ['groupingTreeRows(ctx, grouping) {', 'groupingExprOf(item) {', 'toGroups(ctx, item) {', 'partTyping(ctx, batch) {', 'freshGroupWarnings(ctx, model) {', 'commitSummed(ctx, result) {', 'toSums(ctx, item) {', 'sameExpr(left, right) {', 'groupToSums(ctx, groupIndex) {', 'sumToGroups(ctx, fieldIndex) {', 'allByType(ctx, target, apply) {', 'skippedNote(part, found, target) {', 'allToGroups(ctx) {', 'allToSums(ctx) {'];
	const SALES = 'ВЫБРАТЬ\n\tТ.Склад КАК Склад,\n\tТ.Номенклатура КАК Номенклатура,\n\tТ.Количество КАК Количество\nИЗ\n\tРегистрНакопления.ТоварыНаСкладах КАК Т';

	/** Одно и то же действие кнопкой и сбросом на свежих контекстах: текст запроса после них один. */
	function same(label: string, text: string, setup: ((ctx: ReturnType<typeof contextOf>) => void) | null, button: (tab: ReturnType<typeof renderTab>, ctx: ReturnType<typeof contextOf>) => void, drop: (tab: ReturnType<typeof renderTab>) => unknown, render = 'renderGroupingTab(container, ctx) {', helpers = GROUPING): string {
		const byButton = contextOf(text);
		const byDrop = contextOf(text);
		for (const ctx of [byButton, byDrop]) {
			if (setup) {
				setup(ctx);
			}
		}
		const before = Q.build(byDrop.state.model);
		button(renderTab(render, helpers, byButton), byButton);
		assert.notEqual(drop(renderTab(render, helpers, byDrop)), false, label + ': сброс отказал');
		const after = Q.build(byDrop.state.model);
		assert.notEqual(after, before, label + ': сброс ничего не сделал');
		assert.equal(after, Q.build(byButton.state.model), label + ': сброс и кнопка дали разный текст');
		assert.deepEqual(byDrop.notes, byButton.notes, label + ': заметки разные');
		return after;
	}

	const field = (key: string) => ({ zone: 'gtree', key, kind: 'select' });

	test('«Группировка»: поле — в групповые и в суммируемые (как «>»), из списков обратно в дерево (как «<») и между списками', () => {
		const grouped = (ctx: ReturnType<typeof contextOf>) => {
			ctx.state.model = QE.addGroupField(ctx.state.model, ctx.address(), 'Т.Склад').model;
		};
		const summed = (ctx: ReturnType<typeof contextOf>) => {
			ctx.state.model = QE.setFieldAggregate(ctx.state.model, ctx.address(), 2, 'sum').model;
		};
		same(
			'поле → групповые',
			SALES,
			null,
			(tab, ctx) => {
				ctx.state.grouping.selected = 'q:0';
				tab.buttons.get('Добавить выбранное поле в групповые')?.();
			},
			(tab) => tab.specs.get('groups')?.drop.from.gtree(field('q:0'), { key: null, place: 'zone' })
		);
		const sums = same(
			'поле → суммируемые',
			SALES,
			null,
			(tab, ctx) => {
				ctx.state.grouping.selected = 'q:2';
				tab.buttons.get('Добавить выбранное поле в суммируемые (функция Сумма)')?.();
			},
			(tab) => tab.specs.get('sums')?.drop.from.gtree(field('q:2'), { key: null, place: 'zone' })
		);
		assert.match(sums, /СУММА\(Т\.Количество\)/i);
		same(
			'групповое → дерево',
			SALES,
			grouped,
			(tab, ctx) => {
				ctx.state.grouping.groupSel = 0;
				tab.buttons.get('Убрать выбранное групповое поле')?.();
			},
			(tab) => tab.specs.get('gtree')?.drop.from.groups({ zone: 'groups', key: '0', kind: 'group' }, { key: null, place: 'zone' })
		);
		same(
			'суммируемое → дерево',
			SALES,
			summed,
			(tab, ctx) => {
				ctx.state.grouping.sumSel = 2;
				tab.buttons.get('Снять агрегатную функцию с выбранного суммируемого поля')?.();
			},
			(tab) => tab.specs.get('gtree')?.drop.from.sums({ zone: 'sums', key: '2', kind: 'sum' }, { key: null, place: 'zone' })
		);
		// Между списками одной кнопки нет — цепочка двух: «<» одного списка и «>» другого
		same(
			'суммируемое → групповые',
			SALES,
			summed,
			(_tab, ctx) => {
				ctx.state.model = QE.setFieldAggregate(ctx.state.model, ctx.address(), 2, null).model;
				ctx.state.model = QE.addGroupField(ctx.state.model, ctx.address(), 'Т.Количество').model;
			},
			(tab) => tab.specs.get('groups')?.drop.from.sums({ zone: 'sums', key: '2', kind: 'sum' }, { key: null, place: 'zone' })
		);
		same(
			'групповое → суммируемые',
			SALES,
			grouped,
			(_tab, ctx) => {
				const added = QE.addSummedField(ctx.state.model, ctx.address(), 'Т.Склад', 'sum').model;
				const left = QE.groupingOf(QE.partAt(added, ctx.address())).groups.findIndex((group: { text: string }) => group.text === 'Т.Склад');
				ctx.state.model = left >= 0 ? QE.removeGroupField(added, ctx.address(), left).model : added;
			},
			(tab) => tab.specs.get('sums')?.drop.from.groups({ zone: 'groups', key: '0', kind: 'group' }, { key: null, place: 'zone' })
		);
	});

	const ORDER = ['dropRow(target) {', 'dropAt(count, target) {', 'dropDelta(ctx, list, count, from, target) {'];

	test('«Порядок»: колонка — в место сброса (как «>» и сдвиг), строка — на место (как ↑ ↓ несколько раз), обратно в дерево — как «<»', () => {
		const ordered = (ctx: ReturnType<typeof contextOf>) => {
			for (const name of ['Склад', 'Номенклатура', 'Количество']) {
				ctx.state.model = QE.addOrder(ctx.state.model, 0, name, 'asc').model;
			}
		};
		const render = 'renderOrderTab(container, ctx) {';
		const moved = same(
			'строка порядка: первая — под третью',
			SALES,
			ordered,
			(tab, ctx) => {
				ctx.state.order.row = 0;
				tab.buttons.get('Переместить поле порядка ниже')?.();
				const again = renderTab(render, ORDER, ctx);
				again.buttons.get('Переместить поле порядка ниже')?.();
			},
			(tab) => tab.specs.get('order')?.drop.from.order({ zone: 'order', key: '0', kind: 'order' }, { key: '2', place: 'after' }),
			render,
			ORDER
		);
		assert.match(moved, /УПОРЯДОЧИТЬ ПО\s+Номенклатура,\s+Количество,\s+Склад/);
		same(
			'колонка — первой в порядок',
			SALES,
			(ctx) => {
				ctx.state.model = QE.addOrder(ctx.state.model, 0, 'Склад', 'asc').model;
			},
			(_tab, ctx) => {
				const added = QE.addOrder(ctx.state.model, 0, 'Количество', 'asc');
				ctx.state.model = QE.moveOrder(added.model, 0, added.index, -added.index).model;
			},
			(tab) => tab.specs.get('order')?.drop.from.otree({ zone: 'otree', key: 'oq:КОЛИЧЕСТВО', kind: 'column' }, { key: '0', place: 'before' }),
			render,
			ORDER
		);
		same(
			'строка порядка → дерево',
			SALES,
			ordered,
			(tab, ctx) => {
				ctx.state.order.row = 1;
				tab.buttons.get('Убрать выбранное поле из порядка')?.();
			},
			(tab) => tab.specs.get('otree')?.drop.from.order({ zone: 'order', key: '1', kind: 'order' }, { key: null, place: 'zone' }),
			render,
			ORDER
		);
	});

	const UNION = ['dropRow(target) {', 'dropDelta(ctx, list, count, from, target) {', 'partOperation(ctx, result) {', 'resetSelection(state) {'];
	const BATCH = ['dropRow(target) {', 'dropDelta(ctx, list, count, from, target) {', 'batchOperation(ctx, result) {', 'resetSelection(state) {'];

	test('части объединения и запросы пакета: перенос на место — та же правка, что ↑ ↓ (QE.movePart, QE.moveStatement)', () => {
		const parts = ['ВЫБРАТЬ 1 КАК А', 'ВЫБРАТЬ 2', 'ВЫБРАТЬ 3'].join('\nОБЪЕДИНИТЬ ВСЕ\n');
		const union = same(
			'первая часть — на третье место',
			parts,
			null,
			(tab, ctx) => {
				tab.buttons.get('Переместить часть ниже')?.();
				renderTab('renderUnionTab(container, ctx) {', UNION, ctx).buttons.get('Переместить часть ниже')?.();
			},
			(tab) => tab.specs.get('parts')?.drop.from.parts({ zone: 'parts', key: '0', kind: 'part' }, { key: '2', place: 'after' }),
			'renderUnionTab(container, ctx) {',
			UNION
		);
		assert.deepEqual(
			union.split(/ОБЪЕДИНИТЬ ВСЕ/).map((part) => /ВЫБРАТЬ\s+(\d)/.exec(part)?.[1]),
			['2', '3', '1'],
			'первая часть не встала третьей: ' + union
		);
		const batch = 'ВЫБРАТЬ 1 КАК А ПОМЕСТИТЬ ВТ1;\nВЫБРАТЬ 2 КАК Б ПОМЕСТИТЬ ВТ2;\nВЫБРАТЬ 3 КАК В';
		const moved = same(
			'последний запрос — первым',
			batch,
			(ctx) => {
				ctx.state.statement = 2;
			},
			(tab, ctx) => {
				tab.buttons.get('Переместить запрос пакета выше')?.();
				renderTab('renderBatchTab(container, ctx) {', BATCH, ctx).buttons.get('Переместить запрос пакета выше')?.();
			},
			(tab) => tab.specs.get('batch')?.drop.from.batch({ zone: 'batch', key: '2', kind: 'statement' }, { key: '0', place: 'before' }),
			'renderBatchTab(container, ctx) {',
			BATCH
		);
		assert.match(moved, /^ВЫБРАТЬ\s+3 КАК В/);
		// Сброс на своё место правки не делает
		const ctx = contextOf(parts);
		const tab = renderTab('renderUnionTab(container, ctx) {', UNION, ctx);
		const text = Q.build(ctx.state.model);
		assert.equal(tab.specs.get('parts')?.drop.from.parts({ zone: 'parts', key: '1', kind: 'part' }, { key: '1', place: 'before' }), false);
		assert.equal(Q.build(ctx.state.model), text);
	});
});
