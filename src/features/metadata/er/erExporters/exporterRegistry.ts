/**
 * Реестр экспортёров ER-диаграммы.
 *
 * Поддерживаемые форматы:
 * - {@code mermaid} — Markdown с {@code mermaid}-блоком (генерация в расширении).
 * - {@code drawio} — XML-файл diagrams.net (генерация в расширении).
 * - {@code svg}, {@code png} — генерируются на стороне webview из cytoscape; здесь только перечислены.
 *
 * @module er/erExporters/exporterRegistry
 */

import { exportDrawio } from './drawioExporter';
import { exportMermaid } from './mermaidExporter';
import type { ErExportFormat, ErExportRequest, ErExportResult } from '../erTypes';

const HOST_FORMATS: ReadonlySet<ErExportFormat> = new Set(['mermaid', 'drawio']);
const WEBVIEW_FORMATS: ReadonlySet<ErExportFormat> = new Set(['svg', 'png']);

export function supportedErFormats(): readonly ErExportFormat[] {
	return ['mermaid', 'svg', 'png', 'drawio'];
}

export function isHostExportFormat(format: ErExportFormat): boolean {
	return HOST_FORMATS.has(format);
}

export function isWebviewExportFormat(format: ErExportFormat): boolean {
	return WEBVIEW_FORMATS.has(format);
}

export function exportErDiagram(format: ErExportFormat, request: ErExportRequest): ErExportResult {
	if (format === 'mermaid') {
		return exportMermaid(request);
	}
	if (format === 'drawio') {
		return exportDrawio(request);
	}
	throw new Error(`Формат ${format} экспортируется на стороне webview-canvas (svg/png).`);
}
