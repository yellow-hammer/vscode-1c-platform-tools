/**
 * Дерево метаданных выгрузки: источники (основная конфигурация и расширения), группы и объекты (md-sparrow `project-metadata-tree`).
 * @module metadataTreeView
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { logger } from '../../shared/logger';
import { loadProjectMetadataTree, type ProjectMetadataTreeDto } from './metadataTreeService';
import { ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { runMdSparrow } from './mdSparrowRunner';
import { mdSparrowSchemaFlagFromConfigurationXml } from './mdSparrowSchemaVersion';
import {
	METADATA_OBJECT_NON_EXPANDABLE_TYPES,
	METADATA_OBJECT_SECTION_SOURCES_BY_TYPE,
	type MetadataObjectSectionSource,
} from './metadataObjectSectionProfiles';

interface MdObjectStructureDto {
	readonly kind: string;
	readonly internalName: string;
	readonly attributes: Array<{ name: string; synonymRu: string; comment: string }>;
	readonly tabularSections: Array<{
		name: string;
		synonymRu: string;
		comment: string;
		attributes: Array<{ name: string; synonymRu: string; comment: string }>;
	}>;
	readonly forms: string[];
	readonly commands: string[];
	readonly templates: string[];
	readonly values?: unknown[];
	readonly columns?: unknown[];
	readonly accountingFlags?: unknown[];
	readonly extDimensionAccountingFlags?: unknown[];
	readonly dimensions?: unknown[];
	readonly resources?: unknown[];
	readonly recalculations?: unknown[];
	readonly addressingAttributes?: unknown[];
	readonly operations?: unknown[];
	readonly urlTemplates?: unknown[];
	readonly channels?: unknown[];
	readonly tables?: unknown[];
	readonly cubes?: unknown[];
	readonly functions?: unknown[];
}

const METADATA_OBJECT_TYPE_ALIASES: Record<string, string> = {
	BusinessProcesses: 'BusinessProcess',
	Catalogs: 'Catalog',
	Documents: 'Document',
	DocumentJournals: 'DocumentJournal',
	Enums: 'Enum',
	Reports: 'Report',
	DataProcessors: 'DataProcessor',
	ChartsOfCharacteristicTypes: 'ChartOfCharacteristicTypes',
	ChartsOfAccounts: 'ChartOfAccounts',
	ChartsOfCalculationTypes: 'ChartOfCalculationTypes',
	InformationRegisters: 'InformationRegister',
	AccumulationRegisters: 'AccumulationRegister',
	AccountingRegisters: 'AccountingRegister',
	CalculationRegisters: 'CalculationRegister',
	Tasks: 'Task',
	ExternalDataSources: 'ExternalDataSource',
	ExchangePlans: 'ExchangePlan',
	FilterCriteria: 'FilterCriterion',
	SettingsStorages: 'SettingsStorage',
	WebServices: 'WebService',
	HTTPServices: 'HTTPService',
	IntegrationServices: 'IntegrationService',
};

function normalizeMetadataObjectType(objectType: string): string {
	return METADATA_OBJECT_TYPE_ALIASES[objectType] ?? objectType;
}

const MD_PROPS_TYPES = new Set([
	'Catalog',
	'Constant',
	'Enum',
	'Document',
	'Report',
	'DataProcessor',
	'Task',
	'ChartOfAccounts',
	'ChartOfCharacteristicTypes',
	'ChartOfCalculationTypes',
	'CommonModule',
	'Subsystem',
	'SessionParameter',
	'ExchangePlan',
	'CommonAttribute',
	'CommonPicture',
	'DocumentNumerator',
	'ExternalDataSource',
	'Role',
]);

/** Корень дерева: основная конфигурация, расширение или блок внешних отчётов/обработок. */
export class MetadataSourceTreeItem extends vscode.TreeItem {
	constructor(
		public readonly sourceId: string,
		label: string,
		public readonly sourceKind: string,
		public readonly configurationXmlAbs: string | undefined,
		public readonly metadataRootAbs: string | undefined
	) {
		super(
			label,
			sourceKind === 'main'
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.Collapsed
		);
		this.contextValue = 'metadataSource';
		if (sourceKind === 'main' || sourceKind === 'extension') {
			this.contextValue = 'metadataSourceConfigLike';
		} else if (sourceKind === 'externalErf' || sourceKind === 'externalEpf') {
			this.contextValue = 'metadataSourceExternalArtifact';
		}
		this.iconPath = new vscode.ThemeIcon('root-folder');
	}
}

/** Группа типов метаданных (Общие, Справочники, …). */
export class MetadataMdGroupTreeItem extends vscode.TreeItem {
	constructor(
		public readonly sourceId: string,
		public readonly groupId: string,
		label: string,
		iconHint: string,
		hasItems: boolean,
		nestedSubgroupLayout: boolean,
		public readonly configurationXmlAbs: string | undefined,
		public readonly metadataRootAbs: string | undefined
	) {
		super(
			label,
			nestedSubgroupLayout
				? vscode.TreeItemCollapsibleState.Collapsed
				: hasItems
					? vscode.TreeItemCollapsibleState.Collapsed
					: vscode.TreeItemCollapsibleState.None
		);
		this.contextValue = contextValueForMetadataGroup(sourceId, groupId);
		this.iconPath = themeIconFromGroupHint(iconHint);
	}
}

/** Подгруппа внутри «Общие» или «Документы». */
export class MetadataMdSubgroupTreeItem extends vscode.TreeItem {
	constructor(
		public readonly sourceId: string,
		public readonly groupId: string,
		public readonly subgroupId: string,
		label: string,
		iconHint: string,
		hasItems: boolean,
		public readonly configurationXmlAbs: string | undefined,
		public readonly metadataRootAbs: string | undefined
	) {
		super(
			label,
			hasItems ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
		);
		this.contextValue = contextValueForMetadataSubgroup(sourceId, groupId, subgroupId);
		this.iconPath = themeIconFromGroupHint(iconHint);
	}
}

/** Лист: объект метаданных или внешний отчёт/обработка. */
export class MetadataLeafTreeItem extends vscode.TreeItem {
	constructor(
		public readonly sourceId: string,
		public readonly groupId: string,
		public readonly subgroupId: string | undefined,
		public readonly objectType: string,
		public readonly name: string,
		public readonly relativePath: string | undefined,
		workspaceRoot: string,
		extensionUri: vscode.Uri,
		public readonly configurationXmlAbs: string | undefined,
		public readonly metadataRootAbs: string | undefined
	) {
		const absFromRelativePath =
			relativePath && relativePath.length > 0
				? path.join(workspaceRoot, relativePath)
				: undefined;
		const normalizedObjectType = normalizeMetadataObjectType(objectType);
		const abs =
			absFromRelativePath ??
			inferMetadataObjectXmlAbsPath(normalizedObjectType, name, metadataRootAbs);
		const hasObjectPath = !!abs;
		const hasMetadataStructure = hasObjectPath && canExpandMetadataObject(normalizedObjectType);
		const hasNestedSubsystems =
			hasObjectPath && normalizedObjectType === 'Subsystem' && hasNestedSubsystemChildren(abs, name);
		super(
			name,
			hasMetadataStructure || hasNestedSubsystems
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None
		);
		if (abs) {
			this.resourceUri = vscode.Uri.file(abs);
			this.tooltip = abs;
		}
		if (abs && MD_PROPS_TYPES.has(normalizedObjectType)) {
			this.contextValue =
				normalizedObjectType === 'Subsystem' ? 'metadataObjectPropertiesSubsystem' : 'metadataObjectProperties';
		} else if (
			abs &&
			(normalizedObjectType === 'ExternalReport' || normalizedObjectType === 'ExternalDataProcessor')
		) {
			this.contextValue = 'metadataLeafFile';
		} else {
			this.contextValue = abs ? 'metadataLeaf' : 'metadataLeafNoFile';
			if (!abs) {
				this.tooltip = name;
			}
		}
		this.iconPath = metadataObjectTypeIcon(normalizedObjectType, extensionUri, groupId, subgroupId);
		this.description = '';
	}

}

const METADATA_OBJECT_XML_SUBDIR_BY_TYPE: Record<string, string> = {
	Catalog: 'Catalogs',
	Constant: 'Constants',
	Enum: 'Enums',
	Document: 'Documents',
	DocumentJournal: 'DocumentJournals',
	Report: 'Reports',
	DataProcessor: 'DataProcessors',
	Task: 'Tasks',
	ChartOfAccounts: 'ChartsOfAccounts',
	ChartOfCharacteristicTypes: 'ChartsOfCharacteristicTypes',
	ChartOfCalculationTypes: 'ChartsOfCalculationTypes',
	CommonModule: 'CommonModules',
	SessionParameter: 'SessionParameters',
	ExchangePlan: 'ExchangePlans',
	FilterCriterion: 'FilterCriteria',
	EventSubscription: 'EventSubscriptions',
	ScheduledJob: 'ScheduledJobs',
	FunctionalOption: 'FunctionalOptions',
	FunctionalOptionsParameter: 'FunctionalOptionsParameters',
	DefinedType: 'DefinedTypes',
	SettingsStorage: 'SettingsStorages',
	CommonCommand: 'CommonCommands',
	CommandGroup: 'CommandGroups',
	CommonForm: 'CommonForms',
	CommonTemplate: 'CommonTemplates',
	CommonAttribute: 'CommonAttributes',
	CommonPicture: 'CommonPictures',
	XDTOPackage: 'XDTOPackages',
	WebService: 'WebServices',
	HTTPService: 'HTTPServices',
	Interface: 'Interfaces',
	WSReference: 'WSReferences',
	WebSocketClient: 'WebSocketClients',
	IntegrationService: 'IntegrationServices',
	Bot: 'Bots',
	StyleItem: 'StyleItems',
	Style: 'Styles',
	Language: 'Languages',
	PaletteColor: 'PaletteColors',
	DocumentNumerator: 'DocumentNumerators',
	Sequence: 'Sequences',
	InformationRegister: 'InformationRegisters',
	AccumulationRegister: 'AccumulationRegisters',
	AccountingRegister: 'AccountingRegisters',
	CalculationRegister: 'CalculationRegisters',
	BusinessProcess: 'BusinessProcesses',
	ExternalDataSource: 'ExternalDataSources',
	Role: 'Roles',
};

function inferMetadataObjectXmlAbsPath(
	objectType: string,
	name: string,
	metadataRootAbs: string | undefined
): string | undefined {
	if (!metadataRootAbs || !name) {
		return undefined;
	}
	const normalizedObjectType = normalizeMetadataObjectType(objectType);
	const subdir = METADATA_OBJECT_XML_SUBDIR_BY_TYPE[normalizedObjectType];
	if (!subdir) {
		return undefined;
	}
	const candidate = path.join(metadataRootAbs, subdir, `${name}.xml`);
	return fs.existsSync(candidate) ? candidate : undefined;
}

export class MetadataSubsystemChildTreeItem extends MetadataLeafTreeItem {
	constructor(
		public readonly parentLeaf: MetadataLeafTreeItem,
		sourceId: string,
		groupId: string,
		subgroupId: string | undefined,
		objectType: string,
		name: string,
		relativePath: string | undefined,
		workspaceRoot: string,
		extensionUri: vscode.Uri,
		configurationXmlAbs: string | undefined,
		metadataRootAbs: string | undefined
	) {
		super(
			sourceId,
			groupId,
			subgroupId,
			objectType,
			name,
			relativePath,
			workspaceRoot,
			extensionUri,
			configurationXmlAbs,
			metadataRootAbs
		);
	}
}

type MetadataSectionKind =
	| 'attributes'
	| 'tabularSections'
	| 'forms'
	| 'commands'
	| 'templates'
	| 'operations'
	| 'urlTemplates'
	| 'channels'
	| 'values'
	| 'columns'
	| 'accountingFlags'
	| 'extDimensionAccountingFlags'
	| 'dimensions'
	| 'resources'
	| 'recalculations'
	| 'addressingAttributes'
	| 'tables'
	| 'cubes'
	| 'functions';
type MetadataNodeKind =
	| 'attribute'
	| 'tabularSection'
	| 'tabularAttribute'
	| 'form'
	| 'command'
	| 'template'
	| 'operation'
	| 'urlTemplate'
	| 'channel'
	| 'value'
	| 'column'
	| 'accountingFlag'
	| 'extDimensionAccountingFlag'
	| 'dimension'
	| 'resource'
	| 'recalculation'
	| 'addressingAttribute'
	| 'table'
	| 'cube'
	| 'function';

type MdNamedNode = { name: string; synonymRu: string; comment: string };
type MdTabularSection = { name: string; synonymRu: string; comment: string; attributes: MdNamedNode[] };

interface MetadataSectionSpec {
	readonly kind: MetadataSectionKind;
	readonly title: string;
	readonly nodeKind: MetadataNodeKind;
	readonly source: MetadataObjectSectionSource;
}

const SECTION_SPEC_META_BY_SOURCE: Record<
	MetadataObjectSectionSource,
	{ kind: MetadataSectionKind; title: string; nodeKind: MetadataNodeKind }
> = {
	attributes: { kind: 'attributes', title: 'Реквизиты', nodeKind: 'attribute' },
	tabularSections: { kind: 'tabularSections', title: 'Табличные части', nodeKind: 'tabularSection' },
	forms: { kind: 'forms', title: 'Формы', nodeKind: 'form' },
	commands: { kind: 'commands', title: 'Команды', nodeKind: 'command' },
	templates: { kind: 'templates', title: 'Макеты', nodeKind: 'template' },
	values: { kind: 'values', title: 'Значения', nodeKind: 'value' },
	columns: { kind: 'columns', title: 'Графы', nodeKind: 'column' },
	accountingFlags: { kind: 'accountingFlags', title: 'Признаки учета', nodeKind: 'accountingFlag' },
	extDimensionAccountingFlags: {
		kind: 'extDimensionAccountingFlags',
		title: 'Признаки учета субконто',
		nodeKind: 'extDimensionAccountingFlag',
	},
	dimensions: { kind: 'dimensions', title: 'Измерения', nodeKind: 'dimension' },
	resources: { kind: 'resources', title: 'Ресурсы', nodeKind: 'resource' },
	recalculations: { kind: 'recalculations', title: 'Перерасчеты', nodeKind: 'recalculation' },
	addressingAttributes: { kind: 'addressingAttributes', title: 'Реквизиты адресации', nodeKind: 'addressingAttribute' },
	operations: { kind: 'operations', title: 'Операции', nodeKind: 'operation' },
	urlTemplates: { kind: 'urlTemplates', title: 'Шаблоны URL', nodeKind: 'urlTemplate' },
	channels: { kind: 'channels', title: 'Каналы', nodeKind: 'channel' },
	tables: { kind: 'tables', title: 'Таблицы', nodeKind: 'table' },
	cubes: { kind: 'cubes', title: 'Кубы', nodeKind: 'cube' },
	functions: { kind: 'functions', title: 'Функции', nodeKind: 'function' },
};

function sectionSpecFromSource(source: MetadataObjectSectionSource): MetadataSectionSpec {
	const meta = SECTION_SPEC_META_BY_SOURCE[source];
	return {
		kind: meta.kind,
		title: meta.title,
		nodeKind: meta.nodeKind,
		source,
	};
}

function buildObjectSectionSpecByType(): Record<string, readonly MetadataSectionSpec[]> {
	const out: Record<string, readonly MetadataSectionSpec[]> = {};
	for (const [objectType, sources] of Object.entries(METADATA_OBJECT_SECTION_SOURCES_BY_TYPE)) {
		out[objectType] = sources.map(sectionSpecFromSource);
	}
	return out;
}

const OBJECT_SECTION_NON_EXPANDABLE_TYPES = new Set<string>(
	METADATA_OBJECT_NON_EXPANDABLE_TYPES.map((type) => normalizeMetadataObjectType(type))
);

const OBJECT_SECTION_SPEC_BY_TYPE = buildObjectSectionSpecByType();

const MD_SPARROW_STRUCTURE_SUPPORTED_OBJECT_TYPES = new Set<string>(
	Object.keys(METADATA_OBJECT_SECTION_SOURCES_BY_TYPE).map((type) => normalizeMetadataObjectType(type))
);

export class MetadataObjectSectionTreeItem extends vscode.TreeItem {
	constructor(
		public readonly key: string,
		public readonly sectionKind: MetadataSectionKind,
		label: string,
		hasChildren: boolean,
		extensionUri: vscode.Uri,
		public readonly owner: MetadataLeafTreeItem
	) {
		super(label, hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		if (sectionKind === 'attributes') {
			this.contextValue = 'metadataAttributesSection';
		} else if (sectionKind === 'tabularSections') {
			this.contextValue = 'metadataTabularSectionsSection';
		} else {
			this.contextValue = 'metadataObjectSection';
		}
		this.iconPath = metadataSectionIcon(sectionKind, extensionUri);
	}
}

export class MetadataObjectNodeTreeItem extends vscode.TreeItem {
	constructor(
		public readonly key: string,
		public readonly nodeKind: MetadataNodeKind,
		public readonly name: string,
		label: string,
		hasChildren: boolean,
		extensionUri: vscode.Uri,
		public readonly owner: MetadataLeafTreeItem,
		public readonly tabularSectionName?: string
	) {
		super(label, hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		if (nodeKind === 'attribute') {
			this.contextValue = 'metadataAttribute';
			this.iconPath = metadataSvgIcon(extensionUri, 'attribute.svg');
			return;
		}
		if (nodeKind === 'tabularSection') {
			this.contextValue = 'metadataTabularSection';
			this.iconPath = metadataSvgIcon(extensionUri, 'tabularSection.svg');
			return;
		}
		if (nodeKind === 'tabularAttribute') {
			this.contextValue = 'metadataTabularAttribute';
			this.iconPath = metadataSvgIcon(extensionUri, 'attribute.svg');
			return;
		}
		this.contextValue = 'metadataObjectChildReadonly';
		this.iconPath = metadataNodeKindIcon(nodeKind, extensionUri);
	}
}

function metadataSectionIcon(
	sectionKind: MetadataSectionKind,
	extensionUri: vscode.Uri
): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
	const iconBySectionKind: Record<MetadataSectionKind, string> = {
		attributes: 'attribute.svg',
		tabularSections: 'tabularSection.svg',
		forms: 'form.svg',
		commands: 'command.svg',
		templates: 'template.svg',
		operations: 'operation.svg',
		urlTemplates: 'urlTemplate.svg',
		channels: 'wsLink.svg',
		values: 'attribute.svg',
		columns: 'column.svg',
		accountingFlags: 'accountingFlag.svg',
		extDimensionAccountingFlags: 'extDimensionAccountingFlag.svg',
		dimensions: 'dimension.svg',
		resources: 'resource.svg',
		recalculations: 'sequence.svg',
		addressingAttributes: 'attribute.svg',
		tables: 'tabularSection.svg',
		cubes: 'catalog.svg',
		functions: 'command.svg',
	};
	return metadataSvgIcon(extensionUri, iconBySectionKind[sectionKind] ?? 'common.svg');
}

function metadataSvgIcon(
	extensionUri: vscode.Uri,
	fileName: string
): { light: vscode.Uri; dark: vscode.Uri } {
	const lightFsPath = path.join(extensionUri.fsPath, 'resources', 'metadata-tree-icons', fileName);
	const darkFsPath = path.join(
		extensionUri.fsPath,
		'resources',
		'metadata-tree-icons',
		'dark',
		fileName
	);
	const lightUri = vscode.Uri.file(lightFsPath);
	const darkUri = fs.existsSync(darkFsPath) ? vscode.Uri.file(darkFsPath) : lightUri;
	return { light: lightUri, dark: darkUri };
}

function metadataNodeKindIcon(
	nodeKind: MetadataNodeKind,
	extensionUri: vscode.Uri
): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
	const iconByNodeKind: Record<MetadataNodeKind, string> = {
		attribute: 'attribute.svg',
		tabularSection: 'tabularSection.svg',
		tabularAttribute: 'attribute.svg',
		form: 'form.svg',
		command: 'command.svg',
		template: 'template.svg',
		operation: 'operation.svg',
		urlTemplate: 'urlTemplate.svg',
		channel: 'wsLink.svg',
		value: 'attribute.svg',
		column: 'column.svg',
		accountingFlag: 'accountingFlag.svg',
		extDimensionAccountingFlag: 'extDimensionAccountingFlag.svg',
		dimension: 'dimension.svg',
		resource: 'resource.svg',
		recalculation: 'sequence.svg',
		addressingAttribute: 'attribute.svg',
		table: 'tabularSection.svg',
		cube: 'catalog.svg',
		function: 'command.svg',
	};
	return metadataSvgIcon(extensionUri, iconByNodeKind[nodeKind] ?? 'common.svg');
}

function sectionSpecsForObjectType(objectType: string): readonly MetadataSectionSpec[] {
	const normalizedObjectType = normalizeMetadataObjectType(objectType);
	if (OBJECT_SECTION_NON_EXPANDABLE_TYPES.has(normalizedObjectType)) {
		return [];
	}
	return OBJECT_SECTION_SPEC_BY_TYPE[normalizedObjectType] ?? [];
}

function canExpandMetadataObject(objectType: string): boolean {
	return sectionSpecsForObjectType(objectType).length > 0;
}

function hasNestedSubsystemChildren(subsystemXmlAbs: string, subsystemName: string): boolean {
	const nestedDir = path.join(path.dirname(subsystemXmlAbs), subsystemName, 'Subsystems');
	if (!fs.existsSync(nestedDir)) {
		return false;
	}
	try {
		return fs
			.readdirSync(nestedDir, { withFileTypes: true })
			.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.xml'));
	} catch {
		return false;
	}
}

function objectStructureValueAsName(value: unknown): string {
	if (typeof value === 'string') {
		return value.trim();
	}
	if (typeof value !== 'object' || value === null) {
		return '';
	}
	const record = value as Record<string, unknown>;
	for (const key of ['name', 'Name', 'value', 'Value']) {
		const raw = record[key];
		if (typeof raw === 'string' && raw.trim().length > 0) {
			return raw.trim();
		}
	}
	return '';
}

function objectStructureStringList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const names = value.map(objectStructureValueAsName).filter((name) => name.length > 0);
	return Array.from(new Set(names));
}

function objectStructureNamedList(value: unknown): MdNamedNode[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: MdNamedNode[] = [];
	for (const item of value) {
		const name = objectStructureValueAsName(item);
		if (!name) {
			continue;
		}
		if (typeof item === 'object' && item !== null) {
			const record = item as Record<string, unknown>;
			out.push({
				name,
				synonymRu: typeof record.synonymRu === 'string' ? record.synonymRu : '',
				comment: typeof record.comment === 'string' ? record.comment : '',
			});
			continue;
		}
		out.push({ name, synonymRu: '', comment: '' });
	}
	return out;
}

function objectStructureTabularSectionsList(value: unknown): MdTabularSection[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: MdTabularSection[] = [];
	for (const item of value) {
		if (typeof item !== 'object' || item === null) {
			continue;
		}
		const record = item as Record<string, unknown>;
		const name = objectStructureValueAsName(record.name ?? record.Name ?? record);
		if (!name) {
			continue;
		}
		out.push({
			name,
			synonymRu: typeof record.synonymRu === 'string' ? record.synonymRu : '',
			comment: typeof record.comment === 'string' ? record.comment : '',
			attributes: objectStructureNamedList(record.attributes),
		});
	}
	return out;
}

function objectStructureItemsForSection(dto: MdObjectStructureDto, source: MetadataSectionSpec['source']): string[] {
	switch (source) {
		case 'attributes':
			return objectStructureNamedList(dto.attributes).map((it) => it.name);
		case 'forms':
			return objectStructureStringList(dto.forms);
		case 'commands':
			return objectStructureStringList(dto.commands);
		case 'templates':
			return objectStructureStringList(dto.templates);
		case 'values':
			return objectStructureStringList(dto.values);
		case 'columns':
			return objectStructureStringList(dto.columns);
		case 'accountingFlags':
			return objectStructureStringList(dto.accountingFlags);
		case 'extDimensionAccountingFlags':
			return objectStructureStringList(dto.extDimensionAccountingFlags);
		case 'dimensions':
			return objectStructureStringList(dto.dimensions);
		case 'resources':
			return objectStructureStringList(dto.resources);
		case 'recalculations':
			return objectStructureStringList(dto.recalculations);
		case 'addressingAttributes':
			return objectStructureStringList(dto.addressingAttributes);
		case 'operations':
			return objectStructureStringList(dto.operations);
		case 'urlTemplates':
			return objectStructureStringList(dto.urlTemplates);
		case 'channels':
			return objectStructureStringList(dto.channels);
		case 'tables':
			return objectStructureStringList(dto.tables);
		case 'cubes':
			return objectStructureStringList(dto.cubes);
		case 'functions':
			return objectStructureStringList(dto.functions);
		case 'tabularSections':
			return objectStructureTabularSectionsList(dto.tabularSections).map((it) => it.name);
	}
}

const METADATA_OBJECT_TYPE_ICON_BY_TYPE: Record<string, string> = {
	Subsystem: 'subsystem.svg',
	CommonModule: 'commonModule.svg',
	SessionParameter: 'sessionParameter.svg',
	Role: 'role.svg',
	CommonAttribute: 'attribute.svg',
	FilterCriterion: 'filterCriteria.svg',
	ExchangePlan: 'exchangePlan.svg',
	EventSubscription: 'eventSubscription.svg',
	ScheduledJob: 'scheduledJob.svg',
	FunctionalOption: 'parameter.svg',
	FunctionalOptionsParameter: 'parameter.svg',
	DefinedType: 'enum.svg',
	CommonCommand: 'command.svg',
	CommandGroup: 'command.svg',
	CommonForm: 'form.svg',
	CommonTemplate: 'template.svg',
	CommonPicture: 'picture.svg',
	XDTOPackage: 'ws.svg',
	WebService: 'ws.svg',
	HTTPService: 'http.svg',
	WSReference: 'wsLink.svg',
	Interface: 'form.svg',
	WebSocketClient: 'wsLink.svg',
	IntegrationService: 'wsLink.svg',
	Bot: 'wsLink.svg',
	StyleItem: 'style.svg',
	Style: 'style.svg',
	Language: 'subsystem.svg',
	PaletteColor: 'style.svg',
	SettingsStorage: 'externalDataSource.svg',
	Constant: 'constant.svg',
	Catalog: 'catalog.svg',
	Document: 'document.svg',
	DocumentNumerator: 'documentNumerator.svg',
	Sequence: 'sequence.svg',
	DocumentJournal: 'documentJournal.svg',
	Enum: 'enum.svg',
	Report: 'report.svg',
	DataProcessor: 'dataProcessor.svg',
	ChartOfCharacteristicTypes: 'chartsOfCharacteristicType.svg',
	ChartOfAccounts: 'chartsOfAccount.svg',
	ChartOfCalculationTypes: 'chartsOfCalculationType.svg',
	InformationRegister: 'informationRegister.svg',
	AccumulationRegister: 'accumulationRegister.svg',
	AccountingRegister: 'accountingRegister.svg',
	CalculationRegister: 'calculationRegister.svg',
	BusinessProcess: 'businessProcess.svg',
	Task: 'task.svg',
	ExternalDataSource: 'externalDataSource.svg',
	ExternalReport: 'report.svg',
	ExternalDataProcessor: 'dataProcessor.svg',
};

const METADATA_CONTAINER_OBJECT_TYPE_BY_ID: Record<string, string> = {
	subsystems: 'Subsystem',
	common_subsystem: 'Subsystem',
	commonModules: 'CommonModule',
	common_commonmodule: 'CommonModule',
	sessionParameters: 'SessionParameter',
	common_sessionparam: 'SessionParameter',
	roles: 'Role',
	common_role: 'Role',
	commonAttributes: 'CommonAttribute',
	common_commonattribute: 'CommonAttribute',
	exchangePlans: 'ExchangePlan',
	common_exchangeplan: 'ExchangePlan',
	filterCriteria: 'FilterCriterion',
	common_filtercriterion: 'FilterCriterion',
	eventSubscriptions: 'EventSubscription',
	common_eventsubscription: 'EventSubscription',
	scheduledJobs: 'ScheduledJob',
	common_scheduledjob: 'ScheduledJob',
	commonForms: 'CommonForm',
	common_commonform: 'CommonForm',
	commonTemplates: 'CommonTemplate',
	common_commontemplate: 'CommonTemplate',
	commonPictures: 'CommonPicture',
	common_commonpicture: 'CommonPicture',
	common_xdtopackage: 'XDTOPackage',
	webServices: 'WebService',
	common_webservice: 'WebService',
	httpServices: 'HTTPService',
	common_httpservice: 'HTTPService',
	wsReferences: 'WSReference',
	common_wsreference: 'WSReference',
	common_websocketclient: 'WebSocketClient',
	common_integrationservice: 'IntegrationService',
	common_bot: 'Bot',
	styles: 'Style',
	common_styleitem: 'StyleItem',
	common_style: 'Style',
	common_language: 'Language',
	common_palettecolor: 'PaletteColor',
	common_settingsstorage: 'SettingsStorage',
	common_commoncommand: 'CommonCommand',
	common_commandgroup: 'CommandGroup',
	common_functionaloption: 'FunctionalOption',
	common_functionaloptionsparam: 'FunctionalOptionsParameter',
	common_definedtype: 'DefinedType',
	common_interface: 'Interface',
	constants: 'Constant',
	catalogs: 'Catalog',
	documents: 'Document',
	documentNumerators: 'DocumentNumerator',
	sequences: 'Sequence',
	documentJournals: 'DocumentJournal',
	enums: 'Enum',
	reports: 'Report',
	dataProcessors: 'DataProcessor',
	chartOfCharacteristicTypes: 'ChartOfCharacteristicTypes',
	chartsOfCharacteristicTypes: 'ChartOfCharacteristicTypes',
	chartOfAccounts: 'ChartOfAccounts',
	chartsOfAccounts: 'ChartOfAccounts',
	chartOfCalculationTypes: 'ChartOfCalculationTypes',
	chartsOfCalculationTypes: 'ChartOfCalculationTypes',
	informationRegisters: 'InformationRegister',
	accumulationRegisters: 'AccumulationRegister',
	accountingRegisters: 'AccountingRegister',
	calculationRegisters: 'CalculationRegister',
	businessProcesses: 'BusinessProcess',
	tasks: 'Task',
	externalDataSources: 'ExternalDataSource',
};

function metadataObjectTypeIconFileName(
	objectType: string,
	_groupId?: string,
	_subgroupId?: string
): string {
	const normalizedObjectType = normalizeMetadataObjectType(objectType);
	return METADATA_OBJECT_TYPE_ICON_BY_TYPE[normalizedObjectType] ?? 'common.svg';
}

function preferredObjectType(
	groupOrSubgroupId: string,
	items: readonly { objectType: string }[]
): string | undefined {
	const candidate = items[0]?.objectType ?? METADATA_CONTAINER_OBJECT_TYPE_BY_ID[groupOrSubgroupId];
	return candidate ? normalizeMetadataObjectType(candidate) : undefined;
}

function metadataObjectTypeIcon(
	objectType: string,
	extensionUri: vscode.Uri,
	groupId?: string,
	subgroupId?: string
): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
	const fileName = metadataObjectTypeIconFileName(objectType, groupId, subgroupId);
	return metadataSvgIcon(extensionUri, fileName);
}

function metadataGroupIcon(
	groupOrSubgroupId: string,
	extensionUri: vscode.Uri,
	iconHint: string,
	representativeObjectType?: string
): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
	// Если в группе уже есть листья, иконка группы должна совпадать с их объектной иконкой.
	if (representativeObjectType) {
		const fileName = metadataObjectTypeIconFileName(representativeObjectType, groupOrSubgroupId, groupOrSubgroupId);
		return metadataSvgIcon(extensionUri, fileName);
	}

	const byId: Record<string, string> = {
		common: 'common.svg',
	};
	const byHint: Record<string, string> = {
		'symbol-namespace': 'subsystem.svg',
		'symbol-numeric': 'documentNumerator.svg',
		'symbol-color': 'style.svg',
		person: 'role.svg',
		'symbol-method': 'commonModule.svg',
		globe: 'ws.svg',
		terminal: 'commonModule.svg',
		layout: 'form.svg',
		plug: 'wsLink.svg',
		library: 'catalog.svg',
		file: 'document.svg',
		book: 'report.svg',
		bracket: 'enum.svg',
		graph: 'businessProcess.svg',
		tools: 'dataProcessor.svg',
		table: 'informationRegister.svg',
		account: 'accountingRegister.svg',
		layers: 'sequence.svg',
		tasklist: 'task.svg',
		database: 'externalDataSource.svg',
		report: 'report.svg',
		'run-below': 'eventSubscription.svg',
	};
	const fileName = byId[groupOrSubgroupId] ?? byHint[iconHint] ?? 'folder.svg';
	return metadataSvgIcon(extensionUri, fileName);
}

function metadataSourceIcon(
	sourceKind: string,
	extensionUri: vscode.Uri
): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
	if (sourceKind === 'externalErf') {
		return metadataSvgIcon(extensionUri, 'report.svg');
	}
	if (sourceKind === 'externalEpf') {
		return metadataSvgIcon(extensionUri, 'dataProcessor.svg');
	}
	return metadataSvgIcon(extensionUri, 'folder.svg');
}

function contextValueForMetadataGroup(sourceId: string, groupId: string): string {
	const main = sourceId === 'main';
	return main ? `metadataGroup_${groupId}` : `metadataGroupExt_${groupId}`;
}

function contextValueForMetadataSubgroup(
	sourceId: string,
	groupId: string,
	subgroupId: string
): string {
	const main = sourceId === 'main';
	return main
		? `metadataSubgroup_${groupId}_${subgroupId}`
		: `metadataSubgroupExt_${groupId}_${subgroupId}`;
}

function themeIconFromGroupHint(hint: string): vscode.ThemeIcon {
	const map: Record<string, string> = {
		'symbol-namespace': 'symbol-namespace',
		'symbol-numeric': 'symbol-numeric',
		'symbol-color': 'palette',
		person: 'person',
		'symbol-method': 'symbol-method',
		globe: 'globe',
		'symbol-misc': 'symbol-misc',
		terminal: 'terminal',
		layout: 'layout-panel',
		plug: 'plug',
		library: 'library',
		file: 'file',
		book: 'book',
		bracket: 'symbol-enum',
		graph: 'graph',
		tools: 'tools',
		table: 'table',
		account: 'account',
		layers: 'layers',
		'circle-outline': 'circle-outline',
		'symbol-operator': 'symbol-operator',
		'git-branch': 'git-branch',
		tasklist: 'tasklist',
		database: 'database',
		report: 'report',
		'run-below': 'symbol-event',
		question: 'question',
	};
	const id = map[hint] ?? 'folder';
	return new vscode.ThemeIcon(id);
}

export class MetadataTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private readonly _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChange.event;

	private _dto: ProjectMetadataTreeDto | undefined;
	private _lastError: string | undefined;
	private _workspaceRoot: string | undefined;
	private _subsystemFilter:
		| {
				readonly subsystemName: string;
				readonly allowedObjectNames: ReadonlySet<string>;
				readonly allowedObjectKeys?: ReadonlySet<string>;
				readonly allowedSubsystemNames?: ReadonlySet<string>;
		  }
		| undefined;

	/** Кэш последнего успешного дерева (для API). */
	private _sourceItems: MetadataSourceTreeItem[] = [];
	private readonly _groupsBySource = new Map<string, MetadataMdGroupTreeItem[]>();
	private readonly _subgroupsByGroup = new Map<string, MetadataMdSubgroupTreeItem[]>();
	private readonly _leavesByGroup = new Map<string, MetadataLeafTreeItem[]>();
	private readonly _leavesBySubgroup = new Map<string, MetadataLeafTreeItem[]>();
	/** Источники внешних отчётов/обработок: листья сразу под корнем, без групп. */
	private readonly _flatLeavesBySource = new Map<string, MetadataLeafTreeItem[]>();
	private readonly _objectSectionsByLeaf = new Map<string, MetadataObjectSectionTreeItem[]>();
	private readonly _objectNodesBySection = new Map<string, MetadataObjectNodeTreeItem[]>();
	private readonly _tabularAttrsByNode = new Map<string, MetadataObjectNodeTreeItem[]>();
	private readonly _nestedSubsystemChildrenByLeaf = new Map<string, MetadataSubsystemChildTreeItem[]>();
	private readonly _subsystemsBySource = new Map<string, Map<string, MetadataLeafTreeItem>>();

	constructor(private readonly _context: vscode.ExtensionContext) {}

	/**
	 * Последнее дерево после успешного refresh; иначе `undefined`.
	 */
	getCachedTree(): ProjectMetadataTreeDto | undefined {
		return this._dto;
	}

	private workspaceRoot(): string | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	}

	resolveCfRoot(): string | undefined {
		const root = this.workspaceRoot();
		if (!root) {
			return undefined;
		}
		const vm = VRunnerManager.getInstance(this._context);
		const rel = vm.getCfPath();
		return path.normalize(path.join(root, rel));
	}

	get configurationXml(): string | undefined {
		const cf = this.resolveCfRoot();
		if (!cf) {
			return undefined;
		}
		return path.join(cf, 'Configuration.xml');
	}

	async refresh(): Promise<void> {
		this._lastError = undefined;
		this._dto = undefined;
		this._sourceItems = [];
		this._groupsBySource.clear();
		this._subgroupsByGroup.clear();
		this._leavesByGroup.clear();
		this._leavesBySubgroup.clear();
		this._flatLeavesBySource.clear();
		this._objectSectionsByLeaf.clear();
		this._objectNodesBySection.clear();
		this._tabularAttrsByNode.clear();
		this._nestedSubsystemChildrenByLeaf.clear();
		this._subsystemsBySource.clear();

		const root = this.workspaceRoot();
		this._workspaceRoot = root;
		if (!root) {
			this._lastError = 'Нет открытой папки workspace';
			this._onDidChange.fire(undefined);
			return;
		}

		try {
			this._dto = await loadProjectMetadataTree(this._context, root);
			this.rebuildItemCache(root, this._dto);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			logger.error(`metadata tree: ${msg}`);
			this._lastError = msg;
		}
		this._onDidChange.fire(undefined);
	}

	setSubsystemFilter(
		subsystemName: string,
		allowedObjectNames: ReadonlySet<string>,
		allowedObjectKeys?: ReadonlySet<string>,
		allowedSubsystemNames?: ReadonlySet<string>
	): void {
		this._subsystemFilter = { subsystemName, allowedObjectNames, allowedObjectKeys, allowedSubsystemNames };
		this._onDidChange.fire(undefined);
	}

	clearSubsystemFilter(): void {
		if (!this._subsystemFilter) {
			return;
		}
		this._subsystemFilter = undefined;
		this._onDidChange.fire(undefined);
	}

	getSubsystemFilterName(): string | undefined {
		return this._subsystemFilter?.subsystemName;
	}

	private rebuildItemCache(workspaceRoot: string, dto: ProjectMetadataTreeDto): void {
		this._sourceItems = [];
		this._groupsBySource.clear();
		this._subgroupsByGroup.clear();
		this._leavesByGroup.clear();
		this._leavesBySubgroup.clear();
		this._flatLeavesBySource.clear();
		this._objectSectionsByLeaf.clear();
		this._objectNodesBySection.clear();
		this._tabularAttrsByNode.clear();
		this._nestedSubsystemChildrenByLeaf.clear();
		this._subsystemsBySource.clear();
		for (const src of dto.sources) {
			const cfgRel = src.configurationXmlRelativePath;
			const cfgAbs = cfgRel.length > 0 ? path.join(workspaceRoot, cfgRel) : undefined;
			const metaAbs = path.join(workspaceRoot, src.metadataRootRelativePath);
			const sItem = new MetadataSourceTreeItem(src.id, src.label, src.kind, cfgAbs, metaAbs);
			sItem.iconPath = metadataSourceIcon(src.kind, this._context.extensionUri);
			this._sourceItems.push(sItem);

			if (isExternalArtifactSourceKind(src.kind)) {
				const flat: MetadataLeafTreeItem[] = [];
				for (const g of src.groups) {
					for (const it of g.items) {
						const rel = it.relativePath?.length ? it.relativePath : undefined;
						flat.push(
							new MetadataLeafTreeItem(
								src.id,
								g.id,
								undefined,
								it.objectType,
								it.name,
								rel,
								workspaceRoot,
								this._context.extensionUri,
								undefined,
								undefined
							)
						);
					}
				}
				this._flatLeavesBySource.set(src.id, flat);
				this._groupsBySource.set(src.id, []);
				continue;
			}

			const groups: MetadataMdGroupTreeItem[] = [];
			const subsystemsIndex = new Map<string, MetadataLeafTreeItem>();
			for (const g of src.groups) {
				const subs = g.subgroups;
				const hasNested = (subs?.length ?? 0) > 0;
				const hasFlatItems = g.items.length > 0;
				const groupHasChildren = hasNested || hasFlatItems;
				const gItem = new MetadataMdGroupTreeItem(
					src.id,
					g.id,
					g.label,
					g.iconHint,
					groupHasChildren,
					hasNested,
					cfgAbs,
					metaAbs
				);
				gItem.iconPath = metadataGroupIcon(
					g.id,
					this._context.extensionUri,
					g.iconHint,
					preferredObjectType(g.id, g.items)
				);
				groups.push(gItem);
				const gKey = groupKey(src.id, g.id);

				if (hasNested && subs) {
					const subNodes: MetadataMdSubgroupTreeItem[] = [];
					for (const sg of subs) {
						const sgItem = new MetadataMdSubgroupTreeItem(
							src.id,
							g.id,
							sg.id,
							sg.label,
							sg.iconHint,
							sg.items.length > 0,
							cfgAbs,
							metaAbs
						);
						sgItem.iconPath = metadataGroupIcon(
							sg.id,
							this._context.extensionUri,
							sg.iconHint,
							preferredObjectType(sg.id, sg.items)
						);
						subNodes.push(sgItem);
						const sk = subgroupKey(src.id, g.id, sg.id);
						const leaves: MetadataLeafTreeItem[] = [];
						for (const it of sg.items) {
							const rel = it.relativePath?.length ? it.relativePath : undefined;
							const leaf = new MetadataLeafTreeItem(
								src.id,
								g.id,
								sg.id,
								it.objectType,
								it.name,
								rel,
								workspaceRoot,
								this._context.extensionUri,
								cfgAbs,
								metaAbs
							);
							leaves.push(leaf);
							if (normalizeMetadataObjectType(it.objectType) === 'Subsystem') {
								subsystemsIndex.set(it.name, leaf);
							}
						}
						this._leavesBySubgroup.set(sk, leaves);
					}
					this._subgroupsByGroup.set(gKey, subNodes);
					const flatLeaves: MetadataLeafTreeItem[] = [];
					for (const it of g.items) {
						const rel = it.relativePath?.length ? it.relativePath : undefined;
						flatLeaves.push(
							new MetadataLeafTreeItem(
								src.id,
								g.id,
								undefined,
								it.objectType,
								it.name,
								rel,
								workspaceRoot,
								this._context.extensionUri,
								cfgAbs,
								metaAbs
							)
						);
					}
					this._leavesByGroup.set(gKey, flatLeaves);
				} else {
					const leaves: MetadataLeafTreeItem[] = [];
					for (const it of g.items) {
						const rel = it.relativePath?.length ? it.relativePath : undefined;
						leaves.push(
							new MetadataLeafTreeItem(
								src.id,
								g.id,
								undefined,
								it.objectType,
								it.name,
								rel,
								workspaceRoot,
								this._context.extensionUri,
								cfgAbs,
								metaAbs
							)
						);
					}
					this._leavesByGroup.set(gKey, leaves);
				}
			}
			this._subsystemsBySource.set(src.id, subsystemsIndex);
			this._groupsBySource.set(src.id, groups);
		}
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	resolveTreeItem(
		item: vscode.TreeItem,
		element: vscode.TreeItem,
		_token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.TreeItem> {
		if (element instanceof MetadataLeafTreeItem) {
			item.description = '';
			return item;
		}
		return undefined;
	}

	async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
		if (!this._workspaceRoot) {
			return [];
		}
		if (this._lastError && !element) {
			const errItem = new vscode.TreeItem(this._lastError, vscode.TreeItemCollapsibleState.None);
			errItem.iconPath = metadataSvgIcon(this._context.extensionUri, 'common.svg');
			return [errItem];
		}
		if (!element) {
			return [...this._sourceItems];
		}
		if (element instanceof MetadataSourceTreeItem) {
			const flat = this._flatLeavesBySource.get(element.sourceId);
			if (flat) {
				return this.filterLeaves(flat);
			}
			const groups = this._groupsBySource.get(element.sourceId) ?? [];
			return this.filterGroups(groups);
		}
		if (element instanceof MetadataMdGroupTreeItem) {
			const sk = groupKey(element.sourceId, element.groupId);
			const nested = this._subgroupsByGroup.get(sk);
			const leaves = this.filterLeaves(this._leavesByGroup.get(sk) ?? []);
			if (nested && nested.length > 0) {
				return [...this.filterSubgroups(nested), ...leaves];
			}
			return leaves;
		}
		if (element instanceof MetadataMdSubgroupTreeItem) {
			return this.filterLeaves(
				this._leavesBySubgroup.get(
					subgroupKey(element.sourceId, element.groupId, element.subgroupId)
				) ?? []
			);
		}
		if (element instanceof MetadataLeafTreeItem) {
			if (normalizeMetadataObjectType(element.objectType) === 'Subsystem') {
				return this.loadNestedSubsystemChildren(element);
			}
			return this.loadObjectStructureSections(element);
		}
		if (element instanceof MetadataObjectSectionTreeItem) {
			return this._objectNodesBySection.get(element.key) ?? [];
		}
		if (element instanceof MetadataObjectNodeTreeItem && element.nodeKind === 'tabularSection') {
			return this._tabularAttrsByNode.get(element.key) ?? [];
		}
		return [];
	}

	private filterGroups(groups: MetadataMdGroupTreeItem[]): MetadataMdGroupTreeItem[] {
		if (!this._subsystemFilter) {
			return groups;
		}
		const filtered: MetadataMdGroupTreeItem[] = [];
		for (const group of groups) {
			const key = groupKey(group.sourceId, group.groupId);
			const leaves = this.filterLeaves(this._leavesByGroup.get(key) ?? []);
			const subgroups = this.filterSubgroups(this._subgroupsByGroup.get(key) ?? []);
			if (leaves.length > 0 || subgroups.length > 0) {
				filtered.push(group);
			}
		}
		return filtered;
	}

	private filterSubgroups(subgroups: MetadataMdSubgroupTreeItem[]): MetadataMdSubgroupTreeItem[] {
		if (!this._subsystemFilter) {
			return subgroups;
		}
		const filtered: MetadataMdSubgroupTreeItem[] = [];
		for (const subgroup of subgroups) {
			const leaves = this.filterLeaves(
				this._leavesBySubgroup.get(
					subgroupKey(subgroup.sourceId, subgroup.groupId, subgroup.subgroupId)
				) ?? []
			);
			if (leaves.length > 0) {
				filtered.push(subgroup);
			}
		}
		return filtered;
	}

	private filterLeaves(leaves: MetadataLeafTreeItem[]): MetadataLeafTreeItem[] {
		if (!this._subsystemFilter) {
			return leaves;
		}
		return leaves.filter((leaf) => this.isLeafAllowedBySubsystemFilter(leaf));
	}

	private isLeafAllowedBySubsystemFilter(leaf: MetadataLeafTreeItem): boolean {
		if (!this._subsystemFilter) {
			return true;
		}
		const subsystemNames = this._subsystemFilter.allowedSubsystemNames;
		if (normalizeMetadataObjectType(leaf.objectType) === 'Subsystem') {
			if (leaf.name === this._subsystemFilter.subsystemName) {
				return true;
			}
			if (subsystemNames && subsystemNames.has(leaf.name)) {
				return true;
			}
		}
		const objectKey = `${normalizeMetadataObjectType(leaf.objectType)}.${leaf.name}`;
		const objectKeys = this._subsystemFilter.allowedObjectKeys;
		if (objectKeys && objectKeys.has(objectKey)) {
			return true;
		}
		return this._subsystemFilter.allowedObjectNames.has(leaf.name);
	}

	getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
		if (element instanceof MetadataObjectSectionTreeItem) {
			return element.owner;
		}
		if (element instanceof MetadataObjectNodeTreeItem) {
			if (element.nodeKind === 'tabularAttribute') {
				for (const [nodeKey, children] of this._tabularAttrsByNode.entries()) {
					if (children.some((it) => it.key === element.key)) {
						for (const sectionNodes of this._objectNodesBySection.values()) {
							const parent = sectionNodes.find((it) => it.key === nodeKey);
							if (parent) {
								return parent;
							}
						}
					}
				}
				return undefined;
			}
			for (const [sectionKey, children] of this._objectNodesBySection.entries()) {
				if (children.some((it) => it.key === element.key)) {
					for (const sections of this._objectSectionsByLeaf.values()) {
						const parent = sections.find((it) => it.key === sectionKey);
						if (parent) {
							return parent;
						}
					}
				}
			}
			return undefined;
		}
		if (element instanceof MetadataLeafTreeItem) {
			if (element instanceof MetadataSubsystemChildTreeItem) {
				return element.parentLeaf;
			}
			if (element.subgroupId) {
				return this._subgroupsByGroup
					.get(groupKey(element.sourceId, element.groupId))
					?.find((s) => s.subgroupId === element.subgroupId);
			}
			const groups = this._groupsBySource.get(element.sourceId);
			return groups?.find((g) => g.groupId === element.groupId);
		}
		if (element instanceof MetadataMdSubgroupTreeItem) {
			return this._groupsBySource
				.get(element.sourceId)
				?.find((g) => g.groupId === element.groupId);
		}
		if (element instanceof MetadataMdGroupTreeItem) {
			return this._sourceItems.find((s) => s.sourceId === element.sourceId);
		}
		return undefined;
	}

	private async loadObjectStructureSections(leaf: MetadataLeafTreeItem): Promise<vscode.TreeItem[]> {
		if (!leaf.resourceUri) {
			return [];
		}
		const sectionSpecs = sectionSpecsForObjectType(leaf.objectType);
		if (sectionSpecs.length === 0) {
			return [];
		}
		const leafKey = `${leaf.sourceId}|${leaf.groupId}|${leaf.subgroupId ?? ''}|${leaf.objectType}|${leaf.name}`;
		const cached = this._objectSectionsByLeaf.get(leafKey);
		if (cached) {
			return cached;
		}
		let dto: MdObjectStructureDto = {
			kind: '',
			internalName: leaf.name,
			attributes: [],
			tabularSections: [],
			forms: [],
			commands: [],
			templates: [],
		};
		if (MD_SPARROW_STRUCTURE_SUPPORTED_OBJECT_TYPES.has(normalizeMetadataObjectType(leaf.objectType))) {
			try {
				dto = await this.loadObjectStructure(leaf);
			} catch (e) {
				logger.warn(`metadata structure: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		const sections: MetadataObjectSectionTreeItem[] = [];
		for (const spec of sectionSpecs) {
			if (spec.source === 'tabularSections') {
				const tabularSections = objectStructureTabularSectionsList(dto.tabularSections);
				const tsSection = new MetadataObjectSectionTreeItem(
					`${leafKey}|${spec.kind}`,
					spec.kind,
					`${spec.title} (${tabularSections.length})`,
					tabularSections.length > 0,
					this._context.extensionUri,
					leaf
				);
				sections.push(tsSection);
				const tsNodes: MetadataObjectNodeTreeItem[] = [];
				for (const ts of tabularSections) {
					const node = new MetadataObjectNodeTreeItem(
						`${tsSection.key}|${ts.name}`,
						'tabularSection',
						ts.name,
						ts.name,
						ts.attributes.length > 0,
						this._context.extensionUri,
						leaf,
						ts.name
					);
					tsNodes.push(node);
					this._tabularAttrsByNode.set(
						node.key,
						ts.attributes.map(
							(it, index) =>
								new MetadataObjectNodeTreeItem(
									`${node.key}|${it.name}|${index}`,
									'tabularAttribute',
									it.name,
									it.name,
									false,
									this._context.extensionUri,
									leaf,
									ts.name
								)
						)
					);
				}
				this._objectNodesBySection.set(tsSection.key, tsNodes);
				continue;
			}

			const items = objectStructureItemsForSection(dto, spec.source);
			const section = new MetadataObjectSectionTreeItem(
				`${leafKey}|${spec.kind}`,
				spec.kind,
				`${spec.title} (${items.length})`,
				items.length > 0,
				this._context.extensionUri,
				leaf
			);
			sections.push(section);
			this._objectNodesBySection.set(
				section.key,
				items.map(
					(itemName, index) =>
						new MetadataObjectNodeTreeItem(
							`${section.key}|${itemName}|${index}`,
							spec.nodeKind,
							itemName,
							itemName,
							false,
							this._context.extensionUri,
							leaf
						)
				)
			);
		}
		this._objectSectionsByLeaf.set(leafKey, sections);
		return sections;
	}

	private async loadObjectStructure(leaf: MetadataLeafTreeItem): Promise<MdObjectStructureDto> {
		if (!leaf.resourceUri) {
			throw new Error('Нет данных для загрузки структуры объекта.');
		}
		let schema: string | undefined;
		if (leaf.configurationXmlAbs) {
			schema = await mdSparrowSchemaFlagFromConfigurationXml(leaf.configurationXmlAbs);
		} else {
			const schemaFromTree = this._dto?.mainSchemaVersionFlag;
			if (typeof schemaFromTree === 'string' && schemaFromTree.length > 0) {
				schema = schemaFromTree;
			}
		}
		if (!schema) {
			throw new Error('Не удалось определить схему XSD для структуры объекта.');
		}
		const runtime = await ensureMdSparrowRuntime(this._context);
		const res = await runMdSparrow(
			runtime,
			['cf-md-object-structure-get', leaf.resourceUri.fsPath, '-v', schema],
			{ cwd: leaf.metadataRootAbs ?? path.dirname(leaf.resourceUri.fsPath) }
		);
		if (res.exitCode !== 0) {
			const errText = res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`;
			throw new Error(errText);
		}
		return JSON.parse(res.stdout.trim()) as MdObjectStructureDto;
	}

	private async loadNestedSubsystemChildren(leaf: MetadataLeafTreeItem): Promise<vscode.TreeItem[]> {
		if (!leaf.resourceUri || !leaf.configurationXmlAbs || !leaf.metadataRootAbs) {
			return [];
		}
		const leafKey = this.leafCacheKey(leaf);
		const cached = this._nestedSubsystemChildrenByLeaf.get(leafKey);
		if (cached) {
			return cached;
		}
		try {
			const schema = await mdSparrowSchemaFlagFromConfigurationXml(leaf.configurationXmlAbs);
			const runtime = await ensureMdSparrowRuntime(this._context);
			const res = await runMdSparrow(runtime, ['cf-md-object-get', leaf.resourceUri.fsPath, '-v', schema], {
				cwd: leaf.metadataRootAbs,
			});
			if (res.exitCode !== 0) {
				return [];
			}
			const dto = JSON.parse(res.stdout.trim()) as { nestedSubsystems?: unknown[] };
			const nestedNames = Array.isArray(dto.nestedSubsystems)
				? dto.nestedSubsystems.filter((x): x is string => typeof x === 'string')
				: [];
			const sourceSubsystems = this._subsystemsBySource.get(leaf.sourceId) ?? new Map<string, MetadataLeafTreeItem>();
			const children: MetadataSubsystemChildTreeItem[] = [];
			for (const nestedName of nestedNames) {
				if (this.hasSubsystemAncestorWithName(leaf, nestedName)) {
					continue;
				}
				const original = sourceSubsystems.get(nestedName);
				let childTemplate: MetadataLeafTreeItem | undefined = original;
				if (!childTemplate) {
					const derived = this.deriveNestedSubsystemLeaf(leaf, nestedName);
					if (derived) {
						childTemplate = derived;
					}
				}
				if (!childTemplate) {
					continue;
				}
				children.push(
					new MetadataSubsystemChildTreeItem(
						leaf,
						childTemplate.sourceId,
						childTemplate.groupId,
						childTemplate.subgroupId,
						childTemplate.objectType,
						childTemplate.name,
						childTemplate.relativePath,
						this._workspaceRoot ?? '',
						this._context.extensionUri,
						childTemplate.configurationXmlAbs,
						childTemplate.metadataRootAbs
					)
				);
			}
			this._nestedSubsystemChildrenByLeaf.set(leafKey, children);
			return children;
		} catch {
			return [];
		}
	}

	private hasSubsystemAncestorWithName(leaf: MetadataLeafTreeItem, subsystemName: string): boolean {
		if (leaf.name === subsystemName) {
			return true;
		}
		let cursor: MetadataLeafTreeItem | undefined = leaf;
		while (cursor instanceof MetadataSubsystemChildTreeItem) {
			if (cursor.parentLeaf.name === subsystemName) {
				return true;
			}
			cursor = cursor.parentLeaf;
		}
		return false;
	}

	private leafCacheKey(leaf: MetadataLeafTreeItem): string {
		return `${leaf.sourceId}|${leaf.groupId}|${leaf.subgroupId ?? ''}|${leaf.objectType}|${leaf.name}|${leaf.relativePath ?? ''}`;
	}

	private deriveNestedSubsystemLeaf(parentLeaf: MetadataLeafTreeItem, nestedName: string): MetadataLeafTreeItem | undefined {
		if (!parentLeaf.resourceUri || !this._workspaceRoot) {
			return undefined;
		}
		const parentDir = path.dirname(parentLeaf.resourceUri.fsPath);
		const candidateAbs = path.join(parentDir, parentLeaf.name, 'Subsystems', `${nestedName}.xml`);
		if (!fs.existsSync(candidateAbs)) {
			return undefined;
		}
		const rel = path.relative(this._workspaceRoot, candidateAbs).replaceAll('\\', '/');
		return new MetadataLeafTreeItem(
			parentLeaf.sourceId,
			parentLeaf.groupId,
			parentLeaf.subgroupId,
			'Subsystem',
			nestedName,
			rel,
			this._workspaceRoot,
			this._context.extensionUri,
			parentLeaf.configurationXmlAbs,
			parentLeaf.metadataRootAbs
		);
	}
}

function groupKey(sourceId: string, groupId: string): string {
	return `${sourceId}|${groupId}`;
}

function subgroupKey(sourceId: string, groupId: string, subgroupId: string): string {
	return `${sourceId}|${groupId}|${subgroupId}`;
}

function isExternalArtifactSourceKind(kind: string): boolean {
	return kind === 'externalErf' || kind === 'externalEpf';
}
