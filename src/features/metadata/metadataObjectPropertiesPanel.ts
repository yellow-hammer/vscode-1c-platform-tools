/**
 * Панель свойств объекта метаданных (webview): чтение через md-sparrow,
 * для справочника — редактирование скалярных свойств с записью `cf-md-object-set`.
 * @module metadataObjectPropertiesPanel
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { logger } from '../../shared/logger';
import { mdSparrowSchemaFlagFromConfigurationXml } from './mdSparrowSchemaVersion';
import { runMdSparrowParamsMutation, runMdSparrowParamsRead, type MdSparrowParams } from './mdSparrowParams';
import {
	applyEditedScalars,
	buildCatalogEditTabs,
	buildDocumentEditTabs,
	type MetadataEditOption,
	type MetadataEditTabSpec,
} from './metadataObjectEditSpec';
import {
	metadataObjectPropertyProfileByType,
	type MetadataObjectPropertyProfile,
	type MetadataPropertySpecialSection,
} from './metadataObjectPropertyProfiles';
import { type MetadataObjectSectionSource } from './metadataObjectSectionProfiles';

const log = logger.scope('metadata');

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
	document?: Record<string, unknown>;
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
	render: 'overview' | 'named' | 'tabular' | 'list' | 'kv' | 'json' | 'subsystemContent' | 'edit';
	data?: unknown;
}

interface MetadataPanelEditableModel {
	props: MdObjectPropertiesDto;
	tabs: MetadataEditTabSpec[];
}

/** Списки структуры для вкладки «Данные» (реквизиты и табличные части с операциями). */
interface MetadataPanelStructureLists {
	attributes: MetadataNamedRow[];
	tabularSections: MetadataTabularSectionRow[];
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
	editable?: MetadataPanelEditableModel;
	structureLists?: MetadataPanelStructureLists;
}

interface OpenMetadataObjectPropertiesParams {
	objectXmlFsPath: string;
	cwd: string;
	cfgPath?: string;
	schemaFlag?: string;
	objectType?: string;
	/** Общая очередь мутаций md-sparrow; без неё сохранение выполняется вне очереди. */
	enqueueMutation?: <T>(fn: () => Promise<T>) => Promise<T>;
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
	params: MdSparrowParams,
	cwd: string
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
	const res = await runMdSparrowParamsRead(runtime, params, { cwd });
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

/** Вкладки профиля, замещённые редактируемыми (формы, команды, реквизиты и ТЧ уходят в edit-вкладки). */
const TAB_IDS_REPLACED_BY_EDIT = new Set<string>([
	'overview',
	'section_forms',
	'section_commands',
	'attributes',
	'tabularSections',
]);

function buildTabs(
	props: MdObjectPropertiesDto | null,
	structure: MdObjectStructureDto | null,
	objectType: string,
	editable?: MetadataPanelEditableModel
): MetadataPanelTab[] {
	const profileTabs = buildProfileTabs(objectType, props, structure);
	if (!editable) {
		return profileTabs;
	}
	const editTabs: MetadataPanelTab[] = editable.tabs.map((tab) => ({
		id: tab.id,
		title: tab.title,
		render: 'edit',
	}));
	return [...editTabs, ...profileTabs.filter((tab) => !TAB_IDS_REPLACED_BY_EDIT.has(tab.id))];
}

function rawNameList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: string[] = [];
	for (const item of value) {
		if (typeof item === 'string' && item.trim().length > 0) {
			out.push(item.trim());
		} else if (isRecord(item) && typeof item.name === 'string' && item.name.trim().length > 0) {
			out.push(item.name.trim());
		}
	}
	return Array.from(new Set(out));
}

/** Кандидаты для подбора в редактируемых списках (читаются из конфигурации). */
export interface MetadataEditCandidates {
	catalogNames: readonly string[];
	documentNames: readonly string[];
	numeratorNames: readonly string[];
	registerOptions: readonly MetadataEditOption[];
}

const EMPTY_CANDIDATES: MetadataEditCandidates = {
	catalogNames: [],
	documentNames: [],
	numeratorNames: [],
	registerOptions: [],
};

function buildEditableModel(
	props: MdObjectPropertiesDto | null,
	structure: MdObjectStructureDto | null,
	internalName: string,
	candidates: MetadataEditCandidates = EMPTY_CANDIDATES
): MetadataPanelEditableModel | undefined {
	if (!props) {
		return undefined;
	}
	if (props.kind === 'catalog' && isRecord(props.catalog)) {
		const catalog = props.catalog as Record<string, unknown>;
		if (catalog.objectBelonging === 'ADOPTED') {
			// Заимствованные объекты расширений: свои правила состава XML, редактирование пока не включаем.
			return undefined;
		}
		return {
			props,
			tabs: buildCatalogEditTabs({
				internalName,
				formNames: rawNameList(structure?.forms),
				commandNames: rawNameList(structure?.commands),
				catalogNames: candidates.catalogNames,
				documentNames: candidates.documentNames,
				attributeNames: rawNameList(props.attributes),
				hasOwners: Array.isArray(catalog.owners) && catalog.owners.length > 0,
				hierarchical: catalog.hierarchical === true,
			}),
		};
	}
	if (props.kind === 'document' && isRecord(props.document)) {
		const document = props.document as Record<string, unknown>;
		if (document.objectBelonging === 'ADOPTED') {
			return undefined;
		}
		return {
			props,
			tabs: buildDocumentEditTabs({
				internalName,
				formNames: rawNameList(structure?.forms),
				commandNames: rawNameList(structure?.commands),
				catalogNames: candidates.catalogNames,
				documentNames: candidates.documentNames,
				attributeNames: rawNameList(props.attributes),
				numeratorNames: candidates.numeratorNames,
				registerOptions: candidates.registerOptions,
			}),
		};
	}
	return undefined;
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
	const propsDto = isRecord(props) ? (props as unknown as MdObjectPropertiesDto) : null;
	const structureDto = isRecord(structure) ? (structure as unknown as MdObjectStructureDto) : null;
	const editable = buildEditableModel(propsDto, structureDto, propsDto?.internalName ?? '');
	return buildTabs(propsDto, structureDto, normalizedType, editable);
}

function buildViewModel(
	params: OpenMetadataObjectPropertiesParams,
	props: MdObjectPropertiesDto | null,
	structure: MdObjectStructureDto | null,
	warnings: string[],
	candidates: MetadataEditCandidates = EMPTY_CANDIDATES
): MetadataPanelViewModel {
	const declaredObjectType = normalizeObjectType(params.objectType ?? '');
	const internalName = props?.internalName || structure?.internalName || path.parse(params.objectXmlFsPath).name;
	const objectKind = props?.kind || structure?.kind || declaredObjectType || 'object';
	const objectType = declaredObjectType || normalizeObjectType(objectTypeFromKind(objectKind));
	const technicalPayload = {
		properties: props,
		structure,
	};
	const editable = buildEditableModel(props, structure, internalName, candidates);
	const structureLists = editable
		? {
				attributes: props?.attributes ? asNamedRows(props.attributes) : asNamedRows(structure?.attributes),
				tabularSections: mergeTabularSections(props?.tabularSections, structure?.tabularSections),
			}
		: undefined;
	return {
		objectKind,
		objectKindLabel: kindLabel(objectKind, objectType),
		objectType,
		internalName,
		synonymRu: props?.synonymRu ?? '',
		comment: props?.comment ?? '',
		objectXmlPath: params.objectXmlFsPath,
		warnings,
		tabs: buildTabs(props, structure, objectType, editable),
		technicalJson: JSON.stringify(technicalPayload, null, 2),
		editable,
		structureLists,
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
	const editableType = normalizeObjectType(params.objectType ?? '');
	const wantsCandidates = Boolean(params.cfgPath) && (editableType === 'Catalog' || editableType === 'Document');
	const [propsResult, structureResult, candidates] = await Promise.all([
		runMdSparrowJson<MdObjectPropertiesDto>(
			runtime,
			{ op: 'cf-md-object-get', objectXml: params.objectXmlFsPath, schemaVersion: schema },
			params.cwd
		),
		runMdSparrowJson<MdObjectStructureDto>(
			runtime,
			{ op: 'cf-md-object-structure-get', objectXml: params.objectXmlFsPath, schemaVersion: schema },
			params.cwd
		),
		wantsCandidates
			? loadEditCandidates(runtime, params, schema, editableType)
			: Promise.resolve(EMPTY_CANDIDATES),
	]);

	const { propsDto, structureDto, warnings, fatalReason } = collectMetadataReadState(propsResult, structureResult);
	if (fatalReason) {
		void vscode.window.showErrorMessage(
			`Не удалось прочитать свойства объекта. ${fatalReason}`.slice(0, ERR_PREVIEW)
		);
		return;
	}

	const viewModel = buildViewModel(params, propsDto, structureDto, warnings, candidates);
	const title = panelTitleForKind(viewModel.objectKind, viewModel.internalName);
	const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview');
	const panel = vscode.window.createWebviewPanel('1cMetadataObjectProperties', title, vscode.ViewColumn.Active, {
		enableScripts: true,
		retainContextWhenHidden: true,
		localResourceRoots: [webviewRoot],
	});

	if (viewModel.editable) {
		registerEditableSaveHandler(context, panel, params, runtime, schema, viewModel.editable, candidates);
	}

	try {
		panel.webview.html = await loadMetadataObjectHtml(panel.webview, context.extensionUri, viewModel);
	} catch (e) {
		log.error(`шаблон объекта: ${e instanceof Error ? e.message : String(e)}`);
		void vscode.window.showErrorMessage('Не удалось загрузить панель свойств.');
		panel.dispose();
	}
}

const REGISTER_TAG_LABEL: Record<string, string> = {
	InformationRegister: 'Регистр сведений',
	AccumulationRegister: 'Регистр накопления',
	AccountingRegister: 'Регистр бухгалтерии',
	CalculationRegister: 'Регистр расчета',
};

/** Читает списки конфигурации для подбора в редактируемых полях панели. */
async function loadEditCandidates(
	runtime: Awaited<ReturnType<typeof ensureMdSparrowRuntime>>,
	params: OpenMetadataObjectPropertiesParams,
	schema: string,
	editableType: string
): Promise<MetadataEditCandidates> {
	const listByTag = async (tag: string): Promise<string[]> => {
		const res = await runMdSparrowJson<string[]>(
			runtime,
			{ op: 'cf-list-child-objects', configurationXml: params.cfgPath, tag, schemaVersion: schema },
			params.cwd
		);
		return res.ok && Array.isArray(res.value) ? res.value : [];
	};
	const wantsRegisters = editableType === 'Document';
	const [catalogNames, documentNames, numeratorNames, ...registers] = await Promise.all([
		listByTag('Catalog'),
		listByTag('Document'),
		wantsRegisters ? listByTag('DocumentNumerator') : Promise.resolve([]),
		...(wantsRegisters ? Object.keys(REGISTER_TAG_LABEL).map((tag) => listByTag(tag)) : []),
	]);
	const registerOptions: MetadataEditOption[] = [];
	if (wantsRegisters) {
		Object.keys(REGISTER_TAG_LABEL).forEach((tag, index) => {
			for (const name of registers[index] ?? []) {
				registerOptions.push({ value: `${tag}.${name}`, label: `${REGISTER_TAG_LABEL[tag]}: ${name}` });
			}
		});
	}
	return { catalogNames, documentNames, numeratorNames, registerOptions };
}

interface MetadataPanelSaveMessage {
	type?: string;
	payload?: unknown;
	structure?: unknown;
	module?: string;
}

const IDENTIFIER_RE = /^[A-Za-zА-ЯЁа-яё_][A-Za-zА-ЯЁа-яё0-9_]*$/;

/** Правка одной строки структуры из webview: originalName нет — строка новая. */
interface MetadataStructRowEdit {
	originalName?: string;
	name: string;
	synonymRu: string;
	deleted: boolean;
}

interface MetadataTabularSectionEdit extends MetadataStructRowEdit {
	attributes: MetadataStructRowEdit[];
}

interface MetadataStructureEdits {
	attributes: MetadataStructRowEdit[];
	tabularSections: MetadataTabularSectionEdit[];
}

function parseStructRow(value: unknown): MetadataStructRowEdit | null {
	if (!isRecord(value)) {
		return null;
	}
	const originalName =
		typeof value.originalName === 'string' && value.originalName.length > 0 ? value.originalName : undefined;
	return {
		originalName,
		name: typeof value.name === 'string' ? value.name.trim() : '',
		synonymRu: typeof value.synonymRu === 'string' ? value.synonymRu : '',
		deleted: value.deleted === true,
	};
}

export function parseStructureEdits(value: unknown): MetadataStructureEdits | null {
	if (!isRecord(value)) {
		return null;
	}
	const attributes: MetadataStructRowEdit[] = [];
	if (Array.isArray(value.attributes)) {
		for (const raw of value.attributes) {
			const row = parseStructRow(raw);
			if (row) {
				attributes.push(row);
			}
		}
	}
	const tabularSections: MetadataTabularSectionEdit[] = [];
	if (Array.isArray(value.tabularSections)) {
		for (const raw of value.tabularSections) {
			const row = parseStructRow(raw);
			if (!row) {
				continue;
			}
			const nested: MetadataStructRowEdit[] = [];
			if (isRecord(raw) && Array.isArray(raw.attributes)) {
				for (const rawAttr of raw.attributes) {
					const attr = parseStructRow(rawAttr);
					if (attr) {
						nested.push(attr);
					}
				}
			}
			tabularSections.push({ ...row, attributes: nested });
		}
	}
	return { attributes, tabularSections };
}

/** @returns текст первой ошибки валидации имён; null — правки корректны. */
export function validateStructureEdits(edits: MetadataStructureEdits): string | null {
	const topSeen = new Set<string>();
	for (const row of [...edits.attributes, ...edits.tabularSections]) {
		if (row.deleted) {
			continue;
		}
		if (!IDENTIFIER_RE.test(row.name)) {
			return `Некорректное имя: «${row.name || '(пусто)'}»`;
		}
		const key = row.name.toLowerCase();
		if (topSeen.has(key)) {
			return `Дублируется имя «${row.name}»`;
		}
		topSeen.add(key);
	}
	for (const ts of edits.tabularSections) {
		if (ts.deleted) {
			continue;
		}
		const nestedSeen = new Set<string>();
		for (const row of ts.attributes) {
			if (row.deleted) {
				continue;
			}
			if (!IDENTIFIER_RE.test(row.name)) {
				return `Некорректное имя реквизита ТЧ «${ts.name}»: «${row.name || '(пусто)'}»`;
			}
			const key = row.name.toLowerCase();
			if (nestedSeen.has(key)) {
				return `Дублируется имя «${row.name}» в ТЧ «${ts.name}»`;
			}
			nestedSeen.add(key);
		}
	}
	return null;
}

/** Операции структуры из правок: переименования, затем удаления, затем добавления. */
export function structOpsFromEdits(edits: MetadataStructureEdits, objectXml: string, schema: string): MdSparrowParams[] {
	const ops: MdSparrowParams[] = [];
	const base = { objectXml, schemaVersion: schema };
	for (const ts of edits.tabularSections) {
		if (!ts.deleted && ts.originalName && ts.name !== ts.originalName) {
			ops.push({ op: 'cf-md-tabular-section-rename', ...base, oldName: ts.originalName, newName: ts.name });
		}
	}
	for (const row of edits.attributes) {
		if (!row.deleted && row.originalName && row.name !== row.originalName) {
			ops.push({ op: 'cf-md-attribute-rename', ...base, oldName: row.originalName, newName: row.name });
		}
	}
	for (const ts of edits.tabularSections) {
		if (ts.deleted) {
			continue;
		}
		for (const row of ts.attributes) {
			if (!row.deleted && row.originalName && row.name !== row.originalName) {
				ops.push({
					op: 'cf-md-tabular-attribute-rename',
					...base,
					tabularSection: ts.name,
					oldName: row.originalName,
					newName: row.name,
				});
			}
		}
	}
	for (const row of edits.attributes) {
		if (row.deleted && row.originalName) {
			ops.push({ op: 'cf-md-attribute-delete', ...base, name: row.originalName });
		}
	}
	for (const ts of edits.tabularSections) {
		if (ts.deleted) {
			if (ts.originalName) {
				ops.push({ op: 'cf-md-tabular-section-delete', ...base, name: ts.originalName });
			}
			continue;
		}
		for (const row of ts.attributes) {
			if (row.deleted && row.originalName) {
				ops.push({ op: 'cf-md-tabular-attribute-delete', ...base, tabularSection: ts.name, name: row.originalName });
			}
		}
	}
	for (const row of edits.attributes) {
		if (!row.deleted && !row.originalName) {
			ops.push({ op: 'cf-md-attribute-add', ...base, name: row.name });
		}
	}
	for (const ts of edits.tabularSections) {
		if (ts.deleted) {
			continue;
		}
		if (!ts.originalName) {
			ops.push({ op: 'cf-md-tabular-section-add', ...base, name: ts.name });
		}
		for (const row of ts.attributes) {
			if (!row.deleted && !row.originalName) {
				ops.push({ op: 'cf-md-tabular-attribute-add', ...base, tabularSection: ts.name, name: row.name });
			}
		}
	}
	// Порядок: блоки переставляются между собой по финальным именам (после rename/add/delete).
	const attrOrder = edits.attributes.filter((row) => !row.deleted).map((row) => row.name);
	if (attrOrder.length > 1) {
		ops.push({ op: 'cf-md-attribute-reorder', ...base, payloadJson: JSON.stringify(attrOrder) });
	}
	const tsOrder = edits.tabularSections.filter((ts) => !ts.deleted).map((ts) => ts.name);
	if (tsOrder.length > 1) {
		ops.push({ op: 'cf-md-tabular-section-reorder', ...base, payloadJson: JSON.stringify(tsOrder) });
	}
	for (const ts of edits.tabularSections) {
		if (ts.deleted) {
			continue;
		}
		const nestedOrder = ts.attributes.filter((row) => !row.deleted).map((row) => row.name);
		if (nestedOrder.length > 1) {
			ops.push({
				op: 'cf-md-tabular-attribute-reorder',
				...base,
				tabularSection: ts.name,
				payloadJson: JSON.stringify(nestedOrder),
			});
		}
	}
	return ops;
}

/** Переносит синонимы реквизитов и ТЧ из правок в DTO (перечитанный после операций структуры). */
export function applySynonymEdits(dto: Record<string, unknown>, edits: MetadataStructureEdits): void {
	const attrSyn = new Map<string, string>();
	for (const row of edits.attributes) {
		if (!row.deleted && row.name) {
			attrSyn.set(row.name, row.synonymRu);
		}
	}
	if (Array.isArray(dto.attributes)) {
		for (const raw of dto.attributes) {
			if (isRecord(raw) && typeof raw.name === 'string' && attrSyn.has(raw.name)) {
				raw.synonymRu = attrSyn.get(raw.name);
			}
		}
	}
	const tsSyn = new Map<string, string>();
	for (const ts of edits.tabularSections) {
		if (!ts.deleted && ts.name) {
			tsSyn.set(ts.name, ts.synonymRu);
		}
	}
	if (Array.isArray(dto.tabularSections)) {
		for (const raw of dto.tabularSections) {
			if (isRecord(raw) && typeof raw.name === 'string' && tsSyn.has(raw.name)) {
				raw.synonymRu = tsSyn.get(raw.name);
			}
		}
	}
}

const MODULE_FILE_BY_KIND: Record<string, string> = {
	object: 'ObjectModule.bsl',
	manager: 'ManagerModule.bsl',
};

async function openObjectModuleFromPanel(objectXmlFsPath: string, internalName: string, moduleKind: string): Promise<void> {
	const fileName = MODULE_FILE_BY_KIND[moduleKind];
	if (!fileName) {
		return;
	}
	const modulePath = path.join(path.dirname(objectXmlFsPath), internalName, 'Ext', fileName);
	const uri = vscode.Uri.file(modulePath);
	try {
		await vscode.workspace.fs.stat(uri);
	} catch {
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(modulePath)));
		await vscode.workspace.fs.writeFile(uri, new Uint8Array());
		void vscode.window.showInformationMessage(`Создан пустой модуль: ${fileName}`);
	}
	const doc = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(doc, { preview: false });
}

function registerEditableSaveHandler(
	context: vscode.ExtensionContext,
	panel: vscode.WebviewPanel,
	params: OpenMetadataObjectPropertiesParams,
	runtime: Awaited<ReturnType<typeof ensureMdSparrowRuntime>>,
	schema: string,
	editable: MetadataPanelEditableModel,
	candidates: MetadataEditCandidates
): void {
	const enqueue = params.enqueueMutation ?? (<T,>(fn: () => Promise<T>): Promise<T> => fn());
	let saving = false;

	async function rereadAndPushModel(): Promise<void> {
		const [propsResult, structureResult] = await Promise.all([
			runMdSparrowJson<MdObjectPropertiesDto>(
				runtime,
				{ op: 'cf-md-object-get', objectXml: params.objectXmlFsPath, schemaVersion: schema },
				params.cwd
			),
			runMdSparrowJson<MdObjectStructureDto>(
				runtime,
				{ op: 'cf-md-object-structure-get', objectXml: params.objectXmlFsPath, schemaVersion: schema },
				params.cwd
			),
		]);
		if (!propsResult.ok) {
			return;
		}
		const vm = buildViewModel(
			params,
			propsResult.value,
			structureResult.ok ? structureResult.value : null,
			[],
			candidates
		);
		if (vm.editable) {
			editable.props = vm.editable.props;
			editable.tabs = vm.editable.tabs;
		}
		void panel.webview.postMessage({
			type: 'modelUpdated',
			tabs: vm.tabs,
			props: editable.props,
			editableTabs: editable.tabs,
			structureLists: vm.structureLists,
		});
	}

	async function runOneMutation(opParams: MdSparrowParams): Promise<string | null> {
		const res = await enqueue(() => runMdSparrowParamsMutation(runtime, opParams, { cwd: params.cwd }));
		if (res.exitCode !== 0) {
			const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(0, ERR_PREVIEW);
			log.error(`${opParams.op}: ${errText}`);
			return errText;
		}
		return null;
	}

	async function handleSave(msg: MetadataPanelSaveMessage): Promise<void> {
		const structureEdits = parseStructureEdits(msg.structure);
		if (structureEdits) {
			const validationError = validateStructureEdits(structureEdits);
			if (validationError) {
				void panel.webview.postMessage({ type: 'saved', ok: false, error: validationError });
				return;
			}
		}
		const ops = structureEdits ? structOpsFromEdits(structureEdits, params.objectXmlFsPath, schema) : [];
		let structApplied = false;
		for (const opParams of ops) {
			const error = await runOneMutation(opParams);
			if (error) {
				void panel.webview.postMessage({ type: 'saved', ok: false, error: `${opParams.op}: ${error}` });
				if (structApplied) {
					await rereadAndPushModel();
					void vscode.commands.executeCommand('1c-platform-tools.metadata.refresh');
				}
				return;
			}
			structApplied = true;
		}

		let baseProps = editable.props;
		if (ops.length > 0) {
			const reread = await runMdSparrowJson<MdObjectPropertiesDto>(
				runtime,
				{ op: 'cf-md-object-get', objectXml: params.objectXmlFsPath, schemaVersion: schema },
				params.cwd
			);
			if (reread.ok) {
				baseProps = reread.value;
			}
		}
		const dto = applyEditedScalars(baseProps as unknown as Record<string, unknown>, msg.payload, editable.tabs);
		if (structureEdits) {
			applySynonymEdits(dto, structureEdits);
		}
		const error = await runOneMutation({
			op: 'cf-md-object-set',
			objectXml: params.objectXmlFsPath,
			schemaVersion: schema,
			payloadJson: JSON.stringify(dto),
		});
		if (error) {
			void panel.webview.postMessage({ type: 'saved', ok: false, error });
			if (structApplied) {
				await rereadAndPushModel();
				void vscode.commands.executeCommand('1c-platform-tools.metadata.refresh');
			}
			return;
		}
		void panel.webview.postMessage({ type: 'saved', ok: true });
		await rereadAndPushModel();
		void vscode.commands.executeCommand('1c-platform-tools.metadata.refresh');
	}

	panel.webview.onDidReceiveMessage(
		async (msg: MetadataPanelSaveMessage) => {
			if (!msg) {
				return;
			}
			if (msg.type === 'openModule' && typeof msg.module === 'string') {
				try {
					await openObjectModuleFromPanel(params.objectXmlFsPath, editable.props.internalName, msg.module);
				} catch (e) {
					const errMsg = e instanceof Error ? e.message : String(e);
					void vscode.window.showErrorMessage(`Не удалось открыть модуль: ${errMsg}`.slice(0, ERR_PREVIEW));
				}
				return;
			}
			if (msg.type !== 'save' || saving) {
				return;
			}
			saving = true;
			try {
				await handleSave(msg);
			} finally {
				saving = false;
			}
		},
		undefined,
		context.subscriptions
	);
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
