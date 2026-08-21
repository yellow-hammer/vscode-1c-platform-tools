/**
 * Остановка контейнера, запущенного командой расширения.
 *
 * Отмена задачи завершает дерево процессов хоста, но клиент `docker run` это не
 * контейнер: он живёт в демоне и продолжает работать. Поэтому запуск получает
 * имя, а отмена останавливает контейнер по нему.
 *
 * @module dockerRun
 */

import { exec } from 'node:child_process';
import { logger } from './logger';

const log = logger.scope('vrunner');

/**
 * Имя контейнера для одного запуска.
 *
 * @returns Уникальное имя вида `1cpt-run-<метка>`
 */
export function dockerContainerName(): string {
	return `1cpt-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Останавливает контейнер запуска. Удаление делает сам `docker run --rm`.
 *
 * @param containerName - Имя контейнера из {@link dockerContainerName}
 */
export function stopDockerContainer(containerName: string): void {
	log.info(`Отмена: останавливаю контейнер ${containerName}`);
	exec(`docker stop ${containerName}`, { timeout: 30000 }, (error) => {
		if (error) {
			// Контейнер мог остановиться сам вместе с клиентом: это не ошибка
			log.debug(`docker stop ${containerName}: ${error.message}`);
		}
	});
}
