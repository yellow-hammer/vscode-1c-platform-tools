import * as vscode from 'vscode';
import { spawn, exec } from 'node:child_process';
import { logger } from './logger';

const log = logger.scope('process');

/**
 * Результат выполнения отменяемого процесса
 */
export interface CancellableProcessResult {
	/** Успешность выполнения (exitCode === 0 и не было отмены) */
	success: boolean;
	/** Накопленный стандартный вывод */
	stdout: string;
	/** Накопленный поток ошибок */
	stderr: string;
	/** Код возврата процесса (при отмене или ошибке запуска — -1) */
	exitCode: number;
	/** Признак, что выполнение было прервано по CancellationToken */
	cancelled: boolean;
}

/**
 * Опции выполнения отменяемого процесса
 */
export interface CancellableProcessOptions {
	/** Рабочая директория */
	cwd?: string;
	/** Дополнительные переменные окружения (поверх process.env) */
	env?: NodeJS.ProcessEnv;
	/** Токен отмены: при срабатывании дерево процессов завершается принудительно */
	token?: vscode.CancellationToken;
	/** Колбэк живого вывода: вызывается на каждый чанк stdout и stderr */
	onOutput?: (chunk: string) => void;
}

/**
 * Принудительно завершает процесс вместе с дочерними.
 *
 * На Windows обязателен taskkill /t: команды вроде vrunner.bat порождают
 * дерево процессов (cmd → oscript → 1cv8), и child.kill() убил бы только cmd.
 * На POSIX процесс запускается в собственной группе (detached), поэтому
 * сигнал отправляется всей группе через отрицательный pid.
 *
 * @param pid - Идентификатор корневого процесса
 */
function killProcessTree(pid: number): void {
	if (process.platform === 'win32') {
		exec(`taskkill /pid ${pid} /t /f`, (error) => {
			if (error) {
				log.warn(`taskkill для pid ${pid} завершился с ошибкой: ${error.message}`);
			}
		});
	} else {
		try {
			process.kill(-pid, 'SIGTERM');
		} catch (error) {
			log.warn(`Не удалось завершить группу процессов ${pid}: ${(error as Error).message}`);
		}
	}
}

/**
 * Выполняет команду оболочки как отменяемый процесс с живым выводом.
 *
 * В отличие от child_process.exec, позволяет:
 * - прервать выполнение по CancellationToken (с завершением всего дерева процессов);
 * - получать stdout/stderr по мере поступления (для TestRun.appendOutput).
 *
 * Промис никогда не отклоняется: ошибки запуска возвращаются как
 * { success: false, exitCode: -1, stderr: <сообщение> }.
 *
 * @param command - Полная строка команды (выполняется через оболочку)
 * @param options - Опции выполнения
 * @returns Промис с результатом выполнения
 */
export function runCancellableCommand(
	command: string,
	options?: CancellableProcessOptions
): Promise<CancellableProcessResult> {
	return new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		let cancelled = false;
		let settled = false;

		const child = spawn(command, {
			cwd: options?.cwd,
			env: options?.env ? { ...process.env, ...options.env } : process.env,
			shell: true,
			windowsHide: true,
			// На POSIX — собственная группа процессов, чтобы убивать всё дерево
			detached: process.platform !== 'win32'
		});

		const finish = (exitCode: number) => {
			if (settled) {
				return;
			}
			settled = true;
			cancellationSubscription?.dispose();
			resolve({
				success: exitCode === 0 && !cancelled,
				stdout,
				stderr,
				exitCode,
				cancelled
			});
		};

		const cancellationSubscription = options?.token?.onCancellationRequested(() => {
			cancelled = true;
			if (child.pid !== undefined) {
				log.info(`Отмена: завершаю дерево процессов pid ${child.pid}`);
				killProcessTree(child.pid);
			}
		});

		// Токен мог сработать до запуска
		if (options?.token?.isCancellationRequested) {
			cancelled = true;
			if (child.pid !== undefined) {
				killProcessTree(child.pid);
			}
		}

		child.stdout?.setEncoding('utf8');
		child.stderr?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => {
			stdout += chunk;
			options?.onOutput?.(chunk);
		});
		child.stderr?.on('data', (chunk: string) => {
			stderr += chunk;
			options?.onOutput?.(chunk);
		});

		child.on('error', (error) => {
			stderr += error.message;
			finish(-1);
		});

		child.on('close', (code) => {
			finish(code ?? -1);
		});
	});
}
