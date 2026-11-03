/**
 * Запуск depos: человеку задачей VS Code, агенту процессом без окон.
 *
 * Исполняемый файл ищется в `oscript_modules/bin` проекта, иначе в установке
 * OneScript, как vrunner. Если его нет ни там, ни там, команда не ставит пакет
 * сама: предлагает дописать зависимость и выполнить «Установить зависимости».
 * @module deposRun
 */

import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { runCancellableCommand } from '../../shared/cancellableProcess';
import type { CommandExecutionOptions, StructuredCommandResult } from '../../shared/commandExecutionTypes';
import { logger } from '../../shared/logger';
import { notifyQuiet, notifyQuietFailure } from '../../shared/notify';
import { readPackageManifest } from '../../shared/oneScriptLayout';
import { packageProgram } from '../../shared/oneScriptModules';
import { engineVersionSupported } from '../../shared/oneScriptEngine';
import { PROJECT_FILE } from '../../shared/projectLayout';
import { dependsOn } from '../../shared/packagedef';
import type { VRunnerManager } from '../../shared/vrunnerManager';
import { buildProcessCommand } from '../../utils/commandUtils';
import { createVRunnerTask } from '../tasks/vrunnerTask';
import {
	getCheckDependenciesCommandName,
	getDiagnoseDependenciesCommandName,
	getUpgradeDependenciesCommandName,
} from '../tools/commandNames';
import { dependencySnapshot } from './dependencyTree';
import { parseDeposChanges, parseDeposCheck, parseDeposDoctor } from './deposReport';
import { forgetDependencyInsight, rememberDependencyCheck, rememberDependencyDoctor } from './dependencyInsight';

const log = logger.scope('commands');

/** Меньше этой версии движка depos не запускается. */
const DEPOS_MIN_ENGINE: readonly number[] = [2, 2, 0];

const INSTALL_DEPENDENCIES = 'Установить зависимости';
const OPEN_PACKAGEDEF = 'Открыть packagedef';

type DeposAction = 'check' | 'doctor' | 'upgrade';

interface NotStarted {
	message: string;
	actions?: { title: string; run: () => Thenable<unknown> }[];
}

interface Ran {
	exitCode: number;
	stdout: string;
	stderr: string;
	body?: string;
}

/**
 * Сравнивает версии зависимостей с доступными и обновляет список пакетов.
 *
 * @param vrunner - Менеджер инструментов проекта
 * @param opts - Опции вызова; с `wait: true` возвращает список пакетов
 */
export async function checkDepos(
	vrunner: VRunnerManager,
	opts?: CommandExecutionOptions,
): Promise<StructuredCommandResult | void> {
	const ran = await runDepos(vrunner, 'check', getCheckDependenciesCommandName().title, [], opts);
	if (ran === undefined || !isRan(ran)) {
		return ran;
	}
	const updates = parseDeposCheck(ran.body ?? '[]');
	if (updates === undefined) {
		return failed(opts, 'Не удалось прочитать отчёт');
	}
	rememberDependencyCheck(ran.root, updates);
	const snapshot = dependencySnapshot(ran.root);
	const outdated = snapshot.packages.filter((item) => item.available !== undefined).length;
	const problems = snapshot.packages.some((item) => item.problems.length > 0);
	if (opts?.wait === true) {
		return report(snapshot.packages);
	}
	if (problems) {
		notifyQuiet(snapshot.summary);
	} else {
		notifyQuiet(outdated > 0 ? `Можно обновить: ${outdated}` : 'Зависимости актуальны');
	}
	return undefined;
}

/**
 * Ищет проблемы зависимостей и обновляет отметки в списке пакетов.
 *
 * @param vrunner - Менеджер инструментов проекта
 * @param opts - Опции вызова; с `wait: true` возвращает список пакетов
 */
export async function diagnoseDepos(
	vrunner: VRunnerManager,
	opts?: CommandExecutionOptions,
): Promise<StructuredCommandResult | void> {
	const ran = await runDepos(vrunner, 'doctor', getDiagnoseDependenciesCommandName().title, [], opts);
	if (ran === undefined || !isRan(ran)) {
		return ran;
	}
	const problems = parseDeposDoctor(ran.body ?? '{"sections":[]}');
	if (problems === undefined) {
		return failed(opts, 'Не удалось прочитать отчёт');
	}
	rememberDependencyDoctor(ran.root, problems);
	const snapshot = dependencySnapshot(ran.root);
	const problemCount = snapshot.packages.filter((item) => item.problems.length > 0).length;
	if (opts?.wait === true) {
		return report(snapshot.packages);
	}
	notifyQuiet(problemCount > 0 ? snapshot.summary : 'Проблем не найдено');
	return undefined;
}

/**
 * Записывает в packagedef более новые версии зависимостей.
 *
 * @param vrunner - Менеджер инструментов проекта
 * @param opts - Опции вызова; агенту нужен `dependencyTarget`
 * @param packageName - Пакет из строки дерева
 */
export async function upgradeDepos(
	vrunner: VRunnerManager,
	opts?: CommandExecutionOptions,
	packageName?: string,
): Promise<StructuredCommandResult | void> {
	const name = opts?.packageName?.trim() || packageName?.trim() || undefined;
	const target = await targetOf(opts);
	if (target === undefined) {
		return opts?.wait === true
			? { success: false, exitCode: -1, stdout: '', stderr: 'Укажите dependencyTarget: latest, minor или patch' }
			: undefined;
	}
	const extra = ['--target', target, ...(name !== undefined ? ['-f', name] : [])];
	const ran = await runDepos(vrunner, 'upgrade', getUpgradeDependenciesCommandName().title, extra, opts);
	if (ran === undefined || !isRan(ran)) {
		return ran;
	}
	const changes = parseDeposChanges(ran.body ?? '[]');
	if (changes === undefined) {
		return failed(opts, 'Не удалось прочитать отчёт');
	}
	forgetDependencyInsight(ran.root);
	const updates = changes
		.filter((change) => change.targetMin !== '' && change.targetMin !== change.currentMin)
		.map((change) => ({ name: change.name, dev: change.dev, from: change.currentMin, to: change.targetMin }));
	if (opts?.wait === true) {
		return { success: true, exitCode: 0, stdout: ran.stdout, stderr: ran.stderr, data: { updates } };
	}
	if (updates.length === 0) {
		notifyQuiet('Менять нечего');
		return undefined;
	}
	const install = await vscode.window.showInformationMessage('Версии в packagedef обновлены.', INSTALL_DEPENDENCIES);
	if (install === INSTALL_DEPENDENCIES) {
		await vscode.commands.executeCommand('1c-platform-tools.dependencies.install');
	}
	return undefined;
}

interface Finished extends Ran {
	root: string;
}

async function runDepos(
	vrunner: VRunnerManager,
	action: DeposAction,
	title: string,
	extra: string[],
	opts: CommandExecutionOptions | undefined,
): Promise<Finished | StructuredCommandResult | undefined> {
	const gate = await gateDepos(vrunner, opts);
	if (!gate.ok) {
		return gate.result;
	}
	const file = path.join(os.tmpdir(), `depos-${process.pid}-${Date.now()}.json`);
	const args = [
		action,
		'--manifest', path.join(gate.root, PROJECT_FILE),
		'--format', 'json',
		'--output', file,
		...(action === 'doctor' ? [] : ['--engine', 'auto']),
		...extra,
	];
	const command = buildProcessCommand(gate.program, args);
	const env = await vrunner.oneScriptEnv();
	try {
		const ran = opts?.wait === true
			? await runCancellableCommand(command, { cwd: gate.root, env })
			: await runTask(title, command, gate.root, env);
		if (!ran.success) {
			const message = firstLine(ran.stderr || ran.stdout) || 'Команда не выполнилась';
			log.error(`${title}: ${message}`);
			if (opts?.wait === true) {
				return { success: false, exitCode: ran.exitCode, stdout: ran.stdout, stderr: message };
			}
			notifyQuietFailure(message);
			return undefined;
		}
		let body: string | undefined;
		try {
			body = await fsPromises.readFile(file, 'utf8');
		} catch {
			body = undefined;
		}
		return { root: gate.root, exitCode: ran.exitCode, stdout: ran.stdout, stderr: ran.stderr, ...(body !== undefined ? { body } : {}) };
	} finally {
		await fsPromises.unlink(file).catch(() => undefined);
	}
}

async function gateDepos(
	vrunner: VRunnerManager,
	opts: CommandExecutionOptions | undefined,
): Promise<{ ok: true; root: string; program: string } | { ok: false; result?: StructuredCommandResult }> {
	const root = vrunner.getWorkspaceRoot();
	if (root === undefined) {
		return { ok: false, result: await notStarted({ message: 'Откройте проект' }, opts) };
	}
	const env = await vrunner.oneScriptEnv();
	const version = await vrunner.engineVersion();
	if (version !== undefined && !engineVersionSupported(version.parts, DEPOS_MIN_ENGINE)) {
		return {
			ok: false,
			result: await notStarted({
				message: `Нужен OneScript не ниже ${DEPOS_MIN_ENGINE.join('.')}, выбран ${version.text}.`,
			}, opts),
		};
	}
	const program = packageProgram(root, 'depos', env);
	if (program === undefined) {
		return { ok: false, result: await notStarted(deposMissing(root), opts) };
	}
	return { ok: true, root, program };
}

function deposMissing(root: string): NotStarted {
	const packagedef = path.join(root, PROJECT_FILE);
	const declared = dependsDeclared(root);
	const install = {
		title: INSTALL_DEPENDENCIES,
		run: () => vscode.commands.executeCommand('1c-platform-tools.dependencies.install'),
	};
	if (declared) {
		return {
			message: 'depos объявлен в packagedef, но не установлен: выполните «Установить зависимости».',
			actions: [install],
		};
	}
	const open = { title: OPEN_PACKAGEDEF, run: () => vscode.window.showTextDocument(vscode.Uri.file(packagedef)) };
	return {
		message: 'depos не установлен в проекте: добавьте в packagedef .РазработкаЗависитОт("depos") и выполните «Установить зависимости».',
		actions: fs.existsSync(packagedef) ? [open, install] : [install],
	};
}

function dependsDeclared(root: string): boolean {
	const manifest = readPackageManifest(root);
	return manifest !== undefined && dependsOn(manifest, 'depos');
}

async function notStarted(reason: NotStarted, opts: CommandExecutionOptions | undefined): Promise<StructuredCommandResult | undefined> {
	log.warn(`depos не запущен: ${reason.message}`);
	if (opts?.wait === true) {
		return { success: false, exitCode: -1, stdout: '', stderr: reason.message };
	}
	const actions = reason.actions ?? [];
	const picked = await vscode.window.showErrorMessage(reason.message, ...actions.map((action) => action.title));
	await actions.find((action) => action.title === picked)?.run();
	return undefined;
}

function runTask(
	title: string,
	command: string,
	root: string,
	env: NodeJS.ProcessEnv,
): Promise<{ success: boolean; exitCode: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		let ended: vscode.Disposable | undefined;
		let output = '';
		const finish = (exitCode: number) => {
			ended?.dispose();
			resolve({ success: exitCode === 0, exitCode, stdout: output, stderr: '' });
		};
		const task = createVRunnerTask({
			name: title,
			command,
			cwd: root,
			env,
			root,
			onOutput: (chunk) => {
				output += chunk;
			},
			exitCallback: finish,
		});
		ended = vscode.tasks.onDidEndTask((event) => {
			if (event.execution.task === task) {
				finish(1);
			}
		});
		vscode.tasks.executeTask(task).then(undefined, (error: Error) => {
			log.error(`Задача не запустилась: ${error.message}`);
			finish(1);
		});
	});
}

async function targetOf(opts: CommandExecutionOptions | undefined): Promise<'latest' | 'minor' | 'patch' | undefined> {
	const given = opts?.dependencyTarget;
	if (given === 'latest' || given === 'minor' || given === 'patch') {
		return given;
	}
	if (opts?.wait === true) {
		return undefined;
	}
	const picked = await vscode.window.showQuickPick(
		[
			{ label: 'Последние версии', target: 'latest' as const },
			{ label: 'Без смены старшей версии', target: 'minor' as const },
			{ label: 'Только исправления', target: 'patch' as const },
		],
		{ title: 'Какие версии записать в packagedef', ignoreFocusOut: true },
	);
	return picked?.target;
}

function isRan(value: Finished | StructuredCommandResult): value is Finished {
	return 'root' in value;
}

function report(packages: unknown): StructuredCommandResult {
	return { success: true, exitCode: 0, stdout: '', stderr: '', data: { packages } };
}

function failed(opts: CommandExecutionOptions | undefined, message: string): StructuredCommandResult | undefined {
	log.error(message);
	if (opts?.wait === true) {
		return { success: false, exitCode: -1, stdout: '', stderr: message };
	}
	notifyQuietFailure(message);
	return undefined;
}

function firstLine(text: string): string {
	const line = text.split(/\r?\n/).map((item) => item.trim()).find((item) => item !== '') ?? '';
	return line.length > 240 ? `${line.slice(0, 237)}…` : line;
}
