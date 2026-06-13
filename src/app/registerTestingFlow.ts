import * as vscode from 'vscode';
import { registerTestingFeature } from '../features/testing/registerTestingFeature';

/**
 * Результат регистрации потока тестирования
 */
export interface TestingFlow {
	testingFeatureDisposables: vscode.Disposable[];
	/** Пересобрать дерево тестов (например, после создания проекта из палитры) */
	rebuildTesting: () => void;
}

/**
 * Регистрирует интеграцию с панелью тестирования VS Code (issue #85)
 *
 * @param isProjectRef - Мутируемая ссылка «открыт проект 1С»
 * @returns Disposable'ы фичи и коллбэк пересборки дерева
 */
export function registerTestingFlow(isProjectRef: { current: boolean }): TestingFlow {
	const { disposables, rebuild } = registerTestingFeature({ isProjectRef });
	return { testingFeatureDisposables: disposables, rebuildTesting: rebuild };
}
