/**
 * Преобразование IR ER-графа в элементы Cytoscape.
 *
 * @module webviews/metadataErCanvas/graphAdapter
 */

import type { ElementDefinition, NodeDataDefinition, EdgeDataDefinition } from 'cytoscape';
import type { ErEdge, ErNode, ErSubgraph } from '../../features/metadata/er/erTypes';
import { humanVia, relationLabel } from './relationLabels';

interface MdNodeData extends NodeDataDefinition {
	readonly id: string;
	readonly label: string;
	readonly nodeKind: 'md';
	readonly objectType: string;
	readonly name: string;
	readonly synonymRu: string;
	readonly sourceId: string;
	readonly relativePath: string;
	readonly partial: boolean;
}

interface MdEdgeData extends EdgeDataDefinition {
	readonly id: string;
	readonly source: string;
	readonly target: string;
	readonly label: string;
	readonly kind: string;
	readonly cardinality: string;
	readonly via: readonly string[];
}

function nodeId(key: string): string {
	return `n:${key}`;
}

/** Параметры отображения меток узлов на схеме. */
export interface NodeLabelOptions {
	/** Показывать тип объекта метаданных первой строкой. */
	showType: boolean;
	/** Показывать имя (идентификатор) объекта. */
	showName: boolean;
	/** Показывать синоним объекта. */
	showSynonym: boolean;
}

function nodeLabel(node: ErNode, opts: NodeLabelOptions): string {
	const lines: string[] = [];
	if (opts.showType) {
		lines.push(objectTypeLabel(node.objectType));
	}
	if (opts.showName) {
		lines.push(node.name);
	}
	if (opts.showSynonym && node.synonymRu) {
		lines.push(node.synonymRu);
	}
	return lines.join('\n') || node.name;
}

/** Вычисляет метку узла с заданными параметрами отображения. */
export function computeNodeLabel(node: ErNode, opts: NodeLabelOptions): string {
	return nodeLabel(node, opts);
}

/** Короткая русская аббревиатура типа объекта. */
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

export function objectTypeLabel(objectType: string): string {
	return OBJECT_TYPE_LABELS[objectType] ?? objectType;
}

function edgeLabel(edge: ErEdge, showVia: boolean): string {
	const label = relationLabel(edge.kind);
	if (!showVia) {
		return label;
	}
	const parts: string[] = [];
	for (const v of edge.via) {
		const h = humanVia(v);
		if (h && !parts.includes(h)) {
			parts.push(h);
		}
	}
	if (parts.length === 0) {
		return label;
	}
	const head = parts.slice(0, 3).join(', ');
	const more = parts.length > 3 ? ', …' : '';
	return `${label}\n${head}${more}`;
}

/**
 * Возвращает элементы Cytoscape для подграфа.
 *
 * `showVia=true` — в метке ребра показываем имена атрибутов/измерений.
 */
export function toCytoscapeElements(
	subgraph: ErSubgraph,
	options: { showVia: boolean; nodeLabelOptions: NodeLabelOptions }
): ElementDefinition[] {
	const elements: ElementDefinition[] = [];

	for (const node of subgraph.nodes) {
		const data: MdNodeData = {
			id: nodeId(node.key),
			label: nodeLabel(node, options.nodeLabelOptions),
			nodeKind: 'md',
			objectType: node.objectType,
			name: node.name,
			synonymRu: node.synonymRu,
			sourceId: node.sourceId,
			relativePath: node.relativePath,
			partial: node.partial,
		};
		elements.push({ data, classes: classesForNode(node) });
	}

	for (let index = 0; index < subgraph.edges.length; index += 1) {
		const edge = subgraph.edges[index];
		const data: MdEdgeData = {
			id: `e:${index}`,
			source: nodeId(edge.sourceKey),
			target: nodeId(edge.targetKey),
			label: edgeLabel(edge, options.showVia),
			kind: edge.kind,
			cardinality: edge.cardinality,
			via: edge.via,
		};
		elements.push({ data, classes: edge.kind });
	}

	return elements;
}

function classesForNode(node: ErNode): string {
	const classes: string[] = ['md', `type-${node.objectType.toLowerCase()}`];
	if (node.partial) {
		classes.push('partial');
	}
	return classes.join(' ');
}

export function nodeIdToKey(id: string): string {
	return id.startsWith('n:') ? id.slice(2) : id;
}
