/**
 * Дерево метаданных выгрузки: источники (основная конфигурация и расширения), группы и объекты (md-sparrow `project-metadata-tree`).
 * @module metadataTreeView
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { logger } from '../../shared/logger';
import {
	loadProjectMetadataTree,
	resolveMetadataOpen,
	type MetadataItemDto,
	type MetadataObjectOpen,
	type ProjectMetadataTreeDto,
} from './metadataTreeService';
import { ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { runMdSparrowParamsRead, supportEnabled } from './mdSparrowParams';
import { mdSparrowSchemaFlagFromConfigurationXml } from './mdSparrowSchemaVersion';
import { offerGithubTokenOnRateLimit } from '../../shared/githubToken';
import { ADOPTED_HINT, SUPPORT_HINTS, adoptedIcon, initAdoptedIcons, isAdopted, supportIcon } from './objectBelonging';
import {
	childKindIsMutatable,
	childKindOfSection,
	childKindSupportsDuplicate,
	childSupportElementKey,
} from './metadataChildMutations';
import {
	METADATA_OBJECT_NON_EXPANDABLE_TYPES,
	METADATA_SECTION_TITLE_BY_SOURCE,
	METADATA_OBJECT_SECTION_SOURCES_BY_TYPE,
	type MetadataObjectSectionSource,
} from './metadataObjectSectionProfiles';

const log = logger.scope('metadata');

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

/** Общая форма — сама объект, не узел «Формы» у справочника. */
export function isMetadataCommonForm(objectType: string): boolean {
	return normalizeMetadataObjectType(objectType) === 'CommonForm';
}

/** Вид модуля объекта метаданных, доступного для открытия из дерева. */
export type ObjectModuleKind =
	| 'object'
	| 'manager'
	| 'recordset'
	| 'valueManager'
	| 'module'
	| 'form';

interface ObjectModuleDescriptor {
	/** Путь к файлу модуля относительно каталога `<Объект>/Ext`. */
	readonly fileName: string;
	/** Токен в contextValue листа для when-условия пункта меню. */
	readonly contextToken: string;
}

const OBJECT_MODULE_DESCRIPTORS: Record<ObjectModuleKind, ObjectModuleDescriptor> = {
	object: { fileName: 'ObjectModule.bsl', contextToken: 'mdObjModule' },
	manager: { fileName: 'ManagerModule.bsl', contextToken: 'mdMgrModule' },
	recordset: { fileName: 'RecordSetModule.bsl', contextToken: 'mdRecModule' },
	valueManager: { fileName: 'ValueManagerModule.bsl', contextToken: 'mdValModule' },
	module: { fileName: 'Module.bsl', contextToken: 'mdModule' },
	form: { fileName: path.join('Form', 'Module.bsl'), contextToken: 'mdFormModule' },
};

/**
 * Виды модулей по нормализованному типу объекта (формат выгрузки конфигуратора:
 * модули лежат файлами в `<Объект>/Ext`). Набор фиксирован по типу — пункты меню
 * стабильны и не зависят от наличия файла модуля на диске. Проверено по реальной
 * выгрузке (БСП 3.1): модули нигде не объявляются в XML, только файлами в `Ext`.
 */
const OBJECT_MODULE_KINDS_BY_TYPE: Record<string, ObjectModuleKind[]> = {
	Catalog: ['object', 'manager'],
	Document: ['object', 'manager'],
	Report: ['object', 'manager'],
	DataProcessor: ['object', 'manager'],
	ChartOfCharacteristicTypes: ['object', 'manager'],
	ChartOfAccounts: ['object', 'manager'],
	ChartOfCalculationTypes: ['object', 'manager'],
	ExchangePlan: ['object', 'manager'],
	BusinessProcess: ['object', 'manager'],
	Task: ['object', 'manager'],
	InformationRegister: ['recordset', 'manager'],
	AccumulationRegister: ['recordset', 'manager'],
	AccountingRegister: ['recordset', 'manager'],
	CalculationRegister: ['recordset', 'manager'],
	DocumentJournal: ['manager'],
	Enum: ['manager'],
	FilterCriterion: ['manager'],
	SettingsStorage: ['manager'],
	Constant: ['valueManager', 'manager'],
	CommonModule: ['module'],
	HTTPService: ['module'],
	WebService: ['module'],
	CommonForm: ['form'],
};

/** Виды модулей, доступных для типа объекта метаданных (пусто — модулей нет). */
export function objectModuleKindsForType(objectType: string): ObjectModuleKind[] {
	return OBJECT_MODULE_KINDS_BY_TYPE[normalizeMetadataObjectType(objectType)] ?? [];
}

/**
 * Команда щелчка по объекту - главное содержимое: форма, модуль, иначе свойства.
 *
 * Повторный щелчок ничего не дублирует: вкладка ищется по объекту в реестре
 * открытых вкладок, поэтому двойной щелчок показывает ту же вкладку, а не вторую.
 */
export function defaultMetadataLeafOpenCommand(item: MetadataLeafTreeItem): string | undefined {
	if (!item.resourceUri) {
		return undefined;
	}
	const type = normalizeMetadataObjectType(item.objectType);
	if (isMetadataCommonForm(type)) {
		return '1c-platform-tools.metadata.openForm';
	}
	if (objectModuleKindsForType(type).includes('module')) {
		return '1c-platform-tools.metadata.openModule';
	}
	return '1c-platform-tools.metadata.openProperties';
}

function assignMetadataLeafOpenCommand(item: MetadataLeafTreeItem): void {
	const command = defaultMetadataLeafOpenCommand(item);
	if (!command) {
		return;
	}
	item.command = {
		command,
		title: 'Открыть',
		arguments: [item],
	};
}

/** У объекта бывают реквизиты или табличные части. */
export function objectAcceptsChildNodes(objectType: string): boolean {
	const sources = METADATA_OBJECT_SECTION_SOURCES_BY_TYPE[normalizeMetadataObjectType(objectType)];
	return !!sources && (sources.includes('attributes') || sources.includes('tabularSections'));
}

/** Абсолютный путь к файлу модуля объекта рядом с его XML (`<Объект>/Ext/<Модуль>.bsl`). */
export function objectModuleFilePath(
	objectXmlFsPath: string,
	objectName: string,
	kind: ObjectModuleKind
): string {
	return path.join(path.dirname(objectXmlFsPath), objectName, 'Ext', OBJECT_MODULE_DESCRIPTORS[kind].fileName);
}

/** Корень дерева: основная конфигурация, расширение или блок внешних отчётов/обработок. */
export class MetadataSourceTreeItem extends vscode.TreeItem {
	constructor(
		public readonly sourceId: string,
		label: string,
		public readonly sourceKind: string,
		public readonly configurationXmlAbs: string | undefined,
		public readonly metadataRootAbs: string | undefined,
		expanded?: boolean,
		/** Поддержка поставщика выгрузки: locked либо editable. */
		public readonly support?: string,
		/** Отпечаток правил поддержки: правка сверяется с ним. */
		public readonly supportGeneration?: string
	) {
		super(
			label,
			(expanded ?? sourceKind === 'main')
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.Collapsed
		);
		this.contextValue = 'metadataSource';
		if (sourceKind === 'main' || sourceKind === 'extension') {
			this.contextValue = 'metadataSourceConfigLike';
		} else if (sourceKind === 'externalErf' || sourceKind === 'externalEpf') {
			this.contextValue = 'metadataSourceExternalArtifact';
		}
		if (support === 'locked' || support === 'editable') {
			this.contextValue = `${this.contextValue} mdSupportRules`;
		}
		// Правило поддержки ставится и самой конфигурации, пока правила действуют
		if (support === 'editable') {
			this.contextValue = `${this.contextValue} mdSupportRule`;
		}
		this.iconPath = new vscode.ThemeIcon('root-folder');
		if (support === 'locked' || support === 'editable') {
			this.tooltip =
				support === 'locked'
					? 'Конфигурация поставщика: возможность изменения включают в конфигураторе'
					: 'Конфигурация поставщика, возможность изменения включена';
		}
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
/**
 * Файл принадлежит объекту метаданных: это сам XML объекта либо файл из каталога рядом с ним.
 * Выгрузка кладёт модули, формы и макеты объекта в каталог с тем же именем, что у XML.
 */
export function metadataObjectOwnsFile(objectXmlAbs: string, fileAbs: string): boolean {
	const object = path.normalize(objectXmlAbs);
	const file = path.normalize(fileAbs);
	if (object.toLowerCase() === file.toLowerCase()) {
		return true;
	}
	const dir = object.replace(/\.xml$/i, '') + path.sep;
	return file.toLowerCase().startsWith(dir.toLowerCase());
}

/** Каталог раздела в выгрузке -> раздел объекта в дереве. */
const SECTION_KIND_BY_OBJECT_SUBDIR: Readonly<Record<string, MetadataSectionKind>> = {
	forms: 'forms',
	commands: 'commands',
	templates: 'templates',
};

/**
 * Узел объекта, которому принадлежит файл: раздел и имя.
 *
 * Выгрузка раскладывает формы, команды и макеты одинаково: `<Объект>/<Раздел>/<Имя>.xml` рядом с
 * каталогом `<Объект>/<Раздел>/<Имя>/…`, где лежат содержимое и модуль. Поэтому и файл описания,
 * и содержимое, и модуль ведут к одному узлу дерева.
 *
 * <p>У общей формы и общего модуля такого раздела нет - они сами объекты метаданных.
 */
export function objectChildFromFilePath(
	objectXmlAbs: string,
	fileAbs: string
): { readonly sectionKind: MetadataSectionKind; readonly name: string } | undefined {
	const dir = path.normalize(objectXmlAbs).replace(/\.xml$/i, '') + path.sep;
	const file = path.normalize(fileAbs);
	if (!file.toLowerCase().startsWith(dir.toLowerCase())) {
		return undefined;
	}
	const parts = file.slice(dir.length).split(path.sep);
	const sectionKind = parts.length >= 2 ? SECTION_KIND_BY_OBJECT_SUBDIR[parts[0].toLowerCase()] : undefined;
	if (!sectionKind) {
		return undefined;
	}
	const name = parts[1].replace(/\.[^.]+$/, '');
	return name.length > 0 ? { sectionKind, name } : undefined;
}

export class MetadataLeafTreeItem extends vscode.TreeItem {
	constructor(
		public readonly sourceId: string,
		public readonly groupId: string,
		public readonly subgroupId: string | undefined,
		public readonly objectType: string,
		public readonly name: string,
		public readonly relativePath: string | undefined,
		/** Принадлежность объекта расширения; у основной конфигурации пусто. */
		public readonly objectBelonging: string | undefined,
		workspaceRoot: string,
		extensionUri: vscode.Uri,
		public readonly configurationXmlAbs: string | undefined,
		public readonly metadataRootAbs: string | undefined,
		/** Необязательная цель из дерева md-sparrow; клик работает и без неё. */
		public readonly open?: MetadataObjectOpen,
		/** Поддержка поставщика: locked - изменение запрещено, editable - разрешено. */
		public readonly support?: string,
		/** Правила поставщика открыты: смена режима объекта доступна. */
		public readonly supportRulesOpen?: boolean,
		/** Отпечаток правил поддержки: правка сверяется с ним. */
		public readonly supportGeneration?: string
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
		if (
			abs &&
			(normalizedObjectType === 'ExternalReport' || normalizedObjectType === 'ExternalDataProcessor')
		) {
			this.contextValue = 'metadataLeafFile';
		} else if (abs) {
			this.contextValue =
				normalizedObjectType === 'Subsystem' ? 'metadataObjectPropertiesSubsystem' : 'metadataObjectProperties';
		} else {
			this.contextValue = 'metadataLeafNoFile';
			this.tooltip = name;
		}
		// Стабильные токены по виду объекта, а не по наличию файла: набор пунктов меню
		// у объекта одного вида всегда одинаковый.
		if (abs) {
			const tokens: string[] = [];
			const moduleKinds = OBJECT_MODULE_KINDS_BY_TYPE[normalizedObjectType];
			if (moduleKinds) {
				tokens.push(...moduleKinds.map((kind) => OBJECT_MODULE_DESCRIPTORS[kind].contextToken));
			}
			// Пока правила поставки закрыты, конфигуратор не даёт менять режим объекта
			if (supportRulesOpen && (support === 'locked' || support === 'editable')) {
				tokens.push('mdSupportRule');
			}
			if (normalizedObjectType === 'CommonTemplate') {
				tokens.push('mdDcsOpen');
			}
			if (tokens.length > 0) {
				this.contextValue = [this.contextValue, ...tokens].join(' ');
			}
		}
		this.iconPath = metadataObjectTypeIcon(
			normalizedObjectType,
			extensionUri,
			objectBelonging,
			groupId,
			subgroupId,
			support
		);
		const hint = isAdopted(objectBelonging)
			? ADOPTED_HINT
			: support === 'locked' || support === 'editable'
				? SUPPORT_HINTS[support]
				: undefined;
		if (hint) {
			this.tooltip = this.tooltip ? `${hint}
${this.tooltip}` : hint;
		}
		this.description = '';
		assignMetadataLeafOpenCommand(this);
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
		objectBelonging: string | undefined,
		workspaceRoot: string,
		extensionUri: vscode.Uri,
		configurationXmlAbs: string | undefined,
		metadataRootAbs: string | undefined,
		open?: MetadataObjectOpen,
		support?: string,
		supportRulesOpen?: boolean,
		supportGeneration?: string
	) {
		super(
			sourceId,
			groupId,
			subgroupId,
			objectType,
			name,
			relativePath,
			objectBelonging,
			workspaceRoot,
			extensionUri,
			configurationXmlAbs,
			metadataRootAbs,
			open,
			support,
			supportRulesOpen,
			supportGeneration
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

const SECTION_NODE_KIND_BY_SOURCE: Record<
	MetadataObjectSectionSource,
	{ kind: MetadataSectionKind; nodeKind: MetadataNodeKind }
> = {
	attributes: { kind: 'attributes', nodeKind: 'attribute' },
	tabularSections: { kind: 'tabularSections', nodeKind: 'tabularSection' },
	forms: { kind: 'forms', nodeKind: 'form' },
	commands: { kind: 'commands', nodeKind: 'command' },
	templates: { kind: 'templates', nodeKind: 'template' },
	values: { kind: 'values', nodeKind: 'value' },
	columns: { kind: 'columns', nodeKind: 'column' },
	accountingFlags: { kind: 'accountingFlags', nodeKind: 'accountingFlag' },
	extDimensionAccountingFlags: { kind: 'extDimensionAccountingFlags', nodeKind: 'extDimensionAccountingFlag' },
	dimensions: { kind: 'dimensions', nodeKind: 'dimension' },
	resources: { kind: 'resources', nodeKind: 'resource' },
	recalculations: { kind: 'recalculations', nodeKind: 'recalculation' },
	addressingAttributes: { kind: 'addressingAttributes', nodeKind: 'addressingAttribute' },
	operations: { kind: 'operations', nodeKind: 'operation' },
	urlTemplates: { kind: 'urlTemplates', nodeKind: 'urlTemplate' },
	channels: { kind: 'channels', nodeKind: 'channel' },
	tables: { kind: 'tables', nodeKind: 'table' },
	cubes: { kind: 'cubes', nodeKind: 'cube' },
	functions: { kind: 'functions', nodeKind: 'function' },
};

function sectionSpecFromSource(source: MetadataObjectSectionSource): MetadataSectionSpec {
	const meta = SECTION_NODE_KIND_BY_SOURCE[source];
	return {
		kind: meta.kind,
		title: METADATA_SECTION_TITLE_BY_SOURCE[source],
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
		// Токен вместо перечисления видов в условиях меню: новый вид раздела
		// получает пункт «Добавить» сам, как только md-sparrow научится его создавать
		this.contextValue =
			childKindOfSection(sectionKind) || sectionKind === 'forms'
				? 'metadataObjectSection mdSectionAdd'
				: 'metadataObjectSection';
		this.iconPath = ownerAwareIcon(metadataSectionIcon(sectionKind, extensionUri), owner);
	}
}

/** Замочек владельца распространяется на его разделы и узлы состава. */
function ownerAwareIcon(
	icon: vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri },
	owner: MetadataLeafTreeItem,
	ownSupport?: string,
	ownFile = true
): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
	const support = childNodeSupport(owner.support, ownSupport, ownFile);
	if (icon instanceof vscode.ThemeIcon) {
		return icon;
	}
	return supportIcon(icon, support ?? '');
}

/**
 * Действующее правило узла состава.
 *
 * Своё правило важнее правила объекта, пока у узла свой файл: форму разрешают
 * отдельно. Элемент живёт в файле объекта, поэтому запрет объекта закрывает и
 * его - правка всё равно пишет в закрытый файл.
 *
 * @param ownFile У узла свой файл выгрузки: форма, макет.
 */
export function childNodeSupport(
	ownerSupport: string | undefined,
	ownSupport: string | undefined,
	ownFile: boolean
): string | undefined {
	if (ownSupport === undefined) {
		return ownerSupport;
	}
	if (ownFile) {
		return ownSupport;
	}
	return ownerSupport === 'locked' ? 'locked' : ownSupport;
}

/**
 * contextValue узла состава: вид узла плюс токены возможностей.
 *
 * Меню отбирает по токенам, поэтому подключение нового вида к md-sparrow не
 * требует правки условий в манифесте.
 */
export function childNodeContextValue(nodeKind: MetadataNodeKind): string {
	const parts = [`metadataChild_${nodeKind}`];
	if (nodeKind === 'form') {
		parts.push('metadataObjectForm', 'mdFormModule', 'mdChildDelete');
	}
	if (childKindIsMutatable(nodeKind)) {
		parts.push('mdChildEdit');
	}
	if (childKindSupportsDuplicate(nodeKind)) {
		parts.push('mdChildDuplicate');
	}
	if (nodeKind === 'tabularSection') {
		parts.push('mdChildAdd');
	}
	return parts.join(' ');
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
		public readonly tabularSectionName?: string,
		/** Своё правило поддержки: у формы и макета оно отдельное от объекта. */
		public readonly support?: string
	) {
		super(label, hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		this.contextValue = childNodeContextValue(nodeKind);
		const ownFile = nodeKind === 'form' || nodeKind === 'template';
		const effectiveSupport = childNodeSupport(owner.support, support, ownFile);
		if (owner.supportRulesOpen && (effectiveSupport === 'locked' || effectiveSupport === 'editable')) {
			this.contextValue = `${this.contextValue} mdSupportRule`;
		}
		if (nodeKind === 'attribute' || nodeKind === 'tabularAttribute') {
			this.iconPath = ownerAwareIcon(metadataSvgIcon(extensionUri, 'attribute.svg'), owner, support, ownFile);
			return;
		}
		if (nodeKind === 'tabularSection') {
			this.iconPath = ownerAwareIcon(metadataSvgIcon(extensionUri, 'tabularSection.svg'), owner, support, ownFile);
			return;
		}
		this.iconPath = ownerAwareIcon(metadataNodeKindIcon(nodeKind, extensionUri), owner, support, ownFile);
		if (nodeKind === 'form') {
			this.command = {
				command: '1c-platform-tools.metadata.openForm',
				title: 'Открыть форму',
				arguments: [this],
			};
		}
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
	FunctionalOption: 'functionalOption.svg',
	FunctionalOptionsParameter: 'functionalOptionsParameter.svg',
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
	objectBelonging: string | undefined,
	groupId?: string,
	subgroupId?: string,
	support?: string
): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
	const icon = metadataSvgIcon(extensionUri, metadataObjectTypeIconFileName(objectType, groupId, subgroupId));
	if (isAdopted(objectBelonging)) {
		return adoptedIcon(icon);
	}
	return supportIcon(icon, support ?? '');
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

/** Ключ состояния рабочей области: какие источники дерева раскрыты. */
const EXPANDED_SOURCES_KEY = '1c-platform-tools.metadata.expandedSources';

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
	/** Поиск по дереву: исходный запрос и его слова в нижнем регистре. */
	private _textFilter: { readonly query: string; readonly terms: readonly string[] } | undefined;

	/** Кэш последнего успешного дерева (для API). */
	private _sourceItems: MetadataSourceTreeItem[] = [];
	/**
	 * Раскрытые источники: дерево перестраивается целиком, и без этого каждое обновление
	 * возвращало бы раскрытой основную конфигурацию, а свёрнутыми - расширения.
	 */
	private _expandedSources: Set<string> | undefined;
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

	constructor(private readonly _context: vscode.ExtensionContext) {
		initAdoptedIcons(path.join(_context.globalStorageUri.fsPath, 'metadata-tree-icons'));}

	/** Раскрытые источники из состояния рабочей области; пусто - состояние ещё не сохраняли. */
	private expandedSources(): Set<string> | undefined {
		if (this._expandedSources === undefined) {
			const saved = this._context.workspaceState.get<string[]>(EXPANDED_SOURCES_KEY);
			this._expandedSources = saved === undefined ? undefined : new Set(saved);
		}
		return this._expandedSources;
	}

	/**
	 * Запоминает, раскрыт ли источник. Хранится только верхний уровень: глубже узлы создаются
	 * по мере раскрытия, и восстанавливать их всё равно нечем.
	 *
	 * @param sourceId Идентификатор источника: основная конфигурация, расширение, внешние файлы.
	 */
	rememberSourceExpanded(sourceId: string, expanded: boolean): void {
		const current = this.expandedSources() ?? new Set(
			this._sourceItems.filter((s) => s.sourceKind === 'main').map((s) => s.sourceId)
		);
		if (expanded) {
			current.add(sourceId);
		} else {
			current.delete(sourceId);
		}
		this._expandedSources = current;
		void this._context.workspaceState.update(EXPANDED_SOURCES_KEY, [...current]);
	}

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
			log.error(`дерево: ${msg}`);
			this._lastError = msg;
			void offerGithubTokenOnRateLimit(msg);
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

	/**
	 * Поиск по имени объекта: пустая строка снимает фильтр. Запрос из нескольких слов
	 * ищет объекты, где встречается каждое слово («демо замет» находит «_ДемоЗаметки»).
	 */
	setTextFilter(query: string): void {
		const terms = query
			.trim()
			.toLowerCase()
			.split(/\s+/)
			.filter((term) => term.length > 0);
		const next = terms.length > 0 ? { query: query.trim(), terms } : undefined;
		if (next?.query === this._textFilter?.query) {
			return;
		}
		this._textFilter = next;
		this._onDidChange.fire(undefined);
	}

	getTextFilter(): string | undefined {
		return this._textFilter?.query;
	}

	/** Подсистемы всех источников — кандидаты для фильтра по подсистеме. */
	listSubsystemLeaves(): MetadataLeafTreeItem[] {
		const out: MetadataLeafTreeItem[] = [];
		for (const bySource of this._subsystemsBySource.values()) {
			out.push(...bySource.values());
		}
		return out;
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
			const expanded = this.expandedSources();
			const sItem = new MetadataSourceTreeItem(
				src.id, src.label, src.kind, cfgAbs, metaAbs, expanded?.has(src.id), src.support, src.supportGeneration);
			const sourceIcon = metadataSourceIcon(src.kind, this._context.extensionUri);
			sItem.iconPath =
				sourceIcon instanceof vscode.ThemeIcon ? sourceIcon : supportIcon(sourceIcon, src.support ?? '');
			this._sourceItems.push(sItem);

			if (isExternalArtifactSourceKind(src.kind)) {
				const flat: MetadataLeafTreeItem[] = [];
				for (const g of src.groups) {
					for (const it of g.items) {
						flat.push(
							createMetadataLeaf(
								src.id,
								g.id,
								undefined,
								it,
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
							const leaf = createMetadataLeaf(
								src.id,
								g.id,
								sg.id,
								it,
								workspaceRoot,
								this._context.extensionUri,
								cfgAbs,
								metaAbs,
								src.support === 'editable',
								src.supportGeneration
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
						flatLeaves.push(
							createMetadataLeaf(
								src.id,
								g.id,
								undefined,
								it,
								workspaceRoot,
								this._context.extensionUri,
								cfgAbs,
								metaAbs,
								src.support === 'editable',
								src.supportGeneration
							)
						);
					}
					this._leavesByGroup.set(gKey, flatLeaves);
				} else {
					const leaves: MetadataLeafTreeItem[] = [];
					for (const it of g.items) {
						leaves.push(
							createMetadataLeaf(
								src.id,
								g.id,
								undefined,
								it,
								workspaceRoot,
								this._context.extensionUri,
								cfgAbs,
								metaAbs,
								src.support === 'editable',
								src.supportGeneration
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
			if (this._textFilter && !this.anySourceHasMatches()) {
				const empty = new vscode.TreeItem(
					`Ничего не найдено: «${this._textFilter.query}»`,
					vscode.TreeItemCollapsibleState.None
				);
				empty.iconPath = new vscode.ThemeIcon('search');
				return [empty];
			}
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
		if (!this._subsystemFilter && !this._textFilter) {
			return groups;
		}
		const filtered: MetadataMdGroupTreeItem[] = [];
		for (const group of groups) {
			const key = groupKey(group.sourceId, group.groupId);
			const leaves = this.filterLeaves(this._leavesByGroup.get(key) ?? []);
			const subgroups = this.filterSubgroups(this._subgroupsByGroup.get(key) ?? []);
			if (leaves.length > 0 || subgroups.length > 0) {
				this.expandWhenSearching(group);
				filtered.push(group);
			}
		}
		return filtered;
	}

	private filterSubgroups(subgroups: MetadataMdSubgroupTreeItem[]): MetadataMdSubgroupTreeItem[] {
		if (!this._subsystemFilter && !this._textFilter) {
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
				this.expandWhenSearching(subgroup);
				filtered.push(subgroup);
			}
		}
		return filtered;
	}

	/** При поиске ветки с совпадениями раскрыты: иначе результат надо разворачивать руками. */
	private expandWhenSearching(item: vscode.TreeItem): void {
		if (item.collapsibleState === vscode.TreeItemCollapsibleState.None) {
			return;
		}
		item.collapsibleState = this._textFilter
			? vscode.TreeItemCollapsibleState.Expanded
			: vscode.TreeItemCollapsibleState.Collapsed;
	}

	/**
	 * Узел скрыт активным поиском или отбором по подсистемам.
	 *
	 * Дерево такой узел не покажет, поэтому переход к нему молча ничего не сделает - о причине
	 * нужно сказать вслух.
	 */
	isHiddenByFilter(item: vscode.TreeItem): boolean {
		if (!this._subsystemFilter && !this._textFilter) {
			return false;
		}
		const leaf = item instanceof MetadataObjectNodeTreeItem || item instanceof MetadataObjectSectionTreeItem
			? item.owner
			: item;
		if (!(leaf instanceof MetadataLeafTreeItem)) {
			return false;
		}
		return this.filterLeaves([leaf]).length === 0;
	}

	private filterLeaves(leaves: MetadataLeafTreeItem[]): MetadataLeafTreeItem[] {
		if (!this._subsystemFilter && !this._textFilter) {
			return leaves;
		}
		return leaves.filter(
			(leaf) => this.isLeafAllowedBySubsystemFilter(leaf) && this.isLeafAllowedByTextFilter(leaf)
		);
	}

	private isLeafAllowedByTextFilter(leaf: MetadataLeafTreeItem): boolean {
		if (!this._textFilter) {
			return true;
		}
		const name = leaf.name.toLowerCase();
		return this._textFilter.terms.every((term) => name.includes(term));
	}

	private anySourceHasMatches(): boolean {
		for (const source of this._sourceItems) {
			const flat = this._flatLeavesBySource.get(source.sourceId);
			if (flat && this.filterLeaves(flat).length > 0) {
				return true;
			}
			if (this.filterGroups(this._groupsBySource.get(source.sourceId) ?? []).length > 0) {
				return true;
			}
		}
		return false;
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

	/**
	 * Лист дерева, которому принадлежит файл: сам XML объекта либо что-то из его каталога
	 * (модуль, форма, макет).
	 *
	 * @param fileAbs Абсолютный путь открытого файла.
	 */
	findLeafForFile(fileAbs: string): MetadataLeafTreeItem | undefined {
		const groups: Iterable<MetadataLeafTreeItem[]> = [
			...this._flatLeavesBySource.values(),
			...this._leavesByGroup.values(),
			...this._leavesBySubgroup.values(),
		];
		for (const leaves of groups) {
			for (const leaf of leaves) {
				const objectXml = leaf.resourceUri?.fsPath;
				if (objectXml && metadataObjectOwnsFile(objectXml, fileAbs)) {
					return leaf;
				}
			}
		}
		return undefined;
	}

	/**
	 * Узел дерева, которому принадлежит файл: у формы это её узел под объектом, у остального - сам объект.
	 *
	 * Состав объекта дерево читает по мере раскрытия, поэтому секции здесь загружаются явно.
	 *
	 * @param fileAbs Абсолютный путь открытого файла.
	 */
	async findNodeForFile(fileAbs: string): Promise<vscode.TreeItem | undefined> {
		const leaf = this.findLeafForFile(fileAbs);
		if (!leaf?.resourceUri) {
			return leaf ?? this.findSourceForFile(fileAbs);
		}
		const child = objectChildFromFilePath(leaf.resourceUri.fsPath, fileAbs);
		if (!child) {
			return leaf;
		}
		const sections = await this.getChildren(leaf);
		const section = sections.find(
			(item): item is MetadataObjectSectionTreeItem =>
				item instanceof MetadataObjectSectionTreeItem && item.sectionKind === child.sectionKind
		);
		if (!section) {
			return leaf;
		}
		const nodes = await this.getChildren(section);
		const node = nodes.find(
			(item): item is MetadataObjectNodeTreeItem =>
				item instanceof MetadataObjectNodeTreeItem && item.name === child.name
		);
		return node ?? leaf;
	}

	/** Корень выгрузки: `Configuration.xml` объектом метаданных не является, но в дереве у него свой узел. */
	private findSourceForFile(fileAbs: string): MetadataSourceTreeItem | undefined {
		const file = path.normalize(fileAbs).toLowerCase();
		return this._sourceItems.find(
			(source) =>
				source.configurationXmlAbs !== undefined &&
				path.normalize(source.configurationXmlAbs).toLowerCase() === file
		);
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
				log.warn(`структура: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		// Состояния подчинённых субъектов одним чтением: своё правило есть у
		// формы, макета и каждого элемента объекта
		const childStates = await this.loadChildSupportStates(leaf);
		const childSupport = (
			nodeKind: MetadataNodeKind,
			name: string,
			tabularSection?: string
		): string | undefined => {
			const subdir = nodeKind === 'form' ? 'Forms' : nodeKind === 'template' ? 'Templates' : undefined;
			if (subdir) {
				if (!leaf.resourceUri) {
					return undefined;
				}
				const stem = path.basename(leaf.resourceUri.fsPath, '.xml');
				return childStates.get(`${stem}/${subdir}/${name}.xml`);
			}
			const elementKey = childSupportElementKey(nodeKind, name, tabularSection);
			return elementKey ? childStates.get(elementKey) : undefined;
		};
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
						ts.name,
						childSupport('tabularSection', ts.name)
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
									ts.name,
									childSupport('tabularAttribute', it.name, ts.name)
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
							leaf,
							undefined,
							childSupport(spec.nodeKind, itemName)
						)
				)
			);
		}
		this._objectSectionsByLeaf.set(leafKey, sections);
		return sections;
	}

	/**
	 * Состояния поддержки объекта и его форм с макетами: путь файла внутри
	 * выгрузки -> locked либо editable. Вне поддержки карта пустая.
	 */
	private async loadChildSupportStates(leaf: MetadataLeafTreeItem): Promise<Map<string, string>> {
		const out = new Map<string, string>();
		if (!supportEnabled() || !leaf.resourceUri || (leaf.support !== 'locked' && leaf.support !== 'editable')) {
			return out;
		}
		try {
			const runtime = await ensureMdSparrowRuntime(this._context);
			const res = await runMdSparrowParamsRead(
				runtime,
				{ op: 'cf-support-object-states', objectXml: leaf.resourceUri.fsPath },
				{ cwd: leaf.metadataRootAbs ?? path.dirname(leaf.resourceUri.fsPath) }
			);
			if (res.exitCode !== 0) {
				return out;
			}
			const states = JSON.parse(res.stdout.trim()) as Record<string, string | null>;
			for (const [key, state] of Object.entries(states)) {
				if (typeof state !== 'string' || state.length === 0) {
					continue;
				}
				// Ключ элемента приходит готовым, у файла путь режется до каталога объекта
				out.set(key.startsWith('element:') ? key : key.split('/').slice(1).join('/'), state);
			}
		} catch (e) {
			log.warn(`поддержка состава: ${e instanceof Error ? e.message : String(e)}`);
		}
		return out;
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
		const res = await runMdSparrowParamsRead(
			runtime,
			{ op: 'cf-md-object-structure-get', objectXml: leaf.resourceUri.fsPath, schemaVersion: schema },
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
			const res = await runMdSparrowParamsRead(
				runtime,
				{ op: 'cf-md-object-get', objectXml: leaf.resourceUri.fsPath, schemaVersion: schema },
				{ cwd: leaf.metadataRootAbs }
			);
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
						childTemplate.objectBelonging,
						this._workspaceRoot ?? '',
						this._context.extensionUri,
						childTemplate.configurationXmlAbs,
						childTemplate.metadataRootAbs,
						childTemplate.open,
						childTemplate.support,
						childTemplate.supportRulesOpen,
						childTemplate.supportGeneration
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
			parentLeaf.objectBelonging,
			this._workspaceRoot,
			this._context.extensionUri,
			parentLeaf.configurationXmlAbs,
			parentLeaf.metadataRootAbs,
			{ action: 'properties' },
			parentLeaf.support,
			parentLeaf.supportRulesOpen,
			parentLeaf.supportGeneration
		);
	}
}

function createMetadataLeaf(
	sourceId: string,
	groupId: string,
	subgroupId: string | undefined,
	item: MetadataItemDto,
	workspaceRoot: string,
	extensionUri: vscode.Uri,
	configurationXmlAbs: string | undefined,
	metadataRootAbs: string | undefined,
	supportRulesOpen?: boolean,
	supportGeneration?: string
): MetadataLeafTreeItem {
	const rel = item.relativePath?.length ? item.relativePath : undefined;
	return new MetadataLeafTreeItem(
		sourceId,
		groupId,
		subgroupId,
		item.objectType,
		item.name,
		rel,
		item.objectBelonging,
		workspaceRoot,
		extensionUri,
		configurationXmlAbs,
		metadataRootAbs,
		resolveMetadataOpen(item.open, workspaceRoot),
		item.support,
		supportRulesOpen,
		supportGeneration
	);
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
