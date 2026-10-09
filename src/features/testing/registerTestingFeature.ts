import { onDidChangeProjectLayout } from '../../shared/projectLayoutWatch';
import { onDidChangeCurrentProject, onDidChangeProjects, runWithProject } from '../../shared/workspaceProjects';
import { ensureWorkspaceTrusted } from '../../shared/workspaceTrust';
import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { TestingController, type TestingControllerOptions } from './testController';
import { TestFrameworkAdapter } from './frameworkAdapter';
import { VanessaAdapter } from './adapters/vanessaAdapter';
import { XUnitAdapter } from './adapters/xunitAdapter';
import { YaxunitAdapter } from './adapters/yaxunitAdapter';
import { OneScriptAdapter } from './adapters/onescriptAdapter';
import { OneBddAdapter } from './adapters/onebddAdapter';
import { registerConfigureTestingCommand } from './configureTestingCommand';
import { disposeMutatosDiagnostics } from './mutatos/mutatosDiagnostics';
import { runMutationTesting } from './mutatos/mutatosCommand';

/**
 * Результат регистрации фичи тестирования
 */
export interface TestingFeature {
	/** Disposable'ы для context.subscriptions */
	disposables: vscode.Disposable[];
	/** Пересобрать дерево тестов (например, после создания проекта из палитры) */
	rebuild: () => void;
}

/**
 * Дерево тестов в панели тестирования VS Code
 */
export interface TestExplorer extends TestingFeature {
	controller: TestingController;
}

/**
 * Регистрирует интеграцию тестов 1С с панелью тестирования VS Code
 *
 * @param params - Параметры регистрации
 * @returns Disposable'ы и пересборка дерева
 */
export function registerTestingFeature(params: {
	isProjectRef: { current: boolean };
}): TestingFeature {
	const vrunner = VRunnerManager.getInstance();
	const configureCommand = registerConfigureTestingCommand(vrunner);
	const explorer = registerTestExplorer({
		isProjectRef: params.isProjectRef,
		adapters: [
			new VanessaAdapter(vrunner),
			new XUnitAdapter(vrunner),
			new YaxunitAdapter(vrunner),
			new OneScriptAdapter(vrunner),
			new OneBddAdapter(vrunner)
		],
		vrunner
	});
	return {
		disposables: [
			...explorer.disposables,
			configureCommand,
			registerMutationTestingOfItem(explorer.controller, vrunner),
			registerOnescriptTestProfileCommand(explorer.controller),
			new vscode.Disposable(disposeMutatosDiagnostics)
		],
		rebuild: explorer.rebuild
	};
}

function registerOnescriptTestProfileCommand(controller: TestingController): vscode.Disposable {
	return vscode.commands.registerCommand('1c-platform-tools.test.selectOnescriptProfile', () =>
		controller.selectOnescriptProfile()
	);
}

/**
 * Мутационное тестирование из контекстного меню узла OneScript: мутанты
 * проверяются тестами выбранного набора или метода.
 *
 * @param controller - Контроллер дерева тестов
 * @param vrunner - Менеджер инструментов проекта
 */
function registerMutationTestingOfItem(controller: TestingController, vrunner: VRunnerManager): vscode.Disposable {
	return vscode.commands.registerCommand('1c-platform-tools.test.mutatosItem', async (item?: vscode.TestItem) => {
		const selection = item ? controller.oneScriptSelection(item) : undefined;
		if (!selection || !ensureWorkspaceTrusted('команды 1С')) {
			return;
		}
		const { root, ...tests } = selection;
		await runWithProject(root, () => runMutationTesting(vrunner, undefined, { selection: tests }));
	});
}

/**
 * Создаёт TestController текущего проекта и пересобирает дерево при смене проекта,
 * его раскладки и настроек группы test
 *
 * Контроллер есть всегда: выключенная у проекта панель (test.panelEnabled) даёт пустое
 * дерево, и оно строится, когда панель включают или выбирают другой проект.
 *
 * @param params - Адаптеры фреймворков и параметры контроллера
 * @returns Контроллер, его подписки и пересборка дерева
 */
export function registerTestExplorer(params: {
	isProjectRef: { current: boolean };
	adapters: TestFrameworkAdapter[];
	vrunner: VRunnerManager;
	controllerOptions?: TestingControllerOptions;
}): TestExplorer {
	const controller = new TestingController(
		params.adapters,
		params.vrunner,
		params.isProjectRef,
		params.controllerOptions
	);

	// Чистим устаревшие каталоги отчётов прошлых сессий и строим дерево
	void controller.cleanupAllReports().then(() => controller.scheduleRebuild());

	const onConfigChange = vscode.workspace.onDidChangeConfiguration((event) => {
		const root = controller.root;
		if (event.affectsConfiguration('1c-platform-tools.test', root ? vscode.Uri.file(root) : undefined)) {
			controller.scheduleRebuild();
		}
	});
	// Корни поиска тестов берутся из раскладки: новое расширение или обработка меняет состав дерева
	const onLayoutChange = onDidChangeProjectLayout(() => controller.scheduleRebuild());
	const onProjectsChange = onDidChangeProjects(() => controller.scheduleRebuild());
	const onCurrentProjectChange = onDidChangeCurrentProject((change) => controller.setProject(change.current));

	// FileSystemWatcher не шлёт события по файлам при переименовании/удалении
	// КАТАЛОГА — пересобираем дерево, чтобы не оставались элементы со старыми URI
	const onRename = vscode.workspace.onDidRenameFiles(() => controller.scheduleRebuild());
	const onDelete = vscode.workspace.onDidDeleteFiles(() => controller.scheduleRebuild());

	return {
		controller,
		disposables: [
			controller,
			onConfigChange,
			onLayoutChange,
			onProjectsChange,
			onCurrentProjectChange,
			onRename,
			onDelete
		],
		rebuild: () => controller.scheduleRebuild()
	};
}
