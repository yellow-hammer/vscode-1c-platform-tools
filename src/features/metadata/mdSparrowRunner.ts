/**
 * Запуск CLI md-sparrow (java -jar …).
 * @module mdSparrowRunner
 */

import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import type { MdSparrowRuntime } from './mdSparrowBootstrap';

export interface MdSparrowRunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/**
 * Выполняет подпроцесс md-sparrow с заданными аргументами командной строки (после main jar).
 */
export function runMdSparrow(
	runtime: MdSparrowRuntime,
	args: string[],
	options?: {
		cwd?: string;
		token?: vscode.CancellationToken;
	}
): Promise<MdSparrowRunResult> {
	const { java, jarPath } = runtime;
	const fullArgs = [
		'-Dfile.encoding=UTF-8',
		'-Dstdout.encoding=UTF-8',
		'-Dstderr.encoding=UTF-8',
		'-Dsun.stdout.encoding=UTF-8',
		'-Dsun.stderr.encoding=UTF-8',
		'-jar',
		jarPath,
		...args,
	];
	const cmdLine = `${java} ${fullArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`;
	logger.debug(`md-sparrow: ${cmdLine}${options?.cwd ? ` (cwd=${options.cwd})` : ''}`);

	return new Promise((resolve, reject) => {
		const child = spawn(java, fullArgs, {
			cwd: options?.cwd,
			windowsHide: true,
		});
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString('utf8');
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf8');
		});
		const sub = options?.token?.onCancellationRequested(() => {
			try {
				child.kill();
			} catch {
				/* */
			}
		});
		child.on('error', (err) => {
			sub?.dispose();
			reject(err);
		});
		child.on('close', (code) => {
			sub?.dispose();
			resolve({ exitCode: code ?? -1, stdout, stderr });
		});
	});
}
