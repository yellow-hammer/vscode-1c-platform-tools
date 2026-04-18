/**
 * Регистрация команд модуля «Проекты 1С».
 * @module projects/commands
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { OneCLocator } from './oneCLocator';
import {
	ProjectStorage,
	ProjectsStack,
	ProjectsProviders,
	getProjectsFilePath,
	expandHomePath,
	pickProjects,
	openPickedProject,
	pickFavoritesToConfigure,
	pickTags,
	showStatusBar,
	updateStatusBar,
	canSwitchOnActiveWindow,
	shouldOpenInNewWindow,
	InvocationSource,
} from './index';

/**
 * Регистрирует команды панели «Проекты 1С».
 * @param context — контекст расширения
 * @param projectStorage — хранилище избранного
 * @param locator — локатор проектов (autodetect)
 * @param providers — провайдеры TreeView
 * @param stack — стек недавних проектов
 * @returns массив disposable для отписки
 */
export function registerProjectsCommands(
	context: vscode.ExtensionContext,
	projectStorage: ProjectStorage,
	locator: OneCLocator,
	providers: ProjectsProviders,
	stack: ProjectsStack
): vscode.Disposable[] {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const projectsLocation = config.get<string>('projects.projectsLocation', '');
	const projectFilePath = getProjectsFilePath(projectsLocation, context);

	const disposables: vscode.Disposable[] = [];

	// Внутренняя команда открытия (текущее окно). Принимает node или (path, name).
	disposables.push(
		vscode.commands.registerCommand(
			'1c-platform-tools.projects._open',
			async (arg1: vscode.TreeItem | string, arg2?: string) => {
				let projectPath: string;
				let projectName: string;
				if (typeof arg1 === 'string') {
					projectPath = arg1;
					projectName = arg2 ?? path.basename(projectPath);
				} else {
					const args = (arg1 as vscode.TreeItem).command?.arguments as [string, string] | undefined;
					projectPath = args?.[0] ?? '';
					projectName = args?.[1] ?? path.basename(projectPath);
				}
				if (!projectPath) {
					return;
				}
				if (!(await canSwitchOnActiveWindow(InvocationSource.SideBar))) {
					return;
				}
				stack.push(projectName);
				const uri = vscode.Uri.file(expandHomePath(projectPath));
				await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
			}
		)
	);

	// Открыть в новом окне (inline-иконка + контекстное меню). Принимает node или (path, name).
	disposables.push(
		vscode.commands.registerCommand(
			'1c-platform-tools.projects._openInNewWindow',
			async (arg1: vscode.TreeItem | string, arg2?: string) => {
				let projectPath: string;
				let projectName: string;
				if (typeof arg1 === 'string') {
					projectPath = arg1;
					projectName = arg2 ?? path.basename(projectPath);
				} else {
					const args = (arg1 as vscode.TreeItem).command?.arguments as [string, string] | undefined;
					projectPath = args?.[0] ?? '';
					projectName = args?.[1] ?? path.basename(projectPath);
				}
				if (!projectPath) {
					return;
				}
				stack.push(projectName);
				const uri = vscode.Uri.file(expandHomePath(projectPath));
				const openNew = shouldOpenInNewWindow(true, InvocationSource.SideBar);
				await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: openNew });
			}
		)
	);

	// Настройки проектов (контекстное открытие: фильтр по расширению + projects)
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects.openSettings', () => {
			void vscode.commands.executeCommand(
				'workbench.action.openSettings',
				'@ext:yellow-hammer.1c-platform-tools 1c-platform-tools.projects'
			);
		})
	);

	// Настроить избранное (QuickPick с флажками)
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects.configureFavorites', async () => {
			const changed = await pickFavoritesToConfigure(projectStorage, locator, stack);
			if (changed) {
				providers.refreshStorage();
				void vscode.window.showInformationMessage('Избранное обновлено.');
			}
		})
	);

	// List Open
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects.listOpen', async () => {
			const pick = await pickProjects(
				projectStorage,
				locator,
				false,
				InvocationSource.Palette,
				stack,
				context
			);
			await openPickedProject(
				pick ? { item: pick.item, openInNewWindow: pick.openInNewWindow } : undefined,
				false,
				InvocationSource.Palette,
				stack,
				context
			);
		})
	);

	// List New Window
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects.listNewWindow', async () => {
			const pick = await pickProjects(
				projectStorage,
				locator,
				true,
				InvocationSource.Palette,
				stack,
				context
			);
			await openPickedProject(
				pick ? { item: pick.item, openInNewWindow: pick.openInNewWindow } : undefined,
				true,
				InvocationSource.Palette,
				stack,
				context
			);
		})
	);

	// Save Project
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects.saveProject', async (node?: { command?: { arguments?: unknown[] }; label?: string }) => {
			let rootPath: string;
			let suggestedName: string;

			if (node?.command?.arguments) {
				rootPath = node.command.arguments[0] as string;
				suggestedName = (node.label as string) ?? path.basename(rootPath);
			} else {
				const folders = vscode.workspace.workspaceFolders;
				if (!folders?.length) {
					void vscode.window.showInformationMessage('Откройте папку проекта 1С (с файлом packagedef).');
					return;
				}
				rootPath = folders[0].uri.fsPath;
				suggestedName = path.basename(rootPath) || rootPath;
			}

			const input = vscode.window.createInputBox();
			input.title = 'Сохранить проект';
			input.prompt = 'Имя проекта';
			input.placeholder = 'Введите имя проекта';
			input.value = suggestedName;

			const tagsButton: vscode.QuickInputButton = {
				iconPath: new vscode.ThemeIcon('tag'),
				tooltip: 'Выбрать теги',
			};
			input.buttons = [tagsButton];

			let selectedTags: string[] | undefined;

			input.onDidAccept(async () => {
				const name = input.value.trim();
				if (!name) {
					void vscode.window.showWarningMessage('Укажите имя проекта.');
					return;
				}
				if (projectStorage.exists(name)) {
					const update = await vscode.window.showInformationMessage('Проект уже существует!', 'Обновить', 'Отмена');
					if (update !== 'Обновить') {
						input.hide();
						return;
					}
					stack.push(name);
					projectStorage.updateRootPath(name, rootPath);
					if (selectedTags) {
						projectStorage.editTags(name, selectedTags);
					}
				} else {
					stack.push(name);
					projectStorage.push(name, rootPath);
					if (selectedTags) {
						projectStorage.editTags(name, selectedTags);
					}
				}
				projectStorage.save();
				providers.refreshStorage();
				showStatusBar(projectStorage, locator, name);
				void vscode.window.showInformationMessage('Проект сохранён!');
				input.hide();
			});

			input.onDidTriggerButton(async (btn) => {
				if (btn !== tagsButton) {return;}
				const tags = await pickTags(projectStorage, selectedTags ?? [], {
					useDefaultTags: true,
					useNoTagsDefined: false,
					allowAddingNewTags: true,
				});
				if (tags) {
					selectedTags = tags;
					input.prompt = tags.length > 0 ? `Теги: ${tags.join(', ')}` : 'Имя проекта';
				}
			});

			input.onDidHide(() => input.dispose());
			input.show();
		})
	);

	// Edit Projects
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects.editProjects', () => {
			if (fs.existsSync(projectFilePath)) {
				void vscode.workspace.openTextDocument(projectFilePath).then((doc) => {
					void vscode.window.showTextDocument(doc);
				});
			} else {
				void vscode.window
					.showErrorMessage(
						'Нет сохранённых проектов. Откройте папку и нажмите «Сохранить проект». Редактировать вручную?',
						'Да'
					)
					.then((choice) => {
						if (choice === 'Да') {
							projectStorage.push('Новый проект', 'C:\\путь\\к\\проекту');
							projectStorage.save();
							providers.refreshStorage();
							void vscode.commands.executeCommand('1c-platform-tools.projects.editProjects');
						}
					});
			}
		})
	);

	// Filter by Tag
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects.filterByTag', async () => {
			const filterByTags = context.globalState.get<string[]>('1c-platform-tools.projects.filterByTags', []);
			const tags = await pickTags(projectStorage, filterByTags, {
				useDefaultTags: false,
				useNoTagsDefined: true,
				showWarningWhenHasNoTagsToPick: true,
			});
			if (tags) {
				await context.globalState.update('1c-platform-tools.projects.filterByTags', tags);
				providers.refreshStorage();
			}
		})
	);

	// Refresh
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects.refresh', async () => {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Обновление проектов 1С',
					cancellable: false,
				},
				async () => {
					await locator.refreshProjects(true);
					providers.refreshAll();
					providers.updateStorageTitle();
					providers.updateAutodetectTitle();
				}
			);
			void vscode.window.showInformationMessage('Список проектов обновлён.');
		})
	);

	// Add to Workspace
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects.addToWorkspace', (node?: { command?: { arguments?: unknown[] } }) => {
			const projectPath = node?.command?.arguments?.[0] as string | undefined;
			if (projectPath) {
				const uri = vscode.Uri.file(expandHomePath(projectPath));
				const count = vscode.workspace.workspaceFolders?.length ?? 0;
				void vscode.workspace.updateWorkspaceFolders(count, 0, { uri });
			} else {
				void pickProjects(projectStorage, locator, false, InvocationSource.SideBar, stack, context).then(
					async (pick) => {
						if (pick) {
							const uri = vscode.Uri.file(expandHomePath(pick.item.rootPath));
							const count = vscode.workspace.workspaceFolders?.length ?? 0;
							void vscode.workspace.updateWorkspaceFolders(count, 0, { uri });
						}
					}
				);
			}
		})
	);

	// Reveal in Explorer / Finder / File Manager (одинаковая логика, разные пункты меню по платформе)
	const revealInOS = (node?: { command?: { arguments?: unknown[] } }) => {
		const projectPath = node?.command?.arguments?.[0] as string | undefined;
		if (projectPath) {
			const uri = vscode.Uri.file(expandHomePath(projectPath));
			void vscode.commands.executeCommand('revealFileInOS', uri);
		}
	};
	disposables.push(vscode.commands.registerCommand('1c-platform-tools.projects.revealInExplorer', revealInOS));
	disposables.push(vscode.commands.registerCommand('1c-platform-tools.projects.revealInFinder', revealInOS));
	disposables.push(vscode.commands.registerCommand('1c-platform-tools.projects.revealInFileManager', revealInOS));

	// Delete Project
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects.deleteProject', (node: { command?: { arguments?: unknown[] } }) => {
			const name = node?.command?.arguments?.[1] as string;
			if (name) {
				stack.pop(name);
				projectStorage.pop(name);
				projectStorage.save();
				providers.refreshStorage();
				void vscode.window.showInformationMessage('Проект удалён.');
			}
		})
	);

	// Rename Project
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects.renameProject', (node: { command?: { arguments?: unknown[] } }) => {
			const oldName = node?.command?.arguments?.[1] as string;
			const oldPath = node?.command?.arguments?.[0] as string;
			if (!oldName) {return;}
			void vscode.window
				.showInputBox({
					prompt: 'Новое имя проекта',
					placeHolder: 'Введите новое имя',
					value: oldName,
				})
				.then((newName) => {
					if (newName === undefined || newName === oldName || !newName.trim()) {return;}
					if (projectStorage.exists(newName) && newName.toLowerCase() !== oldName.toLowerCase()) {
						void vscode.window.showErrorMessage('Проект с таким именем уже существует.');
						return;
					}
					stack.rename(oldName, newName);
					projectStorage.rename(oldName, newName);
					projectStorage.save();
					providers.refreshStorage();
					updateStatusBar(oldName, oldPath, newName);
					void vscode.window.showInformationMessage('Проект переименован.');
				});
		})
	);

	// Edit Tags
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects.editTags', async (node: { command?: { arguments?: unknown[] } }) => {
			const projectPath = node?.command?.arguments?.[0] as string;
			if (!projectPath) {return;}
			const project = projectStorage.existsWithRootPath(projectPath);
			if (!project) {return;}
			const tags = await pickTags(projectStorage, project.tags, {
				useDefaultTags: true,
				useNoTagsDefined: false,
			});
			if (tags) {
				projectStorage.editTags(project.name, tags);
				projectStorage.save();
				providers.refreshStorage();
				void vscode.window.showInformationMessage('Теги обновлены.');
			}
		})
	);

	// Toggle Enabled
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects.toggleEnabled', (node: { command?: { arguments?: unknown[] } }) => {
			const name = node?.command?.arguments?.[1] as string;
			if (!name) {return;}
			const enabled = projectStorage.toggleEnabled(name);
			if (enabled === undefined) {return;}
			projectStorage.save();
			providers.refreshStorage();
			void vscode.window.showInformationMessage(
				enabled ? `Проект «${name}» включён.` : `Проект «${name}» скрыт.`,
				'Отмена'
			).then((choice) => {
				if (choice === 'Отмена') {
					projectStorage.toggleEnabled(name);
					projectStorage.save();
					providers.refreshStorage();
				}
			});
		})
	);

	// Add to Favorites (from All projects view)
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects.addToFavorites', (node?: { command?: { arguments?: unknown[] }; label?: string }) => {
			const projectPath = node?.command?.arguments?.[0] as string;
			if (!projectPath) {return;}
			const name = (node?.label as string) ?? path.basename(projectPath);
			if (projectStorage.exists(name)) {
				void vscode.window.showInformationMessage('Проект уже в избранном.');
				return;
			}
			stack.push(name);
			projectStorage.push(name, expandHomePath(projectPath));
			projectStorage.save();
			providers.refreshStorage();
			void vscode.window.showInformationMessage('Проект добавлен в избранное.');
		})
	);

	// View as List / View as Tags
	const viewAsListKey = '1c-platform-tools.projects.viewAsList';
	const viewAsList = context.globalState.get<boolean>(viewAsListKey, true);
	void vscode.commands.executeCommand('setContext', '1c-platform-tools.projects.viewAsList', viewAsList);

	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects._viewAsList', () => {
			context.globalState.update(viewAsListKey, true);
			void vscode.commands.executeCommand('setContext', '1c-platform-tools.projects.viewAsList', true);
			providers.refreshStorage();
		}),
		vscode.commands.registerCommand('1c-platform-tools.projects._viewAsTags', () => {
			context.globalState.update(viewAsListKey, false);
			void vscode.commands.executeCommand('setContext', '1c-platform-tools.projects.viewAsList', false);
			providers.refreshStorage();
		})
	);

	// Sort by (только Name и Path — enablement через config в package.json)
	disposables.push(
		vscode.commands.registerCommand('1c-platform-tools.projects._sortByName', async () => {
			await config.update('projects.sortList', 'Name', vscode.ConfigurationTarget.Global);
			providers.refreshStorage();
		}),
		vscode.commands.registerCommand('1c-platform-tools.projects._sortByPath', async () => {
			await config.update('projects.sortList', 'Path', vscode.ConfigurationTarget.Global);
			providers.refreshStorage();
		})
	);

	disposables.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('1c-platform-tools.projects.sortList')) {
				providers.refreshStorage();
			}
		})
	);

	return disposables;
}
