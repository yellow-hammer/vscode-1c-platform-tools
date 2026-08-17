/**
 * Решение «обновлять ли конфигурацию БД» для команд загрузки.
 *
 * Загрузка исходников и применение их к конфигурации БД (UpdateDBCfg) — разные действия,
 * и применение вынесено в отдельную команду. Но оба CLI умеют сделать и то, и другое одним
 * вызовом, поэтому команда загрузки спрашивает решение ДО запуска: так привычный сценарий
 * остаётся одним сеансом конфигуратора вместо двух.
 *
 * Источники решения по убыванию приоритета, как у выбора расширений
 * ({@link ../extensions/extensionPicker}):
 * 1. Явное значение в опциях вызова (агент, MCP, шаг цепочки, хук).
 * 2. Настройка `1c-platform-tools.configuration.updateDbAfterLoad`.
 * 3. Вопрос пользователю — только при интерактивном запуске.
 * @module updateDbDecision
 */

import * as vscode from 'vscode';
import type { CommandExecutionOptions } from '../../shared/commandExecutionTypes';

/** Значение настройки поведения после загрузки. */
export type UpdateDbAfterLoad = 'ask' | 'always' | 'never';

/** Что делать команде загрузки. */
export type UpdateDbDecision = 'update' | 'loadOnly' | 'ask';

const SETTING_KEY = 'configuration.updateDbAfterLoad';

/**
 * Решение без обращения к интерфейсу.
 *
 * Неинтерактивный вызов (агент, MCP, шаг цепочки, хук) вопроса не получает никогда:
 * висящее окно там некому нажать, поэтому `ask` для него означает только загрузку.
 *
 * @param setting значение настройки
 * @param explicit значение из опций вызова, если передано
 * @param interactive запуск из интерфейса (опции вызова не переданы)
 */
export function resolveUpdateDb(
	setting: UpdateDbAfterLoad,
	explicit: boolean | undefined,
	interactive: boolean
): UpdateDbDecision {
	if (explicit !== undefined) {
		return explicit ? 'update' : 'loadOnly';
	}
	if (setting === 'always') {
		return 'update';
	}
	if (setting === 'never') {
		return 'loadOnly';
	}
	return interactive ? 'ask' : 'loadOnly';
}

/** Значение настройки; неизвестное значение считается вопросом. */
export function updateDbSetting(): UpdateDbAfterLoad {
	const value = vscode.workspace.getConfiguration('1c-platform-tools').get<string>(SETTING_KEY, 'ask');
	return value === 'always' || value === 'never' ? value : 'ask';
}

/**
 * Обновлять ли конфигурацию БД тем же вызовом; undefined — пользователь отменил выбор.
 *
 * @param opts опции выполнения команды (их отсутствие означает запуск из интерфейса)
 */
export async function decideUpdateDb(opts?: CommandExecutionOptions): Promise<boolean | undefined> {
	const decision = resolveUpdateDb(updateDbSetting(), opts?.updateDb, opts === undefined);
	if (decision !== 'ask') {
		return decision === 'update';
	}

	const update = {
		label: 'Загрузить и обновить конфигурацию БД',
		detail: 'Изменения кода и структуры применяются к базе тем же запуском',
		updateDb: true,
	};
	const loadOnly = {
		label: 'Только загрузить',
		detail: 'Конфигурация БД останется прежней до команды «Обновить конфигурацию в ИБ»',
		updateDb: false,
	};
	const picked = await vscode.window.showQuickPick([update, loadOnly], {
		title: 'Загрузка конфигурации',
		placeHolder: `Постоянный выбор задаётся настройкой 1c-platform-tools.${SETTING_KEY}`,
	});
	return picked?.updateDb;
}
