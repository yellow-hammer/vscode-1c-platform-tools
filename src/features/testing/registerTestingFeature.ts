import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { TestingController } from './testController';
import { TestFrameworkAdapter } from './frameworkAdapter';
import { VanessaAdapter } from './adapters/vanessaAdapter';
import { XUnitAdapter } from './adapters/xunitAdapter';
import { YaxunitAdapter } from './adapters/yaxunitAdapter';
import { OneScriptAdapter } from './adapters/onescriptAdapter';
import { OneBddAdapter } from './adapters/onebddAdapter';
import { registerConfigureTestingCommand } from './configureTestingCommand';

/**
 * Регистрирует интеграцию тестов 1С с панелью тестирования VS Code
 *
 * Создаёт TestController с адаптерами фреймворков, запускает первичное
 * обнаружение тестов (только для проектов 1С) и подписывается на изменения
 * настроек группы testing.
 *
 * @param params - Параметры регистрации
 * @returns Массив Disposable для context.subscriptions
 */
/**
 * Результат регистрации фичи тестирования
 */
export interface TestingFeature {
	/** Disposable'ы для context.subscriptions */
	disposables: vscode.Disposable[];
	/** Пересобрать дерево тестов (например, после создания проекта из палитры) */
	rebuild: () => void;
}

export function registerTestingFeature(params: {
	isProjectRef: { current: boolean };
}): TestingFeature {
	const vrunner = VRunnerManager.getInstance();
	// Команда «Настроить тесты» доступна всегда (в т.ч. чтобы включить testing.enabled)
	const configureCommand = registerConfigureTestingCommand(vrunner);

	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	if (!config.get<boolean>('testing.enabled', true)) {
		return { disposables: [configureCommand], rebuild: () => undefined };
	}
	const adapters: TestFrameworkAdapter[] = [
		new VanessaAdapter(vrunner),
		new XUnitAdapter(vrunner),
		new YaxunitAdapter(vrunner),
		new OneScriptAdapter(vrunner),
		new OneBddAdapter(vrunner)
	];

	const controller = new TestingController(adapters, vrunner, params.isProjectRef);

	// Чистим устаревшие каталоги отчётов прошлых сессий и строим дерево
	void controller.cleanupAllReports().then(() => controller.scheduleRebuild());

	const onConfigChange = vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration('1c-platform-tools.testing')) {
			controller.scheduleRebuild();
		}
	});

	// FileSystemWatcher не шлёт события по файлам при переименовании/удалении
	// КАТАЛОГА — пересобираем дерево, чтобы не оставались элементы со старыми URI
	const onRename = vscode.workspace.onDidRenameFiles(() => controller.scheduleRebuild());
	const onDelete = vscode.workspace.onDidDeleteFiles(() => controller.scheduleRebuild());

	return {
		disposables: [controller, onConfigChange, onRename, onDelete, configureCommand],
		rebuild: () => controller.scheduleRebuild()
	};
}
