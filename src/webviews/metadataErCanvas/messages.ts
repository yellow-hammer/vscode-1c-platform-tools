/**
 * Контракт сообщений между host (extension) и webview-canvas ER-диаграммы.
 *
 * Архитектурный принцип: host режет подграф под scope и шлёт в webview ТОЛЬКО подграф
 * (не весь граф конфигурации). Это спасает от фриза при тысячах узлов.
 *
 * @module webviews/metadataErCanvas/messages
 */

import type { ErExportFormat, ErScope, ErSubgraph } from '../../features/metadata/er/erTypes';

/** Лёгкий каталог объектов проекта для quick-pick «+ Добавить объект» в host. */
export interface ErCatalogEntry {
	readonly key: string;
	readonly objectType: string;
	readonly name: string;
	readonly synonymRu: string;
}

/** init: webview получает уже подсчитанный подграф под стартовый scope. */
export interface ErInitMessage {
	readonly type: 'init';
	readonly payload: {
		readonly subgraph: ErSubgraph;
		readonly scope: ErScope;
		readonly truncated: boolean;
		readonly fullNodeCount: number;
		readonly availableObjectTypes: readonly string[];
		readonly availableRelationKinds: readonly string[];
		readonly catalog: readonly ErCatalogEntry[];
		readonly availableFormats: readonly ErExportFormat[];
		readonly defaultFormat: ErExportFormat;
		readonly defaultExportDirRel: string;
	};
}

/** setSubgraph: host пересчитал подграф под изменённый scope и шлёт результат. */
export interface ErSetSubgraphMessage {
	readonly type: 'setSubgraph';
	readonly payload: {
		readonly subgraph: ErSubgraph;
		readonly scope: ErScope;
		readonly truncated: boolean;
		readonly fullNodeCount: number;
	};
}

/** loading: host начал загрузку/пересчёт — webview показывает индикатор. */
export interface ErLoadingMessage {
	readonly type: 'loading';
	readonly payload: { readonly message: string };
}

/** graphReady: граф загружен, webview получает полные данные для работы. */
export interface ErGraphReadyMessage {
	readonly type: 'graphReady';
	readonly payload: {
		readonly subgraph: ErSubgraph;
		readonly scope: ErScope;
		readonly truncated: boolean;
		readonly fullNodeCount: number;
		readonly availableObjectTypes: readonly string[];
		readonly availableRelationKinds: readonly string[];
		readonly catalog: readonly ErCatalogEntry[];
	};
}

/** loadError: не удалось загрузить граф. */
export interface ErLoadErrorMessage {
	readonly type: 'loadError';
	readonly payload: { readonly message: string };
}

export type HostToWebviewMessage =
	| ErInitMessage
	| ErSetSubgraphMessage
	| ErLoadingMessage
	| ErGraphReadyMessage
	| ErLoadErrorMessage;

/** Webview готов к работе. */
export interface ErReadyMessage {
	readonly type: 'ready';
}

/** Запрос открыть файл объекта по sourceId и относительному пути. */
export interface ErOpenObjectMessage {
	readonly type: 'openObject';
	readonly payload: { readonly key: string; readonly sourceId: string; readonly relativePath: string };
}

/** Сохранить экспортируемый артефакт (контент сформирован в webview). */
export interface ErExportContentMessage {
	readonly type: 'exportContent';
	readonly payload: {
		readonly format: ErExportFormat;
		readonly fileExtension: string;
		readonly scopeLabel: string;
		readonly content: string;
		/** Если true — content является base64. Иначе UTF-8 текст. */
		readonly base64: boolean;
	};
}

/** Логирование с webview в host (для диагностики). */
export interface ErLogMessage {
	readonly type: 'log';
	readonly payload: { readonly level: 'info' | 'warn' | 'error'; readonly message: string };
}

/** Запрос на пересчёт подграфа: webview сменил фильтры/seeds, host посчитает и пришлёт setSubgraph. */
export interface ErRequestScopeMessage {
	readonly type: 'requestScope';
	readonly payload: { readonly scope: ErScope };
}

/** Открыть quick-pick на host для добавления объекта в текущий scope (режим конструктора). */
export interface ErPickAndAddObjectMessage {
	readonly type: 'pickAndAddObject';
}

export type WebviewToHostMessage =
	| ErReadyMessage
	| ErOpenObjectMessage
	| ErExportContentMessage
	| ErLogMessage
	| ErRequestScopeMessage
	| ErPickAndAddObjectMessage;
