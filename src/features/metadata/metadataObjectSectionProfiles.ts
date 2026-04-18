/**
 * Единая матрица секций метаданных по типам объектов.
 * Используется деревом метаданных и панелью свойств.
 * @module metadataObjectSectionProfiles
 */

export type MetadataObjectSectionSource =
	| 'attributes'
	| 'tabularSections'
	| 'forms'
	| 'commands'
	| 'templates'
	| 'values'
	| 'columns'
	| 'accountingFlags'
	| 'extDimensionAccountingFlags'
	| 'dimensions'
	| 'resources'
	| 'recalculations'
	| 'addressingAttributes'
	| 'operations'
	| 'urlTemplates'
	| 'channels'
	| 'tables'
	| 'cubes'
	| 'functions';

export const METADATA_OBJECT_SECTION_SOURCE_ORDER: readonly MetadataObjectSectionSource[] = [
	'attributes',
	'tabularSections',
	'forms',
	'commands',
	'templates',
	'values',
	'columns',
	'accountingFlags',
	'extDimensionAccountingFlags',
	'dimensions',
	'resources',
	'recalculations',
	'addressingAttributes',
	'operations',
	'urlTemplates',
	'channels',
	'tables',
	'cubes',
	'functions',
] as const;

const OBJECT_SECTION_STANDARD: readonly MetadataObjectSectionSource[] = [
	'attributes',
	'tabularSections',
	'forms',
	'commands',
	'templates',
];

const OBJECT_SECTION_REGISTER: readonly MetadataObjectSectionSource[] = [
	'dimensions',
	'resources',
	'attributes',
	'forms',
	'commands',
	'templates',
];

export const METADATA_OBJECT_SECTION_SOURCES_BY_TYPE: Readonly<Record<string, readonly MetadataObjectSectionSource[]>> =
	{
		Catalog: OBJECT_SECTION_STANDARD,
		Document: OBJECT_SECTION_STANDARD,
		Report: OBJECT_SECTION_STANDARD,
		DataProcessor: OBJECT_SECTION_STANDARD,
		ExternalReport: ['attributes', 'tabularSections', 'forms', 'templates'],
		ExternalDataProcessor: ['attributes', 'tabularSections', 'forms', 'templates'],
		ChartOfCharacteristicTypes: OBJECT_SECTION_STANDARD,
		ChartOfCalculationTypes: OBJECT_SECTION_STANDARD,
		BusinessProcess: OBJECT_SECTION_STANDARD,
		ExchangePlan: OBJECT_SECTION_STANDARD,
		FilterCriterion: ['forms', 'commands'],
		SettingsStorage: ['forms', 'templates'],
		WebService: ['operations'],
		HTTPService: ['urlTemplates'],
		IntegrationService: ['channels'],
		Enum: ['values'],
		DocumentJournal: ['columns', 'forms', 'commands', 'templates'],
		ChartOfAccounts: [
			'attributes',
			'accountingFlags',
			'extDimensionAccountingFlags',
			'tabularSections',
			'forms',
			'commands',
			'templates',
		],
		InformationRegister: OBJECT_SECTION_REGISTER,
		AccumulationRegister: OBJECT_SECTION_REGISTER,
		AccountingRegister: OBJECT_SECTION_REGISTER,
		CalculationRegister: ['recalculations', ...OBJECT_SECTION_REGISTER],
		Task: ['addressingAttributes', ...OBJECT_SECTION_STANDARD],
		ExternalDataSource: ['tables', 'cubes', 'functions'],
	};

export const METADATA_OBJECT_NON_EXPANDABLE_TYPES: readonly string[] = [
	'CommonModule',
	'SessionParameter',
	'Role',
	'CommonAttribute',
	'EventSubscription',
	'ScheduledJob',
	'Bot',
	'FunctionalOption',
	'FunctionalOptionsParameter',
	'DefinedType',
	'CommonCommand',
	'CommandGroup',
	'CommonForm',
	'CommonPicture',
	'CommonTemplate',
	'XDTOPackage',
	'WebSocketClient',
	'StyleItem',
	'Style',
	'Language',
	'Constant',
	'DocumentNumerator',
	'Sequence',
];
