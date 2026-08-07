/**
 * Подбор значений для параметров профиля запуска.
 *
 * Параметр остаётся обычным текстовым полем: подбор только подставляет в него значение, поэтому
 * вписать строку руками можно всегда. Подборщик привязан к ключу параметра, а не к месту в форме,
 * поэтому его видно и в редакторе профиля, и в любом другом хосте.
 *
 * @module valuePickers
 */

import * as vscode from 'vscode';
import { infobaseConnectionString, readInfobases } from '../../shared/infobaseList';

/** Подбор значения одного параметра. */
export interface ValuePicker {
	/** Подпись кнопки рядом с полем. */
	readonly label: string;
	/** Выбранное значение либо пусто, если пользователь отказался. */
	pick(): Promise<string | undefined>;
}

/** База списка как строка выбора. */
interface InfobaseItem extends vscode.QuickPickItem {
	readonly connection: string;
}

/**
 * Выбор информационной базы из списка платформы.
 *
 * Строка подключения берётся из того же списка, что показывает 1С при запуске, поэтому набирать
 * её руками не нужно. Базы, у которых строку разобрать не удалось, в список не попадают: подставить
 * сырое значение из файла нельзя.
 */
async function pickInfobase(): Promise<string | undefined> {
	const items: InfobaseItem[] = [];
	for (const entry of readInfobases()) {
		const connection = infobaseConnectionString(entry.connect);
		if (connection) {
			items.push({
				label: entry.name,
				description: connection,
				detail: entry.folder === '/' ? undefined : entry.folder,
				connection,
			});
		}
	}
	if (items.length === 0) {
		void vscode.window.showInformationMessage(
			'В списке информационных баз 1С нет ни одной базы. Строку подключения можно вписать в поле вручную.'
		);
		return undefined;
	}
	items.sort((a, b) => (a.detail ?? '').localeCompare(b.detail ?? '', 'ru') || a.label.localeCompare(b.label, 'ru'));
	const chosen = await vscode.window.showQuickPick(items, {
		title: 'Информационные базы 1С',
		placeHolder: 'База для строки подключения профиля',
		matchOnDescription: true,
		matchOnDetail: true,
	});
	return chosen?.connection;
}

/** Параметры, у которых значение можно подобрать; ключ - как в файле настроек, без префикса. */
const PICKERS: Readonly<Record<string, ValuePicker>> = {
	ibconnection: { label: 'Выбрать базу…', pick: pickInfobase },
};

/**
 * Подборщик для параметра профиля.
 *
 * @param key Ключ параметра: в файле 2.x он с префиксом `--`, в 3.x без него.
 */
export function pickerFor(key: string): ValuePicker | undefined {
	return PICKERS[key.replace(/^--/, '')];
}
