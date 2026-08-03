/**
 * Сигнал о завершении команды: звук и строка состояния.
 *
 * Долгие команды платформы (загрузка конфигурации, прогон тестов) идут задачей VS Code, и о
 * завершении узнать неоткуда, пока не заглянешь в панель задач. Здесь одно место, которое
 * сообщает об исходе, и одно правило для автоматизации: у цепочки шагов сигнал один, в конце.
 * @module taskFinishSignal
 */

import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { notifyQuiet, notifyQuietFailure } from '../../shared/notify';

const log = logger.scope('task-signal');

/** Когда подавать сигнал о завершении команды. */
export type FinishNotifyMode = 'always' | 'onError' | 'never';

/** Исход завершившейся команды. */
export interface TaskFinishOutcome {
	/** Имя задачи, как в панели задач. */
	name: string;
	/** Код возврата: 0 - успех. */
	exitCode: number;
	durationMs: number;
}

/** Сообщать ли об исходе при выбранном режиме. */
export function shouldNotify(mode: FinishNotifyMode, exitCode: number): boolean {
	if (mode === 'never') {
		return false;
	}
	return mode === 'always' || exitCode !== 0;
}

/** Длительность словами: секунды до минуты, дальше минуты и секунды. */
export function formatDuration(durationMs: number): string {
	const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
	if (totalSeconds < 60) {
		return `${totalSeconds} с`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return seconds === 0 ? `${minutes} мин` : `${minutes} мин ${seconds} с`;
}

/** Текст сигнала об одной команде. */
export function finishMessage(outcome: TaskFinishOutcome): string {
	const duration = formatDuration(outcome.durationMs);
	return outcome.exitCode === 0
		? `${outcome.name}: готово за ${duration}`
		: `${outcome.name}: ошибка, код ${outcome.exitCode} (${duration})`;
}

/** Текст сигнала о группе команд: цепочка сообщает о себе один раз. */
export function groupFinishMessage(label: string, outcomes: readonly TaskFinishOutcome[], durationMs: number): string {
	const failed = outcomes.filter((item) => item.exitCode !== 0).length;
	const steps = `шагов ${outcomes.length}`;
	const duration = formatDuration(durationMs);
	return failed === 0
		? `${label}: готово за ${duration}, ${steps}`
		: `${label}: ошибок ${failed} из ${outcomes.length} (${duration})`;
}

/** Идёт автоматизация: пока идёт, отдельные команды молчат. */
let grouped = false;

/** Наблюдатели за исходами команд. */
const listeners = new Set<(outcome: TaskFinishOutcome) => void>();

/**
 * Подписывает наблюдателя на исходы завершившихся команд: так автоматизация собирает исходы
 * своих шагов, чтобы сообщить о цепочке один раз.
 *
 * @param listener Получает исход каждой завершившейся задачи, в том числе внутри автоматизации.
 * @returns Функция отписки.
 */
export function onTaskFinished(listener: (outcome: TaskFinishOutcome) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * Выполняет автоматизацию, придержав сигналы её шагов: сообщение будет одно, в конце.
 * Вложенные группы не заводятся - считает верхняя.
 *
 * @param label Имя автоматизации для сигнала, например название пайплайна.
 * @param run Что выполнить.
 * @param succeeded Успешна ли автоматизация в целом; по умолчанию смотрим на исходы шагов.
 */
export async function withGroupedFinishSignals<T>(
	label: string,
	run: () => Promise<T>,
	succeeded?: (result: T) => boolean
): Promise<T> {
	if (grouped) {
		return run();
	}
	const outcomes: TaskFinishOutcome[] = [];
	const unsubscribe = onTaskFinished((outcome) => outcomes.push(outcome));
	const startedAt = Date.now();
	grouped = true;
	let failed: boolean | undefined;
	try {
		const result = await run();
		failed = succeeded ? !succeeded(result) : undefined;
		return result;
	} catch (e) {
		failed = true;
		throw e;
	} finally {
		unsubscribe();
		grouped = false;
		signalGroupFinished(label, outcomes, Date.now() - startedAt, failed);
	}
}

/**
 * Сообщает о завершении команды. Внутри автоматизации исход только копится: сигнал даст группа.
 */
export function signalTaskFinished(outcome: TaskFinishOutcome): void {
	for (const listener of listeners) {
		listener(outcome);
	}
	if (grouped) {
		return;
	}
	const mode = notifyMode();
	if (!shouldNotify(mode, outcome.exitCode)) {
		return;
	}
	notify(finishMessage(outcome), outcome.exitCode === 0);
}

function signalGroupFinished(
	label: string,
	outcomes: readonly TaskFinishOutcome[],
	durationMs: number,
	failed?: boolean
): void {
	const withError = failed ?? outcomes.some((item) => item.exitCode !== 0);
	if (!shouldNotify(notifyMode(), withError ? 1 : 0)) {
		return;
	}
	notify(groupFinishMessage(label, outcomes, durationMs), !withError);
}

function notifyMode(): FinishNotifyMode {
	const value = vscode.workspace
		.getConfiguration('1c-platform-tools')
		.get<string>('notifications.onCommandFinish', 'always');
	return value === 'never' || value === 'onError' ? value : 'always';
}

function soundEnabled(): boolean {
	return vscode.workspace.getConfiguration('1c-platform-tools').get<boolean>('notifications.sound', true);
}

/** Исход виден звуком и строкой состояния: всплывающее окно поверх работы только мешает. */
function notify(message: string, success: boolean): void {
	if (soundEnabled()) {
		playSound(success);
	}
	if (success) {
		notifyQuiet(message);
	} else {
		notifyQuietFailure(message);
	}
}

/** Команда системного звука для платформы: успех и ошибка звучат по-разному. */
export function soundCommand(platform: NodeJS.Platform, success: boolean): { file: string; args: string[] } | undefined {
	if (platform === 'win32') {
		// Звук берём из звуковой схемы Windows: системный бип идёт мимо звуковой карты и часто не слышен.
		// Play() не ждёт окончания, поэтому держим процесс живым, пока звук не доиграет.
		const sound = success ? 'Asterisk' : 'Hand';
		const script = `[System.Media.SystemSounds]::${sound}.Play(); Start-Sleep -Milliseconds 800`;
		return { file: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
	}
	if (platform === 'darwin') {
		const sound = success ? 'Glass' : 'Basso';
		return { file: 'afplay', args: [`/System/Library/Sounds/${sound}.aiff`] };
	}
	if (platform === 'linux') {
		const sound = success ? 'complete' : 'dialog-error';
		return { file: 'paplay', args: [`/usr/share/sounds/freedesktop/stereo/${sound}.oga`] };
	}
	return undefined;
}

function playSound(success: boolean): void {
	const command = soundCommand(process.platform, success);
	if (!command) {
		return;
	}
	// windowsHide: иначе на Windows мигает окно консоли; timeout: проигрыватель не должен зависать.
	execFile(command.file, command.args, { windowsHide: true, timeout: 5000 }, (error) => {
		if (error) {
			// Звук - дело десятое: на машине может не быть проигрывателя или звуковой карты.
			log.debug(`звук завершения не проигран: ${error.message}`);
		}
	});
}
