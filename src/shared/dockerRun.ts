/**
 * Остановка контейнера, запущенного командой расширения.
 *
 * Клиент `docker run` живёт на хосте, а контейнер в демоне: завершение дерева
 * процессов его не снимает.
 *
 * @module dockerRun
 */

import { execFile } from 'node:child_process';
import type { CommandRun } from './cancellableProcess';
import { logger } from './logger';

const log = logger.scope('vrunner');

/** Сколько секунд контейнер закрывается после SIGTERM, прежде чем демон пошлёт SIGKILL. */
export const DOCKER_STOP_TIMEOUT_SECONDS = 30;

/** Метка контейнеров, в которых открыт клиент 1С с окном. */
export const WINDOW_CONTAINER_LABEL = '1c-platform-tools.window';

/**
 * Вызов программы `docker`. Промис не отклоняется: остановка и уборка
 * контейнера, которого уже нет, ошибкой не считаются.
 */
export type DockerCli = (args: readonly string[], timeoutMs: number) => Promise<void>;

const dockerCli: DockerCli = (args, timeoutMs) =>
	new Promise((resolve) => {
		execFile('docker', args, { timeout: timeoutMs, windowsHide: true }, (error) => {
			if (error) {
				log.debug(`docker ${args.join(' ')}: ${error.message}`);
			}
			resolve();
		});
	});

/**
 * Имя контейнера для одного запуска.
 *
 * @returns Уникальное имя вида `1cpt-run-<метка>`
 */
export function dockerContainerName(): string {
	return `1cpt-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Запуск в контейнере с новым именем: отмена останавливает контейнер по нему,
 * а после выхода клиента убирает его.
 *
 * Имя берётся на каждый вызов: демон отказывает запуску с именем контейнера,
 * который ещё останавливается после прошлой отмены.
 *
 * @param build - Строит команду `docker run` с заданным именем контейнера
 * @param docker - Вызов программы `docker`
 * @returns Команда и уборка при отмене
 */
export function dockerCommandRun(build: (containerName: string) => string, docker: DockerCli = dockerCli): CommandRun {
	const containerName = dockerContainerName();
	let stopped: Promise<void> = Promise.resolve();
	return {
		command: build(containerName),
		onCancel: () => {
			stopped = stopDockerContainer(containerName, docker);
			return stopped;
		},
		onCancelled: () => {
			void stopped.then(() => removeDockerContainer(containerName, docker));
		},
	};
}

/**
 * Останавливает контейнер запуска: процессы получают SIGTERM и время закрыться.
 *
 * @param containerName - Имя контейнера из {@link dockerContainerName}
 * @param docker - Вызов программы `docker`
 * @returns Промис, который разрешается, когда контейнер остановлен
 */
export function stopDockerContainer(containerName: string, docker: DockerCli = dockerCli): Promise<void> {
	log.info(`Отмена: останавливаю контейнер ${containerName}`);
	return docker(['stop', '-t', String(DOCKER_STOP_TIMEOUT_SECONDS), containerName], (DOCKER_STOP_TIMEOUT_SECONDS + 30) * 1000);
}

/**
 * Убирает контейнер, который клиент `docker run --rm` оставил после отмены:
 * созданный, но ещё не запущенный, `--rm` не удаляет, а запущенный за миг
 * до завершения клиента продолжает работать.
 *
 * @param containerName - Имя контейнера из {@link dockerContainerName}
 * @param docker - Вызов программы `docker`
 * @returns Промис, который разрешается после вызова
 */
export function removeDockerContainer(containerName: string, docker: DockerCli = dockerCli): Promise<void> {
	return docker(['rm', '-f', containerName], 30000);
}

/** Вызов программы `docker` с выводом. Промис не отклоняется: ошибка приходит в `error`. */
export type DockerExec = (args: readonly string[], timeoutMs: number) => Promise<{ stdout: string; error?: string }>;

const dockerExec: DockerExec = (args, timeoutMs) =>
	new Promise((resolve) => {
		execFile('docker', args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
			resolve(error ? { stdout, error: (stderr || error.message).trim() } : { stdout });
		});
	});

/**
 * Запускает отсоединённый контейнер клиента 1С с окном и следит за ним. Перед запуском
 * убирает остановленные контейнеры прошлых окон; после выхода контейнер убирается,
 * а при коде выхода не 0 его вывод попадает в журнал.
 *
 * @param runArgs - Аргументы `docker run -d` (см. `dockerRunArgs` с `detached`)
 * @param containerName - Имя контейнера из этих аргументов
 * @param docker - Вызов программы `docker`
 * @returns Код выхода после остановки контейнера либо причина, по которой он не запустился
 */
export async function startWindowContainer(
	runArgs: readonly string[],
	containerName: string,
	docker: DockerExec = dockerExec
): Promise<{ exited: Promise<number | undefined> } | { error: string }> {
	await docker(['container', 'prune', '-f', '--filter', `label=${WINDOW_CONTAINER_LABEL}`], 60000);
	// Без образа на машине docker сначала его скачивает
	const started = await docker(runArgs, 60 * 60 * 1000);
	if (started.error !== undefined) {
		return { error: started.error };
	}
	log.info(`Клиент 1С с окном запущен в контейнере ${containerName}`);
	const exited = (async () => {
		const waited = await docker(['wait', containerName], 0);
		const code = waited.error === undefined ? Number.parseInt(waited.stdout.trim(), 10) : Number.NaN;
		if (code !== 0) {
			const output = await docker(['logs', '--tail', '50', containerName], 30000);
			log.warn(`Контейнер ${containerName} завершился с кодом ${Number.isNaN(code) ? '?' : code}: ${output.stdout.trim()}`);
		}
		await docker(['rm', '-f', containerName], 30000);
		return Number.isNaN(code) ? undefined : code;
	})();
	return { exited };
}

/**
 * Вывод контейнера клиента 1С с окном для задачи: остановка задачи закрывает клиент.
 *
 * @param containerName - Имя контейнера
 * @param docker - Вызов программы `docker`
 * @returns Запуск для задачи
 */
export function windowContainerLogsRun(containerName: string, docker: DockerCli = dockerCli): CommandRun {
	return {
		command: { file: 'docker', args: ['logs', '-f', containerName] },
		onCancel: () => stopDockerContainer(containerName, docker),
	};
}
