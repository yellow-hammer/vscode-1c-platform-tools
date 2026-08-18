/**
 * Настройки консоли администрирования кластера.
 *
 * Чтение настроек собрано в одном месте: значения нужны и дереву, и клиенту rac,
 * и автообновлению, а разъехавшиеся умолчания в трёх модулях — источник
 * необъяснимого поведения.
 */

import * as vscode from 'vscode';

/** Разобранные настройки консоли кластера. */
export interface ClustersSettings {
	/** Каталог установки платформы 1С; пусто — автоопределение. */
	platformPath: string;
	/** Таймаут одного вызова rac, мс. */
	timeoutMs: number;
	/** Автообновление дерева включено. */
	autoRefreshEnabled: boolean;
	/** Интервал автообновления, мс. */
	autoRefreshIntervalMs: number;
	/** Спрашивать подтверждение перед завершением сеансов и разрывом соединений. */
	confirmDestructiveActions: boolean;
}

/**
 * Читает настройки консоли кластера.
 *
 * @returns Значения настроек с применёнными умолчаниями
 */
export function readClustersSettings(): ClustersSettings {
	const config = vscode.workspace.getConfiguration('1c-platform-tools.clusters');
	return {
		platformPath: config.get<string>('platformPath', ''),
		timeoutMs: Math.max(1, config.get<number>('timeoutSeconds', 30)) * 1000,
		autoRefreshEnabled: config.get<boolean>('autoRefresh.enabled', false),
		autoRefreshIntervalMs: Math.max(5, config.get<number>('autoRefresh.intervalSeconds', 30)) * 1000,
		confirmDestructiveActions: config.get<boolean>('confirmDestructiveActions', true),
	};
}

/**
 * Сообщает, относится ли изменение настроек к консоли кластера.
 *
 * @param event - Событие изменения настроек
 * @returns true, если менялся раздел кластеров
 */
export function affectsClustersSettings(event: vscode.ConfigurationChangeEvent): boolean {
	return event.affectsConfiguration('1c-platform-tools.clusters');
}
