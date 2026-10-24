/**
 * Фича автономного сервера 1С (ibsrv): команды, статус-бар и меню действий.
 *
 * Статус-бар показывает состояние сервера; клик открывает меню (старт/стоп/
 * перезапуск/браузер/логи/конфиг). Видимость — только для проектов 1С.
 */

import * as vscode from 'vscode';
import { registerInfobaseHolder } from '../../shared/exclusiveInfobase';
import { registerODataEndpointProvider, type ODataEndpoint } from '../../shared/odataEndpoint';
import { ODATA_SERVICE_PATH } from '../odata/odataRequest';
import { openLocalUrl } from '../../shared/remoteEnv';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { ServerUrls } from '../../shared/ibsrvPublication';
import { projectPaths } from '../../shared/projectPaths';
import { isAgentOptions, uiOnlyHandler } from '../../shared/agentGate';
import { PlatformServerManager, ServerState, PublicationSelection } from './platformServerManager';
import { ServerDebugSessions } from './serverDebugSessions';
import { notifyQuiet } from '../../shared/notify';
import { projectConfiguration } from '../../shared/projectConfiguration';
import {
	currentRoot,
	onDidChangeCurrentProject,
	onDidChangeProjects,
	projectsSnapshot,
	sameProjectRoot,
	workspaceFolderOf,
} from '../../shared/workspaceProjects';
import { inCurrentProject, projectLabel } from '../../commands/projectScope';
import { ensureWorkspaceTrusted } from '../../shared/workspaceTrust';
import type { StructuredCommandResult } from '../../shared/commandExecutionTypes';
import { serverStatusVisible } from './launchStatusScope';

/**
 * Открывает один из адресов публикации во внешнем браузере.
 *
 * @param manager - Менеджер сервера
 */
async function openInBrowser(manager: PlatformServerManager): Promise<void> {
	const urls: ServerUrls = manager.getUrls() ?? (await manager.previewUrls());
	const running = manager.state === 'running';

	interface UrlItem extends vscode.QuickPickItem {
		url: string;
	}
	const items: UrlItem[] = [
		{ label: '$(home) Корень публикации', description: urls.root, url: urls.root },
		{ label: '$(symbol-interface) OData $metadata', description: urls.odataMetadata, url: urls.odataMetadata },
	];

	const picked = await vscode.window.showQuickPick(items, {
		title: running ? 'Открыть в браузере' : 'Открыть в браузере (сервер не запущен)',
		placeHolder: running ? 'Выберите адрес' : 'Сервер ещё не запущен, адрес может быть недоступен',
		ignoreFocusOut: true,
	});
	if (picked) {
		await openLocalUrl(picked.url);
	}
}

/** Элемент выбора публикуемых сервисов. */
interface PubItem extends vscode.QuickPickItem {
	role: 'odata' | 'webAll' | 'httpAll' | 'web' | 'http' | 'sep';
	serviceName?: string;
}

/**
 * Взаимоисключение «Все <категория>» и отдельных сервисов категории.
 *
 * Если только что отметили «Все Web/HTTP» — снимаем отдельные сервисы категории;
 * если отметили отдельный — снимаем «Все» этой категории.
 *
 * @param selected - Текущий выбор
 * @param previous - Предыдущий выбор (для вычисления только что добавленного)
 * @returns Согласованный выбор
 */
function reconcileSelection(selected: readonly PubItem[], previous: readonly PubItem[]): PubItem[] {
	const added = selected.filter((it) => !previous.includes(it));
	let result = [...selected];
	for (const item of added) {
		if (item.role === 'webAll') {
			result = result.filter((i) => i.role !== 'web');
		} else if (item.role === 'web') {
			result = result.filter((i) => i.role !== 'webAll');
		} else if (item.role === 'httpAll') {
			result = result.filter((i) => i.role !== 'http');
		} else if (item.role === 'http') {
			result = result.filter((i) => i.role !== 'httpAll');
		}
	}
	return result;
}

/**
 * Показывает QuickPick выбора сервисов со взаимоисключением «Все»/отдельные.
 *
 * @param items - Все элементы выбора
 * @param initial - Изначально отмеченные
 * @param hasServices - Доступны ли списки сервисов из метаданных
 * @returns Отмеченные элементы или undefined при отмене
 */
function pickServices(items: PubItem[], initial: PubItem[], hasServices: boolean): Promise<PubItem[] | undefined> {
	return new Promise((resolve) => {
		const qp = vscode.window.createQuickPick<PubItem>();
		qp.canSelectMany = true;
		qp.title = 'Что публиковать автономным сервером';
		qp.placeholder = hasServices
			? 'Отметьте сервисы; «Все …» и отдельные сервисы взаимоисключают друг друга'
			: 'Метаданные недоступны, доступны только категории';
		qp.ignoreFocusOut = true;
		qp.items = items;
		qp.selectedItems = initial;

		let previous: readonly PubItem[] = initial;
		let guard = false;
		qp.onDidChangeSelection((selected) => {
			if (guard) {
				return;
			}
			const reconciled = reconcileSelection(selected, previous);
			const changed = reconciled.length !== selected.length || reconciled.some((it, i) => it !== selected[i]);
			if (changed) {
				guard = true;
				qp.selectedItems = reconciled;
				guard = false;
			}
			previous = qp.selectedItems;
		});

		let accepted = false;
		qp.onDidAccept(() => {
			accepted = true;
			const result = [...qp.selectedItems];
			qp.hide();
			resolve(result);
		});
		qp.onDidHide(() => {
			if (!accepted) {
				resolve(undefined);
			}
			qp.dispose();
		});
		qp.show();
	});
}

/**
 * Выбор публикуемых сервисов (QuickPick по дереву метаданных).
 *
 * «Все Web/HTTP-сервисы» и отдельные сервисы категории взаимоисключают друг
 * друга: включил «Все» — отдельные снимаются, и наоборот. Выбор сохраняется
 * локально и применяется к конфигу публикации.
 *
 * @param manager - Менеджер сервера
 */
async function selectPublishedServices(manager: PlatformServerManager): Promise<void> {
	const root = currentRoot();
	const services = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Чтение сервисов из метаданных…' },
		() => manager.loadServices(root)
	);

	const selection = manager.getPublicationSelection(root);

	const items: PubItem[] = [
		{ label: 'OData', description: 'Стандартный интерфейс OData', role: 'odata' },
		{ label: 'Web-сервисы', kind: vscode.QuickPickItemKind.Separator, role: 'sep' },
		{ label: 'Все Web-сервисы', description: 'публиковать все (по умолчанию)', role: 'webAll' },
	];
	for (const service of services?.web ?? []) {
		items.push({ label: service.name, role: 'web', serviceName: service.name });
	}
	items.push(
		{ label: 'HTTP-сервисы', kind: vscode.QuickPickItemKind.Separator, role: 'sep' },
		{ label: 'Все HTTP-сервисы', description: 'публиковать все (по умолчанию)', role: 'httpAll' }
	);
	for (const service of services?.http ?? []) {
		items.push({ label: service.name, role: 'http', serviceName: service.name });
	}

	const initial = items.filter((it) => {
		switch (it.role) {
			case 'odata': return selection.odata;
			case 'webAll': return selection.webAll;
			case 'httpAll': return selection.httpAll;
			case 'web': return !selection.webAll && selection.web.includes(it.serviceName!);
			case 'http': return !selection.httpAll && selection.http.some((service) => service.name === it.serviceName);
			default: return false;
		}
	});

	const picked = await pickServices(items, initial, services !== undefined);
	if (!picked) {
		return;
	}

	const has = (role: PubItem['role']): boolean => picked.some((p) => p.role === role);
	const names = (role: PubItem['role']): string[] => picked.filter((p) => p.role === role).map((p) => p.serviceName!);

	const httpAll = has('httpAll');
	const httpNames = names('http');
	const next: PublicationSelection = {
		odata: has('odata'),
		webAll: has('webAll'),
		web: names('web'),
		httpAll,
		http: httpAll ? [] : await manager.resolveHttpServices(services?.http ?? [], httpNames, root),
	};
	await manager.setPublicationSelection(next, root);

	const owner = manager.ownerRoot;
	if (manager.state === 'running' && owner !== undefined && root !== undefined && sameProjectRoot(owner, root)) {
		const action = await vscode.window.showInformationMessage(
			'Выбор публикации сохранён. Перезапустить сервер, чтобы применить?',
			'Перезапустить'
		);
		if (action === 'Перезапустить') {
			await manager.restart();
		}
	} else {
		notifyQuiet('Выбор публикуемых сервисов сохранён');
	}
}

/**
 * Запускает отладку через автономный сервер.
 *
 * Включает порт отладки (если выключен), поднимает сервер текущего проекта
 * с `--debug` и подключает отладчик расширения к порту отладки ibsrv в папке
 * рабочей области этого проекта. Идущая отладка второй раз не запускается.
 *
 * @param manager - Менеджер сервера
 * @param debugSessions - Сессии отладки через сервер
 */
export async function startServerDebug(manager: PlatformServerManager, debugSessions: ServerDebugSessions): Promise<void> {
	const root = currentRoot();
	const workspaceFolder = root === undefined ? undefined : workspaceFolderOf(root);
	if (root === undefined || !workspaceFolder) {
		vscode.window.showErrorMessage('Откройте рабочую область проекта 1С.');
		return;
	}

	// Проверка до вопроса про порт отладки: иначе настройка проекта менялась бы ради запуска, которого не будет
	if (!ensureWorkspaceTrusted('отладка через автономный сервер')) {
		return;
	}

	if (debugSessions.active) {
		await vscode.commands.executeCommand('workbench.view.debug');
		return;
	}
	debugSessions.forgetResume();

	if (!projectConfiguration(root).get<boolean>('server.debug', false)) {
		const action = await vscode.window.showInformationMessage(
			'Для отладки нужен порт отладки автономного сервера. Включить его (server.debug)?',
			'Включить'
		);
		if (action !== 'Включить') {
			return;
		}
		await projectConfiguration(root).update('server.debug', true, vscode.ConfigurationTarget.Workspace);
	}

	// Перечитываем настройки после возможного включения отладки.
	const debugPort = projectConfiguration(root).get<number>('server.debugPort', 1550);

	if ((await projectPaths(root)).configuration?.dir === undefined) {
		vscode.window.showErrorMessage('Исходный код конфигурации в рабочей области не найден: отлаживать через сервер нечего.');
		return;
	}

	const ownedByRoot = (): boolean => {
		const owner = manager.ownerRoot;
		return owner !== undefined && sameProjectRoot(owner, root);
	};
	if (manager.state === 'running' && ownedByRoot()) {
		if (manager.debugPort !== debugPort) {
			await manager.restart();
		}
	} else {
		await manager.start(root);
	}
	if (manager.state !== 'running' || !ownedByRoot()) {
		return; // ошибка запуска уже показана менеджером
	}

	await debugSessions.attach(root);
}

/**
 * Меню действий сервера (открывается кликом по статус-бару).
 *
 * @param manager - Менеджер сервера
 * @param debugSessions - Сессии отладки через сервер
 */
async function showServerMenu(manager: PlatformServerManager, debugSessions: ServerDebugSessions): Promise<void> {
	interface MenuItem extends vscode.QuickPickItem {
		action: 'start' | 'stop' | 'restart' | 'browser' | 'services' | 'odata' | 'debug' | 'stopDebug' | 'logs' | 'config';
	}

	const running = manager.state === 'running';
	const busy = manager.state === 'starting';

	const items: MenuItem[] = [];
	if (running) {
		items.push(
			{ label: '$(debug-stop) Остановить сервер', action: 'stop' },
			{ label: '$(debug-restart) Перезапустить', action: 'restart' },
			{ label: '$(globe) Открыть в браузере', action: 'browser' }
		);
	} else if (!busy) {
		items.push({ label: '$(run) Запустить сервер', action: 'start' });
	}
	items.push(
		{ label: '$(checklist) Выбрать публикуемые сервисы', action: 'services' },
		{ label: '$(list-selection) Состав OData', action: 'odata' },
		debugSessions.active
			? { label: '$(debug-stop) Остановить отладку', action: 'stopDebug' }
			: { label: '$(debug-alt) Отладка через сервер', action: 'debug' },
		{ label: '', kind: vscode.QuickPickItemKind.Separator, action: 'logs' },
		{ label: '$(output) Показать журнал', action: 'logs' },
		{ label: '$(settings-gear) Открыть конфиг публикации', action: 'config' }
	);

	const owner = manager.ownerRoot;
	const picked = await vscode.window.showQuickPick(items, {
		title: `1С: Автономный сервер: ${stateLabel(manager.state)}${owner === undefined ? '' : `, проект ${projectLabel(owner)}`}`,
		ignoreFocusOut: true,
	});
	if (!picked) {
		return;
	}

	switch (picked.action) {
		case 'start':
			await startServer(manager, debugSessions);
			break;
		case 'stop':
			await stopServer(manager, debugSessions);
			break;
		case 'restart':
			await manager.restart();
			break;
		case 'browser':
			await openInBrowser(manager);
			break;
		case 'services':
			await selectPublishedServices(manager);
			break;
		case 'odata':
			await vscode.commands.executeCommand('1c-platform-tools.odata.setup');
			break;
		case 'debug':
			await startServerDebug(manager, debugSessions);
			break;
		case 'stopDebug':
			await debugSessions.stop();
			break;
		case 'logs':
			manager.showLogs();
			break;
		case 'config':
			await manager.openPublicationConfig();
			break;
	}
}

/**
 * Запускает сервер по команде пользователя: отладка, завершённая прежней остановкой, не возобновляется.
 *
 * @param manager - Менеджер сервера
 * @param debugSessions - Сессии отладки через сервер
 */
async function startServer(manager: PlatformServerManager, debugSessions: ServerDebugSessions): Promise<void> {
	debugSessions.forgetResume();
	await manager.start();
}

/**
 * Останавливает сервер по команде пользователя: отладка после следующего запуска не возобновляется.
 *
 * @param manager - Менеджер сервера
 * @param debugSessions - Сессии отладки через сервер
 */
async function stopServer(manager: PlatformServerManager, debugSessions: ServerDebugSessions): Promise<void> {
	await manager.stop();
	debugSessions.forgetResume();
}

/**
 * Текстовая метка состояния.
 */
function stateLabel(state: ServerState): string {
	switch (state) {
		case 'running': return 'запущен';
		case 'starting': return 'запускается';
		case 'error': return 'ошибка';
		default: return 'остановлен';
	}
}

/**
 * Регистрирует фичу автономного сервера: менеджер, статус-бар, команды.
 *
 * @param context - Контекст расширения
 * @returns Массив Disposable
 */
export function registerPlatformServerFeature(context: vscode.ExtensionContext): vscode.Disposable[] {
	const vrunner = VRunnerManager.getInstance(context);
	const manager = new PlatformServerManager(vrunner, context);
	const debugSessions = new ServerDebugSessions(manager);

	const statusItem = vscode.window.createStatusBarItem(
		'1c-platform-tools.server.status',
		vscode.StatusBarAlignment.Left,
		1
	);
	statusItem.name = '1С: Автономный сервер';
	statusItem.command = '1c-platform-tools.server.menu';

	const refresh = (): void => {
		if (manager.ownerRoot === undefined && !serverStatusVisible(vrunner)) {
			statusItem.hide();
			return;
		}
		applyStatus(statusItem, manager, debugSessions.active);
		statusItem.show();
	};

	refresh();

	// Пока ibsrv держит файловую базу, конфигуратор её не откроет: команды
	// загрузки, выгрузки и обновления конфигурации БД этой базы просят
	// освободить её на время работы и возвращают сервер сам.
	const holderRegistration = registerInfobaseHolder(manager.infobaseHolder());
	// Команды OData без явного url идут в публикацию запущенного сервера
	const odataRegistration = registerODataEndpointProvider({ resolve: (root) => odataEndpointOf(manager, root) });

	const disposables: vscode.Disposable[] = [
		debugSessions,
		manager,
		new vscode.Disposable(() => holderRegistration.dispose()),
		new vscode.Disposable(() => odataRegistration.dispose()),
		statusItem,
		manager.onDidChangeState(() => refresh()),
		debugSessions.onDidChange(() => refresh()),
		// Профиль и окружение задают адрес ИБ — при их смене сервер перегенерирует
		// конфиг публикации и предложит перезапуск, если работает на другой базе
		vrunner.onDidChangeActiveEnvProfile(() => void manager.onActiveProfileChanged()),
		vrunner.onDidChangeActiveEnvironment(() => void manager.onActiveProfileChanged()),
		vrunner.onDidChangeVRunnerVersion(() => void manager.onActiveProfileChanged()),
		// Сервер при смене проекта продолжает работать для своего проекта
		onDidChangeCurrentProject(() => refresh()),
		onDidChangeProjects(() => refresh()),
		vscode.window.onDidChangeActiveTextEditor(() => refresh()),
		vscode.commands.registerCommand('1c-platform-tools.server.menu', uiOnlyHandler('Меню сервера открывается пользователем; агенту доступны server.start, server.stop, server.restart.', inCurrentProject(() => showServerMenu(manager, debugSessions)))),
		vscode.commands.registerCommand('1c-platform-tools.server.start', inCurrentProject((arg?: unknown) =>
			isAgentOptions(arg) ? startForAgent(manager, debugSessions) : startServer(manager, debugSessions)
		)),
		vscode.commands.registerCommand('1c-platform-tools.server.stop', () => stopServer(manager, debugSessions)),
		vscode.commands.registerCommand('1c-platform-tools.server.restart', inCurrentProject(() => manager.restart())),
		vscode.commands.registerCommand('1c-platform-tools.server.openInBrowser', inCurrentProject(() => openInBrowser(manager))),
		vscode.commands.registerCommand('1c-platform-tools.server.selectServices', inCurrentProject(() => selectPublishedServices(manager))),
		vscode.commands.registerCommand('1c-platform-tools.server.debug', inCurrentProject(() => startServerDebug(manager, debugSessions))),
		vscode.commands.registerCommand('1c-platform-tools.server.showLogs', () => manager.showLogs()),
		vscode.commands.registerCommand('1c-platform-tools.server.openConfig', inCurrentProject(() => manager.openPublicationConfig())),
		vscode.commands.registerCommand('1c-platform-tools.server.statusBarRefresh', () => refresh()),
		vscode.workspace.onDidChangeWorkspaceFolders(() => refresh()),
	];

	return disposables;
}

/**
 * Адрес стандартного интерфейса OData запущенного сервера проекта.
 *
 * @param manager - Менеджер сервера
 * @param root - Корень проекта вызова
 * @returns Адрес либо причина, почему запрос в сервер не пойдёт
 */
function odataEndpointOf(manager: PlatformServerManager, root: string | undefined): ODataEndpoint {
	const owner = manager.ownerRoot;
	const urls = manager.getUrls();
	if (manager.state !== 'running' || owner === undefined || urls === undefined) {
		return {
			problem:
				'Автономный сервер не запущен. Запустите его (server_start) с отмеченным пунктом «OData» ' +
				'в «Выбрать публикуемые сервисы» или передайте адрес своей публикации в параметре url.',
		};
	}
	if (root !== undefined && !sameProjectRoot(owner, root)) {
		return {
			problem:
				`Автономный сервер запущен для проекта ${projectLabel(owner)}, а не для этого. ` +
				'Остановите его (server_stop) и запустите в нужном проекте либо передайте адрес публикации в параметре url.',
		};
	}
	if (!manager.publishesOData) {
		return {
			problem:
				'Автономный сервер запущен без стандартного интерфейса OData. Отметьте пункт «OData» в ' +
				'«Выбрать публикуемые сервисы» (статус-бар «1С: Сервер») и перезапустите сервер (server_restart).',
		};
	}
	return { serviceRoot: `${urls.root}${ODATA_SERVICE_PATH}` };
}

/**
 * Запуск сервера агентом: без вопроса пользователю, сервер другого проекта не останавливается.
 *
 * @param manager - Менеджер сервера
 * @param debugSessions - Сессии отладки через сервер
 * @returns Отказ, когда сервер работает для другого проекта
 */
async function startForAgent(manager: PlatformServerManager, debugSessions: ServerDebugSessions): Promise<StructuredCommandResult | void> {
	const root = currentRoot();
	const owner = manager.ownerRoot;
	if (root !== undefined && owner !== undefined && !sameProjectRoot(owner, root)) {
		const message =
			`Автономный сервер проекта ${projectLabel(owner)} запущен. ` +
			'Остановите его командой server.stop и запустите снова.';
		return { success: false, exitCode: 1, stdout: '', stderr: message };
	}
	debugSessions.forgetResume();
	await manager.start(root);
}

/**
 * Применяет состояние сервера к элементу статус-бара.
 */
function applyStatus(item: vscode.StatusBarItem, manager: PlatformServerManager, debugging: boolean): void {
	const urls = manager.getUrls();
	const owner = manager.ownerRoot;
	const running = owner !== undefined && projectsSnapshot().projects.length > 1
		? `Автономный сервер проекта ${projectLabel(owner)} запущен`
		: 'Автономный сервер запущен';
	switch (manager.state) {
		case 'running':
			// Янтарный фон (единственный «выделяющий» фон статус-бара) — явный признак,
			// что сервер запущен. Цвет текста VS Code подберёт контрастный автоматически.
			item.text = `${debugging ? '$(debug-alt)' : '$(broadcast)'} 1С: Сервер${manager.port ? ` :${manager.port}` : ''}`;
			item.tooltip = [running, urls?.root, debugging ? 'Идёт отладка через сервер' : undefined]
				.filter((line) => line !== undefined)
				.join('\n');
			item.color = undefined;
			item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
			break;
		case 'starting':
			item.text = '$(sync~spin) 1С: Сервер…';
			item.tooltip = 'Автономный сервер запускается';
			item.color = undefined;
			item.backgroundColor = undefined;
			break;
		case 'error':
			item.text = '$(error) 1С: Сервер';
			item.tooltip = 'Ошибка автономного сервера, откройте журнал';
			item.color = undefined;
			item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
			break;
		default:
			item.text = '$(server) 1С: Сервер';
			item.tooltip = 'Автономный сервер остановлен';
			item.color = undefined;
			item.backgroundColor = undefined;
	}
}
