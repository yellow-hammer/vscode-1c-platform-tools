/**
 * Формирование содержимого env-файла с выбором секций команд.
 *
 * Используется при создании env.json и именованных профилей env.<id>.json:
 * базовая секция `default` берётся из шаблона, остальные (vanessa/xunit/...)
 * добавляются по выбору пользователя.
 */

import * as vscode from 'vscode';
import { readTemplate } from './templates';
import { ENV_OPTIONAL_SECTIONS, mergeEnvSections } from './envSections';

/** Базовый объект env-файла, если шаблон недоступен */
const FALLBACK_ENV = {
	$schema: 'https://raw.githubusercontent.com/vanessa-opensource/vanessa-runner/develop/vanessa-runner-schema.json',
	default: {
		'--ibconnection': '/F./build/ib',
		'--db-user': '',
		'--db-pwd': '',
		'--root': '.',
		'--workspace': '.',
		'--v8version': '8.3',
		'--locale': 'ru',
		'--language': 'ru',
	},
};

/**
 * Спрашивает секции команд и формирует содержимое env-файла (default + выбранные).
 *
 * @param extensionPath - Путь к ресурсам расширения (для шаблона env.json)
 * @returns Текст env-файла (JSON) или undefined при отмене выбора
 */
export async function buildEnvJsonWithSections(extensionPath: string | undefined): Promise<string | undefined> {
	let baseObj: Record<string, unknown> = FALLBACK_ENV;
	if (extensionPath) {
		try {
			baseObj = JSON.parse(await readTemplate(extensionPath, 'env.json.template'));
		} catch {
			// нет шаблона/битый JSON — используем встроенный default
		}
	}

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
