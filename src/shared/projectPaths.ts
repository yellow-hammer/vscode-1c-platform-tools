/**
 * Пути раскладки для инструментов: относительно рабочей области, с прямыми
 * разделителями, как их принимает vanessa-runner.
 *
 * Источник один, раскладка проекта: настроек каталогов исходного кода нет.
 * Команде, которая работает сразу со всеми расширениями или обработками выгрузки
 * конфигуратора, отдаётся их общий каталог; проекты EDT идут по одному.
 *
 * @module projectPaths
 */

import * as path from 'node:path';
import { configurationScope } from './activeConfiguration';
import { DEFAULT_PATHS, TESTS_SUBDIRS, testsSubPath } from './pathDefaults';
import {
	commonParent,
	resolveProjectLayout,
	testsDirectoryName,
	type ExternalKind,
	type SourceFormat,
} from './projectLayout';

/**
 * Привычные места исходного кода: куда класть то, чего в рабочей области ещё нет.
 *
 * Команды чтения ими не пользуются: без найденного исходного кода они отвечают
 * сообщением. Их место у команд, которые исходный код создают: разборка cf, cfe и
 * epf, выгрузка из базы в пустой проект, новое расширение.
 */
export const CONVENTIONAL_PATHS = {
	cf: DEFAULT_PATHS.cf,
	cfe: DEFAULT_PATHS.cfe,
	epf: DEFAULT_PATHS.epf,
	erf: DEFAULT_PATHS.erf,
	/** Каталог тестов: имя из настроек. */
	get tests(): string {
		return testsDirectoryName();
	},
	get testsCfe(): string {
		return testsSubPath(testsDirectoryName(), TESTS_SUBDIRS.cfe);
	},
	get testsEpf(): string {
		return testsSubPath(testsDirectoryName(), TESTS_SUBDIRS.epf);
	},
} as const;

/** Корень исходного кода относительно рабочей области. */
export interface RelativeRoot {
	name: string;
	/** Каталог с прямыми разделителями; `.`, когда корень совпадает с рабочей областью. */
	dir: string;
	format: SourceFormat;
}

/** Внешняя обработка или отчёт относительно рабочей области. */
export interface RelativeExternal extends RelativeRoot {
	kind: ExternalKind;
}

/** Пути активной конфигурации, её расширений и внешних объектов. */
export interface ProjectPaths {
	configuration?: RelativeRoot;
	/** Расширения решения. */
	extensions: RelativeRoot[];
	/** Тестовые расширения: под каталогом тестов. */
	testExtensions: RelativeRoot[];
	/** Общий каталог расширений выгрузки конфигуратора; у проектов EDT его нет. */
	extensionsContainer?: string;
	testExtensionsContainer?: string;
	processors: RelativeExternal[];
	reports: RelativeExternal[];
	/** Тестовые обработки и отчёты: под каталогом тестов. */
	testProcessors: RelativeExternal[];
	/** Общий каталог обработок; у проектов EDT это каталог проектов, в том числе `.`. */
	processorsContainer?: string;
	reportsContainer?: string;
	testProcessorsContainer?: string;
}

/**
 * Путь в записи раннера: относительно рабочей области, прямые разделители.
 *
 * @returns `.` для самой рабочей области
 */
export function runnerPath(workspaceRoot: string, absolute: string): string {
	const relative = path.relative(workspaceRoot, absolute).split(path.sep).join('/');
	return relative.length > 0 ? relative : '.';
}

/** Путь в записи раннера лежит внутри рабочей области. */
function insideWorkspace(relative: string): boolean {
	return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Общий каталог корней относительно рабочей области; сама рабочая область каталогом не считается. */
function container(workspaceRoot: string, roots: ReadonlyArray<{ dir: string }>): string | undefined {
	const parent = commonParent(roots);
	if (parent === undefined) {
		return undefined;
	}
	const relative = runnerPath(workspaceRoot, parent);
	return relative !== '.' && insideWorkspace(relative) ? relative : undefined;
}

/** Каталоги выгрузки конфигуратора: у расширений EDT базой служит корень рабочей области. */
function designerOnly<T extends { format: SourceFormat }>(roots: ReadonlyArray<T>): T[] {
	return roots.filter((root) => root.format === 'designer');
}

/**
 * Каталог внешних объектов: у выгрузки конфигуратора общий каталог объектов, у
 * проектов EDT общий каталог проектов. Команда получает каталог целиком, а
 * проекты выгружает сама EDT, поэтому смешанной рабочей области хватает выгрузки.
 *
 * Проекты EDT принято класть прямо в рабочую область, поэтому их каталогом
 * бывает она сама. Проект, открытый как рабочая область, сам себе каталог.
 */
function externalContainer(
	workspaceRoot: string,
	roots: ReadonlyArray<{ dir: string; format: SourceFormat }>
): string | undefined {
	const designer = designerOnly(roots);
	if (designer.length > 0) {
		return container(workspaceRoot, designer);
	}
	const parent = commonParent(roots);
	if (parent === undefined) {
		return undefined;
	}
	const relative = runnerPath(workspaceRoot, parent);
	if (insideWorkspace(relative)) {
		return relative;
	}
	const projects = new Set(roots.map((root) => path.resolve(root.dir)));
	return projects.size === 1 ? runnerPath(workspaceRoot, [...projects][0]) : undefined;
}

/**
 * Пути раскладки рабочей области.
 *
 * Конфигурация и расширения берутся у активной конфигурации, внешние объекты у
 * всей рабочей области: они к конфигурации не привязаны.
 *
 * @param workspaceRoot - Корень рабочей области
 */
export async function projectPaths(workspaceRoot: string): Promise<ProjectPaths> {
	const [scope, layout] = await Promise.all([configurationScope(workspaceRoot), resolveProjectLayout(workspaceRoot)]);
	const relative = <T extends { dir: string }>(root: T): T => ({ ...root, dir: runnerPath(workspaceRoot, root.dir) });
	const roots = (items: ReadonlyArray<{ name: string; dir: string; format: SourceFormat }>): RelativeRoot[] =>
		items.map((root) => relative({ name: root.name, dir: root.dir, format: root.format }));
	const externals = (items: typeof layout.processors): RelativeExternal[] =>
		items.map((root) => relative({ name: root.name, dir: root.dir, format: root.format, kind: root.kind }));

	return {
		configuration: scope.configuration
			? relative({ name: scope.configuration.name, dir: scope.configuration.dir, format: scope.configuration.format })
			: undefined,
		extensions: roots(scope.extensions),
		testExtensions: roots(scope.testExtensions),
		extensionsContainer: container(workspaceRoot, designerOnly(scope.extensions)),
		testExtensionsContainer: container(workspaceRoot, designerOnly(scope.testExtensions)),
		processors: externals(layout.processors),
		reports: externals(layout.reports),
		testProcessors: externals(layout.testProcessors),
		processorsContainer: externalContainer(workspaceRoot, layout.processors),
		reportsContainer: externalContainer(workspaceRoot, layout.reports),
		testProcessorsContainer: externalContainer(workspaceRoot, layout.testProcessors),
	};
}
