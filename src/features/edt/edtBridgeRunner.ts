/**
 * Выполнение шагов моста между проектом 1С:EDT и раннером.
 *
 * Выгрузки идут до команды раннера и по очереди: `1cedtcli` не делит рабочую
 * область. Импорт результата идёт после команды и только если выгрузка
 * получилась: импорт пустого каталога положил бы в проект пустоту.
 *
 * @module edtBridgeRunner
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { edtProjectName, edtWorkspaceDir, ensureProjectRegistered, runEdtCommand } from './edtRunner';
import type { EdtExportStep, EdtImportStep } from './edtSourceBridge';

const log = logger.scope('edt');

/** Каталоги внешних объектов в выгрузке EDT. */
const EXTERNAL_DIRECTORIES = ['ExternalDataProcessors', 'ExternalReports'];

/** Где идёт команда. */
export interface EdtBridgeContext {
	/** Корень рабочей области VS Code. */
	workspaceRoot: string;
	/** Каталог сборки относительно рабочей области. */
	buildDir: string;
	/** Каталог проекта активной конфигурации: базовый проект расширений и внешних объектов. */
	baseProjectDir?: string;
}

/**
 * Выгружает проекты в формат конфигуратора.
 *
 * @param steps - Что выгрузить
 * @param context - Рабочая область и базовый проект
 * @returns Удались ли все выгрузки
 */
export async function runEdtExports(steps: readonly EdtExportStep[], context: EdtBridgeContext): Promise<boolean> {
	if (steps.length === 0) {
		return true;
	}
	const workspaceDir = edtWorkspaceDir(context.workspaceRoot, context.buildDir);
	if (!(await registerBase(context, workspaceDir))) {
		return false;
	}
	for (const step of steps) {
		const projectDir = path.resolve(context.workspaceRoot, step.projectDir);
		const target = path.resolve(context.workspaceRoot, step.target);
		if ((await ensureProjectRegistered(projectDir, workspaceDir, context.workspaceRoot)) !== 0) {
			return false;
		}
		// Прошлая выгрузка убирается целиком: удалённый объект иначе остался бы в ней
		await fs.rm(target, { recursive: true, force: true });
		const name = edtProjectName(projectDir);
		const code = await runEdtCommand({
			command: 'export',
			args: ['--project-name', name, '--configuration-files', target],
			title: `EDT: выгрузка ${name}`,
			workspaceDir,
			cwd: context.workspaceRoot,
		});
		if (code !== 0) {
			return false;
		}
		if (step.externalName) {
			await flattenExternalExport(target, step.externalName);
		}
	}
	return true;
}

/**
 * Импортирует результат команды обратно в проекты EDT.
 *
 * @param steps - Что импортировать
 * @param context - Рабочая область и базовый проект
 */
export async function runEdtImports(steps: readonly EdtImportStep[], context: EdtBridgeContext): Promise<void> {
	if (steps.length === 0) {
		return;
	}
	const workspaceDir = edtWorkspaceDir(context.workspaceRoot, context.buildDir);
	if (!(await registerBase(context, workspaceDir))) {
		return;
	}
	const base =
		context.baseProjectDir !== undefined ? ['--base-project-name', edtProjectName(context.baseProjectDir)] : [];
	for (const step of steps) {
		const source = path.resolve(context.workspaceRoot, step.source);
		const projectDir = path.resolve(context.workspaceRoot, step.projectDir);
		const baseArgs = step.needsBase ? base : [];
		if (step.external) {
			for (const name of await externalDumps(source)) {
				await runEdtCommand({
					command: 'import',
					args: ['--configuration-files', path.join(source, name), '--project', path.join(projectDir, name), ...baseArgs],
					title: `EDT: импорт ${name}`,
					workspaceDir,
					cwd: context.workspaceRoot,
				});
			}
			continue;
		}
		if (!(await exists(path.join(source, 'Configuration.xml')))) {
			log.warn(`Выгрузка ${step.source} без Configuration.xml, импорт в проект пропущен`);
			void vscode.window.showWarningMessage(`Выгрузки в ${step.source} нет, проект ${step.projectDir} не изменён.`);
			continue;
		}
		await runEdtCommand({
			command: 'import',
			args: ['--configuration-files', source, '--project', projectDir, ...baseArgs],
			title: `EDT: импорт в ${edtProjectName(projectDir)}`,
			workspaceDir,
			cwd: context.workspaceRoot,
		});
	}
}

/** Базовый проект подключается первым: расширения и внешние объекты ссылаются на него по имени. */
async function registerBase(context: EdtBridgeContext, workspaceDir: string): Promise<boolean> {
	if (context.baseProjectDir === undefined) {
		return true;
	}
	return (await ensureProjectRegistered(context.baseProjectDir, workspaceDir, context.workspaceRoot)) === 0;
}

/**
 * Перекладывает выгрузку внешнего объекта в раскладку раннера.
 *
 * EDT пишет `ExternalDataProcessors/<Имя>.xml`, раннер и конфигуратор держат
 * описание в корне каталога объекта: `<Имя>/<Имя>.xml`.
 */
async function flattenExternalExport(target: string, name: string): Promise<void> {
	for (const kind of EXTERNAL_DIRECTORIES) {
		const directory = path.join(target, kind);
		const descriptor = path.join(directory, `${name}.xml`);
		if (!(await exists(descriptor))) {
			continue;
		}
		await fs.rename(descriptor, path.join(target, `${name}.xml`));
		const nested = path.join(directory, name);
		if (await exists(nested)) {
			await fs.rename(nested, path.join(target, name));
		}
		await fs.rm(directory, { recursive: true, force: true });
		return;
	}
}

/** Каталоги выгрузок внешних объектов: у каждого своё описание по имени каталога. */
async function externalDumps(source: string): Promise<string[]> {
	let entries: import('node:fs').Dirent[];
	try {
		entries = await fs.readdir(source, { withFileTypes: true });
	} catch {
		return [];
	}
	const names: string[] = [];
	for (const entry of entries) {
		if (entry.isDirectory() && (await exists(path.join(source, entry.name, `${entry.name}.xml`)))) {
			names.push(entry.name);
		}
	}
	return names;
}

async function exists(target: string): Promise<boolean> {
	try {
		await fs.access(target);
		return true;
	} catch {
		return false;
	}
}
