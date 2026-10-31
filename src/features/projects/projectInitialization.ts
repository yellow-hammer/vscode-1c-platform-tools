/**
 * Инициализация проекта: `packagedef` в папке рабочей области или у найденной конфигурации.
 * @module projects/projectInitialization
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { looksLikeOneScriptPackage } from '../../shared/oneScriptLayout';
import { hasProjectFile, PROJECT_FILE } from '../../shared/projectLayout';
import {
	normalizeProjectRoot,
	ProjectFileExistsError,
	projectRootKey,
	type ProjectCandidate,
	type WorkspaceFolderRef,
} from '../../shared/workspaceProjects';
import { failure, type ProjectCommandResult } from './projectList';
import { candidateDescription, candidateName } from './projectPresentation';
import type { WorkspaceProjectsSource } from './workspaceProjectsSource';

const log = logger.scope('projects');

/** Каталог, который можно сделать проектом. */
export interface InitializeChoice {
	dir: string;
	label: string;
	description?: string;
	detail: string;
}

/** Вопросы пользователю при инициализации. */
export interface InitializeProjectUi {
	pickDirectory(choices: readonly InitializeChoice[]): Promise<string | undefined>;
	/**
	 * Вид проекта в каталоге без исходного кода 1С.
	 *
	 * @param suggested - Каталог похож на пакет OneScript: этот вариант первый
	 * @returns true — проект OneScript, false — проект 1С, undefined — отказ
	 */
	pickKind(suggested: boolean): Promise<boolean | undefined>;
	confirmOverwrite(file: string): Promise<boolean>;
	openProjectFile(file: string): Promise<void>;
	noFolder(): void;
}

/** Данные `project.initialize`. */
export interface ProjectInitializationData {
	root?: string;
	current?: string;
}

/**
 * Папки рабочей области и не проекты, в которых можно создать `packagedef`.
 *
 * @param folders - Папки по порядку рабочей области
 * @param candidates - Не проекты окна
 */
export function initializeChoices(
	folders: readonly WorkspaceFolderRef[],
	candidates: readonly ProjectCandidate[]
): InitializeChoice[] {
	const choices: InitializeChoice[] = [];
	const seen = new Set<string>();
	for (const folder of folders) {
		const dir = normalizeProjectRoot(folder.root);
		const key = projectRootKey(dir);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		const candidate = candidates.find((item) => projectRootKey(item.root) === key);
		choices.push({
			dir,
			label: folder.name,
			description: hasProjectFile(dir) ? 'уже проект' : candidate ? candidateDescription(candidate) : undefined,
			detail: dir,
		});
	}
	for (const candidate of candidates) {
		const key = projectRootKey(candidate.root);
		if (!seen.has(key)) {
			seen.add(key);
			choices.push({
				dir: candidate.root,
				label: candidateName(candidate),
				description: candidateDescription(candidate),
				detail: candidate.root,
			});
		}
	}
	return choices;
}

/**
 * Нужен ли каталогу шаблон пакета OneScript.
 *
 * У проекта вид уже известен, у каталога с исходным кодом 1С это проект 1С.
 * Остальные каталоги спрашиваются; без вопросов решает похожесть на пакет OneScript.
 *
 * @param source - Проекты окна
 * @param dir - Каталог проекта
 * @param ui - Вопросы пользователю; без них решение без вопросов
 * @returns true — шаблон OneScript, undefined — пользователь отказался
 */
async function wantsOneScript(source: WorkspaceProjectsSource, dir: string, ui?: InitializeProjectUi): Promise<boolean | undefined> {
	const key = projectRootKey(dir);
	const existing = (await source.listProjects()).find((project) => projectRootKey(project.root) === key);
	if (existing) {
		return existing.kind === 'onescript';
	}
	if ((await source.listCandidates()).some((candidate) => projectRootKey(candidate.root) === key)) {
		return false;
	}
	const suggested = looksLikeOneScriptPackage(dir);
	return ui ? ui.pickKind(suggested) : suggested;
}

/**
 * Создаёт `packagedef` и делает проект текущим.
 *
 * Без каталога берёт единственный вариант или спрашивает каталог. В каталоге
 * без исходного кода 1С спрашивает, какой проект создать.
 *
 * @param source - Проекты окна
 * @param target - Каталог проекта
 * @param ui - Вопросы пользователю
 * @returns корень проекта; undefined, если пользователь отказался
 */
export async function initializeProject(
	source: WorkspaceProjectsSource,
	target: string | undefined,
	ui: InitializeProjectUi
): Promise<string | undefined> {
	let dir = target;
	if (dir === undefined) {
		const choices = initializeChoices(source.folders(), await source.listCandidates());
		if (choices.length === 0) {
			ui.noFolder();
			return undefined;
		}
		dir = choices.length === 1 ? choices[0].dir : await ui.pickDirectory(choices);
		if (dir === undefined) {
			return undefined;
		}
	}
	const oneScript = await wantsOneScript(source, dir, ui);
	if (oneScript === undefined) {
		return undefined;
	}
	let root: string;
	try {
		root = await source.createProjectFile(dir, { oneScript });
	} catch (error) {
		if (!(error instanceof ProjectFileExistsError)) {
			throw error;
		}
		if (!(await ui.confirmOverwrite(error.file))) {
			return undefined;
		}
		root = await source.createProjectFile(dir, { overwrite: true, oneScript });
	}
	const file = path.join(normalizeProjectRoot(dir), PROJECT_FILE);
	log.info(`создан ${file}`);
	await ui.openProjectFile(file);
	return root;
}

const INITIALIZE_TITLE = 'Инициализировать проект';

const interactiveUi: InitializeProjectUi = {
	async pickDirectory(choices) {
		const picked = await vscode.window.showQuickPick(
			choices.map((choice) => ({ label: choice.label, description: choice.description, detail: choice.detail, dir: choice.dir })),
			{ title: INITIALIZE_TITLE, placeHolder: 'Каталог, в котором создать packagedef', matchOnDetail: true }
		);
		return picked?.dir;
	},
	async pickKind(suggested) {
		const kinds = [
			{ label: 'Проект 1С', description: 'vanessa-runner, Vanessa Automation и тесты 1С', oneScript: false },
			{ label: 'Проект OneScript', description: 'пакет или приложение без платформы 1С', oneScript: true },
		];
		const picked = await vscode.window.showQuickPick(suggested ? [...kinds].reverse() : kinds, {
			title: INITIALIZE_TITLE,
			placeHolder: 'Какой проект создать',
		});
		return picked?.oneScript;
	},
	async confirmOverwrite(file) {
		const answer = await vscode.window.showWarningMessage(
			`Файл packagedef уже есть: ${file}. Перезаписать?`,
			{ modal: true },
			'Перезаписать'
		);
		return answer === 'Перезаписать';
	},
	async openProjectFile(file) {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		await vscode.window.showTextDocument(document);
	},
	noFolder() {
		void vscode.window.showInformationMessage('Откройте папку, в которой создать проект.');
	},
};

/**
 * Инициализация проекта с вопросами пользователю; ошибка показывается сообщением.
 *
 * @param source - Проекты окна
 * @param target - Каталог проекта
 */
export async function initializeProjectInteractive(
	source: WorkspaceProjectsSource,
	target?: string
): Promise<string | undefined> {
	try {
		return await initializeProject(source, target, interactiveUi);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log.error(`не удалось создать packagedef: ${message}`);
		void vscode.window.showErrorMessage(`Не удалось создать файл packagedef: ${message}`);
		return undefined;
	}
}

/**
 * Инициализация проекта без вопросов: для агента.
 *
 * @param source - Проекты окна
 * @param target - Каталог проекта; без него единственный вариант
 */
export async function initializeProjectResult(
	source: WorkspaceProjectsSource,
	target: string | undefined
): Promise<ProjectCommandResult<ProjectInitializationData>> {
	let dir = target;
	if (dir === undefined) {
		const choices = initializeChoices(source.folders(), await source.listCandidates());
		if (choices.length !== 1) {
			const message =
				choices.length === 0
					? 'В рабочей области нет папки, в которой создать проект.'
					: `Передайте каталог проекта в параметре root. Варианты:\n${choices.map((choice) => choice.dir).join('\n')}`;
			return failure(message, { current: source.selectedRoot() });
		}
		dir = choices[0].dir;
	}
	try {
		const root = await source.createProjectFile(dir, { oneScript: await wantsOneScript(source, dir) });
		log.info(`создан ${path.join(normalizeProjectRoot(dir), PROJECT_FILE)}`);
		return { success: true, exitCode: 0, stdout: '', stderr: '', data: { root, current: source.selectedRoot() } };
	} catch (error) {
		const message =
			error instanceof ProjectFileExistsError
				? `Файл packagedef уже есть: ${error.file}`
				: `Не удалось создать файл packagedef: ${error instanceof Error ? error.message : String(error)}`;
		return failure(message, { current: source.selectedRoot() });
	}
}
