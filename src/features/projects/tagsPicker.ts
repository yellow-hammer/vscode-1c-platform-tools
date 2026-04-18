/**
 * Выбор тегов для проектов.
 */

import * as vscode from 'vscode';
import { UNTAGGED_LABEL } from './constants';
import type { ProjectStorage } from './storage';

export interface PickTagOptions {
	useDefaultTags: boolean;
	useNoTagsDefined: boolean;
	showWarningWhenHasNoTagsToPick?: boolean;
	allowAddingNewTags?: boolean;
}

export async function pickTags(
	storage: ProjectStorage,
	preselected: string[],
	options?: PickTagOptions
): Promise<string[] | undefined> {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const defaultTags = config.get<string[]>('projects.tags', ['Личное', 'Работа']) ?? [];
	let currentPreselected = preselected ?? [];

	const quickPick = vscode.window.createQuickPick();
	quickPick.canSelectMany = true;
	quickPick.placeholder = 'Выберите теги';

	const addTagsButton: vscode.QuickInputButton = {
		iconPath: new vscode.ThemeIcon('add'),
		tooltip: 'Добавить теги',
	};

	quickPick.buttons = options?.allowAddingNewTags ? [addTagsButton] : [];

	const refreshItems = (): void => {
		let tags = storage.getAvailableTags();
		tags = [...new Set([...tags, ...currentPreselected.filter((t) => !tags.includes(t) && t !== UNTAGGED_LABEL)])];

		if (options?.useDefaultTags) {
			for (const tag of defaultTags) {
				if (!tags.includes(tag)) {
					tags.push(tag);
				}
			}
		}

		if (tags.length === 0 && options?.showWarningWhenHasNoTagsToPick) {
			void vscode.window.showWarningMessage('Нет доступных тегов.');
		}

		tags.sort();
		if (options?.useNoTagsDefined) {
			tags.push(UNTAGGED_LABEL);
		}

		quickPick.items = tags.map((tag) => ({ label: tag }));
		quickPick.selectedItems = quickPick.items.filter((item) => currentPreselected.includes(item.label));
	};

	refreshItems();

	return new Promise<string[] | undefined>((resolve) => {
		let resolved = false;
		let ignoreHide = false;

		const doResolve = (value: string[] | undefined): void => {
			if (resolved) {return;}
			resolved = true;
			quickPick.hide();
			quickPick.dispose();
			resolve(value);
		};

		quickPick.onDidAccept(() => {
			const selections = quickPick.selectedItems.map((item) => item.label);
			ignoreHide = true;
			doResolve(selections);
		});

		quickPick.onDidHide(() => {
			if (ignoreHide) {return;}
			doResolve(undefined);
		});

		quickPick.onDidTriggerButton(async (button) => {
			if (button !== addTagsButton) {return;}
			ignoreHide = true;

			const input = await vscode.window.showInputBox({
				placeHolder: 'Введите новые теги через запятую',
				prompt: 'Новые теги',
				ignoreFocusOut: true,
			});

			ignoreHide = false;
			if (input === undefined) {
				quickPick.show();
				return;
			}

			const newTags = input
				.split(',')
				.map((t) => t.trim())
				.filter((t) => t.length > 0 && t !== UNTAGGED_LABEL);

			if (newTags.length === 0) {
				quickPick.show();
				return;
			}

			const merged = [...new Set([...defaultTags, ...newTags])];
			await config.update('projects.tags', merged, vscode.ConfigurationTarget.Global);

			currentPreselected = [...new Set([...quickPick.selectedItems.map((i) => i.label), ...newTags])];
			refreshItems();
			quickPick.show();
		});

		quickPick.show();
	});
}
