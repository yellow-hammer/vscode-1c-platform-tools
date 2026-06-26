import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from './logger';

const execAsync = promisify(exec);
const log = logger.scope('hooks');

const HOOKS_FILE = path.join('1cpt', 'hooks.json');
const DEFAULT_TIMEOUT_MS = 30_000;

/** Объектная форма описания одного действия хука */
interface HookAction {
	command: string;
	continueOnError?: boolean;
	timeout?: number;
}

type HookStep = string | HookAction;

interface HookEntry {
	pre?: HookStep | HookStep[];
	post?: HookStep | HookStep[];
	onError?: HookStep | HookStep[];
}

interface HooksConfig {
	version?: number;
	hooks?: Record<string, HookEntry>;
}

/** Кэш: путь к файлу → распарсенная конфигурация (undefined = файл отсутствует) */
const configCache = new Map<string, HooksConfig | undefined>();

async function loadConfig(workspaceRoot: string): Promise<HooksConfig | undefined> {
	const filePath = path.join(workspaceRoot, HOOKS_FILE);
	if (configCache.has(filePath)) {
		return configCache.get(filePath);
	}
	try {
		const text = await fs.readFile(filePath, 'utf-8');
		const config = JSON.parse(text) as HooksConfig;
		configCache.set(filePath, config);
		return config;
	} catch {
		configCache.set(filePath, undefined);
		return undefined;
	}
}

/** Сбросить кэш (полезно при изменении файла). */
export function invalidateHooksCache(workspaceRoot: string): void {
	const filePath = path.join(workspaceRoot, HOOKS_FILE);
	configCache.delete(filePath);
}

function resolveEntry(config: HooksConfig, commandId: string): HookEntry | undefined {
	const hooks = config.hooks ?? {};
	return hooks[commandId] ?? hooks['*'];
}

function normalizeSteps(step: HookStep | HookStep[] | undefined): HookAction[] {
	if (!step) {
		return [];
	}
	const arr = Array.isArray(step) ? step : [step];
	return arr.map((s) =>
		typeof s === 'string' ? { command: s } : s
	);
}

async function runStep(
	step: HookAction,
	env: NodeJS.ProcessEnv,
	cwd: string
): Promise<{ exitCode: number; output: string }> {
	const timeoutMs = (step.timeout ?? DEFAULT_TIMEOUT_MS / 1000) * 1000;
	try {
		const { stdout, stderr } = await execAsync(step.command, {
			cwd,
			env,
			timeout: timeoutMs,
			maxBuffer: 10 * 1024 * 1024,
			windowsHide: true,
		});
		const output = [stdout, stderr].filter(Boolean).join('\n');
		return { exitCode: 0, output };
	} catch (err: unknown) {
		const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
		const output = [e.stdout, e.stderr].filter(Boolean).join('\n');
		return { exitCode: e.code ?? 1, output };
	}
}

interface HookPhaseResult {
	/** false означает, что команду нужно прервать (ненулевой pre без continueOnError) */
	shouldContinue: boolean;
}

async function runPhase(
	steps: HookAction[],
	env: NodeJS.ProcessEnv,
	cwd: string,
	phaseName: string
): Promise<HookPhaseResult> {
	for (const step of steps) {
		log.info(`[${phaseName}] ${step.command}`);
		const { exitCode, output } = await runStep(step, env, cwd);
		if (output) {
			for (const line of output.split('\n')) {
				if (line.trim()) {
					log.info(`[${phaseName}] ${line}`);
				}
			}
		}
		if (exitCode !== 0) {
			log.warn(`[${phaseName}] завершился с кодом ${exitCode}`);
			if (!step.continueOnError) {
				return { shouldContinue: false };
			}
		}
	}
	return { shouldContinue: true };
}

function buildEnv(
	commandId: string,
	cwd: string,
	args: string[],
	phase: string,
	exitCode?: number
): NodeJS.ProcessEnv {
	return {
		...process.env,
		VRUNNER_COMMAND_ID: commandId,
		VRUNNER_CWD: cwd,
		VRUNNER_ARGS: args.join(' '),
		VRUNNER_PHASE: phase,
		...(exitCode !== undefined ? { VRUNNER_EXIT_CODE: String(exitCode) } : {}),
	};
}

export interface TerminalHookOptions {
	commandId: string;
	cwd: string;
	args: string[];
	workspaceRoot: string;
}

/**
 * Цикл хуков для терминального режима (fire-and-forget запуск).
 *
 * - Нет хуков для команды → обычный запуск `runUntracked()` (уважает настройку
 *   execution.useTasks — может остаться сырым терминалом).
 * - Есть только pre → выполняем pre, затем обычный запуск (отслеживать незачем).
 * - Есть post/onError → выполняем pre, затем `runTracked()` с ожиданием exit code,
 *   затем post (exitCode === 0) или onError (exitCode !== 0).
 *
 * pre с ненулевым кодом (без continueOnError) блокирует запуск и запускает onError.
 */
export async function runHooksAroundTerminalTask(
	opts: TerminalHookOptions & {
		runTracked: () => Promise<number>;
		runUntracked: () => void | Promise<void>;
	}
): Promise<void> {
	const { commandId, cwd, args, workspaceRoot } = opts;
	const config = await loadConfig(workspaceRoot);
	const entry = config ? resolveEntry(config, commandId) : undefined;

	if (!entry) {
		await opts.runUntracked();
		return;
	}

	const preSteps = normalizeSteps(entry.pre);
	const postSteps = normalizeSteps(entry.post);
	const onErrorSteps = normalizeSteps(entry.onError);

	if (preSteps.length > 0) {
		const preResult = await runPhase(preSteps, buildEnv(commandId, cwd, args, 'pre'), cwd, 'pre');
		if (!preResult.shouldContinue) {
			if (onErrorSteps.length > 0) {
				await runPhase(onErrorSteps, buildEnv(commandId, cwd, args, 'onError', 1), cwd, 'onError');
			}
			return;
		}
	}

	// Без post/onError отслеживать завершение незачем — обычный запуск.
	if (postSteps.length === 0 && onErrorSteps.length === 0) {
		await opts.runUntracked();
		return;
	}

	const exitCode = await opts.runTracked();
	if (exitCode === 0) {
		if (postSteps.length > 0) {
			await runPhase(postSteps, buildEnv(commandId, cwd, args, 'post', exitCode), cwd, 'post');
		}
	} else if (onErrorSteps.length > 0) {
		await runPhase(onErrorSteps, buildEnv(commandId, cwd, args, 'onError', exitCode), cwd, 'onError');
	}
}


type CommandResult = { success: boolean; exitCode: number } | void;

export interface RunWithHooksOptions<T extends CommandResult> {
	commandId: string;
	cwd: string;
	args: string[];
	workspaceRoot: string;
	run: () => Promise<T>;
}

/**
 * Выполняет pre-хук, затем команду, затем post/onError-хук.
 *
 * Возвращает результат команды или undefined если команда отменена pre-хуком.
 */
export async function runWithHooks<T extends CommandResult>(
	opts: RunWithHooksOptions<T>
): Promise<T | undefined> {
	const { commandId, cwd, args, workspaceRoot } = opts;
	const config = await loadConfig(workspaceRoot);
	if (!config) {
		return opts.run();
	}

	const entry = resolveEntry(config, commandId);
	if (!entry) {
		return opts.run();
	}

	const preSteps = normalizeSteps(entry.pre);
	if (preSteps.length > 0) {
		const preResult = await runPhase(
			preSteps,
			buildEnv(commandId, cwd, args, 'pre'),
			cwd,
			'pre'
		);
		if (!preResult.shouldContinue) {
			const onErrorSteps = normalizeSteps(entry.onError);
			if (onErrorSteps.length > 0) {
				await runPhase(
					onErrorSteps,
					buildEnv(commandId, cwd, args, 'onError', 1),
					cwd,
					'onError'
				);
			}
			return undefined;
		}
	}

	let result: T;
	let commandExitCode = 0;
	let commandFailed = false;
	try {
		result = await opts.run();
		const r = result as { success?: boolean; exitCode?: number } | undefined;
		if (r && r.success === false) {
			commandFailed = true;
			commandExitCode = r.exitCode ?? 1;
		}
	} catch (err) {
		// commandFailed не присваиваем: ниже throw, до проверки post/onError управление не дойдёт.
		commandExitCode = 1;
		const onErrorSteps = normalizeSteps(entry.onError);
		if (onErrorSteps.length > 0) {
			await runPhase(
				onErrorSteps,
				buildEnv(commandId, cwd, args, 'onError', commandExitCode),
				cwd,
				'onError'
			);
		}
		throw err;
	}

	if (commandFailed) {
		const onErrorSteps = normalizeSteps(entry.onError);
		if (onErrorSteps.length > 0) {
			await runPhase(
				onErrorSteps,
				buildEnv(commandId, cwd, args, 'onError', commandExitCode),
				cwd,
				'onError'
			);
		}
	} else {
		const postSteps = normalizeSteps(entry.post);
		if (postSteps.length > 0) {
			await runPhase(
				postSteps,
				buildEnv(commandId, cwd, args, 'post', commandExitCode),
				cwd,
				'post'
			);
		}
	}

	return result!;
}
