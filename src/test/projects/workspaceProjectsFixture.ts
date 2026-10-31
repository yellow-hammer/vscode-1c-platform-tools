import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { invalidateProjectLayout, setLayoutBoundaries, setLayoutExclusions } from '../../shared/projectLayout';
import {
	normalizeProjectRoot,
	WorkspaceProjects,
	type WorkspaceFolderRef,
} from '../../shared/workspaceProjects';
import { instanceProjectsSource, type WorkspaceProjectsSource } from '../../features/projects/workspaceProjectsSource';

export const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/workspaceProjects');
export const TEMPLATE = path.resolve(__dirname, '../../../resources/templates/packagedef.template');
export const ONESCRIPT_TEMPLATE = path.resolve(__dirname, '../../../resources/templates/packagedef-onescript.template');

export const at = (...parts: string[]): string => normalizeProjectRoot(path.join(FIXTURES, ...parts));

export const PROJECT = at('проект');
export const SUB_PROJECT = at('проект', 'src', 'cfe', 'подпроект');
export const NOT_PROJECT = at('без-packagedef');
export const TWO_CONFIGURATIONS = at('две-конфигурации');
export const DELIVERY = at('две-конфигурации', 'поставка');
export const ACCOUNTING = at('две-конфигурации', 'учёт');

export const folder = (root: string): WorkspaceFolderRef => ({ name: path.basename(root), root });

/** Раскладка без настроек и границ окна расширения. */
export function resetLayout(): void {
	setLayoutExclusions(() => []);
	setLayoutBoundaries(() => []);
	invalidateProjectLayout();
}

/** Проекты отдельного экземпляра над папками. */
export interface ProjectsFixture {
	instance: WorkspaceProjects;
	source: WorkspaceProjectsSource;
	folders: WorkspaceFolderRef[];
}

/**
 * Экземпляр проектов над папками после полного обнаружения.
 *
 * @param roots - Корни папок рабочей области
 */
export async function detectedProjects(roots: readonly string[]): Promise<ProjectsFixture> {
	const folders = roots.map(folder);
	const instance = new WorkspaceProjects({ folders: () => folders, templateFile: TEMPLATE, oneScriptTemplateFile: ONESCRIPT_TEMPLATE });
	await instance.refresh();
	return { instance, source: instanceProjectsSource(instance, () => folders), folders };
}

/**
 * Папки с одинаковыми именами не проектов: два проекта со вторыми конфигурациями
 * `первая` и `вторая`, затем две папки `без-packagedef` в разных каталогах.
 */
export function sameNamedCandidates(): { roots: string[]; dispose: () => void } {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-same-names-'));
	const copies: [string, string][] = [
		['две-конфигурации', 'первая'],
		['две-конфигурации', 'вторая'],
		['без-packagedef', path.join('x', 'без-packagedef')],
		['без-packagedef', path.join('y', 'без-packagedef')],
	];
	const roots = copies.map(([name, target]) => {
		const root = normalizeProjectRoot(path.join(base, target));
		fs.cpSync(path.join(FIXTURES, name), root, { recursive: true });
		return root;
	});
	return { roots, dispose: () => fs.rmSync(base, { recursive: true, force: true }) };
}

/**
 * Копии каталогов фикстуры во временном каталоге: тесты создают файлы.
 *
 * @param names - Каталоги фикстуры
 */
export function copyFixtures(...names: string[]): { roots: string[]; dispose: () => void } {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-ui-'));
	const roots = names.map((name) => {
		const root = normalizeProjectRoot(path.join(base, name));
		fs.cpSync(path.join(FIXTURES, name), root, { recursive: true });
		return root;
	});
	return { roots, dispose: () => fs.rmSync(base, { recursive: true, force: true }) };
}
