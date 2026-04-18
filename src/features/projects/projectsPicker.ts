/**
 * QuickPick выбора проекта: избранное + автообнаруженные.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { OneCLocator } from './oneCLocator';
import type { ProjectStorage } from './storage';
import { sortProjects } from './sorter';
import type { ProjectsStack } from './stack';
import { InvocationSource } from './constants';
import { normalizePath } from './pathUtils';

export interface PickedProject {
	name: string;
	rootPath: string;
}

export interface PickedResult {
	item: PickedProject;
	openInNewWindow: boolean;
}

function validatePath(item: vscode.QuickPickItem, store: ProjectStorage | undefined): boolean {
	const p = typeof item.description === 'string' ? item.description : '';
	if (!p) {return false;}
	if (fs.existsSync(p)) {return true;}
	if (store) {
		void vscode.window
			.showErrorMessage('Путь проекта не существует. Что сделать?', { title: 'Обновить путь' }, { title: 'Удалить' })
			.then((ch) => {
				if (ch?.title === 'Обновить путь') {
					void vscode.commands.executeCommand('1c-platform-tools.projects.editProjects');
				} else if (ch?.title === 'Удалить' && item.label) {
					store.remove(item.label);
					store.save();
				}
			});
	}
	return false;
}

/** Нужно ли открывать в новом окне с учётом настроек. */
export function shouldOpenInNewWindow(forceNew: boolean, source: InvocationSource): boolean {
	if (!forceNew) {return false;}
	if (vscode.workspace.workspaceFolders?.length || vscode.window.activeTextEditor) {
		return true;
	}
	const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
	const mode = cfg.get<string>('projects.openInCurrentWindowIfEmpty', 'always');
	if (mode === 'always') {return false;}
	if (mode === 'never') {return true;}
	if (mode === 'onlyUsingCommandPalette') {return source !== InvocationSource.Palette;}
	if (mode === 'onlyUsingSideBar') {return source !== InvocationSource.SideBar;}
	return true;
}

/** Нужно ли спрашивать подтверждение перед переключением в активном окне. */
async function needsConfirm(source: InvocationSource): Promise<boolean> {
	if (!vscode.workspace.workspaceFolders?.length || !vscode.window.activeTextEditor) {
		return false;
	}
	const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
	const mode = cfg.get<string>('projects.confirmSwitchOnActiveWindow', 'never');
	if (mode === 'never') {return false;}
	if (mode === 'onlyUsingCommandPalette') {return source === InvocationSource.Palette;}
	if (mode === 'onlyUsingSideBar') {return source === InvocationSource.SideBar;}
	return mode === 'always';
}

export async function canSwitchOnActiveWindow(source: InvocationSource): Promise<boolean> {
	if (!(await needsConfirm(source))) {return true;}
	const ch = await vscode.window.showWarningMessage(
		'Открыть проект в активном окне?',
		{ modal: true },
		{ title: 'Открыть' }
	);
	return ch?.title === 'Открыть';
}

export async function pickProjects(
	store: ProjectStorage | undefined,
	locator: OneCLocator,
	showNewWindowBtn: boolean,
	source: InvocationSource,
	recent: ProjectsStack,
	context: vscode.ExtensionContext
): Promise<PickedResult | undefined> {
	const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
	const hideCurrent = cfg.get<boolean>('projects.removeCurrentProjectFromList', true);
	const searchFullPath = cfg.get<boolean>('projects.filterOnFullPath', false);
	const filterTags = context.globalState.get<string[]>('1c-platform-tools.projects.filterByTags', []);

	let favorites: Array<{ label: string; description: string }> = [];
	if (store) {
		favorites = filterTags.length > 0 ? store.byTags(filterTags) : store.entries();
		favorites = sortProjects(favorites);
	}

	const detectedPaths = await locator.locateProjects();
	const currentFsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
	let detected = detectedPaths
		.filter((p) => !hideCurrent || path.normalize(p) !== path.normalize(currentFsPath))
		.filter((p) => !favorites.some((f) => path.normalize(f.description) === path.normalize(p)))
		.map((p) => ({ label: path.basename(p) || p, description: p }));
	detected = sortProjects(detected);

	const items: Array<vscode.QuickPickItem & { path: string }> = [
		{ label: 'Избранное', kind: vscode.QuickPickItemKind.Separator, path: '' },
		...favorites.map((f) => ({ ...f, path: f.description })),
		{ label: 'Все проекты', kind: vscode.QuickPickItemKind.Separator, path: '' },
		...detected.map((d) => ({ ...d, path: d.description })),
	];

	const visibleCount = items.filter((i) => i.kind !== vscode.QuickPickItemKind.Separator).length;
	if (visibleCount === 0) {
		void vscode.window.showInformationMessage(
			'Нет сохранённых проектов. Добавьте папки в настройку baseFolders или сохраните текущий проект.'
		);
		return undefined;
	}

	const newWindowBtn: vscode.QuickInputButton = {
		iconPath: new vscode.ThemeIcon('link-external'),
		tooltip: 'Открыть в новом окне',
	};

	return new Promise<PickedResult | undefined>((resolve) => {
		const picker = vscode.window.createQuickPick();
		picker.placeholder = 'Выберите проект...';
		picker.matchOnDescription = searchFullPath;
		picker.items = items.map((it) => ({
			...it,
			buttons: showNewWindowBtn ? [newWindowBtn] : [],
		}));

		picker.onDidChangeSelection((selected) => {
			const it = selected[0];
			if (!it || it.kind === vscode.QuickPickItemKind.Separator) {return;}
			const p = 'path' in it ? (it as { path: string }).path : (it.description as string);
			if (!validatePath(it, store)) {
				resolve(undefined);
				picker.hide();
				return;
			}
			resolve({
				item: { name: it.label, rootPath: normalizePath(p) },
				openInNewWindow: false,
			});
			picker.hide();
		});

		picker.onDidTriggerItemButton((ev) => {
			const it = ev.item;
			if (!it || it.kind === vscode.QuickPickItemKind.Separator) {return;}
			const p = 'path' in it ? (it as { path: string }).path : (it.description as string);
			if (!validatePath(it, store)) {
				resolve(undefined);
				picker.hide();
				return;
			}
			resolve({
				item: { name: it.label, rootPath: normalizePath(p) },
				openInNewWindow: true,
			});
			picker.hide();
		});

		picker.onDidHide(() => {
			resolve(undefined);
			picker.dispose();
		});

		void vscode.commands.executeCommand('setContext', 'in1cProjectsList', true);
		picker.show();
	}).finally(() => {
		void vscode.commands.executeCommand('setContext', 'in1cProjectsList', false);
	});
}

/**
 * Открывает QuickPick для настройки избранного: выбор проектов флажками.
 * @returns true при успешном сохранении.
 */
export async function pickFavoritesToConfigure(
	store: ProjectStorage,
	locator: OneCLocator,
	recent: ProjectsStack
): Promise<boolean> {
	const favorites = store.entries();
	const sortedFav = sortProjects(favorites);

	const detectedPaths = await locator.locateProjects();
	const detected = detectedPaths
		.filter((p) => !sortedFav.some((f) => path.normalize(f.description) === path.normalize(p)))
		.map((p) => ({ label: path.basename(p) || p, description: p }));
	const sortedDet = sortProjects(detected);

	const favoritePaths = new Set(sortedFav.map((f) => path.normalize(f.description)));
	const pickItems: vscode.QuickPickItem[] = [
		{ label: 'Избранное', kind: vscode.QuickPickItemKind.Separator },
		...sortedFav.map((f) => ({ label: f.label, description: f.description, picked: true })),
		{ label: 'Все проекты', kind: vscode.QuickPickItemKind.Separator },
		...sortedDet.map((d) => ({ label: d.label, description: d.description, picked: false })),
	];

	const selected = await vscode.window.showQuickPick(pickItems, {
		canPickMany: true,
		placeHolder: 'Отметьте проекты для избранного',
		title: 'Настроить избранное',
		matchOnDescription: true,
	});

	if (selected === undefined) {
		return false;
	}

	const selectedItems = selected as vscode.QuickPickItem[];
	const selectedPaths = new Set(
		selectedItems.map((it) => path.normalize(typeof it.description === 'string' ? it.description : ''))
	);
	const toAdd = selectedItems.filter((it) => {
		const p = typeof it.description === 'string' ? it.description : '';
		return p && !favoritePaths.has(path.normalize(p));
	});
	const toRemove = sortedFav.filter((f) => !selectedPaths.has(path.normalize(f.description)));

	for (const it of toAdd) {
		const p = typeof it.description === 'string' ? it.description : '';
		if (p && fs.existsSync(p)) {
			store.add(typeof it.label === 'string' ? it.label : String(it.label), p);
		}
	}
	for (const f of toRemove) {
		store.remove(f.label);
	}
	if (toAdd.length > 0 || toRemove.length > 0) {
		store.save();
	}
	return toAdd.length > 0 || toRemove.length > 0;
}

export async function openPickedProject(
	picked: PickedResult | undefined,
	forceNew: boolean,
	source: InvocationSource,
	recent: ProjectsStack,
	_context: vscode.ExtensionContext
): Promise<void> {
	if (!picked) {return;}
	if (!picked.openInNewWindow && !forceNew) {
		if (!(await canSwitchOnActiveWindow(source))) {return;}
	}
	recent.push(picked.item.name);
	const openNew = shouldOpenInNewWindow(forceNew || picked.openInNewWindow, source);
	const uri = vscode.Uri.file(picked.item.rootPath);
	await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: openNew });
}
