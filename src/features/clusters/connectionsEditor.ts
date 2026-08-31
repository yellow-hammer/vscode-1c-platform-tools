/**
 * Форма подключений к серверам администрирования и учётных данных.
 *
 * Подключение заводится и правится в обычной форме — вкладкой редактора, а не
 * цепочкой диалогов: полей полдесятка, и видеть их вместе важнее, чем отвечать
 * на вопросы по одному. Здесь же кнопка проверки: она отвечает сразу, найдена ли
 * утилита и отвечает ли сервер.
 *
 * Наборы учётных данных живут в этой же форме, второй секцией списка слева:
 * доступ к кластеру настраивают там же, где и сам кластер, — отдельная вкладка
 * заставляла бы искать вторую форму. Пароль после сохранения не показывается;
 * привязки набора к базам видны у выбранного набора и снимаются здесь, а
 * назначаются — из дерева.
 *
 * Форма собрана на общем каркасе редакторов служебных файлов (webviewChrome),
 * поэтому список слева, панель сохранения снизу и подписи кнопок такие же, как
 * у пайплайнов и хуков.
 */

import * as vscode from 'vscode';
import { notifyQuiet } from '../../shared/notify';
import { CHROME_LABELS, chromeScript, chromeStyles, saveBarHtml } from '../editors/webviewChrome';
import { DEFAULT_RAS_PORT } from './constants';
import { listRacVersions } from './racLocator';
import { readClustersSettings } from './settings';
import type { ClusterService } from './clusterService';
import type { ClustersProvider } from './clustersProvider';
import type { ConnectionStore } from './connectionStore';
import type { ClusterConnection } from './model';
import {
	validateCredentialSetInput,
	type ClusterBinding,
	type ClusterCredentialStore,
	type CredentialRole,
	type CredentialSet,
	type InfobaseBinding,
} from './credentials';

/** Подключение в форме. */
export interface ConnectionDraft {
	/** Идентификатор сохранённого подключения; пусто у нового. */
	id: string;
	name: string;
	host: string;
	port: number;
	platformVersion: string;
	/** Набор администратора кластера для этого подключения; пусто — не задан. */
	clusterSetId: string;
	/** Набор администратора центрального сервера; пусто — не задан. */
	agentSetId: string;
}

/** Набор учётных данных в форме: без пароля, но со сведениями о нём. */
export interface CredentialSetDraft {
	id: string;
	name: string;
	user: string;
	/** Роль набора: она же группа в списке. */
	kind: CredentialRole;
	hasPassword: boolean;
	/** Введённый пароль; undefined — не трогали. */
	password?: string;
}

/** Что выбрано в форме: подключение или набор. */
export interface EditorSelection {
	kind: 'connection' | 'set' | '';
	id: string;
	/** Роль создаваемого набора, когда `id: 'new'`. */
	setKind?: CredentialRole;
}

/** На чём открыть форму; `id: 'new'` — добавить запись. */
export interface EditorTarget {
	kind: 'connection' | 'set';
	id?: string;
	/** Для наборов: какую группу открыть или какой роли запись создать. */
	setKind?: CredentialRole;
}

/** Модель формы. */
interface EditorModel {
	connections: ConnectionDraft[];
	sets: CredentialSetDraft[];
	selected: EditorSelection;
}

/** Сообщение из формы. */
type EditorMessage =
	| { type: 'save'; data: EditorModel }
	| { type: 'check'; data: ConnectionDraft }
	| { type: 'checkSet'; data: CredentialSetDraft }
	| { type: 'bindSet'; setId: string }
	| { type: 'bindSetCluster'; setId: string }
	| { type: 'bindSetServer'; setId: string }
	| { type: 'unbind'; binding: InfobaseBinding }
	| { type: 'unbindCluster'; binding: ClusterBinding }
	| { type: 'unbindServer'; connectionId: string; setId: string }
	| { type: 'error'; message: string };

/**
 * Пустая заготовка подключения: ещё не начали заполнять.
 *
 * Заготовка появляется при открытии формы кнопкой «плюс» и не должна ни
 * сохраняться, ни мешать сохранению остального: свежая форма с нетронутой
 * заготовкой — обычное состояние, а не ошибка ввода.
 */
export function isBlankConnectionDraft(draft: ConnectionDraft): boolean {
	return draft.name.trim() === '' && draft.host.trim() === '';
}

/** Пустая заготовка набора: см. {@link isBlankConnectionDraft}. */
export function isBlankSetDraft(draft: CredentialSetDraft): boolean {
	return draft.name.trim() === '' && draft.user.trim() === '' && !draft.password;
}

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
 * @returns Запись для формы
 */
export function toConnectionDraft(connection: ClusterConnection): ConnectionDraft {
	return {
		id: connection.id,
		name: connection.name,
		host: connection.host,
		port: connection.port,
		platformVersion: connection.platformVersion ?? '',
		clusterSetId: '',
		agentSetId: '',
	};
}

/**
 * Собирает набор формы из сохранённого.
 *
 * @param set - Сохранённый набор
 * @param hasPassword - Есть ли пароль в защищённом хранилище
 * @returns Запись для формы
 */
export function toCredentialSetDraft(set: CredentialSet, hasPassword: boolean): CredentialSetDraft {
	return {
		id: set.id,
		name: set.name,
		user: set.user,
		kind: set.kind,
		hasPassword,
	};
}

/**
 * Решает, что выбрать в форме при открытии.
 *
 * Просьба открыть несуществующую или пустую секцию не остаётся пустым экраном:
 * выбирается первая запись нужного вида, а в пустой секции — заготовка новой,
 * чтобы по кнопке уведомления сразу открылись поля для ввода.
 *
 * @param target - На чём просили открыть форму
 * @param connectionIds - Идентификаторы сохранённых подключений
 * @param setIds - Идентификаторы сохранённых наборов
 * @returns Выбор для модели формы; `id: 'new'` — форма создаст запись
 */
export function resolveEditorSelection(
	target: EditorTarget | undefined,
	connectionIds: string[],
	setIds: string[]
): EditorSelection {
	const kind = target?.kind ?? 'connection';
	const ids = kind === 'set' ? setIds : connectionIds;
	if (target?.id === 'new') {
		return { kind, id: 'new' };
	}
	if (target?.id !== undefined && ids.includes(target.id)) {
		return { kind, id: target.id };
	}
	if (ids.length > 0) {
		return { kind, id: ids[0] };
	}
	// Другая секция не подменяет запрошенную: спрашивали учётные данные —
	// открываются учётные данные, пусть и пустые.
	return { kind, id: 'new' };
}

/** Форма подключений и учётных данных: одна вкладка на окно. */
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
	 * @param target - Подключение или набор, на котором открыть форму
	 */
	async open(target?: EditorTarget): Promise<void> {
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
		await this.postModel(target);
	}

	dispose(): void {
		this.panel?.dispose();
		this.panel = undefined;
	}

	/**
	 * Отправляет в форму текущие списки подключений и наборов.
	 *
	 * @param target - Запись, которая должна быть выбрана
	 * @param options - `replace` — заменить черновик даже с несохранёнными
	 * правками: после записи хранилище главнее формы
	 */
	private async postModel(target?: EditorTarget, options?: { replace?: boolean }): Promise<void> {
		const connections = this.store.list().map((connection) => ({
			...toConnectionDraft(connection),
			clusterSetId: this.credentials.boundConnectionSet(connection.id, 'cluster')?.id ?? '',
			agentSetId: this.credentials.boundConnectionSet(connection.id, 'agent')?.id ?? '',
		}));
		const sets: CredentialSetDraft[] = [];
		for (const set of this.credentials.list()) {
			const password = await this.credentials.password(set.id);
			sets.push(toCredentialSetDraft(set, password !== undefined && password !== ''));
		}
		// Просьба открыть группу наборов без записи ведёт к первому набору этой
		// группы, а в пустой группе — к заготовке того же вида.
		let effective = target;
		if (target?.kind === 'set' && target.id === undefined && target.setKind) {
			const first = sets.find((set) => set.kind === target.setKind);
			effective = { kind: 'set', id: first ? first.id : 'new', setKind: target.setKind };
		}
		let selected = resolveEditorSelection(
			effective,
			connections.map((item) => item.id),
			sets.map((item) => item.id)
		);
		if (selected.kind === 'set' && selected.id === 'new') {
			selected = {
				...selected,
				setKind: effective?.kind === 'set' ? (effective.setKind ?? 'cluster') : 'cluster',
			};
		}
		// Привязки «набор для сервера»: те же записи, что правят селекты
		// подключения, но с именами для карточки набора
		const serverBindings = this.credentials.listConnectionBindings().map((binding) => ({
			...binding,
			connectionName: this.store.get(binding.connectionId)?.name ?? binding.connectionId,
		}));
		void this.panel?.webview.postMessage({
			type: 'model',
			replace: options?.replace === true,
			model: { connections, sets, selected },
			bindings: this.credentials.listBindings(),
			clusterBindings: this.credentials.listClusterBindings(),
			serverBindings,
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
		if (message.type === 'unbind') {
			await this.credentials.unbindInfobase(message.binding.connectionId, message.binding.infobaseId);
			this.provider.refresh();
			await this.postModel({ kind: 'set', id: message.binding.setId });
			return;
		}
		if (message.type === 'unbindCluster') {
			await this.credentials.unbindCluster(
				message.binding.connectionId,
				message.binding.clusterId
			);
			this.provider.refresh();
			await this.postModel({ kind: 'set', id: message.binding.setId });
			return;
		}
		if (message.type === 'unbindServer') {
			await this.credentials.bindConnectionRole(message.connectionId, 'agent', '');
			this.provider.refresh();
			await this.postModel({ kind: 'set', id: message.setId });
			return;
		}
		if (message.type === 'check') {
			await this.checkConnection(message.data);
			return;
		}
		if (message.type === 'checkSet') {
			await this.checkSet(message.data);
			return;
		}
		if (message.type === 'bindSet') {
			await this.pickBinding(message.setId);
			return;
		}
		if (message.type === 'bindSetCluster') {
			await this.pickClusterBinding(message.setId);
			return;
		}
		if (message.type === 'bindSetServer') {
			await this.pickServerBinding(message.setId);
			return;
		}
		await this.save(message.data);
	}

	/**
	 * Предлагает выбрать сервер и назначает ему набор центрального сервера.
	 *
	 * Пишет ту же привязку, что и выбор в карточке подключения: это два входа в
	 * одну настройку, со стороны набора и со стороны сервера.
	 *
	 * @param setId - Идентификатор сохранённого набора
	 */
	private async pickServerBinding(setId: string): Promise<void> {
		const set = this.credentials.get(setId);
		if (!set) {
			notifyQuiet('Сначала сохраните набор: привязка хранится по сохранённой записи');
			return;
		}
		const connections = this.store.list();
		if (connections.length === 0) {
			notifyQuiet('Сначала создайте подключение к кластеру');
			return;
		}
		const picked = await vscode.window.showQuickPick(
			connections.map((connection) => {
				const current = this.credentials.boundConnectionSet(connection.id, 'agent');
				return {
					label: connection.name,
					description: `${connection.host}:${connection.port}`,
					detail: current ? `сейчас назначен набор «${current.name}»` : undefined,
					connection,
				};
			}),
			{ title: `Сервер для набора «${set.name}»`, placeHolder: 'Подключение' }
		);
		if (!picked) {
			return;
		}
		await this.credentials.bindConnectionRole(picked.connection.id, 'agent', setId);
		this.provider.refresh();
		await this.postModel({ kind: 'set', id: setId });
	}

	/**
	 * Предлагает выбрать кластер и привязывает к нему административный набор.
	 *
	 * @param setId - Идентификатор сохранённого набора
	 */
	private async pickClusterBinding(setId: string): Promise<void> {
		const set = this.credentials.get(setId);
		if (!set) {
			notifyQuiet('Сначала сохраните набор: привязка хранится по сохранённой записи');
			return;
		}

		interface ClusterPick extends vscode.QuickPickItem {
			connection: ClusterConnection;
			clusterId: string;
			clusterName: string;
		}
		const items: ClusterPick[] = [];
		const failures: string[] = [];
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: 'Читаю список кластеров' },
			async () => {
				for (const connection of this.store.list()) {
					const clusters = await this.service.listClusters(connection);
					if (!clusters.ok) {
						failures.push(`${connection.name}: ${clusters.failure.message}`);
						continue;
					}
					for (const cluster of clusters.value) {
						const bound = this.credentials.boundClusterSet(connection.id, cluster.id);
						items.push({
							label: cluster.name || cluster.host,
							description: connection.name,
							detail: bound ? `сейчас привязан набор «${bound.name}»` : undefined,
							connection,
							clusterId: cluster.id,
							clusterName: cluster.name || cluster.host,
						});
					}
				}
			}
		);
		if (items.length === 0) {
			void vscode.window.showWarningMessage(
				failures[0] ?? 'Кластеров не нашлось: проверьте подключения.'
			);
			return;
		}

		const picked = await vscode.window.showQuickPick(items, {
			title: `Кластер для набора «${set.name}»`,
			placeHolder: 'Кластер',
		});
		if (!picked) {
			return;
		}
		await this.credentials.bindCluster({
			connectionId: picked.connection.id,
			clusterId: picked.clusterId,
			setId,
			connectionName: picked.connection.name,
			clusterName: picked.clusterName,
		});
		this.provider.refresh();
		await this.postModel({ kind: 'set', id: setId });
	}

	/**
	 * Предлагает выбрать информационную базу и привязывает к ней набор.
	 *
	 * Список баз читается по всем подключениям на месте: администратор привязывает
	 * набор там же, где его заводит, а не идёт искать базу в дереве.
	 *
	 * @param setId - Идентификатор сохранённого набора
	 */
	private async pickBinding(setId: string): Promise<void> {
		const set = this.credentials.get(setId);
		if (!set) {
			notifyQuiet('Сначала сохраните набор: привязка хранится по сохранённой записи');
			return;
		}

		interface InfobasePick extends vscode.QuickPickItem {
			connection: ClusterConnection;
			clusterId: string;
			infobaseId: string;
			infobaseName: string;
		}
		const items: InfobasePick[] = [];
		const failures: string[] = [];
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: 'Читаю список информационных баз' },
			async () => {
				for (const connection of this.store.list()) {
					const clusters = await this.service.listClusters(connection);
					if (!clusters.ok) {
						failures.push(`${connection.name}: ${clusters.failure.message}`);
						continue;
					}
					for (const cluster of clusters.value) {
						const infobases = await this.service.listInfobases(connection, cluster.id);
						if (!infobases.ok) {
							failures.push(`${connection.name}: ${infobases.failure.message}`);
							continue;
						}
						for (const infobase of infobases.value) {
							const bound = this.credentials.boundSetName(connection.id, infobase.id);
							items.push({
								label: infobase.name,
								description: `${cluster.name || cluster.host} · ${connection.name}`,
								detail: bound ? `сейчас привязан набор «${bound}»` : undefined,
								connection,
								clusterId: cluster.id,
								infobaseId: infobase.id,
								infobaseName: infobase.name,
							});
						}
					}
				}
			}
		);
		if (items.length === 0) {
			void vscode.window.showWarningMessage(
				failures[0] ?? 'Информационных баз не нашлось: проверьте подключения.'
			);
			return;
		}

		const picked = await vscode.window.showQuickPick(items, {
			title: `База для набора «${set.name}»`,
			placeHolder: 'Информационная база',
		});
		if (!picked) {
			return;
		}
		await this.credentials.bindInfobase({
			connectionId: picked.connection.id,
			clusterId: picked.clusterId,
			infobaseId: picked.infobaseId,
			setId,
			connectionName: picked.connection.name,
			infobaseName: picked.infobaseName,
		});
		this.provider.refresh();
		await this.postModel({ kind: 'set', id: setId });
	}

	/**
	 * Записывает правки формы в хранилища.
	 *
	 * Порядок важен: сначала проверка всего, потом запись. Наполовину применённый
	 * список хуже отклонённого — администратор увидел бы в дереве часть правок.
	 *
	 * @param model - Модель формы
	 */
	private async save(model: EditorModel): Promise<void> {
		// Нетронутые заготовки не сохраняются и не мешают сохранению остального
		const connections = model.connections.filter((draft) => !isBlankConnectionDraft(draft));
		const sets = model.sets.filter((draft) => !isBlankSetDraft(draft));

		const problems: string[] = [];
		for (const draft of connections) {
			for (const problem of validateConnectionDraft(draft)) {
				problems.push(`«${draft.name || draft.host || 'без названия'}»: ${problem}`);
			}
		}
		for (const draft of sets) {
			for (const problem of validateCredentialSetInput(draft)) {
				problems.push(`«${draft.name || draft.user || 'без названия'}»: ${problem}`);
			}
		}
		if (problems.length > 0) {
			void this.panel?.webview.postMessage({
				type: 'saveFailed',
				message: problems.join('; '),
			});
			return;
		}

		// Наборы сохраняются первыми: привязки подключений ссылаются на их
		// идентификаторы, а у новых записей те появляются только при записи.
		const savedSets = new Map<string, string>();
		for (const draft of sets) {
			const input = {
				name: draft.name.trim(),
				user: draft.user.trim(),
				kind: draft.kind,
			};
			const saved = draft.id && this.credentials.get(draft.id)
				? await this.credentials.update(draft.id, input, draft.password)
				: await this.credentials.add(input, draft.password ?? '');
			if (saved) {
				savedSets.set(draft.id, saved.id);
			}
		}
		const keptSets = new Set(savedSets.values());
		for (const existing of this.credentials.list()) {
			if (!keptSets.has(existing.id)) {
				await this.credentials.remove(existing.id);
			}
		}
		const savedConnections = new Map<string, string>();
		for (const draft of connections) {
			const input = {
				name: draft.name.trim(),
				host: draft.host.trim(),
				port: draft.port,
				platformVersion: draft.platformVersion.trim() || undefined,
			};
			const saved = draft.id && this.store.get(draft.id)
				? await this.store.update(draft.id, input)
				: await this.store.add(input);
			if (saved) {
				savedConnections.set(draft.id, saved.id);
			}
		}
		const keptConnections = new Set(savedConnections.values());
		for (const existing of this.store.list()) {
			if (!keptConnections.has(existing.id)) {
				await this.store.remove(existing.id);
				await this.credentials.forgetConnection(existing.id);
			}
		}

		// Привязки наборов к подключениям: пустой выбор снимает привязку
		for (const draft of connections) {
			const connectionId = savedConnections.get(draft.id);
			if (!connectionId) {
				continue;
			}
			await this.credentials.bindConnectionRole(
				connectionId,
				'cluster',
				savedSets.get(draft.clusterSetId) ?? draft.clusterSetId
			);
			await this.credentials.bindConnectionRole(
				connectionId,
				'agent',
				savedSets.get(draft.agentSetId) ?? draft.agentSetId
			);
		}

		this.provider.refresh();
		await this.postModel(
			model.selected.kind === '' ? undefined : { kind: model.selected.kind, id: model.selected.id },
			{ replace: true }
		);
		void this.panel?.webview.postMessage({ type: 'saved' });
	}

	/**
	 * Проверяет подключение и сообщает итог в форму.
	 *
	 * @param draft - Проверяемое подключение
	 */
	private async checkConnection(draft: ConnectionDraft): Promise<void> {
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
			platformVersion: draft.platformVersion.trim() || undefined,
		};
		const result = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: 'Проверяю подключение к кластеру' },
			() => this.service.checkConnection(connection)
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

	/** Подключение, которому набор назначен для роли: проверка идёт по нему. */
	private connectionBoundTo(setId: string, role: 'cluster' | 'agent'): ClusterConnection | undefined {
		if (!setId) {
			return undefined;
		}
		return this.store
			.list()
			.find((connection) => this.credentials.boundConnectionSet(connection.id, role)?.id === setId);
	}

	/**
	 * Проверяет набор пробой его роли и сообщает итог в форму.
	 *
	 * Единой пробы на все наборы нет: администратора кластера проверяет список
	 * баз, администратора центрального сервера — список его администраторов, а
	 * администратора базы — чтение привязанной базы. Проверять набор «для баз»
	 * через кластер значило бы всегда получать отказ на честных данных.
	 * Привязка задаёт, по какому кластеру, серверу или базе идёт проба.
	 *
	 * @param draft - Проверяемый набор
	 */
	private async checkSet(draft: CredentialSetDraft): Promise<void> {
		const report = (ok: boolean, message: string) =>
			void this.panel?.webview.postMessage({ type: 'checkResult', ok, message });

		const problems = validateCredentialSetInput(draft);
		if (problems.length > 0) {
			report(false, problems.join('; '));
			return;
		}

		const connection = this.store.list()[0];
		if (!connection) {
			report(false, 'Сначала создайте подключение к кластеру');
			return;
		}

		let password = draft.password;
		if (password === undefined && draft.id) {
			password = await this.credentials.password(draft.id);
		}
		const auth = { user: draft.user.trim(), password: password ?? '' };

		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: 'Проверяю учётные данные' },
			async () => {
				if (draft.kind === 'cluster') {
					const clusterBinding = draft.id
						? this.credentials.clusterBindingsForSet(draft.id)[0]
						: undefined;
					if (clusterBinding) {
						const target = this.store.get(clusterBinding.connectionId) ?? connection;
						const result = await this.service.checkClusterAdmin(
							target,
							clusterBinding.clusterId,
							auth
						);
						report(
							result.ok,
							result.ok
								? `Кластер «${clusterBinding.clusterName || clusterBinding.clusterId}»: администратор принят`
								: result.failure.message
						);
						return;
					}
					const target = this.connectionBoundTo(draft.id, 'cluster') ?? connection;
					const result = await this.service.checkConnection(target, auth);
					if (!result.ok) {
						report(false, result.failure.message);
					} else if (result.value.adminChecked) {
						report(true, `Сервер отвечает, кластеров: ${result.value.clusters.length}; администратор принят`);
					} else {
						report(false, 'На сервере нет кластеров, проверить не на чем');
					}
					return;
				}
				if (draft.kind === 'agent') {
					const target = this.connectionBoundTo(draft.id, 'agent') ?? connection;
					const result = await this.service.checkAgentAdmin(target, auth);
					report(
						result.ok,
						result.ok ? 'Администратор центрального сервера принят' : result.failure.message
					);
					return;
				}
				const binding = draft.id ? this.credentials.bindingsForSet(draft.id)[0] : undefined;
				if (!binding) {
					report(false, 'Привяжите набор к базе, чтобы было что проверить');
					return;
				}
				const target = this.store.get(binding.connectionId) ?? connection;
				const result = await this.service.checkInfobaseAdmin(
					target,
					binding.clusterId,
					binding.infobaseId,
					auth
				);
				report(
					result.ok,
					result.ok
						? `База «${binding.infobaseName || binding.infobaseId}»: администратор принят`
						: result.failure.message
				);
			}
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
	.actions { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
	.check-result { font-size: 0.88em; }
	.check-result.ok { color: var(--ok); }
	.check-result.fail { color: var(--fail); }
	.binding { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
	.binding .text { min-width: 0; flex: 1; }
</style>
</head>
<body>
<div class="chrome">
	<div class="toolbar">
		<span class="title">Подключения к кластерам 1С</span>
	</div>
	<div class="chrome-body">
		<div class="side left">
			<h2>Подключения <button class="round" id="addConnection" title="Добавить">${CHROME_LABELS.add}</button></h2>
			<div id="connectionList"></div>
			<h2>Администраторы кластера <button class="round" id="addClusterSet" title="Добавить">${CHROME_LABELS.add}</button></h2>
			<div id="clusterSetList"></div>
			<h2>Администраторы центрального сервера <button class="round" id="addAgentSet" title="Добавить">${CHROME_LABELS.add}</button></h2>
			<div id="agentSetList"></div>
			<h2>Администраторы ИБ <button class="round" id="addInfobaseSet" title="Добавить">${CHROME_LABELS.add}</button></h2>
			<div id="infobaseSetList"></div>
		</div>
		<div class="main" id="main"></div>
	</div>
	${saveBarHtml()}
</div>
<script nonce="${nonce}">
${chromeScript()}

let draft = { connections: [], sets: [], selected: { kind: '', id: '' } };
let baseline = { connections: [], sets: [], selected: { kind: '', id: '' } };
let defaultPort = ${DEFAULT_RAS_PORT};
let versions = [];
let bindings = [];
let clusterBindings = [];
let serverBindings = [];
let checkResult = null;
const checkResults = {};

function selectedConnection() {
	return draft.selected.kind === 'connection'
		? draft.connections.find((item) => item.id === draft.selected.id)
		: undefined;
}

function selectedSet() {
	return draft.selected.kind === 'set'
		? draft.sets.find((item) => item.id === draft.selected.id)
		: undefined;
}

function select(kind, id) {
	draft.selected = { kind: kind, id: id };
	// Выбор — не правка: он повторяется в базовой модели, чтобы панель
	// сохранения не появлялась от одного клика по списку.
	baseline.selected = { kind: kind, id: id };
	checkResult = null;
	renderAll();
}

/** Вторая строка в списке: адрес сервера администрирования */
function connectionSubtitle(item) {
	return item.host ? item.host + ':' + item.port : 'адрес не задан';
}

/** Вторая строка в списке наборов: пользователь */
function setSubtitle(item) {
	return item.user || 'пользователь не задан';
}

/** Цвет точки набора: базы, кластер и центральный сервер различимы издалека */
function setColor(item) {
	if (item.kind === 'infobase') { return 'var(--vscode-charts-blue, #3794ff)'; }
	if (item.kind === 'agent') { return 'var(--vscode-charts-purple, #b180d7)'; }
	return 'var(--vscode-charts-orange, #d18616)';
}

/** Выбор набора для подключения: конкретный набор или «не использовать» */
function setSelect(labelText, item, key, role) {
	const wrap = document.createElement('div');
	wrap.className = 'field';
	const label = document.createElement('label');
	label.textContent = labelText;
	const select = document.createElement('select');
	const none = document.createElement('option');
	none.value = '';
	none.textContent = 'не использовать';
	select.appendChild(none);
	for (const set of draft.sets) {
		if (set.kind !== role) { continue; }
		const option = document.createElement('option');
		option.value = set.id;
		option.textContent = set.name || 'Без названия';
		option.selected = item[key] === set.id;
		select.appendChild(option);
	}
	select.addEventListener('change', () => { item[key] = select.value; fieldEdited(); });
	wrap.appendChild(label);
	wrap.appendChild(select);
	return wrap;
}

function newConnection() {
	const item = {
		id: 'new-' + Date.now().toString(36),
		name: '',
		host: '',
		port: defaultPort,
		platformVersion: '',
		clusterSetId: '',
		agentSetId: ''
	};
	draft.connections.push(item);
	return item;
}

function newSet(kind) {
	const item = {
		id: 'new-' + Date.now().toString(36),
		name: '',
		user: '',
		kind: kind === 'infobase' || kind === 'agent' ? kind : 'cluster',
		hasPassword: false
	};
	draft.sets.push(item);
	return item;
}

function removeItem(kind, id) {
	const remaining = (kind === 'connection' ? draft.connections : draft.sets)
		.filter((entry) => entry.id !== id);
	if (kind === 'connection') { draft.connections = remaining; } else { draft.sets = remaining; }
	if (draft.selected.kind === kind && draft.selected.id === id) {
		draft.selected = remaining.length ? { kind: kind, id: remaining[0].id } : { kind: '', id: '' };
		baseline.selected = { kind: draft.selected.kind, id: draft.selected.id };
	}
	checkResult = null;
	renderAll();
}

function renderConnectionList() {
	const list = document.getElementById('connectionList');
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
			active: draft.selected.kind === 'connection' && item.id === draft.selected.id,
			onSelect: () => select('connection', item.id),
			onRemove: () => removeItem('connection', item.id)
		}));
	}
}

function renderSetGroup(elementId, kindValue, emptyText) {
	const list = document.getElementById(elementId);
	list.textContent = '';
	const items = draft.sets.filter((item) => item.kind === kindValue);
	if (items.length === 0) {
		list.appendChild(empty(emptyText));
		return;
	}
	for (const item of items) {
		list.appendChild(listItem({
			title: item.name || 'Без названия',
			subtitle: setSubtitle(item),
			color: setColor(item),
			active: draft.selected.kind === 'set' && item.id === draft.selected.id,
			onSelect: () => select('set', item.id),
			onRemove: () => removeItem('set', item.id)
		}));
	}
}

/** Подпись раздела формы */
function caption(text) {
	const element = document.createElement('h2');
	element.textContent = text;
	return element;
}

/**
 * Обновляет форму по ходу набора: списки и панель сохранения, но не поля.
 * Перерисовка полей на blur крала фокус — Tab не доходил до следующего поля,
 * а клик из отредактированного поля приходил по уже уничтоженному элементу.
 */
function fieldEdited() {
	renderConnectionList();
	renderSetGroups();
	renderSaveBar();
}

/** Ставит курсор в первое поле: новая запись сразу готова к набору */
function focusFirstField() {
	const input = document.querySelector('.main input');
	if (input) { input.focus(); }
}

/** Нетронутая заготовка подключения */
function isBlankConnection(item) {
	return item.name.trim() === '' && item.host.trim() === '';
}

/** Нетронутая заготовка набора */
function isBlankSet(item) {
	return item.name.trim() === '' && item.user.trim() === '' && !item.password;
}

/**
 * Применяет выбор из просьбы открытия.
 *
 * «new» не плодит заготовки: если нетронутая уже есть — открывается она.
 */
function applySelection(selected) {
	if (selected.id !== 'new') {
		draft.selected = { kind: selected.kind, id: selected.id };
		return false;
	}
	const setKind = selected.setKind === 'infobase' || selected.setKind === 'agent'
		? selected.setKind
		: 'cluster';
	const blank = selected.kind === 'set'
		? draft.sets.find((item) => item.kind === setKind && isBlankSet(item))
		: draft.connections.find((item) => isBlankConnection(item));
	const item = blank || (selected.kind === 'set' ? newSet(setKind) : newConnection());
	draft.selected = { kind: selected.kind, id: item.id };
	return true;
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
	input.addEventListener('input', () => {
		item.platformVersion = input.value;
		fieldEdited();
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

function passwordField(item) {
	const wrap = document.createElement('div');
	wrap.className = 'field';
	const label = document.createElement('label');
	label.textContent = 'Пароль';
	const input = document.createElement('input');
	input.type = 'password';
	input.value = item.password === undefined ? '' : item.password;
	input.placeholder = item.hasPassword ? 'сохранён, оставьте пустым' : 'не задан';
	input.addEventListener('input', () => {
		item.password = input.value;
		fieldEdited();
	});
	wrap.appendChild(label);
	wrap.appendChild(input);
	return wrap;
}

function checkActions(label, message) {
	const actions = document.createElement('div');
	actions.className = 'actions';
	const checkButton = document.createElement('button');
	checkButton.textContent = label;
	checkButton.addEventListener('click', () => {
		checkResult = { message: 'Проверяю…', pending: true };
		renderAll();
		post(message);
	});
	actions.appendChild(checkButton);
	if (checkResult) {
		const result = document.createElement('div');
		result.className = 'check-result ' + (checkResult.pending ? '' : (checkResult.ok ? 'ok' : 'fail'));
		result.textContent = checkResult.message;
		actions.appendChild(result);
	}
	return actions;
}

function renderConnection(main, item) {
	main.appendChild(caption('Сервер'));
	main.appendChild(liveField('Название', item.name, (value) => { item.name = value; fieldEdited(); }));

	const address = document.createElement('div');
	address.className = 'row address';
	address.appendChild(liveField('Сервер администрирования (ras)', item.host, (value) => { item.host = value; fieldEdited(); }));
	address.appendChild(liveField('Порт', item.port, (value) => {
		const parsed = parseInt(value, 10);
		item.port = isNaN(parsed) ? defaultPort : parsed;
		fieldEdited();
	}, 'number'));
	main.appendChild(address);
	main.appendChild(versionField(item));

	// Как у баз, только наоборот: у подключения выбирается набор
	main.appendChild(caption('Учётные данные'));
	main.appendChild(setSelect('Администратор кластера', item, 'clusterSetId', 'cluster'));
	main.appendChild(setSelect('Администратор центрального сервера', item, 'agentSetId', 'agent'));

	main.appendChild(checkActions('Проверить подключение', { type: 'check', data: item }));
}

function renderSet(main, item) {
	main.appendChild(caption('Набор'));
	main.appendChild(liveField('Название', item.name, (value) => { item.name = value; fieldEdited(); }));
	main.appendChild(liveField('Пользователь', item.user, (value) => { item.user = value; fieldEdited(); }));
	main.appendChild(passwordField(item));

	main.appendChild(checkActions('Проверить', { type: 'checkSet', data: item }));

	if (item.kind === 'cluster') {
		renderBindingRows(main, 'Привязки к кластерам', 'Привязать кластер…',
			{ type: 'bindSetCluster', setId: item.id },
			clusterBindings.filter((binding) => binding.setId === item.id).map((binding) => ({
				text: (binding.clusterName || binding.clusterId) + (binding.connectionName ? ' · ' + binding.connectionName : ''),
				message: { type: 'unbindCluster', binding: binding }
			})),
			'Набор нигде не используется: привяжите его к кластеру или выберите у подключения.');
		return;
	}
	if (item.kind === 'agent') {
		renderBindingRows(main, 'Привязки к серверам', 'Привязать сервер…',
			{ type: 'bindSetServer', setId: item.id },
			serverBindings.filter((binding) => binding.setId === item.id && binding.role === 'agent').map((binding) => ({
				text: binding.connectionName,
				message: { type: 'unbindServer', connectionId: binding.connectionId, setId: item.id }
			})),
			'Набор нигде не используется: привяжите его к серверу.');
		return;
	}
	renderBindingRows(main, 'Привязки к базам', 'Привязать базу…',
		{ type: 'bindSet', setId: item.id },
		bindings.filter((binding) => binding.setId === item.id).map((binding) => ({
			text: binding.infobaseName
				? binding.infobaseName + (binding.connectionName ? ' · ' + binding.connectionName : '')
				: binding.infobaseId,
			message: { type: 'unbind', binding: binding }
		})),
		'Набор нигде не используется: привяжите его к базе.');
}

/** Раздел привязок набора: заголовок с кнопкой, строки с крестиком */
function renderBindingRows(main, captionText, bindLabel, bindMessage, rows, emptyText) {
	const head = caption(captionText);
	const bindButton = document.createElement('button');
	bindButton.textContent = bindLabel;
	bindButton.addEventListener('click', () => post(bindMessage));
	head.appendChild(bindButton);
	main.appendChild(head);
	if (rows.length === 0) {
		main.appendChild(empty(emptyText));
		return;
	}
	for (const row of rows) {
		const line = document.createElement('div');
		line.className = 'binding';
		const text = document.createElement('div');
		text.className = 'text';
		text.textContent = row.text;
		const remove = document.createElement('button');
		remove.className = 'icon danger';
		remove.textContent = '✕';
		remove.title = 'Снять';
		remove.addEventListener('click', () => post(row.message));
		line.appendChild(text);
		line.appendChild(remove);
		main.appendChild(line);
	}
}

function renderMain() {
	const main = document.getElementById('main');
	main.textContent = '';
	const connection = selectedConnection();
	if (connection) {
		renderConnection(main, connection);
		return;
	}
	const set = selectedSet();
	if (set) {
		renderSet(main, set);
		return;
	}
	main.appendChild(empty('Выберите подключение или набор учётных данных слева.'));
}

function renderSetGroups() {
	renderSetGroup('clusterSetList', 'cluster', 'Наборов пока нет');
	renderSetGroup('agentSetList', 'agent', 'Наборов пока нет');
	renderSetGroup('infobaseSetList', 'infobase', 'Наборов пока нет');
}

function renderAll() {
	renderConnectionList();
	renderSetGroups();
	renderMain();
	renderSaveBar();
}

document.getElementById('addConnection').addEventListener('click', () => {
	select('connection', newConnection().id);
	focusFirstField();
});

document.getElementById('addClusterSet').addEventListener('click', () => {
	select('set', newSet('cluster').id);
	focusFirstField();
});

document.getElementById('addAgentSet').addEventListener('click', () => {
	select('set', newSet('agent').id);
	focusFirstField();
});

document.getElementById('addInfobaseSet').addEventListener('click', () => {
	select('set', newSet('infobase').id);
	focusFirstField();
});

window.addEventListener('message', (event) => {
	const data = event.data;
	if (data.type === 'model') {
		defaultPort = data.defaultPort;
		versions = data.versions || [];
		bindings = data.bindings || [];
		clusterBindings = data.clusterBindings || [];
		serverBindings = data.serverBindings || [];
		// Повторное открытие формы не затирает несохранённые правки: модель
		// заменяется только чистой. После сохранения хранилище главнее формы —
		// тогда приходит replace, и черновик заменяется безусловно.
		const dirty = !data.replace && (isDirty() || pendingEdit);
		if (!dirty) {
			draft = JSON.parse(JSON.stringify(data.model));
		}
		// «new» в выборе — просьба сразу открыть поля новой записи: так кнопка
		// уведомления приводит в форму, где уже можно набирать, а не искать «плюс».
		const created = applySelection(data.model.selected);
		if (dirty) {
			baseline.selected = { kind: draft.selected.kind, id: draft.selected.id };
			checkResult = null;
			renderAll();
		} else {
			baseline = JSON.parse(JSON.stringify(draft));
			checkResult = null;
			commit();
		}
		if (created) { focusFirstField(); }
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
		const connection = selectedConnection();
		if (connection) { checkResults[connection.id] = data.ok ? 'ok' : 'fail'; }
		renderAll();
	}
});

renderAll();
</script>
</body>
</html>`;
}
