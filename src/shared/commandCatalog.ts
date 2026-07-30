/**
 * Каталог команд расширения: идентификатор, заголовок, категория, признак
 * синхронного режима.
 *
 * Источник - манифест расширения, поэтому каталог не расходится с палитрой
 * команд. Нужен там, где команды выбирают списком: MCP отдаёт его агенту,
 * редактор пайплайнов показывает как справочник шагов.
 */

import * as vscode from 'vscode';
import { commandSupportsWait, isCommandExposedToMcp } from './mcpCommandPolicy';

/** Запись каталога команд */
export interface CommandCatalogEntry {
	/** Идентификатор команды */
	id: string;
	/** Заголовок из манифеста */
	title?: string;
	/** Категория из манифеста */
	category?: string;
	/** Команда выполняется синхронно и возвращает результат */
	supportsWait: boolean;
}

const EXTENSION_ID = 'yellow-hammer.1c-platform-tools';

/**
 * Читает команды из манифеста расширения.
 *
 * @returns Соответствие «идентификатор - заголовок и категория»
 */
export function readManifestCommands(): Map<string, { title?: string; category?: string }> {
	const titles = new Map<string, { title?: string; category?: string }>();
	const extension = vscode.extensions.getExtension(EXTENSION_ID);
	const contributed = extension?.packageJSON?.contributes?.commands;
	if (!Array.isArray(contributed)) {
		return titles;
	}
	for (const item of contributed as Array<Record<string, unknown>>) {
		const id = typeof item.command === 'string' ? item.command : undefined;
		if (!id) {
			continue;
		}
		titles.set(id, {
			title: typeof item.title === 'string' ? item.title : undefined,
			category: typeof item.category === 'string' ? item.category : undefined,
		});
	}
	return titles;
}

/**
 * Заголовок команды из манифеста.
 *
 * @param commandId - Идентификатор команды
 * @returns Заголовок или undefined, если команда не объявлена
 */
export function commandTitle(commandId: string): string | undefined {
	return readManifestCommands().get(commandId)?.title;
}

/**
 * Каталог команд, пригодных для шагов пайплайна и вызова агентом.
 *
 * Интерактивные мастера и навигация отсеиваются той же политикой, что решает,
 * какие команды видит агент: в неинтерактивной цепочке от них толку нет.
 *
 * @returns Записи каталога в порядке манифеста
 */
export function readCommandCatalog(): CommandCatalogEntry[] {
	const catalog: CommandCatalogEntry[] = [];
	for (const [id, meta] of readManifestCommands()) {
		if (!isCommandExposedToMcp(id)) {
			continue;
		}
		catalog.push({ id, ...meta, supportsWait: commandSupportsWait(id) });
	}
	return catalog;
}
