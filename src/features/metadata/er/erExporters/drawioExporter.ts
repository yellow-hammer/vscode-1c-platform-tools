/**
 * Экспорт ER-подграфа в формат draw.io (.drawio XML, совместим с diagrams.net).
 *
 * @module er/erExporters/drawioExporter
 */

import type { ErEdge, ErExportRequest, ErExportResult, ErNode } from '../erTypes';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;
const COL_SPACING = 40;
const ROW_SPACING = 100;
/** Отступ от верха листа, чтобы схему было удобно двигать. */
const MARGIN_TOP = 200;
/** Максимум узлов в одном визуальном ряду; длинные ряды переносятся на следующий. */
const MAX_NODES_PER_ROW = 5;

// ── Метки ─────────────────────────────────────────────────────────────────────

const OBJECT_TYPE_LABELS: Record<string, string> = {
	Configuration: 'Конфигурация',
	Catalog: 'Справочник',
	Document: 'Документ',
	DocumentJournal: 'ЖурналДок',
	Enum: 'Перечисление',
	Subsystem: 'Подсистема',
	ExchangePlan: 'ПланОбмена',
	FilterCriterion: 'КритерийОтбора',
	ChartOfCharacteristicTypes: 'ПВХ',
	ChartOfAccounts: 'ПС',
	ChartOfCalculationTypes: 'ПВР',
	InformationRegister: 'РС',
	AccumulationRegister: 'РН',
	AccountingRegister: 'РБ',
	CalculationRegister: 'РР',
	BusinessProcess: 'Бизнес-процесс',
	Task: 'Задача',
	Constant: 'Константа',
	CommonModule: 'ОбщийМодуль',
	CommonAttribute: 'ОбщийРеквизит',
	CommonForm: 'ОбщаяФорма',
	CommonCommand: 'ОбщаяКоманда',
	CommandGroup: 'ГруппаКоманд',
	CommonTemplate: 'ОбщийМакет',
	CommonPicture: 'Картинка',
	SessionParameter: 'ПарамСеанса',
	Role: 'Роль',
	Report: 'Отчёт',
	DataProcessor: 'Обработка',
	FunctionalOption: 'ФО',
	FunctionalOptionsParameter: 'ПарамФО',
	DefinedType: 'ОпрТип',
	Sequence: 'Последовательность',
	EventSubscription: 'Подписка',
	ScheduledJob: 'РегЗадание',
	WebService: 'Веб-сервис',
	HTTPService: 'HTTP-сервис',
	WSReference: 'WSСсылка',
	XDTOPackage: 'Пакет XDTO',
	Language: 'Язык',
	DocumentNumerator: 'НумераторДок',
	ExternalDataSource: 'ВнешнИсточник',
	Style: 'Стиль',
	StyleItem: 'ЭлемСтиля',
	PaletteColor: 'ЦветПалитры',
	SettingsStorage: 'ХранНастроек',
	Bot: 'Бот',
	Interface: 'Интерфейс',
	ExternalReport: 'ВнешнОтчёт',
	ExternalDataProcessor: 'ВнешнОбработка',
};

const RELATION_LABELS: Record<string, string> = {
	catalogOwners: 'Владелец',
	typeComposite: 'Тип',
	documentPostingRegisters: 'Движение по регистру',
	documentBasedOn: 'На основании',
	registerDimensionType: 'Тип измерения',
	registerResourceType: 'Тип ресурса',
	registerChartOfAccounts: 'План счетов регистра',
	registerChartOfCalculationTypes: 'План видов расчётов регистра',
	chartOfAccountsExtDimensions: 'Виды субконто',
	characteristicExtValues: 'Значения характеристик',
	subsystemMembership: 'В подсистеме',
	subsystemNesting: 'Вложенная подсистема',
	sequenceDocuments: 'Документ последовательности',
	sequenceRegisters: 'Регистр последовательности',
	filterCriterionType: 'Тип критерия отбора',
	filterCriterionContent: 'Состав критерия отбора',
	documentJournalEntries: 'Журнал документов',
	functionalOptionLocation: 'Хранилище ФО',
	functionalOptionAffected: 'Управляется ФО',
	fopUseBinding: 'Параметр ФО',
	roleObjectRights: 'Права роли',
	exchangePlanContent: 'Состав плана обмена',
	commonAttributeUsage: 'Охватывает объект',
	subscriptionSource: 'Источник подписки',
	subscriptionHandler: 'Обработчик подписки',
	scheduledJobHandler: 'Обработчик задания',
	commandParameterType: 'Тип параметра команды',
};

// ── Цветовая схема по типу объекта (fill / stroke) ─────────────────────────

interface NodeColors { fill: string; stroke: string }

const TYPE_COLORS: Record<string, NodeColors> = {
	Catalog:                     { fill: '#dae8fc', stroke: '#6c8ebf' },
	Document:                    { fill: '#f8cecc', stroke: '#b85450' },
	InformationRegister:         { fill: '#d5e8d4', stroke: '#82b366' },
	AccumulationRegister:        { fill: '#d5e8d4', stroke: '#82b366' },
	AccountingRegister:          { fill: '#d5e8d4', stroke: '#82b366' },
	CalculationRegister:         { fill: '#d5e8d4', stroke: '#82b366' },
	Enum:                        { fill: '#fff2cc', stroke: '#d6b656' },
	ChartOfCharacteristicTypes:  { fill: '#e1d5e7', stroke: '#9673a6' },
	ChartOfAccounts:             { fill: '#e1d5e7', stroke: '#9673a6' },
	ChartOfCalculationTypes:     { fill: '#e1d5e7', stroke: '#9673a6' },
	ExchangePlan:                { fill: '#dae8fc', stroke: '#4abfbf' },
	FilterCriterion:             { fill: '#ffe6cc', stroke: '#d79b00' },
	FunctionalOption:            { fill: '#e1d5e7', stroke: '#9673a6' },
	FunctionalOptionsParameter:  { fill: '#e1d5e7', stroke: '#9673a6' },
	Sequence:                    { fill: '#ffe6cc', stroke: '#d79b00' },
	DocumentJournal:             { fill: '#ffe6cc', stroke: '#d79b00' },
	Role:                        { fill: '#fff2cc', stroke: '#c5a64f' },
	CommonAttribute:             { fill: '#dae8fc', stroke: '#6c8ebf' },
	Subsystem:                   { fill: '#f5f5f5', stroke: '#666666' },
};
const DEFAULT_COLORS: NodeColors = { fill: '#f5f5f5', stroke: '#666666' };

// ── Стиль рёбер по виду связи ──────────────────────────────────────────────

function edgeStyle(kind: string): string {
	const dashed = kind === 'subsystemMembership' || kind === 'subsystemNesting'
		? 'dashed=1;'
		: '';
	const color = kind === 'typeComposite' || kind === 'registerDimensionType' || kind === 'registerResourceType'
		? 'strokeColor=#6c8ebf;strokeWidth=2;'
		: kind === 'documentPostingRegisters'
			? 'strokeColor=#82b366;'
			: kind === 'catalogOwners'
				? 'strokeColor=#b85450;'
				: kind === 'roleObjectRights'
					? 'strokeColor=#c5a64f;'
					: kind === 'functionalOptionAffected' || kind === 'functionalOptionLocation' || kind === 'fopUseBinding'
						? 'strokeColor=#9673a6;'
						: '';
	return `endArrow=classic;html=1;rounded=0;${dashed}${color}`;
}

// ── Вспомогательные функции ────────────────────────────────────────────────

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function humanVia(p: string): string | null {
	if (/^(content|rights|owners|use|documents|registerRecords|basedOn|registeredDocuments|childObjects|source|commandParameterType)\[/.test(p)) {
		return null;
	}
	if (p === 'location' || p === 'handler' || p === 'methodName'
		|| p === 'chartOfAccounts' || p === 'chartOfCalculationTypes' || p === 'extDimensionTypes'
		|| p === 'characteristicExtValues') {
		return null;
	}
	const attrMatch = /^attributes\.([^.[]+)\./.exec(p);
	if (attrMatch) { return attrMatch[1]; }
	const tsAttrMatch = /^tabularSections\.([^.[]+)\.attributes\.([^.[]+)\./.exec(p);
	if (tsAttrMatch) { return `${tsAttrMatch[1]}.${tsAttrMatch[2]}`; }
	const dimMatch = /^dimensions\.([^.[]+)\./.exec(p);
	if (dimMatch) { return dimMatch[1]; }
	const resMatch = /^resources\.([^.[]+)\./.exec(p);
	if (resMatch) { return resMatch[1]; }
	return null;
}

function nodeLabel(node: ErNode): string {
	const type = OBJECT_TYPE_LABELS[node.objectType] ?? node.objectType;
	const syn = node.synonymRu && node.synonymRu !== node.name ? `«${node.synonymRu}»` : '';
	return syn ? `${type}\n${node.name}\n${syn}` : `${type}\n${node.name}`;
}

function edgeLabel(edge: ErEdge): string {
	const rel = RELATION_LABELS[edge.kind] ?? edge.kind;
	const viaParts: string[] = [];
	for (const v of edge.via) {
		const h = humanVia(v);
		if (h && !viaParts.includes(h)) {
			viaParts.push(h);
		}
	}
	if (viaParts.length === 0) {
		return rel;
	}
	const head = viaParts.slice(0, 3).join(', ');
	const more = viaParts.length > 3 ? ', …' : '';
	return `${rel}: ${head}${more}`;
}

// ── Иерархический layout (longest-path) ───────────────────────────────────

function computeLayout(
	nodes: readonly ErNode[],
	edges: readonly ErEdge[],
): Map<string, { x: number; y: number }> {
	if (nodes.length === 0) { return new Map(); }

	const keys = nodes.map(n => n.key);
	const keySet = new Set(keys);

	const outAdj = new Map<string, string[]>(keys.map(k => [k, []]));
	const inDeg = new Map<string, number>(keys.map(k => [k, 0]));

	for (const e of edges) {
		if (keySet.has(e.sourceKey) && keySet.has(e.targetKey) && e.sourceKey !== e.targetKey) {
			outAdj.get(e.sourceKey)!.push(e.targetKey);
			inDeg.set(e.targetKey, (inDeg.get(e.targetKey) ?? 0) + 1);
		}
	}

	// Topological order via Kahn's
	const tempInDeg = new Map(inDeg);
	const topo: string[] = [];
	const queue: string[] = keys.filter(k => (tempInDeg.get(k) ?? 0) === 0);
	let head = 0;
	while (head < queue.length) {
		const u = queue[head++];
		topo.push(u);
		for (const v of outAdj.get(u) ?? []) {
			const d = (tempInDeg.get(v) ?? 1) - 1;
			tempInDeg.set(v, d);
			if (d === 0) { queue.push(v); }
		}
	}
	// Nodes in cycles: append in original order
	const inTopo = new Set(topo);
	for (const k of keys) { if (!inTopo.has(k)) { topo.push(k); } }

	// Longest path from any source
	const layer = new Map<string, number>(keys.map(k => [k, 0]));
	for (const u of topo) {
		for (const v of outAdj.get(u) ?? []) {
			layer.set(v, Math.max(layer.get(v) ?? 0, (layer.get(u) ?? 0) + 1));
		}
	}

	// Group by layer
	const byLayer = new Map<number, string[]>();
	for (const k of keys) {
		const l = layer.get(k) ?? 0;
		if (!byLayer.has(l)) { byLayer.set(l, []); }
		byLayer.get(l)!.push(k);
	}

	// Position: wrap layers exceeding MAX_NODES_PER_ROW into multiple visual rows
	const colStep = NODE_WIDTH + COL_SPACING;
	const rowStep = NODE_HEIGHT + ROW_SPACING;

	// Each logical layer is split into chunks of MAX_NODES_PER_ROW.
	// We pre-compute the global visual-row index per logical layer so all layers
	// stack below each other without overlap.
	const layerStartRow = new Map<number, number>();
	const sortedLayers = [...byLayer.keys()].sort((a, b) => a - b);
	let nextVisualRow = 0;
	for (const l of sortedLayers) {
		layerStartRow.set(l, nextVisualRow);
		const count = byLayer.get(l)!.length;
		nextVisualRow += Math.ceil(count / MAX_NODES_PER_ROW);
	}

	const positions = new Map<string, { x: number; y: number }>();
	for (const [l, layerKeys] of byLayer) {
		const startRow = layerStartRow.get(l) ?? 0;
		layerKeys.forEach((k, i) => {
			const col = i % MAX_NODES_PER_ROW;
			const row = Math.floor(i / MAX_NODES_PER_ROW);
			const chunkSize = Math.min(MAX_NODES_PER_ROW, layerKeys.length - row * MAX_NODES_PER_ROW);
			const startX = Math.round(((MAX_NODES_PER_ROW - chunkSize) * colStep) / 2);
			positions.set(k, {
				x: startX + col * colStep,
				y: MARGIN_TOP + (startRow + row) * rowStep,
			});
		});
	}
	return positions;
}

// ── Экспортёр ─────────────────────────────────────────────────────────────

export function exportDrawio(request: ErExportRequest): ErExportResult {
	const { subgraph, scope, generatedAtIso } = request;

	// Индексные ID: гарантия уникальности независимо от имён объектов
	const idOf = new Map(subgraph.nodes.map((n, i) => [n.key, `n${i}`]));
	const positions = computeLayout(subgraph.nodes, subgraph.edges);

	const lines: string[] = [];
	lines.push('<?xml version="1.0" encoding="UTF-8"?>');
	lines.push('<mxfile host="vscode-1c-platform-tools">');
	lines.push(`  <diagram name="${escapeXml(`${scope.label || scope.kind}`)}">`);
	lines.push(`    <!-- generated: ${escapeXml(generatedAtIso)} -->`);
	lines.push('    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="0">');
	lines.push('      <root>');
	lines.push('        <mxCell id="0" />');
	lines.push('        <mxCell id="1" parent="0" />');

	subgraph.nodes.forEach((node, index) => {
		const id = idOf.get(node.key) ?? `n${index}`;
		const pos = positions.get(node.key) ?? { x: index * (NODE_WIDTH + COL_SPACING), y: MARGIN_TOP };
		const label = escapeXml(nodeLabel(node));
		const { fill, stroke } = TYPE_COLORS[node.objectType] ?? DEFAULT_COLORS;
		const fontStyle = node.objectType === 'Subsystem' ? 'fontStyle=2;' : '';
		lines.push(
			`        <mxCell id="${id}" value="${label}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};${fontStyle}" vertex="1" parent="1">`
		);
		lines.push(`          <mxGeometry x="${pos.x}" y="${pos.y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" as="geometry" />`);
		lines.push('        </mxCell>');
	});

	subgraph.edges.forEach((edge, index) => {
		const source = idOf.get(edge.sourceKey);
		const target = idOf.get(edge.targetKey);
		if (!source || !target) { return; }
		const label = escapeXml(edgeLabel(edge));
		lines.push(
			`        <mxCell id="e${index}" style="${edgeStyle(edge.kind)}" edge="1" parent="1" source="${source}" target="${target}" value="${label}">`
		);
		lines.push('          <mxGeometry relative="1" as="geometry" />');
		lines.push('        </mxCell>');
	});

	lines.push('      </root>');
	lines.push('    </mxGraphModel>');
	lines.push('  </diagram>');
	lines.push('</mxfile>');

	return {
		fileExtension: 'drawio',
		content: lines.join('\n'),
	};
}
