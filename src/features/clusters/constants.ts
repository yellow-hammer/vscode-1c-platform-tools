/**
 * Идентификаторы и умолчания консоли администрирования кластера 1С.
 */

/** Представление с деревом подключений. */
export const CLUSTERS_VIEW_ID = '1c-platform-tools-admin-clusters';

/** Представление «Помощь и поддержка» в контейнере «1С: Администрирование». */
export const CLUSTERS_HELP_VIEW_ID = '1c-platform-tools-admin-help';

/** Префикс команд консоли кластера. */
export const CLUSTERS_COMMAND_PREFIX = '1c-platform-tools.clusters.';

/** Порт сервера администрирования (RAS) по умолчанию. */
export const DEFAULT_RAS_PORT = 1545;

/** Ключ контекста: включено ли автообновление дерева. */
export const AUTO_REFRESH_CONTEXT_KEY = '1c-platform-tools.clusters.autoRefresh';

/** Таймаут одного вызова rac по умолчанию, мс. */
export const DEFAULT_RAC_TIMEOUT_MS = 30_000;

/** Пустой идентификатор: rac так помечает отсутствующую ссылку. */
export const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';

/** Ключ глобального состояния со списком подключений. */
export const CONNECTIONS_STATE_KEY = '1c-platform-tools.clusters.connections';

/** Ключ списка наборов учётных данных. */
export const CREDENTIAL_SETS_STATE_KEY = '1c-platform-tools.clusters.credentialSets';

/** Ключ привязок наборов к базам. */
export const INFOBASE_BINDINGS_STATE_KEY = '1c-platform-tools.clusters.infobaseBindings';

/** Ключ привязок наборов к подключениям. */
export const CONNECTION_BINDINGS_STATE_KEY = '1c-platform-tools.clusters.connectionBindings';

/** Ключ привязок наборов к кластерам. */
export const CLUSTER_BINDINGS_STATE_KEY = '1c-platform-tools.clusters.clusterAdminBindings';

/**
 * Ключи состояния, которые едут между машинами синхронизацией параметров.
 *
 * VS Code принимает список целиком, и каждый вызов заменяет прежний, поэтому
 * список один на всю консоль: подключения и наборы регистрируют его вместе.
 */
export const SYNCED_STATE_KEYS: readonly string[] = [
	CONNECTIONS_STATE_KEY,
	CREDENTIAL_SETS_STATE_KEY,
	INFOBASE_BINDINGS_STATE_KEY,
	CONNECTION_BINDINGS_STATE_KEY,
	CLUSTER_BINDINGS_STATE_KEY,
];
