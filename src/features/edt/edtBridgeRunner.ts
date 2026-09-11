/**
 * Выполнение шагов моста между проектом 1С:EDT и раннером.
 *
 * Выгрузки идут до команды раннера и по очереди: `1cedtcli` не делит рабочую
 * область. Импорт результата идёт после команды и только если выгрузка
 * получилась: импорт пустого каталога положил бы в проект пустоту.
 *
 * @module edtBridgeRunner
 */

import type { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { resolveProjectLayout, type ProjectLayout } from '../../shared/projectLayout';
import { detachProject, edtProjectName, edtWorkspaceDir, ensureProjectRegistered, runEdtCommand } from './edtRunner';
import {
	designerExternalsUnder,
	EDT_IMPORT_DIR,
	edtBaseProjectOf,
	edtProjectOfExternal,
	withBaseProject,
	type EdtDesignerCopy,
	type EdtExportStep,
	type EdtImportStep,
} from './edtSourceBridge';

const log = logger.scope('edt');

/** Каталоги внешних объектов в выгрузке EDT. */
const EXTERNAL_DIRECTORIES = ['ExternalDataProcessors', 'ExternalReports'];

/** Где идёт команда. */
export interface EdtBridgeContext {
	/** Корень рабочей области VS Code. */
	workspaceRoot: string;
	/** Каталог сборки относительно рабочей области. */
	buildDir: string;
}

/** Проект, который выгружается или принимает выгрузку; каталоги относительно рабочей области либо абсолютные. */
interface ProjectStep {
	projectDir: string;
	baseProjectDir?: string;
}

/**
 * Выполняет шаги перед командой раннера: выгрузки проектов, копии объектов
 * выгрузки конфигуратора и очистку промежуточных каталогов.
 *
 * @param steps - Что сделать
 * @param context - Рабочая область и каталог сборки
 * @returns Удались ли все выгрузки
 */
export async function runEdtExports(steps: readonly EdtExportStep[], context: EdtBridgeContext): Promise<boolean> {
	if (steps.length === 0) {
		return true;
	}
	const workspaceDir = edtWorkspaceDir(context.workspaceRoot, context.buildDir);
	for (const step of steps) {
		if ('clear' in step) {
			await fs.rm(path.resolve(context.workspaceRoot, step.clear), { recursive: true, force: true });
			continue;
		}
		if ('designerSource' in step) {
			await stageDesignerExternals(step, context.workspaceRoot, await resolveProjectLayout(context.workspaceRoot));
			continue;
		}
		const target = path.resolve(context.workspaceRoot, step.target);
		if (!(await exportProject(step, target, workspaceDir, context))) {
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
 * @param context - Рабочая область и каталог сборки
 */
export async function runEdtImports(steps: readonly EdtImportStep[], context: EdtBridgeContext): Promise<void> {
	if (steps.length === 0) {
		return;
	}
	const workspaceDir = edtWorkspaceDir(context.workspaceRoot, context.buildDir);
	for (const step of steps) {
		const source = path.resolve(context.workspaceRoot, step.source);
		const projectDir = path.resolve(context.workspaceRoot, step.projectDir);
		const base = step.baseProjectDir === undefined ? undefined : path.resolve(context.workspaceRoot, step.baseProjectDir);
		if (!(await registerProjects([base], workspaceDir, context))) {
			continue;
		}
		if (step.external) {
			await importExternals(source, projectDir, base, workspaceDir, context);
			continue;
		}
		if (!(await exists(path.join(source, 'Configuration.xml')))) {
			log.warn(`Выгрузка ${step.source} без Configuration.xml, импорт в проект пропущен`);
			void vscode.window.showWarningMessage(`Выгрузки в ${step.source} нет, проект ${step.projectDir} не изменён.`);
			continue;
		}
		const baseArgs = step.needsBase && base !== undefined ? ['--base-project-name', edtProjectName(base)] : [];
		await importProject(source, projectDir, baseArgs, workspaceDir, context);
	}
}

/**
 * Возвращает выгрузки внешних объектов в проекты EDT.
 *
 * Объект, у которого проект уже есть, возвращается в него: проект выгружается
 * целиком, в выгрузке подменяется этот объект, и она импортируется на место
 * проекта. Импорт одной выгрузки заменил бы собой проект с несколькими объектами.
 * Объект без проекта получает новый проект в каталоге проектов.
 *
 * @param source - Каталог с выгрузками, по каталогу `<Имя>/<Имя>.xml` на объект
 * @param container - Каталог, где заводятся новые проекты
 * @param base - Каталог базового проекта, когда у проекта объекта своего нет
 */
async function importExternals(
	source: string,
	container: string,
	base: string | undefined,
	workspaceDir: string,
	context: EdtBridgeContext
): Promise<void> {
	const dumps = await externalDumps(source);
	if (dumps.length === 0) {
		log.warn(`Выгрузок внешних объектов в ${source} нет, проекты не изменены`);
		return;
	}
	const layout = await resolveProjectLayout(context.workspaceRoot);
	const owned = new Map<string, string[]>();
	const orphans: string[] = [];
	for (const name of dumps) {
		const owner = edtProjectOfExternal(layout, name);
		if (owner) {
			owned.set(owner.dir, [...(owned.get(owner.dir) ?? []), name]);
		} else {
			orphans.push(name);
		}
	}
	const configurations = [...(layout.configuration ? [layout.configuration] : []), ...layout.others]
		.filter((root) => root.format === 'edt')
		.map((root) => root.dir);

	for (const [projectDir, names] of owned) {
		const baseProjectDir = edtBaseProjectOf(projectDir, { configurations, projectName: edtProjectName, active: base });
		const merged = path.resolve(context.workspaceRoot, context.buildDir, EDT_IMPORT_DIR, path.basename(projectDir));
		if (!(await exportProject({ projectDir, baseProjectDir }, merged, workspaceDir, context))) {
			void vscode.window.showWarningMessage(`Выгрузка проекта ${edtProjectName(projectDir)} не удалась, объекты ${names.join(', ')} в него не вернулись.`);
			continue;
		}
		await flattenExternalExport(merged);
		for (const name of names) {
			await replaceExternalObject(merged, path.join(source, name), name);
		}
		const code = await importProject(merged, projectDir, [], workspaceDir, context);
		if (code === 0 && baseProjectDir !== undefined) {
			await writeBaseProject(projectDir, edtProjectName(baseProjectDir));
		}
	}
	for (const name of orphans) {
		const target = path.join(container, name);
		const code = await importProject(path.join(source, name), target, [], workspaceDir, context);
		if (code === 0 && base !== undefined) {
			await writeBaseProject(target, edtProjectName(base));
		}
	}
}

/**
 * Выгружает проект в формат конфигуратора; прошлая выгрузка убирается целиком,
 * иначе удалённый объект остался бы в ней.
 *
 * @returns Удалась ли выгрузка
 */
async function exportProject(step: ProjectStep, target: string, workspaceDir: string, context: EdtBridgeContext): Promise<boolean> {
	if (!(await registerProjects([step.baseProjectDir, step.projectDir], workspaceDir, context))) {
		return false;
	}
	await fs.rm(target, { recursive: true, force: true });
	const name = edtProjectName(path.resolve(context.workspaceRoot, step.projectDir));
	const code = await runEdtCommand({
		command: 'export',
		args: ['--project-name', name, '--configuration-files', target],
		title: `EDT: выгрузка ${name}`,
		workspaceDir,
		cwd: context.workspaceRoot,
	});
	return code === 0;
}

/**
 * Импортирует выгрузку в проект. Подключённый проект EDT выгрузкой не обновляет,
 * поэтому перед импортом он отключается от рабочей области.
 *
 * @returns Код возврата импорта
 */
async function importProject(
	source: string,
	projectDir: string,
	baseArgs: readonly string[],
	workspaceDir: string,
	context: EdtBridgeContext
): Promise<number> {
	const detached = await detachProject(projectDir, workspaceDir, context.workspaceRoot);
	if (detached !== 0) {
		return detached;
	}
	return runEdtCommand({
		command: 'import',
		args: ['--configuration-files', source, '--project', projectDir, ...baseArgs],
		title: `EDT: импорт в ${edtProjectName(projectDir)}`,
		workspaceDir,
		cwd: context.workspaceRoot,
	});
}

/** Вписывает базовый проект в манифест проекта внешнего объекта. */
async function writeBaseProject(projectDir: string, baseProject: string): Promise<void> {
	const manifest = path.join(projectDir, 'DT-INF', 'PROJECT.PMF');
	let text: string;
	try {
		text = await fs.readFile(manifest, 'utf8');
	} catch {
		return;
	}
	const patched = withBaseProject(text, baseProject);
	if (patched !== text) {
		await fs.writeFile(manifest, patched, 'utf8');
	}
}

/**
 * Подключает проекты по порядку: базовый раньше расширения и внешних объектов,
 * которые ссылаются на него по имени.
 *
 * @param dirs - Каталоги проектов относительно рабочей области либо абсолютные
 * @returns Подключились ли все
 */
async function registerProjects(
	dirs: readonly (string | undefined)[],
	workspaceDir: string,
	context: EdtBridgeContext
): Promise<boolean> {
	for (const dir of dirs) {
		if (dir === undefined) {
			continue;
		}
		if ((await ensureProjectRegistered(path.resolve(context.workspaceRoot, dir), workspaceDir, context.workspaceRoot)) !== 0) {
			return false;
		}
	}
	return true;
}

/**
 * Кладёт в промежуточный каталог объекты выгрузки конфигуратора из каталога
 * исходников команды: по каталогу объекта на каждый, как их держит раннер.
 *
 * @returns Каталоги объектов в промежуточном каталоге
 */
export async function stageDesignerExternals(
	step: EdtDesignerCopy,
	workspaceRoot: string,
	layout: ProjectLayout
): Promise<string[]> {
	const target = path.resolve(workspaceRoot, step.target);
	const copied: string[] = [];
	for (const root of designerExternalsUnder(layout, workspaceRoot, step.designerSource)) {
		const destination = path.join(target, path.basename(root.dir));
		await fs.rm(destination, { recursive: true, force: true });
		await fs.cp(root.dir, destination, { recursive: true });
		copied.push(destination);
	}
	return copied;
}

/**
 * Перекладывает выгрузку внешних объектов в раскладку раннера.
 *
 * EDT пишет `ExternalDataProcessors/<Имя>.xml`, раннер и конфигуратор держат
 * описание в корне каталога объекта: `<Имя>.xml` и `<Имя>/` рядом.
 *
 * @param target - Каталог выгрузки
 * @param only - Имя объекта, когда нужен он один; остальные из выгрузки убираются
 * @returns Имена переложенных объектов
 */
export async function flattenExternalExport(target: string, only?: string): Promise<string[]> {
	const names: string[] = [];
	for (const kind of EXTERNAL_DIRECTORIES) {
		const directory = path.join(target, kind);
		let entries: Dirent[];
		try {
			entries = await fs.readdir(directory, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.xml')) {
				continue;
			}
			const name = entry.name.slice(0, -'.xml'.length);
			if (only !== undefined && name !== only) {
				continue;
			}
			await fs.rename(path.join(directory, entry.name), path.join(target, entry.name));
			const nested = path.join(directory, name);
			if (await exists(nested)) {
				await fs.rename(nested, path.join(target, name));
			}
			names.push(name);
		}
		await fs.rm(directory, { recursive: true, force: true });
	}
	return names;
}

/**
 * Подменяет объект в выгрузке проекта его новой выгрузкой: описание `<Имя>.xml`
 * и каталог `<Имя>` рядом с ним.
 *
 * @param exportDir - Выгрузка проекта в раскладке раннера
 * @param dumpDir - Каталог с новой выгрузкой объекта
 * @param name - Имя объекта
 */
export async function replaceExternalObject(exportDir: string, dumpDir: string, name: string): Promise<void> {
	for (const entry of [`${name}.xml`, name]) {
		const destination = path.join(exportDir, entry);
		await fs.rm(destination, { recursive: true, force: true });
		const source = path.join(dumpDir, entry);
		if (await exists(source)) {
			await fs.cp(source, destination, { recursive: true });
		}
	}
}

/** Каталоги выгрузок внешних объектов: у каждого своё описание по имени каталога. */
async function externalDumps(source: string): Promise<string[]> {
	let entries: Dirent[];
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
