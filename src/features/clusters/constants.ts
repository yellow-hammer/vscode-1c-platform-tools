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
