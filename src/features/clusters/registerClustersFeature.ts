/**
 * Подключение консоли администрирования кластера к расширению.
 *
 * Представление «Кластеры» в панели «Администрирование 1С» активно всегда:
 * администрированием кластера занимаются и без исходников под рукой — так же,
 * как панелью «Проекты 1С».
 */

import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { ClustersAutoRefresh } from './autoRefresh';
import { registerClustersCommands } from './clustersCommands';
import { ClusterActivityPanel } from './activityPanel';
import { PropertiesPanel } from './propertiesPanel';
import { ClustersProvider } from './clustersProvider';
import { ClusterConnectionsEditor } from './connectionsEditor';
import { ClusterService } from './clusterService';
import { CLUSTERS_HELP_VIEW_ID, CLUSTERS_VIEW_ID } from './constants';
import { ConnectionStore, type SyncedMemento } from './connectionStore';
import { ClusterCredentialStore } from './credentials';
import { promptInfobaseCredentials } from './prompts';
import { HelpAndSupportProvider } from '../projects/helpAndSupportProvider';
import { initClusterIcons } from './nodes';
import { RacClient } from './racClient';
import { affectsClustersSettings } from './settings';

const log = logger.scope('clusters');

/**
 * Регистрирует представление «Кластеры» и его команды.
 *
 * @param context - Контекст расширения
 * @returns Подписки фичи
 */
export function registerClustersFeature(context: vscode.ExtensionContext): vscode.Disposable[] {
	initClusterIcons(context.extensionUri);
	const store = new ConnectionStore(context.globalState as SyncedMemento);

	const client = new RacClient();
	const credentials = new ClusterCredentialStore(context.secrets);
	const service = new ClusterService(client, credentials, promptInfobaseCredentials);
	const provider = new ClustersProvider(store, service);

	const treeView = vscode.window.createTreeView(CLUSTERS_VIEW_ID, {
		treeDataProvider: provider,
		showCollapseAll: true,
	});

	// Помощь и поддержка есть у остальных контейнеров расширения: список команд
	// один и тот же, поэтому берётся общий провайдер.
	const helpTreeView = vscode.window.createTreeView(CLUSTERS_HELP_VIEW_ID, {
		treeDataProvider: new HelpAndSupportProvider(),
		showCollapseAll: false,
	});



	const editor = new ClusterConnectionsEditor(store, credentials, service, provider);
	const activity = new ClusterActivityPanel(service, provider);
	// Одна вкладка на все объекты дерева: карточка администратора отдельна,
	// потому что открывается и для создания, когда объекта ещё нет.
	const objectProperties = new PropertiesPanel('1cClusterObjectProperties');
	const adminProperties = new PropertiesPanel('1cClusterAdminProperties');

	const autoRefresh = new ClustersAutoRefresh(
		() => provider.refresh(),
		() => treeView.visible,
		// Автообновление меняет поведение панели, поэтому его состояние видно в
		// её заголовке: иначе периодические обращения к серверу выглядят
		// необъяснимыми.
		(enabled) => {
			treeView.description = enabled ? 'автообновление' : undefined;
		}
	);
	autoRefresh.apply();

	const configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
		if (!affectsClustersSettings(event)) {
			return;
		}
		autoRefresh.apply();
		// Каталог платформы влияет на каждый вызов, поэтому ветки перечитываются:
		// иначе в дереве осталась бы картина от прежних настроек.
		provider.refresh();
	});

	const commands = registerClustersCommands({
		store,
		provider,
		service,
		credentials,
		editor,
		activity,
		objectProperties,
		adminProperties,
		autoRefresh,
	});

	log.info(`панель кластеров готова, подключений: ${store.list().length}`);

	return [
		treeView,
		helpTreeView,
		editor,
		activity,
		objectProperties,
		adminProperties,
		configWatcher,
		autoRefresh,
		provider,
		...commands,
	];
}
