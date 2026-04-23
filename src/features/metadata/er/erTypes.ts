/**
 * Internal representation (IR) ER-графа.
 *
 * Контракт совпадает с {@code ProjectMetadataGraphDto} из md-sparrow CLI {@code cf-md-graph}.
 * IR используется во всём расширении: загрузка, кэш, фильтры, экспортёры, webview-canvas.
 *
 * @module er/erTypes
 */

/** Стабильные id видов связи между объектами метаданных (см. {@code RelationKind} в md-sparrow). */
export type ErRelationKind =
	| 'catalogOwners'
	| 'typeComposite'
	| 'documentPostingRegisters'
	| 'documentBasedOn'
	| 'registerDimensionType'
	| 'registerResourceType'
	| 'subsystemMembership'
	| 'subsystemNesting'
	| 'sequenceDocuments'
	| 'sequenceRegisters'
	| 'filterCriterionType'
	| 'filterCriterionContent'
	| 'documentJournalEntries'
	| 'functionalOptionLocation'
	| 'functionalOptionAffected'
	| 'fopUseBinding'
	| 'roleObjectRights'
	| 'exchangePlanContent'
	| 'commonAttributeUsage'
	| 'subscriptionSource'
	| 'subscriptionHandler'
	| 'scheduledJobHandler'
	| 'commandParameterType'
	| 'registerChartOfAccounts'
	| 'registerChartOfCalculationTypes'
	| 'chartOfAccountsExtDimensions'
	| 'characteristicExtValues';

/** Поддерживаемые форматы экспорта диаграммы. */
export type ErExportFormat = 'mermaid' | 'svg' | 'png' | 'drawio';

/** Виды scope (область) построения графа. */
export type ErScopeKind = 'object' | 'subsystem' | 'selection' | 'all';

/** Узел графа: объект метаданных. */
export interface ErNode {
	readonly key: string;
	readonly objectType: string;
	readonly name: string;
	readonly synonymRu: string;
	readonly sourceId: string;
	readonly relativePath: string;
	readonly subsystemKeys: readonly string[];
	readonly partial: boolean;
}

/** Ребро: типизированная связь от source к target. */
export interface ErEdge {
	readonly sourceKey: string;
	readonly targetKey: string;
	readonly kind: ErRelationKind | string;
	readonly cardinality: string;
	readonly via: readonly string[];
}

/** Полный граф метаданных проекта (ответ {@code cf-md-graph}). */
export interface ErGraph {
	readonly projectRoot: string;
	readonly mainSchemaVersion: string;
	readonly mainSchemaVersionFlag: string;
	readonly nodeCount: number;
	readonly edgeCount: number;
	readonly nodes: readonly ErNode[];
	readonly edges: readonly ErEdge[];
}

/** Параметры выборки подграфа для отображения/экспорта. */
export interface ErScope {
	readonly kind: ErScopeKind;
	readonly label: string;
	/** Стартовые ключи (объекты метаданных). При scope=all — игнорируется. */
	readonly seeds: readonly string[];
	/** Глубина расширения соседей (N-hop). 0 — только seeds, без расширения. */
	readonly hops: number;
	/** Фильтр по типам объектов; пусто — все. */
	readonly objectTypes: readonly string[];
	/** Фильтр по видам связи; null — все виды; пустой массив — скрыть все. */
	readonly relationKinds: readonly string[] | null;
}

/** Подграф (IR), пригодный для отрисовки и экспорта. */
export interface ErSubgraph {
	readonly nodes: readonly ErNode[];
	readonly edges: readonly ErEdge[];
}

/** Запрос на экспорт диаграммы. */
export interface ErExportRequest {
	readonly subgraph: ErSubgraph;
	readonly scope: ErScope;
	readonly generatedAtIso: string;
}

/** Результат экспорта (готов к записи в файл). */
export interface ErExportResult {
	readonly fileExtension: string;
	readonly content: string | Uint8Array;
}
