/**
 * Запуск команд 1С:EDT через `1cedtcli`.
 *
 * Команды EDT идут долго - импорт большой конфигурации занимает десятки минут, -
 * поэтому выполняются задачей VS Code: с выводом в терминал, отменой и повтором,
 * как команды vanessa-runner.
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
import { buildCommand, detectShellType } from '../../utils/commandUtils';
import { createVRunnerTask } from '../tasks/vrunnerTask';
import { logger } from '../../shared/logger';
import { findEdtInstallations, pickEdtInstallation, type EdtInstallation } from '../../shared/edtLocator';

const log = logger.scope('edt');

/** Тип задачи EDT в списке задач. */
const EDT_TASK_TYPE = '1c-edt';

/** Рабочая область по умолчанию: рядом со сборкой проекта. */
const DEFAULT_WORKSPACE_DIR = 'edt-workspace';

/** Идёт ли сейчас команда EDT: рабочую область нельзя делить. */
let running: Promise<number> | undefined;

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
 * Читает настройки EDT.
 */
export function readEdtSettings(): EdtSettings {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
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
 * Каталог рабочей области для команд EDT.
 *
 * @param workspaceRoot - Корень рабочей области VS Code
 * @param buildPath - Каталог сборки проекта
 */
export function edtWorkspaceDir(workspaceRoot: string, buildPath: string, settings: EdtSettings = readEdtSettings()): string {
	const configured = settings.workspace.trim();
	if (configured) {
		return path.isAbsolute(configured) ? configured : path.join(workspaceRoot, configured);
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
}

/**
 * Собирает аргументы запуска `1cedtcli`.
 *
 * Порядок важен: рабочая область и общие параметры идут до `-command`, всё
 * после него достаётся самой команде.
 */
export function buildEdtArgs(request: EdtCommand, settings: EdtSettings): string[] {
	const args = ['-data', request.workspaceDir, '-timeout', String(settings.timeoutSeconds)];
	for (const vmarg of settings.vmargs) {
		args.push('-vmargs', vmarg);
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
 * Подключает проект к рабочей области, если он ещё не подключён.
 *
 * Команды над проектом обращаются к нему по имени, а имя знает только рабочая
 * область: на свежей области любая из них не нашла бы проект.
 *
 * @param projectDir - Каталог проекта EDT
 * @param workspaceDir - Каталог рабочей области
 * @param cwd - Каталог запуска
 * @returns Код возврата подключения; ноль, если проект уже был подключён
 */
export async function ensureProjectRegistered(
	projectDir: string,
	workspaceDir: string,
	cwd: string
): Promise<number> {
	const projectName = edtProjectName(projectDir);
	if (isProjectRegistered(workspaceDir, projectName)) {
		return 0;
	}

	return runEdtCommand({
		command: 'import',
		args: ['--project', projectDir],
		title: `EDT: подключение проекта ${projectName}`,
		workspaceDir,
		cwd,
	});
}

/**
 * Выполняет команду EDT задачей VS Code.
 *
 * Пока идёт одна команда, вторая ждёт: `1cedtcli` не делит рабочую область.
 *
 * @param request - Команда и её аргументы
 * @returns Код возврата процесса
 */
export async function runEdtCommand(request: EdtCommand): Promise<number> {
	const settings = readEdtSettings();
	const installation = resolveEdt(settings);
	if (!installation) {
		void vscode.window.showErrorMessage(
			'1С:EDT не найдена. Установите её через 1cedtstart или укажите каталог в настройке «Каталог установки 1С:EDT».'
		);
		return 1;
	}

	if (running) {
		// Свой код возврата у отказа: с кодом выполняющейся команды вызывающий
		// решил бы, что его работа сделана
		void vscode.window.showInformationMessage('Команда 1С:EDT уже выполняется: рабочая область занята.');
		return 1;
	}

	const args = buildEdtArgs(request, settings);
	const command = buildCommand(installation.cli, args, detectShellType());
	log.info(`EDT ${installation.version}: ${request.command}`);

	running = new Promise<number>((resolve) => {
		const task = createVRunnerTask({
			name: request.title,
			command,
			cwd: request.cwd,
			definition: { type: EDT_TASK_TYPE, command: request.command },
			exitCallback: resolve,
		});
		void vscode.tasks.executeTask(task);
	});

	try {
		const exitCode = await running;
		if (exitCode !== 0) {
			log.warn(`EDT ${request.command}: код возврата ${exitCode}`);
		}
		return exitCode;
	} finally {
		running = undefined;
	}
}
