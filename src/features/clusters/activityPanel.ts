/**
 * Панель активности кластера: сеансы и соединения таблицей.
 *
 * В дереве видно устройство кластера, но не видно, кто его нагружает: чтобы
 * сравнить два десятка сеансов по памяти или длительности вызова, значения
 * нужно видеть рядом и уметь сортировать. Поэтому активность показывается
 * таблицей — со столбцами, поиском, выгрузкой и действиями по строке.
 *
 * Панель одна на подключение и кластер: повторный вызов обновляет уже открытую
 * вкладку, а не плодит новые.
 */

import * as vscode from 'vscode';
import { chromeStyles } from '../editors/webviewChrome';
import {
	CONNECTION_COLUMNS,
	SESSION_COLUMNS,
	activityCsv,
	buildActivityRows,
	type ActivityKind,
	type ActivityRow,
} from './activityTable';
import type { ClusterService } from './clusterService';
import type { ClustersProvider } from './clustersProvider';
import type { ClusterConnection } from './model';
import { confirmSessionAction } from './prompts';
import { readClustersSettings } from './settings';

/** Что показывает панель. */
export interface ActivityTarget {
	connection: ClusterConnection;
	clusterId: string;
	/** Информационная база, если открыли активность одной базы. */
	infobaseId?: string;
	/** Название для заголовка вкладки. */
	title: string;
}

/** Сообщение из панели. */
type PanelMessage =
	| { type: 'load'; kind: ActivityKind }
	| { type: 'terminate'; id: string; label: string }
	| { type: 'interrupt'; id: string; label: string }
	| { type: 'disconnect'; id: string; processId: string; label: string }
	| { type: 'copyCsv'; kind: ActivityKind; rows: ActivityRow[] }
	| { type: 'error'; message: string };

/** Панель активности: одна вкладка на кластер. */
export class ClusterActivityPanel {
	private panel: vscode.WebviewPanel | undefined;
	private target: ActivityTarget | undefined;

	constructor(
		private readonly service: ClusterService,
		private readonly provider: ClustersProvider
	) {}

	/**
	 * Открывает панель для кластера или информационной базы.
	 *
	 * @param target - Что показывать
	 * @param kind - Сеансы или соединения
	 */
	async open(target: ActivityTarget, kind: ActivityKind): Promise<void> {
		this.target = target;
		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel(
				'1cClusterActivity',
				'Активность кластера',
				vscode.ViewColumn.Active,
				{ enableScripts: true, retainContextWhenHidden: true }
			);
			this.panel.webview.html = buildHtml();
			this.panel.webview.onDidReceiveMessage((message: PanelMessage) =>
				this.handleMessage(message)
			);
			this.panel.onDidDispose(() => {
				this.panel = undefined;
				this.target = undefined;
			});
		} else {
			this.panel.reveal(vscode.ViewColumn.Active);
		}
		this.panel.title = `Активность: ${target.title}`;
		await this.load(kind);
	}

	dispose(): void {
		this.panel?.dispose();
		this.panel = undefined;
	}

	/**
	 * Загружает данные и отправляет их в панель.
	 *
	 * @param kind - Сеансы или соединения
	 */
	private async load(kind: ActivityKind): Promise<void> {
		const target = this.target;
		if (!target || !this.panel) {
			return;
		}
		void this.panel.webview.postMessage({ type: 'loading' });

		const { connection, clusterId, infobaseId } = target;
		// Имена баз подставляются в таблицу вместо идентификаторов: администратор
		// мыслит базами, а не GUID.
		const infobases = await this.service.listInfobases(connection, clusterId);
		const infobaseNames: Record<string, string> = {};
		if (infobases.ok) {
			for (const item of infobases.value) {
				infobaseNames[item.id] = item.name;
			}
		}

		const result =
			kind === 'sessions'
				? await this.service.listSessions(connection, clusterId, infobaseId)
				: await this.service.listConnections(connection, clusterId, { infobaseId });

		if (!result.ok) {
			void this.panel.webview.postMessage({ type: 'failed', message: result.failure.message });
			return;
		}

		const rows = buildActivityRows(
			result.value.map((item) => item.record),
			kind,
			infobaseNames
		);
		void this.panel.webview.postMessage({
			type: 'data',
			kind,
			columns: kind === 'sessions' ? SESSION_COLUMNS : CONNECTION_COLUMNS,
			rows,
			subtitle: `${connection.name} · ${connection.host}:${connection.port}`,
		});
	}

	/**
	 * Обрабатывает сообщение панели.
	 *
	 * @param message - Сообщение
	 */
	private async handleMessage(message: PanelMessage): Promise<void> {
		const target = this.target;
		if (!target) {
			return;
		}
		if (message.type === 'load') {
			await this.load(message.kind);
			return;
		}
		if (message.type === 'error') {
			void vscode.window.showErrorMessage(`Таблица активности: ${message.message}`);
			return;
		}
		if (message.type === 'copyCsv') {
			const columns = message.kind === 'sessions' ? SESSION_COLUMNS : CONNECTION_COLUMNS;
			await vscode.env.clipboard.writeText(activityCsv(columns, message.rows));
			void vscode.window.setStatusBarMessage('Таблица скопирована в буфер обмена', 3000);
			return;
		}

		const confirmNeeded = readClustersSettings().confirmDestructiveActions;
		const titles: Record<string, string> = {
			terminate: `Завершить ${message.label}?`,
			interrupt: `Прервать текущий вызов: ${message.label}?`,
			disconnect: `Разорвать ${message.label}?`,
		};
		const details: Record<string, string> = {
			terminate: 'Несохранённые данные сеанса будут потеряны.',
			interrupt: 'Сеанс продолжит работу, прервётся только выполняемый серверный вызов.',
			disconnect: 'Приложение потеряет связь с информационной базой.',
		};
		let errorMessage: string | undefined;
		if (confirmNeeded) {
			const choice = await confirmSessionAction(titles[message.type], details[message.type]);
			if (!choice.confirmed) {
				return;
			}
			errorMessage = choice.errorMessage;
		}

		const { connection, clusterId } = target;
		const result =
			message.type === 'terminate'
				? await this.service.terminateSession(connection, clusterId, message.id, errorMessage)
				: message.type === 'interrupt'
					? await this.service.interruptSessionCall(connection, clusterId, message.id, errorMessage)
					: await this.service.disconnectConnection(connection, clusterId, {
							processId: message.processId,
							connectionId: message.id,
						});

		if (!result.ok) {
			void vscode.window.showErrorMessage(result.failure.message);
			return;
		}
		// Дерево показывает те же объекты: без обновления там осталась бы строка,
		// которой на сервере уже нет.
		this.provider.refresh();
		await this.load(message.type === 'disconnect' ? 'connections' : 'sessions');
	}
}

/** Разметка и скрипт таблицы. */
function buildHtml(): string {
	const nonce = Math.random().toString(36).slice(2);
	return /* html */ `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
${chromeStyles()}
	.toolbar input[type=text] { width: 220px; }
	.toolbar .subtitle { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
	.tabs { display: flex; gap: 4px; }
	.tabs button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
	.scroll { flex: 1; min-height: 0; overflow: auto; }
	table { border-collapse: collapse; width: 100%; font-size: 0.88em; }
	th, td { padding: 5px 10px; text-align: left; white-space: nowrap; border-bottom: 1px solid var(--line); }
	th { position: sticky; top: 0; background: var(--vscode-editor-background); cursor: pointer;
		user-select: none; font-weight: 600; }
	th:hover { color: var(--vscode-textLink-foreground); }
	th .arrow { opacity: 0.6; margin-left: 4px; }
	td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
	tbody tr:hover { background: var(--vscode-list-hoverBackground); }
	td.actions { text-align: right; }
	td.actions button { margin-left: 4px; }
	.state { padding: 14px 18px; color: var(--vscode-descriptionForeground); }
	.state.error { color: var(--fail); }
</style>
</head>
<body>
<div class="chrome">
	<div class="toolbar">
		<div class="tabs">
			<button id="tabSessions" class="active">Сеансы</button>
			<button id="tabConnections">Соединения</button>
		</div>
		<input type="text" id="filter" placeholder="Поиск по таблице">
		<span class="subtitle" id="subtitle"></span>
		<button id="refresh">Обновить</button>
		<button id="csv" title="Скопировать таблицу в буфер обмена">Копировать</button>
	</div>
	<div class="scroll" id="scroll">
		<div class="state" id="state">Загружаю…</div>
		<table id="table" hidden><thead id="head"></thead><tbody id="body"></tbody></table>
	</div>
</div>
<script nonce="${nonce}">
const vscodeApi = acquireVsCodeApi();
let kind = 'sessions';
let columns = [];
let rows = [];
let sortIndex = 0;
let sortAscending = true;
let filter = '';

function post(message) { vscodeApi.postMessage(message); }

function visibleRows() {
	const needle = filter.trim().toLowerCase();
	const filtered = needle === ''
		? rows
		: rows.filter((row) => row.cells.some((cell) => cell.text.toLowerCase().includes(needle)));
	const sorted = filtered.slice().sort((a, b) => {
		const left = a.cells[sortIndex] ? a.cells[sortIndex].sort : '';
		const right = b.cells[sortIndex] ? b.cells[sortIndex].sort : '';
		if (typeof left === 'number' && typeof right === 'number') { return left - right; }
		return String(left).localeCompare(String(right), 'ru');
	});
	return sortAscending ? sorted : sorted.reverse();
}

function numeric(column) {
	return column.kind === 'number' || column.kind === 'bytes' || column.kind === 'millis';
}

function renderHead() {
	const head = document.getElementById('head');
	head.textContent = '';
	const tr = document.createElement('tr');
	columns.forEach((column, index) => {
		const th = document.createElement('th');
		th.textContent = column.title;
		if (numeric(column)) { th.className = 'num'; }
		if (index === sortIndex) {
			const arrow = document.createElement('span');
			arrow.className = 'arrow';
			arrow.textContent = sortAscending ? '▲' : '▼';
			th.appendChild(arrow);
		}
		th.addEventListener('click', () => {
			if (sortIndex === index) { sortAscending = !sortAscending; }
			else { sortIndex = index; sortAscending = true; }
			render();
		});
		tr.appendChild(th);
	});
	const actions = document.createElement('th');
	actions.textContent = 'Действия';
	tr.appendChild(actions);
	head.appendChild(tr);
}

function actionButton(label, title, handler) {
	const button = document.createElement('button');
	button.textContent = label;
	button.title = title;
	button.addEventListener('click', handler);
	return button;
}

function renderBody() {
	const body = document.getElementById('body');
	body.textContent = '';
	for (const row of visibleRows()) {
		const tr = document.createElement('tr');
		row.cells.forEach((cell, index) => {
			const td = document.createElement('td');
			td.textContent = cell.text;
			if (numeric(columns[index])) { td.className = 'num'; }
			tr.appendChild(td);
		});
		const actions = document.createElement('td');
		actions.className = 'actions';
		if (kind === 'sessions') {
			actions.appendChild(actionButton('Прервать вызов', 'Прервать текущий серверный вызов',
				() => post({ type: 'interrupt', id: row.id, label: row.label })));
			actions.appendChild(actionButton('Завершить', 'Завершить сеанс',
				() => post({ type: 'terminate', id: row.id, label: row.label })));
		} else {
			actions.appendChild(actionButton('Разорвать', 'Разорвать соединение',
				() => post({ type: 'disconnect', id: row.id, processId: row.processId, label: row.label })));
		}
		tr.appendChild(actions);
		body.appendChild(tr);
	}
}

function render() {
	const table = document.getElementById('table');
	const state = document.getElementById('state');
	const shown = visibleRows();
	table.hidden = shown.length === 0;
	state.hidden = shown.length > 0;
	state.className = 'state';
	if (shown.length === 0) {
		state.textContent = rows.length === 0
			? (kind === 'sessions' ? 'Сеансов нет' : 'Соединений нет')
			: 'Ничего не найдено';
		return;
	}
	renderHead();
	renderBody();
}

function selectKind(next) {
	kind = next;
	sortIndex = 0;
	sortAscending = true;
	document.getElementById('tabSessions').classList.toggle('active', kind === 'sessions');
	document.getElementById('tabConnections').classList.toggle('active', kind === 'connections');
	post({ type: 'load', kind: kind });
}

document.getElementById('tabSessions').addEventListener('click', () => selectKind('sessions'));
document.getElementById('tabConnections').addEventListener('click', () => selectKind('connections'));
document.getElementById('refresh').addEventListener('click', () => post({ type: 'load', kind: kind }));
document.getElementById('csv').addEventListener('click', () => post({ type: 'copyCsv', kind: kind, rows: visibleRows() }));
document.getElementById('filter').addEventListener('input', (event) => {
	filter = event.target.value;
	render();
});

window.addEventListener('error', (event) => {
	post({ type: 'error', message: event.message + ' (' + event.lineno + ':' + event.colno + ')' });
});

window.addEventListener('message', (event) => {
	const data = event.data;
	if (data.type === 'loading') {
		document.getElementById('table').hidden = true;
		const state = document.getElementById('state');
		state.hidden = false;
		state.className = 'state';
		state.textContent = 'Загружаю…';
		return;
	}
	if (data.type === 'failed') {
		document.getElementById('table').hidden = true;
		const state = document.getElementById('state');
		state.hidden = false;
		state.className = 'state error';
		state.textContent = data.message;
		return;
	}
	if (data.type === 'data') {
		kind = data.kind;
		columns = data.columns;
		rows = data.rows;
		document.getElementById('subtitle').textContent = data.subtitle;
		document.getElementById('tabSessions').classList.toggle('active', kind === 'sessions');
		document.getElementById('tabConnections').classList.toggle('active', kind === 'connections');
		render();
	}
});
</script>
</body>
</html>`;
}
