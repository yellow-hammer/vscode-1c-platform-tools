/**
 * Дерево артефактов проекта: feature-файлы, конфигурации, расширения,
 * внешние обработки и отчёты. Сканирование без привязки к фиксированным путям.
 * @module projectArtifactsView
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	scanArtifacts,
	type ArtifactsScanResult,
	type FeatureArtifact,
	type ConfigurationArtifact,
	type ExtensionArtifact,
	type ProcessorArtifact,
	type ReportArtifact,
} from './artifactsScanner';

const FEATURES_VIEW_KEY = '1c-platform-tools.artifacts.featuresView';

export type FeaturesViewMode = 'list' | 'folder';

type NonSectionArtifact =
	| ConfigurationArtifact
	| ExtensionArtifact
	| ProcessorArtifact
	| ReportArtifact;

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

	private _scanResult: ArtifactsScanResult | null = null;
	private readonly _context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext) {
		this._context = context;
	}

	async refresh(): Promise<void> {
		this._scanResult = await scanArtifacts();
		this._onDidChangeTreeData.fire(undefined);
	}

	getFeaturesViewMode(): FeaturesViewMode {
		return (
			this._context.globalState.get<FeaturesViewMode>(FEATURES_VIEW_KEY) ??
			'list'
		);
	}

	async setFeaturesViewMode(mode: FeaturesViewMode): Promise<void> {
		await this._context.globalState.update(FEATURES_VIEW_KEY, mode);
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
		if (!this._scanResult) {
			await this.refresh();
		}
		const result = this._scanResult;
		if (!result) {
			return [];
		}

		if (!element) {
			return this.getRootItems(result);
		}

		if (element instanceof SectionItem) {
			return this.getSectionChildren(element.sectionId, result);
		}

		if (element.contextValue === 'artifactsFolderGroup') {
			return (element as FolderGroupItem).children;
		}

		return [];
	}

	private getRootItems(result: ArtifactsScanResult): ArtifactTreeItem[] {
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
			{
				id: 'features',
				label: 'Тесты (VA)',
				icon: 'beaker',
				count: result.features.length,
			},
		];

		return sections.map(
			(s) => new SectionItem(s.label, s.count, s.icon, s.id)
		);
	}

	private getSectionChildren(
		sectionId: string,
		result: ArtifactsScanResult
	): ArtifactTreeItem[] {
		const viewMode = this.getFeaturesViewMode();

		switch (sectionId) {
			case 'features':
				return this.buildFeatureItems(result.features, viewMode);
			case 'configurations':
				return this.buildArtifactItems(result.configurations, viewMode);
			case 'extensions':
				return this.buildArtifactItems(result.extensions, viewMode);
			case 'processors':
				return this.buildArtifactItems(result.processors, viewMode);
			case 'reports':
				return this.buildArtifactItems(result.reports, viewMode);
			default:
				return [];
		}
	}

	private buildArtifactItems(
		items: NonSectionArtifact[],
		viewMode: FeaturesViewMode
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
					dupes.has(a.name.toLowerCase())
						? parentDirName(a.relativePath)
						: undefined
				)
			);
		}

		return this.buildHierarchy(sorted, (a) => this.artifactToItem(a));
	}

	private buildFeatureItems(
		features: FeatureArtifact[],
		viewMode: FeaturesViewMode
	): ArtifactTreeItem[] {
		const sorted = [...features].sort((a, b) =>
			a.relativePath.localeCompare(b.relativePath, undefined, {
				sensitivity: 'base',
			})
		);

		if (viewMode === 'list') {
			const dupes = collectDuplicateLabels(sorted);
			return sorted.map((a) =>
				new FeatureItem(
					a,
					dupes.has(a.name.toLowerCase())
						? parentDirName(a.relativePath)
						: undefined
				)
			);
		}

		return this.buildHierarchy(sorted, (a) => new FeatureItem(a));
	}

	private buildHierarchy<T extends { relativePath: string }>(
		items: T[],
		toItem: (a: T) => ArtifactTreeItem
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

		const tree = this.buildFolderTree(dirs, byDir, toItem);
		result.push(...tree);

		return result;
	}

	private buildFolderTree<T extends { relativePath: string }>(
		dirs: string[],
		byDir: Map<string, T[]>,
		toItem: (a: T) => ArtifactTreeItem
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

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

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
			return new FolderGroupItem(fullPath, label, children, workspaceRoot);
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
		a: NonSectionArtifact,
		parentDirDescription?: string
	): ArtifactTreeItem {
		const label = a.name;
		const icon = a.kind === 'source' ? 'folder' : 'file';
		const isBinary = a.kind === 'binary';
		return new ArtifactItem(
			a.type,
			a.uri,
			label,
			a.relativePath,
			icon,
			isBinary,
			parentDirDescription
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
	| SectionItem
	| FolderGroupItem
	| FeatureItem
	| ArtifactItem;

class SectionItem extends vscode.TreeItem {
	constructor(
		label: string,
		count: number,
		icon: string,
		public readonly sectionId: string
	) {
		super(
			label,
			count > 0
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.None
		);
		this.description = count > 0 ? String(count) : undefined;
		this.iconPath = new vscode.ThemeIcon(icon);
		this.contextValue = 'artifactsSection';
	}
}

class FolderGroupItem extends vscode.TreeItem {
	constructor(
		public readonly folderPath: string,
		label: string,
		public readonly children: ArtifactTreeItem[],
		workspaceRoot: string
	) {
		super(label, vscode.TreeItemCollapsibleState.Expanded);
		const fullPath = workspaceRoot
			? path.join(workspaceRoot, folderPath)
			: folderPath;
		this.resourceUri = vscode.Uri.file(fullPath);
		this.contextValue = 'artifactsFolderGroup';
	}
}

class FeatureItem extends vscode.TreeItem {
	constructor(
		public readonly artifact: FeatureArtifact,
		parentDirDescription?: string
	) {
		super(artifact.name, vscode.TreeItemCollapsibleState.None);
		this.resourceUri = artifact.uri;
		const tooltipMd = new vscode.MarkdownString(undefined, true);
		tooltipMd.appendCodeblock(artifact.relativePath, 'plaintext');
		if (parentDirDescription) {
			tooltipMd.appendMarkdown(`\n_Родитель: ${parentDirDescription}_`);
		}
		this.tooltip = tooltipMd;
		this.description = parentDirDescription;
		this.contextValue = 'artifactsFeature';
		this.command = {
			command: 'vscode.open',
			title: 'Открыть',
			arguments: [artifact.uri],
		};
	}
}

class ArtifactItem extends vscode.TreeItem {
	constructor(
		public readonly artifactType: string,
		public readonly uri: vscode.Uri,
		label: string,
		relativePath: string,
		icon: string,
		_isBinary: boolean,
		parentDirDescription?: string
	) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon(icon);
		this.resourceUri = uri;
		const tooltipMd = new vscode.MarkdownString(undefined, true);
		tooltipMd.appendCodeblock(relativePath, 'plaintext');
		if (parentDirDescription) {
			tooltipMd.appendMarkdown(`\n_Родитель: ${parentDirDescription}_`);
		}
		this.tooltip = tooltipMd;
		this.description = parentDirDescription;
		this.contextValue = `artifacts${artifactType.charAt(0).toUpperCase()}${artifactType.slice(1)}${_isBinary ? 'Binary' : 'Source'}`;
		this.command = {
			command: 'vscode.open',
			title: 'Открыть',
			arguments: [uri],
		};
	}
}
