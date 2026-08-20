/**
 * Дерево информационных баз из списка платформы (`ibases.v8i` и общих списков).
 */

import * as vscode from 'vscode';
import { readInfobases, type InfobaseEntry } from '../../shared/infobaseList';
import { childrenOf } from './ibaseTree';
import { IbaseFolderItem, IbaseItem, type IbaseTreeElement } from './nodes';

/** Читатель списка: в тестах подставляется фикстура. */
export type InfobaseReader = () => InfobaseEntry[];

/**
 * Провайдер дерева списка информационных баз.
 */
export class IbasesProvider implements vscode.TreeDataProvider<IbaseTreeElement>, vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.emitter.event;
	private entries: InfobaseEntry[] = [];

	/**
	 * Создаёт провайдер.
	 *
	 * @param read - Чтение списка (по умолчанию файлы платформы)
	 */
	constructor(private readonly read: InfobaseReader = readInfobases) {
		this.reload();
	}

	/**
	 * Перечитывает список и перерисовывает дерево.
	 */
	refresh(): void {
		this.reload();
		this.emitter.fire();
	}

	/**
	 * Возвращает элемент дерева.
	 *
	 * @param element - Узел
	 * @returns Тот же узел
	 */
	getTreeItem(element: IbaseTreeElement): vscode.TreeItem {
		return element;
	}

	/**
	 * Возвращает детей узла или корня списка.
	 *
	 * @param element - Папка либо пусто (корень)
	 * @returns Дочерние папки и базы
	 */
	getChildren(element?: IbaseTreeElement): IbaseTreeElement[] {
		if (element instanceof IbaseItem) {
			return [];
		}
		const parent = element instanceof IbaseFolderItem ? element.folderPath : '/';
		return childrenOf(parent, this.entries).map((node) =>
			node.kind === 'folder'
				? new IbaseFolderItem(node.path, node.name)
				: new IbaseItem(node.entry)
		);
	}

	/**
	 * Освобождает подписки провайдера.
	 */
	dispose(): void {
		this.emitter.dispose();
	}

	private reload(): void {
		this.entries = this.read();
	}
}
