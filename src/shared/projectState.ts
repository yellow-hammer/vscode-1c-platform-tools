/**
 * Состояние проекта: ключи workspaceState с корнем проекта в имени.
 * @module projectState
 */

import * as vscode from 'vscode';
import { currentRoot, projectRootKey, workspaceMemento } from './workspaceProjects';

/** Начало ключей состояния проекта. */
export const PROJECT_STATE_PREFIX = '1c-platform-tools.project:';

/** Начало ключей состояния окна без проекта. */
export const WINDOW_STATE_PREFIX = '1c-platform-tools.window:';

/** Id активного профиля запуска. */
export const ACTIVE_ENV_PROFILE_STATE = 'activeEnvProfile';

/** Временные параметры активного профиля запуска. */
export const ACTIVE_ENV_OVERRIDES_STATE = 'activeEnvOverrides';

/** Id активного профиля прогона тестов OneScript. */
export const ONESCRIPT_TEST_PROFILE_STATE = 'onescriptTestProfile';

/** Выбор расширений. */
export const EXTENSION_SELECTION_STATE = 'extensions.selection';

/** Выбор тестовых расширений. */
export const TEST_EXTENSION_SELECTION_STATE = 'extensions.selection.tests';

/** Раскрытые источники дерева метаданных. */
export const METADATA_EXPANDED_SOURCES_STATE = 'metadata.expandedSources';

/** Выбор публикации автономного сервера. */
export const SERVER_PUBLICATION_STATE = 'server.publicationSelection';

/**
 * Полный ключ состояния проекта в workspaceState.
 *
 * Корень записан через `encodeURIComponent` от {@link projectRootKey}: двоеточие в
 * корне не путает ключи проектов `/w/a` и `/w/a:b`, написание корня с другим
 * регистром на Windows даёт тот же ключ.
 */
export function projectStateKey(root: string, key: string): string {
	return `${PROJECT_STATE_PREFIX}${encodeURIComponent(projectRootKey(root))}:${key}`;
}

/** Хранилище в памяти: без workspaceState и без проекта. */
class MemoryMemento implements vscode.Memento {
	private readonly values = new Map<string, unknown>();

	keys(): readonly string[] {
		return [...this.values.keys()];
	}

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T | undefined {
		return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
	}

	update(key: string, value: unknown): Thenable<void> {
		if (value === undefined) {
			this.values.delete(key);
		} else {
			this.values.set(key, value);
		}
		return Promise.resolve();
	}
}

/** Ключи одного проекта поверх общего хранилища. */
class PrefixedMemento implements vscode.Memento {
	constructor(
		private readonly base: vscode.Memento,
		private readonly prefix: string
	) {}

	keys(): readonly string[] {
		return this.base
			.keys()
			.filter((key) => key.startsWith(this.prefix))
			.map((key) => key.slice(this.prefix.length));
	}

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T | undefined {
		const value = this.base.get<T>(this.prefix + key);
		return value === undefined ? defaultValue : value;
	}

	update(key: string, value: unknown): Thenable<void> {
		return this.base.update(this.prefix + key, value);
	}
}

const detached = new MemoryMemento();

/**
 * Состояние окна без проекта поверх workspaceState: ключи с {@link WINDOW_STATE_PREFIX}.
 * До активации состояние живёт в памяти.
 *
 * @param base - Общее хранилище
 */
export function windowMemento(base: vscode.Memento = workspaceMemento() ?? detached): vscode.Memento {
	return new PrefixedMemento(base, WINDOW_STATE_PREFIX);
}

/**
 * Состояние проекта поверх workspaceState: ключ {@link projectStateKey}.
 *
 * Корень по умолчанию определяется в момент вызова, поэтому вызов в
 * `runWithProject` читает состояние своего проекта. Без корня состояние
 * принадлежит окну ({@link windowMemento}), до активации живёт в памяти.
 *
 * @param root - Корень проекта
 * @param base - Общее хранилище
 */
export function projectMemento(
	root: string | undefined = currentRoot(),
	base: vscode.Memento = workspaceMemento() ?? detached
): vscode.Memento {
	return root === undefined ? windowMemento(base) : new PrefixedMemento(base, projectStateKey(root, ''));
}

/**
 * Id активного профиля запуска проекта, как он сохранён; undefined, если профиль
 * в проекте не выбирали.
 *
 * @param root - Корень проекта
 */
export function readActiveProfileName(root: string): string | undefined {
	const value = projectMemento(root).get<unknown>(ACTIVE_ENV_PROFILE_STATE);
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}
