import * as vscode from 'vscode';
import type { MeasureResults } from './measure';

interface MeasureRow {
	path: string;
	module: string;
	line: number;
	code: string;
	count: number;
	ms: number;
	ownMs: number;
	percent: number;
	server: boolean;
}

let panel: vscode.WebviewPanel | undefined;

/**
 * Таблица результатов замера производительности: модуль, строка, код, число выполнений,
 * время и доля от общего. Клик по строке открывает модуль на нужной позиции.
 */
export async function showMeasureResultsPanel(results: MeasureResults): Promise<void> {
	const rows = await buildRows(results);

	if (!panel) {
		panel = vscode.window.createWebviewPanel(
			'1c-platform-tools.measureResults',
			'Замер производительности',
			{ viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
			{ enableScripts: true, retainContextWhenHidden: true }
		);
		panel.onDidDispose(() => {
			panel = undefined;
		});
		panel.webview.onDidReceiveMessage(async (msg: { path?: string; line?: number }) => {
			if (!msg.path || !msg.line) {
				return;
			}
			try {
				const doc = await vscode.workspace.openTextDocument(msg.path);
				const editor = await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.One });
				const position = new vscode.Position(msg.line - 1, 0);
				editor.selection = new vscode.Selection(position, position);
				editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
			} catch {
				void vscode.window.showWarningMessage(`Не удалось открыть модуль: ${msg.path}`);
			}
		});
	}

	panel.webview.html = renderHtml(results.totalSeconds, rows);
	panel.reveal(undefined, true);
}

export function disposeMeasureResultsPanel(): void {
	panel?.dispose();
	panel = undefined;
}

async function buildRows(results: MeasureResults): Promise<MeasureRow[]> {
	const rows: MeasureRow[] = [];
	const total = results.totalSeconds;

	for (const module of results.modules) {
		let doc: vscode.TextDocument | undefined;
		try {
			doc = await vscode.workspace.openTextDocument(module.path);
		} catch {
			// Модуль вне рабочей области — строки покажем без текста кода.
		}
		const relative = vscode.workspace.asRelativePath(module.path);

		for (const line of module.lines) {
			rows.push({
				path: module.path,
				module: relative,
				line: line.line,
				code: doc && line.line >= 1 && line.line <= doc.lineCount ? doc.lineAt(line.line - 1).text.trim() : '',
				count: line.count,
				ms: line.seconds * 1000,
				ownMs: line.ownSeconds * 1000,
				percent: total > 0 ? (line.seconds / total) * 100 : 0,
				server: line.serverCall,
			});
		}
	}

	return rows;
}

function renderHtml(totalSeconds: number, rows: MeasureRow[]): string {
	// «</script>» внутри данных не должен разрывать встроенный скрипт.
	const data = JSON.stringify(rows).replace(/</g, '\\u003c');
	const total = totalSeconds >= 1 ? `${totalSeconds.toFixed(2)} с` : `${(totalSeconds * 1000).toFixed(1)} мс`;

	return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 12px; }
	.summary { margin: 10px 0; display: flex; gap: 16px; align-items: center; }
	input { background: var(--vscode-input-background); color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, transparent); padding: 3px 6px; min-width: 240px; }
	table { border-collapse: collapse; width: 100%; }
	th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--vscode-editorGroup-border); }
	th { cursor: pointer; user-select: none; position: sticky; top: 0; background: var(--vscode-editor-background); white-space: nowrap; }
	th .dir { opacity: .7; }
	td.num, th.num { text-align: right; white-space: nowrap; }
	td.code { font-family: var(--vscode-editor-font-family); white-space: nowrap; overflow: hidden;
		text-overflow: ellipsis; max-width: 480px; }
	tbody tr { cursor: pointer; user-select: none; }
	tbody tr:hover { background: var(--vscode-list-hoverBackground); }
	tbody tr.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
	.bar { background: var(--vscode-progressBar-background); height: 3px; }
	.muted { opacity: .7; }
</style>
</head>
<body>
	<div class="summary">
		<b>Всего: ${total}</b>
		<span class="muted" id="counter"></span>
		<input id="filter" type="text" placeholder="Фильтр по модулю или коду…">
	</div>
	<table>
		<thead><tr>
			<th data-key="module">Модуль <span class="dir"></span></th>
			<th data-key="line" class="num">Строка <span class="dir"></span></th>
			<th data-key="code">Код <span class="dir"></span></th>
			<th data-key="count" class="num">Кол-во <span class="dir"></span></th>
			<th data-key="ms" class="num">Время, мс <span class="dir"></span></th>
			<th data-key="ownMs" class="num">Без вложенных, мс <span class="dir"></span></th>
			<th data-key="percent" class="num">% <span class="dir"></span></th>
			<th data-key="server">Сервер <span class="dir"></span></th>
		</tr></thead>
		<tbody id="rows"></tbody>
	</table>
<script>
	const vscode = acquireVsCodeApi();
	const data = ${data};
	data.forEach((r, i) => { r._i = i; });
	let sortKey = 'ms';
	let sortDesc = true;
	let filter = '';

	function fmt(ms) { return ms >= 1000 ? (ms / 1000).toFixed(2) + ' с' : ms.toFixed(1); }

	function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

	function render() {
		const needle = filter.toLowerCase();
		const rows = data
			.filter(r => !needle || r.module.toLowerCase().includes(needle) || r.code.toLowerCase().includes(needle))
			.sort((a, b) => {
				const x = a[sortKey], y = b[sortKey];
				const cmp = typeof x === 'string' ? x.localeCompare(y) : (x === y ? 0 : x < y ? -1 : 1);
				return sortDesc ? -cmp : cmp;
			});
		document.getElementById('counter').textContent = 'строк: ' + rows.length;
		document.getElementById('rows').innerHTML = rows.map(r =>
			'<tr data-i="' + r._i + '">' +
			'<td>' + esc(r.module) + '</td>' +
			'<td class="num">' + r.line + '</td>' +
			'<td class="code">' + esc(r.code) + '</td>' +
			'<td class="num">' + r.count + '</td>' +
			'<td class="num">' + fmt(r.ms) + '</td>' +
			'<td class="num">' + fmt(r.ownMs) + '</td>' +
			'<td class="num">' + r.percent.toFixed(1) + '<div class="bar" style="width:' + Math.min(100, r.percent) + '%"></div></td>' +
			'<td>' + (r.server ? '✓' : '') + '</td>' +
			'</tr>').join('');
		document.querySelectorAll('th').forEach(th => {
			th.querySelector('.dir').textContent = th.dataset.key === sortKey ? (sortDesc ? '↓' : '↑') : '';
		});
	}

	document.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
		const key = th.dataset.key;
		if (sortKey === key) { sortDesc = !sortDesc; } else { sortKey = key; sortDesc = true; }
		render();
	}));
	document.getElementById('filter').addEventListener('input', e => { filter = e.target.value; render(); });
	// Одиночный клик — выделение строки, двойной — переход к строке модуля.
	document.getElementById('rows').addEventListener('click', e => {
		const tr = e.target.closest('tr');
		if (!tr) { return; }
		document.querySelectorAll('tbody tr.selected').forEach(el => el.classList.remove('selected'));
		tr.classList.add('selected');
	});
	document.getElementById('rows').addEventListener('dblclick', e => {
		const tr = e.target.closest('tr');
		if (!tr) { return; }
		const row = data[Number(tr.dataset.i)];
		vscode.postMessage({ path: row.path, line: row.line });
	});

	render();
</script>
</body>
</html>`;
}
