/**
 * Команды 1С:EDT над проектом.
 *
 * Всё, что здесь есть, выполняет сама EDT через `1cedtcli`, поэтому команды
 * работают независимо от версии vanessa-runner. Проект берётся у активной
 * конфигурации: спрашивать его каждый раз незачем.
 *
 * @module edtCommands
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { configurationScope } from '../../shared/activeConfiguration';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { logger } from '../../shared/logger';
import {
	edtProjectName,
	edtWorkspaceDir,
	ensureProjectRegistered,
	readEdtSettings,
	resolveEdt,
	runEdtCommand,
} from './edtRunner';
import { showValidationFindings } from './edtDiagnostics';
import { buildCommand, detectShellType } from '../../utils/commandUtils';
import { createVRunnerTask } from '../tasks/vrunnerTask';

const log = logger.scope('edt');

/** Проект EDT, над которым идёт работа. */
interface EdtTarget {
	/** Корень рабочей области VS Code. */
	workspaceRoot: string;
	/** Полный путь к каталогу проекта. */
	projectPath: string;
	/** Каталог проекта относительно рабочей области. */
	projectDir: string;
	/** Имя проекта: каталог, как его видит EDT. */
	projectName: string;
	/** Каталог рабочей области EDT. */
	workspaceDir: string;
}

/**
 * Проект активной конфигурации, если она в формате EDT.
 *
 * @param requireEdt - Требовать формат EDT: команды над проектом без него бессмысленны
 */
async function edtTarget(requireEdt = true): Promise<EdtTarget | undefined> {
	const vrunner = VRunnerManager.getInstance();
	const workspaceRoot = vrunner.getWorkspaceRoot();
	if (!workspaceRoot) {
		void vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
		return undefined;
	}

	const scope = await configurationScope(workspaceRoot, {
		configuration: vrunner.getCfPath(),
		extensions: [vrunner.getCfePath(), vrunner.getTestsCfePath()],
	});
	const configuration = scope.configuration;
	if (!configuration) {
		void vscode.window.showErrorMessage('В рабочей области нет исходников конфигурации.');
		return undefined;
	}
	if (requireEdt && configuration.format !== 'edt') {
		void vscode.window.showErrorMessage(
			'Команда работает с проектом EDT, а активная конфигурация в формате конфигуратора.'
		);
		return undefined;
	}

	return {
		workspaceRoot,
		projectPath: configuration.dir,
		projectDir: path.relative(workspaceRoot, configuration.dir) || '.',
		projectName: edtProjectName(configuration.dir),
		workspaceDir: edtWorkspaceDir(workspaceRoot, vrunner.getOutPath()),
	};
}

/**
 * Импортирует выгрузку конфигуратора в проект EDT вместе с расширениями.
 *
 * Расширения импортируются после конфигурации и с указанием базового проекта:
 * без него EDT примет расширение за самостоятельную конфигурацию. Проект
 * расширения принято называть по конфигурации с точкой - так же, как это
 * делает сама EDT.
 */
export async function importToEdt(): Promise<void> {
	const target = await edtTarget(false);
	if (!target) {
		return;
	}

	const vrunner = VRunnerManager.getInstance();
	const sources = path.join(target.workspaceRoot, vrunner.getCfPath());
	const projectName = await vscode.window.showInputBox({
		title: 'Импорт в проект EDT',
		prompt: 'Имя проекта EDT',
		value: path.basename(target.workspaceRoot),
	});
	if (!projectName) {
		return;
	}

	const configurationImport = await runEdtCommand({
		command: 'import',
		args: ['--configuration-files', sources, '--project-name', projectName],
		title: `EDT: импорт в проект ${projectName}`,
		workspaceDir: target.workspaceDir,
		cwd: target.workspaceRoot,
	});
	if (configurationImport !== 0) {
		return;
	}

	const extensions = await extensionSources(target.workspaceRoot);
	for (const extension of extensions) {
		await runEdtCommand({
			command: 'import',
			args: [
				'--configuration-files',
				extension.dir,
				'--project-name',
				`${projectName}.${extension.name}`,
				'--base-project-name',
				projectName,
			],
			title: `EDT: импорт расширения ${extension.name}`,
			workspaceDir: target.workspaceDir,
			cwd: target.workspaceRoot,
		});
	}
}

/**
 * Каталоги расширений активной конфигурации с их именами из метаданных.
 */
async function extensionSources(workspaceRoot: string): Promise<{ name: string; dir: string }[]> {
	const vrunner = VRunnerManager.getInstance();
	const scope = await configurationScope(workspaceRoot, {
		configuration: vrunner.getCfPath(),
		extensions: [vrunner.getCfePath(), vrunner.getTestsCfePath()],
	});
	return scope.extensions.map((extension) => ({
		name: extension.name || path.basename(extension.dir),
		dir: extension.dir,
	}));
}

/**
 * Выгружает проект EDT в формат конфигуратора.
 */
export async function exportFromEdt(): Promise<void> {
	const target = await edtTarget();
	if (!target) {
		return;
	}

	const vrunner = VRunnerManager.getInstance();
	const defaultOut = path.join(target.workspaceRoot, vrunner.getOutPath(), 'cf-designer');
	const out = await vscode.window.showInputBox({
		title: 'Выгрузка проекта EDT',
		prompt: 'Каталог для выгрузки в формате конфигуратора',
		value: defaultOut,
	});
	if (!out) {
		return;
	}

	if ((await ensureProjectRegistered(target.projectPath, target.workspaceDir, target.workspaceRoot)) !== 0) {
		return;
	}

	await runEdtCommand({
		command: 'export',
		args: ['--project-name', target.projectName, '--configuration-files', out],
		title: `EDT: выгрузка ${target.projectName}`,
		workspaceDir: target.workspaceDir,
		cwd: target.workspaceRoot,
	});
}

/**
 * Проверяет проект средствами EDT.
 *
 * Результат пишется в TSV: файл открывается по завершении, чтобы ошибки было
 * видно сразу.
 */
export async function validateEdtProject(): Promise<void> {
	const target = await edtTarget();
	if (!target) {
		return;
	}

	const vrunner = VRunnerManager.getInstance();
	const report = path.join(target.workspaceRoot, vrunner.getOutPath(), 'edt-validate.tsv');

	if ((await ensureProjectRegistered(target.projectPath, target.workspaceDir, target.workspaceRoot)) !== 0) {
		return;
	}

	// Старый отчёт убираем: иначе после неудачной проверки в Problems осталась
	// бы прошлая картина, неотличимая от свежей
	await fs.rm(report, { force: true });

	await runEdtCommand({
		command: 'validate',
		args: ['--file', report, '--project-name-list', target.projectName],
		title: `EDT: проверка ${target.projectName}`,
		workspaceDir: target.workspaceDir,
		cwd: target.workspaceRoot,
	});

	// Замечания показываем в Problems: отчёт из проверки приходит таблицей
	await showValidationFindings(report, target.projectPath);
}

/**
 * Форматирует модули проекта по правилам EDT.
 */
export async function formatEdtModules(): Promise<void> {
	const target = await edtTarget();
	if (!target) {
		return;
	}

	if ((await ensureProjectRegistered(target.projectPath, target.workspaceDir, target.workspaceRoot)) !== 0) {
		return;
	}

	await runEdtCommand({
		command: 'format-modules',
		args: ['--project-name', target.projectName],
		title: `EDT: форматирование модулей ${target.projectName}`,
		workspaceDir: target.workspaceDir,
		cwd: target.workspaceRoot,
	});
}

/**
 * Сортирует объекты конфигурации по настройкам автоматической сортировки.
 */
export async function sortEdtProject(): Promise<void> {
	const target = await edtTarget();
	if (!target) {
		return;
	}

	if ((await ensureProjectRegistered(target.projectPath, target.workspaceDir, target.workspaceRoot)) !== 0) {
		return;
	}

	await runEdtCommand({
		command: 'sort-project',
		args: ['--project-name-list', target.projectName],
		title: `EDT: сортировка объектов ${target.projectName}`,
		workspaceDir: target.workspaceDir,
		cwd: target.workspaceRoot,
	});
}

/**
 * Показывает сведения о проекте: версия платформы, состав, зависимости.
 */
export async function showEdtProjectInfo(): Promise<void> {
	const target = await edtTarget();
	if (!target) {
		return;
	}

	if ((await ensureProjectRegistered(target.projectPath, target.workspaceDir, target.workspaceRoot)) !== 0) {
		return;
	}

	await runEdtCommand({
		command: 'project-info',
		args: [target.projectName],
		title: `EDT: сведения о проекте ${target.projectName}`,
		workspaceDir: target.workspaceDir,
		cwd: target.workspaceRoot,
	});
}

/**
 * Открывает рабочую область проекта в графической 1С:EDT.
 */
export async function openInEdt(): Promise<void> {
	const target = await edtTarget(false);
	if (!target) {
		return;
	}

	const installation = resolveEdt(readEdtSettings());
	if (!installation?.gui) {
		void vscode.window.showErrorMessage(
			'Графический клиент 1С:EDT не найден рядом с 1cedtcli: проверьте настройку каталога установки.'
		);
		return;
	}

	// Задача живёт, пока открыта сама EDT: закрытие редактора завершает и её
	const task = createVRunnerTask({
		name: `EDT ${installation.version}`,
		command: buildCommand(installation.gui, ['-data', target.workspaceDir], detectShellType()),
		cwd: target.workspaceRoot,
		definition: { type: '1c-edt', command: 'open' },
	});
	await vscode.tasks.executeTask(task);
	log.info(`Открываю EDT ${installation.version}: ${target.workspaceDir}`);
}
