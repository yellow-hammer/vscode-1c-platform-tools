/**
 * Профили вкладок панели свойств объекта метаданных.
 * Отделены от профилей дерева метаданных: дерево отвечает за навигацию,
 * панель — за удобное представление всех доступных свойств.
 * @module metadataObjectPropertyProfiles
 */

import type { MetadataObjectSectionSource } from './metadataObjectSectionProfiles';

export interface MetadataPropertyScalarGroupProfile {
	readonly id: string;
	readonly title: string;
	readonly keys: readonly string[];
}

export type MetadataPropertySpecialSection = 'nestedSubsystems' | 'contentRefs';

export interface MetadataObjectPropertyProfile {
	readonly includeAutoScalarGroup?: boolean;
	readonly scalarGroups: readonly MetadataPropertyScalarGroupProfile[];
	readonly structureSections: readonly MetadataObjectSectionSource[];
	readonly specialSections?: readonly MetadataPropertySpecialSection[];
	readonly includeUnknownScalarTab?: boolean;
}

const STANDARD_STRUCTURE: readonly MetadataObjectSectionSource[] = [
	'attributes',
	'tabularSections',
	'forms',
	'commands',
	'templates',
];

const REGISTER_STRUCTURE: readonly MetadataObjectSectionSource[] = [
	'dimensions',
	'resources',
	'attributes',
	'forms',
	'commands',
	'templates',
];

const DEFAULT_PROFILE: MetadataObjectPropertyProfile = {
	includeAutoScalarGroup: true,
	scalarGroups: [],
	structureSections: [],
	includeUnknownScalarTab: true,
};

const CATALOG_PROFILE: MetadataObjectPropertyProfile = {
	includeAutoScalarGroup: false,
	scalarGroups: [],
	structureSections: STANDARD_STRUCTURE,
	includeUnknownScalarTab: false,
};

const STANDARD_PROFILE: MetadataObjectPropertyProfile = {
	includeAutoScalarGroup: true,
	scalarGroups: [],
	structureSections: STANDARD_STRUCTURE,
	includeUnknownScalarTab: true,
};

export const METADATA_OBJECT_PROPERTY_PROFILE_BY_TYPE: Readonly<Record<string, MetadataObjectPropertyProfile>> = {
	Catalog: CATALOG_PROFILE,
	Document: STANDARD_PROFILE,
	Report: STANDARD_PROFILE,
	DataProcessor: STANDARD_PROFILE,
	ExternalReport: { ...STANDARD_PROFILE, structureSections: ['attributes', 'tabularSections', 'forms', 'templates'] },
	ExternalDataProcessor: { ...STANDARD_PROFILE, structureSections: ['attributes', 'tabularSections', 'forms', 'templates'] },
	ExchangePlan: STANDARD_PROFILE,
	ChartOfCharacteristicTypes: STANDARD_PROFILE,
	ChartOfCalculationTypes: STANDARD_PROFILE,
	BusinessProcess: STANDARD_PROFILE,
	FilterCriterion: { ...STANDARD_PROFILE, structureSections: ['forms', 'commands'] },
	SettingsStorage: { ...STANDARD_PROFILE, structureSections: ['forms', 'templates'] },
	WebService: { ...STANDARD_PROFILE, structureSections: ['operations'] },
	HTTPService: { ...STANDARD_PROFILE, structureSections: ['urlTemplates'] },
	IntegrationService: { ...STANDARD_PROFILE, structureSections: ['channels'] },
	Enum: { ...STANDARD_PROFILE, structureSections: ['values'] },
	DocumentJournal: { ...STANDARD_PROFILE, structureSections: ['columns', 'forms', 'commands', 'templates'] },
	ChartOfAccounts: {
		...STANDARD_PROFILE,
		structureSections: ['attributes', 'accountingFlags', 'extDimensionAccountingFlags', 'tabularSections', 'forms', 'commands', 'templates'],
	},
	InformationRegister: { ...STANDARD_PROFILE, structureSections: REGISTER_STRUCTURE },
	AccumulationRegister: { ...STANDARD_PROFILE, structureSections: REGISTER_STRUCTURE },
	AccountingRegister: { ...STANDARD_PROFILE, structureSections: REGISTER_STRUCTURE },
	CalculationRegister: { ...STANDARD_PROFILE, structureSections: ['recalculations', ...REGISTER_STRUCTURE] },
	Task: { ...STANDARD_PROFILE, structureSections: ['addressingAttributes', ...STANDARD_STRUCTURE] },
	ExternalDataSource: { ...STANDARD_PROFILE, structureSections: ['tables', 'cubes', 'functions'] },
	Subsystem: {
		includeAutoScalarGroup: true,
		scalarGroups: [],
		structureSections: [],
		specialSections: ['nestedSubsystems', 'contentRefs'],
		includeUnknownScalarTab: true,
	},
};

export function metadataObjectPropertyProfileByType(objectType: string): MetadataObjectPropertyProfile {
	return METADATA_OBJECT_PROPERTY_PROFILE_BY_TYPE[objectType] ?? DEFAULT_PROFILE;
}
