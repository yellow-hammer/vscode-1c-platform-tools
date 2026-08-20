/**
 * Узлы дерева списка информационных баз.
 *
 * Клик по базе ничего не запускает: Предприятие и Конфигуратор — кнопки в конце строки.
 */

import * as vscode from 'vscode';
import type { InfobaseEntry } from '../../shared/infobaseList';
import { infobaseConnectionString } from '../../shared/infobaseList';

/** Папка списка, как в окне запуска 1С. */
export class IbaseFolderItem extends vscode.TreeItem {
	/**
	 * Создаёт узел папки.
	 *
	 * @param folderPath - Путь папки (`/Демо`)
	 * @param label - Имя папки без пути
	 */
	constructor(
		readonly folderPath: string,
		label: string
	) {
		super(label, vscode.TreeItemCollapsibleState.Collapsed);
		this.contextValue = 'ibaseFolder';
		this.iconPath = new vscode.ThemeIcon('folder');
		this.id = `folder:${folderPath}`;
	}
}

/** Информационная база из списка платформы. */
export class IbaseItem extends vscode.TreeItem {
	/**
	 * Создаёт узел базы.
	 *
	 * @param entry - Запись v8i
	 */
	constructor(readonly entry: InfobaseEntry) {
		super(entry.name, vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'ibase';
		this.iconPath = new vscode.ThemeIcon('database');
		this.id = `ibase:${entry.folder}:${entry.name}:${entry.connect}`;
		const connection = infobaseConnectionString(entry.connect);
		this.description = connection;
		this.tooltip = connection ? `${entry.name}\n${connection}` : entry.name;
	}
}

/** Узел дерева списка баз. */
export type IbaseTreeElement = IbaseFolderItem | IbaseItem;
