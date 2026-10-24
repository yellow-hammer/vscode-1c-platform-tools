/**
 * Подписи проектов для панелей, окна выбора и строки состояния.
 * @module projects/projectPresentation
 */

import * as path from 'node:path';
import { SOURCE_FORMAT_LABELS } from '../../shared/activeConfiguration';
import { PROJECT_KIND_LABELS } from '../../shared/projectKind';
import type { SourceRoot } from '../../shared/projectLayout';
import {
	isFolderRootProject,
	packagedefTargetDir,
	projectDisplayName,
	sameProjectRoot,
	type ProjectCandidate,
	type WorkspaceProject,
} from '../../shared/workspaceProjects';

const SEPARATOR = ' · ';

/** Проект текущий: корень выбора совпадает с корнем проекта. */
export function isCurrentProject(project: WorkspaceProject, selectedRoot: string | undefined): boolean {
	return selectedRoot !== undefined && sameProjectRoot(project.root, selectedRoot);
}

/** Относительный путь через `/`. */
function relativeLocation(from: string, to: string): string {
	return path.relative(from, to).split(path.sep).join('/');
}

/** Проекты в корне папок рабочей области, затем найденные внутри папок; порядок внутри частей прежний. */
export function folderRootProjectsFirst<T extends WorkspaceProject>(projects: readonly T[]): T[] {
	return [...projects.filter(isFolderRootProject), ...projects.filter((project) => !isFolderRootProject(project))];
}

/**
 * Каталог проекта, найденного обходом в папке без `packagedef`, от каталога над
 * папкой рабочей области: `папка/fixtures` у `папка/fixtures/проект`. У проекта в
 * корне папки и у подпроекта его нет.
 */
export function nestedProjectLocation(project: WorkspaceProject): string | undefined {
	return project.subProject || isFolderRootProject(project)
		? undefined
		: relativeLocation(path.dirname(project.folder), path.dirname(project.root));
}

/** Формат и имя конфигурации. */
export function configurationParts(configuration: SourceRoot | undefined): string[] {
	if (!configuration) {
		return [];
	}
	return [SOURCE_FORMAT_LABELS[configuration.format], configuration.name].filter((part) => part.length > 0);
}

/** Формат и имя конфигурации проекта, а без конфигурации его вид. */
function projectKindParts(project: WorkspaceProject): string[] {
	if (project.configuration) {
		return configurationParts(project.configuration);
	}
	return project.kind ? [PROJECT_KIND_LABELS[project.kind]] : [];
}

/** Что добавить в описание строки проекта. */
export interface ProjectDescriptionDetails {
	/** Путь подпроекта от корневого проекта или {@link nestedProjectLocation}. */
	location?: string;
	/** Именованный профиль запуска. */
	profile?: string;
	/** Выбранное окружение. */
	environment?: string;
}

/**
 * Описание строки проекта: «текущий», путь от корневого проекта, формат и
 * конфигурация или вид проекта, именованный профиль и окружение.
 *
 * @param project - Проект
 * @param current - Проект текущий
 * @param details - Путь, профиль и окружение
 */
export function projectDescription(project: WorkspaceProject, current: boolean, details: ProjectDescriptionDetails = {}): string {
	return [
		...(current ? ['текущий'] : []),
		...(details.location ? [details.location] : []),
		...projectKindParts(project),
		...(details.profile ? [`профиль: ${details.profile}`] : []),
		...(details.environment ? [`окружение: ${details.environment}`] : []),
	].join(SEPARATOR);
}

/** Подсказка проекта: путь, формат и конфигурация или вид проекта. */
export function projectTooltip(project: WorkspaceProject): string {
	const lines = [project.root];
	if (project.configuration) {
		lines.push(`Формат: ${SOURCE_FORMAT_LABELS[project.configuration.format]}`);
		if (project.configuration.name) {
			lines.push(`Конфигурация: ${project.configuration.name}`);
		}
	} else if (project.kind) {
		lines.push(`Вид: ${PROJECT_KIND_LABELS[project.kind]}`);
	}
	return lines.join('\n');
}

/** Имя не проекта для показа: совпадающие имена различаются. */
export function candidateName(candidate: ProjectCandidate): string {
	return candidate.displayName ?? candidate.name;
}

/** Каталог конфигурации папки без `packagedef`, когда `packagedef` для неё ставится не в корень папки. */
function candidateConfigurationLocation(candidate: ProjectCandidate): string | undefined {
	return candidate.kind === 'folder' && !sameProjectRoot(packagedefTargetDir(candidate.configuration), candidate.root)
		? relativeLocation(candidate.root, candidate.configuration.dir)
		: undefined;
}

/** Описание не проекта. */
export function candidateDescription(candidate: ProjectCandidate): string {
	const location = candidateConfigurationLocation(candidate);
	return [
		...(candidate.kind === 'extraConfiguration' ? ['вторая конфигурация'] : []),
		...(location ? [location] : []),
		...configurationParts(candidate.configuration),
	].join(SEPARATOR);
}

/** Подсказка не проекта: каталог packagedef и каталог конфигурации. */
export function candidateTooltip(candidate: ProjectCandidate): string {
	const lines = [candidate.root];
	if (!sameProjectRoot(candidate.configuration.dir, candidate.root)) {
		lines.push(`Конфигурация: ${candidate.configuration.dir}`);
	}
	return lines.join('\n');
}

/**
 * Текущий проект окна среди найденных.
 *
 * @param projects - Проекты окна
 * @param selectedRoot - Выбранный корень
 */
export function findCurrentProject(
	projects: readonly WorkspaceProject[],
	selectedRoot: string | undefined
): WorkspaceProject | undefined {
	return projects.find((project) => isCurrentProject(project, selectedRoot));
}

/** Имя текущего проекта, когда проектов больше одного. */
export function multipleProjectsCurrentName(
	projects: readonly WorkspaceProject[],
	selectedRoot: string | undefined
): string | undefined {
	if (projects.length <= 1) {
		return undefined;
	}
	const project = findCurrentProject(projects, selectedRoot);
	return project ? projectDisplayName(project, projects) : undefined;
}
