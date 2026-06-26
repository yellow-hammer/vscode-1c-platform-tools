/**
 * Формирование содержимого env-файла с выбором секций команд.
 *
 * Используется при создании env.json и именованных профилей env.<id>.json:
 * базовая секция `default` берётся из envDefaults, остальные (vanessa/xunit/...)
 * добавляются по выбору пользователя.
 */

import * as vscode from 'vscode';
import { ENV_DEFAULTS } from './envDefaults';
import { ENV_OPTIONAL_SECTIONS, mergeEnvSections } from './envSections';

/**
 * Спрашивает секции команд и формирует содержимое env-файла (default + выбранные).
 *
 * @returns Текст env-файла (JSON) или undefined при отмене выбора
 */
export async function buildEnvJsonWithSections(): Promise<string | undefined> {
	const baseObj: Record<string, unknown> = ENV_DEFAULTS;

	const picked = await vscode.window.showQuickPick(
		ENV_OPTIONAL_SECTIONS.map((option) => ({ label: option.id, description: option.description, picked: true })),
		{
			canPickMany: true,
			title: 'Секции команд',
			placeHolder: 'Снимите ненужные секции (секция default добавляется всегда)',
			ignoreFocusOut: true,
		}
	);
	if (picked === undefined) {
		return undefined;
	}

	const obj = mergeEnvSections(baseObj, picked.map((item) => item.label));
	return `${JSON.stringify(obj, null, 4)}\n`;
}
