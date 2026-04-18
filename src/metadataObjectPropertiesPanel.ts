/**
 * Панель свойств объекта метаданных (webview): только чтение через md-sparrow.
 * @module metadataObjectPropertiesPanel
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { logger } from './logger';
import { mdSparrowSchemaFlagFromConfigurationXml } from './mdSparrowSchemaVersion';
import { runMdSparrow } from './mdSparrowRunner';
import {
	metadataObjectPropertyProfileByType,
	type MetadataObjectPropertyProfile,
	type MetadataPropertySpecialSection,
} from './metadataObjectPropertyProfiles';
import { type MetadataObjectSectionSource } from './metadataObjectSectionProfiles';

const ERR_PREVIEW = 500;

interface MdObjectPropertiesDto {
	kind: string;
	internalName: string;
	synonymRu: string;
	comment: string;
	attributes?: Array<{ name: string; synonymRu?: string; comment?: string }>;
	tabularSections?: Array<{ name: string; synonymRu?: string; comment?: string }>;
	nestedSubsystems?: string[];
	contentRefs?: string[];
	catalog?: Record<string, unknown>;
}

interface MdObjectStructureDto {
	kind: string;
	internalName: string;
	attributes?: unknown[];
	tabularSections?: unknown[];
	forms?: unknown[];
	commands?: unknown[];
	templates?: unknown[];
	values?: unknown[];
	columns?: unknown[];
	accountingFlags?: unknown[];
	extDimensionAccountingFlags?: unknown[];
	dimensions?: unknown[];
	resources?: unknown[];
	recalculations?: unknown[];
	addressingAttributes?: unknown[];
	operations?: unknown[];
	urlTemplates?: unknown[];
	channels?: unknown[];
	tables?: unknown[];
	cubes?: unknown[];
	functions?: unknown[];
}

interface MetadataPanelTab {
	id: string;
	title: string;
	count?: number;
	render: 'overview' | 'named' | 'tabular' | 'list' | 'kv' | 'json' | 'subsystemContent';
	data?: unknown;
}

interface MetadataNamedRow {
	name: string;
	synonymRu: string;
	comment: string;
}

interface MetadataTabularSectionRow {
	name: string;
	synonymRu: string;
	comment: string;
	attributes: MetadataNamedRow[];
}

interface MetadataSubsystemContentTabData {
	summary: Array<{ type: string; count: number }>;
	items: string[];
}

interface MetadataPanelViewModel {
	objectKind: string;
	objectKindLabel: string;
	objectType: string;
	internalName: string;
	synonymRu: string;
	comment: string;
	objectXmlPath: string;
	warnings: string[];
	tabs: MetadataPanelTab[];
	technicalJson: string;
}

interface OpenMetadataObjectPropertiesParams {
	objectXmlFsPath: string;
	cwd: string;
	cfgPath?: string;
	schemaFlag?: string;
	objectType?: string;
}

const OBJECT_TYPE_ALIASES: Record<string, string> = {
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

type PanelSectionKey = MetadataObjectSectionSource | MetadataPropertySpecialSection;

const STRUCTURE_SECTION_TITLE_BY_KEY: Record<string, string> = {
	attributes: 'Реквизиты',
	tabularSections: 'Табличные части',
	forms: 'Формы',
	commands: 'Команды',
	templates: 'Макеты',
	values: 'Значения',
	columns: 'Графы',
	accountingFlags: 'Признаки учета',
	extDimensionAccountingFlags: 'Признаки учета субконто',
	dimensions: 'Измерения',
	resources: 'Ресурсы',
	recalculations: 'Перерасчеты',
	addressingAttributes: 'Реквизиты адресации',
	operations: 'Операции',
	urlTemplates: 'Шаблоны URL',
	channels: 'Каналы',
	tables: 'Таблицы',
	cubes: 'Кубы',
	functions: 'Функции',
};

const PROPERTY_LABEL_BY_KEY: Record<string, string> = {
	kind: 'Вид',
	internalName: 'Имя',
	synonymRu: 'Синоним',
	comment: 'Комментарий',
	objectBelonging: 'Принадлежность объекта',
	extendedConfigurationObject: 'Расширяемый объект',
	hierarchical: 'Иерархический',
	hierarchyType: 'Тип иерархии',
	limitLevelCount: 'Ограничивать количество уровней',
	levelCount: 'Количество уровней',
	foldersOnTop: 'Папки сверху',
	useStandardCommands: 'Использовать стандартные команды',
	subordinationUse: 'Использование подчинения',
	codeLength: 'Длина кода',
	descriptionLength: 'Длина наименования',
	codeType: 'Тип кода',
	codeAllowedLength: 'Допустимая длина кода',
	codeSeries: 'Серия кодов',
	checkUnique: 'Проверка уникальности',
	autonumbering: 'Автонумерация',
	defaultPresentation: 'Представление по умолчанию',
	predefined: 'Предопределенные элементы',
	predefinedDataUpdate: 'Обновление предопределенных данных',
	editType: 'Режим редактирования',
	quickChoice: 'Быстрый выбор',
	choiceMode: 'Режим выбора',
	searchStringModeOnInputByString: 'Режим поиска при вводе',
	fullTextSearchOnInputByString: 'Полнотекстовый поиск при вводе',
	choiceDataGetModeOnInputByString: 'Режим получения данных при вводе',
	defaultObjectForm: 'Основная форма объекта',
	defaultFolderForm: 'Основная форма папки',
	defaultListForm: 'Основная форма списка',
	defaultChoiceForm: 'Основная форма выбора',
	defaultFolderChoiceForm: 'Основная форма выбора папки',
	auxiliaryObjectForm: 'Вспомогательная форма объекта',
	auxiliaryFolderForm: 'Вспомогательная форма папки',
	auxiliaryListForm: 'Вспомогательная форма списка',
	auxiliaryChoiceForm: 'Вспомогательная форма выбора',
	auxiliaryFolderChoiceForm: 'Вспомогательная форма выбора папки',
	objectModule: 'Модуль объекта',
	managerModule: 'Модуль менеджера',
	includeHelpInContents: 'Включать справку в содержание',
	help: 'Справка',
	dataLockControlMode: 'Режим управления блокировкой данных',
	fullTextSearch: 'Полнотекстовый поиск',
	objectPresentationRu: 'Представление объекта',
	extendedObjectPresentationRu: 'Расширенное представление объекта',
	listPresentationRu: 'Представление списка',
	extendedListPresentationRu: 'Расширенное представление списка',
	explanationRu: 'Пояснение',
	createOnInput: 'Создавать при вводе',
	choiceHistoryOnInput: 'История выбора при вводе',
	dataHistory: 'История данных',
	updateDataHistoryImmediatelyAfterWrite: 'Обновлять историю сразу после записи',
	executeAfterWriteDataHistoryVersionProcessing: 'Выполнять обработку версии истории после записи',
	additionalIndexes: 'Дополнительные индексы',
	standardAttributesXml: 'Стандартные реквизиты (XML)',
	characteristicsXml: 'Характеристики (XML)',
	catalog: 'Свойства справочника',
};

const XML_FRAGMENT_KEYS = new Set<string>(['standardAttributesXml', 'characteristicsXml']);

const GENERIC_VALUE_LABEL_BY_VALUE: Record<string, string> = {
	Use: 'Использовать',
	DontUse: 'Не использовать',
	Auto: 'Авто',
	Managed: 'Управляемый',
	Directly: 'Непосредственно',
	Begin: 'С начала',
	BothWays: 'Оба способа',
	String: 'Строка',
	Number: 'Число',
	Variable: 'Переменная',
	Fixed: 'Фиксированная',
	Items: 'Элементы',
	Folders: 'Группы',
	FoldersAndItems: 'Группы и элементы',
	ToItems: 'К элементам',
	ToFolders: 'К группам',
	ToFoldersAndItems: 'К группам и элементам',
	AsDescription: 'Как наименование',
	AsCode: 'Как код',
	WholeCatalog: 'Во всем справочнике',
	Adopted: 'Заимствованный',
	HierarchyFoldersAndItems: 'Иерархия групп и элементов',
};

const VALUE_LABEL_BY_KEY: Record<string, Record<string, string>> = {
	objectBelonging: {
		Adopted: 'Заимствованный',
	},
	hierarchyType: {
		HierarchyFoldersAndItems: 'Иерархия групп и элементов',
		HierarchyItems: 'Иерархия элементов',
		HierarchyFolders: 'Иерархия групп',
	},
	subordinationUse: {
		ToItems: 'К элементам',
		ToFolders: 'К группам',
		ToFoldersAndItems: 'К группам и элементам',
	},
	choiceMode: {
		BothWays: 'Оба способа',
	},
	choiceFoldersAndItems: {
		Items: 'Элементы',
		Folders: 'Группы',
		FoldersAndItems: 'Группы и элементы',
	},
	searchStringModeOnInputByString: {
		Begin: 'С начала',
	},
	choiceDataGetModeOnInputByString: {
		Directly: 'Непосредственно',
	},
	dataLockControlMode: {
		Managed: 'Управляемый',
	},
	defaultPresentation: {
		AsDescription: 'Как наименование',
		AsCode: 'Как код',
	},
	codeType: {
		String: 'Строка',
		Number: 'Число',
	},
	codeAllowedLength: {
		Variable: 'Переменная',
		Fixed: 'Фиксированная',
	},
	codeSeries: {
		WholeCatalog: 'Во всем справочнике',
	},
};

const MD_REF_KIND_LABEL_BY_PREFIX: Record<string, string> = {
	Catalog: 'Справочник',
	CatalogRef: 'Справочник',
	Document: 'Документ',
	DocumentRef: 'Документ',
	DocumentJournal: 'Журнал документов',
	DocumentJournalRef: 'Журнал документов',
	Enum: 'Перечисление',
	EnumRef: 'Перечисление',
	Report: 'Отчет',
	ReportRef: 'Отчет',
	DataProcessor: 'Обработка',
	DataProcessorRef: 'Обработка',
	ExternalReport: 'Внешний отчет',
	ExternalReportRef: 'Внешний отчет',
	ExternalDataProcessor: 'Внешняя обработка',
	ExternalDataProcessorRef: 'Внешняя обработка',
	InformationRegister: 'Регистр сведений',
	InformationRegisterRef: 'Регистр сведений',
	AccumulationRegister: 'Регистр накопления',
	AccumulationRegisterRef: 'Регистр накопления',
	AccountingRegister: 'Регистр бухгалтерии',
	AccountingRegisterRef: 'Регистр бухгалтерии',
	CalculationRegister: 'Регистр расчета',
	CalculationRegisterRef: 'Регистр расчета',
	ChartOfAccounts: 'План счетов',
	ChartOfAccountsRef: 'План счетов',
	ChartOfCharacteristicTypes: 'План видов характеристик',
	ChartOfCharacteristicTypesRef: 'План видов характеристик',
	ChartOfCalculationTypes: 'План видов расчета',
	ChartOfCalculationTypesRef: 'План видов расчета',
	BusinessProcess: 'Бизнес-процесс',
	BusinessProcessRef: 'Бизнес-процесс',
	Task: 'Задача',
	TaskRef: 'Задача',
	ExchangePlan: 'План обмена',
	ExchangePlanRef: 'План обмена',
	FilterCriterion: 'Критерий отбора',
	FilterCriterionRef: 'Критерий отбора',
	SettingsStorage: 'Хранилище настроек',
	SettingsStorageRef: 'Хранилище настроек',
	WebService: 'Веб-сервис',
	WebServiceRef: 'Веб-сервис',
	HTTPService: 'HTTP-сервис',
	HTTPServiceRef: 'HTTP-сервис',
	IntegrationService: 'Сервис интеграции',
	IntegrationServiceRef: 'Сервис интеграции',
	ExternalDataSource: 'Внешний источник данных',
	ExternalDataSourceRef: 'Внешний источник данных',
	CommonModule: 'Общий модуль',
	CommonModuleRef: 'Общий модуль',
	CommonAttribute: 'Общий реквизит',
	CommonAttributeRef: 'Общий реквизит',
	CommonPicture: 'Общая картинка',
	CommonPictureRef: 'Общая картинка',
	CommonForm: 'Общая форма',
	CommonFormRef: 'Общая форма',
	CommonTemplate: 'Общий макет',
	CommonTemplateRef: 'Общий макет',
	SessionParameter: 'Параметр сеанса',
	SessionParameterRef: 'Параметр сеанса',
	Constant: 'Константа',
	ConstantRef: 'Константа',
	Role: 'Роль',
	RoleRef: 'Роль',
	Subsystem: 'Подсистема',
	SubsystemRef: 'Подсистема',
	Command: 'Команда',
	CommandRef: 'Команда',
};

function normalizeObjectType(type: string): string {
	return OBJECT_TYPE_ALIASES[type] ?? type;
}

function objectTypeFromKind(kind: string): string {
	const byKind: Record<string, string> = {
		catalog: 'Catalog',
		document: 'Document',
		report: 'Report',
		dataProcessor: 'DataProcessor',
		externalReport: 'ExternalReport',
		externalDataProcessor: 'ExternalDataProcessor',
		exchangePlan: 'ExchangePlan',
		subsystem: 'Subsystem',
		task: 'Task',
		enum: 'Enum',
		documentJournal: 'DocumentJournal',
		chartOfAccounts: 'ChartOfAccounts',
		chartOfCharacteristicTypes: 'ChartOfCharacteristicTypes',
		chartOfCalculationTypes: 'ChartOfCalculationTypes',
		informationRegister: 'InformationRegister',
		accumulationRegister: 'AccumulationRegister',
		accountingRegister: 'AccountingRegister',
		calculationRegister: 'CalculationRegister',
		webService: 'WebService',
		httpService: 'HTTPService',
		integrationService: 'IntegrationService',
		externalDataSource: 'ExternalDataSource',
		filterCriterion: 'FilterCriterion',
		settingsStorage: 'SettingsStorage',
	};
	return byKind[kind] ?? '';
}

function humanizeMetadataReference(value: string): string | null {
	const match = /^([A-Za-z][A-Za-z0-9]*)\.(.+)$/.exec(value);
	if (!match) {
		return null;
	}
	const prefix = match[1];
	const name = match[2];
	const label = MD_REF_KIND_LABEL_BY_PREFIX[prefix];
	if (!label || !name) {
		return null;
	}
	return `${label}: ${name}`;
}

function humanizeStandaloneString(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return '';
	}
	const metadataRef = humanizeMetadataReference(trimmed);
	if (metadataRef) {
		return metadataRef;
	}
	return GENERIC_VALUE_LABEL_BY_VALUE[trimmed] ?? trimmed;
}

function metadataRefType(value: string): string {
	const match = /^([A-Za-z][A-Za-z0-9]*)\./.exec(value.trim());
	return match ? match[1] : 'Прочее';
}

function buildSubsystemContentTabData(values: unknown): MetadataSubsystemContentTabData {
	const items = toSortedRu(asStringList(values));
	const summaryByType = new Map<string, number>();
	for (const item of items) {
		const type = metadataRefType(item);
		summaryByType.set(type, (summaryByType.get(type) ?? 0) + 1);
	}
	const summary = Array.from(summaryByType.entries())
		.map(([type, count]) => ({ type, count }))
		.sort((a, b) => a.type.localeCompare(b.type, 'ru'));
	return { summary, items };
}

function humanizeValueByKey(key: string, value: unknown): unknown {
	if (value === null || typeof value === 'boolean' || typeof value === 'number') {
		return value;
	}
	if (typeof value !== 'string') {
		return value;
	}
	const trimmed = value.trim();
	if (XML_FRAGMENT_KEYS.has(key)) {
		return trimmed.length > 0 ? 'XML-фрагмент (см. технические данные)' : '';
	}
	const keySpecific = VALUE_LABEL_BY_KEY[key]?.[trimmed];
	if (keySpecific) {
		return keySpecific;
	}
	return humanizeStandaloneString(trimmed);
}

function panelTitleForKind(kind: string, internalName: string): string {
	switch (kind) {
		case 'catalog':
			return `Справочник: ${internalName}`;
		case 'constant':
			return `Константа: ${internalName}`;
		case 'enum':
			return `Перечисление: ${internalName}`;
		case 'document':
			return `Документ: ${internalName}`;
		case 'documentJournal':
			return `Журнал документов: ${internalName}`;
		case 'report':
		case 'externalReport':
			return `Отчёт: ${internalName}`;
		case 'dataProcessor':
		case 'externalDataProcessor':
			return `Обработка: ${internalName}`;
		case 'task':
			return `Задача: ${internalName}`;
		case 'chartOfAccounts':
			return `План счетов: ${internalName}`;
		case 'chartOfCharacteristicTypes':
			return `План видов характеристик: ${internalName}`;
		case 'chartOfCalculationTypes':
			return `План видов расчёта: ${internalName}`;
		case 'subsystem':
			return `Подсистема: ${internalName}`;
		default:
			return `Свойства: ${internalName}`;
	}
}

function kindLabel(kind: string, objectType: string): string {
	const source = kind || objectType;
	switch (source) {
		case 'catalog':
		case 'Catalog':
			return 'Справочник';
		case 'constant':
		case 'Constant':
			return 'Константа';
		case 'enum':
		case 'Enum':
			return 'Перечисление';
		case 'document':
		case 'Document':
			return 'Документ';
		case 'documentJournal':
		case 'DocumentJournal':
			return 'Журнал документов';
		case 'report':
		case 'Report':
		case 'externalReport':
		case 'ExternalReport':
			return 'Отчет';
		case 'dataProcessor':
		case 'DataProcessor':
		case 'externalDataProcessor':
		case 'ExternalDataProcessor':
			return 'Обработка';
		case 'task':
		case 'Task':
			return 'Задача';
		case 'chartOfAccounts':
		case 'ChartOfAccounts':
			return 'План счетов';
		case 'chartOfCharacteristicTypes':
		case 'ChartOfCharacteristicTypes':
			return 'План видов характеристик';
		case 'chartOfCalculationTypes':
		case 'ChartOfCalculationTypes':
			return 'План видов расчета';
		case 'subsystem':
		case 'Subsystem':
			return 'Подсистема';
		case 'exchangePlan':
		case 'ExchangePlan':
			return 'План обмена';
		case 'informationRegister':
		case 'InformationRegister':
			return 'Регистр сведений';
		case 'accumulationRegister':
		case 'AccumulationRegister':
			return 'Регистр накопления';
		case 'accountingRegister':
		case 'AccountingRegister':
			return 'Регистр бухгалтерии';
		case 'calculationRegister':
		case 'CalculationRegister':
			return 'Регистр расчета';
		case 'businessProcess':
		case 'BusinessProcess':
			return 'Бизнес-процесс';
		default:
			return source || 'Объект';
	}
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function asStringList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out = value
		.map((item) => {
			if (typeof item === 'string') {
				return humanizeStandaloneString(item);
			}
			if (typeof item === 'object' && item) {
				const record = item as Record<string, unknown>;
				const preferred = record.name ?? record.internalName ?? record.title ?? record.id;
				if (typeof preferred === 'string' && preferred.trim().length > 0) {
					return humanizeStandaloneString(preferred);
				}
			}
			return '';
		})
		.filter((item) => item.length > 0);
	return Array.from(new Set(out));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): boolean {
	return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function sectionTitleByKey(key: string): string {
	return STRUCTURE_SECTION_TITLE_BY_KEY[key] ?? PROPERTY_LABEL_BY_KEY[key] ?? humanizeKey(key);
}

function humanizeKey(key: string): string {
	const source = key.replaceAll('_', ' ').trim();
	if (!source) {
		return key;
	}
	const spaced = source.replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll(/\s+/g, ' ');
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function toSortedRu(values: string[]): string[] {
	return values.slice().sort((a, b) => a.localeCompare(b, 'ru'));
}

function collectScalarPropertiesByKeys(record: Record<string, unknown> | null, keys: readonly string[]): Record<string, unknown> {
	if (!record) {
		return {};
	}
	const out: Record<string, unknown> = {};
	for (const key of keys) {
		if (!Object.hasOwn(record, key)) {
			continue;
		}
		const value = record[key];
		if (!isScalar(value)) {
			continue;
		}
		out[sectionTitleByKey(key)] = humanizeValueByKey(key, value);
	}
	return out;
}

function collectRawScalarMap(record: Record<string, unknown> | null): Record<string, unknown> {
	if (!record) {
		return {};
	}
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (isScalar(value)) {
			out[key] = value;
		}
	}
	return out;
}

function addConsumedKeys(target: Set<string>, keys: readonly string[]): void {
	for (const key of keys) {
		target.add(key);
	}
}

function asNamedRows(value: unknown): MetadataNamedRow[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: MetadataNamedRow[] = [];
	for (const item of value) {
		if (typeof item !== 'object' || item === null) {
			continue;
		}
		const record = item as Record<string, unknown>;
		const name = typeof record.name === 'string' ? record.name : '';
		if (!name) {
			continue;
		}
		out.push({
			name,
			synonymRu: typeof record.synonymRu === 'string' ? record.synonymRu : '',
			comment: typeof record.comment === 'string' ? record.comment : '',
		});
	}
	return out;
}

function asTabularRows(value: unknown): MetadataTabularSectionRow[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: MetadataTabularSectionRow[] = [];
	for (const item of value) {
		if (typeof item !== 'object' || item === null) {
			continue;
		}
		const record = item as Record<string, unknown>;
		const name = typeof record.name === 'string' ? record.name : '';
		if (!name) {
			continue;
		}
		out.push({
			name,
			synonymRu: typeof record.synonymRu === 'string' ? record.synonymRu : '',
			comment: typeof record.comment === 'string' ? record.comment : '',
			attributes: asNamedRows(record.attributes),
		});
	}
	return out;
}

function mergeTabularSections(
	propsRowsValue: unknown,
	structureRowsValue: unknown
): MetadataTabularSectionRow[] {
	const propsRows = asTabularRows(propsRowsValue);
	const structureRows = asTabularRows(structureRowsValue);
	if (propsRows.length === 0) {
		return structureRows;
	}
	const structureByName = new Map<string, MetadataTabularSectionRow>(
		structureRows.map((row) => [row.name, row])
	);
	return propsRows.map((row) => {
		const fromStructure = structureByName.get(row.name);
		const attributes = fromStructure && fromStructure.attributes.length > 0 ? fromStructure.attributes : row.attributes;
		return { ...row, attributes };
	});
}

async function resolveSchemaFlag(params: OpenMetadataObjectPropertiesParams): Promise<string> {
	if (params.cfgPath) {
		return mdSparrowSchemaFlagFromConfigurationXml(params.cfgPath);
	}
	if (params.schemaFlag && params.schemaFlag.trim().length > 0) {
		return params.schemaFlag;
	}
	throw new Error('Не удалось определить схему XSD для чтения свойств объекта.');
}

async function runMdSparrowJson<T>(
	runtime: Awaited<ReturnType<typeof ensureMdSparrowRuntime>>,
	args: string[],
	cwd: string
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
	const res = await runMdSparrow(runtime, args, { cwd });
	if (res.exitCode !== 0) {
		const errText = res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`;
		return { ok: false, error: errText };
	}
	try {
		return { ok: true, value: JSON.parse(res.stdout.trim()) as T };
	} catch (e) {
		return { ok: false, error: `Некорректный JSON: ${e instanceof Error ? e.message : String(e)}` };
	}
}

function isUnsupportedMdObjectError(errorText: string): boolean {
	const normalized = errorText.toLowerCase();
	return normalized.includes('unsupported metadataobject') || normalized.includes('unsupported metadata object');
}

function toUserFacingReadError(errorText: string): string {
	if (isUnsupportedMdObjectError(errorText)) {
		return 'Тип объекта пока не поддерживается для чтения всех свойств.';
	}
	return errorText;
}

function collectMetadataReadState(
	propsResult: Awaited<ReturnType<typeof runMdSparrowJson<MdObjectPropertiesDto>>>,
	structureResult: Awaited<ReturnType<typeof runMdSparrowJson<MdObjectStructureDto>>>
): {
	propsDto: MdObjectPropertiesDto | null;
	structureDto: MdObjectStructureDto | null;
	warnings: string[];
	fatalReason: string | null;
} {
	const warnings: string[] = [];
	const propsDto = propsResult.ok ? propsResult.value : null;
	const structureDto = structureResult.ok ? structureResult.value : null;
	const propsError = propsResult.ok ? '' : propsResult.error;
	const structureError = structureResult.ok ? '' : structureResult.error;

	if (!propsResult.ok) {
		const isUnsupportedProps = isUnsupportedMdObjectError(propsResult.error);
		if (!(isUnsupportedProps && structureDto)) {
			warnings.push(`Свойства объекта: ${toUserFacingReadError(propsResult.error).slice(0, ERR_PREVIEW)}`);
		}
	}

	if (!structureResult.ok) {
		warnings.push(`Структура объекта: ${toUserFacingReadError(structureResult.error).slice(0, ERR_PREVIEW)}`);
	}

	if (!propsDto && !structureDto) {
		const firstReason = propsError || structureError || 'Подробности в журнале.';
		return {
			propsDto,
			structureDto,
			warnings,
			fatalReason: toUserFacingReadError(firstReason).slice(0, ERR_PREVIEW),
		};
	}

	return {
		propsDto,
		structureDto,
		warnings,
		fatalReason: null,
	};
}

function makeListTab(id: string, title: string, list: string[]): MetadataPanelTab {
	return {
		id,
		title,
		count: list.length > 0 ? list.length : undefined,
		render: 'list',
		data: list,
	};
}

function buildNestedSectionTab(
	sectionKey: 'nestedSubsystems' | 'contentRefs',
	props: MdObjectPropertiesDto | null
): MetadataPanelTab {
	const raw = sectionKey === 'nestedSubsystems' ? props?.nestedSubsystems : props?.contentRefs;
	if (sectionKey === 'contentRefs') {
		const data = buildSubsystemContentTabData(raw);
		return {
			id: sectionKey,
			title: 'Состав',
			count: data.items.length > 0 ? data.items.length : undefined,
			render: 'subsystemContent',
			data,
		};
	}
	const list = toSortedRu(asStringList(raw));
	return makeListTab(sectionKey, 'Вложенные подсистемы', list);
}

function buildAttributesSectionTab(props: MdObjectPropertiesDto | null, structure: MdObjectStructureDto | null): MetadataPanelTab {
	const rows = props?.attributes ? asNamedRows(props.attributes) : asNamedRows(structure?.attributes);
	return {
		id: 'attributes',
		title: 'Реквизиты',
		count: rows.length > 0 ? rows.length : undefined,
		render: 'named',
		data: rows,
	};
}

function buildTabularSectionsSectionTab(
	props: MdObjectPropertiesDto | null,
	structure: MdObjectStructureDto | null
): MetadataPanelTab {
	const rows = mergeTabularSections(props?.tabularSections, structure?.tabularSections);
	return {
		id: 'tabularSections',
		title: 'Табличные части',
		count: rows.length > 0 ? rows.length : undefined,
		render: 'tabular',
		data: rows,
	};
}

function buildStructureSectionTab(sectionKey: MetadataObjectSectionSource, structure: MdObjectStructureDto | null): MetadataPanelTab {
	const structureRecord = isRecord(structure) ? structure : null;
	const list = toSortedRu(asStringList(structureRecord ? structureRecord[sectionKey] : undefined));
	return makeListTab(`section_${sectionKey}`, sectionTitleByKey(sectionKey), list);
}

function appendSectionTab(
	tabs: MetadataPanelTab[],
	sectionKey: PanelSectionKey,
	props: MdObjectPropertiesDto | null,
	structure: MdObjectStructureDto | null,
	includeWhenEmpty: boolean
): void {
	let tab: MetadataPanelTab;
	if (sectionKey === 'nestedSubsystems' || sectionKey === 'contentRefs') {
		tab = buildNestedSectionTab(sectionKey, props);
	} else if (sectionKey === 'attributes') {
		tab = buildAttributesSectionTab(props, structure);
	} else if (sectionKey === 'tabularSections') {
		tab = buildTabularSectionsSectionTab(props, structure);
	} else {
		tab = buildStructureSectionTab(sectionKey, structure);
	}

	const tabData = tab.data;
	const hasData = Array.isArray(tabData) ? tabData.length > 0 : Boolean(tabData);
	if (!includeWhenEmpty && !hasData) {
		return;
	}
	tabs.push(tab);
}

function buildProfileTabs(
	objectType: string,
	props: MdObjectPropertiesDto | null,
	structure: MdObjectStructureDto | null
): MetadataPanelTab[] {
	const profile: MetadataObjectPropertyProfile = metadataObjectPropertyProfileByType(objectType);
	const tabs: MetadataPanelTab[] = [{ id: 'overview', title: 'Общее', render: 'overview' }];
	const propsRecord = isRecord(props) ? props : null;
	const rawScalars = collectRawScalarMap(propsRecord);
	const consumedScalarKeys = new Set<string>(['kind', 'internalName', 'synonymRu', 'comment']);

	for (const group of profile.scalarGroups) {
		const data = collectScalarPropertiesByKeys(propsRecord, group.keys);
		addConsumedKeys(consumedScalarKeys, group.keys);
		tabs.push({
			id: group.id,
			title: group.title,
			render: 'kv',
			data,
		});
	}

	if (profile.includeAutoScalarGroup) {
		const autoKeys = Object.keys(rawScalars).filter((key) => !consumedScalarKeys.has(key));
		const autoData = collectScalarPropertiesByKeys(propsRecord, autoKeys);
		addConsumedKeys(consumedScalarKeys, autoKeys);
		if (Object.keys(autoData).length > 0) {
			tabs.push({
				id: 'objectProperties',
				title: 'Параметры объекта',
				render: 'kv',
				data: autoData,
			});
		}
	}

	const sections: PanelSectionKey[] = [
		...profile.structureSections,
		...(profile.specialSections ?? []),
	];
	for (const sectionKey of sections) {
		appendSectionTab(tabs, sectionKey, props, structure, true);
	}

	const unknownScalarData = profile.includeUnknownScalarTab
		? collectScalarPropertiesByKeys(
				propsRecord,
				Object.keys(rawScalars).filter((key) => !consumedScalarKeys.has(key))
			)
		: {};
	if (Object.keys(unknownScalarData).length > 0) {
		tabs.push({
			id: 'unknownScalarProperties',
			title: 'Прочее',
			render: 'kv',
			data: unknownScalarData,
		});
	}

	return tabs;
}

function buildTabs(
	props: MdObjectPropertiesDto | null,
	structure: MdObjectStructureDto | null,
	objectType: string
): MetadataPanelTab[] {
	return buildProfileTabs(objectType, props, structure);
}

/**
 * Тестовый хелпер построения вкладок без запуска webview.
 */
export function buildMetadataObjectPropertiesTabsForTest(
	objectType: string,
	props: unknown,
	structure: unknown
): MetadataPanelTab[] {
	const normalizedType = normalizeObjectType(objectType);
	return buildTabs(
		(isRecord(props) ? (props as unknown as MdObjectPropertiesDto) : null),
		(isRecord(structure) ? (structure as unknown as MdObjectStructureDto) : null),
		normalizedType
	);
}

function buildViewModel(
	params: OpenMetadataObjectPropertiesParams,
	props: MdObjectPropertiesDto | null,
	structure: MdObjectStructureDto | null,
	warnings: string[]
): MetadataPanelViewModel {
	const declaredObjectType = normalizeObjectType(params.objectType ?? '');
	const internalName = props?.internalName || structure?.internalName || path.parse(params.objectXmlFsPath).name;
	const objectKind = props?.kind || structure?.kind || declaredObjectType || 'object';
	const objectType = declaredObjectType || normalizeObjectType(objectTypeFromKind(objectKind));
	const technicalPayload = {
		properties: props,
		structure,
	};
	return {
		objectKind,
		objectKindLabel: kindLabel(objectKind, objectType),
		objectType,
		internalName,
		synonymRu: props?.synonymRu ?? '',
		comment: props?.comment ?? '',
		objectXmlPath: params.objectXmlFsPath,
		warnings,
		tabs: buildTabs(props, structure, objectType),
		technicalJson: JSON.stringify(technicalPayload, null, 2),
	};
}

/**
 * Открывает read-only панель свойств объекта метаданных.
 */
export async function openMetadataObjectPropertiesEditor(
	context: vscode.ExtensionContext,
	params: OpenMetadataObjectPropertiesParams
): Promise<void> {
	let schema: string;
	try {
		schema = await resolveSchemaFlag(params);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		void vscode.window.showErrorMessage(msg.slice(0, ERR_PREVIEW));
		return;
	}

	const runtime = await ensureMdSparrowRuntime(context);
	const [propsResult, structureResult] = await Promise.all([
		runMdSparrowJson<MdObjectPropertiesDto>(runtime, ['cf-md-object-get', params.objectXmlFsPath, '-v', schema], params.cwd),
		runMdSparrowJson<MdObjectStructureDto>(
			runtime,
			['cf-md-object-structure-get', params.objectXmlFsPath, '-v', schema],
			params.cwd
		),
	]);

	const { propsDto, structureDto, warnings, fatalReason } = collectMetadataReadState(propsResult, structureResult);
	if (fatalReason) {
		void vscode.window.showErrorMessage(
			`Не удалось прочитать свойства объекта. ${fatalReason}`.slice(0, ERR_PREVIEW)
		);
		return;
	}

	const viewModel = buildViewModel(params, propsDto, structureDto, warnings);
	const title = panelTitleForKind(viewModel.objectKind, viewModel.internalName);
	const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview');
	const panel = vscode.window.createWebviewPanel('1cMetadataObjectProperties', title, vscode.ViewColumn.Active, {
		enableScripts: true,
		retainContextWhenHidden: true,
		localResourceRoots: [webviewRoot],
	});

	try {
		panel.webview.html = await loadMetadataObjectHtml(panel.webview, context.extensionUri, viewModel);
	} catch (e) {
		logger.error(`metadata object template: ${e instanceof Error ? e.message : String(e)}`);
		void vscode.window.showErrorMessage('Не удалось загрузить панель свойств.');
		panel.dispose();
	}
}

async function loadMetadataObjectHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	viewModel: MetadataPanelViewModel
): Promise<string> {
	const templateUri = vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-object.html');
	const bytes = await vscode.workspace.fs.readFile(templateUri);
	const template = new TextDecoder('utf-8').decode(bytes);
	const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-object.css'));
	const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-object.js'));
	const initialJson = JSON.stringify(viewModel).replaceAll('<', String.raw`\u003c`);
	return template
		.replaceAll('{{CSP_SOURCE}}', webview.cspSource)
		.replaceAll('{{CSS_URI}}', cssUri.toString())
		.replaceAll('{{JS_URI}}', jsUri.toString())
		.replaceAll('{{INITIAL_JSON}}', initialJson)
		.replaceAll('{{KIND_LABEL}}', escapeHtml(viewModel.objectKindLabel))
		.replaceAll('{{OBJECT_NAME}}', escapeHtml(viewModel.internalName));
}
