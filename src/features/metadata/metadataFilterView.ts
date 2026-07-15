/**
 * Панель «Фильтры»: дерево подсистем с флажками — отбор объектов дерева метаданных.
 * Раскладка повторяет диалог «Фильтр по подсистемам» из EDT: подсистемы с флажками
 * и два переключателя охвата.
 * @module metadataFilterView
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { hasNestedSubsystems, nestedSubsystemXmls, parentSubsystemXml, type SubsystemRef } from './metadataSubsystemFilter';
import type { MetadataLeafTreeItem, MetadataTreeDataProvider } from './metadataTreeView';

export const METADATA_FILTERS_VIEW_ID = '1c-platform-tools-metadata-filters';

type FilterOptionKey = 'includeNested' | 'includeParents';

/** Узел панели «Фильтры»: подсистема либо переключатель охвата. */
export class MetadataFilterTreeItem extends vscode.TreeItem {
	constructor(
		public readonly kind: 'subsystem' | 'option',
		public readonly key: string,
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState,
		checked: boolean,
		public readonly subsystem?: SubsystemRef,
		public readonly option?: FilterOptionKey
	) {
		super(label, collapsibleState);
		this.checkboxState = checked
			? vscode.TreeItemCheckboxState.Checked
			: vscode.TreeItemCheckboxState.Unchecked;
		this.contextValue = kind === 'subsystem' ? 'metadataFilterSubsystem' : 'metadataFilterOption';
		if (kind === 'subsystem') {
			this.iconPath = new vscode.ThemeIcon('symbol-namespace');
		}
	}
}

const OPTION_LABEL: Record<FilterOptionKey, string> = {
	includeNested: 'Включать объекты из подчинённых подсистем',
	includeParents: 'Включать объекты из родительских подсистем',
};

export class MetadataFilterTreeDataProvider implements vscode.TreeDataProvider<MetadataFilterTreeItem> {
	private readonly _onDidChange = new vscode.EventEmitter<MetadataFilterTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChange.event;

	/** Отмеченные подсистемы: ключ — путь к XML. */
	private readonly _checked = new Map<string, SubsystemRef>();
	private readonly _options: Record<FilterOptionKey, boolean> = {
		includeNested: true,
		includeParents: false,
	};

	constructor(private readonly _treeProvider: MetadataTreeDataProvider) {}

	refresh(): void {
		this._onDidChange.fire(undefined);
	}

	get checkedSubsystems(): SubsystemRef[] {
		return [...this._checked.values()];
	}

	get options(): { includeNested: boolean; includeParents: boolean } {
		return { ...this._options };
	}

	/** Снимает все флажки подсистем; охват не трогаем. */
	clearChecked(): void {
		if (this._checked.size === 0) {
			return;
		}
		this._checked.clear();
		this._onDidChange.fire(undefined);
	}

	setChecked(item: MetadataFilterTreeItem, checked: boolean): void {
		if (item.kind === 'option' && item.option) {
			this._options[item.option] = checked;
			this._onDidChange.fire(undefined);
			return;
		}
		if (!item.subsystem) {
			return;
		}
		if (checked) {
			this._checked.set(item.subsystem.xmlAbs, item.subsystem);
		} else {
			this._checked.delete(item.subsystem.xmlAbs);
		}
		this._onDidChange.fire(undefined);
	}

	getTreeItem(element: MetadataFilterTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: MetadataFilterTreeItem): MetadataFilterTreeItem[] {
		if (!element) {
			return [...this.rootSubsystemItems(), ...this.optionItems()];
		}
		if (element.kind !== 'subsystem' || !element.subsystem) {
			return [];
		}
		return this.nestedItems(element.subsystem);
	}

	private optionItems(): MetadataFilterTreeItem[] {
		return (Object.keys(OPTION_LABEL) as FilterOptionKey[]).map(
			(key) =>
				new MetadataFilterTreeItem(
					'option',
					`option:${key}`,
					OPTION_LABEL[key],
					vscode.TreeItemCollapsibleState.None,
					this._options[key],
					undefined,
					key
				)
		);
	}

	private rootSubsystemItems(): MetadataFilterTreeItem[] {
		const roots = this._treeProvider
			.listSubsystemLeaves()
			.filter((leaf) => leaf.resourceUri && !parentSubsystemXml(leaf.resourceUri.fsPath))
			.map((leaf) => this.refFromLeaf(leaf))
			.filter((ref): ref is SubsystemRef => ref !== undefined);
		return this.toItems(roots);
	}

	private nestedItems(parent: SubsystemRef): MetadataFilterTreeItem[] {
		const nested = nestedSubsystemXmls(parent.xmlAbs, parent.name).map((xmlAbs) => ({
			sourceId: parent.sourceId,
			name: path.basename(xmlAbs, '.xml'),
			xmlAbs,
			configurationXmlAbs: parent.configurationXmlAbs,
			metadataRootAbs: parent.metadataRootAbs,
		}));
		return this.toItems(nested);
	}

	private toItems(refs: SubsystemRef[]): MetadataFilterTreeItem[] {
		return refs
			.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
			.map(
				(ref) =>
					new MetadataFilterTreeItem(
						'subsystem',
						ref.xmlAbs,
						ref.name,
						hasNestedSubsystems(ref.xmlAbs, ref.name)
							? vscode.TreeItemCollapsibleState.Collapsed
							: vscode.TreeItemCollapsibleState.None,
						this._checked.has(ref.xmlAbs),
						ref
					)
			);
	}

	private refFromLeaf(leaf: MetadataLeafTreeItem): SubsystemRef | undefined {
		if (!leaf.resourceUri) {
			return undefined;
		}
		return {
			sourceId: leaf.sourceId,
			name: leaf.name,
			xmlAbs: leaf.resourceUri.fsPath,
			configurationXmlAbs: leaf.configurationXmlAbs,
			metadataRootAbs: leaf.metadataRootAbs,
		};
	}
}
