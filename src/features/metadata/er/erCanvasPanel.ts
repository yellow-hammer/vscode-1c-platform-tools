/**
 * Host-side панель ER-canvas (Cytoscape + ELK).
 *
 * Один webview-инстанс на workspace; повторный вызов открывает уже существующую панель.
 *
 * @module er/erCanvasPanel
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../../../shared/logger';
import { supportedErFormats } from './erExporters/exporterRegistry';
import { buildSubgraph, listObjectTypes, listRelationKinds } from './erFilters';
import { loadErGraph } from './erGraphService';
import type { ErExportFormat, ErGraph, ErScope, ErSubgraph } from './erTypes';

/**
 * Жёсткий лимит количества узлов, который мы соглашаемся отрисовать в Cytoscape.
 * При превышении сначала пробуем уменьшить hops, иначе показываем только seeds.
 */
const MAX_RENDER_NODES = 500;

interface OpenErCanvasParams {
	readonly context: vscode.ExtensionContext;
	readonly workspaceRoot: string;
	readonly initialScope: ErScope;
}

interface InitPayload {
	readonly subgraph: ErSubgraph;
	readonly scope: ErScope;
	readonly truncated: boolean;
	readonly fullNodeCount: number;
	readonly availableObjectTypes: readonly string[];
	readonly availableRelationKinds: readonly string[];
	readonly catalog: readonly CatalogEntry[];
	readonly availableFormats: readonly ErExportFormat[];
	readonly defaultFormat: ErExportFormat;
	readonly defaultExportDirRel: string;
}

/** Лёгкий каталог объектов проекта для quick-pick «+ Добавить объект» в режиме конструктора. */
interface CatalogEntry {
	readonly key: string;
	readonly objectType: string;
	readonly name: string;
	readonly synonymRu: string;
}

interface OpenObjectPayload {
	readonly key: string;
	readonly sourceId: string;
	readonly relativePath: string;
}

interface ExportContentPayload {
	readonly format: ErExportFormat;
	readonly fileExtension: string;
	readonly scopeLabel: string;
	readonly content: string;
	readonly base64: boolean;
}

interface InboundMessage {
	readonly type?: string;
	readonly payload?: unknown;
}

interface CanvasInstance {
	readonly panel: vscode.WebviewPanel;
	graph: ErGraph;
	scope: ErScope;
}

let activeCanvas: CanvasInstance | undefined;

/** Открывает панель ER-canvas; если уже открыта, переиспользует и обновляет scope. */
export async function openErCanvasPanel(params: OpenErCanvasParams): Promise<void> {
	const { context, workspaceRoot, initialScope } = params;
	if (activeCanvas) {
		activeCanvas.scope = initialScope;
		activeCanvas.panel.reveal(vscode.ViewColumn.Active);
		await postScopeChange(activeCanvas, initialScope);
		return;
	}

	const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
	const defaultFormat = (cfg.get<string>('metadata.er.defaultExportFormat', 'mermaid') as ErExportFormat) || 'mermaid';
	const exportDirRel = (cfg.get<string>('metadata.er.exportDir', 'docs/schemas') || 'docs/schemas').trim();

	const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview');
	const outRoot = vscode.Uri.joinPath(context.extensionUri, 'out', 'webviews', 'metadataErCanvas');
	const panel = vscode.window.createWebviewPanel(
		'1cMetadataErCanvas',
		'ER: диаграмма',
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [webviewRoot, outRoot],
		}
	);
	const instance: CanvasInstance = {
		panel,
		graph: emptyGraph(workspaceRoot),
		scope: initialScope,
	};
	activeCanvas = instance;

	panel.onDidDispose(() => {
		if (activeCanvas?.panel === panel) {
			activeCanvas = undefined;
		}
	});

	// Панель показывается мгновенно с пустым состоянием — граф грузится в фоне
	const emptyInit: InitPayload = {
		subgraph: { nodes: [], edges: [] },
		scope: initialScope,
		truncated: false,
		fullNodeCount: 0,
		availableObjectTypes: [],
		availableRelationKinds: [],
		catalog: [],
		availableFormats: supportedErFormats(),
		defaultFormat,
		defaultExportDirRel: exportDirRel,
	};
	const nonce = randomUUID();
	panel.webview.html = await loadCanvasHtml(panel.webview, context.extensionUri, emptyInit, nonce);

	panel.webview.onDidReceiveMessage(
		(message: InboundMessage) => {
			void handleMessage(message, instance, context, workspaceRoot, exportDirRel);
		},
		undefined,
		context.subscriptions
	);

	// Загружаем граф в фоне — webview видит статус в своей footer-строке
	void loadAndInitCanvas(instance, context, workspaceRoot, initialScope);
}

/** Загружает граф в фоне и отправляет данные в webview через graphReady. */
async function loadAndInitCanvas(
	instance: CanvasInstance,
	context: vscode.ExtensionContext,
	workspaceRoot: string,
	initialScope: ErScope
): Promise<void> {
	await instance.panel.webview.postMessage({
		type: 'loading',
		payload: { message: 'Загрузка графа метаданных…' },
	});
	try {
		const loadResult = await loadErGraph(context, workspaceRoot, {});
		instance.graph = loadResult.graph;
		const subgraphResult = computeSubgraphForRender(loadResult.graph, initialScope);
		await instance.panel.webview.postMessage({
			type: 'graphReady',
			payload: {
				subgraph: subgraphResult.subgraph,
				scope: subgraphResult.scope,
				truncated: subgraphResult.truncated,
				fullNodeCount: subgraphResult.fullNodeCount,
				availableObjectTypes: listObjectTypes(loadResult.graph),
				availableRelationKinds: listRelationKinds(loadResult.graph),
				catalog: buildCatalog(loadResult.graph),
			},
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		logger.error(`ER canvas: не удалось загрузить граф: ${message}`);
		await instance.panel.webview.postMessage({
			type: 'loadError',
			payload: { message },
		});
	}
}

/** Считает подграф под scope; если узлов > MAX_RENDER_NODES — поэтапно снижает hops, иначе fallback на seeds. */
function computeSubgraphForRender(
	graph: ErGraph,
	scope: ErScope
): { subgraph: ErSubgraph; scope: ErScope; truncated: boolean; fullNodeCount: number } {
	const subgraph = buildSubgraph(graph, scope);
	if (subgraph.nodes.length <= MAX_RENDER_NODES) {
		return { subgraph, scope, truncated: false, fullNodeCount: subgraph.nodes.length };
	}
	const fullNodeCount = subgraph.nodes.length;

	// Для selection-scope пробуем уменьшать hops до тех пор, пока не уложимся в лимит.
	if (scope.kind === 'selection' && scope.hops > 0) {
		for (let hops = scope.hops - 1; hops >= 0; hops--) {
			const reducedScope = { ...scope, hops };
			const reduced = buildSubgraph(graph, reducedScope);
			if (reduced.nodes.length <= MAX_RENDER_NODES) {
				return { subgraph: reduced, scope: reducedScope, truncated: true, fullNodeCount };
			}
		}
	}

	// Последний резерв: только seed-узлы с рёбрами между ними.
	const seedSet = new Set(scope.seeds);
	const fallbackNodes = subgraph.nodes.filter((n) => seedSet.has(n.key));
	const fallbackKeys = new Set(fallbackNodes.map((n) => n.key));
	const fallbackEdges = subgraph.edges.filter(
		(e) => fallbackKeys.has(e.sourceKey) && fallbackKeys.has(e.targetKey)
	);
	return {
		subgraph: { nodes: fallbackNodes, edges: fallbackEdges },
		scope,
		truncated: true,
		fullNodeCount,
	};
}

function buildCatalog(graph: ErGraph): CatalogEntry[] {
	return graph.nodes
		.map((node) => ({
			key: node.key,
			objectType: node.objectType,
			name: node.name,
			synonymRu: node.synonymRu,
		}))
		.sort((a, b) => a.key.localeCompare(b.key, 'ru'));
}

async function postScopeChange(instance: CanvasInstance, scope: ErScope): Promise<void> {
	const result = computeSubgraphForRender(instance.graph, scope);
	instance.scope = result.scope;
	await instance.panel.webview.postMessage({
		type: 'setSubgraph',
		payload: {
			subgraph: result.subgraph,
			scope: result.scope,
			truncated: result.truncated,
			fullNodeCount: result.fullNodeCount,
		},
	});
}

function emptyGraph(projectRoot: string): ErGraph {
	return {
		projectRoot,
		mainSchemaVersion: '',
		mainSchemaVersionFlag: '',
		nodeCount: 0,
		edgeCount: 0,
		nodes: [],
		edges: [],
	};
}

async function handleMessage(
	message: InboundMessage,
	instance: CanvasInstance,
	context: vscode.ExtensionContext,
	workspaceRoot: string,
	defaultExportDirRel: string
): Promise<void> {
	if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
		return;
	}
	if (message.type === 'ready') {
		return;
	}
	if (message.type === 'log') {
		const payload = message.payload as { level?: string; message?: string } | undefined;
		const text = String(payload?.message ?? '');
		if (payload?.level === 'error') {
			logger.warn(`er-canvas: ${text}`);
		} else if (payload?.level === 'warn') {
			logger.warn(`er-canvas: ${text}`);
		} else {
			logger.debug(`er-canvas: ${text}`);
		}
		return;
	}
	if (message.type === 'openObject') {
		const payload = message.payload as OpenObjectPayload | undefined;
		if (!payload?.relativePath) {
			void vscode.window.showInformationMessage(`Файл объекта не найден для ${payload?.key ?? ''}.`);
			return;
		}
		const abs = path.resolve(workspaceRoot, payload.relativePath);
		try {
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
			await vscode.window.showTextDocument(doc, { preview: true });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			void vscode.window.showErrorMessage(`Не удалось открыть ${payload.relativePath}: ${msg}`);
		}
		return;
	}
	if (message.type === 'exportContent') {
		const payload = message.payload as ExportContentPayload | undefined;
		if (!payload) {
			return;
		}
		await saveExport(payload, workspaceRoot, defaultExportDirRel);
		return;
	}
	if (message.type === 'requestScope') {
		const payload = message.payload as { scope?: ErScope } | undefined;
		if (payload?.scope) {
			await postScopeChange(instance, payload.scope);
		}
		return;
	}
	if (message.type === 'pickAndAddObject') {
		await pickAndAddObject(instance);
		return;
	}
}

async function pickAndAddObject(instance: CanvasInstance): Promise<void> {
	const items = instance.graph.nodes
		.map((node) => ({
			label: node.name,
			description: node.synonymRu && node.synonymRu !== node.name ? `«${node.synonymRu}»` : '',
			detail: node.relativePath || '',
			filterText: `${node.key} ${node.name} ${node.synonymRu} ${node.objectType}`,
			key: node.key,
		}))
		.sort((a, b) => a.label.localeCompare(b.label, 'ru'));
	const picked = await vscode.window.showQuickPick(items, {
		title: 'ER: добавить объект на схему',
		placeHolder: 'Начните вводить имя объекта (например, Catalog.Контрагенты)…',
		matchOnDescription: true,
		matchOnDetail: true,
		canPickMany: false,
	});
	if (!picked) {
		return;
	}
	const seeds = uniqueArray([...instance.scope.seeds, picked.key]);
	const nextScope: ErScope = {
		...instance.scope,
		kind: 'selection',
		label: seeds.length === 1 ? seeds[0] : `выбрано: ${seeds.length}`,
		seeds,
		hops: instance.scope.kind === 'selection' ? instance.scope.hops : 0,
	};
	await postScopeChange(instance, nextScope);
}

function uniqueArray(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		if (!seen.has(value)) {
			seen.add(value);
			out.push(value);
		}
	}
	return out;
}

async function saveExport(payload: ExportContentPayload, workspaceRoot: string, defaultExportDirRel: string): Promise<void> {
	const dirAbs = path.resolve(workspaceRoot, defaultExportDirRel);
	await fs.mkdir(dirAbs, { recursive: true });
	const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
	const safeLabel = sanitizeLabel(payload.scopeLabel);
	const fileName = `${stamp}-${safeLabel}.${payload.fileExtension}`;
	const fileAbs = path.join(dirAbs, fileName);
	if (payload.base64) {
		await fs.writeFile(fileAbs, Buffer.from(payload.content, 'base64'));
	} else {
		await fs.writeFile(fileAbs, payload.content, 'utf8');
	}
	const rel = path.relative(workspaceRoot, fileAbs).replaceAll('\\', '/');
	void vscode.window.showInformationMessage(`ER: ${payload.format.toUpperCase()} сохранён: ${rel}`);
}

function sanitizeLabel(label: string): string {
	const value = label.trim().replaceAll(/[^A-Za-z0-9А-Яа-я_\-.]+/g, '_');
	return value.length > 0 ? value : 'scope';
}

async function loadCanvasHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	init: InitPayload,
	nonce: string
): Promise<string> {
	const templateUri = vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-er-canvas.html');
	const bytes = await vscode.workspace.fs.readFile(templateUri);
	const template = new TextDecoder('utf-8').decode(bytes);
	const cssUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-er-canvas.css')
	);
	const jsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'out', 'webviews', 'metadataErCanvas', 'index.js')
	);
	const initialJson = JSON.stringify(init).replaceAll('<', String.raw`\u003c`);
	return template
		.replaceAll('{{CSP_SOURCE}}', webview.cspSource)
		.replaceAll('{{NONCE}}', nonce)
		.replaceAll('{{CSS_URI}}', cssUri.toString())
		.replaceAll('{{JS_URI}}', jsUri.toString())
		.replaceAll('{{INITIAL_JSON}}', initialJson)
		.replaceAll('{{TITLE}}', 'ER: диаграмма');
}
