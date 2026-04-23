/**
 * Сериализация контента диаграммы из webview в форматы экспорта.
 *
 * Mermaid и Drawio формируются из IR (через переиспользование host-side экспортёров).
 * PNG получаем через {@code cy.png()}; SVG строим через нативный браузерный DOM API
 * ({@link document.createElementNS} + {@link XMLSerializer}) — никаких самодельных склеек строк
 * и без GPL-плагина cytoscape-svg.
 *
 * @module webviews/metadataErCanvas/exporters
 */

import type { Core, EdgeSingular, NodeSingular } from 'cytoscape';
import { exportDrawio } from '../../features/metadata/er/erExporters/drawioExporter';
import { exportMermaid } from '../../features/metadata/er/erExporters/mermaidExporter';
import type { ErExportFormat, ErExportRequest, ErExportResult } from '../../features/metadata/er/erTypes';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface WebviewExportPayload {
	readonly format: ErExportFormat;
	readonly fileExtension: string;
	readonly content: string;
	readonly base64: boolean;
}

export function exportFromWebview(
	format: ErExportFormat,
	request: ErExportRequest,
	cy: Core | undefined
): WebviewExportPayload {
	if (format === 'mermaid') {
		return toTextPayload(format, exportMermaid(request));
	}
	if (format === 'drawio') {
		return toTextPayload(format, exportDrawio(request));
	}
	if (!cy) {
		throw new Error('Для экспорта в SVG/PNG нужна отрисованная диаграмма.');
	}
	if (format === 'png') {
		const dataUri = cy.png({ full: true, scale: 2, bg: getBgColor() });
		return { format, fileExtension: 'png', content: stripDataUri(dataUri), base64: true };
	}
	if (format === 'svg') {
		return { format, fileExtension: 'svg', content: buildSvg(cy), base64: false };
	}
	throw new Error(`Неизвестный формат: ${String(format)}`);
}

function toTextPayload(format: ErExportFormat, result: ErExportResult): WebviewExportPayload {
	if (typeof result.content !== 'string') {
		throw new Error('Ожидался строковый контент экспорта.');
	}
	return { format, fileExtension: result.fileExtension, content: result.content, base64: false };
}

function stripDataUri(dataUri: string): string {
	const idx = dataUri.indexOf(',');
	return idx >= 0 ? dataUri.slice(idx + 1) : dataUri;
}

function getBgColor(): string {
	const styles = getComputedStyle(document.body);
	const value = styles.getPropertyValue('--vscode-editor-background').trim();
	return value || '#1e1e1e';
}

interface NodeBox {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

function nodeBox(node: NodeSingular): NodeBox {
	const bb = node.boundingBox({ includeLabels: true });
	return { x: bb.x1, y: bb.y1, width: bb.w, height: bb.h };
}

/**
 * Генерирует SVG-представление текущего графа через нативный DOM API webview.
 *
 * Узлы — прямоугольники с многострочной подписью; рёбра — прямые линии со стрелкой и подписью.
 * Координаты берутся из cytoscape после layout. Сериализация — {@link XMLSerializer},
 * экранирование атрибутов и текста — встроенное в DOM.
 */
function buildSvg(cy: Core): string {
	const padding = 40;
	const bb = cy.elements().boundingBox({ includeLabels: true });
	const width = Math.max(1, bb.w) + padding * 2;
	const height = Math.max(1, bb.h) + padding * 2;
	const offsetX = -bb.x1 + padding;
	const offsetY = -bb.y1 + padding;
	const bg = getBgColor();
	const fg = computedColor('--vscode-editor-foreground', '#cccccc');
	const border = computedColor('--vscode-focusBorder', '#007fd4');
	const dim = computedColor('--vscode-descriptionForeground', '#a0a0a0');

	const doc = document.implementation.createDocument(SVG_NS, 'svg', null);
	const svg = doc.documentElement;
	setAttrs(svg, {
		viewBox: `0 0 ${width.toFixed(0)} ${height.toFixed(0)}`,
		width: width.toFixed(0),
		height: height.toFixed(0),
		'font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
		'font-size': '11',
	});

	const defs = appendChild(svg, 'defs');
	const marker = appendChild(defs, 'marker');
	setAttrs(marker, {
		id: 'arrow',
		viewBox: '0 0 10 10',
		refX: '9',
		refY: '5',
		markerWidth: '8',
		markerHeight: '8',
		orient: 'auto-start-reverse',
	});
	setAttrs(appendChild(marker, 'path'), { d: 'M0,0 L10,5 L0,10 Z', fill: dim });

	setAttrs(appendChild(svg, 'rect'), { width: '100%', height: '100%', fill: bg });

	cy.edges().forEach((edge: EdgeSingular) => {
		const source = edge.source();
		const target = edge.target();
		if (!source || !target || source.length === 0 || target.length === 0) {
			return;
		}
		const sp = source.position();
		const tp = target.position();
		const x1 = sp.x + offsetX;
		const y1 = sp.y + offsetY;
		const x2 = tp.x + offsetX;
		const y2 = tp.y + offsetY;
		setAttrs(appendChild(svg, 'line'), {
			x1: x1.toFixed(1),
			y1: y1.toFixed(1),
			x2: x2.toFixed(1),
			y2: y2.toFixed(1),
			stroke: dim,
			'stroke-width': '1',
			'marker-end': 'url(#arrow)',
		});
		const label = String(edge.data('label') ?? '');
		if (label) {
			const text = appendChild(svg, 'text');
			setAttrs(text, {
				x: ((x1 + x2) / 2).toFixed(1),
				y: ((y1 + y2) / 2).toFixed(1),
				fill: dim,
				'text-anchor': 'middle',
			});
			text.textContent = label.split('\n')[0];
		}
	});

	cy.nodes().forEach((node: NodeSingular) => {
		const data = node.data();
		if (data.nodeKind === 'group') {
			return;
		}
		const box = nodeBox(node);
		const x = box.x + offsetX;
		const y = box.y + offsetY;
		const label = String(data.label ?? '');
		setAttrs(appendChild(svg, 'rect'), {
			x: x.toFixed(1),
			y: y.toFixed(1),
			width: box.width.toFixed(1),
			height: box.height.toFixed(1),
			rx: '6',
			ry: '6',
			fill: bg,
			stroke: border,
			'stroke-width': '1',
		});
		const labelLines = label.split('\n');
		const cx = x + box.width / 2;
		const lineHeight = 13;
		const totalHeight = labelLines.length * lineHeight;
		const startY = y + box.height / 2 - totalHeight / 2 + lineHeight - 3;
		labelLines.forEach((textLine, index) => {
			const text = appendChild(svg, 'text');
			setAttrs(text, {
				x: cx.toFixed(1),
				y: (startY + index * lineHeight).toFixed(1),
				fill: fg,
				'text-anchor': 'middle',
			});
			text.textContent = textLine;
		});
	});

	const xml = new XMLSerializer().serializeToString(svg);
	return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

function appendChild(parent: Element, tag: string): Element {
	const element = parent.ownerDocument.createElementNS(SVG_NS, tag);
	parent.appendChild(element);
	return element;
}

function setAttrs(element: Element, attrs: Record<string, string>): void {
	for (const [name, value] of Object.entries(attrs)) {
		element.setAttribute(name, value);
	}
}

function computedColor(varName: string, fallback: string): string {
	const value = getComputedStyle(document.body).getPropertyValue(varName).trim();
	return value || fallback;
}
