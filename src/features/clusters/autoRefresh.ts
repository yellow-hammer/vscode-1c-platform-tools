/**
 * Автообновление дерева кластеров.
 *
 * Состояние кластера меняется само: сеансы приходят и уходят, процессы
 * перезапускаются. Автообновление снимает необходимость нажимать «Обновить», но
 * каждый тик — это обращения к серверу администрирования, поэтому обновление
 * идёт только когда панель видна и по умолчанию выключено.
 */

import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { AUTO_REFRESH_CONTEXT_KEY } from './constants';
import { readClustersSettings } from './settings';

const log = logger.scope('clusters');

/** Таймер периодического обновления дерева. */
export class ClustersAutoRefresh {
	private timer: NodeJS.Timeout | undefined;

	/**
	 * @param refresh - Обновление дерева
	 * @param isViewVisible - Видна ли панель кластеров
	 * @param onStateChanged - Сообщает панели, включено ли автообновление
	 */
	constructor(
		private readonly refresh: () => void,
		private readonly isViewVisible: () => boolean,
		private readonly onStateChanged: (enabled: boolean) => void
	) {}

	/** Применяет текущие настройки: запускает или останавливает таймер. */
	apply(): void {
		const settings = readClustersSettings();
		this.stop();
		this.onStateChanged(settings.autoRefreshEnabled);
		// Состояние видно в заголовке панели: по контексту выбирается, какая из двух
		// кнопок показана — включить или выключить.
		void vscode.commands.executeCommand(
			'setContext',
			AUTO_REFRESH_CONTEXT_KEY,
			settings.autoRefreshEnabled
		);
		if (!settings.autoRefreshEnabled) {
			return;
		}
		log.info(`автообновление кластеров: каждые ${settings.autoRefreshIntervalMs / 1000} с`);
		this.timer = setInterval(() => {
			// Скрытая панель обновления не требует: пользователь его не увидит,
			// а вызовы rac уйдут на сервер.
			if (this.isViewVisible()) {
				this.refresh();
			}
		}, settings.autoRefreshIntervalMs);
	}

	/**
	 * Включает или выключает автообновление в настройках пользователя.
	 *
	 * Изменение настройки поднимет событие конфигурации, а обработчик вызовет
	 * {@link apply} — таймер и контекст здесь трогать не нужно.
	 *
	 * @param enabled - Включить автообновление
	 */
	async set(enabled: boolean): Promise<void> {
		const config = vscode.workspace.getConfiguration('1c-platform-tools.clusters');
		await config.update('autoRefresh.enabled', enabled, vscode.ConfigurationTarget.Global);
	}

	/** Останавливает таймер. */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	dispose(): void {
		this.stop();
		void vscode.commands.executeCommand('setContext', AUTO_REFRESH_CONTEXT_KEY, false);
	}
}
