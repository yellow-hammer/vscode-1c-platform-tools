import * as vscode from 'vscode';
import { COMMON_MODULES_DIRECTORY, sourceDirectory } from '../../shared/objectPaths';
import { directoryKey, resolveProjectLayout } from '../../shared/projectLayout';
import { onDidChangeProjectLayout } from '../../shared/projectLayoutWatch';
import { currentRoot, onDidChangeCurrentProject, onDidChangeProjects, outsideProject } from '../../shared/workspaceProjects';
import { loadBspLibraries, setSourceVersions } from './sourceVersions';

const LIBRARIES_VIEW_ID = '1c-platform-tools-metadata-libraries';

export function registerMetadataLibrariesView(context: vscode.ExtensionContext): vscode.Disposable {
	const changed = new vscode.EventEmitter<void>();
	const refresh = () => changed.fire();
	const selectedRoot = () => outsideProject(() => currentRoot());
	let watchDirectory: string | undefined;
	let watcher: vscode.Disposable | undefined;
	const watch = (directory: string | undefined): void => {
		if (directory === watchDirectory) {
			return;
		}
		watcher?.dispose();
		watcher = undefined;
		watchDirectory = directory;
		if (directory) {
			const files = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(directory, `${COMMON_MODULES_DIRECTORY}/**/Module.bsl`)
			);
			watcher = vscode.Disposable.from(files, files.onDidChange(refresh), files.onDidCreate(refresh), files.onDidDelete(refresh));
		}
	};
	const view = vscode.window.createTreeView(LIBRARIES_VIEW_ID, {
		treeDataProvider: {
			onDidChangeTreeData: changed.event,
			getTreeItem: (item: vscode.TreeItem) => item,
			async getChildren(): Promise<vscode.TreeItem[]> {
				const root = selectedRoot();
				const configuration = root ? (await resolveProjectLayout(root)).configuration : undefined;
				if (root !== selectedRoot()) {
					return [];
				}
				if (view.visible) {
					watch(configuration && sourceDirectory(configuration));
				}
				if (!root || !configuration) {
					return [];
				}
				const libraries = await loadBspLibraries(context, root, configuration);
				if (root !== selectedRoot()) {
					return [];
				}
				return libraries.map(({ name, version, file }) => {
					const item = new vscode.TreeItem(name);
					const uri = vscode.Uri.file(file);
					item.id = directoryKey(file);
					item.description = version;
					item.iconPath = new vscode.ThemeIcon('library');
					item.resourceUri = uri;
					item.contextValue = 'metadataLibrary';
					item.command = { command: 'vscode.open', title: 'Открыть общий модуль', arguments: [uri] };
					return item;
				});
			},
		},
	});
	return vscode.Disposable.from(
		view,
		changed,
		vscode.commands.registerCommand('1c-platform-tools.metadata.refreshLibraries', refresh),
		vscode.commands.registerCommand('1c-platform-tools.metadata.setLibraryVersion', async (item?: vscode.TreeItem) => {
			const root = selectedRoot();
			const file = item?.contextValue === 'metadataLibrary' ? item.resourceUri?.fsPath : undefined;
			if (!root || !file) {
				return;
			}
			await setSourceVersions(context, root, [{ op: 'bsp-library-version-set', moduleFile: file }],
				'Версия библиотеки', typeof item?.description === 'string' ? item.description : undefined);
		}),
		onDidChangeCurrentProject(() => {
			watch(undefined);
			refresh();
		}),
		onDidChangeProjectLayout(refresh),
		onDidChangeProjects(refresh),
		view.onDidChangeVisibility(({ visible }) => {
			if (!visible) {
				watch(undefined);
			} else {
				refresh();
			}
		}),
		new vscode.Disposable(() => watch(undefined))
	);
}
