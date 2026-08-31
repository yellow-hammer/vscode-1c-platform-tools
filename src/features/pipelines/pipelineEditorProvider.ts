/**
 * Визуальный редактор пайплайнов (custom editor поверх `.1cpt/pipelines.json`).
 *
 * Полотно с блоками и связями: блок - шаг (команда расширения, команда
 * оболочки, пауза), связь - переход по исходу шага. Блоки таскаются мышью,
 * связи тянутся от выходного порта к входному, ветка выбирается портом:
 * успех, ошибка, в любом случае. Слева палитра действий, справа свойства
 * выделенного блока.
 *
 * Файл остаётся источником истины: правки формы пишутся в документ целиком,
 * а изменения документа перерисовывают полотно. Во время прогона блоки
 * подсвечиваются по событиям выполнения.
 */

import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { readCommandCatalog, CommandCatalogEntry } from '../../shared/commandCatalog';
import { serializePipelines } from '../../shared/pipelines/pipelineFile';
import { normalizePipelines, Pipeline } from '../../shared/pipelines/pipelineTypes';
import { onPipelineRunEvent } from '../../shared/pipelines/pipelineEvents';
import { chromeScript, chromeStyles, saveBarHtml, CHROME_LABELS } from '../editors/webviewChrome';
import { registerFormPanel } from '../editors/formPanels';

const log = logger.scope('pipelines');

export const PIPELINE_EDITOR_VIEW_TYPE = '1c-platform-tools.pipelineEditor';

/** Сообщения из формы в расширение */
type WebviewMessage =
	| { type: 'save'; data: Pipeline[] }
	| { type: 'run'; pipelineId: string }
	| { type: 'error'; message: string }
	| { type: 'openJson' };

/** Модель для формы */
interface EditorModel {
	pipelines: Pipeline[];
	catalog: CommandCatalogEntry[];
	error?: string;
}

export class PipelineEditorProvider implements vscode.CustomTextEditorProvider {
	/** Открытые полотна: команда открытия просит выделить нужную цепочку */
	private static readonly panels = new Set<vscode.WebviewPanel>();

	/** Цепочка, которую нужно выделить, когда полотно откроется */
	private static pending: string | undefined;

	/**
	 * Просит полотно выделить цепочку.
	 *
	 * Панель могла ещё не открыться: тогда запрос ждёт её появления, иначе клик
	 * по цепочке в дереве открывал бы редактор на первой попавшейся.
	 *
	 * @param pipelineId - Идентификатор цепочки
	 */
	static revealPipeline(pipelineId: string): void {
		if (PipelineEditorProvider.panels.size === 0) {
			PipelineEditorProvider.pending = pipelineId;
			return;
		}
		for (const panel of PipelineEditorProvider.panels) {
			void panel.webview.postMessage({ type: 'select', pipelineId });
		}
	}

	/**
	 * Регистрирует редактор пайплайнов.
	 *
	 * @returns Disposable регистрации
	 */
	static register(): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			PIPELINE_EDITOR_VIEW_TYPE,
			new PipelineEditorProvider(),
			{ webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
		);
	}

	/**
	 * Открывает документ полотном.
	 *
	 * @param document - Файл пайплайнов
	 * @param webviewPanel - Панель редактора
	 */
	async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel
	): Promise<void> {
		webviewPanel.webview.options = { enableScripts: true };
		webviewPanel.webview.html = buildHtml();

		const post = (): void => {
			void webviewPanel.webview.postMessage({ type: 'model', model: this.buildModel(document) });
		};

		const subscriptions = [
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.uri.toString() === document.uri.toString()) {
					post();
				}
			}),
			onPipelineRunEvent((event) => {
				void webviewPanel.webview.postMessage({ type: 'run', event });
			}),
		];
		PipelineEditorProvider.panels.add(webviewPanel);
		registerFormPanel(webviewPanel);
		webviewPanel.onDidDispose(() => {
			PipelineEditorProvider.panels.delete(webviewPanel);
			subscriptions.forEach((item) => item.dispose());
		});

		webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
			if (message.type === 'save') {
				await this.save(document, message.data);
				void webviewPanel.webview.postMessage({ type: 'saved' });
				post();
				// Дерево команд показывает сохранённое: обновляем сразу, не дожидаясь наблюдателя за файлами
				await vscode.commands.executeCommand('1c-platform-tools.tools.refresh');
				return;
			}
			if (message.type === 'run') {
				await vscode.commands.executeCommand('1c-platform-tools.pipelines.run', {
					pipeline: message.pipelineId,
				});
				return;
			}
			if (message.type === 'error') {
				log.error(`Ошибка формы редактора: ${message.message}`);
				return;
			}
			if (message.type === 'openJson') {
				await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
			}
		});

		post();

		if (PipelineEditorProvider.pending !== undefined) {
			void webviewPanel.webview.postMessage({ type: 'select', pipelineId: PipelineEditorProvider.pending });
			PipelineEditorProvider.pending = undefined;
		}
	}

	/**
	 * Строит модель формы по тексту документа.
	 *
	 * @param document - Файл пайплайнов
	 * @returns Модель с цепочками и каталогом команд
	 */
	private buildModel(document: vscode.TextDocument): EditorModel {
		const catalog = readCommandCatalog();
		const text = document.getText().trim();
		if (text === '') {
			return { pipelines: [], catalog };
		}
		try {
			return { pipelines: normalizePipelines(JSON.parse(text)), catalog };
		} catch (error) {
			return {
				pipelines: [],
				catalog,
				error: `Файл не разбирается как JSON: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	/**
	 * Записывает цепочки в документ и сохраняет его.
	 *
	 * @param document - Файл пайплайнов
	 * @param pipelines - Новое содержимое
	 */
	private async save(document: vscode.TextDocument, pipelines: Pipeline[]): Promise<void> {
		const next = serializePipelines(normalizePipelines({ pipelines }));
		if (next === document.getText()) {
			return;
		}
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), next);
		await vscode.workspace.applyEdit(edit);
		await document.save();
	}
}

/** HTML редактора: полотно и палитра в инлайн-скрипте, правки уходят в extension. */
function buildHtml(): string {
	const nonce = Math.random().toString(36).slice(2);
	return /* html */ `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
${chromeStyles()}
	.chrome-body { grid-template-columns: 236px minmax(0, 1fr) 288px; }
	/* Правая колонка: свойства сверху, список цепочек снизу со своим скроллом,
	   чтобы длинный список не утаскивал свойства и палитру вниз */
	.side.right { padding: 0; gap: 0; }
	.side.right .inspector { flex: 1; min-height: 0; overflow: auto; padding: 12px; }
	.side.right .pipelines { border-top: 1px solid var(--line); padding: 10px 12px 12px;
		max-height: 45%; overflow: auto; flex-shrink: 0; }

	.card { display: flex; gap: 9px; align-items: flex-start; padding: 7px 8px; border-radius: 6px; cursor: pointer;
		border: 1px solid transparent; }
	.card:hover { background: var(--vscode-list-hoverBackground); border-color: var(--line); }
	.card .glyph { width: 20px; height: 20px; border-radius: 5px; flex-shrink: 0; display: flex; align-items: center;
		justify-content: center; font-size: 0.75em; color: #16181d; font-weight: 700; }
	.card .text { min-width: 0; }
	.card .sub { font-family: var(--vscode-editor-font-family); font-size: 0.72em; color: var(--vscode-descriptionForeground);
		overflow-wrap: anywhere; margin-top: 2px; }
	.group-caption { font-size: 0.68em; text-transform: uppercase; letter-spacing: 0.06em;
		color: var(--vscode-descriptionForeground); margin: 12px 0 2px; padding-left: 2px; }

	.stage { position: relative; overflow: hidden; }
	.canvas { position: absolute; inset: 0; cursor: grab;
		background-image: radial-gradient(circle, var(--line) 1px, transparent 1px);
		background-size: 22px 22px; }
	.canvas.panning { cursor: grabbing; }
	.world { position: absolute; transform-origin: 0 0; }
	svg.links { position: absolute; overflow: visible; pointer-events: none; left: 0; top: 0; width: 1px; height: 1px; }
	svg.links path.hit { stroke: transparent; stroke-width: 14; fill: none; pointer-events: stroke; cursor: pointer; }
	svg.links path.line { fill: none; stroke-width: 2; stroke-linecap: round; }
	svg.links path.line.success { stroke: var(--ok); }
	svg.links path.line.error { stroke: var(--fail); }
	svg.links path.line.always { stroke: var(--vscode-descriptionForeground); stroke-dasharray: 6 4; }
	svg.links path.line.selected { stroke-width: 3.5; filter: drop-shadow(0 0 4px currentColor); }
	.zoom { position: absolute; right: 14px; bottom: 14px; z-index: 3; display: flex; flex-direction: column; gap: 4px; }

	.node { position: absolute; width: 208px; border-radius: 9px;
		background: color-mix(in srgb, var(--accent) 10%, var(--vscode-editorWidget-background, #252526));
		border: 1px solid var(--line); box-shadow: 0 3px 10px #0005; cursor: grab; user-select: none; overflow: visible;
		transition: box-shadow 0.12s ease, border-color 0.12s ease; }
	.node::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
		border-radius: 9px 0 0 9px; background: var(--accent); }
	.node:hover { box-shadow: 0 5px 16px #0007; }
	.node.selected { border-color: var(--vscode-focusBorder); box-shadow: 0 0 0 1px var(--vscode-focusBorder), 0 5px 16px #0007; }
	.node.disabled { opacity: 0.45; }
	.node.blank { border-style: dashed; }
	.node .head { display: flex; gap: 7px; align-items: center; padding: 7px 10px 4px 13px; font-size: 0.7em;
		text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); }
	.node .head .glyph { width: 16px; height: 16px; border-radius: 4px; background: var(--accent); color: #16181d;
		display: flex; align-items: center; justify-content: center; font-size: 0.85em; font-weight: 700; }
	.node .head .badge { margin-left: auto; font-size: 0.95em; }
	.node .title { padding: 0 10px 9px 13px; font-size: 0.93em; line-height: 1.32; overflow-wrap: anywhere; }
	.node .sub { font-family: var(--vscode-editor-font-family); font-size: 0.72em; color: var(--vscode-descriptionForeground);
		margin-top: 3px; overflow-wrap: anywhere; }
	.node.running { border-color: var(--vscode-charts-blue, #3794ff); animation: pulse 1.1s ease-in-out infinite; }
	.node.ok { border-color: var(--ok); }
	.node.failed { border-color: var(--fail); }
	@keyframes pulse {
		0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--vscode-charts-blue, #3794ff) 60%, transparent), 0 3px 10px #0005; }
		50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--vscode-charts-blue, #3794ff) 12%, transparent), 0 3px 10px #0005; }
	}

	.port { position: absolute; width: 11px; height: 11px; border-radius: 50%; box-sizing: border-box;
		border: 2px solid var(--vscode-editorWidget-background, #252526); transition: transform 0.1s ease; }
	.port.in { left: -6px; top: 50%; margin-top: -5.5px; background: var(--vscode-descriptionForeground); }
	.port.out { right: -6px; cursor: crosshair; }
	.port.out.success { background: var(--ok); top: 38%; margin-top: -5.5px; }
	.port.out.error { background: var(--fail); top: 72%; margin-top: -5.5px; }
	.port.out:hover { transform: scale(1.45); }

	.report { position: absolute; right: 14px; top: 56px; width: 320px; max-height: 60%; overflow: auto; z-index: 4;
		background: var(--vscode-editorWidget-background, #252526); border: 1px solid var(--line); border-radius: 8px;
		box-shadow: 0 6px 18px #0007; padding: 10px 12px; font-size: 0.88em; }
	.report.hidden { display: none; }
	.report h3 { margin: 0 0 8px; font-size: 0.95em; display: flex; align-items: center; gap: 8px; }
	.report h3 button { margin-left: auto; }
	.report .row { display: flex; gap: 8px; padding: 3px 0; border-bottom: 1px solid var(--line); }
	.report .row:last-child { border-bottom: none; }
	.report .row .mark { width: 14px; flex-shrink: 0; }
	.report .row .time { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 0.85em; }
	.report .row.failed .mark { color: var(--fail); }
	.report .row.ok .mark { color: var(--ok); }
	.problems { padding: 8px 10px; margin-bottom: 10px; border-radius: 6px;
		background: color-mix(in srgb, var(--fail) 12%, transparent); border: 1px solid var(--fail);
		font-size: 0.85em; line-height: 1.45; }
	.node.invalid { border-color: var(--fail); border-style: dashed; }

	.legend { display: flex; gap: 12px; font-size: 0.75em; color: var(--vscode-descriptionForeground); margin-top: 10px; }
	.legend span { display: flex; gap: 5px; align-items: center; }
	.legend i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
</style>
</head>
<body>
<div class="chrome">
	<div class="toolbar">
		<span class="title" id="title"></span>
		<button class="primary" id="runButton">▶ Запустить</button>
		<button id="layoutButton" title="Разложить блоки по потоку">Разложить</button>
		<button id="reportButton" title="Отчёт последнего прогона">Отчёт</button>
		<button id="jsonButton" title="Открыть файл как обычный JSON">${CHROME_LABELS.json}</button>
	</div>
	<div class="chrome-body">
		<div class="side left">
			<div id="paletteBlock">
				<h2>Действия</h2>
				<div id="actions"></div>
				<h2>Команды 1С</h2>
				<input type="text" id="paletteFilter" placeholder="Поиск команды…">
				<div id="palette"></div>
			</div>
		</div>
		<div class="stage">
			<div class="canvas" id="canvas">
				<div class="world" id="world">
					<svg class="links" id="links">
						<defs>
							<marker id="arrow-success" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
								<path d="M 0 0 L 8 4 L 0 8 z" fill="var(--ok)"></path>
							</marker>
							<marker id="arrow-error" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
								<path d="M 0 0 L 8 4 L 0 8 z" fill="var(--fail)"></path>
							</marker>
							<marker id="arrow-always" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
								<path d="M 0 0 L 8 4 L 0 8 z" fill="var(--vscode-descriptionForeground)"></path>
							</marker>
						</defs>
					</svg>
				</div>
			</div>
			<div class="report hidden" id="report"></div>
			<div class="zoom">
				<button class="round" id="zoomIn" title="Приблизить">＋</button>
				<button class="round" id="zoomOut" title="Отдалить">−</button>
				<button class="round" id="fitButton" title="Вписать в экран">⤢</button>
			</div>
		</div>
		<div class="side right">
			<div class="inspector" id="inspector"></div>
			<div class="pipelines">
				<h2>Пайплайны <button class="round" id="addPipeline" title="Добавить пайплайн">${CHROME_LABELS.add}</button></h2>
				<div id="list"></div>
			</div>
		</div>
	</div>
	${saveBarHtml()}
</div>
<script nonce="${nonce}">
${chromeScript()}
const NODE_WIDTH = 208;
const FALLBACK_HEIGHT = 66;
const KIND = {
	command: { label: 'команда 1С', glyph: '1C' },
	shell: { label: 'оболочка', glyph: '>_', accent: '#9E9E9E' },
	confirm: { label: 'пауза', glyph: '?', accent: '#D7BA7D' },
};

// Цвет группы: блоки одного раздела 1С читаются одним взглядом
const GROUP_COLORS = {
	'Информационная база': '#4EC9B0',
	'Информационные базы': '#4EC9B0',
	'Конфигурация': '#569CD6',
	'Расширения': '#C586C0',
	'Внешние файлы': '#DCDCAA',
	'Тестирование': '#9CDCFE',
	'Сеансы': '#F0A868',
	'Поддержка': '#B5CEA8',
	'Поставка': '#B5CEA8',
	'Зависимости': '#CE9178',
	'Запуск': '#6BB86B',
	'Отладка': '#D16969',
	'Служебные файлы': '#8A8A8A',
	'Установить версию': '#D7BA7D',
	'Автономный сервер': '#4FC1FF',
	'Конфигурации запуска': '#89A9E8',
	'Задачи': '#89A9E8',
	'Внешние компоненты': '#8A8A8A',
	'Окружение': '#4FC1FF',
	'Пайплайны': '#C586C0',
};
const FALLBACK_COLORS = ['#569CD6', '#4EC9B0', '#C586C0', '#DCDCAA', '#CE9178', '#9CDCFE', '#B5CEA8', '#F0A868'];

function groupOf(entry) {
	return (entry && entry.category ? entry.category : 'Прочее').replace(/^1C:\s*/, '');
}

function colorForGroup(group) {
	if (GROUP_COLORS[group]) { return GROUP_COLORS[group]; }
	let hash = 0;
	for (const char of group) { hash = (hash * 31 + char.charCodeAt(0)) % 9973; }
	return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

function accentOf(node) {
	const kind = KIND[node.type] || KIND.command;
	if (kind.accent) { return kind.accent; }
	return colorForGroup(groupOf(catalog.find((item) => item.id === node.command)));
}

let catalog = [];
let modelError;
let baseline = [];
let draft = [];
let selectedPipelineId;
let selectedNodeId;
let selectedEdgeIndex = -1;
let view = { x: 40, y: 40, scale: 1 };
let runStatus = new Map();
let sizes = new Map();
let drag;
let linking;
let pendingRun;
/** Отчёт последнего прогона: показывается по кнопке и сам после завершения */
let lastReport;
let reportVisible = false;

const canvas = document.getElementById('canvas');
const world = document.getElementById('world');
const links = document.getElementById('links');

window.addEventListener('message', (event) => {
	const data = event.data;
	if (data.type === 'model') {
		catalog = data.model.catalog;
		modelError = data.model.error;
		const dirty = isDirty();
		baseline = data.model.pipelines;
		if (!dirty) { draft = JSON.parse(JSON.stringify(baseline)); }
		renderAll();
		return;
	}
	if (data.type === 'saved') {
		saveStatus = 'Сохранено';
		saveStatusKind = 'ok';
		renderAll();
		// Запуск ждал записи файла: цепочка читается с диска
		if (pendingRun) {
			post({ type: 'run', pipelineId: pendingRun });
			pendingRun = undefined;
		}
		return;
	}
	if (data.type === 'select') {
		if (draft.some((item) => item.id === data.pipelineId)) {
			selectedPipelineId = data.pipelineId;
			selectedNodeId = undefined;
			renderAll();
			fitToView();
		}
		return;
	}
	if (data.type === 'run') { applyRunEvent(data.event); }
});

document.getElementById('addPipeline').addEventListener('click', () => {
	const used = draft.map((item) => item.id);
	let id = 'pipeline';
	let suffix = 2;
	while (used.includes(id)) { id = 'pipeline-' + suffix; suffix += 1; }
	draft.push({ id, name: 'Новый пайплайн', nodes: [], edges: [] });
	selectedPipelineId = id;
	selectedNodeId = undefined;
	commit();
});
document.getElementById('paletteFilter').addEventListener('input', renderPalette);
document.getElementById('runButton').addEventListener('click', () => {
	const pipeline = current();
	if (!pipeline) { return; }
	// Запускается то, что записано в файле: несохранённые правки сначала уходят на диск
	if (isDirty()) {
		pendingRun = pipeline.id;
		save();
		return;
	}
	post({ type: 'run', pipelineId: pipeline.id });
});
document.getElementById('layoutButton').addEventListener('click', () => { autoLayout(); commit(); fitToView(); });
document.getElementById('reportButton').addEventListener('click', () => {
	reportVisible = !reportVisible;
	renderReport();
});
document.getElementById('fitButton').addEventListener('click', () => { fitToView(); });
document.getElementById('zoomIn').addEventListener('click', () => zoomBy(1.15));
document.getElementById('zoomOut').addEventListener('click', () => zoomBy(1 / 1.15));

function removePipeline(pipelineId) {
	draft = draft.filter((item) => item.id !== pipelineId);
	if (selectedPipelineId === pipelineId) {
		selectedPipelineId = draft.length ? draft[0].id : undefined;
		selectedNodeId = undefined;
	}
	commit();
}


function current() { return draft.find((item) => item.id === selectedPipelineId); }
function nodeById(id) { const pipeline = current(); return pipeline && pipeline.nodes.find((node) => node.id === id); }
function kindOf(node) { return KIND[node.type] || KIND.command; }

function renderAll() {
	if (!current() && draft.length > 0) { selectedPipelineId = draft[0].id; }
	const pipeline = current();
	const hasPipeline = pipeline !== undefined;
	document.getElementById('title').textContent = hasPipeline ? pipeline.name : 'Пайплайны';
	// Без выбранной цепочки палитра и действия полотна бесполезны
	document.getElementById('paletteBlock').style.display = hasPipeline ? '' : 'none';
	for (const id of ['runButton', 'layoutButton', 'reportButton']) {
		document.getElementById(id).style.display = hasPipeline ? '' : 'none';
	}
	renderPipelineList();
	renderActions();
	renderPalette();
	renderStage();
	renderInspector();
	renderSaveBar();
}

/**
 * Правка поля инспектора: перерисовывается всё, кроме самого инспектора.
 * Пересборка полей крала бы фокус — Tab не доходил до следующего поля. Значения
 * приходят по вводу, поэтому список и полотно обновляются по ходу набора.
 */
function fieldEdited() {
	saveStatus = '';
	saveStatusKind = '';
	const pipeline = current();
	document.getElementById('title').textContent = pipeline ? pipeline.name : 'Пайплайны';
	renderPipelineList();
	renderStage();
	renderSaveBar();
}

function renderPipelineList() {
	const host = document.getElementById('list');
	host.textContent = '';
	if (draft.length === 0) {
		host.appendChild(hint('Пайплайнов нет. Создайте первый кнопкой ＋'));
		return;
	}
	for (const pipeline of draft) {
		const first = pipeline.nodes[0];
		const kind = first ? (KIND[first.type] || KIND.command) : undefined;
		host.appendChild(listItem({
			title: pipeline.name,
			subtitle: pipeline.nodes.length + ' ' + stepsWord(pipeline.nodes.length),
			color: first ? (kind.accent || colorForGroup(groupOf(catalog.find((item) => item.id === first.command)))) : undefined,
			active: pipeline.id === selectedPipelineId,
			onSelect: () => {
				selectedPipelineId = pipeline.id;
				selectedNodeId = undefined;
				selectedEdgeIndex = -1;
				runStatus = new Map();
				renderAll();
				fitToView();
			},
			onRemove: () => removePipeline(pipeline.id),
		}));
	}
}

/** Склоняет слово «шаг» по количеству */
function stepsWord(count) {
	const tail = count % 100;
	if (tail >= 11 && tail <= 14) { return 'шагов'; }
	const last = count % 10;
	if (last === 1) { return 'шаг'; }
	if (last >= 2 && last <= 4) { return 'шага'; }
	return 'шагов';
}

function card(kind, title, subtitle, onAdd, accent) {
	const item = document.createElement('div');
	item.className = 'card';
	item.title = 'Добавить блок на полотно';
	const glyph = document.createElement('span');
	glyph.className = 'glyph';
	glyph.style.background = accent;
	glyph.textContent = KIND[kind].glyph;
	const text = document.createElement('div');
	text.className = 'text';
	const name = document.createElement('div');
	name.textContent = title;
	text.appendChild(name);
	if (subtitle) {
		const sub = document.createElement('div');
		sub.className = 'sub';
		sub.textContent = subtitle;
		text.appendChild(sub);
	}
	item.appendChild(glyph);
	item.appendChild(text);
	item.addEventListener('click', onAdd);
	return item;
}

function renderActions() {
	const host = document.getElementById('actions');
	host.textContent = '';
	host.appendChild(card('shell', 'Команда оболочки', 'выполняется в корне проекта',
		() => addNode({ type: 'shell', script: '' }), KIND.shell.accent));
	host.appendChild(card('confirm', 'Пауза с подтверждением', 'ждёт ответа пользователя',
		() => addNode({ type: 'confirm', message: 'Продолжить выполнение пайплайна?' }), KIND.confirm.accent));
}

function renderPalette() {
	const host = document.getElementById('palette');
	host.textContent = '';
	const filter = document.getElementById('paletteFilter').value.trim().toLowerCase();
	const parts = filter ? filter.split(/\\s+/) : [];
	const groups = new Map();

	for (const entry of catalog) {
		const haystack = ((entry.title || '') + ' ' + entry.id + ' ' + (entry.category || '')).toLowerCase();
		if (parts.length && !parts.every((part) => haystack.includes(part))) { continue; }
		const group = (entry.category || 'Прочее').replace(/^1C:\\s*/, '');
		if (!groups.has(group)) { groups.set(group, []); }
		groups.get(group).push(entry);
	}

	if (groups.size === 0) {
		host.appendChild(hint('Ничего не нашлось'));
		return;
	}
	for (const [group, entries] of groups) {
		const caption = document.createElement('div');
		caption.className = 'group-caption';
		caption.textContent = group;
		host.appendChild(caption);
		for (const entry of entries) {
			host.appendChild(card('command', entry.title || entry.id, entry.id,
				() => addNode({ type: 'command', command: entry.id }), colorForGroup(group)));
		}
	}
}

function addNode(base) {
	const pipeline = current();
	if (!pipeline) { return; }
	const used = pipeline.nodes.map((node) => node.id);
	let index = pipeline.nodes.length + 1;
	while (used.includes('n' + index)) { index += 1; }
	const previous = pipeline.nodes[pipeline.nodes.length - 1];
	const spot = previous
		? { x: (previous.x || 0) + NODE_WIDTH + 70, y: previous.y || 0 }
		: viewCenter();
	const node = { id: 'n' + index, ...base, x: spot.x, y: spot.y };
	pipeline.nodes.push(node);
	// Новый блок цепляем к последнему: чаще всего добавляют продолжение цепочки
	if (previous) { pipeline.edges.push({ from: previous.id, to: node.id }); }
	selectedNodeId = node.id;
	selectedEdgeIndex = -1;
	commit();
	revealNode(node);
}

/** Свободное место в середине видимой части полотна */
function viewCenter() {
	const rect = canvas.getBoundingClientRect();
	const center = toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
	return { x: Math.round(center.x - NODE_WIDTH / 2), y: Math.round(center.y - 30) };
}

/** Двигает полотно так, чтобы блок оказался в видимой части */
function revealNode(node) {
	const rect = canvas.getBoundingClientRect();
	const size = sizeOf(node);
	const left = view.x + (node.x || 0) * view.scale;
	const top = view.y + (node.y || 0) * view.scale;
	const right = left + size.width * view.scale;
	const bottom = top + size.height * view.scale;
	const margin = 40;
	const topMargin = 60;
	if (left < margin) { view.x += margin - left; }
	if (top < topMargin) { view.y += topMargin - top; }
	if (right > rect.width - margin) { view.x -= right - (rect.width - margin); }
	if (bottom > rect.height - margin) { view.y -= bottom - (rect.height - margin); }
	applyTransform();
}

/** Блок без действия: команда не выбрана или строка оболочки пустая */
function isBlank(node) {
	if (node.type === 'shell') { return !(node.script || '').trim(); }
	if (node.type === 'command') { return !node.command; }
	return false;
}

/** Параметры цепочки в текст «имя=значение» по строкам */
function paramsToText(params) {
	if (!params) { return ''; }
	return Object.entries(params).map(([name, value]) => name + '=' + value).join('\\n');
}

/** Разбор текста «имя=значение» в параметры цепочки */
function textToParams(text) {
	const params = {};
	for (const line of String(text).split('\\n')) {
		const index = line.indexOf('=');
		if (index <= 0) { continue; }
		const name = line.slice(0, index).trim();
		if (name) { params[name] = line.slice(index + 1).trim(); }
	}
	return params;
}

function nodeTitle(node) {
	if (node.name) { return node.name; }
	if (node.type === 'shell') { return node.script || 'Команда оболочки не задана'; }
	if (node.type === 'confirm') { return node.message || 'Подтверждение'; }
	const entry = catalog.find((item) => item.id === node.command);
	return (entry && entry.title) || node.command || 'Команда';
}

function renderStage() {
	for (const element of [...world.querySelectorAll('.node')]) { element.remove(); }
	const pipeline = current();
	updateUnreachable(pipeline);
	if (!pipeline || modelError) { clearLinks(); return; }

	for (const node of pipeline.nodes) { world.appendChild(renderNode(node)); }
	measureNodes();
	renderLinks();
	applyTransform();
}

function measureNodes() {
	sizes = new Map();
	for (const element of world.querySelectorAll('.node')) {
		sizes.set(element.dataset.nodeId, { width: element.offsetWidth, height: element.offsetHeight });
	}
}

function sizeOf(node) {
	return sizes.get(node.id) || { width: NODE_WIDTH, height: FALLBACK_HEIGHT };
}

function renderNode(node) {
	const kind = kindOf(node);
	const element = document.createElement('div');
	const status = runStatus.get(node.id);
	element.className = 'node'
		+ (node.id === selectedNodeId ? ' selected' : '')
		+ (node.enabled === false ? ' disabled' : '')
		+ (isBlank(node) ? ' blank' : '')
		+ (unreachableNodes.has(node.id) ? ' invalid' : '')
		+ (status ? ' ' + status : '');
	element.style.setProperty('--accent', accentOf(node));
	element.style.left = (node.x || 0) + 'px';
	element.style.top = (node.y || 0) + 'px';
	element.dataset.nodeId = node.id;

	const head = document.createElement('div');
	head.className = 'head';
	const glyph = document.createElement('span');
	glyph.className = 'glyph';
	glyph.textContent = kind.glyph;
	const label = document.createElement('span');
	label.textContent = kind.label;
	head.appendChild(glyph);
	head.appendChild(label);
	if (node.join === 'all') {
		const join = document.createElement('span');
		join.textContent = '⋈';
		join.title = 'Ждёт все входящие ветки';
		join.style.marginLeft = '4px';
		head.appendChild(join);
	}
	if (status) {
		const badge = document.createElement('span');
		badge.className = 'badge';
		badge.textContent = status === 'running' ? '⏳' : status === 'ok' ? '✓' : '✕';
		badge.style.color = status === 'ok' ? 'var(--ok)' : status === 'failed' ? 'var(--fail)' : 'inherit';
		head.appendChild(badge);
	}
	element.appendChild(head);

	const title = document.createElement('div');
	title.className = 'title';
	title.textContent = nodeTitle(node);
	if (node.type === 'command' && node.command && node.name) {
		const sub = document.createElement('div');
		sub.className = 'sub';
		sub.textContent = node.command;
		title.appendChild(sub);
	}
	if (node.type === 'shell' && node.name && node.script) {
		const sub = document.createElement('div');
		sub.className = 'sub';
		sub.textContent = node.script;
		title.appendChild(sub);
	}
	element.appendChild(title);

	const inPort = document.createElement('div');
	inPort.className = 'port in';
	inPort.title = 'Вход';
	element.appendChild(inPort);

	for (const branch of ['success', 'error']) {
		const port = document.createElement('div');
		port.className = 'port out ' + branch;
		port.title = branch === 'success' ? 'Потянуть связь: переход при успехе' : 'Потянуть связь: переход при ошибке';
		port.addEventListener('pointerdown', (event) => startLink(event, node, branch));
		element.appendChild(port);
	}

	element.addEventListener('pointerdown', (event) => startDrag(event, node, element));
	return element;
}

function portPosition(node, branch) {
	const size = sizeOf(node);
	return {
		x: (node.x || 0) + size.width,
		y: (node.y || 0) + size.height * (branch === 'error' ? 0.72 : 0.38),
	};
}

function inputPosition(node) {
	const size = sizeOf(node);
	return { x: node.x || 0, y: (node.y || 0) + size.height / 2 };
}

function clearLinks() {
	for (const path of [...links.querySelectorAll('path')]) { path.remove(); }
}

function renderLinks(preview) {
	const pipeline = current();
	clearLinks();
	if (!pipeline) { return; }

	pipeline.edges.forEach((edge, index) => {
		const from = nodeById(edge.from);
		const to = nodeById(edge.to);
		if (!from || !to) { return; }
		const branch = edge.on || 'success';
		const start = portPosition(from, branch === 'error' ? 'error' : 'success');
		const end = inputPosition(to);
		const d = curve(start, end);

		const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		hit.setAttribute('d', d);
		hit.setAttribute('class', 'hit');
		hit.addEventListener('click', (event) => {
			event.stopPropagation();
			selectedEdgeIndex = index;
			selectedNodeId = undefined;
			renderAll();
		});
		links.appendChild(hit);

		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', d);
		path.setAttribute('class', 'line ' + branch + (index === selectedEdgeIndex ? ' selected' : ''));
		path.setAttribute('marker-end', 'url(#arrow-' + branch + ')');
		links.appendChild(path);
	});

	if (preview) {
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', curve(preview.start, preview.end));
		path.setAttribute('class', 'line ' + preview.branch);
		path.setAttribute('opacity', '0.65');
		links.appendChild(path);
	}
}

function curve(start, end) {
	const delta = Math.max(45, Math.abs(end.x - start.x) / 2);
	return 'M ' + start.x + ' ' + start.y
		+ ' C ' + (start.x + delta) + ' ' + start.y + ', ' + (end.x - delta) + ' ' + end.y
		+ ', ' + end.x + ' ' + end.y;
}

function startDrag(event, node, element) {
	if (event.target.classList.contains('port')) { return; }
	event.stopPropagation();
	selectedNodeId = node.id;
	selectedEdgeIndex = -1;
	renderInspector();
	for (const other of world.querySelectorAll('.node')) { other.classList.remove('selected'); }
	element.classList.add('selected');
	const point = toWorld(event.clientX, event.clientY);
	drag = { node, element, dx: point.x - (node.x || 0), dy: point.y - (node.y || 0), moved: false };
}

function startLink(event, node, branch) {
	event.stopPropagation();
	event.preventDefault();
	linking = { from: node, branch, end: portPosition(node, branch) };
}

canvas.addEventListener('pointerdown', (event) => {
	if (event.target === canvas || event.target === world || event.target === links) {
		selectedNodeId = undefined;
		selectedEdgeIndex = -1;
		renderInspector();
		renderStage();
		drag = { pan: true, startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y };
		canvas.classList.add('panning');
	}
});

window.addEventListener('pointermove', (event) => {
	if (linking) {
		linking.end = toWorld(event.clientX, event.clientY);
		renderLinks({ start: portPosition(linking.from, linking.branch), end: linking.end, branch: linking.branch });
		return;
	}
	if (!drag) { return; }
	if (drag.pan) {
		view.x = drag.originX + (event.clientX - drag.startX);
		view.y = drag.originY + (event.clientY - drag.startY);
		applyTransform();
		return;
	}
	const point = toWorld(event.clientX, event.clientY);
	drag.node.x = Math.round(point.x - drag.dx);
	drag.node.y = Math.round(point.y - drag.dy);
	drag.element.style.left = drag.node.x + 'px';
	drag.element.style.top = drag.node.y + 'px';
	drag.moved = true;
	renderLinks();
});

window.addEventListener('pointerup', (event) => {
	canvas.classList.remove('panning');
	if (linking) {
		const target = document.elementFromPoint(event.clientX, event.clientY);
		const nodeElement = target && target.closest ? target.closest('.node') : undefined;
		const pipeline = current();
		if (nodeElement && pipeline) {
			const to = pipeline.nodes.find((item) => item.id === nodeElement.dataset.nodeId);
			if (to && to.id !== linking.from.id) {
				const exists = pipeline.edges.some((edge) =>
					edge.from === linking.from.id && edge.to === to.id && (edge.on || 'success') === linking.branch);
				if (!exists) {
					const edge = { from: linking.from.id, to: to.id };
					if (linking.branch === 'error') { edge.on = 'error'; }
					pipeline.edges.push(edge);
				}
			}
		}
		linking = undefined;
		commit();
		return;
	}
	if (drag && drag.moved) {
		drag = undefined;
		commit();
		return;
	}
	drag = undefined;
});

canvas.addEventListener('wheel', (event) => {
	event.preventDefault();
	zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY);
}, { passive: false });

function zoomBy(factor) {
	const rect = canvas.getBoundingClientRect();
	zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function zoomAt(factor, clientX, clientY) {
	const before = toWorld(clientX, clientY);
	view.scale = Math.min(2.2, Math.max(0.25, view.scale * factor));
	const after = toWorld(clientX, clientY);
	view.x += (after.x - before.x) * view.scale;
	view.y += (after.y - before.y) * view.scale;
	applyTransform();
}

window.addEventListener('keydown', (event) => {
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
		event.preventDefault();
		if (selectedNodeId) { duplicateNode(selectedNodeId); }
		return;
	}
	if (event.key !== 'Delete') { return; }
	const pipeline = current();
	if (!pipeline) { return; }
	if (selectedEdgeIndex >= 0) {
		pipeline.edges.splice(selectedEdgeIndex, 1);
		selectedEdgeIndex = -1;
		commit();
		return;
	}
	if (selectedNodeId) { removeNode(selectedNodeId); }
});

function duplicateNode(nodeId) {
	const pipeline = current();
	const source = pipeline && pipeline.nodes.find((node) => node.id === nodeId);
	if (!pipeline || !source) { return; }
	const used = pipeline.nodes.map((node) => node.id);
	let index = pipeline.nodes.length + 1;
	while (used.includes('n' + index)) { index += 1; }
	const copy = { ...source, id: 'n' + index, x: (source.x || 0) + 40, y: (source.y || 0) + 60 };
	if (source.options) { copy.options = { ...source.options }; }
	pipeline.nodes.push(copy);
	selectedNodeId = copy.id;
	commit();
	revealNode(copy);
}

function removeNode(nodeId) {
	const pipeline = current();
	if (!pipeline) { return; }
	pipeline.nodes = pipeline.nodes.filter((node) => node.id !== nodeId);
	pipeline.edges = pipeline.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
	selectedNodeId = undefined;
	commit();
}

function toWorld(clientX, clientY) {
	const rect = canvas.getBoundingClientRect();
	return {
		x: (clientX - rect.left - view.x) / view.scale,
		y: (clientY - rect.top - view.y) / view.scale,
	};
}

function applyTransform() {
	world.style.transform = 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.scale + ')';
	const step = 22 * view.scale;
	canvas.style.backgroundSize = step + 'px ' + step + 'px';
	canvas.style.backgroundPosition = view.x + 'px ' + view.y + 'px';
}

function autoLayout() {
	const pipeline = current();
	if (!pipeline) { return; }
	const level = new Map();
	const targets = new Set(pipeline.edges.map((edge) => edge.to));
	const queue = pipeline.nodes.filter((node) => !targets.has(node.id)).map((node) => node.id);
	for (const id of queue) { level.set(id, 0); }
	let guard = pipeline.nodes.length * pipeline.nodes.length + 10;
	while (queue.length > 0 && guard-- > 0) {
		const id = queue.shift();
		for (const edge of pipeline.edges.filter((item) => item.from === id)) {
			const next = (level.get(id) || 0) + 1;
			if ((level.get(edge.to) || 0) < next) { level.set(edge.to, next); queue.push(edge.to); }
		}
	}
	const rows = new Map();
	for (const node of pipeline.nodes) {
		const column = level.get(node.id) || 0;
		const row = rows.get(column) || 0;
		rows.set(column, row + 1);
		node.x = 60 + column * (NODE_WIDTH + 80);
		node.y = 50 + row * 130;
	}
}

function fitToView() {
	const pipeline = current();
	if (!pipeline || pipeline.nodes.length === 0) { view = { x: 40, y: 40, scale: 1 }; applyTransform(); return; }
	const rect = canvas.getBoundingClientRect();
	const minX = Math.min(...pipeline.nodes.map((node) => node.x || 0));
	const minY = Math.min(...pipeline.nodes.map((node) => node.y || 0));
	const maxX = Math.max(...pipeline.nodes.map((node) => (node.x || 0) + sizeOf(node).width));
	const maxY = Math.max(...pipeline.nodes.map((node) => (node.y || 0) + sizeOf(node).height));
	const scale = Math.min(1, (rect.width - 90) / (maxX - minX || 1), (rect.height - 110) / (maxY - minY || 1));
	view.scale = Math.max(0.25, scale);
	view.x = 45 - minX * view.scale;
	view.y = 60 - minY * view.scale;
	applyTransform();
}

/** Блоки, до которых прогон не дойдёт: обводятся на полотне */
let unreachableNodes = new Set();

/** Пересчитывает недостижимые блоки текущей цепочки */
function updateUnreachable(pipeline) {
	unreachableNodes = new Set();
	if (!pipeline || pipeline.nodes.length === 0) { return; }
	const targets = new Set(pipeline.edges.map((edge) => edge.to));
	const reachable = new Set(pipeline.nodes.filter((node) => !targets.has(node.id)).map((node) => node.id));
	let grew = true;
	while (grew) {
		grew = false;
		for (const edge of pipeline.edges) {
			if (reachable.has(edge.from) && !reachable.has(edge.to)) { reachable.add(edge.to); grew = true; }
		}
	}
	for (const node of pipeline.nodes) {
		if (!reachable.has(node.id)) { unreachableNodes.add(node.id); }
	}
}

/** Замечания к цепочке: те же, что проверяются перед запуском */
function pipelineProblems(pipeline) {
	const problems = [];
	if (pipeline.nodes.length === 0) { return problems; }
	const targets = new Set(pipeline.edges.map((edge) => edge.to));
	if (!pipeline.nodes.some((node) => !targets.has(node.id))) {
		problems.push('нет начального блока: у каждого есть входящая связь');
	}
	const reachable = new Set(pipeline.nodes.filter((node) => !targets.has(node.id)).map((node) => node.id));
	let grew = true;
	while (grew) {
		grew = false;
		for (const edge of pipeline.edges) {
			if (reachable.has(edge.from) && !reachable.has(edge.to)) { reachable.add(edge.to); grew = true; }
		}
	}
	const unreachable = pipeline.nodes.filter((node) => !reachable.has(node.id));
	if (unreachable.length > 0) {
		problems.push('до блоков нет пути: ' + unreachable.map((node) => nodeTitle(node)).join(', '));
	}
	const blank = pipeline.nodes.filter((node) => node.enabled !== false && isBlank(node));
	if (blank.length > 0) {
		problems.push('не задано действие: ' + blank.map((node) => nodeTitle(node)).join(', '));
	}
	return problems;
}

function renderInspector() {
	const host = document.getElementById('inspector');
	host.textContent = '';

	if (modelError) {
		const error = document.createElement('div');
		error.className = 'error';
		error.textContent = modelError;
		host.appendChild(error);
		return;
	}

	const pipeline = current();
	if (!pipeline) {
		host.appendChild(hint('Создайте пайплайн кнопкой ＋, затем добавляйте блоки из левой колонки.'));
		return;
	}

	const node = selectedNodeId ? nodeById(selectedNodeId) : undefined;
	if (!node) {
		title(host, 'Пайплайн');
		const problems = pipelineProblems(pipeline);
		if (problems.length > 0) {
			const box = document.createElement('div');
			box.className = 'problems';
			box.textContent = 'Цепочка не запустится: ' + problems.join('; ');
			host.appendChild(box);
		}
		host.appendChild(liveField('Название', pipeline.name, (value) => {
			pipeline.name = value.trim() || pipeline.id;
			fieldEdited();
		}));
		host.appendChild(liveField('Идентификатор для запуска', pipeline.id, (value) => {
			const next = value.trim();
			if (next && !draft.some((item) => item !== pipeline && item.id === next)) {
				pipeline.id = next;
				selectedPipelineId = next;
			}
			fieldEdited();
		}));
		host.appendChild(liveField('Описание', pipeline.description, (value) => {
			const next = value.trim();
			if (next) { pipeline.description = next; } else { delete pipeline.description; }
			fieldEdited();
		}, 'textarea'));
		host.appendChild(liveField('Параметры (имя=значение, по одному в строке)', paramsToText(pipeline.params), (value) => {
			const parsed = textToParams(value);
			if (Object.keys(parsed).length > 0) { pipeline.params = parsed; } else { delete pipeline.params; }
			fieldEdited();
		}, 'textarea'));
		host.appendChild(hint('Параметр подставляется в командную строку, вопрос паузы и параметры вызова записью {{имя}}.'));

		const legend = document.createElement('div');
		legend.className = 'legend';
		legend.appendChild(legendItem('var(--ok)', 'при успехе'));
		legend.appendChild(legendItem('var(--fail)', 'при ошибке'));
		host.appendChild(legend);
		host.appendChild(hint('Блок тянется мышью, связь - от цветного порта справа к другому блоку. Delete удаляет выделенный блок или связь, колесо меняет масштаб.'));
		return;
	}

	title(host, 'Блок: ' + kindOf(node).label);
	host.appendChild(liveField('Подпись', node.name, (value) => {
		const next = value.trim();
		if (next) { node.name = next; } else { delete node.name; }
		fieldEdited();
	}));

	if (node.type === 'shell') {
		host.appendChild(liveField('Команда оболочки', node.script, (value) => {
			node.script = value;
			fieldEdited();
		}, 'textarea'));

	} else if (node.type === 'confirm') {
		host.appendChild(liveField('Вопрос', node.message, (value) => {
			node.message = value.trim() || 'Продолжить выполнение пайплайна?';
			fieldEdited();
		}, 'textarea'));
		host.appendChild(hint('В запуске от агента такой блок завершается ошибкой: подтвердить некому.'));
	} else {
		host.appendChild(commandField(node));
		host.appendChild(liveField('Параметры вызова (JSON)', node.options ? JSON.stringify(node.options) : '', (value) => {
			const text = value.trim();
			if (text === '') { delete node.options; fieldEdited(); return; }
			try {
				const parsed = JSON.parse(text);
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { node.options = parsed; }
			} catch (error) { /* оставляем прежние параметры: файл не должен ломаться из-за опечатки */ }
			fieldEdited();
		}, 'textarea'));
		const entry = catalog.find((item) => item.id === node.command);
		if (entry && !entry.supportsWait) {
			host.appendChild(hint('Команда не возвращает исход: для цепочки такой блок всегда успешен.'));
		}
	}

	host.appendChild(liveField('Ограничение времени, с', node.timeout === undefined ? '' : String(node.timeout), (value) => {
		const parsed = Number(value);
		if (Number.isFinite(parsed) && parsed > 0) { node.timeout = parsed; } else { delete node.timeout; }
		fieldEdited();
	}, 'number'));
	host.appendChild(liveField('Повтор при ошибке, раз', node.retry === undefined ? '' : String(node.retry), (value) => {
		const parsed = Number(value);
		if (Number.isFinite(parsed) && parsed > 0) { node.retry = Math.floor(parsed); } else { delete node.retry; }
		fieldEdited();
	}, 'number'));

	// Флажок уже нарисован кликом: инспектор не пересобирается, фокус остаётся
	host.appendChild(checkbox('Блок включён', node.enabled !== false, (checked) => {
		if (checked) { delete node.enabled; } else { node.enabled = false; }
		fieldEdited();
	}));
	host.appendChild(checkbox('Ждать все входящие ветки', node.join === 'all', (checked) => {
		if (checked) { node.join = 'all'; } else { delete node.join; }
		fieldEdited();
	}));

	const incoming = pipeline.edges.filter((edge) => edge.to === node.id);
	if (incoming.length > 0) {
		title(host, 'Входящие связи');
		for (const edge of incoming) { host.appendChild(edgeRow(edge)); }
	}

	const buttons = document.createElement('div');
	buttons.style.display = 'flex';
	buttons.style.gap = '6px';
	const duplicate = document.createElement('button');
	duplicate.textContent = 'Дублировать';
	duplicate.title = 'Копия блока с теми же параметрами (Ctrl+D)';
	duplicate.addEventListener('click', () => duplicateNode(node.id));
	const remove = document.createElement('button');
	remove.className = 'danger';
	remove.textContent = 'Удалить блок';
	remove.addEventListener('click', () => removeNode(node.id));
	buttons.appendChild(duplicate);
	buttons.appendChild(remove);
	host.appendChild(buttons);
}

function legendItem(color, text) {
	const item = document.createElement('span');
	const marker = document.createElement('i');
	marker.style.background = color;
	item.appendChild(marker);
	item.append(text);
	return item;
}

function edgeRow(edge) {
	const row = document.createElement('div');
	row.className = 'field';
	const label = document.createElement('label');
	const source = nodeById(edge.from);
	label.textContent = 'от «' + (source ? nodeTitle(source) : edge.from) + '»';
	const select = document.createElement('select');
	for (const [value, text] of [['success', 'при успехе'], ['error', 'при ошибке'], ['always', 'в любом случае']]) {
		const option = document.createElement('option');
		option.value = value;
		option.textContent = text;
		option.selected = (edge.on || 'success') === value;
		select.appendChild(option);
	}
	select.addEventListener('change', () => {
		if (select.value === 'success') { delete edge.on; } else { edge.on = select.value; }
		fieldEdited();
	});
	row.appendChild(label);
	row.appendChild(select);
	return row;
}

function commandField(node) {
	const wrap = document.createElement('div');
	wrap.className = 'field';
	const label = document.createElement('label');
	label.textContent = 'Команда расширения';
	const select = document.createElement('select');
	for (const entry of catalog) {
		const option = document.createElement('option');
		option.value = entry.id;
		option.textContent = entry.title || entry.id;
		option.selected = entry.id === node.command;
		select.appendChild(option);
	}
	select.addEventListener('change', () => { node.command = select.value; commit(); });
	wrap.appendChild(label);
	wrap.appendChild(select);
	return wrap;
}

function title(host, text) {
	const caption = document.createElement('h2');
	caption.textContent = text;
	host.appendChild(caption);
}




/** Отчёт прогона: по строке на шаг, со временем и числом попыток */
function renderReport() {
	const host = document.getElementById('report');
	host.textContent = '';
	host.classList.toggle('hidden', !reportVisible || !lastReport);
	if (!reportVisible || !lastReport) { return; }

	const caption = document.createElement('h3');
	caption.textContent = lastReport.cancelled
		? 'Прогон отменён'
		: lastReport.success ? 'Прогон выполнен' : 'Прогон завершился с ошибкой';
	const close = document.createElement('button');
	close.className = 'icon';
	close.textContent = '✕';
	close.title = 'Закрыть отчёт';
	close.addEventListener('click', () => { reportVisible = false; renderReport(); });
	caption.appendChild(close);
	host.appendChild(caption);

	const marks = { ok: '✓', failed: '✕', skipped: '–', notRun: '·' };
	for (const outcome of lastReport.nodes) {
		const row = document.createElement('div');
		row.className = 'row ' + outcome.status;
		const mark = document.createElement('span');
		mark.className = 'mark';
		mark.textContent = marks[outcome.status] || '·';
		const label = document.createElement('span');
		label.textContent = outcome.label + (outcome.attempts ? ' (попыток: ' + outcome.attempts + ')' : '');
		const time = document.createElement('span');
		time.className = 'time';
		time.textContent = outcome.durationMs >= 1000
			? (outcome.durationMs / 1000).toFixed(1) + ' с'
			: outcome.durationMs + ' мс';
		row.appendChild(mark);
		row.appendChild(label);
		row.appendChild(time);
		row.title = outcome.message || '';
		host.appendChild(row);
	}

	const total = document.createElement('div');
	total.className = 'row';
	total.appendChild(document.createElement('span'));
	const totalLabel = document.createElement('span');
	totalLabel.textContent = 'Всего';
	const totalTime = document.createElement('span');
	totalTime.className = 'time';
	totalTime.textContent = (lastReport.durationMs / 1000).toFixed(1) + ' с';
	total.appendChild(totalLabel);
	total.appendChild(totalTime);
	host.appendChild(total);
}

function applyRunEvent(event) {
	const pipeline = current();
	if (!pipeline || event.pipelineId !== pipeline.id) { return; }
	if (event.kind === 'finish') {
		lastReport = event;
		reportVisible = true;
		renderReport();
		return;
	}
	if (event.kind === 'start') { runStatus = new Map(); lastReport = undefined; renderStage(); return; }
	if (event.kind === 'nodeStart') { runStatus.set(event.nodeId, 'running'); renderStage(); return; }
	if (event.kind === 'nodeFinish') {
		runStatus.set(event.outcome.nodeId, event.outcome.status === 'ok' ? 'ok' : 'failed');
		renderStage();
	}
}
</script>
</body>
</html>`;
}
