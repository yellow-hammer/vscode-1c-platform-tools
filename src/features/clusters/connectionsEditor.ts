/**
 * Форма подключений к серверам администрирования.
 *
 * Подключение заводится и правится в обычной форме — вкладкой редактора, а не
 * цепочкой диалогов: полей полдесятка, и видеть их вместе важнее, чем отвечать
 * на вопросы по одному. Здесь же кнопка проверки: она отвечает сразу, найдена ли
 * утилита, отвечает ли сервер и принимает ли он администратора.
 *
 * Форма собрана на общем каркасе редакторов служебных файлов (webviewChrome),
 * поэтому список слева, панель сохранения снизу и подписи кнопок такие же, как
 * у пайплайнов и хуков.
 *
 * Пароль в список не попадает: форма отдаёт его расширению, а хранится он в
 * защищённом хранилище VS Code. Пустое поле пароля означает «оставить
 * сохранённый», а не «убрать» — иначе правка имени стирала бы доступ.
 */

import * as vscode from 'vscode';
import { CHROME_LABELS, chromeScript, chromeStyles, saveBarHtml } from '../editors/webviewChrome';
import { DEFAULT_RAS_PORT } from './constants';
import { listRacVersions } from './racLocator';
import { readClustersSettings } from './settings';
import type { ClusterService } from './clusterService';
import type { ClusterCredentialStore } from './credentials';
import type { ClustersProvider } from './clustersProvider';
import type { ConnectionStore } from './connectionStore';
import type { ClusterConnection } from './model';

/** Подключение в форме: без пароля, но со сведениями о нём. */
export interface ConnectionDraft {
	/** Идентификатор сохранённого подключения; пусто у нового. */
	id: string;
	name: string;
	host: string;
	port: number;
	clusterUser: string;
	agentUser: string;
	platformVersion: string;
	/** Есть ли сохранённый пароль администратора кластера. */
	hasPassword: boolean;
	/** Есть ли сохранённый пароль администратора центрального сервера. */
	hasAgentPassword: boolean;
	/** Введённый пароль администратора кластера; undefined — не трогали. */
	password?: string;
	/** Введённый пароль администратора центрального сервера. */
	agentPassword?: string;
}

/** Модель формы. */
interface EditorModel {
	connections: ConnectionDraft[];
	selectedId: string;
}

/** Сообщение из формы. */
type EditorMessage =
	| { type: 'save'; data: EditorModel }
	| { type: 'check'; data: ConnectionDraft }
	| { type: 'error'; message: string };

/**
 * Проверяет заполненность подключения.
 *
 * Форма позволяет ввести что угодно, поэтому перед записью проверяются
 * обязательные поля: без адреса подключение бесполезно, а пустое имя сделало бы
 * в дереве безымянную ветку.
 *
 * @param draft - Подключение из формы
 * @returns Список замечаний; пустой список — можно сохранять
 */
export function validateConnectionDraft(draft: ConnectionDraft): string[] {
	const problems: string[] = [];
	if (draft.name.trim() === '') {
		problems.push('не задано название');
	}
	if (draft.host.trim() === '') {
		problems.push('не задан адрес сервера администрирования');
	}
	if (!Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535) {
		problems.push('порт должен быть числом от 1 до 65535');
	}
	if (draft.platformVersion.trim() !== '' && !/^\d+(\.\d+){0,3}$/.test(draft.platformVersion.trim())) {
		problems.push('версия платформы указывается цифрами, например 8.3.27');
	}
	return problems;
}

/**
 * Собирает подключение формы из сохранённого.
 *
 * @param connection - Сохранённое подключение
 * @param hasPassword - Есть ли пароль в защищённом хранилище
 * @returns Запись для формы
 */
export function toConnectionDraft(
	connection: ClusterConnection,
	hasPassword: boolean,
	hasAgentPassword = false
): ConnectionDraft {
	return {
		id: connection.id,
		name: connection.name,
		host: connection.host,
		port: connection.port,
		clusterUser: connection.clusterUser ?? '',
		agentUser: connection.agentUser ?? '',
		platformVersion: connection.platformVersion ?? '',
		hasPassword,
		hasAgentPassword,
	};
}

/** Форма подключений: одна вкладка на окно. */
export class ClusterConnectionsEditor {
	private panel: vscode.WebviewPanel | undefined;

	constructor(
		private readonly store: ConnectionStore,
		private readonly credentials: ClusterCredentialStore,
		private readonly service: ClusterService,
		private readonly provider: ClustersProvider
	) {}

	/**
	 * Открывает форму, при необходимости создавая вкладку.
	 *
	 * @param selectedId - Подключение, на котором открыть форму; `new` — новое
	 */
	async open(selectedId?: string): Promise<void> {
		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel(
				'1cClusterConnections',
				'Подключения к кластерам 1С',
				vscode.ViewColumn.Active,
				{ enableScripts: true, retainContextWhenHidden: true }
			);
			this.panel.webview.html = buildHtml();
			this.panel.webview.onDidReceiveMessage((message: EditorMessage) =>
				this.handleMessage(message)
			);
			this.panel.onDidDispose(() => {
				this.panel = undefined;
			});
		} else {
			this.panel.reveal(vscode.ViewColumn.Active);
		}
		await this.postModel(selectedId);
	}

	dispose(): void {
		this.panel?.dispose();
		this.panel = undefined;
	}

	/**
	 * Отправляет в форму текущий список подключений.
	 *
	 * @param selectedId - Подключение, которое должно быть выбрано
	 */
	private async postModel(selectedId?: string): Promise<void> {
		const connections: ConnectionDraft[] = [];
		for (const connection of this.store.list()) {
			const password = await this.credentials.clusterPassword(connection.id);
			const agentPassword = await this.credentials.agentPassword(connection.id);
			connections.push(
				toConnectionDraft(
					connection,
					password !== undefined && password !== '',
					agentPassword !== undefined && agentPassword !== ''
				)
			);
		}
		void this.panel?.webview.postMessage({
			type: 'model',
			model: { connections, selectedId: selectedId ?? connections[0]?.id ?? '' },
			defaultPort: DEFAULT_RAS_PORT,
			// Версии перечитываются при каждом открытии: платформу могли доустановить,
			// пока форма была закрыта.
			versions: listRacVersions(readClustersSettings().platformPath),
		});
	}

	/**
	 * Обрабатывает сообщение формы.
	 *
	 * @param message - Сообщение
	 */
	private async handleMessage(message: EditorMessage): Promise<void> {
		if (message.type === 'error') {
			void vscode.window.showErrorMessage(`Форма подключений: ${message.message}`);
			return;
		}
		if (message.type === 'check') {
			await this.check(message.data);
			return;
		}
		await this.save(message.data);
	}

	/**
	 * Записывает правки формы в хранилище.
	 *
	 * Порядок важен: сначала проверка, потом запись. Наполовину применённый
	 * список хуже отклонённого — администратор увидел бы в дереве часть правок.
	 *
	 * @param model - Модель формы
	 */
	private async save(model: EditorModel): Promise<void> {
		const problems: string[] = [];
		for (const draft of model.connections) {
			for (const problem of validateConnectionDraft(draft)) {
				problems.push(`«${draft.name || draft.host || 'без названия'}»: ${problem}`);
			}
		}
		if (problems.length > 0) {
			void this.panel?.webview.postMessage({
				type: 'saveFailed',
				message: problems.join('; '),
			});
			return;
		}

		const keptIds = new Set<string>();
		for (const draft of model.connections) {
			const input = {
				name: draft.name.trim(),
				host: draft.host.trim(),
				port: draft.port,
				clusterUser: draft.clusterUser.trim() || undefined,
				agentUser: draft.agentUser.trim() || undefined,
				platformVersion: draft.platformVersion.trim() || undefined,
			};
			const saved = draft.id && this.store.get(draft.id)
				? await this.store.update(draft.id, input)
				: await this.store.add(input);
			if (!saved) {
				continue;
			}
			keptIds.add(saved.id);
			// Пустое поле пароля не трогает сохранённый: очистка — это снятие
			// администратора кластера, иначе правка соседнего поля стирала бы доступ.
			if (draft.password !== undefined && draft.password !== '') {
				await this.credentials.setClusterPassword(saved.id, draft.password);
			}
			if (draft.agentPassword !== undefined && draft.agentPassword !== '') {
				await this.credentials.setAgentPassword(saved.id, draft.agentPassword);
			}
			if (!input.clusterUser) {
				await this.credentials.setClusterPassword(saved.id, '');
			}
			if (!input.agentUser) {
				await this.credentials.setAgentPassword(saved.id, '');
			}
		}

		for (const existing of this.store.list()) {
			if (!keptIds.has(existing.id)) {
				await this.store.remove(existing.id);
				await this.credentials.forgetConnection(existing.id);
			}
		}

		this.provider.refresh();
		await this.postModel(model.selectedId);
		void this.panel?.webview.postMessage({ type: 'saved' });
	}

	/**
	 * Проверяет подключение и сообщает итог в форму.
	 *
	 * @param draft - Проверяемое подключение
	 */
	private async check(draft: ConnectionDraft): Promise<void> {
		const problems = validateConnectionDraft(draft);
		if (problems.length > 0) {
			void this.panel?.webview.postMessage({
				type: 'checkResult',
				ok: false,
				message: problems.join('; '),
			});
			return;
		}

		const connection: ClusterConnection = {
			id: draft.id || 'draft',
			name: draft.name.trim(),
			host: draft.host.trim(),
			port: draft.port,
			clusterUser: draft.clusterUser.trim() || undefined,
			agentUser: draft.agentUser.trim() || undefined,
			platformVersion: draft.platformVersion.trim() || undefined,
		};
		const result = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: 'Проверяю подключение к кластеру' },
			() => this.service.checkConnection(connection, draft.password)
		);
		void this.panel?.webview.postMessage(
			result.ok
				? {
						type: 'checkResult',
						ok: true,
						message: result.value.adminChecked
							? `Сервер отвечает, кластеров: ${result.value.clusters.length}; администратор принят`
							: `Сервер отвечает, кластеров: ${result.value.clusters.length}`,
					}
				: { type: 'checkResult', ok: false, message: result.failure.message }
		);
	}
}

/** Разметка и скрипт формы. */
function buildHtml(): string {
	const nonce = Math.random().toString(36).slice(2);
	return /* html */ `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
${chromeStyles()}
	.chrome-body { grid-template-columns: 260px minmax(0, 1fr); }
	.main { overflow: auto; padding: 16px 22px 28px; max-width: 640px; }
	.row { display: grid; gap: 12px; }
	.row.address { grid-template-columns: minmax(0, 1fr) 110px; }
	.row.auth { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
	.actions { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
	.check-result { font-size: 0.88em; }
	.check-result.ok { color: var(--ok); }
	.check-result.fail { color: var(--fail); }
</style>
</head>
<body>
<div class="chrome">
	<div class="toolbar">
		<span class="title">Подключения к кластерам 1С</span>
	</div>
	<div class="chrome-body">
		<div class="side left">
			<h2>Подключения <button class="round" id="addButton" title="Добавить">${CHROME_LABELS.add}</button></h2>
			<div id="list"></div>
		</div>
		<div class="main" id="main"></div>
	</div>
	${saveBarHtml()}
</div>
<script nonce="${nonce}">
${chromeScript()}

let draft = { connections: [], selectedId: '' };
let baseline = { connections: [], selectedId: '' };
let defaultPort = ${DEFAULT_RAS_PORT};
let versions = [];
let checkResult = null;
const checkResults = {};

function selected() {
	return draft.connections.find((item) => item.id === draft.selectedId);
}

/** Вторая строка в списке: адрес и, если задан, администратор кластера */
function connectionSubtitle(item) {
	const address = item.host ? item.host + ':' + item.port : 'адрес не задан';
	return item.clusterUser ? address + ' · ' + item.clusterUser : address;
}

function renderList() {
	const list = document.getElementById('list');
	list.textContent = '';
	if (draft.connections.length === 0) {
		list.appendChild(empty('Подключений пока нет'));
		return;
	}
	for (const item of draft.connections) {
		// Точка слева показывает итог последней проверки: зелёная — сервер ответил,
		// красная — нет. Так видно состояние всего списка, а не только текущей строки.
		const checked = checkResults[item.id];
		list.appendChild(listItem({
			title: item.name || 'Без названия',
			subtitle: connectionSubtitle(item),
			color: checked === 'ok' ? 'var(--ok)' : checked === 'fail' ? 'var(--fail)' : undefined,
			active: item.id === draft.selectedId,
			onSelect: () => { draft.selectedId = item.id; checkResult = null; renderAll(); },
			onRemove: () => {
				draft.connections = draft.connections.filter((entry) => entry.id !== item.id);
				if (draft.selectedId === item.id) {
					draft.selectedId = draft.connections.length ? draft.connections[0].id : '';
				}
				checkResult = null;
				renderAll();
			}
		}));
	}
}

/** Поле пароля: значение уходит в защищённое хранилище, в списке не хранится */
function passwordField(item, valueKey, savedKey) {
	const wrap = document.createElement('div');
	wrap.className = 'field';
	const label = document.createElement('label');
	label.textContent = 'Пароль';
	const input = document.createElement('input');
	input.type = 'password';
	input.value = item[valueKey] === undefined ? '' : item[valueKey];
	input.placeholder = item[savedKey] ? 'сохранён, оставьте пустым' : 'не задан';
	input.addEventListener('input', () => { pendingEdit = true; renderSaveBar(); });
	input.addEventListener('change', () => {
		pendingEdit = false;
		item[valueKey] = input.value;
		renderSaveBar();
	});
	wrap.appendChild(label);
	wrap.appendChild(input);
	return wrap;
}

function renderMain() {
	const main = document.getElementById('main');
	main.textContent = '';
	const item = selected();
	if (!item) {
		main.appendChild(empty('Выберите подключение слева или добавьте новое.'));
		return;
	}

	main.appendChild(caption('Сервер'));
	main.appendChild(field('Название', item.name, (value) => { item.name = value; renderAll(); }));

	const address = document.createElement('div');
	address.className = 'row address';
	address.appendChild(field('Сервер администрирования (ras)', item.host, (value) => { item.host = value; renderAll(); }));
	address.appendChild(field('Порт', item.port, (value) => {
		const parsed = parseInt(value, 10);
		item.port = isNaN(parsed) ? defaultPort : parsed;
		renderAll();
	}, 'number'));
	main.appendChild(address);
	main.appendChild(versionField(item));

	main.appendChild(caption('Администратор кластера'));
	const auth = document.createElement('div');
	auth.className = 'row auth';
	auth.appendChild(field('Имя', item.clusterUser, (value) => { item.clusterUser = value; renderAll(); }));
	auth.appendChild(passwordField(item, 'password', 'hasPassword'));
	main.appendChild(auth);

	// Администратор центрального сервера нужен только правке свойств кластера,
	// поэтому раздел идёт последним и заполняется по необходимости
	main.appendChild(caption('Администратор центрального сервера'));
	const agentAuth = document.createElement('div');
	agentAuth.className = 'row auth';
	agentAuth.appendChild(field('Имя', item.agentUser, (value) => { item.agentUser = value; renderAll(); }));
	agentAuth.appendChild(passwordField(item, 'agentPassword', 'hasAgentPassword'));
	main.appendChild(agentAuth);

	const actions = document.createElement('div');
	actions.className = 'actions';
	const checkButton = document.createElement('button');
	checkButton.textContent = 'Проверить подключение';
	checkButton.addEventListener('click', () => {
		checkResult = { message: 'Проверяю…', pending: true };
		renderAll();
		post({ type: 'check', data: item });
	});
	actions.appendChild(checkButton);
	if (checkResult) {
		const result = document.createElement('div');
		result.className = 'check-result ' + (checkResult.pending ? '' : (checkResult.ok ? 'ok' : 'fail'));
		result.textContent = checkResult.message;
		actions.appendChild(result);
	}
	main.appendChild(actions);
}

/** Подпись раздела формы */
function caption(text) {
	const element = document.createElement('h2');
	element.textContent = text;
	return element;
}

/** Версия платформы: выбор из установленных с возможностью вписать свою */
function versionField(item) {
	const wrap = document.createElement('div');
	wrap.className = 'field';
	const label = document.createElement('label');
	label.textContent = 'Версия платформы';
	const input = document.createElement('input');
	input.type = 'text';
	input.value = item.platformVersion;
	input.setAttribute('list', 'platformVersions');
	input.placeholder = versions.length ? 'по умолчанию ' + versions[0] : '8.3.27';
	input.addEventListener('input', () => { pendingEdit = true; renderSaveBar(); });
	input.addEventListener('change', () => {
		pendingEdit = false;
		item.platformVersion = input.value;
		renderAll();
	});
	const list = document.createElement('datalist');
	list.id = 'platformVersions';
	for (const version of versions) {
		const option = document.createElement('option');
		option.value = version;
		list.appendChild(option);
	}
	wrap.appendChild(label);
	wrap.appendChild(input);
	wrap.appendChild(list);
	return wrap;
}

function renderAll() {
	renderList();
	renderMain();
	renderSaveBar();
}

document.getElementById('addButton').addEventListener('click', () => {
	const item = {
		id: 'new-' + Date.now().toString(36),
		name: '',
		host: '',
		port: defaultPort,
		clusterUser: '',
		agentUser: '',
		platformVersion: '',
		hasPassword: false,
		hasAgentPassword: false
	};
	draft.connections.push(item);
	draft.selectedId = item.id;
	checkResult = null;
	renderAll();
});

window.addEventListener('message', (event) => {
	const data = event.data;
	if (data.type === 'model') {
		defaultPort = data.defaultPort;
		versions = data.versions || [];
		draft = JSON.parse(JSON.stringify(data.model));
		baseline = JSON.parse(JSON.stringify(data.model));
		checkResult = null;
		commit();
		return;
	}
	if (data.type === 'saved') {
		saveStatus = ${JSON.stringify(CHROME_LABELS.saved)};
		saveStatusKind = 'ok';
		renderSaveBar();
		return;
	}
	if (data.type === 'saveFailed') {
		saveStatus = data.message;
		saveStatusKind = 'error';
		renderSaveBar();
		return;
	}
	if (data.type === 'checkResult') {
		checkResult = { ok: data.ok, message: data.message };
		const current = selected();
		if (current) { checkResults[current.id] = data.ok ? 'ok' : 'fail'; }
		renderAll();
	}
});

renderAll();
</script>
</body>
</html>`;
}
