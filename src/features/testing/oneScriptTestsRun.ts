/**
 * Прогон тестов OneScript проекта: человеку задачей VS Code, агенту процессом без окон.
 *
 * Раннер, каталог тестов и каталог отчётов те же, что у панели тестирования,
 * движок — движок проекта. OneUnit ищет наборы и во вложенных каталогах (`-r`),
 * как в CI пакетов autumn-library; 1testrunner прогоняет каталог (`-runall`),
 * вложенные каталоги он не обходит. jUnit-отчёт подхватывает «Отчёт Allure».
 * @module oneScriptTestsRun
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { runCancellableCommand } from '../../shared/cancellableProcess';
import type { CommandExecutionOptions, StructuredCommandResult } from '../../shared/commandExecutionTypes';
import { logger } from '../../shared/logger';
import { notifyQuiet, notifyQuietFailure } from '../../shared/notify';
import { oneScriptTestsPath } from '../../shared/oneScriptLayout';
import { BUILD_SUBDIRS } from '../../shared/pathDefaults';
import type { VRunnerManager } from '../../shared/vrunnerManager';
import { projectRootKey } from '../../shared/workspaceProjects';
import { buildProcessCommand } from '../../utils/commandUtils';
import { createVRunnerTask } from '../tasks/vrunnerTask';
import { getOneScriptTestsCommandName } from '../tools/commandNames';
import { oneScriptRunnerProgram, type OneScriptRunner } from './adapters/onescriptAdapter';
import { formatRunSummary, readRunSummary } from './runReportSummary';

const log = logger.scope('testing');

/**
 * Идущие прогоны по ключу корня проекта. У прогона агента здесь его отмена: он
 * идёт без задачи VS Code, и остановить его иначе нечем.
 */
const runs = new Map<string, vscode.CancellationTokenSource | undefined>();

/**
 * Идут ли уже тесты OneScript проекта, прогоном из расширения или задачей,
 * запущенной заново: два прогона одного проекта пишут один отчёт.
 *
 * @param key - Ключ корня проекта
 * @param title - Имя задачи прогона
 */
function testsRunning(key: string, title: string): boolean {
	return runs.has(key) || vscode.tasks.taskExecutions.some(({ task }) =>
		task.name === title && typeof task.definition.project === 'string' && projectRootKey(task.definition.project) === key
	);
}

/**
 * Отказ второму прогону: агенту ответ, человеку сообщение, а прогон агента он
 * может остановить.
 *
 * @param key - Ключ корня проекта
 * @param opts - Опции вызова
 */
function refuseSecondRun(key: string, opts?: CommandExecutionOptions): StructuredCommandResult | undefined {
	const message = 'Тесты OneScript этого проекта уже идут';
	log.warn(message);
	if (opts?.wait === true) {
		return { success: false, exitCode: 1, stdout: '', stderr: message };
	}
	const agentRun = runs.get(key);
	if (agentRun === undefined) {
		void vscode.window.showWarningMessage(message);
		return undefined;
	}
	const stop = 'Остановить';
	void vscode.window.showWarningMessage('Тесты OneScript этого проекта уже запустил агент.', stop).then((answer) => {
		if (answer === stop) {
			agentRun.cancel();
		}
	});
	return undefined;
}

/** Аргументы раннера и отчёт, который он напишет. */
export interface OneScriptTestsCall {
	args: string[];
	/** Файл jUnit-отчёта */
	report: string;
}

/**
 * Аргументы прогона всех тестов каталога.
 *
 * @param kind - Раннер
 * @param testsDir - Абсолютный каталог тестов
 * @param reportsDir - Абсолютный каталог отчётов
 */
export function oneScriptTestsCall(kind: OneScriptRunner, testsDir: string, reportsDir: string): OneScriptTestsCall {
	if (kind === 'oneunit') {
		const report = path.join(reportsDir, 'oneunit.xml');
		return { args: ['execute', '-d', testsDir, '-r', '--junit', report], report };
	}
	// 1testrunner сам называет отчёт по каталогу набора
	return { args: ['-runall', testsDir, 'xddReportPath', reportsDir], report: path.join(reportsDir, `${path.basename(testsDir)}.xml`) };
}

/**
 * Прогоняет тесты OneScript проекта.
 *
 * @param vrunner - Менеджер инструментов проекта
 * @param root - Корень проекта
 * @param opts - Опции вызова; с `wait: true` возвращается итог по jUnit-отчёту
 * @returns Итог прогона при `wait: true`
 */
export async function runOneScriptTests(
	vrunner: VRunnerManager,
	root: string,
	opts?: CommandExecutionOptions
): Promise<StructuredCommandResult | void> {
	const title = getOneScriptTestsCommandName().title;
	const testsDir = path.resolve(root, oneScriptTestsPath(root));
	try {
		await fs.access(testsDir);
	} catch {
		const message = `Каталога тестов нет: ${path.relative(root, testsDir) || testsDir}`;
		log.warn(message);
		if (opts?.wait === true) {
			return { success: false, exitCode: 1, stdout: '', stderr: message };
		}
		void vscode.window.showWarningMessage(message);
		return;
	}
	const key = projectRootKey(root);
	if (testsRunning(key, title)) {
		return refuseSecondRun(key, opts);
	}
	// Отметка ставится до первого ожидания: параллельный вызов её уже увидит
	const cancellation = opts?.wait === true ? new vscode.CancellationTokenSource() : undefined;
	runs.set(key, cancellation);
	try {
		return await runAndReport(vrunner, root, testsDir, title, opts, cancellation?.token);
	} finally {
		runs.delete(key);
		cancellation?.dispose();
	}
}

/**
 * Прогон и его итог: агенту процессом без окон, человеку задачей VS Code.
 *
 * @param vrunner - Менеджер инструментов проекта
 * @param root - Корень проекта
 * @param testsDir - Абсолютный каталог тестов
 * @param title - Имя задачи прогона
 * @param opts - Опции вызова
 * @param token - Отмена прогона агента
 */
async function runAndReport(
	vrunner: VRunnerManager,
	root: string,
	testsDir: string,
	title: string,
	opts: CommandExecutionOptions | undefined,
	token: vscode.CancellationToken | undefined
): Promise<StructuredCommandResult | void> {
	const reportsDir = path.resolve(root, vrunner.getOutPath(), BUILD_SUBDIRS.onescript);
	await fs.mkdir(reportsDir, { recursive: true });
	const runner = oneScriptRunnerProgram(root);
	const call = oneScriptTestsCall(runner.kind, testsDir, reportsDir);
	const env = await vrunner.oneScriptEnv();
	const startedAt = Date.now();
	log.info(`${title}: ${runner.kind}, каталог ${testsDir}`);

	const command = buildProcessCommand(runner.file, call.args);
	let exitCode: number;
	let output = '';
	if (opts?.wait === true) {
		// Агенту без задачи: уже идущая задача с тем же именем спросила бы человека, какую остановить
		const result = await runCancellableCommand(command, { cwd: root, env, token });
		output = `${result.stdout}${result.stderr}`.trim();
		if (result.cancelled) {
			return { success: false, exitCode: result.exitCode, stdout: output, stderr: 'Прогон тестов OneScript остановил пользователь' };
		}
		exitCode = result.exitCode;
	} else {
		exitCode = await new Promise<number>((resolve) => {
			let ended: vscode.Disposable | undefined;
			const finish = (code: number) => {
				ended?.dispose();
				resolve(code);
			};
			const task = createVRunnerTask({ name: title, command, cwd: root, env, root, exitCallback: finish });
			// Задача, чей терминал так и не открылся, о выходе не сообщит: конец ловим и по событию
			ended = vscode.tasks.onDidEndTask((event) => {
				if (event.execution.task === task) {
					finish(1);
				}
			});
			vscode.tasks.executeTask(task).then(undefined, (error: Error) => {
				log.error(`Задача тестов OneScript не запустилась: ${error.message}`);
				finish(1);
			});
		});
	}

	const stats = await readRunSummary(call.report, startedAt);
	const green = exitCode === 0 && stats !== undefined && stats.failed === 0 && stats.errors === 0;
	if (opts?.wait !== true) {
		if (green) {
			notifyQuiet(`${title}: тестов ${stats.total}, все прошли`);
		} else {
			notifyQuietFailure(stats ? `${title}: упало ${stats.failed + stats.errors} из ${stats.total}` : `${title}: отчёта нет, код ${exitCode}`);
		}
		return;
	}
	return {
		success: green,
		exitCode,
		stdout: stats ? formatRunSummary(stats) : output,
		stderr: stats ? '' : `Отчёт прогона не найден (ожидался: ${call.report}); код возврата ${exitCode}.`,
		artifact: stats ? call.report : undefined,
		...(stats ? { tests: stats } : {}),
	};
}
