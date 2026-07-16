/**
 * Формирование содержимого файла профиля с выбором секций команд.
 *
 * Используется при создании профиля запуска (env.json / autumn-properties.json)
 * и именованных профилей: базовые настройки берутся из дефолта, остальные
 * секции (vanessa/xunit/syntax-check) добавляются по выбору пользователя. Выбор
 * областей одинаков для обеих схем, отличается лишь формат результата.
 */

import * as vscode from 'vscode';
import { ENV_DEFAULTS, AUTUMN_DEFAULTS } from './envDefaults';
import {
	ENV_OPTIONAL_SECTIONS,
	AUTUMN_OPTIONAL_SECTIONS,
	mergeEnvSections,
	mergeAutumnSections,
} from './envSections';

/** Показывает QuickPick секций (все выбраны) и возвращает выбранные id, либо undefined при отмене. */
async function pickSections(sections: { id: string; description: string }[]): Promise<string[] | undefined> {
	const picked = await vscode.window.showQuickPick(
		sections.map((option) => ({ label: option.id, description: option.description, picked: true })),
		{
			canPickMany: true,
			title: 'Секции команд',
			placeHolder: 'Снимите ненужные секции (базовые настройки добавляются всегда)',
			ignoreFocusOut: true,
		}
	);
	return picked?.map((item) => item.label);
}

/**
 * Спрашивает секции команд и формирует содержимое env.json (2.x): default + выбранные.
 *
 * @returns Текст env-файла (JSON) или undefined при отмене выбора
 */
export async function buildEnvJsonWithSections(nonInteractive = false): Promise<string | undefined> {
	// агентный вызов: все секции без окна выбора
	const selected = nonInteractive
		? ENV_OPTIONAL_SECTIONS.map((option) => option.id)
		: await pickSections(ENV_OPTIONAL_SECTIONS);
	if (selected === undefined) {
		return undefined;
	}
	const obj = mergeEnvSections(ENV_DEFAULTS as Record<string, unknown>, selected);
	return `${JSON.stringify(obj, null, 4)}\n`;
}

/**
 * Спрашивает секции команд и формирует содержимое autumn-properties.json (3.0):
 * базовые настройки + выбранные секции в каскаде vrunner.
 *
 * @returns Текст файла (JSON) или undefined при отмене выбора
 */
export async function buildAutumnPropertiesWithSections(nonInteractive = false): Promise<string | undefined> {
	// агентный вызов: все секции без окна выбора
	const selected = nonInteractive
		? AUTUMN_OPTIONAL_SECTIONS.map((option) => option.id)
		: await pickSections(AUTUMN_OPTIONAL_SECTIONS);
	if (selected === undefined) {
		return undefined;
	}
	const obj = mergeAutumnSections(AUTUMN_DEFAULTS as Record<string, unknown>, selected);
	return `${JSON.stringify(obj, null, 4)}\n`;
}
