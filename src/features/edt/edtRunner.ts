/**
 * Запуск команд 1С:EDT через `1cedtcli`.
 *
 * Команды EDT идут долго - импорт большой конфигурации занимает десятки минут, -
 * поэтому выполняются задачей VS Code: с выводом в терминал, отменой и повтором,
 * как команды vanessa-runner. Когда команду ждёт вызывающий (цепочка, агент),
 * 1cedtcli, как и vanessa-runner, идёт в фоне: без терминала, с выводом в журнал.
 *
 * Рабочую область `1cedtcli` занимает монопольно: пока идёт одна команда, вторая
 * в том же каталоге падает с сообщением о занятой рабочей области. Поэтому у
 * проекта своя рабочая область, а команды выстраиваются в очередь.
 *
 * @module edtRunner
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildProcessCommand } from '../../utils/commandUtils';
import { createVRunnerTask, type TaskOutputChain } from '../tasks/vrunnerTask';
import { runCancellableCommand } from '../../shared/cancellableProcess';
import { logger } from '../../shared/logger';
import { findEdtInstallations, pickEdtInstallation, type EdtInstallation } from '../../shared/edtLocator';
import { isEdtProject } from '../../shared/projectLayout';
import { edtTemporaryDir } from '../../shared/edtStaging';
import { projectConfiguration } from '../../shared/projectConfiguration';
import { currentRoot } from '../../shared/workspaceProjects';
import { ensureWorkspaceTrusted, WORKSPACE_TRUST_REQUIRED } from '../../shared/workspaceTrust';
import { VRunnerManager } from '../../shared/vrunnerManager';

const log = logger.scope('edt');

/** Тип задачи EDT в списке задач. */
const EDT_TASK_TYPE = '1c-edt';

/** Рабочая область по умолчанию: рядом со сборкой проекта. */
const DEFAULT_WORKSPACE_DIR = 'edt-workspace';

/** Идёт ли сейчас команда EDT: рабочую область нельзя делить. */
let running: Promise<number> | undefined;

/** Ответ, когда 1С:EDT на машине не найдена. */
export const EDT_NOT_FOUND_MESSAGE =
	'1С:EDT не найдена. Установите её через 1cedtstart или укажите каталог в настройке «Каталог установки 1С:EDT».';

/** Сколько последнего вывода команды хранится для объяснения ошибки. */
const OUTPUT_TAIL_LIMIT = 64_000;

/** Итог команды EDT. */
export interface EdtRunResult {
	/** Код возврата процесса. */
	exitCode: number;
	/** Причина неудачи для пользователя; у успешной и остановленной команды её нет. */
	error?: string;
}

/**
 * Строки, которые 1cedtcli печатает и при успешной команде. Строки с отступом
 * сразу после них относятся к ним же.
 */
const EDT_NOISE = [
	/^\[Fatal Error\] :1:1: Premature end of file\./,
	/com\.e1c\.edt\.ai\.ui/,
	/weaving hook/i,
	/class file major version/i,
];

/** Строки стека Java. */
const JAVA_STACK_LINE = /^(?:at \S|\.\.\. \d+ more|Caused by: |Suppressed: )/;

/** Известные ответы 1cedtcli: русский и английский текст одного и того же отказа. */
const EDT_FAILURES: { pattern: RegExp; explain: (match: RegExpMatchArray) => string }[] = [
	{
		pattern: /рабочая область '[^']*' уже используется другим приложением|workspace .* is currently in use by another application/i,
		explain: () =>
			'Рабочая область 1С:EDT занята: её держит открытая EDT или другой процесс 1cedtcli. Закройте EDT на этой рабочей области и повторите команду.',
	},
	{
		pattern: /Проект с именем (.+?) уже существует в рабочей области|project (?:with name )?'?(.+?)'? already exists in the workspace|Workspace project with name (.+?) already exist/i,
		explain: (match) => `Проект ${match[1] ?? match[2] ?? match[3]} уже подключён к рабочей области 1С:EDT.`,
	},
	{
		pattern: /Project not found: (.+)|Не найдено проекта с именем (.+?) в рабочей области|Workspace project with name (.+?) does not exist/i,
		explain: (match) => `Проекта ${(match[1] ?? match[2] ?? match[3]).trim()} нет в рабочей области 1С:EDT.`,
	},
];

/**
 * Причина неудачной команды по выводу 1cedtcli.
 *
 * @param output - Вывод команды
 * @returns Объяснение для пользователя либо undefined, если отказ не распознан
 */
export function explainEdtFailure(output: string): string | undefined {
	for (const failure of EDT_FAILURES) {
		const match = output.match(failure.pattern);
		if (match) {
			return failure.explain(match);
		}
	}
	return undefined;
}

/**
 * Строка вывода, которой 1cedtcli сообщает об отказе.
 *
 * Причина идёт первой строкой отказа, за ней подробности: варианты вызова,
 * ошибки по отдельным файлам. Подробности могут начинаться со слова «Ошибка».
 *
 * @param output - Вывод команды
 * @returns Строка как есть либо undefined, если в выводе нет ничего, кроме шума
 */
export function edtErrorLine(output: string): string | undefined {
	let noiseBlock = false;
	for (const line of output.split(/\r?\n/)) {
		const text = line.trim();
		if (text === '') {
			noiseBlock = false;
		} else if (EDT_NOISE.some((noise) => noise.test(text))) {
			noiseBlock = true;
		} else if (!JAVA_STACK_LINE.test(text) && !(noiseBlock && /^\s/.test(line))) {
			return text;
		}
	}
	return undefined;
}

/**
 * Сообщение о коде возврата 1cedtcli.
 *
 * @param exitCode - Код возврата
 * @param line - Строка отказа из вывода
 */
export function edtExitMessage(exitCode: number, line?: string): string {
	return line === undefined
		? `Команда 1С:EDT завершилась с кодом ${exitCode}.`
		: `Команда 1С:EDT завершилась с кодом ${exitCode}: ${line}`;
}

/**
 * Причина неудачной команды 1cedtcli для ответа вызывающему: известный отказ
 * объясняется, остальные идут строкой из вывода как есть.
 *
 * @param output - Вывод команды
 * @param exitCode - Код возврата
 */
export function describeEdtFailure(output: string, exitCode: number): string {
	return explainEdtFailure(output) ?? edtExitMessage(exitCode, edtErrorLine(output));
}

/**
 * Итог завершившейся команды: у успешной и остановленной причины нет.
 *
 * @param exitCode - Код возврата
 * @param output - Вывод команды
 * @param cancelled - Остановил ли задачу пользователь
 */
export function edtRunResult(exitCode: number, output: string, cancelled: boolean): EdtRunResult {
	return exitCode === 0 || cancelled ? { exitCode } : { exitCode, error: describeEdtFailure(output, exitCode) };
}

/** Ошибка шага, за которым стоит команда 1cedtcli: несёт её код возврата. */
export class EdtCommandError extends Error {
	constructor(
		message: string,
		public readonly exitCode: number
	) {
		super(message);
		this.name = 'EdtCommandError';
	}
}

/**
 * Сообщение о неудавшемся шаге вместе с причиной от 1cedtcli.
 *
 * @param summary - Что не получилось, законченной фразой
 * @param result - Итог команды EDT
 */
export function edtFailureMessage(summary: string, result: EdtRunResult): string {
	return result.error === undefined ? summary : `${summary} ${result.error}`;
}

/**
 * Хвост вывода не длиннее предела, начиная с целой строки.
 *
 * @param output - Накопленный вывод
 * @param limit - Предел длины
 */
export function outputTail(output: string, limit = OUTPUT_TAIL_LIMIT): string {
	if (output.length <= limit) {
		return output;
	}
	const start = output.length - limit;
	const lineEnd = output.indexOf('\n', start - 1);
	return lineEnd < 0 ? output.slice(start) : output.slice(lineEnd + 1);
}

/**
 * Определение задачи графической EDT на рабочей области: по нему команды
 * узнают, что редактор держит рабочую область.
 *
 * @param workspaceDir - Каталог рабочей области EDT
 */
export function edtEditorTaskDefinition(workspaceDir: string): vscode.TaskDefinition {
	return { type: EDT_TASK_TYPE, command: 'open', workspace: path.resolve(workspaceDir) };
}

/** Открыта ли графическая EDT на рабочей области командой «Запустить EDT». */
function editorHoldsWorkspace(workspaceDir: string): boolean {
	const wanted = path.resolve(workspaceDir).toLowerCase();
	return vscode.tasks.taskExecutions.some((execution) => {
		const definition = execution.task.definition;
		return (
			definition.type === EDT_TASK_TYPE &&
			definition.command === 'open' &&
			typeof definition.workspace === 'string' &&
			definition.workspace.toLowerCase() === wanted
		);
	});
}

/** Настройки раздела «1С:EDT». */
export interface EdtSettings {
	/** Каталог установки или каталог со списком версий. */
	path: string;
	/** Версия при нескольких установленных. */
	version: string;
	/** Каталог рабочей области. */
	workspace: string;
	/** Таймаут команды в секундах. */
	timeoutSeconds: number;
	/** Дополнительные аргументы JVM. */
	vmargs: string[];
}

/**
 * Читает настройки EDT проекта.
 *
 * @param root - Корень проекта
 */
export function readEdtSettings(root: string | undefined = currentRoot()): EdtSettings {
	const config = projectConfiguration(root);
	return {
		path: config.get<string>('edt.path', ''),
		version: config.get<string>('edt.version', ''),
		workspace: config.get<string>('edt.workspace', ''),
		timeoutSeconds: config.get<number>('edt.timeoutSeconds', 3600),
		vmargs: config.get<string[]>('edt.vmargs', []),
	};
}

/**
 * Установка EDT, которой выполняются команды.
 *
 * @returns Установка или undefined, если EDT не найдена
 */
export function resolveEdt(settings: EdtSettings = readEdtSettings()): EdtInstallation | undefined {
	const { installations } = findEdtInstallations(settings.path);
	return pickEdtInstallation(installations, settings.version);
}

/**
 * Корень выгрузок моста: каталог сборки, а у проекта EDT, открытого как рабочая область,
 * временный каталог.
 *
 * @param workspaceRoot - Корень рабочей области VS Code
 * @param buildPath - Каталог сборки проекта
 */
export function edtStagingRoot(workspaceRoot: string, buildPath: string): string {
	return isEdtProject(workspaceRoot) ? edtTemporaryDir(workspaceRoot) : buildPath;
}

/**
 * Каталог рабочей области для команд EDT.
 *
 * @param workspaceRoot - Корень рабочей области VS Code
 * @param buildPath - Каталог сборки проекта
 */
export function edtWorkspaceDir(
	workspaceRoot: string,
	buildPath: string,
	settings: EdtSettings = readEdtSettings(workspaceRoot)
): string {
	const configured = settings.workspace.trim();
	if (configured) {
		return path.isAbsolute(configured) ? configured : path.join(workspaceRoot, configured);
	}
	if (isEdtProject(workspaceRoot)) {
		return path.join(edtTemporaryDir(workspaceRoot), DEFAULT_WORKSPACE_DIR);
	}
	return path.join(workspaceRoot, buildPath, DEFAULT_WORKSPACE_DIR);
}

/** Что запускаем. */
export interface EdtCommand {
	/** Имя команды `1cedtcli`: import, export, validate. */
	command: string;
	/** Аргументы команды. */
	args: string[];
	/** Название задачи для панели терминала. */
	title: string;
	/** Каталог рабочей области EDT. */
	workspaceDir: string;
	/** Каталог запуска процесса. */
	cwd: string;
	/** Вывод шагов команды: общий терминал или фон; без него задача очищает терминал. */
	output?: TaskOutputChain;
}

/**
 * Собирает аргументы запуска `1cedtcli`.
 *
 * Порядок важен: рабочая область и общие параметры идут до `-command`, всё
 * после него достаётся самой команде. Лаунчер отдаёт JVM всё от первого
 * `-vmargs` до `-command`: второй `-vmargs` дошёл бы до Java буквально.
 */
export function buildEdtArgs(request: EdtCommand, settings: EdtSettings): string[] {
	const args = ['-data', request.workspaceDir, '-timeout', String(settings.timeoutSeconds)];
	if (settings.vmargs.length > 0) {
		args.push('-vmargs', ...settings.vmargs);
	}
	args.push('-command', request.command, ...request.args);
	return args;
}

/**
 * Имя проекта EDT.
 *
 * Рабочая область знает проект по имени из `.project`, а оно не обязано
 * совпадать с именем каталога: проект `УчетАрхитектора-02-04` спокойно лежит в
 * каталоге `архидок-edt`. Без файла остаётся имя каталога.
 *
 * @param projectDir - Каталог проекта
 */
export function edtProjectName(projectDir: string): string {
	try {
		const description = fs.readFileSync(path.join(projectDir, '.project'), 'utf-8');
		const name = description.match(/<name>([^<]+)<\/name>/)?.[1]?.trim();
		if (name) {
			return name;
		}
	} catch {
		// Файла нет или он нечитаем: имя каталога - разумное приближение
	}
	return path.basename(projectDir);
}

/**
 * Подключён ли проект к рабочей области EDT.
 *
 * Рабочая область помнит подключённые проекты в служебном каталоге: имя
 * проекта там совпадает с именем каталога проекта.
 *
 * @param workspaceDir - Каталог рабочей области EDT
 * @param projectName - Имя проекта
 */
export function isProjectRegistered(workspaceDir: string, projectName: string): boolean {
	return fs.existsSync(
		path.join(workspaceDir, '.metadata', '.plugins', 'org.eclipse.core.resources', '.projects', projectName)
	);
}

/**
 * Отключает проект от рабочей области, файлы на диске остаются: выгрузку EDT
 * импортирует только в проект, которого в рабочей области ещё нет.
 *
 * @param projectDir - Каталог проекта EDT
 * @param workspaceDir - Каталог рабочей области
 * @param cwd - Каталог запуска
 * @param output - Вывод шагов команды
 * @returns Итог отключения; успех, если проекта в рабочей области не было
 */
export async function detachProject(
	projectDir: string,
	workspaceDir: string,
	cwd: string,
	output?: TaskOutputChain
): Promise<EdtRunResult> {
	if (!fs.existsSync(path.join(projectDir, '.project'))) {
		return { exitCode: 0 };
	}
	const projectName = edtProjectName(projectDir);
	if (!isProjectRegistered(workspaceDir, projectName)) {
		return { exitCode: 0 };
	}
	return runEdtCommand({
		command: 'delete',
		args: ['-y', 'true', projectName],
		title: `EDT: отключение ${projectName}`,
		workspaceDir,
		cwd,
		output,
	});
}

/**
 * Подключает проект к рабочей области, если он ещё не подключён.
 *
 * Команды над проектом обращаются к нему по имени, а имя знает только рабочая
 * область: на свежей области любая из них не нашла бы проект.
 *
 * @param projectDir - Каталог проекта EDT
 * @param workspaceDir - Каталог рабочей области
 * @param cwd - Каталог запуска
 * @param output - Вывод шагов команды
 * @returns Итог подключения; успех, если проект уже был подключён
 */
export async function ensureProjectRegistered(
	projectDir: string,
	workspaceDir: string,
	cwd: string,
	output?: TaskOutputChain
): Promise<EdtRunResult> {
	const projectName = edtProjectName(projectDir);
	if (isProjectRegistered(workspaceDir, projectName)) {
		return { exitCode: 0 };
	}

	return runEdtCommand({
		command: 'import',
		args: ['--project', projectDir],
		title: `EDT: подключение проекта ${projectName}`,
		workspaceDir,
		cwd,
		output,
	});
}

/**
 * Выполняет команду EDT задачей VS Code, а команду, которую ждёт вызывающий, - в фоне.
 *
 * Пока идёт одна команда, вторая ждёт: `1cedtcli` не делит рабочую область.
 * Отказ запущенной команды виден в терминале задачи, у фоновой - в журнале;
 * сообщением показывается только причина, по которой задача не запустилась.
 *
 * @param request - Команда и её аргументы
 * @returns Код возврата процесса и причина неудачи
 */
export async function runEdtCommand(request: EdtCommand): Promise<EdtRunResult> {
	const background = request.output?.background === true;
	// 1cedtcli работает над исходным кодом проекта, а путь к нему задают настройки edt.*
	if (!ensureWorkspaceTrusted(`EDT ${request.command}`)) {
		return { exitCode: 1, error: WORKSPACE_TRUST_REQUIRED };
	}

	const vrunner = VRunnerManager.getInstance();
	const environmentProblem = vrunner.environmentProblem();
	if (environmentProblem) {
		if (!background) {
			vrunner.offerLaunchFix(environmentProblem);
		}
		log.warn(environmentProblem);
		return { exitCode: 1, error: environmentProblem };
	}

	const settings = readEdtSettings();
	const installation = resolveEdt(settings);
	if (!installation) {
		return notStarted(EDT_NOT_FOUND_MESSAGE, background);
	}

	// Рабочую область 1cedtcli не делит: следующая команда ждёт, пока закончится текущая
	while (running) {
		await running.catch(() => undefined);
	}

	if (editorHoldsWorkspace(request.workspaceDir)) {
		return notStarted(
			'1С:EDT открыта на рабочей области проекта, а 1cedtcli с занятой рабочей областью не работает. Закройте EDT и повторите команду.',
			background
		);
	}

	const args = buildEdtArgs(request, settings);
	// Задача исполняет команду процессом, а не терминалом пользователя: экранирование по оболочке процесса
	const command = buildProcessCommand(installation.cli, args);
	log.info(`EDT ${installation.version}: ${request.command}`);

	let output = '';
	let cancelled = false;
	const onOutput = (chunk: string): void => {
		output = outputTail(output + chunk);
	};
	const env = vrunner.launchEnv();
	if (background) {
		running = runInBackground(command, request.cwd, env, onOutput);
	} else {
		running = new Promise<number>((resolve) => {
			const task = createVRunnerTask({
				name: request.title,
				command: () => ({
					command,
					onCancel: () => {
						cancelled = true;
					},
				}),
				cwd: request.cwd,
				env,
				definition: { type: EDT_TASK_TYPE, command: request.command },
				exitCallback: resolve,
				appendOutput: request.output?.append(),
				onOutput,
			});
			void vscode.tasks.executeTask(task);
		});
	}

	try {
		const exitCode = await running;
		// Терминала у фоновой команды нет: вывод остаётся только в журнале
		if (background && output.trim() !== '') {
			log.info(`Вывод «${request.title}»:\n${output.trim()}`);
		}
		if (exitCode !== 0) {
			const line = edtErrorLine(output);
			log.warn(`EDT ${request.command}: код возврата ${exitCode}${line === undefined ? '' : `: ${line}`}`);
		}
		return edtRunResult(exitCode, output, cancelled);
	} finally {
		running = undefined;
	}
}

/**
 * Запускает 1cedtcli процессом без терминала. Процесс, который не запустился,
 * получает код 1, как у задачи.
 */
async function runInBackground(command: string, cwd: string, env: NodeJS.ProcessEnv, onOutput: (chunk: string) => void): Promise<number> {
	const { exitCode } = await runCancellableCommand(command, { cwd, env, onOutput });
	return exitCode >= 0 ? exitCode : 1;
}

/**
 * Итог команды, для которой процесс не запускался. Причину показывает окно, у фоновой
 * команды окна нет: причина уходит вызывающему и в журнал.
 */
function notStarted(error: string, background: boolean): EdtRunResult {
	if (background) {
		log.warn(error);
	} else {
		void vscode.window.showErrorMessage(error);
	}
	return { exitCode: 1, error };
}
