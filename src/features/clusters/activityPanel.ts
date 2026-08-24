/**
 * Списки кластера таблицей: базы, сеансы, соединения и блокировки.
 *
 * В дереве видно устройство кластера, но не видно, кто его нагружает и какая
 * база закрыта: чтобы сравнить два десятка сеансов по памяти или пробежать
 * глазами блокировки баз, значения нужно видеть рядом и уметь сортировать.
 * Поэтому те же списки показываются таблицей — со столбцами, поиском,
 * выгрузкой и действиями по строке.
 *
 * Строки выделяются как в списках VS Code — щелчком, Ctrl и Shift, Ctrl+A: пачка
 * сеансов завершается одним действием, а обслуживание базы редко заканчивается
 * одним сеансом.
 *
 * Панель одна на окно: повторный вызов обновляет уже открытую вкладку, а не
 * плодит новые.
 */

import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { notifyQuiet } from '../../shared/notify';
import { chromeStyles } from '../editors/webviewChrome';
import {
	activityColumns,
	activityCsv,
	buildActivityRows,
	type ActivityKind,
	type ActivityRow,
} from './activityTable';
import { activityKinds, type ActivityTarget } from './activityRequest';
import type { ClusterService } from './clusterService';
import type { ClustersProvider } from './clustersProvider';
import type { InfobaseInfo } from './model';
import { InfobaseNode } from './nodes';
import { confirmAction, confirmSessionAction } from './prompts';
import type { RacRecord } from './racOutput';
import { readClustersSettings } from './settings';

/** Соединение, выбранное в таблице: разрыв требует рабочего процесса. */
interface ConnectionRef {
	id: string;
	processId: string;
}

/** Сообщение из панели. */
type PanelMessage =
	| { type: 'load'; kind: ActivityKind }
	| { type: 'terminate'; id: string; label: string }
	| { type: 'interrupt'; id: string; label: string }
	| { type: 'disconnect'; id: string; processId: string; label: string }
	| { type: 'terminateMany'; ids: string[] }
	| { type: 'disconnectMany'; items: ConnectionRef[] }
	| { type: 'infobaseProperties'; id: string }
	| { type: 'infobaseDrop'; id: string }
	| { type: 'copyCsv'; kind: ActivityKind; rows: ActivityRow[] }
	| { type: 'error'; message: string };

/** Подпись кнопки журнала в сообщении о неудаче. */
const SHOW_LOG_ACTION = 'Показать журнал';

/** Панель списков: одна вкладка на окно. */
export class ClusterActivityPanel {
	private panel: vscode.WebviewPanel | undefined;
	private target: ActivityTarget | undefined;
	/** Базы последней загрузки: по ним команды строки находят объект. */
	private infobases: InfobaseInfo[] = [];

	constructor(
		private readonly service: ClusterService,
		private readonly provider: ClustersProvider
	) {}

	/**
	 * Открывает панель для кластера или информационной базы.
	 *
	 * @param target - Что показывать
	 * @param kind - Какой список открыть
	 */
	async open(target: ActivityTarget, kind: ActivityKind): Promise<void> {
		this.target = target;
		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel(
				'1cClusterActivity',
				'Списки кластера',
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
		this.panel.title = `Списки: ${target.title}`;
		await this.load(kind);
	}

	dispose(): void {
		this.panel?.dispose();
		this.panel = undefined;
	}

	/**
	 * Загружает список и отправляет его в панель.
	 *
	 * @param kind - Какой список показать
	 */
	private async load(kind: ActivityKind): Promise<void> {
		const target = this.target;
		if (!target || !this.panel) {
			return;
		}
		const kinds = activityKinds(target);
		const shown = kinds.includes(kind) ? kind : kinds[0];
		void this.panel.webview.postMessage({ type: 'loading' });

		const result = await this.read(target, shown);
		if (!result.ok) {
			void this.panel.webview.postMessage({ type: 'failed', message: result.message, kinds });
			return;
		}
		void this.panel.webview.postMessage({
			type: 'data',
			kind: shown,
			kinds,
			columns: activityColumns(shown),
			rows: result.rows,
			subtitle: `${target.connection.name} · ${target.connection.host}:${target.connection.port}`,
		});
	}

	/**
	 * Читает объекты списка и превращает их в строки таблицы.
	 *
	 * @param target - Кластер или база
	 * @param kind - Какой список читать
	 * @returns Промис, который разрешается строками либо причиной неудачи
	 */
	private async read(
		target: ActivityTarget,
		kind: ActivityKind
	): Promise<{ ok: true; rows: ActivityRow[] } | { ok: false; message: string }> {
		const { connection, clusterId, infobaseId } = target;
		if (kind === 'locks') {
			const locks = await this.service.listLocks(connection, clusterId, infobaseId);
			return locks.ok
				? { ok: true, rows: buildActivityRows(locks.value.map((item) => item.record), kind) }
				: { ok: false, message: locks.failure.message };
		}

		// Имена баз подставляются вместо идентификаторов: администратор мыслит
		// базами, а не GUID.
		const infobases = await this.service.listInfobases(connection, clusterId);
		if (!infobases.ok) {
			return { ok: false, message: infobases.failure.message };
		}
		this.infobases = infobases.value;
		const infobaseNames: Record<string, string> = {};
		for (const item of infobases.value) {
			infobaseNames[item.id] = item.name;
		}

		if (kind === 'infobases') {
			const records = await this.service.infobaseRecords(
				connection,
				clusterId,
				infobases.value.map((item) => item.id)
			);
			// Краткий список знает имя и описание, полные сведения — режим работы и
			// размещение; у базы с администратором вторых может не быть.
			const merged: RacRecord[] = infobases.value.map((item) => ({
				...item.record,
				...(records.get(item.id) ?? {}),
			}));
			return { ok: true, rows: buildActivityRows(merged, kind, infobaseNames) };
		}

		const result =
			kind === 'sessions'
				? await this.service.listSessions(connection, clusterId, infobaseId)
				: await this.service.listConnections(connection, clusterId, { infobaseId });
		return result.ok
			? {
					ok: true,
					rows: buildActivityRows(result.value.map((item) => item.record), kind, infobaseNames),
				}
			: { ok: false, message: result.failure.message };
	}

	/**
	 * Обрабатывает сообщение панели.
	 *
	 * @param message - Сообщение
	 */
	private async handleMessage(message: PanelMessage): Promise<void> {
		if (!this.target) {
			return;
		}
		switch (message.type) {
			case 'load':
				await this.load(message.kind);
				return;
			case 'error':
				void vscode.window.showErrorMessage(`Списки кластера: ${message.message}`);
				return;
			case 'copyCsv':
				await vscode.env.clipboard.writeText(
					activityCsv(activityColumns(message.kind), message.rows)
				);
				void vscode.window.setStatusBarMessage(
					`Скопировано строк: ${message.rows.length}`,
					3000
				);
				return;
			case 'infobaseProperties':
				await this.runInfobaseCommand('1c-platform-tools.clusters.properties', message.id);
				return;
			case 'infobaseDrop':
				await this.runInfobaseCommand('1c-platform-tools.clusters.dropInfobase', message.id);
				return;
			case 'terminate':
			case 'interrupt':
			case 'disconnect':
				await this.runSingleAction(message);
				return;
			case 'terminateMany':
				await this.terminateMany(message.ids);
				return;
			case 'disconnectMany':
				await this.disconnectMany(message.items);
				return;
			default: {
				const unknown: never = message;
				logger.warn(`[clusters] неизвестное сообщение панели: ${JSON.stringify(unknown)}`);
			}
		}
	}

	/**
	 * Выполняет команду дерева над базой из строки таблицы.
	 *
	 * Карточка свойств и подтверждение удаления уже описаны командами дерева, и
	 * узел для них собирается здесь: повторять их в панели значило бы держать два
	 * набора формулировок.
	 *
	 * @param command - Идентификатор команды
	 * @param infobaseId - Идентификатор базы
	 */
	private async runInfobaseCommand(command: string, infobaseId: string): Promise<void> {
		const target = this.target;
		const infobase = this.infobases.find((item) => item.id === infobaseId);
		if (!target || !infobase) {
			return;
		}
		await vscode.commands.executeCommand(
			command,
			new InfobaseNode(target.connection, target.clusterId, infobase)
		);
		await this.load('infobases');
	}

	/**
	 * Выполняет действие над одной строкой.
	 *
	 * @param message - Сообщение панели с объектом действия
	 */
	private async runSingleAction(
		message:
			| { type: 'terminate'; id: string; label: string }
			| { type: 'interrupt'; id: string; label: string }
			| { type: 'disconnect'; id: string; processId: string; label: string }
	): Promise<void> {
		const target = this.target;
		if (!target) {
			return;
		}
		const titles: Record<typeof message.type, string> = {
			terminate: `Завершить ${message.label}?`,
			interrupt: `Прервать текущий вызов: ${message.label}?`,
			disconnect: `Разорвать ${message.label}?`,
		};
		const details: Record<typeof message.type, string> = {
			terminate: 'Несохранённые данные сеанса будут потеряны.',
			interrupt: 'Сеанс продолжит работу, прервётся только выполняемый серверный вызов.',
			disconnect: 'Приложение потеряет связь с информационной базой.',
		};
		let errorMessage: string | undefined;
		if (readClustersSettings().confirmDestructiveActions) {
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
					? await this.service.interruptSessionCall(
							connection,
							clusterId,
							message.id,
							errorMessage
						)
					: await this.service.disconnectConnection(connection, clusterId, {
							processId: message.processId,
							connectionId: message.id,
						});

		if (!result.ok) {
			void vscode.window.showErrorMessage(result.failure.message);
			return;
		}
		await this.afterAction(message.type === 'disconnect' ? 'connections' : 'sessions');
	}

	/**
	 * Завершает выбранные сеансы.
	 *
	 * Подтверждение спрашивается всегда, даже когда подтверждения отключены:
	 * пачка сеансов — это пачка потерянных документов у разных пользователей.
	 *
	 * @param ids - Идентификаторы сеансов
	 */
	private async terminateMany(ids: string[]): Promise<void> {
		const target = this.target;
		if (!target || ids.length === 0) {
			return;
		}
		const choice = await confirmSessionAction(
			`Завершить сеансов: ${ids.length}?`,
			'Несохранённые данные пользователей будут потеряны.'
		);
		if (!choice.confirmed) {
			return;
		}
		const failures = await this.runBatch('Завершаю сеансы', ids.length, (index) =>
			this.service.terminateSession(
				target.connection,
				target.clusterId,
				ids[index] as string,
				choice.errorMessage
			)
		);
		this.report('Завершено сеансов', ids.length - failures, failures);
		await this.afterAction('sessions');
	}

	/**
	 * Разрывает выбранные соединения.
	 *
	 * @param items - Соединения вместе с их рабочими процессами
	 */
	private async disconnectMany(items: ConnectionRef[]): Promise<void> {
		const target = this.target;
		if (!target || items.length === 0) {
			return;
		}
		const confirmed = await confirmAction(
			`Разорвать соединений: ${items.length}?`,
			'Приложения потеряют связь с информационной базой.',
			'Разорвать'
		);
		if (!confirmed) {
			return;
		}
		const failures = await this.runBatch('Разрываю соединения', items.length, (index) => {
			const item = items[index] as ConnectionRef;
			return this.service.disconnectConnection(target.connection, target.clusterId, {
				processId: item.processId,
				connectionId: item.id,
			});
		});
		this.report('Разорвано соединений', items.length - failures, failures);
		await this.afterAction('connections');
	}

	/**
	 * Выполняет действие над каждым выбранным объектом.
	 *
	 * Объекты идут по одному: у rac нет команды для списка, и параллельные
	 * вызовы к тому же смешали бы сообщения о неудачах.
	 *
	 * @param title - Что происходит
	 * @param count - Сколько объектов обработать
	 * @param action - Действие над объектом по его номеру
	 * @returns Промис, который разрешается числом неудач
	 */
	private async runBatch(
		title: string,
		count: number,
		action: (index: number) => Promise<{ ok: boolean; failure?: { message: string } }>
	): Promise<number> {
		return vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title },
			async () => {
				let failures = 0;
				for (let index = 0; index < count; index += 1) {
					const result = await action(index);
					if (!result.ok) {
						failures += 1;
						logger.error(`[clusters] ${title}: ${result.failure?.message ?? 'неизвестная ошибка'}`);
					}
				}
				return failures;
			}
		);
	}

	/**
	 * Сообщает итог массового действия.
	 *
	 * @param title - Что сделано, без числа
	 * @param done - Сколько удалось
	 * @param failures - Сколько не удалось
	 */
	private report(title: string, done: number, failures: number): void {
		if (failures === 0) {
			notifyQuiet(`${title}: ${done}`);
			return;
		}
		void vscode.window
			.showWarningMessage(`${title}: ${done}, не удалось: ${failures}.`, SHOW_LOG_ACTION)
			.then((choice) => {
				if (choice === SHOW_LOG_ACTION) {
					logger.show();
				}
			});
	}

	/**
	 * Обновляет дерево и таблицу после действия.
	 *
	 * @param kind - Список, который перечитать
	 */
	private async afterAction(kind: ActivityKind): Promise<void> {
		// Дерево показывает те же объекты: без обновления там осталась бы строка,
		// которой на сервере уже нет.
		this.provider.refresh();
		await this.load(kind);
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
	/* Подключение слева от кнопок: они уходят к правому краю */
	.toolbar .subtitle { color: var(--vscode-descriptionForeground); font-size: 0.85em;
		margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
	/* Строки выделяются щелчком, поэтому выделять текст мышью незачем */
	tbody { user-select: none; }
	tbody tr { cursor: default; }
	tbody tr:hover { background: var(--vscode-list-hoverBackground); }
	tbody tr.picked { background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground); }
	td.actions { text-align: right; }
	td.actions button { margin-left: 4px; }
	.state { padding: 14px 18px; color: var(--vscode-descriptionForeground); }
	.state.error { color: var(--fail); }
</style>
</head>
<body>
<div class="chrome">
	<div class="toolbar">
		<div class="tabs" id="tabs"></div>
		<input type="text" id="filter" placeholder="Поиск по таблице">
		<span class="subtitle" id="subtitle"></span>
		<button id="bulk" hidden></button>
		<button id="refresh">Обновить</button>
		<button id="csv" title="Скопировать выбранные строки, а без выбора — всю таблицу">Копировать</button>
	</div>
	<div class="scroll" id="scroll">
		<div class="state" id="state">Загружаю…</div>
		<table id="table" hidden><thead id="head"></thead><tbody id="body"></tbody></table>
	</div>
</div>
<script nonce="${nonce}">
const vscodeApi = acquireVsCodeApi();
const TAB_TITLES = {
	infobases: 'Информационные базы',
	sessions: 'Сеансы',
	connections: 'Соединения',
	locks: 'Блокировки',
};
const EMPTY_TITLES = {
	infobases: 'Информационных баз нет',
	sessions: 'Сеансов нет',
	connections: 'Соединений нет',
	locks: 'Блокировок нет',
};
let kind = '';
let kinds = [];
let columns = [];
let rows = [];
let picked = new Set();
/** Строка, от которой Shift отмеряет диапазон */
let anchorId = null;
let sortIndex = 0;
let sortAscending = true;
let filter = '';

function post(message) { vscodeApi.postMessage(message); }

/** Действие над пачкой строк, если оно есть у списка */
function bulkKind() { return kind === 'sessions' || kind === 'connections' ? kind : ''; }

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

/** Выбранные строки среди показанных: скрытая фильтром строка в действие не идёт */
function pickedRows() {
	return visibleRows().filter((row) => picked.has(row.id));
}

/**
 * Отмечает строку так же, как список VS Code: щелчок выбирает одну, Ctrl
 * добавляет и снимает, Shift берёт диапазон от предыдущего щелчка.
 */
function pickRow(row, index, event) {
	const shown = visibleRows();
	const anchorIndex = anchorId === null ? -1 : shown.findIndex((item) => item.id === anchorId);
	if (event.shiftKey && anchorIndex >= 0) {
		const from = Math.min(anchorIndex, index);
		const to = Math.max(anchorIndex, index);
		picked = new Set(shown.slice(from, to + 1).map((item) => item.id));
		render();
		return;
	}
	if (event.ctrlKey || event.metaKey) {
		if (picked.has(row.id)) { picked.delete(row.id); } else { picked.add(row.id); }
	} else {
		picked = new Set([row.id]);
	}
	anchorId = row.id;
	render();
}

function clearPicked() {
	picked = new Set();
	anchorId = null;
}

/** Копирует выбранные строки, а без выбора — всю таблицу */
function copyRows() {
	const selected = pickedRows();
	post({ type: 'copyCsv', kind: kind, rows: selected.length > 0 ? selected : visibleRows() });
}

function renderTabs() {
	const tabs = document.getElementById('tabs');
	tabs.textContent = '';
	for (const item of kinds) {
		const button = document.createElement('button');
		button.textContent = TAB_TITLES[item];
		button.className = item === kind ? 'active' : '';
		button.addEventListener('click', () => selectKind(item));
		tabs.appendChild(button);
	}
}

function renderBulk() {
	const button = document.getElementById('bulk');
	const count = pickedRows().length;
	button.hidden = bulkKind() === '' || count === 0;
	if (button.hidden) { return; }
	button.textContent = (kind === 'sessions' ? 'Завершить выбранные' : 'Разорвать выбранные')
		+ ' (' + count + ')';
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
	if (kind !== 'locks') {
		const actions = document.createElement('th');
		actions.textContent = 'Действия';
		tr.appendChild(actions);
	}
	head.appendChild(tr);
}

function actionButton(label, title, handler) {
	const button = document.createElement('button');
	button.textContent = label;
	button.title = title;
	button.addEventListener('click', handler);
	return button;
}

function rowActions(row) {
	const actions = document.createElement('td');
	actions.className = 'actions';
	if (kind === 'sessions') {
		actions.appendChild(actionButton('Прервать вызов', 'Прервать текущий серверный вызов',
			() => post({ type: 'interrupt', id: row.id, label: row.label })));
		actions.appendChild(actionButton('Завершить', 'Завершить сеанс',
			() => post({ type: 'terminate', id: row.id, label: row.label })));
	} else if (kind === 'connections') {
		actions.appendChild(actionButton('Разорвать', 'Разорвать соединение',
			() => post({ type: 'disconnect', id: row.id, processId: row.processId, label: row.label })));
	} else if (kind === 'infobases') {
		actions.appendChild(actionButton('Свойства', 'Открыть свойства базы',
			() => post({ type: 'infobaseProperties', id: row.id })));
		actions.appendChild(actionButton('Удалить', 'Удалить базу из кластера',
			() => post({ type: 'infobaseDrop', id: row.id })));
	}
	return actions;
}

function renderBody() {
	const body = document.getElementById('body');
	body.textContent = '';
	visibleRows().forEach((row, index) => {
		const tr = document.createElement('tr');
		if (picked.has(row.id)) { tr.className = 'picked'; }
		// Кнопки строки выполняют своё действие и выделение не меняют
		tr.addEventListener('click', (event) => {
			if (event.target.closest('button')) { return; }
			pickRow(row, index, event);
		});
		row.cells.forEach((cell, cellIndex) => {
			const td = document.createElement('td');
			td.textContent = cell.text;
			if (numeric(columns[cellIndex])) { td.className = 'num'; }
			tr.appendChild(td);
		});
		if (kind !== 'locks') { tr.appendChild(rowActions(row)); }
		body.appendChild(tr);
	});
}

function render() {
	const table = document.getElementById('table');
	const state = document.getElementById('state');
	const shown = visibleRows();
	renderTabs();
	renderBulk();
	table.hidden = shown.length === 0;
	state.hidden = shown.length > 0;
	state.className = 'state';
	if (shown.length === 0) {
		state.textContent = rows.length === 0 ? EMPTY_TITLES[kind] : 'Ничего не найдено';
		return;
	}
	renderHead();
	renderBody();
}

function selectKind(next) {
	kind = next;
	sortIndex = 0;
	sortAscending = true;
	clearPicked();
	post({ type: 'load', kind: kind });
}

document.getElementById('refresh').addEventListener('click', () => post({ type: 'load', kind: kind }));
document.getElementById('csv').addEventListener('click', copyRows);
document.getElementById('bulk').addEventListener('click', () => {
	const rowsToUse = pickedRows();
	if (rowsToUse.length === 0) { return; }
	if (kind === 'sessions') {
		post({ type: 'terminateMany', ids: rowsToUse.map((row) => row.id) });
	} else {
		post({ type: 'disconnectMany', items: rowsToUse.map((row) => ({ id: row.id, processId: row.processId })) });
	}
});
document.getElementById('filter').addEventListener('input', (event) => {
	filter = event.target.value;
	render();
});

// Сочетания клавиш проверяются по коду клавиши: раскладка на них не влияет
document.addEventListener('keydown', (event) => {
	if (event.target instanceof HTMLInputElement) { return; }
	if ((event.ctrlKey || event.metaKey) && event.code === 'KeyA') {
		picked = new Set(visibleRows().map((row) => row.id));
		anchorId = null;
		event.preventDefault();
		render();
		return;
	}
	if ((event.ctrlKey || event.metaKey) && event.code === 'KeyC') {
		copyRows();
		event.preventDefault();
		return;
	}
	if (event.code === 'Escape' && picked.size > 0) {
		clearPicked();
		render();
	}
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
		kinds = data.kinds || kinds;
		renderTabs();
		document.getElementById('table').hidden = true;
		const state = document.getElementById('state');
		state.hidden = false;
		state.className = 'state error';
		state.textContent = data.message;
		return;
	}
	if (data.type === 'data') {
		kind = data.kind;
		kinds = data.kinds;
		columns = data.columns;
		rows = data.rows;
		// Выбор сбрасывается: строки перечитаны, и часть отмеченных объектов на
		// сервере могло уже не остаться.
		clearPicked();
		document.getElementById('subtitle').textContent = data.subtitle;
		render();
	}
});
</script>
</body>
</html>`;
}
