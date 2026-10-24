/**
 * Список проектов и выбор текущего проекта для агента и команд.
 * @module projects/projectList
 */

import type { StructuredCommandResult } from '../../shared/commandExecutionTypes';
import type { ProjectKind } from '../../shared/projectKind';
import type { SourceFormat } from '../../shared/projectLayout';
import { readProjectLaunch, type ProjectLaunch } from '../../shared/projectState';
import {
	projectDisplayName,
	type ProjectCandidateKind,
	type WorkspaceProject,
	type WorkspaceProjectsSnapshot,
} from '../../shared/workspaceProjects';
import { candidateName, isCurrentProject } from './projectPresentation';
import type { WorkspaceProjectsSource } from './workspaceProjectsSource';

/** Проект в списке. */
export interface ProjectListEntry {
	root: string;
	name: string;
	parent?: string;
	subProject: boolean;
	/** Вид проекта; нет, пока обнаружение не закончено. */
	kind?: ProjectKind;
	format?: SourceFormat;
	configuration?: string;
	current: boolean;
	/** Именованный профиль запуска */
	profile?: string;
	/** Выбранное окружение */
	environment?: string;
}

/** Не проект в списке. */
export interface ProjectCandidateEntry {
	root: string;
	name: string;
	parent?: string;
	kind: ProjectCandidateKind;
}

/** Данные `project.list`. */
export interface ProjectListData {
	current?: string;
	projects: ProjectListEntry[];
	candidates: ProjectCandidateEntry[];
}

/** Данные `project.select`. */
export interface ProjectSelectionData {
	current?: string;
	projects: string[];
}

/** Результат команды проектов с данными. */
export interface ProjectCommandResult<T> extends StructuredCommandResult {
	data: T;
}

/**
 * Проекты и не проекты окна.
 *
 * @param snapshot - Найденное
 * @param selectedRoot - Выбранный корень
 * @param launchOf - Именованный профиль и окружение проекта
 */
export function buildProjectList(
	snapshot: WorkspaceProjectsSnapshot,
	selectedRoot: string | undefined,
	launchOf: (root: string) => ProjectLaunch = readProjectLaunch
): ProjectListData {
	const projects = snapshot.projects.map((project): ProjectListEntry => {
		const entry: ProjectListEntry = {
			root: project.root,
			name: projectDisplayName(project, snapshot.projects),
			subProject: project.subProject,
			current: isCurrentProject(project, selectedRoot),
		};
		if (project.parent !== undefined) {
			entry.parent = project.parent;
		}
		if (project.kind) {
			entry.kind = project.kind;
		}
		if (project.configuration) {
			entry.format = project.configuration.format;
			if (project.configuration.name) {
				entry.configuration = project.configuration.name;
			}
		}
		const { profile, environment } = launchOf(project.root);
		if (profile) {
			entry.profile = profile;
		}
		if (environment) {
			entry.environment = environment;
		}
		return entry;
	});
	const candidates = snapshot.candidates.map((candidate): ProjectCandidateEntry => {
		const entry: ProjectCandidateEntry = { root: candidate.root, name: candidateName(candidate), kind: candidate.kind };
		if (candidate.parent !== undefined) {
			entry.parent = candidate.parent;
		}
		return entry;
	});
	return { current: selectedRoot, projects, candidates };
}

function success<T>(data: T): ProjectCommandResult<T> {
	return { success: true, exitCode: 0, stdout: '', stderr: '', data };
}

/** Отказ команды проектов. */
export function failure<T>(message: string, data: T): ProjectCommandResult<T> {
	return { success: false, exitCode: 1, stdout: '', stderr: message, data };
}

/**
 * Список проектов после полного обнаружения.
 *
 * @param source - Проекты окна
 * @param launchOf - Именованный профиль и окружение проекта
 */
export async function listProjectsResult(
	source: WorkspaceProjectsSource,
	launchOf?: (root: string) => ProjectLaunch
): Promise<ProjectCommandResult<ProjectListData>> {
	await Promise.all([source.listProjects(), source.listCandidates()]);
	return success(buildProjectList(source.snapshotNow(), source.selectedRoot(), launchOf));
}

function projectsText(projects: readonly WorkspaceProject[]): string {
	if (projects.length === 0) {
		return 'В рабочей области нет проектов.';
	}
	return `Проекты рабочей области:\n${projects.map((project) => `${projectDisplayName(project, projects)}: ${project.root}`).join('\n')}`;
}

/**
 * Отказ выбора с перечнем проектов.
 *
 * @param message - Причина
 * @param source - Проекты окна
 */
export async function selectionFailure(
	message: string,
	source: WorkspaceProjectsSource
): Promise<ProjectCommandResult<ProjectSelectionData>> {
	const projects = await source.listProjects();
	return failure(`${message} ${projectsText(projects)}`, {
		current: source.selectedRoot(),
		projects: projects.map((project) => project.root),
	});
}

/**
 * Делает проект текущим по корню.
 *
 * @param source - Проекты окна
 * @param root - Корень проекта
 */
export async function selectProjectByRoot(
	source: WorkspaceProjectsSource,
	root: string
): Promise<ProjectCommandResult<ProjectSelectionData>> {
	if (!(await source.selectProject(root))) {
		return selectionFailure(`Проект не найден: ${root}.`, source);
	}
	const projects = await source.listProjects();
	return success({ current: source.selectedRoot(), projects: projects.map((project) => project.root) });
}
