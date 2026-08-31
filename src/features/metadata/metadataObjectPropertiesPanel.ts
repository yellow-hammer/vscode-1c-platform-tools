/**
 * Панель свойств объекта метаданных (webview): чтение через md-sparrow,
 * для справочника — редактирование скалярных свойств с записью `cf-md-object-set`.
 * @module metadataObjectPropertiesPanel
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { registerFormPanel } from '../editors/formPanels';
import { beginOpenPanel, endOpenPanel, revealOpenPanel, trackOpenPanel } from '../editors/openPanels';
import { formModulePath, objectFormXmlPath, openFormViewer } from './formViewerPanel';
import { ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { logger } from '../../shared/logger';
import { mdSparrowSchemaFlagFromConfigurationXml } from './mdSparrowSchemaVersion';
import {
	runMdSparrowParamsMutation,
	runMdSparrowParamsRead,
	type MdSparrowOp,
	type MdSparrowParams,
} from './mdSparrowParams';
import {
	applyEditedScalars,
	applyEnumDictionary,
	labelOf,
	type EnumValueLabels,
	ensureCurrentSelectValues,
	findUnknownEnumValues,
	normalizeTabLayout,
	withTemplatesTab,
	buildCatalogEditTabs,
	buildCommonModuleEditTabs,
	buildSessionParameterEditTabs,
	buildDocumentNumeratorEditTabs,
	buildEventSubscriptionEditTabs,
	buildScheduledJobEditTabs,
	buildCommonCommandEditTabs,
	buildCommonAttributeEditTabs,
	buildCommonPictureEditTabs,
	buildRoleEditTabs,
	buildExternalDataSourceEditTabs,
	buildConstantEditTabs,
	buildDocumentEditTabs,
	buildEnumEditTabs,
	buildRegisterEditTabs,
	buildReportEditTabs,
	buildDocumentJournalEditTabs,
	buildExchangePlanEditTabs,
	buildChartOfCharacteristicTypesEditTabs,
	buildTaskEditTabs,
	buildBusinessProcessEditTabs,
	buildChartOfAccountsEditTabs,
	buildChartOfCalculationTypesEditTabs,
	type MetadataEditOption,
	type MetadataEditTabSpec,
	type MetadataEnumDictionary,
	buildGenericEditTabs,
	type GenericSectionLists,
	TAB_ORDER,
	buildScalarGroups,
	type ScalarPropertyMeta,
} from './metadataObjectEditSpec';
import {
	METADATA_OBJECT_SECTION_SOURCES_BY_TYPE,
	METADATA_SECTION_TITLE_BY_SOURCE,
	type MetadataObjectSectionSource,
} from './metadataObjectSectionProfiles';
import {
	metadataObjectPropertyProfileByType,
	type MetadataObjectPropertyProfile,
	type MetadataPropertySpecialSection,
} from './metadataObjectPropertyProfiles';
import { notifyQuiet } from '../../shared/notify';
import { isAdopted } from './objectBelonging';

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
	/** Скалярные свойства вида без моста: имя элемента выгрузки → значение. */
	scalars?: Record<string, unknown>;
	scalarMeta?: Record<string, ScalarPropertyMeta>;
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
	standardAttributes?: unknown[];
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
	render: 'overview' | 'named' | 'tabular' | 'list' | 'kv' | 'json' | 'subsystemContent' | 'subsystems' | 'refContent' | 'edit';
	data?: unknown;
}

interface MetadataPanelEditableModel {
	props: MdObjectPropertiesDto;
	tabs: MetadataEditTabSpec[];
	/** Заимствованный объект расширения: форма та же, но только просмотр. */
	readonly?: boolean;
}

/** Списки структуры для вкладки «Данные» (реквизиты и табличные части с операциями). */
/** Список состава объекта на вкладке «Данные». */
interface MetadataPanelStructureList {
	/** Поле DTO, если список редактируемый: `attributes` либо `enumValues`. */
	key: string;
	/** Вкладка панели, на которой список показывается: у команд своя, как в конфигураторе. */
	tab: string;
	title: string;
	/** Подпись кнопки добавления; пусто у списков только на чтение. */
	addLabel: string;
	/** Правится ли список из панели: у регистров состав пока только показываем. */
	editable: boolean;
	rows: MetadataNamedRow[];
}

interface MetadataPanelStructureLists {
	/** Списки состава сверху вниз: у справочника «Реквизиты», у регистра — измерения, ресурсы, реквизиты. */
	lists: MetadataPanelStructureList[];
	tabularSections: MetadataTabularSectionRow[];
	/** Есть ли у вида объекта табличные части. */
	supportsTabularSections: boolean;
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

/** Узел дерева подсистем на вкладке «Подсистемы». */
interface MetadataPanelSubsystemNode {
	name: string;
	xmlPath: string;
	/** Объект входит в состав этой подсистемы. */
	member: boolean;
	children: MetadataPanelSubsystemNode[];
}

/** Участие объекта в подсистемах: как в конфигураторе, флажками. */
interface MetadataPanelSubsystemsModel {
	/** Ссылка объекта в терминах состава: `Catalog.Номенклатура`. */
	objectRef: string;
	nodes: MetadataPanelSubsystemNode[];
}

/** Группа дерева состава: вид объекта и его имена. */
interface MetadataPanelRefContentGroup {
	tag: string;
	label: string;
	names: string[];
}

/** Режимы участника состава: у общего реквизита это использование. */
interface MetadataPanelRefContentModes {
	options: Array<{ value: string; label: string }>;
	defaultValue: string;
	/** Режим каждой отмеченной ссылки. */
	byRef: Record<string, string>;
}

/** Секция дерева состава: свой список ссылок в DTO и свои виды объектов. */
interface MetadataPanelRefContentSection {
	/** Поле DTO со ссылками: contentRefs, documents, registerRecords, contentMembers. */
	key: string;
	title: string;
	/** Отмеченные ссылки: объекты и отдельные реквизиты. */
	refs: string[];
	groups: MetadataPanelRefContentGroup[];
	/** Ссылки не на объект целиком: реквизиты, табличные части. Снять можно, добавить пока нельзя. */
	extras: string[];
	modes?: MetadataPanelRefContentModes;
}

/** Состав объекта деревом с флажками: как в конфигураторе. */
interface MetadataPanelRefContentModel {
	title: string;
	sections: MetadataPanelRefContentSection[];
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
	subsystems?: MetadataPanelSubsystemsModel;
	refContent?: MetadataPanelRefContentModel;
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
	accountingFlags: 'Признаки учёта',
	extDimensionAccountingFlags: 'Признаки учёта субконто',
	dimensions: 'Измерения',
	resources: 'Ресурсы',
	recalculations: 'Перерасчёты',
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
	actionPeriod: 'Период действия',
	auxiliaryForm: 'Вспомогательная форма',
	auxiliaryLoadForm: 'Вспомогательная форма загрузки',
	auxiliarySaveForm: 'Вспомогательная форма сохранения',
	basePeriod: 'Базовый период',
	category: 'Категория',
	chartOfAccounts: 'План счетов',
	chartOfCalculationTypes: 'План видов расчёта',
	correspondence: 'Корреспонденция',
	defaultForm: 'Основная форма',
	defaultLoadForm: 'Основная форма загрузки',
	defaultSaveForm: 'Основная форма сохранения',
	descriptorFileName: 'Имя файла описания',
	enableTotalsSplitting: 'Разрешить разделение итогов',
	formType: 'Тип формы',
	languageCode: 'Код языка',
	location: 'Хранение',
	moveBoundaryOnPosting: 'Перемещать границу при проведении',
	namespace: 'URI пространства имён',
	periodAdjustmentLength: 'Длина корректировки периода',
	periodicity: 'Периодичность',
	privilegedGetMode: 'Привилегированный режим при получении',
	representation: 'Отображение',
	reuseSessions: 'Повторное использование сеансов',
	rootURL: 'Корневой URL',
	schedule: 'График',
	scheduleDate: 'Дата графика',
	scheduleValue: 'Значение графика',
	sessionMaxAge: 'Время жизни сеанса, сек',
	templateType: 'Тип макета',
	type: 'Тип',
	includeInCommandInterface: 'Включать в командный интерфейс',
	useOneCommand: 'Использовать одну команду',
};

const XML_FRAGMENT_KEYS = new Set<string>(['standardAttributesXml', 'characteristicsXml']);

export const MD_REF_KIND_LABEL_BY_PREFIX: Record<string, string> = {
	Catalog: 'Справочник',
	CatalogRef: 'Справочник',
	Document: 'Документ',
	DocumentRef: 'Документ',
	DocumentJournal: 'Журнал документов',
	DocumentJournalRef: 'Журнал документов',
	Enum: 'Перечисление',
	EnumRef: 'Перечисление',
	Report: 'Отчёт',
	ReportRef: 'Отчёт',
	DataProcessor: 'Обработка',
	DataProcessorRef: 'Обработка',
	ExternalReport: 'Внешний отчёт',
	ExternalReportRef: 'Внешний отчёт',
	ExternalDataProcessor: 'Внешняя обработка',
	ExternalDataProcessorRef: 'Внешняя обработка',
	InformationRegister: 'Регистр сведений',
	InformationRegisterRef: 'Регистр сведений',
	AccumulationRegister: 'Регистр накопления',
	AccumulationRegisterRef: 'Регистр накопления',
	AccountingRegister: 'Регистр бухгалтерии',
	AccountingRegisterRef: 'Регистр бухгалтерии',
	CalculationRegister: 'Регистр расчёта',
	CalculationRegisterRef: 'Регистр расчёта',
	ChartOfAccounts: 'План счетов',
	ChartOfAccountsRef: 'План счетов',
	ChartOfCharacteristicTypes: 'План видов характеристик',
	ChartOfCharacteristicTypesRef: 'План видов характеристик',
	ChartOfCalculationTypes: 'План видов расчёта',
	ChartOfCalculationTypesRef: 'План видов расчёта',
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
	return OBJECT_TYPE_BY_KIND[kind] ?? '';
}

/**
 * Вид объекта в терминах выгрузки по kind из md-sparrow.
 *
 * Таблица полная: по ней панель находит разделы состава и подпись вида, и вид
 * без строки здесь остался бы без вкладок разделов и с английским ярлыком.
 */
const OBJECT_TYPE_BY_KIND: Readonly<Record<string, string>> = {
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
	constant: 'Constant',
	documentJournal: 'DocumentJournal',
	documentNumerator: 'DocumentNumerator',
	sequence: 'Sequence',
	chartOfAccounts: 'ChartOfAccounts',
	chartOfCharacteristicTypes: 'ChartOfCharacteristicTypes',
	chartOfCalculationTypes: 'ChartOfCalculationTypes',
	informationRegister: 'InformationRegister',
	accumulationRegister: 'AccumulationRegister',
	accountingRegister: 'AccountingRegister',
	calculationRegister: 'CalculationRegister',
	businessProcess: 'BusinessProcess',
	webService: 'WebService',
	httpService: 'HTTPService',
	integrationService: 'IntegrationService',
	externalDataSource: 'ExternalDataSource',
	filterCriterion: 'FilterCriterion',
	settingsStorage: 'SettingsStorage',
	commonModule: 'CommonModule',
	sessionParameter: 'SessionParameter',
	role: 'Role',
	commonAttribute: 'CommonAttribute',
	commonPicture: 'CommonPicture',
	eventSubscription: 'EventSubscription',
	scheduledJob: 'ScheduledJob',
	commonCommand: 'CommonCommand',
	commandGroup: 'CommandGroup',
	commonForm: 'CommonForm',
	commonTemplate: 'CommonTemplate',
	functionalOption: 'FunctionalOption',
	functionalOptionsParameter: 'FunctionalOptionsParameter',
	definedType: 'DefinedType',
	xdtoPackage: 'XDTOPackage',
	wsReference: 'WSReference',
	style: 'Style',
	styleItem: 'StyleItem',
	language: 'Language',
	interface: 'Interface',
	bot: 'Bot',
	webSocketClient: 'WebSocketClient',
	form: 'Form',
	template: 'Template',
};

/** Подпись вида по-русски: заголовок вкладки и ярлык в шапке панели. */
const KIND_LABELS: Readonly<Record<string, string>> = {
	catalog: 'Справочник',
	document: 'Документ',
	report: 'Отчёт',
	dataProcessor: 'Обработка',
	externalReport: 'Внешний отчёт',
	externalDataProcessor: 'Внешняя обработка',
	exchangePlan: 'План обмена',
	subsystem: 'Подсистема',
	task: 'Задача',
	enum: 'Перечисление',
	constant: 'Константа',
	documentJournal: 'Журнал документов',
	documentNumerator: 'Нумератор документов',
	sequence: 'Последовательность',
	chartOfAccounts: 'План счетов',
	chartOfCharacteristicTypes: 'План видов характеристик',
	chartOfCalculationTypes: 'План видов расчёта',
	informationRegister: 'Регистр сведений',
	accumulationRegister: 'Регистр накопления',
	accountingRegister: 'Регистр бухгалтерии',
	calculationRegister: 'Регистр расчёта',
	businessProcess: 'Бизнес-процесс',
	webService: 'Web-сервис',
	httpService: 'HTTP-сервис',
	integrationService: 'Сервис интеграции',
	externalDataSource: 'Внешний источник данных',
	filterCriterion: 'Критерий отбора',
	settingsStorage: 'Хранилище настроек',
	commonModule: 'Общий модуль',
	sessionParameter: 'Параметр сеанса',
	role: 'Роль',
	commonAttribute: 'Общий реквизит',
	commonPicture: 'Общая картинка',
	eventSubscription: 'Подписка на событие',
	scheduledJob: 'Регламентное задание',
	commonCommand: 'Общая команда',
	commandGroup: 'Группа команд',
	commonForm: 'Общая форма',
	commonTemplate: 'Общий макет',
	functionalOption: 'Функциональная опция',
	functionalOptionsParameter: 'Параметр функциональных опций',
	definedType: 'Определяемый тип',
	xdtoPackage: 'XDTO-пакет',
	wsReference: 'WS-ссылка',
	style: 'Стиль',
	styleItem: 'Элемент стиля',
	language: 'Язык',
	interface: 'Интерфейс',
	bot: 'Бот',
	webSocketClient: 'WebSocket-клиент',
	form: 'Форма',
	template: 'Макет',
};

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

function humanizeStandaloneString(value: string, key = ''): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return '';
	}
	const metadataRef = humanizeMetadataReference(trimmed);
	if (metadataRef) {
		return metadataRef;
	}
	return labelOf(valueLabels, key, trimmed);
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
	return humanizeStandaloneString(trimmed, key);
}

function panelTitleForKind(kind: string, internalName: string): string {
	const label = KIND_LABELS[kind];
	return label ? `${label}: ${internalName}` : `Свойства: ${internalName}`;
}

function kindLabel(kind: string, objectType: string): string {
	const byKind = KIND_LABELS[kind];
	if (byKind) {
		return byKind;
	}
	// objectType приходит из дерева в PascalCase: ищем kind с тем же видом
	const kindFromType = Object.entries(OBJECT_TYPE_BY_KIND).find(([, type]) => type === objectType)?.[0];
	return (kindFromType && KIND_LABELS[kindFromType]) || kind || objectType || 'Объект';
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

/** Строки состава: DTO свойств отдаёт объекты с синонимом, структура объекта — только имена. */
function asNamedRows(value: unknown): MetadataNamedRow[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: MetadataNamedRow[] = [];
	for (const item of value) {
		if (typeof item === 'string') {
			const name = item.trim();
			if (name) {
				out.push({ name, synonymRu: '', comment: '' });
			}
			continue;
		}
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

/** Словари формата в рамках сеанса: набор констант меняется только вместе с версией формата. */
const enumDictionaryCache = new Map<string, MetadataEnumDictionary>();

/**
 * Подписи значений от md-sparrow: набор значений задаёт формат выгрузки, и разбираться в нём должна
 * библиотека формата. Пока библиотека не ответила, значение показывается как есть.
 */
let valueLabels: EnumValueLabels = {};

/** Читает подписи значений; они зависят от библиотеки, а не от версии формата. */
async function loadValueLabels(
	runtime: Awaited<ReturnType<typeof ensureMdSparrowRuntime>>,
	cwd: string
): Promise<void> {
	const res = await runMdSparrowJson<EnumValueLabels>(runtime, { op: 'cf-enum-labels' }, cwd);
	if (res.ok) {
		valueLabels = res.value;
	} else {
		log.warn(`подписи значений: ${res.error}`);
	}
}

/**
 * Допустимые значения перечислимых свойств для версии формата.
 * Если md-sparrow ответить не смог, словарь пустой: панель покажет варианты как в спеке.
 */
async function loadEnumDictionary(
	runtime: Awaited<ReturnType<typeof ensureMdSparrowRuntime>>,
	cwd: string,
	schema: string
): Promise<MetadataEnumDictionary> {
	const cacheKey = `${runtime.jarPath}|${schema}`;
	const cached = enumDictionaryCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	const res = await runMdSparrowJson<MetadataEnumDictionary>(
		runtime,
		{ op: 'cf-md-object-enums', schemaVersion: schema },
		cwd
	);
	if (!res.ok) {
		log.warn(`словарь значений формата ${schema}: ${res.error}`);
		return {};
	}
	enumDictionaryCache.set(cacheKey, res.value);
	return res.value;
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
		// У вида без состава структура не читается по определению: свойства есть,
		// предупреждать не о чем
		const unsupported = isUnsupportedMdObjectError(structureResult.error);
		if (!(unsupported && propsDto)) {
			warnings.push(`Структура объекта: ${toUserFacingReadError(structureResult.error).slice(0, ERR_PREVIEW)}`);
		}
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

/**
 * Вкладки профиля, замещённые редактируемыми: обзор, реквизиты, табличные части
 * и все разделы состава - их рисуют структурные списки единой формы. Иначе
 * признаки учёта и перерасчёты оставались вкладками старого вида рядом с новыми.
 */
const TAB_IDS_REPLACED_BY_EDIT = new Set<string>([
	'overview',
	'attributes',
	'tabularSections',
	'nestedSubsystems',
	...Object.keys(METADATA_SECTION_TITLE_BY_SOURCE).map((source) => `section_${source}`),
]);

function buildTabs(
	props: MdObjectPropertiesDto | null,
	structure: MdObjectStructureDto | null,
	objectType: string,
	editable?: MetadataPanelEditableModel,
	subsystems?: MetadataPanelSubsystemsModel,
	refContent?: MetadataPanelRefContentModel
): MetadataPanelTab[] {
	const profileTabs = buildProfileTabs(objectType, props, structure).filter(
		// Дерево состава с флажками замещает вкладку-просмотр состава
		(tab) => !(refContent && tab.id === 'contentRefs')
	);
	const out = editable
		? [
				...editable.tabs.map((tab): MetadataPanelTab => ({ id: tab.id, title: tab.title, render: 'edit' })),
				...profileTabs.filter((tab) => !TAB_IDS_REPLACED_BY_EDIT.has(tab.id)),
			]
		: [...profileTabs];
	if (subsystems && subsystems.nodes.length > 0) {
		// Как в конфигураторе: подсистемы сразу после «Основных»
		out.splice(Math.min(1, out.length), 0, { id: 'subsystems', title: 'Подсистемы', render: 'subsystems' });
	}
	if (refContent) {
		out.push({ id: 'refContent', title: refContent.title, render: 'refContent' });
	}
	return out;
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
	/** Хранилища настроек конфигурации: кандидаты в хранилища вариантов и настроек отчёта. */
	settingsStorageNames: readonly string[];
	/** Регистры сведений: кандидаты в регистр адресации задачи. */
	informationRegisterNames: readonly string[];
	/** Задачи конфигурации: кандидаты в задачу бизнес-процесса. */
	taskNames: readonly string[];
	/** Планы видов характеристик: кандидаты в виды субконто плана счетов. */
	characteristicTypeNames: readonly string[];
	/** Планы видов расчёта: кандидаты в базовые виды расчёта. */
	calculationTypeNames: readonly string[];
	/** Общие формы конфигурации: их платформа тоже разрешает назначать основными формами. */
	commonFormNames: readonly string[];
	/** Параметры сеанса: кандидаты в текущего исполнителя задачи. */
	sessionParameterNames: readonly string[];
	/** Объекты, на основании которых платформа разрешает вводить: не только справочники и документы. */
	basedOnOptions: readonly MetadataEditOption[];
	/** Кандидаты ссылочных скаляров по имени свойства: хранение опции, план счетов регистра. */
	scalarRefOptions: Readonly<Record<string, readonly MetadataEditOption[]>>;
}

const EMPTY_CANDIDATES: MetadataEditCandidates = {
	catalogNames: [],
	documentNames: [],
	numeratorNames: [],
	registerOptions: [],
	settingsStorageNames: [],
	informationRegisterNames: [],
	taskNames: [],
	characteristicTypeNames: [],
	calculationTypeNames: [],
	commonFormNames: [],
	sessionParameterNames: [],
	basedOnOptions: [],
	scalarRefOptions: {},
};

/**
 * Модель редактирования: вкладки по спеке, но варианты перечислимых свойств - из словаря формата
 * (`cf-md-object-enums`). Своего списка констант расширение не держит: он бы разошёлся с форматом.
 */
function buildEditableModel(
	props: MdObjectPropertiesDto | null,
	structure: MdObjectStructureDto | null,
	internalName: string,
	candidates: MetadataEditCandidates = EMPTY_CANDIDATES,
	enums: MetadataEnumDictionary = {}
): MetadataPanelEditableModel | undefined {
	const model = buildEditableModelBySpec(props, structure, internalName, candidates);
	if (!model) {
		return undefined;
	}
	const unknown = findUnknownEnumValues(model.tabs, enums);
	if (unknown.length > 0) {
		log.warn(`панель свойств: значений нет в формате выгрузки: ${unknown.join(', ')}`);
	}
	// Макеты показываем у видов, у которых они бывают: у общего модуля их не заводят вовсе.
	const sections = METADATA_OBJECT_SECTION_SOURCES_BY_TYPE[objectTypeFromKind(props?.kind ?? '')] ?? [];
	const withTemplates = sections.includes('templates')
		? withTemplatesTab(model.tabs, rawNameList(structure?.templates))
		: model.tabs;
	const withEnums = applyEnumDictionary(normalizeTabLayout(withTemplates), enums, valueLabels);
	const withCurrent = ensureCurrentSelectValues(withEnums, props as unknown as Record<string, unknown>, valueLabels);
	const tabs = withTabsForStructure(withCurrent, buildStructureLists(props, structure));
	if (propsIsAdopted(props)) {
		// Свои правила состава XML у заимствованных: показываем ту же форму без правки
		return { ...model, readonly: true, tabs: tabsAsReadonly(tabs) };
	}
	return { ...model, tabs };
}

/** Принадлежность объекта: заимствованные приходят с ObjectBelonging = Adopted. */
function propsIsAdopted(props: MdObjectPropertiesDto | null): boolean {
	if (!props) {
		return false;
	}
	const raw = props as unknown as Record<string, unknown>;
	const holders = [raw.catalog, raw.document, simpleKindProps(props), isRecord(raw.scalars) ? raw.scalars : undefined];
	return holders.some(
		(holder) =>
			isRecord(holder) && isAdopted((holder as Record<string, unknown>).objectBelonging ?? holder.ObjectBelonging)
	);
}

/** Та же форма с полями без правки. */
function tabsAsReadonly(tabs: readonly MetadataEditTabSpec[]): MetadataEditTabSpec[] {
	return tabs.map((tab) => ({
		...tab,
		groups: tab.groups.map((group) => ({
			...group,
			fields: group.fields.map((field) => ({ ...field, readonly: true })),
		})),
	}));
}

/**
 * Достраивает вкладки, на которых живёт состав объекта: без вкладки редактору
 * состава некуда встать, а спека вида про состав не знает. Недостающая вкладка
 * вставляется по каноническому порядку.
 */
function withTabsForStructure(
	tabs: readonly MetadataEditTabSpec[],
	structureLists: MetadataPanelStructureLists
): MetadataEditTabSpec[] {
	const required = new Set(structureLists.lists.map((list) => list.tab));
	if (structureLists.supportsTabularSections || structureLists.tabularSections.length > 0) {
		required.add('edit_data');
	}
	const out = [...tabs];
	for (const { id, title } of TAB_ORDER) {
		if (!required.has(id) || out.some((tab) => tab.id === id)) {
			continue;
		}
		const canonIndex = TAB_ORDER.findIndex((tab) => tab.id === id);
		const later = out.findIndex(
			(tab) => TAB_ORDER.findIndex((canon) => canon.id === tab.id) > canonIndex
		);
		const empty: MetadataEditTabSpec = { id, title, groups: [] };
		if (later < 0) {
			out.push(empty);
		} else {
			out.splice(later, 0, empty);
		}
	}
	return out;
}

function buildEditableModelBySpec(
	props: MdObjectPropertiesDto | null,
	structure: MdObjectStructureDto | null,
	internalName: string,
	candidates: MetadataEditCandidates
): MetadataPanelEditableModel | undefined {
	if (!props) {
		return undefined;
	}
	if (props.kind === 'catalog' && isRecord(props.catalog)) {
		const catalog = props.catalog as Record<string, unknown>;
		return {
			props,
			tabs: buildCatalogEditTabs({
				internalName,
				formNames: rawNameList(structure?.forms),
				commandNames: rawNameList(structure?.commands),
				commonFormNames: candidates.commonFormNames,
				basedOnOptions: candidates.basedOnOptions,
				standardAttributeNames: rawNameList(structure?.standardAttributes),
				catalogNames: candidates.catalogNames,
				documentNames: candidates.documentNames,
				attributeNames: rawNameList(props.attributes),
				hasOwners: Array.isArray(catalog.owners) && catalog.owners.length > 0,
				hierarchical: catalog.hierarchical === true,
			}),
		};
	}
	if (props.kind === 'document' && isRecord(props.document)) {
		return {
			props,
			tabs: buildDocumentEditTabs({
				internalName,
				formNames: rawNameList(structure?.forms),
				commandNames: rawNameList(structure?.commands),
				commonFormNames: candidates.commonFormNames,
				basedOnOptions: candidates.basedOnOptions,
				standardAttributeNames: rawNameList(structure?.standardAttributes),
				catalogNames: candidates.catalogNames,
				documentNames: candidates.documentNames,
				attributeNames: rawNameList(props.attributes),
				numeratorNames: candidates.numeratorNames,
				registerOptions: candidates.registerOptions,
			}),
		};
	}
	const simpleTabs = buildSimpleEditableTabs(props, structure, internalName, candidates);
	if (simpleTabs) {
		return { props, tabs: simpleTabs };
	}
	return undefined;
}

/** Виды с плоским набором свойств: перечисление, константа, общий модуль. */
function buildSimpleEditableTabs(
	props: MdObjectPropertiesDto,
	structure: MdObjectStructureDto | null,
	internalName: string,
	candidates: MetadataEditCandidates = EMPTY_CANDIDATES
): MetadataEditTabSpec[] | undefined {
	if (!kindHasDedicatedSpec(props.kind ?? '')) {
		// Вид без выделенной спеки: общая форма из «Основных», скалярных свойств
		// вида и вкладок разделов состава
		const scalars = isRecord(props.scalars) ? props.scalars : undefined;
		const sections = genericSectionLists(props, structure);
		const scalarGroups = scalars
			? buildScalarGroups(
					scalars,
					props.scalarMeta ?? {},
					sectionTitleByKey,
					(property, value) => labelOf(valueLabels, property, value),
					scalarRefOptionsFor(props, sections, candidates)
				)
			: [];
		return buildGenericEditTabs(objectTypeFromKind(props.kind ?? ''), sections, scalarGroups);
	}
	const kindProps = simpleKindProps(props);
	if (!kindProps) {
		// Спека у вида есть, а его свойства не прочитаны: остаётся просмотр
		return undefined;
	}

	const input = {
		internalName,
		formNames: rawNameList(structure?.forms),
		commandNames: rawNameList(structure?.commands),
		commonFormNames: candidates.commonFormNames,
		basedOnOptions: candidates.basedOnOptions,
		standardAttributeNames: rawNameList(structure?.standardAttributes),
	};
	switch (props.kind) {
		case 'enum':
			return buildEnumEditTabs(input);
		case 'constant':
			return buildConstantEditTabs(input);
		case 'commonModule':
			return buildCommonModuleEditTabs();
		case 'sessionParameter':
			return buildSessionParameterEditTabs();
		case 'documentNumerator':
			return buildDocumentNumeratorEditTabs();
		case 'eventSubscription':
			return buildEventSubscriptionEditTabs();
		case 'scheduledJob':
			return buildScheduledJobEditTabs();
		case 'commonCommand':
			return buildCommonCommandEditTabs();
		case 'commonAttribute':
			return buildCommonAttributeEditTabs();
		case 'commonPicture':
			return buildCommonPictureEditTabs();
		case 'role':
			return buildRoleEditTabs();
		case 'externalDataSource':
			return buildExternalDataSourceEditTabs();
		case 'report':
			return buildReportEditTabs({
				...input,
				report: true,
				templateNames: rawNameList(structure?.templates),
				settingsStorageNames: candidates.settingsStorageNames,
			});
		case 'dataProcessor':
			return buildReportEditTabs({ ...input, report: false });
		case 'documentJournal':
			return buildDocumentJournalEditTabs({ ...input, documentNames: candidates.documentNames });
		case 'task':
			return buildTaskEditTabs({
				...input,
				attributeNames: rawNameList(props.attributes),
				addressingAttributeNames: rawNameList(structure?.addressingAttributes),
				informationRegisterNames: candidates.informationRegisterNames,
				sessionParameterNames: candidates.sessionParameterNames,
				catalogNames: candidates.catalogNames,
				documentNames: candidates.documentNames,
			});
		case 'businessProcess':
			return buildBusinessProcessEditTabs({
				...input,
				attributeNames: rawNameList(props.attributes),
				taskNames: candidates.taskNames,
				catalogNames: candidates.catalogNames,
				documentNames: candidates.documentNames,
			});
		case 'chartOfCalculationTypes':
			return buildChartOfCalculationTypesEditTabs({
				...input,
				attributeNames: rawNameList(props.attributes),
				calculationTypeNames: candidates.calculationTypeNames,
				catalogNames: candidates.catalogNames,
				documentNames: candidates.documentNames,
			});
		case 'chartOfAccounts':
			return buildChartOfAccountsEditTabs({
				...input,
				attributeNames: rawNameList(props.attributes),
				characteristicTypeNames: candidates.characteristicTypeNames,
				catalogNames: candidates.catalogNames,
				documentNames: candidates.documentNames,
			});
		case 'chartOfCharacteristicTypes':
			return buildChartOfCharacteristicTypesEditTabs({
				...input,
				attributeNames: rawNameList(props.attributes),
				catalogNames: candidates.catalogNames,
				documentNames: candidates.documentNames,
			});
		case 'exchangePlan':
			return buildExchangePlanEditTabs({
				...input,
				attributeNames: rawNameList(props.attributes),
				catalogNames: candidates.catalogNames,
				documentNames: candidates.documentNames,
			});
		case 'informationRegister':
			return buildRegisterEditTabs({ ...input, information: true });
		case 'accumulationRegister':
			return buildRegisterEditTabs({ ...input, information: false });
		default:
			// У вида без своей спеки форма та же, что у остальных: «Основные»
			// плюс вкладка на каждый раздел состава этого вида. Синоним и
			// комментарий пишет общий путь cf-md-object-set.
			return buildGenericEditTabs(objectTypeFromKind(props.kind ?? ''), genericSectionLists(props, structure));
	}
}

/**
 * Списки имён по разделам: из структуры, а где её нет - из свойств объекта.
 *
 * Структура читается отдельной операцией и поддерживает не каждый вид, поэтому
 * состав, который есть в самих свойствах (измерения, ресурсы, операции), берётся
 * оттуда как запасной источник.
 */
function genericSectionLists(
	props: MdObjectPropertiesDto | null,
	structure: MdObjectStructureDto | null
): GenericSectionLists {
	const record = (value: unknown): readonly string[] => rawNameList(value as never);
	const pick = (fromStructure: unknown, fromProps: unknown): readonly string[] => {
		const names = record(fromStructure);
		return names.length > 0 ? names : record(fromProps);
	};
	const p = props as unknown as Record<string, unknown> | null;
	return {
		attributes: pick(structure?.attributes, p?.attributes),
		tabularSections: pick(structure?.tabularSections, p?.tabularSections),
		forms: record(structure?.forms),
		commands: pick(structure?.commands, p?.commands),
		values: pick(structure?.values, p?.enumValues),
		columns: pick(structure?.columns, p?.columns),
		accountingFlags: pick(structure?.accountingFlags, p?.accountingFlags),
		extDimensionAccountingFlags: pick(structure?.extDimensionAccountingFlags, p?.extDimensionAccountingFlags),
		dimensions: pick(structure?.dimensions, p?.dimensions),
		resources: pick(structure?.resources, p?.resources),
		recalculations: pick(structure?.recalculations, p?.recalculations),
		addressingAttributes: pick(structure?.addressingAttributes, p?.addressingAttributes),
		operations: pick(structure?.operations, p?.operations),
		urlTemplates: pick(structure?.urlTemplates, p?.urlTemplates),
		channels: pick(structure?.channels, p?.channels),
		tables: pick(structure?.tables, p?.tables),
		cubes: pick(structure?.cubes, p?.cubes),
		functions: pick(structure?.functions, p?.functions),
	};
}


/** Формы в ссылочных свойствах пишутся полным именем: `Вид.Объект.Form.Форма`. */
const FORM_REF_SCALARS: readonly string[] = [
	'DefaultForm',
	'AuxiliaryForm',
	'DefaultListForm',
	'AuxiliaryListForm',
	'DefaultLoadForm',
	'AuxiliaryLoadForm',
	'DefaultSaveForm',
	'AuxiliarySaveForm',
];

/**
 * Кандидаты ссылочных скаляров: из конфигурации приходят константы и планы,
 * формы берутся у самого объекта, общие формы платформа тоже разрешает.
 */
function scalarRefOptionsFor(
	props: MdObjectPropertiesDto,
	sections: GenericSectionLists,
	candidates: MetadataEditCandidates
): Record<string, readonly MetadataEditOption[]> {
	const out: Record<string, readonly MetadataEditOption[]> = { ...candidates.scalarRefOptions };
	const meta = props.scalarMeta ?? {};
	const wantsForms = FORM_REF_SCALARS.some((name) => name in meta);
	if (!wantsForms) {
		return out;
	}
	const objectType = objectTypeFromKind(props.kind ?? '');
	const formOptions: MetadataEditOption[] = [
		...(sections.forms ?? []).map((name) => ({
			value: `${objectType}.${props.internalName}.Form.${name}`,
			label: name,
		})),
		...candidates.commonFormNames.map((name) => ({
			value: `CommonForm.${name}`,
			label: name,
			hint: 'Общая форма',
		})),
	];
	if (formOptions.length === 0) {
		return out;
	}
	for (const name of FORM_REF_SCALARS) {
		if (name in meta && !(name in out)) {
			out[name] = formOptions;
		}
	}
	return out;
}

/** У вида есть своя спека вкладок: свойства без неё показываются только просмотром. */
function kindHasDedicatedSpec(kind: string): boolean {
	return kind === 'catalog' || kind === 'document' || SIMPLE_SPEC_KINDS.has(kind);
}

/** Виды, которые разбирает buildSimpleEditableTabs. */
const SIMPLE_SPEC_KINDS = new Set([
	'enum',
	'constant',
	'commonModule',
	'report',
	'dataProcessor',
	'documentJournal',
	'exchangePlan',
	'chartOfCharacteristicTypes',
	'task',
	'chartOfAccounts',
	'chartOfCalculationTypes',
	'businessProcess',
	'informationRegister',
	'accumulationRegister',
	'sessionParameter',
	'documentNumerator',
	'eventSubscription',
	'scheduledJob',
	'commonCommand',
	'commonAttribute',
	'commonPicture',
	'role',
	'externalDataSource',
]);

function simpleKindProps(props: MdObjectPropertiesDto): Record<string, unknown> | undefined {
	const raw = props as unknown as Record<string, unknown>;
	const byKind: Record<string, unknown> = {
		enum: raw.enumeration,
		constant: raw.constant,
		commonModule: raw.commonModule,
		report: raw.report,
		dataProcessor: raw.report,
		documentJournal: raw.documentJournal,
		exchangePlan: raw.exchangePlan,
		chartOfCharacteristicTypes: raw.chartOfCharacteristicTypes,
		task: raw.task,
		chartOfAccounts: raw.chartOfAccounts,
		chartOfCalculationTypes: raw.chartOfCalculationTypes,
		businessProcess: raw.businessProcess,
		informationRegister: raw.register,
		accumulationRegister: raw.register,
		sessionParameter: raw.sessionParameter,
		documentNumerator: raw.documentNumerator,
		eventSubscription: raw.eventSubscription,
		scheduledJob: raw.scheduledJob,
		commonCommand: raw.commonCommand,
		commonAttribute: raw.commonAttribute,
		commonPicture: raw.commonPicture,
		role: raw.role,
		externalDataSource: raw.externalDataSource,
	};
	const value = props.kind ? byKind[props.kind] : undefined;
	return isRecord(value) ? (value as Record<string, unknown>) : undefined;
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
	candidates: MetadataEditCandidates = EMPTY_CANDIDATES,
	enums: MetadataEnumDictionary = {},
	subsystems?: MetadataPanelSubsystemsModel,
	refContent?: MetadataPanelRefContentModel
): MetadataPanelViewModel {
	const declaredObjectType = normalizeObjectType(params.objectType ?? '');
	const internalName = props?.internalName || structure?.internalName || path.parse(params.objectXmlFsPath).name;
	const objectKind = props?.kind || structure?.kind || declaredObjectType || 'object';
	const objectType = declaredObjectType || normalizeObjectType(objectTypeFromKind(objectKind));
	const technicalPayload = {
		properties: props ? { ...props, scalarMeta: undefined } : props,
		structure,
	};
	const editable = buildEditableModel(props, structure, internalName, candidates, enums);
	const structureLists = editable ? buildStructureLists(props, structure) : undefined;
	return {
		objectKind,
		objectKindLabel: kindLabel(objectKind, objectType),
		objectType,
		internalName,
		synonymRu: props?.synonymRu ?? '',
		comment: props?.comment ?? '',
		objectXmlPath: params.objectXmlFsPath,
		warnings,
		tabs: buildTabs(props, structure, objectType, editable, subsystems, refContent),
		technicalJson: JSON.stringify(technicalPayload, null, 2),
		editable,
		structureLists,
		subsystems,
		refContent,
	};
}

/** Тестовый хелпер: списки структуры без запуска webview. */
/** Тестовый хелпер редактируемой модели без запуска webview. */
export function buildMetadataObjectPropertiesEditableForTest(
	objectType: string,
	props: unknown,
	structure: unknown,
	candidates?: Partial<MetadataEditCandidates>
): MetadataPanelEditableModel | undefined {
	const propsDto = isRecord(props) ? (props as unknown as MdObjectPropertiesDto) : null;
	const structureDto = isRecord(structure) ? (structure as unknown as MdObjectStructureDto) : null;
	return buildEditableModel(propsDto, structureDto, propsDto?.internalName ?? '', {
		...EMPTY_CANDIDATES,
		...candidates,
	});
}

export function buildStructureListsForTest(props: unknown, structure: unknown): MetadataPanelStructureLists {
	return buildStructureLists(
		isRecord(props) ? (props as unknown as MdObjectPropertiesDto) : null,
		isRecord(structure) ? (structure as unknown as MdObjectStructureDto) : null
	);
}


function buildStructureLists(
	props: MdObjectPropertiesDto | null,
	structure: MdObjectStructureDto | null
): MetadataPanelStructureLists {
	const sections = METADATA_OBJECT_SECTION_SOURCES_BY_TYPE[objectTypeFromKind(props?.kind ?? '')] ?? [];
	const raw = props as unknown as Record<string, unknown> | null;
	const structureRecord = structure as unknown as Record<string, unknown> | null;
	const lists: MetadataPanelStructureList[] = [];
	if (props?.kind === 'subsystem') {
		// Вложенные подсистемы создаются в дереве: панель их показывает тем же
		// видом, что остальные разделы состава
		lists.push({
			key: 'nestedSubsystems',
			tab: 'edit_data',
			title: 'Вложенные подсистемы',
			addLabel: '',
			editable: false,
			rows: asNamedRows(props.nestedSubsystems),
		});
	}
	for (const source of sections) {
		const meta = STRUCT_LIST_BY_SOURCE[source];
		if (!meta) {
			continue;
		}
		// Значения перечисления в свойствах лежат под своим именем
		const propsKey = source === 'values' ? 'enumValues' : source;
		const own = asNamedRows(raw?.[propsKey]);
		const rows = own.length > 0 ? own : asNamedRows(structureRecord?.[source]);
		lists.push({
			key: propsKey,
			tab: meta.tab,
			title: METADATA_SECTION_TITLE_BY_SOURCE[source],
			addLabel: meta.addLabel ?? '',
			editable: meta.addLabel !== undefined,
			rows,
		});
	}
	const supportsTabularSections = sections.includes('tabularSections');
	if (propsIsAdopted(props)) {
		// Состав заимствованного смотрят, но не правят: табличные части списком
		const roLists = lists.map((list) => ({ ...list, addLabel: '', editable: false }));
		if (supportsTabularSections) {
			roLists.push({
				key: 'tabularSections',
				tab: 'edit_data',
				title: 'Табличные части',
				addLabel: '',
				editable: false,
				rows: asNamedRows(props?.tabularSections ?? structure?.tabularSections),
			});
		}
		return { lists: roLists, tabularSections: [], supportsTabularSections: false };
	}
	return {
		lists,
		tabularSections: supportsTabularSections
			? mergeTabularSections(props?.tabularSections, structure?.tabularSections)
			: [],
		supportsTabularSections,
	};
}

/**
 * Раздел состава на панели: вкладка и подпись кнопки добавления.
 *
 * Кнопка есть только у разделов, которые md-sparrow умеет менять; остальные
 * показываются списком. Формы и макеты живут своими вкладками, табличные
 * части - своим блоком, поэтому их здесь нет.
 */
const STRUCT_LIST_BY_SOURCE: Partial<
	Record<MetadataObjectSectionSource, { readonly tab: string; readonly addLabel?: string }>
> = {
	addressingAttributes: { tab: 'edit_data' },
	dimensions: { tab: 'edit_data', addLabel: '+ Измерение…' },
	resources: { tab: 'edit_data', addLabel: '+ Ресурс…' },
	attributes: { tab: 'edit_data', addLabel: '+ Реквизит…' },
	values: { tab: 'edit_data', addLabel: '+ Значение…' },
	commands: { tab: 'edit_commands', addLabel: '+ Команда…' },
	columns: { tab: 'edit_data' },
	accountingFlags: { tab: 'edit_data', addLabel: '+ Признак…' },
	extDimensionAccountingFlags: { tab: 'edit_data', addLabel: '+ Признак субконто…' },
	recalculations: { tab: 'edit_data' },
	operations: { tab: 'edit_data' },
	urlTemplates: { tab: 'edit_data' },
	channels: { tab: 'edit_data' },
	tables: { tab: 'edit_data' },
	cubes: { tab: 'edit_data' },
	functions: { tab: 'edit_data' },
};

/**
 * Поля графика регистра расчёта зависят от выбранного регистра-графика:
 * дата выбирается из его измерений, значение - из ресурсов. Опции строятся
 * по сохранённому графику; после смены графика и сохранения модель
 * перечитывается, и списки обновляются под новый регистр.
 */
async function withScheduleFieldOptions(
	runtime: Awaited<ReturnType<typeof ensureMdSparrowRuntime>>,
	params: OpenMetadataObjectPropertiesParams,
	schema: string,
	props: MdObjectPropertiesDto | null,
	candidates: MetadataEditCandidates
): Promise<MetadataEditCandidates> {
	const schedule = props?.kind === 'calculationRegister' ? props.scalars?.Schedule : undefined;
	const match = typeof schedule === 'string' ? /^InformationRegister\.([\wА-ЯЁа-яё]+)$/.exec(schedule) : null;
	if (!match || !params.cfgPath) {
		return candidates;
	}
	const registerXml = path.join(path.dirname(params.cfgPath), 'InformationRegisters', `${match[1]}.xml`);
	const res = await runMdSparrowJson<MdObjectStructureDto>(
		runtime,
		{ op: 'cf-md-object-structure-get', objectXml: registerXml, schemaVersion: schema },
		params.cwd
	);
	if (!res.ok) {
		log.warn(`поля графика: ${res.error.slice(0, ERR_PREVIEW)}`);
		return candidates;
	}
	const options = (names: readonly string[], tag: string): MetadataEditOption[] =>
		names.map((name) => ({ value: `${schedule}.${tag}.${name}`, label: name }));
	return {
		...candidates,
		scalarRefOptions: {
			...candidates.scalarRefOptions,
			ScheduleDate: options(rawNameList(res.value.dimensions), 'Dimension'),
			ScheduleValue: options(rawNameList(res.value.resources), 'Resource'),
		},
	};
}

/** Секция состава вида: где ссылки лежат в DTO и какие виды объектов предлагать. */
interface RefContentSectionSpec {
	readonly key: string;
	readonly title: string;
	/** Виды объектов секции; null - весь состав конфигурации. */
	readonly tags: readonly string[] | null;
	/** Предлагать ли подсистемы: в составе опции они отмечаются, в составе подсистемы - нет. */
	readonly subsystems?: boolean;
	readonly modes?: Omit<MetadataPanelRefContentModes, 'byRef'>;
}

/** Виды, состав которых правится деревом с флажками. */
const REF_CONTENT_BY_KIND: Readonly<Record<string, { title: string; sections: readonly RefContentSectionSpec[] }>> = {
	functionalOption: {
		title: 'Состав',
		sections: [{ key: 'contentRefs', title: 'Состав', tags: null, subsystems: true }],
	},
	functionalOptionsParameter: {
		title: 'Использование',
		sections: [{ key: 'contentRefs', title: 'Использование', tags: null, subsystems: true }],
	},
	subsystem: {
		title: 'Состав',
		sections: [{ key: 'contentRefs', title: 'Состав', tags: null }],
	},
	// Состав критерия - ссылки на реквизиты: дерево кандидатов не строим,
	// существующие ссылки показываются списком и снимаются
	filterCriterion: {
		title: 'Состав',
		sections: [{ key: 'contentRefs', title: 'Состав', tags: [] }],
	},
	exchangePlan: {
		title: 'Состав',
		sections: [
			{
				key: 'exchangeContent',
				title: 'Состав',
				tags: [
					'Constant',
					'Catalog',
					'Document',
					'ChartOfCharacteristicTypes',
					'ChartOfAccounts',
					'ChartOfCalculationTypes',
					'InformationRegister',
					'AccumulationRegister',
					'AccountingRegister',
					'CalculationRegister',
					'BusinessProcess',
					'Task',
					'Sequence',
				],
				modes: {
					options: [
						{ value: 'Allow', label: 'Разрешить' },
						{ value: 'Deny', label: 'Запретить' },
					],
					defaultValue: 'Deny',
				},
			},
		],
	},
	commonAttribute: {
		title: 'Состав',
		sections: [
			{
				key: 'contentMembers',
				title: 'Состав',
				tags: null,
				modes: {
					options: [
						{ value: 'AUTO', label: 'Авто' },
						{ value: 'USE', label: 'Использовать' },
						{ value: 'DONT_USE', label: 'Не использовать' },
					],
					defaultValue: 'USE',
				},
			},
		],
	},
	sequence: {
		title: 'Состав',
		sections: [
			{ key: 'documents', title: 'Входящие документы', tags: ['Document'] },
			{
				key: 'registerRecords',
				title: 'Движения регистров',
				tags: ['AccumulationRegister', 'AccountingRegister', 'CalculationRegister', 'InformationRegister'],
			},
		],
	},
};

/**
 * Дерево состава объекта: весь состав конфигурации одним чтением, отмечено то,
 * что уже входит. Ссылки на реквизиты показываются отдельно.
 */
async function loadRefContentModel(
	runtime: Awaited<ReturnType<typeof ensureMdSparrowRuntime>>,
	params: OpenMetadataObjectPropertiesParams,
	schema: string,
	props: MdObjectPropertiesDto | null
): Promise<MetadataPanelRefContentModel | undefined> {
	const spec = props?.kind ? REF_CONTENT_BY_KIND[props.kind] : undefined;
	if (!spec || !params.cfgPath) {
		return undefined;
	}
	const res = await runMdSparrowJson<Record<string, string[]>>(
		runtime,
		{ op: 'cf-list-all-child-objects', configurationXml: params.cfgPath, schemaVersion: schema },
		params.cwd
	);
	if (!res.ok) {
		log.warn(`состав конфигурации: ${res.error.slice(0, ERR_PREVIEW)}`);
		return undefined;
	}
	const raw = props as unknown as Record<string, unknown>;
	const sections: MetadataPanelRefContentSection[] = [];
	for (const section of spec.sections) {
		let rawRefs: unknown = raw[section.key];
		if (section.key === 'exchangeContent') {
			// Состав плана обмена лежит отдельным файлом и читается своей операцией
			const membersRes = await runMdSparrowJson<Array<{ ref: string; mode: string }>>(
				runtime,
				{ op: 'cf-md-exchange-plan-content-get', objectXml: params.objectXmlFsPath, schemaVersion: schema },
				params.cwd
			);
			if (!membersRes.ok) {
				log.warn(`состав плана обмена: ${membersRes.error.slice(0, ERR_PREVIEW)}`);
				continue;
			}
			rawRefs = membersRes.value;
		}
		sections.push(buildRefContentSection(section, res.value, rawRefs));
	}
	if (sections.length === 0) {
		return undefined;
	}
	return { title: spec.title, sections };
}

function buildRefContentSection(
	spec: RefContentSectionSpec,
	allObjects: Record<string, string[]>,
	rawRefs: unknown
): MetadataPanelRefContentSection {
	// Состав с режимами приходит объектами {ref, mode}: ссылки и режимы врозь
	const members = Array.isArray(rawRefs)
		? rawRefs.filter(isRecord).filter((item) => typeof item.ref === 'string')
		: [];
	const modeByRef: Record<string, string> = {};
	for (const member of members) {
		modeByRef[String(member.ref)] = typeof member.mode === 'string' ? member.mode : '';
	}
	const refs = Array.isArray(rawRefs)
		? rawRefs.map((item) => (isRecord(item) ? String(item.ref ?? '') : String(item))).filter(Boolean)
		: [];
	const groups: MetadataPanelRefContentGroup[] = [];
	for (const [tag, names] of Object.entries(allObjects)) {
		if (!Array.isArray(names) || names.length === 0 || tag === 'Subsystem') {
			continue;
		}
		if (spec.tags && !spec.tags.includes(tag)) {
			continue;
		}
		groups.push({ tag, label: kindLabel('', tag), names: names.map(String) });
	}
	// Подсистемы в составе опции тоже отмечаются: конфигуратор кладёт их в раздел «Общие»
	const subsystems = allObjects.Subsystem;
	if (spec.subsystems && Array.isArray(subsystems) && subsystems.length > 0) {
		groups.unshift({ tag: 'Subsystem', label: 'Подсистема', names: subsystems.map(String) });
	}
	const known = new Set(groups.flatMap((group) => group.names.map((name) => `${group.tag}.${name}`)));
	return {
		key: spec.key,
		title: spec.title,
		refs,
		groups,
		extras: refs.filter((ref) => !known.has(ref)),
		modes: spec.modes ? { ...spec.modes, byRef: modeByRef } : undefined,
	};
}

/** Тестовый хелпер секции состава: без чтения конфигурации. */
export function buildRefContentSectionsForTest(
	kind: string,
	props: unknown,
	allObjects: Record<string, string[]>
): MetadataPanelRefContentSection[] | undefined {
	const spec = REF_CONTENT_BY_KIND[kind];
	if (!spec) {
		return undefined;
	}
	const raw = isRecord(props) ? props : {};
	return spec.sections.map((section) => buildRefContentSection(section, allObjects, raw[section.key]));
}

/** Узел ответа cf-md-subsystem-tree. */
interface SubsystemTreeNodeDto {
	name: string;
	xmlPath: string;
	contentRefs?: string[];
	children?: SubsystemTreeNodeDto[];
}

/**
 * Дерево подсистем конфигурации: у внешних файлов подсистем нет, ошибка чтения
 * оставляет панель без вкладки, а не без свойств.
 */
async function loadSubsystemNodes(
	runtime: Awaited<ReturnType<typeof ensureMdSparrowRuntime>>,
	params: OpenMetadataObjectPropertiesParams,
	schema: string
): Promise<SubsystemTreeNodeDto[] | null> {
	if (!params.cfgPath) {
		return null;
	}
	const res = await runMdSparrowJson<SubsystemTreeNodeDto[]>(
		runtime,
		{ op: 'cf-md-subsystem-tree', configurationXml: params.cfgPath, schemaVersion: schema },
		params.cwd
	);
	if (!res.ok) {
		log.warn(`дерево подсистем: ${res.error.slice(0, ERR_PREVIEW)}`);
		return null;
	}
	return res.value;
}

/** Участие объекта в подсистемах по дереву состава. Подсистемам вкладка не нужна: у них своя. */
function buildSubsystemsModel(
	nodes: SubsystemTreeNodeDto[] | null,
	params: OpenMetadataObjectPropertiesParams,
	props: MdObjectPropertiesDto | null,
	structure: MdObjectStructureDto | null
): MetadataPanelSubsystemsModel | undefined {
	const objectType = normalizeObjectType(params.objectType ?? '') || objectTypeFromKind(props?.kind ?? '');
	const internalName = props?.internalName || structure?.internalName || '';
	if (!nodes || nodes.length === 0 || !objectType || !internalName || objectType === 'Subsystem') {
		return undefined;
	}
	const objectRef = `${objectType}.${internalName}`;
	const convert = (node: SubsystemTreeNodeDto): MetadataPanelSubsystemNode => ({
		name: node.name,
		xmlPath: node.xmlPath,
		member: (node.contentRefs ?? []).includes(objectRef),
		children: (node.children ?? []).map(convert),
	});
	return { objectRef, nodes: nodes.map(convert) };
}

/** Разбирает изменения состава из сообщения webview: секция, ссылка, членство. */
function parseContentEdits(raw: unknown): Array<{ key: string; ref: string; member: boolean; mode?: string }> {
	if (!Array.isArray(raw)) {
		return [];
	}
	const allowed = new Set(['contentRefs', 'documents', 'registerRecords', 'contentMembers', 'exchangeContent']);
	const out: Array<{ key: string; ref: string; member: boolean; mode?: string }> = [];
	for (const item of raw) {
		if (
			isRecord(item) &&
			typeof item.key === 'string' &&
			allowed.has(item.key) &&
			typeof item.ref === 'string' &&
			typeof item.member === 'boolean'
		) {
			out.push({
				key: item.key,
				ref: item.ref,
				member: item.member,
				mode: typeof item.mode === 'string' ? item.mode : undefined,
			});
		}
	}
	return out;
}

/** Разбирает изменения участия в подсистемах из сообщения webview. */
function parseSubsystemEdits(raw: unknown): Array<{ xmlPath: string; member: boolean }> {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out: Array<{ xmlPath: string; member: boolean }> = [];
	for (const item of raw) {
		if (isRecord(item) && typeof item.xmlPath === 'string' && typeof item.member === 'boolean') {
			out.push({ xmlPath: item.xmlPath, member: item.member });
		}
	}
	return out;
}

/**
 * Открывает read-only панель свойств объекта метаданных.
 */
export async function openMetadataObjectPropertiesEditor(
	context: vscode.ExtensionContext,
	params: OpenMetadataObjectPropertiesParams
): Promise<void> {
	if (revealOpenPanel('objectProperties', params.objectXmlFsPath)) {
		return;
	}
	// Чтение свойств занимает секунды: без брони повторный щелчок за это время
	// открывал копию вкладки
	if (!beginOpenPanel('objectProperties', params.objectXmlFsPath)) {
		return;
	}
	try {
		await openMetadataObjectPropertiesEditorInner(context, params);
	} finally {
		endOpenPanel('objectProperties', params.objectXmlFsPath);
	}
}

async function openMetadataObjectPropertiesEditorInner(
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
	const wantsCandidates = Boolean(params.cfgPath) && EDITABLE_CANDIDATE_TYPES.includes(editableType);
	const [propsResult, structureResult, candidates, enums] = await Promise.all([
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
		loadEnumDictionary(runtime, params.cwd, schema),
		loadValueLabels(runtime, params.cwd),
	]);
	const subsystemNodes = await loadSubsystemNodes(runtime, params, schema);

	const { propsDto, structureDto, warnings, fatalReason } = collectMetadataReadState(propsResult, structureResult);
	if (fatalReason) {
		void vscode.window.showErrorMessage(
			`Не удалось прочитать свойства объекта. ${fatalReason}`.slice(0, ERR_PREVIEW)
		);
		return;
	}

	const subsystems = buildSubsystemsModel(subsystemNodes, params, propsDto, structureDto);
	const scheduleAware = await withScheduleFieldOptions(runtime, params, schema, propsDto, candidates);
	const refContent = await loadRefContentModel(runtime, params, schema, propsDto);
	const viewModel = buildViewModel(
		params,
		propsDto,
		structureDto,
		warnings,
		scheduleAware,
		enums,
		subsystems,
		refContent
	);
	const title = panelTitleForKind(viewModel.objectKind, viewModel.internalName);
	const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview');
	const panel = vscode.window.createWebviewPanel('1cMetadataObjectProperties', title, vscode.ViewColumn.Active, {
		enableScripts: true,
		retainContextWhenHidden: true,
		localResourceRoots: [webviewRoot],
	});
	registerFormPanel(panel);
	trackOpenPanel('objectProperties', params.objectXmlFsPath, panel);

	if (viewModel.editable) {
		registerEditableSaveHandler(
			context,
			panel,
			params,
			runtime,
			schema,
			viewModel.editable,
			candidates,
			enums,
			subsystems
		);
	}

	try {
		panel.webview.html = await loadMetadataObjectHtml(panel.webview, context.extensionUri, viewModel);
	} catch (e) {
		log.error(`шаблон объекта: ${e instanceof Error ? e.message : String(e)}`);
		void vscode.window.showErrorMessage('Не удалось загрузить панель свойств.');
		panel.dispose();
	}
}

/**
 * Вкладки спеки для палитры свойств.
 *
 * Подбор ссылок из конфигурации сюда не идёт: он читает всю конфигурацию, а палитра показывает
 * свойства на каждое выделение в дереве. Поля со ссылками остаются в панели-вкладке.
 */
export function objectPaletteTabs(
	props: unknown,
	structure: unknown,
	internalName: string,
	enums: unknown
): readonly MetadataEditTabSpec[] {
	const model = buildEditableModel(
		props as MdObjectPropertiesDto | null,
		structure as MdObjectStructureDto | null,
		internalName,
		EMPTY_CANDIDATES,
		enums as MetadataEnumDictionary
	);
	return model?.tabs ?? [];
}

/** Виды, для которых панель подбирает ссылки из конфигурации. */
const EDITABLE_CANDIDATE_TYPES: readonly string[] = [
	'Catalog',
	'Document',
	'Enum',
	'Constant',
	'Report',
	'DataProcessor',
	'DocumentJournal',
	'ExchangePlan',
	'ChartOfCharacteristicTypes',
	'Task',
	'BusinessProcess',
	'ChartOfAccounts',
	'ChartOfCalculationTypes',
	'InformationRegister',
	'AccumulationRegister',
	'SessionParameter',
	'DocumentNumerator',
	'EventSubscription',
	'ScheduledJob',
	'CommonCommand',
	'CommonAttribute',
	'CommonPicture',
	'Role',
	'ExternalDataSource',
	'FunctionalOption',
	'AccountingRegister',
	'CalculationRegister',
	'FilterCriterion',
	'SettingsStorage',
];

/** Виды объектов, на основании которых платформа разрешает вводить новый объект. */
const BASED_ON_TAG_LABEL: Record<string, string> = {
	Catalog: 'Справочник',
	Document: 'Документ',
	ChartOfCharacteristicTypes: 'План видов характеристик',
	ChartOfAccounts: 'План счетов',
	ChartOfCalculationTypes: 'План видов расчёта',
	BusinessProcess: 'Бизнес-процесс',
	Task: 'Задача',
	ExchangePlan: 'План обмена',
};

const REGISTER_TAG_LABEL: Record<string, string> = {
	InformationRegister: 'Регистр сведений',
	AccumulationRegister: 'Регистр накопления',
	AccountingRegister: 'Регистр бухгалтерии',
	CalculationRegister: 'Регистр расчёта',
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
	const wantsSettingsStorages = editableType === 'Report';
	// справочники нужны владельцам и вводу на основании, документы - им же и журналу документов
	// виды, у которых есть ввод на основании: им нужен весь список возможных оснований
	const wantsBasedOn = Object.keys(BASED_ON_TAG_LABEL).includes(editableType);
	const wantsCatalogs = wantsBasedOn;
	const wantsDocuments = wantsCatalogs || editableType === 'DocumentJournal';
	const [
		catalogNames,
		documentNames,
		numeratorNames,
		settingsStorageNames,
		informationRegisterNames,
		taskNames,
		characteristicTypeNames,
		calculationTypeNames,
		commonFormNames,
		sessionParameterNames,
		basedOnLists,
		...registers
	] = await Promise.all([
		wantsCatalogs ? listByTag('Catalog') : Promise.resolve([]),
		wantsDocuments ? listByTag('Document') : Promise.resolve([]),
		wantsRegisters ? listByTag('DocumentNumerator') : Promise.resolve([]),
		wantsSettingsStorages ? listByTag('SettingsStorage') : Promise.resolve([]),
		editableType === 'Task' ? listByTag('InformationRegister') : Promise.resolve([]),
		editableType === 'BusinessProcess' ? listByTag('Task') : Promise.resolve([]),
		editableType === 'ChartOfAccounts' ? listByTag('ChartOfCharacteristicTypes') : Promise.resolve([]),
		editableType === 'ChartOfCalculationTypes' ? listByTag('ChartOfCalculationTypes') : Promise.resolve([]),
		listByTag('CommonForm'),
		editableType === 'Task' ? listByTag('SessionParameter') : Promise.resolve([]),
		wantsBasedOn
			? Promise.all(
					Object.keys(BASED_ON_TAG_LABEL).map(async (tag) => ({ tag, names: await listByTag(tag) }))
				)
			: Promise.resolve([]),
		...(wantsRegisters ? Object.keys(REGISTER_TAG_LABEL).map((tag) => listByTag(tag)) : []),
	]);
	const basedOnOptions: MetadataEditOption[] = (basedOnLists as Array<{ tag: string; names: string[] }>).flatMap(
		(list) => list.names.map((name) => ({ value: `${list.tag}.${name}`, label: name, hint: BASED_ON_TAG_LABEL[list.tag] }))
	);
	// Ссылочные скаляры видов без спеки: где хранится опция, какой план счетов
	// у регистра бухгалтерии, какой план видов расчёта и график у регистра расчёта
	const scalarRefOptions: Record<string, readonly MetadataEditOption[]> = {};
	const refOptions = (tag: string, names: readonly string[], hint: string): MetadataEditOption[] =>
		names.map((name) => ({ value: `${tag}.${name}`, label: name, hint }));
	if (editableType === 'FunctionalOption') {
		scalarRefOptions.Location = refOptions('Constant', await listByTag('Constant'), 'Константа');
	}
	if (editableType === 'AccountingRegister') {
		scalarRefOptions.ChartOfAccounts = refOptions('ChartOfAccounts', await listByTag('ChartOfAccounts'), 'План счетов');
	}
	if (editableType === 'CalculationRegister') {
		scalarRefOptions.ChartOfCalculationTypes = refOptions(
			'ChartOfCalculationTypes',
			await listByTag('ChartOfCalculationTypes'),
			'План видов расчёта'
		);
		scalarRefOptions.Schedule = refOptions('InformationRegister', await listByTag('InformationRegister'), 'Регистр сведений');
	}
	const registerOptions: MetadataEditOption[] = [];
	if (wantsRegisters) {
		Object.keys(REGISTER_TAG_LABEL).forEach((tag, index) => {
			for (const name of registers[index] ?? []) {
				registerOptions.push({ value: `${tag}.${name}`, label: name, hint: REGISTER_TAG_LABEL[tag] });
			}
		});
	}
	return {
		catalogNames,
		documentNames,
		numeratorNames,
		registerOptions,
		settingsStorageNames,
		informationRegisterNames,
		taskNames,
		characteristicTypeNames,
		calculationTypeNames,
		commonFormNames,
		sessionParameterNames,
		basedOnOptions,
		scalarRefOptions,
	};
}

interface MetadataPanelSaveMessage {
	type?: string;
	payload?: unknown;
	structure?: unknown;
	module?: string;
	/** Имя формы для открытия или удаления с вкладки «Формы». */
	name?: string;
	/** Изменённое участие в подсистемах: путь XML подсистемы и членство. */
	subsystems?: unknown;
	/** Изменённый состав опции: ссылка и членство. */
	content?: unknown;
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

/** Вид списка состава: поле DTO, в которое пишутся синонимы, и набор операций. */
export type MetadataStructListKind =
	| 'attributes'
	| 'enumValues'
	| 'dimensions'
	| 'resources'
	| 'commands'
	| 'accountingFlags'
	| 'extDimensionAccountingFlags';

interface MetadataStructListEdit {
	kind: MetadataStructListKind;
	rows: MetadataStructRowEdit[];
}

interface MetadataStructureEdits {
	lists: MetadataStructListEdit[];
	tabularSections: MetadataTabularSectionEdit[];
}

const STRUCT_OPS: Record<
	MetadataStructListKind,
	{ add: MdSparrowOp; rename: MdSparrowOp; del: MdSparrowOp; reorder?: MdSparrowOp }
> = {
	attributes: {
		add: 'cf-md-attribute-add',
		rename: 'cf-md-attribute-rename',
		del: 'cf-md-attribute-delete',
		reorder: 'cf-md-attribute-reorder',
	},
	enumValues: {
		add: 'cf-md-enum-value-add',
		rename: 'cf-md-enum-value-rename',
		del: 'cf-md-enum-value-delete',
		reorder: 'cf-md-enum-value-reorder',
	},
	dimensions: {
		add: 'cf-md-dimension-add',
		rename: 'cf-md-dimension-rename',
		del: 'cf-md-dimension-delete',
		reorder: 'cf-md-dimension-reorder',
	},
	resources: {
		add: 'cf-md-resource-add',
		rename: 'cf-md-resource-rename',
		del: 'cf-md-resource-delete',
		reorder: 'cf-md-resource-reorder',
	},
	commands: {
		add: 'cf-md-command-add',
		rename: 'cf-md-command-rename',
		del: 'cf-md-command-delete',
		reorder: 'cf-md-command-reorder',
	},
	// Перестановки признаков md-sparrow пока не умеет: панель их не предлагает
	accountingFlags: {
		add: 'cf-md-accounting-flag-add',
		rename: 'cf-md-accounting-flag-rename',
		del: 'cf-md-accounting-flag-delete',
	},
	extDimensionAccountingFlags: {
		add: 'cf-md-ext-dimension-accounting-flag-add',
		rename: 'cf-md-ext-dimension-accounting-flag-rename',
		del: 'cf-md-ext-dimension-accounting-flag-delete',
	},
};

const STRUCT_LIST_KINDS: readonly MetadataStructListKind[] = [
	'attributes',
	'enumValues',
	'dimensions',
	'resources',
	'commands',
	'accountingFlags',
	'extDimensionAccountingFlags',
];

function asStructListKind(value: unknown): MetadataStructListKind | undefined {
	return STRUCT_LIST_KINDS.find((kind) => kind === value);
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
	const lists: MetadataStructListEdit[] = [];
	if (Array.isArray(value.lists)) {
		for (const rawList of value.lists) {
			if (!isRecord(rawList)) {
				continue;
			}
			const kind = asStructListKind(rawList.kind);
			if (!kind) {
				continue;
			}
			const rows: MetadataStructRowEdit[] = [];
			if (Array.isArray(rawList.rows)) {
				for (const raw of rawList.rows) {
					const row = parseStructRow(raw);
					if (row) {
						rows.push(row);
					}
				}
			}
			lists.push({ kind, rows });
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
	return { lists, tabularSections };
}

/** Строки всех списков состава: проверки имён общие для реквизитов, значений, измерений и ресурсов. */
function allStructRows(edits: MetadataStructureEdits): MetadataStructRowEdit[] {
	return edits.lists.flatMap((list) => list.rows);
}

/** @returns текст первой ошибки валидации имён; null — правки корректны. */
export function validateStructureEdits(edits: MetadataStructureEdits): string | null {
	const topSeen = new Set<string>();
	for (const row of [...allStructRows(edits), ...edits.tabularSections]) {
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
	for (const list of edits.lists) {
		for (const row of list.rows) {
			if (!row.deleted && row.originalName && row.name !== row.originalName) {
				ops.push({ op: STRUCT_OPS[list.kind].rename, ...base, oldName: row.originalName, newName: row.name });
			}
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
	for (const list of edits.lists) {
		for (const row of list.rows) {
			if (row.deleted && row.originalName) {
				ops.push({ op: STRUCT_OPS[list.kind].del, ...base, name: row.originalName });
			}
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
	for (const list of edits.lists) {
		for (const row of list.rows) {
			if (!row.deleted && !row.originalName) {
				ops.push({ op: STRUCT_OPS[list.kind].add, ...base, name: row.name });
			}
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
	for (const list of edits.lists) {
		const order = list.rows.filter((row) => !row.deleted).map((row) => row.name);
		if (order.length > 1) {
			const reorder = STRUCT_OPS[list.kind].reorder;
			if (reorder) {
				ops.push({ op: reorder, ...base, payloadJson: JSON.stringify(order) });
			}
		}
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

/** Переносит синонимы строк структуры из правок в DTO (перечитанный после операций структуры). */
export function applySynonymEdits(dto: Record<string, unknown>, edits: MetadataStructureEdits): void {
	for (const list of edits.lists) {
		const synonyms = new Map<string, string>();
		for (const row of list.rows) {
			if (!row.deleted && row.name) {
				synonyms.set(row.name, row.synonymRu);
			}
		}
		const dtoList = dto[list.kind];
		if (!Array.isArray(dtoList)) {
			continue;
		}
		for (const raw of dtoList) {
			if (isRecord(raw) && typeof raw.name === 'string' && synonyms.has(raw.name)) {
				raw.synonymRu = synonyms.get(raw.name);
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
	module: 'Module.bsl',
	valueManager: 'ValueManagerModule.bsl',
	recordSet: 'RecordSetModule.bsl',
};

/** Открывает модуль команды объекта, создавая пустой файл при отсутствии. */
async function openCommandModuleFromPanel(objectXmlFsPath: string, commandName: string): Promise<void> {
	const stem = path.basename(objectXmlFsPath, '.xml');
	const modulePath = path.join(
		path.dirname(objectXmlFsPath),
		stem,
		'Commands',
		commandName,
		'Ext',
		'CommandModule.bsl'
	);
	const uri = vscode.Uri.file(modulePath);
	try {
		await vscode.workspace.fs.stat(uri);
	} catch {
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(modulePath)));
		await vscode.workspace.fs.writeFile(uri, new Uint8Array());
		notifyQuiet('Создан пустой модуль команды');
	}
	const doc = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(doc, { preview: false });
}

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
		notifyQuiet(`Создан пустой модуль: ${fileName}`);
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
	candidates: MetadataEditCandidates,
	enums: MetadataEnumDictionary,
	subsystemsModel?: MetadataPanelSubsystemsModel
): void {
	const enqueue = params.enqueueMutation ?? (<T,>(fn: () => Promise<T>): Promise<T> => fn());
	let saving = false;

	async function rereadAndPushModel(): Promise<void> {
		const [propsResult, structureResult, subsystemNodes] = await Promise.all([
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
			subsystemsModel ? loadSubsystemNodes(runtime, params, schema) : Promise.resolve(null),
		]);
		if (!propsResult.ok) {
			return;
		}
		const structureDto = structureResult.ok ? structureResult.value : null;
		const subsystems = buildSubsystemsModel(subsystemNodes, params, propsResult.value, structureDto);
		if (subsystems && subsystemsModel) {
			subsystemsModel.nodes = subsystems.nodes;
		}
		// После смены графика поля даты и значения выбираются из нового регистра
		const scheduleAware = await withScheduleFieldOptions(runtime, params, schema, propsResult.value, candidates);
		const refContent = await loadRefContentModel(runtime, params, schema, propsResult.value);
		const vm = buildViewModel(
			params,
			propsResult.value,
			structureDto,
			[],
			scheduleAware,
			enums,
			subsystems,
			refContent
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
			subsystems: vm.subsystems,
			refContent: vm.refContent,
			tabsChanged: true,
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

	/** Правит состав подсистемы: объект добавляется в неё или уходит из неё. */
	async function applySubsystemMembership(edit: { xmlPath: string; member: boolean }): Promise<string | null> {
		if (!subsystemsModel) {
			return 'вкладка подсистем не загружена';
		}
		const read = await runMdSparrowJson<MdObjectPropertiesDto>(
			runtime,
			{ op: 'cf-md-object-get', objectXml: edit.xmlPath, schemaVersion: schema },
			params.cwd
		);
		if (!read.ok) {
			return read.error.slice(0, ERR_PREVIEW);
		}
		const dto = read.value;
		const refs = Array.isArray(dto.contentRefs) ? [...dto.contentRefs] : [];
		const has = refs.includes(subsystemsModel.objectRef);
		if (has === edit.member) {
			return null;
		}
		dto.contentRefs = edit.member
			? [...refs, subsystemsModel.objectRef]
			: refs.filter((ref) => ref !== subsystemsModel.objectRef);
		return runOneMutation({
			op: 'cf-md-object-set',
			objectXml: edit.xmlPath,
			schemaVersion: schema,
			payloadJson: JSON.stringify(dto),
		});
	}

	/** Пишет состав плана обмена: текущий файл, правки поверх, своя операция записи. */
	async function applyExchangeContentEdits(
		edits: Array<{ ref: string; member: boolean; mode?: string }>
	): Promise<string | null> {
		const read = await runMdSparrowJson<Array<{ ref: string; mode: string }>>(
			runtime,
			{ op: 'cf-md-exchange-plan-content-get', objectXml: params.objectXmlFsPath, schemaVersion: schema },
			params.cwd
		);
		if (!read.ok) {
			return read.error.slice(0, ERR_PREVIEW);
		}
		const members = new Map(read.value.map((member) => [member.ref, member.mode]));
		for (const edit of edits) {
			if (edit.member) {
				members.set(edit.ref, edit.mode || members.get(edit.ref) || 'Deny');
			} else {
				members.delete(edit.ref);
			}
		}
		return runOneMutation({
			op: 'cf-md-exchange-plan-content-set',
			objectXml: params.objectXmlFsPath,
			schemaVersion: schema,
			payloadJson: JSON.stringify([...members.entries()].map(([ref, mode]) => ({ ref, mode }))),
		});
	}

	async function handleSave(msg: MetadataPanelSaveMessage): Promise<void> {
		const subsystemEdits = parseSubsystemEdits(msg.subsystems);
		for (const edit of subsystemEdits) {
			const error = await applySubsystemMembership(edit);
			if (error) {
				void panel.webview.postMessage({ type: 'saved', ok: false, error: `Подсистемы: ${error}` });
				return;
			}
		}
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
		const contentEdits = parseContentEdits(msg.content);
		const exchangeEdits = contentEdits.filter((edit) => edit.key === 'exchangeContent');
		if (exchangeEdits.length > 0) {
			const error = await applyExchangeContentEdits(exchangeEdits);
			if (error) {
				void panel.webview.postMessage({ type: 'saved', ok: false, error: `Состав: ${error}` });
				return;
			}
		}
		for (const edit of contentEdits) {
			if (edit.key === 'exchangeContent') {
				continue;
			}
			if (edit.key === 'contentMembers') {
				// Состав с режимами: у существующего участника меняется режим,
				// новый добавляется с выбранным, снятый уходит
				const members = (Array.isArray(dto.contentMembers) ? dto.contentMembers : []).filter(isRecord);
				const rest = members.filter((member) => String(member.ref) !== edit.ref);
				if (edit.member) {
					const current = members.find((member) => String(member.ref) === edit.ref);
					rest.push({
						...(current ?? { conditionalSeparation: '' }),
						ref: edit.ref,
						mode: edit.mode ?? (current ? current.mode : 'USE'),
					});
				}
				dto.contentMembers = rest;
				continue;
			}
			const refs = new Set(Array.isArray(dto[edit.key]) ? (dto[edit.key] as unknown[]).map(String) : []);
			if (edit.member) {
				refs.add(edit.ref);
			} else {
				refs.delete(edit.ref);
			}
			dto[edit.key] = [...refs];
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
			if (msg.type === 'openObjectForm' && typeof msg.name === 'string') {
				const formXml = objectFormXmlPath(params.objectXmlFsPath, msg.name);
				await openFormViewer(context, {
					formXmlFsPath: formXml,
					moduleFsPath: formModulePath(formXml),
					title: `${editable.props.internalName}.${msg.name}`,
					cwd: params.cwd,
					cfgPath: params.cfgPath,
					schemaFlag: params.cfgPath ? undefined : schema,
				});
				return;
			}
			if (msg.type === 'deleteObjectForm' && typeof msg.name === 'string') {
				const answer = await vscode.window.showWarningMessage(
					`Удалить форму «${msg.name}» вместе с файлами?`,
					{ modal: true },
					'Удалить'
				);
				if (answer !== 'Удалить') {
					return;
				}
				const error = await runOneMutation({
					op: 'cf-md-form-delete',
					objectXml: params.objectXmlFsPath,
					schemaVersion: schema,
					name: msg.name,
				});
				if (error) {
					void vscode.window.showErrorMessage(`Не удалось удалить форму. ${error}`.slice(0, ERR_PREVIEW));
					return;
				}
				notifyQuiet(`Форма «${msg.name}» удалена`);
				await rereadAndPushModel();
				void vscode.commands.executeCommand('1c-platform-tools.metadata.refresh');
				return;
			}
			if (msg.type === 'openObjectCommand' && typeof msg.name === 'string') {
				await openCommandModuleFromPanel(params.objectXmlFsPath, msg.name);
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
