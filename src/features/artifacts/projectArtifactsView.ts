/**
 * Дерево «1С: Артефакты»: данные из {@link scanArtifacts}.
 *
 * - `refresh` отменяет предыдущий скан и передаёт {@link vscode.CancellationToken} в сканер;
 *   скрытое дерево сканируется, когда его покажут.
 * - При нескольких проектах разделы группируются по проекту, выбранный проект первым.
 * - У элементов артефактов `resourceUri` — каталог/файл для команд сборки и vrunner; открытие в редакторе
 *   выполняется по корневому файлу (`ArtifactItem.openTargetUri`), `projectRoot` — корень проекта артефакта.
 *
 * @module projectArtifactsView
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { scanArtifacts, type Artifact, type ProjectArtifacts } from './artifactsScanner';
import type { SourceFormat } from '../../shared/projectLayout';
import { projectScanRoots } from '../../shared/workspaceProjects';
import {
	CURRENT_PROJECT_DESCRIPTION,
	isSelectedRoot,
	projectLabel,
	sameScanRoots,
	selectedFirst,
} from './projectScan';

// Ключ сохранения режима вида дерева (список/каталоги). Историческое имя
// 'featuresView' сохранено намеренно, чтобы не сбрасывать настройку пользователей.
const VIEW_MODE_KEY = '1c-platform-tools.artifacts.featuresView';

export type ArtifactsViewMode = 'list' | 'folder';

function collectDuplicateLabels(items: { name: string }[]): Set<string> {
	const byLower = new Map<string, number>();
	for (const it of items) {
		const k = it.name.toLowerCase();
		byLower.set(k, (byLower.get(k) ?? 0) + 1);
	}
	const dupes = new Set<string>();
	for (const [k, n] of byLower) {
		if (n > 1) {
			dupes.add(k);
		}
	}
	return dupes;
}

function parentDirName(relativePath: string): string | undefined {
	const dir = path.dirname(relativePath);
	if (!dir || dir === '.') {
		return undefined;
	}
	return path.basename(dir);
}

function getTreeLabel(item: vscode.TreeItem): string {
	const l = item.label;
	if (l === undefined) {
		return '';
	}
	return typeof l === 'string' ? l : l.label;
}

export class ProjectArtifactsTreeDataProvider
	implements vscode.TreeDataProvider<ArtifactTreeItem>
{
	private readonly _onDidChangeTreeData =
		new vscode.EventEmitter<ArtifactTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<
		ArtifactTreeItem | undefined | null | void
	> = this._onDidChangeTreeData.event;

	private _scanResult: ProjectArtifacts[] | null = null;
	private readonly _context: vscode.ExtensionContext;
	private _scanCts: vscode.CancellationTokenSource | undefined;
	private _view: Pick<vscode.TreeView<vscode.TreeItem>, 'visible'> | undefined;

	/**
	 * @param context - Контекст расширения: режим вида в globalState
	 * @param _scan - Скан проектов окна
	 */
	constructor(
		context: vscode.ExtensionContext,
		private readonly _scan: (token: vscode.CancellationToken) => Promise<ProjectArtifacts[]> = (token) => scanArtifacts(token)
	) {
		this._context = context;
	}

	/**
	 * Дерево, по видимости которого решается, сканировать ли сейчас.
	 *
	 * @param view - Дерево панели
	 */
	setTreeView(view: Pick<vscode.TreeView<vscode.TreeItem>, 'visible'>): void {
		this._view = view;
	}

	/**
	 * Пересканирование; параллельный вызов отменяет устаревший скан. Скрытое дерево
	 * забывает найденное и сканируется, когда его покажут.
	 */
	async refresh(): Promise<void> {
		if (this._view && !this._view.visible) {
			this._scanCts?.cancel();
			this._scanResult = null;
			this._onDidChangeTreeData.fire(undefined);
			return;
		}
		await this._rescan();
	}

	/** Полное пересканирование; параллельный вызов отменяет устаревший скан. */
	private async _rescan(): Promise<void> {
		this._scanCts?.cancel();
		this._scanCts = new vscode.CancellationTokenSource();
		const cts = this._scanCts;
		const token = cts.token;
		try {
			this._scanResult = await this._scan(token);
			if (!token.isCancellationRequested) {
				this._onDidChangeTreeData.fire(undefined);
			}
		} catch (err) {
			if (err instanceof vscode.CancellationError || token.isCancellationRequested) {
				return;
			}
			throw err;
		} finally {
			if (this._scanCts === cts) {
				this._scanCts = undefined;
			}
			cts.dispose();
		}
	}

	/**
	 * Выбранный проект сменился: тот же набор проектов перерисовывается в новом
	 * порядке, другой сканируется заново.
	 */
	onCurrentProjectChanged(): void {
		const scanned = this._scanResult;
		if (!scanned) {
			return;
		}
		if (sameScanRoots(scanned.map((result) => result.root), projectScanRoots())) {
			this._onDidChangeTreeData.fire(undefined);
			return;
		}
		void this.refresh();
	}

	getViewMode(): ArtifactsViewMode {
		return (
			this._context.globalState.get<ArtifactsViewMode>(VIEW_MODE_KEY) ??
			'list'
		);
	}

	async setViewMode(mode: ArtifactsViewMode): Promise<void> {
		await this._context.globalState.update(VIEW_MODE_KEY, mode);
		void vscode.commands.executeCommand(
			'setContext',
			'1c-platform-tools.artifacts.viewAsList',
			mode === 'list'
		);
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: ArtifactTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ArtifactTreeItem): Promise<ArtifactTreeItem[]> {
		// Узлы запрашивает только показанное дерево
		if (!this._scanResult) {
			await this._rescan();
		}
		const result = this._scanResult;
		if (!result) {
			return [];
		}

		if (!element) {
			return this.getRootItems(result);
		}

		if (element instanceof ProjectItem) {
			return this.getSectionItems(element.result);
		}

		if (element instanceof SectionItem) {
			return this.getSectionChildren(element.sectionId, element.result);
		}

		if (element.contextValue === 'artifactsFolderGroup') {
			return (element as FolderGroupItem).children;
		}

		return [];
	}

	private getRootItems(results: ProjectArtifacts[]): ArtifactTreeItem[] {
		if (results.length > 1) {
			return selectedFirst(results, (result) => result.root).map((result) => new ProjectItem(result));
		}
		return results.length === 1 ? this.getSectionItems(results[0]) : [];
	}

	private getSectionItems(result: ProjectArtifacts): ArtifactTreeItem[] {
		const packages: SectionMeta = {
			id: 'packages',
			label: 'Пакеты',
			icon: 'package',
			count: result.packages.length,
		};
		if (result.oneScript) {
			return [new SectionItem(packages.label, packages.count, packages.icon, packages.id, result)];
		}
		const sections: SectionMeta[] = [
			{
				id: 'configurations',
				label: 'Конфигурации',
				icon: 'file-code',
				count: result.configurations.length,
			},
			{
				id: 'extensions',
				label: 'Расширения',
				icon: 'extensions',
				count: result.extensions.length,
			},
			{
				id: 'processors',
				label: 'Внешние обработки',
				icon: 'tools',
				count: result.processors.length,
			},
			{
				id: 'reports',
				label: 'Внешние отчёты',
				icon: 'file-text',
				count: result.reports.length,
			},
			// У проекта 1С пакет бывает, когда он ещё и библиотека OneScript
			...(packages.count > 0 ? [packages] : []),
		];

		return sections.map(
			(s) => new SectionItem(s.label, s.count, s.icon, s.id, result)
		);
	}

	private getSectionChildren(
		sectionId: string,
		result: ProjectArtifacts
	): ArtifactTreeItem[] {
		const viewMode = this.getViewMode();

		switch (sectionId) {
			case 'configurations':
				return this.buildArtifactItems(result.configurations, viewMode, result.root);
			case 'extensions':
				return this.buildArtifactItems(result.extensions, viewMode, result.root);
			case 'processors':
				return this.buildArtifactItems(result.processors, viewMode, result.root);
			case 'reports':
				return this.buildArtifactItems(result.reports, viewMode, result.root);
			case 'packages':
				return this.buildArtifactItems(result.packages, viewMode, result.root);
			default:
				return [];
		}
	}

	private buildArtifactItems(
		items: Artifact[],
		viewMode: ArtifactsViewMode,
		root: string
	): ArtifactTreeItem[] {
		const sorted = [...items].sort((a, b) =>
			a.relativePath.localeCompare(b.relativePath, undefined, {
				sensitivity: 'base',
			})
		);

		if (viewMode === 'list') {
			const dupes = collectDuplicateLabels(sorted);
			return sorted.map((a) =>
				this.artifactToItem(
					a,
					root,
					dupes.has(a.name.toLowerCase())
						? parentDirName(a.relativePath)
						: undefined
				)
			);
		}

		return this.buildHierarchy(sorted, (a) => this.artifactToItem(a, root), root);
	}

	private buildHierarchy<T extends { relativePath: string }>(
		items: T[],
		toItem: (a: T) => ArtifactTreeItem,
		root: string
	): ArtifactTreeItem[] {
		const byDir = new Map<string, T[]>();
		const rootItems: T[] = [];

		for (const a of items) {
			const dir = path.dirname(a.relativePath);
			if (!dir || dir === '.') {
				rootItems.push(a);
			} else {
				const list = byDir.get(dir) ?? [];
				list.push(a);
				byDir.set(dir, list);
			}
		}

		const result: ArtifactTreeItem[] = rootItems.map(toItem);

		const dirs = Array.from(byDir.keys()).sort((a, b) =>
			a.localeCompare(b, undefined, { sensitivity: 'base' })
		);

		const tree = this.buildFolderTree(dirs, byDir, toItem, root);
		result.push(...tree);

		return result;
	}

	private buildFolderTree<T extends { relativePath: string }>(
		dirs: string[],
		byDir: Map<string, T[]>,
		toItem: (a: T) => ArtifactTreeItem,
		projectRoot: string
	): FolderGroupItem[] {
		interface DirNode {
			items: T[];
			children: Map<string, DirNode>;
		}

		const root = new Map<string, DirNode>();

		function ensureNode(parent: Map<string, DirNode>, seg: string): DirNode {
			if (!parent.has(seg)) {
				parent.set(seg, { items: [], children: new Map() });
			}
			return parent.get(seg)!;
		}

		for (const d of dirs) {
			const parts = d.split(/[/\\]/).filter(Boolean);
			if (parts.length === 0) {
				continue;
			}
			let current = root;
			for (let i = 0; i < parts.length; i++) {
				const seg = parts[i];
				const node = ensureNode(current, seg);
				if (i === parts.length - 1) {
					node.items.push(...(byDir.get(d) ?? []));
				}
				current = node.children;
			}
		}

		function toFolderGroup(
			pathPrefix: string,
			name: string,
			node: DirNode,
			hasParentInTree: boolean = false
		): FolderGroupItem {
			const fullPath = pathPrefix ? `${pathPrefix}/${name}` : name;

			if (
				node.items.length === 0 &&
				node.children.size === 1
			) {
				const [childName, childNode] = [...node.children][0];
				return toFolderGroup(fullPath, childName, childNode, false);
			}

			const children: ArtifactTreeItem[] = node.items.map(toItem);
			for (const [childName, childNode] of node.children) {
				children.push(toFolderGroup(fullPath, childName, childNode, true));
			}
			children.sort((a, b) => {
				const aIsFolder = a.contextValue === 'artifactsFolderGroup';
				const bIsFolder = b.contextValue === 'artifactsFolderGroup';
				if (aIsFolder !== bIsFolder) {
					return aIsFolder ? -1 : 1;
				}
				const aLabel = getTreeLabel(a);
				const bLabel = getTreeLabel(b);
				return aLabel.localeCompare(bLabel, undefined, {
					sensitivity: 'base',
				});
			});

			const label =
				pathPrefix && !hasParentInTree
					? `${pathPrefix.replaceAll('/', ' › ')} › ${name}`
					: name;
			return new FolderGroupItem(fullPath, label, children, projectRoot);
		}

		const result: FolderGroupItem[] = [];
		const firstLevel = Array.from(root.keys()).sort((a, b) =>
			a.localeCompare(b, undefined, { sensitivity: 'base' })
		);
		for (const seg of firstLevel) {
			result.push(toFolderGroup('', seg, root.get(seg)!));
		}
		return result;
	}

	private artifactToItem(
		a: Artifact,
		root: string,
		parentDirDescription?: string
	): ArtifactTreeItem {
		const label = a.name;
		const icon = a.kind === 'source' ? 'folder' : a.type === 'package' ? 'package' : 'file';
		const isBinary = a.kind === 'binary';
		const openTargetUri = a.sourceEntryUri ?? a.uri;
		return new ArtifactItem(
			a.type,
			a.uri,
			label,
			a.relativePath,
			icon,
			isBinary,
			openTargetUri,
			root,
			parentDirDescription,
			a.format
		);
	}
}

interface SectionMeta {
	id: string;
	label: string;
	icon: string;
	count: number;
}

type ArtifactTreeItem =
	| ProjectItem
	| SectionItem
	| FolderGroupItem
	| ArtifactItem;

/** Группа проекта, когда проектов несколько. */
class ProjectItem extends vscode.TreeItem {
	constructor(public readonly result: ProjectArtifacts) {
		super(
			projectLabel(result.root),
			isSelectedRoot(result.root)
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.Collapsed
		);
		this.description = isSelectedRoot(result.root) ? CURRENT_PROJECT_DESCRIPTION : undefined;
		this.tooltip = result.root;
		this.iconPath = new vscode.ThemeIcon('repo');
		this.contextValue = 'artifactsProject';
	}
}

class SectionItem extends vscode.TreeItem {
	/** Корень проекта раздела: сборка пакета из раздела идёт в нём. */
	readonly projectRoot: string;

	constructor(
		label: string,
		count: number,
		icon: string,
		public readonly sectionId: string,
		public readonly result: ProjectArtifacts
	) {
		super(
			label,
			count > 0
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.None
		);
		this.projectRoot = result.root;
		this.description = count > 0 ? String(count) : undefined;
		this.iconPath = new vscode.ThemeIcon(icon);
		// У раздела пакетов в строке кнопка сборки
		this.contextValue = sectionId === 'packages' ? 'artifactsPackagesSection' : 'artifactsSection';
	}
}

class FolderGroupItem extends vscode.TreeItem {
	constructor(
		public readonly folderPath: string,
		label: string,
		public readonly children: ArtifactTreeItem[],
		projectRoot: string
	) {
		super(label, vscode.TreeItemCollapsibleState.Expanded);
		this.resourceUri = vscode.Uri.file(path.join(projectRoot, folderPath));
		this.contextValue = 'artifactsFolderGroup';
	}
}

/**
 * Элемент артефакта в дереве. Сборка/разборка — `resourceUri`; открытие в редакторе — `openTargetUri`.
 */
class ArtifactItem extends vscode.TreeItem {
	readonly openTargetUri: vscode.Uri;

	constructor(
		public readonly artifactType: string,
		public readonly uri: vscode.Uri,
		label: string,
		relativePath: string,
		icon: string,
		_isBinary: boolean,
		openTargetUri: vscode.Uri,
		public readonly projectRoot: string,
		parentDirDescription?: string,
		format?: SourceFormat
	) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.openTargetUri = openTargetUri;
		this.iconPath = new vscode.ThemeIcon(icon);
		this.resourceUri = uri;
		const tooltipMd = new vscode.MarkdownString(undefined, true);
		tooltipMd.appendCodeblock(relativePath, 'plaintext');
		if (parentDirDescription) {
			tooltipMd.appendMarkdown(`\n_Родитель: ${parentDirDescription}_`);
		}
		if (format === 'edt') {
			tooltipMd.appendMarkdown('\n_Проект EDT_');
		}
		this.tooltip = tooltipMd;
		const marks = [parentDirDescription, format === 'edt' ? 'EDT' : undefined].filter((mark) => mark);
		this.description = marks.length > 0 ? marks.join(' · ') : undefined;
		this.contextValue = `artifacts${artifactType.charAt(0).toUpperCase()}${artifactType.slice(1)}${_isBinary ? 'Binary' : 'Source'}`;
		// Пакет это архив: в редакторе открывать нечего, действия в меню строки
		if (artifactType !== 'package') {
			this.command = {
				command: 'vscode.open',
				title: 'Открыть',
				arguments: [openTargetUri],
			};
		}
	}
}
