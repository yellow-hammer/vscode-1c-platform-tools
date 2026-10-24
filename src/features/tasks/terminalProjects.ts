/**
 * Проект команды, которая пишет в терминал: ссылки в выводе открывают файлы этого проекта.
 * @module terminalProjects
 */

import * as vscode from 'vscode';
import { sameProjectRoot, workspaceFolderOf } from '../../shared/workspaceProjects';
import { untrustedWorkspaceBlocks } from '../../shared/workspaceTrust';

/** Терминалы, созданные расширением: корень проекта команды. */
const terminalRoots = new WeakMap<vscode.Terminal, string>();

/** Имя терминала задачи: корень проекта последней задачи с этим именем. */
const taskRoots = new Map<string, string>();

/** Имя и источник задачи. */
export interface TaskLabel {
	name: string;
	source: string;
}

/**
 * Имя терминала задачи в VS Code: имя задачи, а в окне файла рабочей области
 * подпись `<источник>: <имя>` с именем папки задачи в скобках.
 *
 * @param task - Имя и источник задачи
 * @param folder - Имя папки задачи; нет у задачи всей рабочей области
 * @param workspaceFile - Окно открыто файлом рабочей области
 */
export function taskTerminalName(task: TaskLabel, folder: string | undefined, workspaceFile: boolean): string {
	if (!workspaceFile) {
		return task.name;
	}
	const label = `${task.source}: ${task.name}`;
	return folder === undefined ? label : `${label} (${folder})`;
}

/**
 * Запоминает проект задачи по имени её терминала.
 *
 * @param task - Имя и источник задачи
 * @param root - Корень проекта
 */
export function rememberTaskProject(task: TaskLabel, root: string): void {
	const folder = workspaceFolderOf(root)?.name;
	const names = new Set([
		taskTerminalName(task, folder, vscode.workspace.workspaceFile !== undefined),
		// Задача из tasks.json с label: VS Code не добавляет к имени источник
		task.name,
		...(folder === undefined ? [] : [`${task.name} (${folder})`]),
	]);
	for (const name of names) {
		taskRoots.set(name, root);
	}
}

/**
 * Запоминает проект терминала, созданного расширением.
 *
 * @param terminal - Терминал
 * @param root - Корень проекта
 */
export function rememberTerminalProject(terminal: vscode.Terminal, root: string): void {
	terminalRoots.set(terminal, root);
}

/**
 * Корень проекта команды, запущенной в терминале последней.
 *
 * @param terminal - Терминал
 * @returns корень или undefined, если команды расширения в терминале не было
 */
export function terminalProjectRoot(terminal: vscode.Terminal): string | undefined {
	return terminalRoots.get(terminal) ?? taskRoots.get(terminal.name);
}

/** Каталог, с которым создан терминал. */
function creationCwd(terminal: vscode.Terminal): string | undefined {
	const options = terminal.creationOptions;
	if (!('cwd' in options) || options.cwd === undefined) {
		return undefined;
	}
	return typeof options.cwd === 'string' ? options.cwd : options.cwd.fsPath;
}

type TerminalEnv = Readonly<Record<string, string | null | undefined>>;

/** Переменные, с которыми создан терминал. */
function creationEnv(terminal: vscode.Terminal): TerminalEnv | undefined {
	const options = terminal.creationOptions;
	return 'env' in options ? options.env : undefined;
}

/** Те же переменные с теми же значениями. */
function sameEnv(created: TerminalEnv | undefined, env: TerminalEnv | undefined): boolean {
	const defined = (vars: TerminalEnv | undefined): [string, string][] =>
		Object.entries(vars ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
	const left = defined(created);
	const right = new Map(defined(env));
	return left.length === right.size && left.every(([name, value]) => right.get(name) === value);
}

/**
 * Терминал с тем же именем, созданный в том же каталоге с теми же переменными:
 * после смены окружения проекта команда идёт в новом терминале.
 *
 * @param terminals - Открытые терминалы
 * @param name - Имя терминала
 * @param cwd - Рабочий каталог команды
 * @param env - Переменные терминала команды
 */
export function reusableTerminal(
	terminals: readonly vscode.Terminal[],
	name: string,
	cwd: string,
	env?: NodeJS.ProcessEnv
): vscode.Terminal | undefined {
	return terminals.find((terminal) => {
		const created = creationCwd(terminal);
		return terminal.name === name && created !== undefined && sameProjectRoot(created, cwd) && sameEnv(creationEnv(terminal), env);
	});
}

/** Параметры терминала команды. */
export interface ProjectTerminalOptions {
	name: string;
	cwd: string;
	env?: NodeJS.ProcessEnv;
	/** Корень проекта команды */
	root?: string;
}

/**
 * Терминал для команды в режиме `execution.useTasks === false`: открытый терминал
 * с тем же именем и каталогом или новый.
 *
 * @param options - Имя, каталог, окружение и проект
 * @returns Терминал; undefined в недоверенной папке, команду в него не пишут
 */
export function projectTerminal(options: ProjectTerminalOptions): vscode.Terminal | undefined {
	if (untrustedWorkspaceBlocks(`терминал ${options.name}`)) {
		return undefined;
	}
	const env = options.env ? { ...process.env, ...options.env } : undefined;
	const terminal =
		reusableTerminal(vscode.window.terminals, options.name, options.cwd, env) ??
		// eslint-disable-next-line no-restricted-syntax -- execution.useTasks === false: терминал выбран пользователем
		vscode.window.createTerminal({ name: options.name, cwd: options.cwd, env });
	if (options.root !== undefined) {
		rememberTerminalProject(terminal, options.root);
	}
	return terminal;
}
