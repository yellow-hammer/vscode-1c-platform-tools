/**
 * Экспорт ER-подграфа в Mermaid-разметку (markdown с ```mermaid```-блоком).
 *
 * @module er/erExporters/mermaidExporter
 */

import type { ErEdge, ErExportRequest, ErExportResult, ErNode } from '../erTypes';

const MAX_VIA_PARTS = 3;

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

// ── Вспомогательные функции ────────────────────────────────────────────────

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

function escapeMermaidLabel(value: string): string {
	// В Mermaid внутри ["..."] двойные кавычки экранируются как #quot;
	return value.replaceAll('"', '#quot;');
}

function escapeMermaidEdge(value: string): string {
	// В метке ребра |"..."| кавычки экранируем
	return value.replaceAll('"', '#quot;');
}

function nodeLabel(node: ErNode): string {
	const type = OBJECT_TYPE_LABELS[node.objectType] ?? node.objectType;
	const syn = node.synonymRu && node.synonymRu !== node.name ? `«${node.synonymRu}»` : null;
	return syn ? `${type} • ${syn}` : `${type} • ${node.name}`;
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
	const head = viaParts.slice(0, MAX_VIA_PARTS).join(', ');
	const more = viaParts.length > MAX_VIA_PARTS ? ', …' : '';
	return `${rel}: ${head}${more}`;
}

// ── Экспортёр ─────────────────────────────────────────────────────────────

export function exportMermaid(request: ErExportRequest): ErExportResult {
	const { subgraph, scope, generatedAtIso } = request;

	// Индексные ID: гарантия уникальности независимо от имён объектов
	const idOf = new Map(subgraph.nodes.map((n, i) => [n.key, `n${i}`]));

	const lines: string[] = [];
	lines.push('# ER-диаграмма');
	lines.push('');
	lines.push(`- Схема: ${scope.label || scope.kind}`);
	lines.push(`- Объектов: ${subgraph.nodes.length}, связей: ${subgraph.edges.length}`);
	if (scope.relationKinds !== null && scope.relationKinds.length > 0) {
		lines.push(`- Фильтр связей: ${scope.relationKinds.map((k) => RELATION_LABELS[k] ?? k).join(', ')}`);
	}
	lines.push(`- Сформировано: ${generatedAtIso}`);
	lines.push('');
	lines.push('```mermaid');
	lines.push('flowchart LR');

	for (const node of subgraph.nodes) {
		const id = idOf.get(node.key) ?? `n_x`;
		const text = escapeMermaidLabel(nodeLabel(node));
		lines.push(`  ${id}["${text}"]`);
	}

	for (const edge of subgraph.edges) {
		const srcId = idOf.get(edge.sourceKey);
		const tgtId = idOf.get(edge.targetKey);
		if (!srcId || !tgtId) { continue; }
		const label = escapeMermaidEdge(edgeLabel(edge));
		lines.push(`  ${srcId} -->|"${label}"| ${tgtId}`);
	}

	lines.push('```');
	lines.push('');

	return {
		fileExtension: 'md',
		content: lines.join('\n'),
	};
}
