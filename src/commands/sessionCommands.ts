import * as vscode from 'vscode';
import { BaseCommand } from './baseCommand';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';
import { VRUNNER_FEATURES, isAtLeast } from '../shared/vrunnerVersion';
import {
	getLockSessionsCommandName,
	getUnlockSessionsCommandName,
	getKillSessionsCommandName,
	getCheckSessionsClosedCommandName,
	getLockScheduledJobsCommandName,
	getUnlockScheduledJobsCommandName,
} from '../features/tools/commandNames';

/**
 * Команды управления сеансами и регламентными заданиями информационной базы.
 *
 * Работают через утилиты кластера rac и ras. Подключение к кластеру (адрес RAS,
 * имя базы, администратор и его пароль, код разрешения запуска) расширение не
 * подставляет: vanessa-runner читает эти параметры из файла настроек проекта,
 * а аргумент командной строки перекрыл бы профиль - у него приоритет выше.
 * Утилиту rac vanessa-runner тоже находит сам по версии платформы.
 *
 * В команду уходят только параметры разового вызова, заданные явно: сообщение
 * блокировки, код допуска, время блокировки, отбор сеансов.
 */
export class SessionCommands extends BaseCommand {
	/**
	 * Сообщает, что действие недоступно: агенту структурой, пользователю окном.
	 *
	 * @param message - Причина
	 * @param opts - Опции выполнения
	 * @returns Результат для синхронного вызова
	 */
	private reportUnavailable(
		message: string,
		opts?: CommandExecutionOptions
	): StructuredCommandResult | void {
		if (opts?.wait === true) {
			return this.executionError(message);
		}
		void vscode.window.showErrorMessage(message);
		return undefined;
	}

	/**
	 * Запрещает начало сеансов.
	 *
	 * @param opts - Опции выполнения: lockMessage, accessCode, lockStart, lockEnd
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async lock(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const commandName = getLockSessionsCommandName();
		return this.runIntent(
			{
				kind: 'session.lock',
				deniedMessage: opts?.lockMessage,
				accessCode: opts?.accessCode,
				lockStart: opts?.lockStart,
				lockEnd: opts?.lockEnd,
			},
			opts, commandName.title, undefined, commandName.id
		);
	}

	/**
	 * Снимает запрет начала сеансов.
	 *
	 * @param opts - Опции выполнения: accessCode
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async unlock(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const commandName = getUnlockSessionsCommandName();
		return this.runIntent(
			{ kind: 'session.unlock', accessCode: opts?.accessCode },
			opts, commandName.title, undefined, commandName.id
		);
	}

	/**
	 * Завершает сеансы информационной базы.
	 *
	 * @param opts - Опции выполнения: sessionFilter, sessionFilterMode, keepSessionsUnlocked
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async kill(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const commandName = getKillSessionsCommandName();
		return this.runIntent(
			{
				kind: 'session.kill',
				filter: opts?.sessionFilter,
				filterMode: opts?.sessionFilterMode,
				withoutLock: opts?.keepSessionsUnlocked,
			},
			opts, commandName.title, undefined, commandName.id
		);
	}

	/**
	 * Проверяет, что сеансов нет: при найденных сеансах vanessa-runner
	 * завершается с ошибкой, поэтому команда годится как шаг перед обновлением.
	 *
	 * Действие есть только в vanessa-runner 2.x.
	 *
	 * @param opts - Опции выполнения: sessionFilter, sessionFilterMode
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async checkClosed(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const version = await this.vrunner.getVRunnerVersion();
		if (version !== undefined && isAtLeast(version, VRUNNER_FEATURES.cli3)) {
			return this.reportUnavailable(
				'Проверка отсутствия сеансов есть только в vanessa-runner 2.x: ' +
				'в 3.x действие session closed не реализовано.',
				opts
			);
		}

		const commandName = getCheckSessionsClosedCommandName();
		return this.runIntent(
			{
				kind: 'session.closed',
				filter: opts?.sessionFilter,
				filterMode: opts?.sessionFilterMode,
			},
			opts, commandName.title, undefined, commandName.id
		);
	}

	/**
	 * Запрещает выполнение регламентных заданий.
	 *
	 * Отдельное от сеансов состояние базы: запрет входа не останавливает уже
	 * запланированные задания, поэтому перед обновлением их гасят отдельно.
	 *
	 * @param opts - Опции выполнения
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async lockScheduledJobs(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const commandName = getLockScheduledJobsCommandName();
		return this.runIntent(
			{ kind: 'jobs.lock' },
			opts, commandName.title, undefined, commandName.id
		);
	}

	/**
	 * Разрешает выполнение регламентных заданий.
	 *
	 * @param opts - Опции выполнения
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async unlockScheduledJobs(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const commandName = getUnlockScheduledJobsCommandName();
		return this.runIntent(
			{ kind: 'jobs.unlock' },
			opts, commandName.title, undefined, commandName.id
		);
	}
}
