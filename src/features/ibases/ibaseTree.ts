/**
 * Иерархия списка информационных баз: папки из поля Folder, как в окне запуска 1С.
 *
 * Секции-папки в v8i Connect не имеют, поэтому дерево собирается только из баз:
 * промежуточные папки появляются, если у базы путь глубже корня.
 */

import { normalizeFolder, type InfobaseEntry } from '../../shared/infobaseList';

/** Папка списка. */
export interface IbaseFolderNode {
	readonly kind: 'folder';
	readonly name: string;
	readonly path: string;
	readonly orderInTree: number;
}

/** База списка. */
export interface IbaseBaseNode {
	readonly kind: 'base';
	readonly entry: InfobaseEntry;
}

/** Узел дерева списка. */
export type IbaseTreeNode = IbaseFolderNode | IbaseBaseNode;

/**
 * Имя следующей папки под родителем или `undefined`, если база в другой ветке.
 *
 * @param parent - Нормализованный путь родителя
 * @param folder - Папка базы
 * @returns Имя сегмента или пусто
 */
function nextFolderName(parent: string, folder: string): string | undefined {
	const prefix = parent === '/' ? '/' : `${parent}/`;
	if (parent !== '/' && !folder.startsWith(prefix)) {
		return undefined;
	}
	const rest = parent === '/' ? folder.slice(1) : folder.slice(prefix.length);
	return rest.split('/').find((part) => part.length > 0);
}

/**
 * Запоминает папку с наименьшим порядком платформы среди её баз.
 *
 * @param folders - Уже найденные папки
 * @param parent - Путь родителя
 * @param name - Имя сегмента
 * @param orderInTree - Порядок базы, из которой папка видна
 */
function rememberFolder(
	folders: Map<string, IbaseFolderNode>,
	parent: string,
	name: string,
	orderInTree: number
): void {
	const childPath = parent === '/' ? `/${name}` : `${parent}/${name}`;
	const existing = folders.get(childPath);
	if (!existing || orderInTree < existing.orderInTree) {
		folders.set(childPath, { kind: 'folder', name, path: childPath, orderInTree });
	}
}

/**
 * Дети папки: вложенные папки следующего уровня и базы этой папки.
 *
 * @param parentPath - Путь родителя (`/` — корень списка)
 * @param entries - Базы из списка платформы
 * @returns Узлы, отсортированные как в дереве 1С
 */
export function childrenOf(parentPath: string, entries: readonly InfobaseEntry[]): IbaseTreeNode[] {
	const parent = normalizeFolder(parentPath);
	const folders = new Map<string, IbaseFolderNode>();
	const bases: IbaseBaseNode[] = [];

	for (const entry of entries) {
		const folder = normalizeFolder(entry.folder);
		if (folder === parent) {
			bases.push({ kind: 'base', entry });
			continue;
		}
		const next = nextFolderName(parent, folder);
		if (next) {
			rememberFolder(folders, parent, next, entry.orderInTree);
		}
	}

	return [...folders.values(), ...bases].sort(compareTreeNodes);
}

/**
 * Сравнивает узлы дерева: сначала порядок платформы, затем имя.
 *
 * @param left - Левый узел
 * @param right - Правый узел
 * @returns Результат сравнения
 */
function compareTreeNodes(left: IbaseTreeNode, right: IbaseTreeNode): number {
	const orderLeft = left.kind === 'folder' ? left.orderInTree : left.entry.orderInTree;
	const orderRight = right.kind === 'folder' ? right.orderInTree : right.entry.orderInTree;
	if (orderLeft !== orderRight) {
		return orderLeft - orderRight;
	}
	const listLeft = left.kind === 'base' ? left.entry.orderInList : 0;
	const listRight = right.kind === 'base' ? right.entry.orderInList : 0;
	if (listLeft !== listRight) {
		return listLeft - listRight;
	}
	const nameLeft = left.kind === 'folder' ? left.name : left.entry.name;
	const nameRight = right.kind === 'folder' ? right.name : right.entry.name;
	return nameLeft.localeCompare(nameRight, 'ru');
}
