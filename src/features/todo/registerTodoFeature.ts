import * as vscode from 'vscode';
import {
	TodoPanelTreeDataProvider,
	type FilterScope,
} from './todoPanelView';

export interface RegisterTodoFeatureParams {
	todoPanelProvider: TodoPanelTreeDataProvider;
	isProjectRef: { current: boolean };
}

/**
 * Регистрирует команды и обработчики панели «Список дел».
 */
export function registerTodoFeature(
	params: RegisterTodoFeatureParams
): vscode.Disposable[] {
	const { todoPanelProvider, isProjectRef } = params;

	const todoOpenLocationCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo.openLocation',
		async (uriArg: string | vscode.Uri, line: number) => {
			const uri = typeof uriArg === 'string' ? vscode.Uri.parse(uriArg) : uriArg;
			const doc = await vscode.workspace.openTextDocument(uri);
			const lineIndex = Math.max(0, (line ?? 1) - 1);
			const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
			await vscode.window.showTextDocument(doc, { selection: range, preview: false });
		}
	);

	const todoShowPanelCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo.showPanel',
		async () => {
			await vscode.commands.executeCommand('workbench.view.extension.1c-platform-tools-todo');
			await todoPanelProvider.refresh();
		}
	);

	const todoRefreshCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo.refresh',
		async () => {
			await todoPanelProvider.refresh();
		}
	);

	const todoGroupByHierarchyKey = '1c-platform-tools.todo.groupByHierarchy';
	const updateTodoGroupByContext = (): void => {
		const groupBy = todoPanelProvider.getGroupByFile();
		void vscode.commands.executeCommand('setContext', todoGroupByHierarchyKey, groupBy);
	};

	const todoToggleGroupByCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo.toggleGroupBy',
		async () => {
			const next = !todoPanelProvider.getGroupByFile();
			await todoPanelProvider.setGroupByFile(next);
			updateTodoGroupByContext();
		}
	);

	const todoViewAsListCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo._viewAsList',
		async () => {
			await todoPanelProvider.setGroupByFile(false);
			updateTodoGroupByContext();
		}
	);

	const todoViewAsHierarchyCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo._viewAsHierarchy',
		async () => {
			await todoPanelProvider.setGroupByFile(true);
			updateTodoGroupByContext();
		}
	);

	const todoClearFilterCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo.clearFilter',
		async () => {
			await todoPanelProvider.clearAllFilters();
		}
	);

	type ScopeQuickPickItem = vscode.QuickPickItem & { scope: FilterScope };
	type TagQuickPickItem = vscode.QuickPickItem & { tag: string };
	const scopeItems: ScopeQuickPickItem[] = [
		{
			label: '$(folder-opened)  Весь проект',
			description: 'Все файлы по маске сканирования',
			scope: 'all',
		},
		{
			label: '$(file-text)  Текущий открытый файл',
			description: 'Только дела в активном редакторе',
			scope: 'currentFile',
		},
		{ label: '$(markdown)  Markdown', description: 'Файлы .md', scope: 'md' },
		{ label: '$(code)  BSL', description: 'Модули .bsl', scope: 'bsl' },
		{ label: '$(file-code)  OScript', description: 'Файлы .os', scope: 'os' },
		{
			label: '$(beaker)  Feature',
			description: 'Сценарии Gherkin .feature',
			scope: 'feature',
		},
	];
	const todoFilterByScopeCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo.filterByScope',
		async () => {
			const config = vscode.workspace.getConfiguration('1c-platform-tools');
			const tags = config.get<string[]>('todo.tags') ?? [
				'TODO',
				'FIXME',
				'XXX',
				'HACK',
				'BUG',
			];
			const scopeSet = new Set(scopeItems.map((i) => i.scope));
			const tagItems: TagQuickPickItem[] = tags.map((tag) => ({
				label: `$(tag)  ${tag}`,
				description: '',
				tag,
			}));
			const items: (
				| ScopeQuickPickItem
				| TagQuickPickItem
				| vscode.QuickPickItem
			)[] = [
				{ label: 'Область', kind: vscode.QuickPickItemKind.Separator },
				scopeItems[0],
				scopeItems[1],
				{ label: 'По типу файла', kind: vscode.QuickPickItemKind.Separator },
				...scopeItems.slice(2),
				{ label: 'Теги', kind: vscode.QuickPickItemKind.Separator },
				...tagItems,
			];
			const chosen = await vscode.window.showQuickPick(items, {
				title: 'Список дел: область или тег',
				placeHolder: 'Выберите одну область, тип файла или один тег',
				matchOnDescription: true,
			});
			if (chosen === undefined) {
				return;
			}
			if ('scope' in chosen && scopeSet.has(chosen.scope)) {
				await todoPanelProvider.setFilterScope(chosen.scope);
				await todoPanelProvider.setFilterTags(null);
			} else if ('tag' in chosen) {
				await todoPanelProvider.setFilterScope('all');
				await todoPanelProvider.setFilterTags([chosen.tag]);
			}
		}
	);

	const todoFilterByTagCommand = vscode.commands.registerCommand(
		'1c-platform-tools.todo.filterByTag',
		async () => {
			await vscode.commands.executeCommand('1c-platform-tools.todo.filterByScope');
		}
	);

	const onTodoActiveEditorChange = vscode.window.onDidChangeActiveTextEditor(() => {
		if (todoPanelProvider.getFilterScope() === 'currentFile') {
			todoPanelProvider.refreshView();
		}
	});

	const todoSaveDebounce = {
		timer: undefined as ReturnType<typeof setTimeout> | undefined,
	};
	const onTodoRelevantSave = vscode.workspace.onDidSaveTextDocument((doc) => {
		if (!isProjectRef.current) {
			return;
		}
		if (!/\.(bsl|os|md|feature)$/i.test(doc.uri.fsPath)) {
			return;
		}
		if (todoSaveDebounce.timer) {
			clearTimeout(todoSaveDebounce.timer);
		}
		todoSaveDebounce.timer = setTimeout(() => {
			todoSaveDebounce.timer = undefined;
			void todoPanelProvider.refresh();
		}, 1500);
	});

	const todoDisposeDebounce: vscode.Disposable = {
		dispose: () => {
			if (todoSaveDebounce.timer) {
				clearTimeout(todoSaveDebounce.timer);
			}
		},
	};

	return [
		todoOpenLocationCommand,
		todoShowPanelCommand,
		todoRefreshCommand,
		todoToggleGroupByCommand,
		todoViewAsListCommand,
		todoViewAsHierarchyCommand,
		todoFilterByTagCommand,
		todoFilterByScopeCommand,
		todoClearFilterCommand,
		todoPanelProvider.onDidChangeTreeData(updateTodoGroupByContext),
		onTodoActiveEditorChange,
		onTodoRelevantSave,
		todoDisposeDebounce,
	];
}
