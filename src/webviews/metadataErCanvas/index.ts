/**
 * Webview-canvas ER-диаграммы.
 *
 * Архитектура:
 * - Панель открывается мгновенно с пустым состоянием.
 * - Host загружает граф в фоне и присылает `graphReady`.
 * - Подграф под текущий scope считает host; webview только рендерит его
 *   и управляет интерактивом (клик, drill-down, фильтры, экспорт).
 * - Layout: ELK для ≤ 50 узлов, cose для больших. Пользователь может сменить.
 *
 * @module webviews/metadataErCanvas/index
 */

import cytoscape from 'cytoscape';
import elk from 'cytoscape-elk';
import type { Core, EdgeSingular, ElementDefinition, EventObject, NodeSingular } from 'cytoscape';
import type {
	ErExportFormat,
	ErEdge,
	ErScope,
	ErSubgraph,
} from '../../features/metadata/er/erTypes';
import { exportFromWebview } from './exporters';
import { computeNodeLabel, nodeIdToKey, toCytoscapeElements } from './graphAdapter';
import type { NodeLabelOptions } from './graphAdapter';
import type {
	ErCatalogEntry,
	HostToWebviewMessage,
	WebviewToHostMessage,
} from './messages';
import { groupRelationKinds, humanVia, relationLabel, RELATION_SORT_ORDER } from './relationLabels';
import { buildCytoscapeStyle } from './style';

cytoscape.use(elk);

interface VsCodeApi {
	postMessage(message: WebviewToHostMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface InitPayload {
	readonly subgraph: ErSubgraph;
	readonly scope: ErScope;
	readonly truncated: boolean;
	readonly fullNodeCount: number;
	readonly availableObjectTypes: readonly string[];
	readonly availableRelationKinds: readonly string[];
	readonly catalog: readonly ErCatalogEntry[];
	readonly availableFormats: readonly ErExportFormat[];
	readonly defaultFormat: ErExportFormat;
}

interface State {
	scope: ErScope;
	subgraph: ErSubgraph;
	truncated: boolean;
	fullNodeCount: number;
	availableObjectTypes: readonly string[];
	availableRelationKinds: readonly string[];
	catalog: readonly ErCatalogEntry[];
	graphReady: boolean;
	cy: Core | undefined;
	availableFormats: readonly ErExportFormat[];
	currentFormat: ErExportFormat;
	currentLayout: 'cose' | 'elk' | 'breadthfirst';
	/** true — пользователь явно выбрал раскладку; false — применяем авто-выбор один раз */
	layoutSetByUser: boolean;
	/** Последние известные счётчики рёбер по виду связи; сохраняются при снятии фильтров. */
	edgeCountByKind: Map<string, number>;
	/** Параметры отображения меток узлов. */
	nodeLabelOptions: NodeLabelOptions;
}

const vscode = acquireVsCodeApi();

const state: State = {
	scope: { kind: 'selection', label: '', seeds: [], hops: 0, objectTypes: [], relationKinds: null },
	subgraph: { nodes: [], edges: [] },
	truncated: false,
	fullNodeCount: 0,
	availableObjectTypes: [],
	availableRelationKinds: [],
	catalog: [],
	graphReady: false,
	cy: undefined,
	availableFormats: ['mermaid', 'svg', 'png', 'drawio'],
	currentFormat: 'mermaid',
	currentLayout: 'elk',
	layoutSetByUser: false,
	edgeCountByKind: new Map(),
	nodeLabelOptions: { showType: false, showName: true, showSynonym: false },
};

// ── Утилиты ──────────────────────────────────────────────────────────────────

function postLog(level: 'info' | 'warn' | 'error', message: string): void {
	vscode.postMessage({ type: 'log', payload: { level, message } });
}

function setStatus(text: string): void {
	const el = document.querySelector<HTMLSpanElement>('#er-status');
	if (el) {
		el.textContent = text;
	}
}

function setLoading(active: boolean): void {
	const el = document.querySelector<HTMLElement>('#er-loading');
	if (el) {
		el.hidden = !active;
	}
}

function updateCounts(): void {
	const el = document.querySelector<HTMLSpanElement>('#er-counts');
	if (!el) {
		return;
	}
	if (!state.graphReady) {
		el.textContent = '';
		return;
	}
	const n = state.subgraph.nodes.length;
	const e = state.subgraph.edges.length;
	if (state.truncated) {
		el.textContent = `${n} объектов, ${e} связей (усечено из ${state.fullNodeCount})`;
	} else {
		el.textContent = `${n} объектов, ${e} связей`;
	}
}

function humanScopeLabel(scope: ErScope): string {
	if (scope.kind === 'object') {
		return `объект: ${scope.label}`;
	}
	if (scope.kind === 'subsystem') {
		return `подсистема: ${scope.label}`;
	}
	if (scope.kind === 'selection') {
		return scope.seeds.length === 0 ? 'конструктор: пусто' : `конструктор: ${scope.seeds.length} объектов`;
	}
	return 'весь граф';
}

function refreshScopeLabel(): void {
	const el = document.querySelector<HTMLSpanElement>('#er-scope-label');
	if (el) {
		el.textContent = humanScopeLabel(state.scope);
	}
}

function refreshHopsButtons(): void {
	const hops = state.scope.hops > 0 ? 1 : 0;
	document.querySelectorAll<HTMLButtonElement>('.er-hops-btn').forEach((btn) => {
		const val = Number(btn.dataset['hops'] ?? -1);
		btn.classList.toggle('er-hops-btn--active', val === hops);
	});
}

// ── Фильтры ───────────────────────────────────────────────────────────────────

function refreshFilters(): void {
	refreshHopsButtons();
	const formatSelect = document.querySelector<HTMLSelectElement>('#er-format');
	if (formatSelect) {
		formatSelect.innerHTML = '';
		for (const format of state.availableFormats) {
			const opt = document.createElement('option');
			opt.value = format;
			opt.textContent = format.toUpperCase();
			opt.selected = format === state.currentFormat;
			formatSelect.append(opt);
		}
	}
	// Контролы конструктора — только в selection-режиме
	rebuildRelationCheckboxes();
	refreshChips();
}

// ── Фильтр видов связей: чекбоксы ────────────────────────────────────────────

const COUNT_CAP = 1000;

function edgeCountLabel(n: number | undefined): string {
	if (n === undefined || n === 0) { return ''; }
	return n > COUNT_CAP ? `${COUNT_CAP}+` : String(n);
}

/**
 * Обновляет `state.edgeCountByKind` по новому подграфу.
 * При `reset = true` (открытие новой диаграммы) очищает старые счётчики целиком.
 * При `reset = false` (смена фильтра) обновляет только виды, присутствующие в ответе,
 * оставляя счётчики отключённых видов нетронутыми.
 */
function updateEdgeCounts(edges: readonly ErEdge[], reset: boolean): void {
	if (reset) {
		state.edgeCountByKind.clear();
	}
	const fresh = new Map<string, number>();
	for (const edge of edges) {
		fresh.set(edge.kind, (fresh.get(edge.kind) ?? 0) + 1);
	}
	for (const [kind, count] of fresh) {
		state.edgeCountByKind.set(kind, count);
	}
}

function rebuildRelationCheckboxes(): void {
	const container = document.querySelector<HTMLDivElement>('#er-relation-checkboxes');
	if (!container) {
		return;
	}
	// Строим один раз при первом рендере — набор всегда фиксированный (все известные виды)
	if (container.childElementCount === 0) {
		for (const item of groupRelationKinds(RELATION_SORT_ORDER)) {
			if (item.type === 'header') {
				const header = document.createElement('div');
				header.className = 'er-filter-group-header';
				header.textContent = item.label;
				container.append(header);
				continue;
			}
			const { kind } = item;
			const label = document.createElement('label');
			label.className = 'er-filter-item';
			const cb = document.createElement('input');
			cb.type = 'checkbox';
			cb.name = 'er-relation';
			cb.value = kind;
			cb.addEventListener('change', onRelationCheckboxChange);
			const text = document.createElement('span');
			text.className = 'er-filter-item-text';
			text.textContent = relationLabel(kind);
			text.title = kind;
			const count = document.createElement('span');
			count.className = 'er-filter-count';
			label.append(cb, text, count);
			container.append(label);
		}
	}
	// Обновляем состояния чекбоксов
	const enabledSet = state.scope.relationKinds === null
		? null
		: new Set(state.scope.relationKinds);
	for (const cb of Array.from(container.querySelectorAll<HTMLInputElement>('input[name="er-relation"]'))) {
		cb.checked = enabledSet === null || enabledSet.has(cb.value);
	}
	// Обновляем счётчики рёбер по виду связи
	for (const countEl of Array.from(container.querySelectorAll<HTMLSpanElement>('.er-filter-count'))) {
		const cb = countEl.closest('label')?.querySelector<HTMLInputElement>('input[name="er-relation"]');
		if (!cb) { continue; }
		const n = state.edgeCountByKind.get(cb.value);
		countEl.textContent = edgeCountLabel(n);
	}
	updateRelationFilterHint();
}

function readRelationCheckboxes(): readonly string[] | null {
	const checkboxes = Array.from(
		document.querySelectorAll<HTMLInputElement>('input[name="er-relation"]')
	);
	// Нет чекбоксов в DOM = фильтр ещё не отрисован, не меняем state
	if (checkboxes.length === 0) {
		return state.scope.relationKinds;
	}
	const checkedKinds = checkboxes.filter((cb) => cb.checked).map((cb) => cb.value);
	// Все включены = null (без фильтра)
	if (checkedKinds.length === checkboxes.length) {
		return null;
	}
	// Часть или ни одного — возвращаем ровно то, что выбрано ([] = скрыть все)
	return checkedKinds;
}

function updateRelationFilterHint(): void {
	const hint = document.querySelector<HTMLSpanElement>('#er-filter-hint');
	if (!hint) {
		return;
	}
	const checkboxes = Array.from(
		document.querySelectorAll<HTMLInputElement>('input[name="er-relation"]')
	);
	const checked = checkboxes.filter((cb) => cb.checked).length;
	const total = checkboxes.length;
	if (total === 0 || checked === total) {
		hint.textContent = '';
	} else {
		hint.textContent = `(${checked} из ${total})`;
	}
}

function onRelationCheckboxChange(): void {
	applyFiltersFromUi();
}

// ── Чипсы выбранных объектов ──────────────────────────────────────────────────

function refreshChips(): void {
	const row = document.querySelector<HTMLDivElement>('#er-chips-row');
	const chips = document.querySelector<HTMLDivElement>('#er-chips');
	if (!row || !chips) {
		return;
	}
	const visible = state.scope.kind === 'selection' && state.scope.seeds.length > 0;
	row.hidden = !visible;
	chips.innerHTML = '';
	if (!visible) {
		return;
	}
	const catalogByKey = new Map(state.catalog.map((c) => [c.key, c]));
	for (const seedKey of state.scope.seeds) {
		const entry = catalogByKey.get(seedKey);
		const chip = document.createElement('span');
		chip.className = 'er-chip';
		chip.title = entry?.synonymRu ? entry.synonymRu : seedKey;
		const text = document.createElement('span');
		text.className = 'er-chip-text';
		text.textContent = seedKey;
		const remove = document.createElement('button');
		remove.type = 'button';
		remove.className = 'er-chip-remove';
		remove.textContent = '×';
		remove.title = 'Убрать объект со схемы';
		remove.addEventListener('click', (e) => {
			e.stopPropagation();
			removeSeed(seedKey);
		});
		chip.append(text, remove);
		chips.append(chip);
	}
}

function removeSeed(seedKey: string): void {
	if (state.scope.kind !== 'selection') {
		return;
	}
	requestScope({ ...state.scope, seeds: state.scope.seeds.filter((k) => k !== seedKey) });
}

function addSeed(seedKey: string): void {
	if (state.scope.seeds.includes(seedKey)) {
		return;
	}
	// При добавлении объекта из любого режима — переходим в конструктор (selection)
	const currentSeeds = state.scope.kind === 'selection' ? state.scope.seeds : [];
	requestScope({
		...state.scope,
		kind: 'selection',
		hops: state.scope.kind === 'selection' ? state.scope.hops : 0,
		seeds: [...currentSeeds, seedKey],
	});
}

// ── Layout ────────────────────────────────────────────────────────────────────

function chooseAutoLayout(elementCount: number): State['currentLayout'] {
	// ELK даёт красивый иерархический граф для небольших диаграмм
	return elementCount <= 50 ? 'elk' : 'cose';
}

function buildLayout(name: State['currentLayout'], elementCount: number): cytoscape.LayoutOptions {
	if (name === 'breadthfirst') {
		return {
			name: 'breadthfirst',
			fit: true,
			padding: 40,
			directed: true,
			spacingFactor: 1.4,
			animate: false,
		};
	}
	if (name === 'elk') {
		const opts = {
			name: 'elk',
			nodeDimensionsIncludeLabels: true,
			fit: true,
			padding: 40,
			elk: {
				'algorithm': 'layered',
				'elk.direction': 'RIGHT',
				'elk.spacing.nodeNode': elementCount > 100 ? 24 : 40,
				'elk.layered.spacing.nodeNodeBetweenLayers': elementCount > 100 ? 40 : 80,
				'elk.edgeRouting': 'POLYLINE',
				'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
			},
		};
		return opts as unknown as cytoscape.LayoutOptions;
	}
	// cose — быстрый force-directed
	return {
		name: 'cose',
		fit: true,
		padding: 40,
		animate: false,
		nodeDimensionsIncludeLabels: true,
		idealEdgeLength: () => 140,
		nodeRepulsion: () => 10000,
		gravity: 0.4,
	} as cytoscape.LayoutOptions;
}

// ── Empty / Loading state ─────────────────────────────────────────────────────

function showEmptyState(message: string): void {
	const empty = document.querySelector<HTMLDivElement>('#er-empty');
	const canvas = document.querySelector<HTMLDivElement>('#er-canvas');
	if (empty) {
		empty.hidden = false;
		empty.textContent = message;
	}
	if (canvas) {
		canvas.style.opacity = '0';
	}
}

function hideEmptyState(): void {
	const empty = document.querySelector<HTMLDivElement>('#er-empty');
	const canvas = document.querySelector<HTMLDivElement>('#er-canvas');
	if (empty) {
		empty.hidden = true;
	}
	if (canvas) {
		canvas.style.opacity = '1';
	}
}

// ── Построение канваса ────────────────────────────────────────────────────────

function showViaForScope(scope: ErScope): boolean {
	return scope.kind === 'object' || scope.kind === 'selection';
}

function applySeedClasses(cy: Core, seeds: readonly string[]): void {
	for (const key of seeds) {
		cy.getElementById(`n:${key}`).addClass('seed');
	}
}

/** Обновляет метки узлов в Cytoscape без полной перестройки графа. */
function updateNodeLabels(): void {
	if (!state.cy) {
		return;
	}
	for (const node of state.subgraph.nodes) {
		state.cy.getElementById(`n:${node.key}`).data('label', computeNodeLabel(node, state.nodeLabelOptions));
	}
}

/** Обновляет текст кнопки дропдауна меток, отражая активные опции. */
function updateLabelPickerButton(): void {
	const btn = document.querySelector<HTMLButtonElement>('#er-label-picker-btn');
	if (!btn) {
		return;
	}
	const opts = state.nodeLabelOptions;
	const parts: string[] = [];
	if (opts.showType) {
		parts.push('Тип');
	}
	if (opts.showName) {
		parts.push('Имя');
	}
	if (opts.showSynonym) {
		parts.push('Синоним');
	}
	btn.textContent = `${parts.length > 0 ? parts.join('+') : '—'} ▾`;
}

function rebuildCanvas(): void {
	const subgraph = state.subgraph;
	if (!state.graphReady) {
		showEmptyState('Загрузка метаданных…');
		updateCounts();
		return;
	}
	if (state.scope.kind === 'selection' && state.scope.seeds.length === 0) {
		if (state.cy) {
			state.cy.elements().remove();
		}
		showEmptyState('Добавьте объекты через строку поиска, чтобы построить схему связей.');
		updateCounts();
		return;
	}
	if (subgraph.nodes.length === 0) {
		if (state.cy) {
			state.cy.elements().remove();
		}
		showEmptyState(
			state.truncated
				? `Слишком много объектов (${state.fullNodeCount}). Сузьте выборку или уберите типы связей.`
				: 'По текущим параметрам нет объектов для отображения.'
		);
		updateCounts();
		return;
	}

	hideEmptyState();
	const elements: ElementDefinition[] = toCytoscapeElements(subgraph, {
		showVia: showViaForScope(state.scope),
		nodeLabelOptions: state.nodeLabelOptions,
	});

	// Авто-выбор раскладки только один раз при первом показе, если пользователь не менял
	if (!state.layoutSetByUser) {
		state.currentLayout = chooseAutoLayout(elements.length);
		syncLayoutSelector();
	}

	const seeds = state.scope.kind === 'selection' ? state.scope.seeds : [];

	if (state.cy) {
		state.cy.startBatch();
		state.cy.elements().remove();
		state.cy.add(elements);
		applySeedClasses(state.cy, seeds);
		state.cy.endBatch();
		state.cy.layout(buildLayout(state.currentLayout, elements.length)).run();
	} else {
		state.cy = cytoscape({
			container: document.querySelector<HTMLDivElement>('#er-canvas'),
			elements,
			style: buildCytoscapeStyle(),
			layout: buildLayout(state.currentLayout, elements.length),
			wheelSensitivity: 1.5,
			minZoom: 0.05,
			maxZoom: 6,
		});
		applySeedClasses(state.cy, seeds);
		bindCanvasEvents(state.cy);
	}
	updateCounts();
}

function syncLayoutSelector(): void {
	const sel = document.querySelector<HTMLSelectElement>('#er-layout');
	if (sel) {
		sel.value = state.currentLayout;
	}
}

// ── Обработчики событий канваса ───────────────────────────────────────────────

function bindCanvasEvents(cy: Core): void {
	cy.on('tap', 'node', (event: EventObject) => {
		const node = event.target as NodeSingular;
		highlightNeighbourhood(cy, node);
		showNodePanel(node);
	});
	cy.on('tap', 'edge', (event: EventObject) => {
		const edge = event.target as EdgeSingular;
		showEdgePanel(edge);
	});
	cy.on('dbltap', 'node', (event: EventObject) => {
		const node = event.target as NodeSingular;
		const key = nodeIdToKey(node.id());
		drillDownToObject(key);
	});
	cy.on('tap', (event: EventObject) => {
		if (event.target === cy) {
			cy.elements().removeClass('dimmed').removeClass('highlighted');
			hideSidePanel();
		}
	});
}

function highlightNeighbourhood(cy: Core, node: NodeSingular): void {
	const neigh = node.closedNeighborhood();
	cy.elements().addClass('dimmed').removeClass('highlighted');
	neigh.removeClass('dimmed').addClass('highlighted');
}

// ── Боковая панель: узел ──────────────────────────────────────────────────────

function showNodePanel(node: NodeSingular): void {
	const side = document.querySelector<HTMLElement>('#er-side');
	if (!side) {
		return;
	}
	const key = nodeIdToKey(node.id());
	const erNode = state.subgraph.nodes.find((n) => n.key === key);
	if (!erNode) {
		return;
	}
	side.hidden = false;

	setText('#er-side-title', erNode.synonymRu || erNode.name);
	setText('#er-side-type', erNode.objectType);
	setText('#er-side-name', erNode.name);
	setText('#er-side-synonym', erNode.synonymRu || '—');
	setText('#er-side-source', erNode.sourceId);
	setText('#er-side-path', erNode.relativePath || '—');

	const incoming = state.subgraph.edges.filter((e) => e.targetKey === key);
	const outgoing = state.subgraph.edges.filter((e) => e.sourceKey === key);
	renderEdgeList('#er-side-out', outgoing, 'targetKey');
	renderEdgeList('#er-side-in', incoming, 'sourceKey');

	const openBtn = document.querySelector<HTMLButtonElement>('#er-side-open');
	if (openBtn) {
		openBtn.onclick = (): void => {
			vscode.postMessage({
				type: 'openObject',
				payload: { key: erNode.key, sourceId: erNode.sourceId, relativePath: erNode.relativePath },
			});
		};
	}
	const focusBtn = document.querySelector<HTMLButtonElement>('#er-side-focus');
	if (focusBtn) {
		focusBtn.onclick = (): void => {
			focusNodeInCanvas(erNode.key);
		};
	}
	const drillBtn = document.querySelector<HTMLButtonElement>('#er-side-drill');
	if (drillBtn) {
		drillBtn.onclick = (): void => {
			drillDownToObject(erNode.key);
		};
	}
	const addBtn = document.querySelector<HTMLButtonElement>('#er-side-add');
	if (addBtn) {
		addBtn.onclick = (): void => {
			addSeed(erNode.key);
		};
	}
}

// ── Боковая панель: ребро ─────────────────────────────────────────────────────

function showEdgePanel(edge: EdgeSingular): void {
	const side = document.querySelector<HTMLElement>('#er-side');
	if (!side) {
		return;
	}
	const data = edge.data();
	const kind: string = String(data.kind ?? '');
	const via: string[] = Array.isArray(data.via) ? (data.via as string[]) : [];
	const cardinality: string = String(data.cardinality ?? '');
	side.hidden = false;

	setText('#er-side-title', relationLabel(kind));
	setText('#er-side-type', kind);
	const sourceKey = nodeIdToKey(String(data.source ?? ''));
	const targetKey = nodeIdToKey(String(data.target ?? ''));
	setText('#er-side-name', `${sourceKey} → ${targetKey}`);
	setText('#er-side-synonym', cardinality);
	setText('#er-side-source', '');
	setText('#er-side-path', via.join('\n') || '—');

	const outEl = document.querySelector<HTMLUListElement>('#er-side-out');
	const inEl = document.querySelector<HTMLUListElement>('#er-side-in');
	if (outEl) {
		outEl.innerHTML = '';
	}
	if (inEl) {
		inEl.innerHTML = '';
	}
	const openBtn = document.querySelector<HTMLButtonElement>('#er-side-open');
	if (openBtn) {
		openBtn.onclick = null;
	}
	const focusBtn = document.querySelector<HTMLButtonElement>('#er-side-focus');
	if (focusBtn) {
		focusBtn.onclick = null;
	}
}

function setText(selector: string, text: string): void {
	const el = document.querySelector<HTMLElement>(selector);
	if (el) {
		el.textContent = text;
	}
}

function renderEdgeList(
	selector: string,
	edges: ReadonlyArray<{ kind: string; via: readonly string[]; sourceKey: string; targetKey: string }>,
	otherKeyField: 'sourceKey' | 'targetKey'
): void {
	const list = document.querySelector<HTMLUListElement>(selector);
	if (!list) {
		return;
	}
	list.innerHTML = '';
	if (edges.length === 0) {
		const empty = document.createElement('li');
		empty.textContent = '—';
		list.append(empty);
		return;
	}
	for (const edge of edges) {
		const li = document.createElement('li');
		const otherKey = edge[otherKeyField];
		const main = document.createElement('span');
		main.textContent = otherKey;
		const kindEl = document.createElement('span');
		kindEl.className = 'er-edge-kind';
		const label = relationLabel(edge.kind);
		const viaText = edge.via
			.map((v) => humanVia(v))
			.filter((h): h is string => h !== null)
			.slice(0, 4)
			.join(', ');
		kindEl.textContent = viaText ? `${label}: ${viaText}` : label;
		li.append(main, kindEl);
		li.addEventListener('click', () => {
			focusNodeInCanvas(otherKey);
		});
		list.append(li);
	}
}

function hideSidePanel(): void {
	const side = document.querySelector<HTMLElement>('#er-side');
	if (side) {
		side.hidden = true;
	}
}

// ── Навигация по графу ────────────────────────────────────────────────────────

function focusNodeInCanvas(key: string): void {
	if (!state.cy) {
		return;
	}
	const node = state.cy.getElementById(`n:${key}`);
	if (node && node.length > 0) {
		state.cy.animate({ fit: { eles: node, padding: 80 }, duration: 280 });
		highlightNeighbourhood(state.cy, node);
		showNodePanel(node);
	}
}

function drillDownToObject(key: string): void {
	requestScope({
		...state.scope,
		kind: 'selection',
		label: key,
		seeds: [key],
		hops: state.scope.hops > 0 ? state.scope.hops : 1,
	});
}

// ── Фильтры UI ────────────────────────────────────────────────────────────────

function applyFiltersFromUi(): void {
	const next: ErScope = {
		...state.scope,
		relationKinds: readRelationCheckboxes(),
		objectTypes: [],
	};
	requestScope(next);
}

function requestScope(nextScope: ErScope): void {
	state.scope = nextScope;
	refreshFilters();
	refreshScopeLabel();
	vscode.postMessage({ type: 'requestScope', payload: { scope: nextScope } });
	setStatus('Обновление схемы…');
}

// ── Тулбар ────────────────────────────────────────────────────────────────────

function bindToolbar(): void {
	document.querySelector<HTMLButtonElement>('#er-apply')?.addEventListener('click', applyFiltersFromUi);
	document.querySelectorAll<HTMLButtonElement>('.er-hops-btn').forEach((btn) => {
		btn.addEventListener('click', () => {
			const hops = Number(btn.dataset['hops'] ?? 1);
			requestScope({ ...state.scope, hops });
		});
	});
	document.querySelector<HTMLButtonElement>('#er-fit')?.addEventListener('click', () => {
		state.cy?.fit(undefined, 40);
	});
	document.querySelector<HTMLButtonElement>('#er-relayout')?.addEventListener('click', () => {
		const cy = state.cy;
		if (!cy) {
			return;
		}
		cy.layout(buildLayout(state.currentLayout, cy.elements().length)).run();
	});
	document.querySelector<HTMLSelectElement>('#er-layout')?.addEventListener('change', (event) => {
		const value = (event.target as HTMLSelectElement).value;
		if (value === 'cose' || value === 'elk' || value === 'breadthfirst') {
			state.currentLayout = value;
			state.layoutSetByUser = true;
			rebuildCanvas();
		}
	});
	document.querySelector<HTMLSelectElement>('#er-format')?.addEventListener('change', (event) => {
		state.currentFormat = (event.target as HTMLSelectElement).value as ErExportFormat;
	});
	document.querySelector<HTMLButtonElement>('#er-export')?.addEventListener('click', exportCurrent);
	document.querySelector<HTMLButtonElement>('#er-add-object')?.addEventListener('click', () => {
		vscode.postMessage({ type: 'pickAndAddObject' });
	});
	document.querySelector<HTMLButtonElement>('#er-clear-selection')?.addEventListener('click', () => {
		requestScope({ ...state.scope, kind: 'selection', label: '', seeds: [] });
	});
	document.querySelector<HTMLButtonElement>('#er-filter-all')?.addEventListener('click', () => {
		const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="er-relation"]'));
		for (const cb of checkboxes) {
			cb.checked = true;
		}
		// Явно передаём null (нет фильтра = показать все), не читаем DOM
		updateRelationFilterHint();
		requestScope({ ...state.scope, relationKinds: null });
	});
	document.querySelector<HTMLButtonElement>('#er-filter-none')?.addEventListener('click', () => {
		const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="er-relation"]'));
		for (const cb of checkboxes) {
			cb.checked = false;
		}
		// Явно передаём [] (скрыть все), не читаем DOM
		updateRelationFilterHint();
		requestScope({ ...state.scope, relationKinds: [] });
	});
	document.querySelector<HTMLButtonElement>('#er-side-close')?.addEventListener('click', hideSidePanel);
	document.querySelector<HTMLButtonElement>('#er-filter-toggle')?.addEventListener('click', () => {
		const sidebar = document.querySelector<HTMLElement>('#er-filter-sidebar');
		const btn = document.querySelector<HTMLButtonElement>('#er-filter-toggle');
		if (!sidebar) {
			return;
		}
		sidebar.hidden = !sidebar.hidden;
		btn?.setAttribute('aria-expanded', String(!sidebar.hidden));
	});
	document.querySelector<HTMLButtonElement>('#er-filter-close')?.addEventListener('click', () => {
		const sidebar = document.querySelector<HTMLElement>('#er-filter-sidebar');
		if (sidebar) {
			sidebar.hidden = true;
		}
	});

	document.querySelector<HTMLInputElement>('#er-show-type')?.addEventListener('change', (e) => {
		state.nodeLabelOptions = {
			...state.nodeLabelOptions,
			showType: (e.target as HTMLInputElement).checked,
		};
		updateNodeLabels();
		updateLabelPickerButton();
	});
	document.querySelector<HTMLInputElement>('#er-show-name')?.addEventListener('change', (e) => {
		state.nodeLabelOptions = {
			...state.nodeLabelOptions,
			showName: (e.target as HTMLInputElement).checked,
		};
		updateNodeLabels();
		updateLabelPickerButton();
		rebuildComboDropdown();
	});
	document.querySelector<HTMLInputElement>('#er-show-synonym')?.addEventListener('change', (e) => {
		state.nodeLabelOptions = {
			...state.nodeLabelOptions,
			showSynonym: (e.target as HTMLInputElement).checked,
		};
		updateNodeLabels();
		updateLabelPickerButton();
		rebuildComboDropdown();
	});

	const pickerBtn = document.querySelector<HTMLButtonElement>('#er-label-picker-btn');
	const pickerPanel = document.querySelector<HTMLDivElement>('#er-label-picker-panel');
	pickerBtn?.addEventListener('click', () => {
		if (!pickerPanel) {
			return;
		}
		pickerPanel.hidden = !pickerPanel.hidden;
		pickerBtn.setAttribute('aria-expanded', String(!pickerPanel.hidden));
	});
	document.addEventListener('click', (e) => {
		const picker = document.querySelector<HTMLDivElement>('#er-label-picker');
		if (pickerPanel && !pickerPanel.hidden && picker && !picker.contains(e.target as Node)) {
			pickerPanel.hidden = true;
			pickerBtn?.setAttribute('aria-expanded', 'false');
		}
	});

	bindAddCombo();
}

// ── Комбобокс добавления объекта ──────────────────────────────────────────────

const COMBO_MAX_RESULTS = 50;
let comboActiveIndex = -1;
let comboMatches: ErCatalogEntry[] = [];

function bindAddCombo(): void {
	const input = document.querySelector<HTMLInputElement>('#er-add-input');
	const dropdown = document.querySelector<HTMLDivElement>('#er-add-dropdown');
	if (!input || !dropdown) {
		return;
	}
	input.addEventListener('input', () => {
		renderComboMatches(input.value);
	});
	input.addEventListener('focus', () => {
		renderComboMatches(input.value);
	});
	input.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			moveComboActive(1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			moveComboActive(-1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			commitComboSelection();
		} else if (event.key === 'Escape') {
			closeCombo();
		}
	});
	document.addEventListener('click', (event) => {
		const target = event.target as HTMLElement | null;
		if (!target?.closest('#er-add-combo')) {
			closeCombo();
		}
	});
}

function findCatalogMatches(rawQuery: string): ErCatalogEntry[] {
	const tokens = rawQuery
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
	if (tokens.length === 0) {
		return state.catalog.slice(0, COMBO_MAX_RESULTS);
	}
	const matches: ErCatalogEntry[] = [];
	for (const entry of state.catalog) {
		const searchText = `${entry.key} ${entry.name} ${entry.synonymRu}`.toLowerCase();
		if (tokens.every((t) => searchText.includes(t))) {
			matches.push(entry);
			if (matches.length >= COMBO_MAX_RESULTS) {
				break;
			}
		}
	}
	return matches;
}

/**
 * Оборачивает вхождения каждого токена из `tokens` в тексте в `<span class="er-combo-match">`.
 * Возвращает `DocumentFragment` с текстом и highlight-элементами.
 */
function highlightText(text: string, tokens: string[]): DocumentFragment {
	const fragment = document.createDocumentFragment();
	const active = tokens.filter(Boolean);
	if (active.length === 0) {
		fragment.append(document.createTextNode(text));
		return fragment;
	}
	const pattern = active.map((t) => t.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)).join('|');
	const regex = new RegExp(`(${pattern})`, 'gi');
	let pos = 0;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		if (match.index > pos) {
			fragment.append(document.createTextNode(text.slice(pos, match.index)));
		}
		const mark = document.createElement('span');
		mark.className = 'er-combo-match';
		mark.textContent = match[0];
		fragment.append(mark);
		pos = match.index + match[0].length;
	}
	if (pos < text.length) {
		fragment.append(document.createTextNode(text.slice(pos)));
	}
	return fragment;
}

function buildComboItem(entry: ErCatalogEntry, isActive: boolean, isDisabled: boolean, tokens: string[]): HTMLDivElement {
	const item = document.createElement('div');
	item.className = 'er-combo-item';
	if (isActive) {
		item.classList.add('is-active');
	}
	if (isDisabled) {
		item.classList.add('is-disabled');
		item.title = 'Уже на схеме';
	}
	const keyEl = document.createElement('span');
	keyEl.className = 'er-combo-item-key';
	keyEl.title = entry.key;
	const primaryText =
		state.nodeLabelOptions.showSynonym && entry.synonymRu
			? entry.synonymRu
			: entry.name;
	keyEl.append(highlightText(primaryText, tokens));
	const synEl = document.createElement('span');
	synEl.className = 'er-combo-item-syn';
	synEl.append(highlightText(entry.objectType, tokens));
	item.append(keyEl, synEl);
	item.addEventListener('mousedown', (event) => {
		event.preventDefault();
		if (isDisabled) {
			return;
		}
		selectComboEntry(entry);
	});
	return item;
}

function resolveEmptyComboText(): string {
	if (!state.graphReady) {
		return 'Граф метаданных загружается…';
	}
	if (state.catalog.length === 0) {
		return 'Каталог объектов пуст.';
	}
	return 'Ничего не найдено.';
}

function renderComboMatches(rawQuery: string): void {
	const dropdown = document.querySelector<HTMLDivElement>('#er-add-dropdown');
	if (!dropdown) {
		return;
	}
	const seeds = state.scope.kind === 'selection' ? new Set(state.scope.seeds) : new Set<string>();
	const tokens = rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const matches = findCatalogMatches(rawQuery);
	comboMatches = matches;
	comboActiveIndex = matches.length > 0 ? 0 : -1;
	dropdown.innerHTML = '';
	if (matches.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'er-combo-empty';
		empty.textContent = resolveEmptyComboText();
		dropdown.append(empty);
	} else {
		for (const [idx, entry] of matches.entries()) {
			dropdown.append(buildComboItem(entry, idx === comboActiveIndex, seeds.has(entry.key), tokens));
		}
	}
	dropdown.hidden = false;
}

/** Перестраивает дропдаун комбо с текущим запросом (если открыт), чтобы отразить смену режима имён. */
function rebuildComboDropdown(): void {
	const input = document.querySelector<HTMLInputElement>('#er-add-input');
	const dropdown = document.querySelector<HTMLDivElement>('#er-add-dropdown');
	if (!input || !dropdown || dropdown.hidden) {
		return;
	}
	renderComboMatches(input.value);
}

function moveComboActive(delta: number): void {
	if (comboMatches.length === 0) {
		return;
	}
	const len = comboMatches.length;
	comboActiveIndex = (comboActiveIndex + delta + len) % len;
	const items = document.querySelectorAll<HTMLDivElement>('#er-add-dropdown .er-combo-item');
	for (const [i, el] of Array.from(items).entries()) {
		el.classList.toggle('is-active', i === comboActiveIndex);
		if (i === comboActiveIndex) {
			el.scrollIntoView({ block: 'nearest' });
		}
	}
}

function commitComboSelection(): void {
	if (comboActiveIndex < 0 || comboActiveIndex >= comboMatches.length) {
		return;
	}
	const entry = comboMatches[comboActiveIndex];
	if (state.scope.kind === 'selection' && state.scope.seeds.includes(entry.key)) {
		return;
	}
	selectComboEntry(entry);
}

function selectComboEntry(entry: ErCatalogEntry): void {
	const input = document.querySelector<HTMLInputElement>('#er-add-input');
	if (input) {
		input.value = '';
		input.focus();
	}
	closeCombo();
	addSeed(entry.key);
}

function closeCombo(): void {
	const dropdown = document.querySelector<HTMLDivElement>('#er-add-dropdown');
	if (dropdown) {
		dropdown.hidden = true;
	}
}

// ── Экспорт ───────────────────────────────────────────────────────────────────

function exportCurrent(): void {
	if (state.subgraph.nodes.length === 0) {
		setStatus('Нечего экспортировать: схема пуста.');
		return;
	}
	const format = state.currentFormat;
	try {
		const payload = exportFromWebview(
			format,
			{
				subgraph: state.subgraph,
				scope: state.scope,
				generatedAtIso: new Date().toISOString(),
			},
			state.cy
		);
		vscode.postMessage({
			type: 'exportContent',
			payload: {
				format: payload.format,
				fileExtension: payload.fileExtension,
				scopeLabel: state.scope.label || state.scope.kind,
				content: payload.content,
				base64: payload.base64,
			},
		});
		setStatus(`Экспорт ${format.toUpperCase()} отправлен`);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		setStatus(`Ошибка экспорта: ${message}`);
		postLog('error', `export ${format}: ${message}`);
	}
}

// ── Обработчики входящих сообщений ────────────────────────────────────────────

function handleInit(payload: InitPayload): void {
	state.scope = payload.scope;
	state.subgraph = payload.subgraph;
	state.truncated = payload.truncated;
	state.fullNodeCount = payload.fullNodeCount;
	state.availableObjectTypes = payload.availableObjectTypes;
	state.availableRelationKinds = payload.availableRelationKinds;
	state.catalog = payload.catalog;
	state.availableFormats = payload.availableFormats;
	state.currentFormat = payload.defaultFormat;
	updateEdgeCounts(payload.subgraph.edges, true);
	// graphReady=false если каталог пустой — граф ещё подгружается
	state.graphReady = payload.catalog.length > 0 || payload.subgraph.nodes.length > 0;
	refreshScopeLabel();
	refreshFilters();
	rebuildCanvas();
	if (!state.graphReady) {
		setLoading(true);
		setStatus('Загрузка метаданных…');
	}
}

function bindMessageHandlers(): void {
	window.addEventListener('message', (event: MessageEvent) => {
		if (typeof event.origin === 'string' && !event.origin.startsWith('vscode-webview://')) {
			return;
		}
		const message = event.data as HostToWebviewMessage | undefined;
		if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
			return;
		}
		switch (message.type) {
			case 'init':
				handleInit(message.payload);
				break;
			case 'loading':
				setLoading(true);
				setStatus(message.payload.message);
				break;
			case 'graphReady': {
				const p = message.payload;
				state.subgraph = p.subgraph;
				state.scope = p.scope;
				state.truncated = p.truncated;
				state.fullNodeCount = p.fullNodeCount;
				state.availableObjectTypes = p.availableObjectTypes;
				state.availableRelationKinds = p.availableRelationKinds;
				state.catalog = p.catalog;
				state.graphReady = true;
				updateEdgeCounts(p.subgraph.edges, false);
				setLoading(false);
				refreshScopeLabel();
				refreshFilters();
				rebuildCanvas();
				setStatus(state.truncated ? 'Граф усечён по лимиту' : 'Граф загружен');
				break;
			}
			case 'loadError':
				setLoading(false);
				showEmptyState(`Ошибка загрузки графа:\n${message.payload.message}`);
				setStatus('Ошибка загрузки');
				break;
			case 'setSubgraph': {
				const p = message.payload;
				state.scope = p.scope;
				state.subgraph = p.subgraph;
				state.truncated = p.truncated;
				state.fullNodeCount = p.fullNodeCount;
				updateEdgeCounts(p.subgraph.edges, false);
				refreshScopeLabel();
				refreshFilters();
				rebuildCanvas();
				setStatus(state.truncated ? 'Усечено по лимиту' : '');
				break;
			}
			default:
				break;
		}
	});
}

// ── Инициализация ─────────────────────────────────────────────────────────────

function consumeBootstrapInit(): void {
	const init = (globalThis as unknown as { __ER_INIT__?: InitPayload }).__ER_INIT__;
	if (init) {
		handleInit(init);
	}
}

function main(): void {
	bindToolbar();
	bindMessageHandlers();
	setupCanvasResizeObserver();
	consumeBootstrapInit();
	vscode.postMessage({ type: 'ready' });
}

// ── ResizeObserver: Cytoscape не следит за размером контейнера сам ────────────

function setupCanvasResizeObserver(): void {
	const canvasEl = document.querySelector<HTMLDivElement>('#er-canvas');
	if (!canvasEl) {
		return;
	}
	const observer = new ResizeObserver(() => {
		if (state.cy) {
			state.cy.resize();
		}
	});
	observer.observe(canvasEl);
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', main);
} else {
	main();
}
