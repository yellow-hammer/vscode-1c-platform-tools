/**
 * Спецификация редактируемых вкладок панели свойств объекта метаданных.
 * Спека — единственный источник правды о том, какие поля DTO можно менять из webview:
 * по ней строится форма и по ней же фильтруются значения при сохранении.
 * Значения enum-свойств — имена Java-констант md-sparrow (`BOTH_WAYS`, `QUICK_CHOICE`).
 * @module metadataObjectEditSpec
 */

import {
	METADATA_OBJECT_SECTION_SOURCES_BY_TYPE,
	type MetadataObjectSectionSource,
} from './metadataObjectSectionProfiles';

export type MetadataEditControl =
	| 'text'
	| 'textarea'
	| 'check'
	| 'number'
	| 'select'
	| 'staticList'
	| 'refList'
	| 'moduleLink'
	| 'type';

/** Примитивные типы платформы: значение — как в XML, подпись — как в конфигураторе. */
export const PRIMITIVE_TYPES: readonly MetadataEditOptionLike[] = [
	{ value: 'xs:string', label: 'Строка' },
	{ value: 'xs:decimal', label: 'Число' },
	{ value: 'xs:dateTime', label: 'Дата' },
	{ value: 'xs:boolean', label: 'Булево' },
	{ value: 'v8:ValueStorage', label: 'Хранилище значения' },
	{ value: 'v8:UUID', label: 'Уникальный идентификатор' },
];

interface MetadataEditOptionLike {
	readonly value: string;
	readonly label: string;
}

/** Квалификаторы, которые платформа заводит вместе с типом. */
export const TYPE_DEFAULT_QUALIFIERS: Readonly<Record<string, Record<string, unknown>>> = {
	'xs:string': { stringQualifiers: { length: '10', allowedLength: 'VARIABLE' } },
	'xs:decimal': { numberQualifiers: { digits: '10', fractionDigits: '0', allowedSign: 'ANY' } },
	'xs:dateTime': { dateQualifiers: { dateFractions: 'DATE' } },
	'v8:ValueStorage': {},
	'v8:UUID': {},
	'xs:boolean': {},
};

export interface MetadataEditOption {
	readonly value: string;
	readonly label: string;
	/** Уточнение вида объекта: в списке идёт приглушённым текстом, в подборе — заголовком группы. */
	readonly hint?: string;
}

/** Поле активно, только если значение по path равно equals (все условия одновременно). */
export interface MetadataEditCondition {
	readonly path: string;
	readonly equals: string | boolean;
}

export interface MetadataEditField {
	/** Путь в DTO свойств: `synonymRu` или `catalog.choiceMode`. */
	readonly path: string;
	readonly label: string;
	readonly control: MetadataEditControl;
	/** Для select — значения; для refList — кандидаты на добавление. */
	readonly options?: readonly MetadataEditOption[];
	readonly readonly?: boolean;
	/** select: пустой выбор — это очистка значения (пишется пустым), а не «оставить как есть». */
	readonly clearable?: boolean;
	readonly enabledWhen?: readonly MetadataEditCondition[];
	/** Элементы staticList, когда они берутся не из DTO (формы, команды из структуры). */
	readonly items?: readonly string[];
}

export interface MetadataEditGroup {
	readonly title: string;
	readonly fields: readonly MetadataEditField[];
}

export interface MetadataEditTabSpec {
	readonly id: string;
	readonly title: string;
	readonly groups: readonly MetadataEditGroup[];
}

function opts(...pairs: Array<[string, string]>): MetadataEditOption[] {
	return pairs.map(([value, label]) => ({ value, label }));
}

const USE_DONT_USE = opts(['USE', 'Использовать'], ['DONT_USE', 'Не использовать']);

/** Вспомогательные формы объекта: у каждого вида свой набор. */
type AuxiliaryFormKind = 'object' | 'folder' | 'list' | 'choice' | 'folderChoice' | 'record';

const AUXILIARY_FORM_LABELS: Readonly<Record<AuxiliaryFormKind, [string, string]>> = {
	object: ['auxiliaryObjectForm', 'Вспомогательная форма объекта'],
	folder: ['auxiliaryFolderForm', 'Вспомогательная форма группы'],
	list: ['auxiliaryListForm', 'Вспомогательная форма списка'],
	choice: ['auxiliaryChoiceForm', 'Вспомогательная форма выбора'],
	folderChoice: ['auxiliaryFolderChoiceForm', 'Вспомогательная форма выбора группы'],
	record: ['auxiliaryRecordForm', 'Вспомогательная форма записи'],
};

/** Общие свойства ссылочных видов: набор у них одинаковый, поэтому и спека одна. */
interface ReferenceCommonInput {
	/** Блок DTO: `catalog`, `task` и так далее. */
	block: string;
	/** Кандидаты в основные и вспомогательные формы. */
	forms: readonly MetadataEditOption[];
	/** Вспомогательные формы, которые у вида есть. */
	auxiliaryForms: readonly AuxiliaryFormKind[];
	/** Есть ли у вида свойства поля ввода: создание при вводе, поиск строки, получение данных. */
	inputField?: boolean;
	/** Есть ли у вида полнотекстовый поиск и история данных. */
	dataHistory?: boolean;
	/** Кандидаты в поля блокировки данных; пусто - поля у вида нет. */
	lockFields?: readonly MetadataEditOption[];
	/** Кандидаты в основания ввода; пусто - ввода на основании у вида нет. */
	basedOn?: readonly MetadataEditOption[];
}

/**
 * Добавляет к вкладкам вида общие свойства ссылочных видов. Куда они попадут, решает канон
 * раскладки, поэтому построителю достаточно объявить кандидатов ссылок.
 */
function withReferenceCommon(tabs: MetadataEditTabSpec[], common: ReferenceCommonInput): MetadataEditTabSpec[] {
	// Общие свойства идут последними: в группе сначала то, что вид объявил сам.
	const last = tabs[tabs.length - 1];
	return [
		...tabs.slice(0, -1),
		{ ...last, groups: [...last.groups, ...referenceCommonGroups(common)] },
	];
}

/**
 * Группы свойств, одинаковые у всех ссылочных видов: поле ввода, блокировка и история,
 * ввод на основании, вспомогательные формы. Канон раскладки сам разложит их по вкладкам,
 * а повторы с полями самого вида отбросит.
 */
function referenceCommonGroups(input: ReferenceCommonInput): MetadataEditGroup[] {
	const p = (name: string): string => `${input.block}.${name}`;
	const groups: MetadataEditGroup[] = [];
	if (input.inputField) {
		groups.push({
			title: 'Поле ввода',
			fields: [
				{
					path: p('createOnInput'),
					label: 'Создание при вводе',
					control: 'select',
					options: opts(['AUTO', 'Авто'], ['USE', 'Использовать'], ['DONT_USE', 'Не использовать']),
				},
				{
					path: p('searchStringModeOnInputByString'),
					label: 'Способ поиска строки при вводе',
					control: 'select',
					options: opts(['BEGIN', 'Начало'], ['ANY_PART', 'Любая часть']),
				},
				{
					path: p('fullTextSearchOnInputByString'),
					label: 'Полнотекстовый поиск при вводе',
					control: 'select',
					options: USE_DONT_USE,
				},
				{
					path: p('choiceDataGetModeOnInputByString'),
					label: 'Режим получения данных выбора',
					control: 'select',
					options: opts(['DIRECTLY', 'Непосредственно'], ['BACKGROUND', 'Фоновым заданием']),
				},
			],
		});
	}
	if (input.dataHistory) {
		groups.push({
			title: 'Блокировка и история',
			fields: [
				{ path: p('fullTextSearch'), label: 'Полнотекстовый поиск', control: 'select', options: USE_DONT_USE },
				{ path: p('dataHistory'), label: 'История данных', control: 'select', options: USE_DONT_USE },
				{
					path: p('updateDataHistoryImmediatelyAfterWrite'),
					label: 'Обновлять историю данных сразу после записи',
					control: 'check',
					enabledWhen: [{ path: p('dataHistory'), equals: 'USE' }],
				},
				{
					path: p('executeAfterWriteDataHistoryVersionProcessing'),
					label: 'Выполнять обработку версий истории данных после записи',
					control: 'check',
					enabledWhen: [{ path: p('dataHistory'), equals: 'USE' }],
				},
			],
		});
	}
	if (input.auxiliaryForms.length > 0) {
		groups.push({
			title: 'Основные формы',
			fields: input.auxiliaryForms.map((kind) => {
				const [property, label] = AUXILIARY_FORM_LABELS[kind];
				return {
					path: p(property),
					label,
					control: 'select' as const,
					options: input.forms,
					clearable: true,
				};
			}),
		});
	}
	if (input.lockFields) {
		groups.push({
			title: 'Блокировка и история',
			fields: [
				{
					path: p('dataLockFields'),
					label: 'Поля блокировки данных',
					control: 'refList',
					options: input.lockFields,
				},
			],
		});
	}
	if (input.basedOn) {
		groups.push({
			title: 'Ввод на основании',
			fields: [{ path: p('basedOn'), label: 'Вводится на основании', control: 'refList', options: input.basedOn }],
		});
	}
	return groups;
}

interface CatalogEditSpecInput {
	/** Стандартные реквизиты объекта из файла: кандидаты в поля блокировки данных. */
	standardAttributeNames?: readonly string[];
	/** Готовые кандидаты в основания ввода: их состав определяет панель. */
	basedOnOptions?: readonly MetadataEditOption[];
	internalName: string;
	formNames: readonly string[];
	commandNames: readonly string[];
	/** Имена общих форм конфигурации - кандидаты в основные формы объекта. */
	commonFormNames?: readonly string[];
	/** Имена всех справочников конфигурации — кандидаты во владельцы и в основания. */
	catalogNames?: readonly string[];
	/** Имена документов конфигурации — кандидаты в основания. */
	documentNames?: readonly string[];
	/** Имена реквизитов объекта — кандидаты для ввода по строке и полей блокировки. */
	attributeNames?: readonly string[];
	/** Есть ли владельцы на момент открытия — влияет на кандидатов полей блокировки. */
	hasOwners?: boolean;
	/** Иерархический ли на момент открытия — влияет на кандидатов полей блокировки. */
	hierarchical?: boolean;
}

/**
 * Кандидаты в основную форму: формы самого объекта и общие формы конфигурации.
 * Общие формы платформа разрешает назначать основными, и конфигурации этим пользуются.
 */
function objectFormOptions(
	prefix: string,
	internalName: string,
	formNames: readonly string[],
	commonFormNames: readonly string[] = []
): MetadataEditOption[] {
	return [
		{ value: '', label: '(не задана)' },
		...formNames.map((name) => ({ value: `${prefix}.${internalName}.Form.${name}`, label: name })),
		...commonFormNames.map((name) => ({ value: `CommonForm.${name}`, label: name, hint: 'Общая форма' })),
	];
}

function ownerOptions(internalName: string, catalogNames: readonly string[]): MetadataEditOption[] {
	return catalogNames
		.filter((name) => name !== internalName)
		.map((name) => ({ value: `Catalog.${name}`, label: name }));
}

function inputByStringOptions(internalName: string, attributeNames: readonly string[]): MetadataEditOption[] {
	const base = `Catalog.${internalName}`;
	return [
		{ value: `${base}.StandardAttribute.Description`, label: 'Наименование' },
		{ value: `${base}.StandardAttribute.Code`, label: 'Код' },
		...attributeNames.map((name) => ({ value: `${base}.Attribute.${name}`, label: name })),
	];
}

/**
 * Подписи стандартных реквизитов платформы. Состав берётся из файла объекта, здесь только перевод:
 * имени без перевода показываем как есть.
 */
const STANDARD_ATTRIBUTE_LABELS: Readonly<Record<string, string>> = {
	Ref: 'Ссылка',
	Code: 'Код',
	Description: 'Наименование',
	Owner: 'Владелец',
	Parent: 'Родитель',
	IsFolder: 'Это группа',
	DeletionMark: 'Пометка удаления',
	Predefined: 'Предопределённый',
	Number: 'Номер',
	Date: 'Дата',
	Posted: 'Проведён',
	BusinessProcess: 'Бизнес-процесс',
	RoutePoint: 'Точка маршрута',
	Executed: 'Выполнена',
	HeadTask: 'Главная задача',
	Started: 'Стартован',
	Completed: 'Завершён',
	Period: 'Период',
	Recorder: 'Регистратор',
	LineNumber: 'Номер строки',
	Active: 'Активность',
};

/**
 * Кандидаты в поля блокировки данных: стандартные реквизиты из файла объекта и его реквизиты.
 */
/** Вид объекта из ссылки `Catalog.Имя`: имя вида нужно для путей стандартных реквизитов. */
function prefixOf(base: string): string {
	return base.slice(0, base.indexOf('.'));
}

function lockFieldOptions(
	prefix: string,
	internalName: string,
	standardAttributeNames: readonly string[] = [],
	attributeNames: readonly string[] = []
): MetadataEditOption[] {
	const base = `${prefix}.${internalName}`;
	return [
		...standardAttributeNames.map((name) => ({
			value: `${base}.StandardAttribute.${name}`,
			label: STANDARD_ATTRIBUTE_LABELS[name] ?? name,
			hint: 'Стандартный реквизит',
		})),
		...attributeNames.map((name) => ({ value: `${base}.Attribute.${name}`, label: name })),
	];
}

function dataLockFieldsOptions(input: CatalogEditSpecInput): MetadataEditOption[] {
	const standard =
		input.standardAttributeNames ??
		['Code', 'Description', ...(input.hasOwners ? ['Owner'] : []), ...(input.hierarchical ? ['Parent'] : [])];
	return lockFieldOptions('Catalog', input.internalName, standard, input.attributeNames);
}

/**
 * Кандидаты в основания ввода. Список объектов, на основании которых платформа разрешает вводить,
 * шире справочников и документов, поэтому его собирает панель и передаёт готовым.
 */
function basedOnOptions(input: {
	basedOnOptions?: readonly MetadataEditOption[];
	catalogNames?: readonly string[];
	documentNames?: readonly string[];
}): MetadataEditOption[] {
	if (input.basedOnOptions) {
		return [...input.basedOnOptions];
	}
	return [
		...(input.catalogNames ?? []).map((name) => ({ value: `Catalog.${name}`, label: name, hint: 'Справочник' })),
		...(input.documentNames ?? []).map((name) => ({ value: `Document.${name}`, label: name, hint: 'Документ' })),
	];
}

const HIERARCHICAL_ON: readonly MetadataEditCondition[] = [{ path: 'catalog.hierarchical', equals: true }];

/**
 * Вкладки редактирования справочника: раскладка повторяет редактор EDT
 * (Основные, Данные, Владельцы, Формы, Команды).
 */
export function buildCatalogEditTabs(input: CatalogEditSpecInput): MetadataEditTabSpec[] {
	const forms = objectFormOptions('Catalog', input.internalName, input.formNames, input.commonFormNames);
	const owners = ownerOptions(input.internalName, input.catalogNames ?? []);
	const inputByString = inputByStringOptions(input.internalName, input.attributeNames ?? []);
	const dataLockFields = dataLockFieldsOptions(input);
	const basedOn = basedOnOptions(input);
	return withReferenceCommon(
		[
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
						{ path: 'object', label: 'Модуль объекта', control: 'moduleLink' },
						{ path: 'manager', label: 'Модуль менеджера', control: 'moduleLink' },
					],
				},
				{
					title: 'Представление',
					fields: [
						{ path: 'catalog.objectPresentationRu', label: 'Представление объекта', control: 'text' },
						{
							path: 'catalog.extendedObjectPresentationRu',
							label: 'Расширенное представление объекта',
							control: 'text',
						},
						{ path: 'catalog.listPresentationRu', label: 'Представление списка', control: 'text' },
						{
							path: 'catalog.extendedListPresentationRu',
							label: 'Расширенное представление списка',
							control: 'text',
						},
						{ path: 'catalog.explanationRu', label: 'Пояснение', control: 'textarea' },
					],
				},
				{
					title: 'Иерархия',
					fields: [
						{ path: 'catalog.hierarchical', label: 'Иерархический', control: 'check' },
						{
							path: 'catalog.hierarchyType',
							label: 'Вид иерархии',
							control: 'select',
							options: opts(
								['HIERARCHY_FOLDERS_AND_ITEMS', 'Иерархия групп и элементов'],
								['HIERARCHY_OF_ITEMS', 'Иерархия элементов']
							),
							enabledWhen: HIERARCHICAL_ON,
						},
						{
							path: 'catalog.foldersOnTop',
							label: 'Размещать группы сверху',
							control: 'check',
							enabledWhen: HIERARCHICAL_ON,
						},
						{
							path: 'catalog.limitLevelCount',
							label: 'Ограничивать количество уровней',
							control: 'check',
							enabledWhen: HIERARCHICAL_ON,
						},
						{
							path: 'catalog.levelCount',
							label: 'Количество уровней',
							control: 'number',
							enabledWhen: [...HIERARCHICAL_ON, { path: 'catalog.limitLevelCount', equals: true }],
						},
					],
				},
				{
					title: 'Нумерация',
					fields: [
						{ path: 'catalog.autonumbering', label: 'Автонумерация', control: 'check' },
						{ path: 'catalog.checkUnique', label: 'Контроль уникальности', control: 'check' },
						{
							path: 'catalog.codeSeries',
							label: 'Серии кодов',
							control: 'select',
							options: opts(
								['WHOLE_CATALOG', 'Во всем справочнике'],
								['WITHIN_SUBORDINATION', 'В пределах подчинения'],
								['WITHIN_OWNER_SUBORDINATION', 'В пределах подчинения владельцу']
							),
						},
					],
				},
				{
					title: 'Поле ввода',
					fields: [
						{ path: 'catalog.quickChoice', label: 'Быстрый выбор', control: 'check' },
						{
							path: 'catalog.choiceMode',
							label: 'Способ выбора',
							control: 'select',
							options: opts(
								['FROM_FORM', 'Из формы'],
								['QUICK_CHOICE', 'Быстрый выбор'],
								['BOTH_WAYS', 'Обоими способами']
							),
						},
						{
							path: 'catalog.createOnInput',
							label: 'Создание при вводе',
							control: 'select',
							options: opts(['AUTO', 'Авто'], ['USE', 'Использовать'], ['DONT_USE', 'Не использовать']),
						},
						{ path: 'catalog.inputByString', label: 'Ввод по строке', control: 'refList', options: inputByString },
						{
							path: 'catalog.searchStringModeOnInputByString',
							label: 'Способ поиска строки при вводе',
							control: 'select',
							options: opts(['BEGIN', 'Начало'], ['ANY_PART', 'Любая часть']),
						},
						{
							path: 'catalog.fullTextSearchOnInputByString',
							label: 'Полнотекстовый поиск при вводе',
							control: 'select',
							options: USE_DONT_USE,
						},
						{
							path: 'catalog.choiceDataGetModeOnInputByString',
							label: 'Режим получения данных выбора',
							control: 'select',
							options: opts(['DIRECTLY', 'Непосредственно'], ['BACKGROUND', 'Фоновым заданием']),
						},
						{
							path: 'catalog.choiceHistoryOnInput',
							label: 'История выбора при вводе',
							control: 'select',
							options: opts(['AUTO', 'Авто'], ['DONT_USE', 'Не использовать']),
						},
					],
				},
				{
					title: 'Прочее',
					fields: [
						{
							path: 'catalog.predefinedDataUpdate',
							label: 'Обновление предопределенных данных',
							control: 'select',
							options: opts(
								['AUTO', 'Авто'],
								['AUTO_UPDATE', 'Обновлять автоматически'],
								['DONT_AUTO_UPDATE', 'Не обновлять автоматически']
							),
						},
						{ path: 'catalog.dataLockFields', label: 'Поля блокировки данных', control: 'refList', options: dataLockFields },
						{
							path: 'catalog.dataLockControlMode',
							label: 'Режим управления блокировкой данных',
							control: 'select',
							options: opts(
								['AUTOMATIC', 'Автоматический'],
								['MANAGED', 'Управляемый'],
								['AUTOMATIC_AND_MANAGED', 'Автоматический и управляемый']
							),
						},
						{
							path: 'catalog.fullTextSearch',
							label: 'Полнотекстовый поиск',
							control: 'select',
							options: USE_DONT_USE,
						},
						{
							path: 'catalog.dataHistory',
							label: 'История данных',
							control: 'select',
							options: USE_DONT_USE,
						},
						{
							path: 'catalog.updateDataHistoryImmediatelyAfterWrite',
							label: 'Обновлять историю данных сразу после записи',
							control: 'check',
							enabledWhen: [{ path: 'catalog.dataHistory', equals: 'USE' }],
						},
						{
							path: 'catalog.executeAfterWriteDataHistoryVersionProcessing',
							label: 'Выполнять обработку версий истории данных после записи',
							control: 'check',
							enabledWhen: [{ path: 'catalog.dataHistory', equals: 'USE' }],
						},
						{ path: 'catalog.includeHelpInContents', label: 'Включать в содержание справки', control: 'check' },
					],
				},
			],
		},
		{
			id: 'edit_data',
			title: 'Данные',
			groups: [
				{
					title: 'Код и наименование',
					fields: [
						{
							path: 'catalog.editType',
							label: 'Способ редактирования',
							control: 'select',
							options: opts(['IN_DIALOG', 'В диалоге'], ['IN_LIST', 'В списке'], ['BOTH_WAYS', 'Обоими способами']),
						},
						{ path: 'catalog.codeLength', label: 'Длина кода', control: 'number' },
						{ path: 'catalog.descriptionLength', label: 'Длина наименования', control: 'number' },
						{
							path: 'catalog.codeType',
							label: 'Тип кода',
							control: 'select',
							options: opts(['STRING', 'Строка'], ['NUMBER', 'Число']),
						},
						{
							path: 'catalog.codeAllowedLength',
							label: 'Допустимая длина кода',
							control: 'select',
							options: opts(['VARIABLE', 'Переменная'], ['FIXED', 'Фиксированная']),
						},
						{
							path: 'catalog.defaultPresentation',
							label: 'Основное представление',
							control: 'select',
							options: opts(['AS_DESCRIPTION', 'В виде наименования'], ['AS_CODE', 'В виде кода']),
						},
					],
				},
			],
		},
		{
			id: 'edit_owners',
			title: 'Владельцы',
			groups: [
				{
					title: 'Владельцы',
					fields: [
						{ path: 'catalog.owners', label: 'Владельцы', control: 'refList', options: owners },
						{
							path: 'catalog.subordinationUse',
							label: 'Использование подчинения',
							control: 'select',
							options: opts(
								['TO_ITEMS', 'Элементам'],
								['TO_FOLDERS', 'Группам'],
								['TO_FOLDERS_AND_ITEMS', 'Группам и элементам']
							),
						},
					],
				},
			],
		},
		{
			id: 'edit_forms',
			title: 'Формы',
			groups: [
				{
					title: 'Основные формы',
					fields: [
						{
							path: 'catalog.defaultObjectForm',
							label: 'Основная форма объекта',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'catalog.defaultFolderForm',
							label: 'Основная форма группы',
							control: 'select',
							options: forms,
							clearable: true,
							enabledWhen: [
								...HIERARCHICAL_ON,
								{ path: 'catalog.hierarchyType', equals: 'HIERARCHY_FOLDERS_AND_ITEMS' },
							],
						},
						{
							path: 'catalog.defaultListForm',
							label: 'Основная форма списка',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'catalog.defaultChoiceForm',
							label: 'Основная форма выбора',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'catalog.defaultFolderChoiceForm',
							label: 'Основная форма выбора группы',
							control: 'select',
							options: forms,
							clearable: true,
							enabledWhen: [
								...HIERARCHICAL_ON,
								{ path: 'catalog.hierarchyType', equals: 'HIERARCHY_FOLDERS_AND_ITEMS' },
							],
						},
					],
				},
				{
					title: 'Формы',
					fields: [{ path: '', label: 'Формы объекта', control: 'staticList', items: input.formNames }],
				},
			],
		},
		{
			id: 'edit_commands',
			title: 'Команды',
			groups: [
				{
					title: 'Команды',
					fields: [
						{ path: 'catalog.useStandardCommands', label: 'Использовать стандартные команды', control: 'check' },
					],
				},
			],
		},
		{
			id: 'edit_basedon',
			title: 'Ввод на основании',
			groups: [
				{
					title: 'Ввод на основании',
					fields: [{ path: 'catalog.basedOn', label: 'Вводится на основании', control: 'refList', options: basedOn }],
				},
			],
		},
		],
		{
			block: 'catalog',
			forms,
			auxiliaryForms: ['object', 'folder', 'list', 'choice', 'folderChoice'],
			inputField: true,
			dataHistory: true,
		}
	);
}

export interface DocumentEditSpecInput {
	/** Стандартные реквизиты объекта из файла: кандидаты в поля блокировки данных. */
	standardAttributeNames?: readonly string[];
	/** Готовые кандидаты в основания ввода: их состав определяет панель. */
	basedOnOptions?: readonly MetadataEditOption[];
	internalName: string;
	formNames: readonly string[];
	commandNames: readonly string[];
	/** Имена общих форм конфигурации - кандидаты в основные формы объекта. */
	commonFormNames?: readonly string[];
	/** Имена справочников — кандидаты в основания. */
	catalogNames?: readonly string[];
	/** Имена документов — кандидаты в основания. */
	documentNames?: readonly string[];
	/** Имена реквизитов объекта — кандидаты для ввода по строке и полей блокировки. */
	attributeNames?: readonly string[];
	/** Имена нумераторов. */
	numeratorNames?: readonly string[];
	/** Кандидаты состава движений: полные ссылки на регистры с подписями. */
	registerOptions?: readonly MetadataEditOption[];
}

function documentInputByStringOptions(internalName: string, attributeNames: readonly string[]): MetadataEditOption[] {
	const base = `Document.${internalName}`;
	return [
		{ value: `${base}.StandardAttribute.Number`, label: 'Номер' },
		...attributeNames.map((name) => ({ value: `${base}.Attribute.${name}`, label: name })),
	];
}

function documentDataLockFieldsOptions(input: DocumentEditSpecInput): MetadataEditOption[] {
	return lockFieldOptions(
		'Document',
		input.internalName,
		input.standardAttributeNames ?? ['Number', 'Date'],
		input.attributeNames
	);
}

/**
 * Вкладки редактирования документа: раскладка повторяет редактор EDT
 * (Основные, Данные, Движения, Формы, Команды, Ввод на основании).
 */
export function buildDocumentEditTabs(input: DocumentEditSpecInput): MetadataEditTabSpec[] {
	const forms = objectFormOptions('Document', input.internalName, input.formNames, input.commonFormNames);
	const inputByString = documentInputByStringOptions(input.internalName, input.attributeNames ?? []);
	const dataLockFields = documentDataLockFieldsOptions(input);
	const basedOn = basedOnOptions(input);
	const numerators: MetadataEditOption[] = [
		{ value: '', label: '(не задан)' },
		...(input.numeratorNames ?? []).map((name) => ({ value: `DocumentNumerator.${name}`, label: name })),
	];
	return withReferenceCommon(
		[
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
						{ path: 'object', label: 'Модуль объекта', control: 'moduleLink' },
						{ path: 'manager', label: 'Модуль менеджера', control: 'moduleLink' },
					],
				},
				{
					title: 'Представление',
					fields: [
						{ path: 'document.objectPresentationRu', label: 'Представление объекта', control: 'text' },
						{
							path: 'document.extendedObjectPresentationRu',
							label: 'Расширенное представление объекта',
							control: 'text',
						},
						{ path: 'document.listPresentationRu', label: 'Представление списка', control: 'text' },
						{
							path: 'document.extendedListPresentationRu',
							label: 'Расширенное представление списка',
							control: 'text',
						},
						{ path: 'document.explanationRu', label: 'Пояснение', control: 'textarea' },
					],
				},
				{
					title: 'Нумерация',
					fields: [
						{
							path: 'document.numberType',
							label: 'Тип номера',
							control: 'select',
							options: opts(['STRING', 'Строка'], ['NUMBER', 'Число']),
						},
						{ path: 'document.numberLength', label: 'Длина номера', control: 'number' },
						{
							path: 'document.numberAllowedLength',
							label: 'Допустимая длина номера',
							control: 'select',
							options: opts(['VARIABLE', 'Переменная'], ['FIXED', 'Фиксированная']),
						},
						{ path: 'document.autonumbering', label: 'Автонумерация', control: 'check' },
						{ path: 'document.checkUnique', label: 'Контроль уникальности', control: 'check' },
						{
							path: 'document.numberPeriodicity',
							label: 'Периодичность',
							control: 'select',
							options: opts(
								['NONPERIODICAL', 'Непериодический'],
								['YEAR', 'В пределах года'],
								['QUARTER', 'В пределах квартала'],
								['MONTH', 'В пределах месяца'],
								['DAY', 'В пределах дня']
							),
						},
						{ path: 'document.numerator', label: 'Нумератор', control: 'select', options: numerators, clearable: true },
					],
				},
				{
					title: 'Поле ввода',
					fields: [
						{
							path: 'document.createOnInput',
							label: 'Создание при вводе',
							control: 'select',
							options: opts(['AUTO', 'Авто'], ['USE', 'Использовать'], ['DONT_USE', 'Не использовать']),
						},
						{ path: 'document.inputByString', label: 'Ввод по строке', control: 'refList', options: inputByString },
						{
							path: 'document.searchStringModeOnInputByString',
							label: 'Способ поиска строки при вводе',
							control: 'select',
							options: opts(['BEGIN', 'Начало'], ['ANY_PART', 'Любая часть']),
						},
						{
							path: 'document.fullTextSearchOnInputByString',
							label: 'Полнотекстовый поиск при вводе',
							control: 'select',
							options: USE_DONT_USE,
						},
						{
							path: 'document.choiceDataGetModeOnInputByString',
							label: 'Режим получения данных выбора',
							control: 'select',
							options: opts(['DIRECTLY', 'Непосредственно'], ['BACKGROUND', 'Фоновым заданием']),
						},
						{
							path: 'document.choiceHistoryOnInput',
							label: 'История выбора при вводе',
							control: 'select',
							options: opts(['AUTO', 'Авто'], ['DONT_USE', 'Не использовать']),
						},
					],
				},
				{
					title: 'Прочее',
					fields: [
						{
							path: 'document.dataLockFields',
							label: 'Поля блокировки данных',
							control: 'refList',
							options: dataLockFields,
						},
						{
							path: 'document.dataLockControlMode',
							label: 'Режим управления блокировкой данных',
							control: 'select',
							options: opts(
								['AUTOMATIC', 'Автоматический'],
								['MANAGED', 'Управляемый'],
								['AUTOMATIC_AND_MANAGED', 'Автоматический и управляемый']
							),
						},
						{
							path: 'document.fullTextSearch',
							label: 'Полнотекстовый поиск',
							control: 'select',
							options: USE_DONT_USE,
						},
						{
							path: 'document.dataHistory',
							label: 'История данных',
							control: 'select',
							options: USE_DONT_USE,
						},
						{
							path: 'document.updateDataHistoryImmediatelyAfterWrite',
							label: 'Обновлять историю данных сразу после записи',
							control: 'check',
							enabledWhen: [{ path: 'document.dataHistory', equals: 'USE' }],
						},
						{
							path: 'document.executeAfterWriteDataHistoryVersionProcessing',
							label: 'Выполнять обработку версий истории данных после записи',
							control: 'check',
							enabledWhen: [{ path: 'document.dataHistory', equals: 'USE' }],
						},
						{ path: 'document.includeHelpInContents', label: 'Включать в содержание справки', control: 'check' },
					],
				},
			],
		},
		{
			id: 'edit_data',
			title: 'Данные',
			groups: [],
		},
		{
			id: 'edit_movements',
			title: 'Движения',
			groups: [
				{
					title: 'Проведение',
					fields: [
						{
							path: 'document.posting',
							label: 'Проведение',
							control: 'select',
							options: opts(['ALLOW', 'Разрешить'], ['DENY', 'Запретить']),
						},
						{
							path: 'document.realTimePosting',
							label: 'Оперативное проведение',
							control: 'select',
							options: opts(['ALLOW', 'Разрешить'], ['DENY', 'Запретить']),
						},
						{
							path: 'document.registerRecordsDeletion',
							label: 'Удаление движений',
							control: 'select',
							options: opts(
								['AUTO_DELETE_ON_UNPOST', 'Удалять автоматически при отмене проведения'],
								['AUTO_DELETE', 'Удалять автоматически'],
								['AUTO_DELETE_OFF', 'Не удалять автоматически']
							),
						},
						{
							path: 'document.registerRecordsWritingOnPost',
							label: 'Запись движений при проведении',
							control: 'select',
							options: opts(
								['WRITE_SELECTED', 'Записывать выбранные'],
								['WRITE_MODIFIED', 'Записывать модифицированные']
							),
						},
						{
							path: 'document.sequenceFilling',
							label: 'Заполнение последовательностей',
							control: 'select',
							options: opts(['AUTO_FILL', 'Заполнять автоматически'], ['AUTO_FILL_OFF', 'Не заполнять автоматически']),
						},
						{ path: 'document.postInPrivilegedMode', label: 'Проведение в привилегированном режиме', control: 'check' },
						{
							path: 'document.unpostInPrivilegedMode',
							label: 'Отмена проведения в привилегированном режиме',
							control: 'check',
						},
					],
				},
				{
					title: 'Движения',
					fields: [
						{
							path: 'document.registerRecords',
							label: 'Регистры',
							control: 'refList',
							options: input.registerOptions ?? [],
						},
					],
				},
			],
		},
		{
			id: 'edit_forms',
			title: 'Формы',
			groups: [
				{
					title: 'Основные формы',
					fields: [
						{
							path: 'document.defaultObjectForm',
							label: 'Основная форма объекта',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'document.defaultListForm',
							label: 'Основная форма списка',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'document.defaultChoiceForm',
							label: 'Основная форма выбора',
							control: 'select',
							options: forms,
							clearable: true,
						},
					],
				},
				{
					title: 'Формы',
					fields: [{ path: '', label: 'Формы объекта', control: 'staticList', items: input.formNames }],
				},
			],
		},
		{
			id: 'edit_commands',
			title: 'Команды',
			groups: [
				{
					title: 'Команды',
					fields: [
						{ path: 'document.useStandardCommands', label: 'Использовать стандартные команды', control: 'check' },
					],
				},
			],
		},
		{
			id: 'edit_basedon',
			title: 'Ввод на основании',
			groups: [
				{
					title: 'Ввод на основании',
					fields: [{ path: 'document.basedOn', label: 'Вводится на основании', control: 'refList', options: basedOn }],
				},
			],
		},
		],
		{
			block: 'document',
			forms,
			auxiliaryForms: ['object', 'list', 'choice'],
			inputField: true,
			dataHistory: true,
		}
	);
}

export interface SimpleObjectEditSpecInput {
	internalName: string;
	formNames: readonly string[];
	commandNames: readonly string[];
	/** Стандартные реквизиты объекта из файла: кандидаты в поля блокировки данных. */
	standardAttributeNames?: readonly string[];
	/** Готовые кандидаты в основания ввода: их состав определяет панель. */
	basedOnOptions?: readonly MetadataEditOption[];
	/** Имена общих форм конфигурации - кандидаты в основные формы объекта. */
	commonFormNames?: readonly string[];
}

const CHOICE_HISTORY = opts(['AUTO', 'Авто'], ['DONT_USE', 'Не использовать']);

/**
 * Вкладки редактирования перечисления: раскладка повторяет редактор EDT.
 * Значения перечисления правятся отдельно.
 */
export function buildEnumEditTabs(input: SimpleObjectEditSpecInput): MetadataEditTabSpec[] {
	const forms = objectFormOptions('Enum', input.internalName, input.formNames, input.commonFormNames);
	return withReferenceCommon(
		[
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
						{ path: 'manager', label: 'Модуль менеджера', control: 'moduleLink' },
					],
				},
				{
					title: 'Представление',
					fields: [
						{ path: 'enumeration.listPresentationRu', label: 'Представление списка', control: 'text' },
						{
							path: 'enumeration.extendedListPresentationRu',
							label: 'Расширенное представление списка',
							control: 'text',
						},
						{ path: 'enumeration.explanationRu', label: 'Пояснение', control: 'textarea' },
					],
				},
				{
					title: 'Поле ввода',
					fields: [
						{ path: 'enumeration.quickChoice', label: 'Быстрый выбор', control: 'check' },
						{
							path: 'enumeration.choiceMode',
							label: 'Способ выбора',
							control: 'select',
							options: opts(
								['BOTH_WAYS', 'Обоими способами'],
								['FROM_FORM', 'Из формы'],
								['QUICK_CHOICE', 'Быстрый выбор']
							),
						},
						{
							path: 'enumeration.choiceHistoryOnInput',
							label: 'История выбора при вводе',
							control: 'select',
							options: CHOICE_HISTORY,
						},
					],
				},
			],
		},
		{
			id: 'edit_data',
			title: 'Данные',
			groups: [],
		},
		{
			id: 'edit_forms',
			title: 'Формы',
			groups: [
				{
					title: 'Основные формы',
					fields: [
						{
							path: 'enumeration.defaultListForm',
							label: 'Основная форма списка',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'enumeration.defaultChoiceForm',
							label: 'Основная форма выбора',
							control: 'select',
							options: forms,
							clearable: true,
						},
					],
				},
				{
					title: 'Формы',
					fields: [{ path: '', label: 'Формы объекта', control: 'staticList', items: input.formNames }],
				},
			],
		},
		{
			id: 'edit_commands',
			title: 'Команды',
			groups: [
				{
					title: 'Команды',
					fields: [
						{ path: 'enumeration.useStandardCommands', label: 'Использовать стандартные команды', control: 'check' },
					],
				},
			],
		},
		],
		{ block: 'enumeration', forms, auxiliaryForms: ['list', 'choice'] }
	);
}

/**
 * Вкладки редактирования константы: раскладка повторяет редактор EDT.
 * Тип значения правится палитрой типов.
 */
export function buildConstantEditTabs(input: SimpleObjectEditSpecInput): MetadataEditTabSpec[] {
	const forms = objectFormOptions('Constant', input.internalName, input.formNames, input.commonFormNames);
	return [
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
						{ path: 'constant.type', label: 'Тип', control: 'type' },
						{ path: 'valueManager', label: 'Модуль менеджера значения', control: 'moduleLink' },
						{ path: 'manager', label: 'Модуль менеджера', control: 'moduleLink' },
					],
				},
				{
					title: 'Представление',
					fields: [
						{ path: 'constant.extendedPresentationRu', label: 'Расширенное представление', control: 'text' },
						{ path: 'constant.toolTipRu', label: 'Подсказка', control: 'text' },
						{ path: 'constant.explanationRu', label: 'Пояснение', control: 'textarea' },
					],
				},
				{
					title: 'Представление значения',
					fields: [
						{ path: 'constant.formatRu', label: 'Формат', control: 'text' },
						{ path: 'constant.editFormatRu', label: 'Формат редактирования', control: 'text' },
						{ path: 'constant.mask', label: 'Маска', control: 'text' },
						{ path: 'constant.markNegatives', label: 'Выделять отрицательные', control: 'check' },
						{ path: 'constant.passwordMode', label: 'Режим пароля', control: 'check' },
						{ path: 'constant.multiLine', label: 'Многострочный режим', control: 'check' },
						{ path: 'constant.extendedEdit', label: 'Расширенное редактирование', control: 'check' },
					],
				},
				{
					title: 'Поле ввода',
					fields: [
						{
							path: 'constant.fillChecking',
							label: 'Проверка заполнения',
							control: 'select',
							options: opts(['DONT_CHECK', 'Не проверять'], ['SHOW_ERROR', 'Выдавать ошибку']),
						},
						{
							path: 'constant.choiceFoldersAndItems',
							label: 'Выбор групп и элементов',
							control: 'select',
							options: opts(['ITEMS', 'Элементы'], ['FOLDERS', 'Группы'], ['FOLDERS_AND_ITEMS', 'Группы и элементы']),
						},
						{
							path: 'constant.quickChoice',
							label: 'Быстрый выбор',
							control: 'select',
							options: opts(['AUTO', 'Авто'], ['USE', 'Использовать'], ['DONT_USE', 'Не использовать']),
						},
						{
							path: 'constant.choiceHistoryOnInput',
							label: 'История выбора при вводе',
							control: 'select',
							options: CHOICE_HISTORY,
						},
					],
				},
				{
					title: 'Прочее',
					fields: [
						{
							path: 'constant.dataLockControlMode',
							label: 'Режим управления блокировкой данных',
							control: 'select',
							options: opts(
								['AUTOMATIC', 'Автоматический'],
								['MANAGED', 'Управляемый'],
								['AUTOMATIC_AND_MANAGED', 'Автоматический и управляемый']
							),
						},
						{ path: 'constant.dataHistory', label: 'История данных', control: 'select', options: USE_DONT_USE },
						{
							path: 'constant.updateDataHistoryImmediatelyAfterWrite',
							label: 'Обновлять историю данных сразу после записи',
							control: 'check',
							enabledWhen: [{ path: 'constant.dataHistory', equals: 'USE' }],
						},
						{
							path: 'constant.executeAfterWriteDataHistoryVersionProcessing',
							label: 'Выполнять обработку версий истории данных после записи',
							control: 'check',
							enabledWhen: [{ path: 'constant.dataHistory', equals: 'USE' }],
						},
					],
				},
			],
		},
		{
			id: 'edit_forms',
			title: 'Формы',
			groups: [
				{
					title: 'Основные формы',
					fields: [
						{
							path: 'constant.defaultForm',
							label: 'Основная форма',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'constant.choiceForm',
							label: 'Форма выбора',
							control: 'select',
							options: forms,
							clearable: true,
						},
					],
				},
				{
					title: 'Формы',
					fields: [{ path: '', label: 'Формы объекта', control: 'staticList', items: input.formNames }],
				},
			],
		},
		{
			id: 'edit_commands',
			title: 'Команды',
			groups: [
				{
					title: 'Команды',
					fields: [
						{ path: 'constant.useStandardCommands', label: 'Использовать стандартные команды', control: 'check' },
					],
				},
			],
		},
	];
}

/** Вход спецификации отчёта и обработки: формы объекта и макеты для схемы компоновки. */
export interface ReportEditSpecInput extends SimpleObjectEditSpecInput {
	/** Вид объекта: у обработки нет схемы компоновки, вариантов и хранилищ. */
	report: boolean;
	/** Имена макетов объекта - кандидаты в основную схему компоновки данных. */
	templateNames?: readonly string[];
	/** Имена хранилищ настроек конфигурации - кандидаты в хранилища вариантов и настроек. */
	settingsStorageNames?: readonly string[];
}

function reportTemplateOptions(
	internalName: string,
	templateNames: readonly string[]
): MetadataEditOption[] {
	return [
		{ value: '', label: '(не задана)' },
		...templateNames.map((name) => ({ value: `Report.${internalName}.Template.${name}`, label: name })),
	];
}

function settingsStorageOptions(names: readonly string[]): MetadataEditOption[] {
	return [
		{ value: '', label: '(не задано)' },
		...names.map((name) => ({ value: `SettingsStorage.${name}`, label: name })),
	];
}

/**
 * Вкладки редактирования отчёта и обработки: раскладка повторяет редактор EDT.
 * Наборы свойств совпадают, поэтому спецификация одна: у обработки нет группы
 * схемы компоновки и хранилищ, а формы вариантов и настроек только у отчёта.
 */
export function buildReportEditTabs(input: ReportEditSpecInput): MetadataEditTabSpec[] {
	const prefix = input.report ? 'Report' : 'DataProcessor';
	const forms = objectFormOptions(prefix, input.internalName, input.formNames, input.commonFormNames);
	const mainGroupFields: MetadataEditField[] = [
		{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
		{ path: 'synonymRu', label: 'Синоним', control: 'text' },
		{ path: 'comment', label: 'Комментарий', control: 'text' },
	];
	// схема компоновки и хранилища - суть отчёта, у обработки их нет
	const compositionFields: MetadataEditField[] = input.report
		? [
				{
					path: 'report.mainDataCompositionSchema',
					label: 'Основная схема компоновки данных',
					control: 'select',
					options: reportTemplateOptions(input.internalName, input.templateNames ?? []),
					clearable: true,
				},
				{
					path: 'report.variantsStorage',
					label: 'Хранилище вариантов',
					control: 'select',
					options: settingsStorageOptions(input.settingsStorageNames ?? []),
					clearable: true,
				},
				{
					path: 'report.settingsStorage',
					label: 'Хранилище настроек',
					control: 'select',
					options: settingsStorageOptions(input.settingsStorageNames ?? []),
					clearable: true,
				},
			]
		: [];

	const otherFields: MetadataEditField[] = [
		{ path: 'report.includeHelpInContents', label: 'Включать в содержание справки', control: 'check' },
	];

	const formFields: MetadataEditField[] = [
		{ path: 'report.defaultForm', label: 'Основная форма', control: 'select', options: forms, clearable: true },
		{
			path: 'report.auxiliaryForm',
			label: 'Вспомогательная форма',
			control: 'select',
			options: forms,
			clearable: true,
		},
	];
	if (input.report) {
		formFields.push(
			{
				path: 'report.defaultSettingsForm',
				label: 'Основная форма настроек',
				control: 'select',
				options: forms,
				clearable: true,
			},
			{
				path: 'report.auxiliarySettingsForm',
				label: 'Вспомогательная форма настроек',
				control: 'select',
				options: forms,
				clearable: true,
			},
			{
				path: 'report.defaultVariantForm',
				label: 'Основная форма варианта',
				control: 'select',
				options: forms,
				clearable: true,
			},
			{
				path: 'report.auxiliaryVariantForm',
				label: 'Вспомогательная форма варианта',
				control: 'select',
				options: forms,
				clearable: true,
			}
		);
	}

	return [
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{ title: 'Основные', fields: mainGroupFields },
				{
					title: 'Представление',
					fields: [
						{ path: 'report.extendedPresentationRu', label: 'Расширенное представление', control: 'text' },
						{ path: 'report.explanationRu', label: 'Пояснение', control: 'textarea' },
					],
				},
				{ title: 'Компоновка', fields: compositionFields },
				{ title: 'Прочее', fields: otherFields },
			],
		},
		{
			id: 'edit_forms',
			title: 'Формы',
			groups: [
				{ title: 'Основные формы', fields: formFields },
				{
					title: 'Формы',
					fields: [{ path: '', label: 'Формы объекта', control: 'staticList', items: input.formNames }],
				},
			],
		},
		{
			id: 'edit_commands',
			title: 'Команды',
			groups: [
				{
					title: 'Команды',
					fields: [
						{ path: 'report.useStandardCommands', label: 'Использовать стандартные команды', control: 'check' },
					],
				},
			],
		},
		{
			id: 'edit_modules',
			title: 'Модули',
			groups: [
				{
					title: 'Модули',
					fields: [
						{ path: 'object', label: 'Модуль объекта', control: 'moduleLink' },
						{ path: 'manager', label: 'Модуль менеджера', control: 'moduleLink' },
					],
				},
			],
		},
	];
}

/** Вход спецификации плана видов расчёта: формы, реквизиты и планы видов расчёта конфигурации. */
export interface ChartOfCalculationTypesEditSpecInput extends SimpleObjectEditSpecInput {
	/** Имена справочников конфигурации - кандидаты в основания ввода. */
	catalogNames?: readonly string[];
	/** Имена документов конфигурации - кандидаты в основания ввода. */
	documentNames?: readonly string[];
	/** Имена реквизитов объекта - кандидаты для ввода по строке и полей блокировки. */
	attributeNames?: readonly string[];
	/** Имена планов видов расчёта - кандидаты в базовые виды расчёта. */
	calculationTypeNames?: readonly string[];
}

/**
 * Вкладки редактирования плана видов расчёта: раскладка повторяет редактор EDT.
 * Базовые виды расчёта доступны, только когда задана зависимость от видов расчёта.
 */
export function buildChartOfCalculationTypesEditTabs(
	input: ChartOfCalculationTypesEditSpecInput
): MetadataEditTabSpec[] {
	const base = `ChartOfCalculationTypes.${input.internalName}`;
	const basedOn = basedOnOptions(input);
	const dataLockFields = lockFieldOptions(
		'ChartOfCalculationTypes',
		input.internalName,
		input.standardAttributeNames ?? ['Code', 'Description'],
		input.attributeNames
	);
	const forms = objectFormOptions('ChartOfCalculationTypes', input.internalName, input.formNames, input.commonFormNames);
	const inputByString: MetadataEditOption[] = [
		{ value: `${base}.StandardAttribute.Description`, label: 'Наименование' },
		{ value: `${base}.StandardAttribute.Code`, label: 'Код' },
		...(input.attributeNames ?? []).map((name) => ({
			value: `${base}.Attribute.${name}`,
			label: name,
		})),
	];
	// План видов расчёта бывает базовым сам себе: так сделаны основные начисления в типовых.
	const baseCalculationTypes: MetadataEditOption[] = (input.calculationTypeNames ?? []).map((name) => ({
		value: `ChartOfCalculationTypes.${name}`,
		label: name,
	}));

	return withReferenceCommon(
		[
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
						{ path: 'object', label: 'Модуль объекта', control: 'moduleLink' },
						{ path: 'manager', label: 'Модуль менеджера', control: 'moduleLink' },
					],
				},
				{
					title: 'Расчёт',
					fields: [
						{
							path: 'chartOfCalculationTypes.dependenceOnCalculationTypes',
							label: 'Зависимость от видов расчёта',
							control: 'select',
							options: opts(
								['DONT_USE', 'Не зависит'],
								['ON_ACTION_PERIOD', 'По периоду действия'],
								['ON_REGISTRATION_PERIOD', 'По периоду регистрации']
							),
						},
						{
							path: 'chartOfCalculationTypes.baseCalculationTypes',
							label: 'Базовые виды расчёта',
							control: 'refList',
							options: baseCalculationTypes,
						},
						{
							path: 'chartOfCalculationTypes.actionPeriodUse',
							label: 'Использует период действия',
							control: 'check',
						},
					],
				},
				{
					title: 'Представление',
					fields: [
						{
							path: 'chartOfCalculationTypes.objectPresentationRu',
							label: 'Представление объекта',
							control: 'text',
						},
						{
							path: 'chartOfCalculationTypes.extendedObjectPresentationRu',
							label: 'Расширенное представление объекта',
							control: 'text',
						},
						{
							path: 'chartOfCalculationTypes.listPresentationRu',
							label: 'Представление списка',
							control: 'text',
						},
						{
							path: 'chartOfCalculationTypes.extendedListPresentationRu',
							label: 'Расширенное представление списка',
							control: 'text',
						},
						{ path: 'chartOfCalculationTypes.explanationRu', label: 'Пояснение', control: 'textarea' },
					],
				},
				{
					title: 'Прочее',
					fields: [
						{
							path: 'chartOfCalculationTypes.predefinedDataUpdate',
							label: 'Обновление предопределённых данных',
							control: 'select',
							options: opts(
								['AUTO', 'Авто'],
								['DONT_AUTO_UPDATE', 'Не обновлять автоматически'],
								['AUTO_UPDATE', 'Обновлять автоматически']
							),
						},
						{
							path: 'chartOfCalculationTypes.dataLockControlMode',
							label: 'Режим управления блокировкой данных',
							control: 'select',
							options: opts(
								['AUTOMATIC', 'Автоматический'],
								['MANAGED', 'Управляемый'],
								['AUTOMATIC_AND_MANAGED', 'Автоматический и управляемый']
							),
						},
						{
							path: 'chartOfCalculationTypes.includeHelpInContents',
							label: 'Включать в содержание справки',
							control: 'check',
						},
						{
							path: 'chartOfCalculationTypes.additionalIndexes',
							label: 'Дополнительные индексы',
							control: 'text',
						},
					],
				},
			],
		},
		{
			id: 'edit_data',
			title: 'Данные',
			groups: [
				{
					title: 'Код и наименование',
					fields: [
						{ path: 'chartOfCalculationTypes.codeLength', label: 'Длина кода', control: 'number' },
						{
							path: 'chartOfCalculationTypes.codeType',
							label: 'Тип кода',
							control: 'select',
							options: opts(['STRING', 'Строка'], ['NUMBER', 'Число']),
						},
						{
							path: 'chartOfCalculationTypes.codeAllowedLength',
							label: 'Допустимая длина кода',
							control: 'select',
							options: opts(['VARIABLE', 'Переменная'], ['FIXED', 'Фиксированная']),
						},
						{
							path: 'chartOfCalculationTypes.descriptionLength',
							label: 'Длина наименования',
							control: 'number',
						},
						{
							path: 'chartOfCalculationTypes.editType',
							label: 'Способ редактирования',
							control: 'select',
							options: opts(
								['IN_DIALOG', 'В диалоге'],
								['IN_LIST', 'В списке'],
								['BOTH_WAYS', 'Обоими способами']
							),
						},
						{
							path: 'chartOfCalculationTypes.inputByString',
							label: 'Ввод по строке',
							control: 'refList',
							options: inputByString,
						},
						{
							path: 'chartOfCalculationTypes.choiceHistoryOnInput',
							label: 'История выбора при вводе',
							control: 'select',
							options: CHOICE_HISTORY,
						},
					],
				},
			],
		},
		{
			id: 'edit_forms',
			title: 'Формы',
			groups: [
				{
					title: 'Основные формы',
					fields: [
						{
							path: 'chartOfCalculationTypes.defaultObjectForm',
							label: 'Основная форма объекта',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'chartOfCalculationTypes.defaultListForm',
							label: 'Основная форма списка',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'chartOfCalculationTypes.defaultChoiceForm',
							label: 'Основная форма выбора',
							control: 'select',
							options: forms,
							clearable: true,
						},
					],
				},
				{
					title: 'Формы',
					fields: [{ path: '', label: 'Формы объекта', control: 'staticList', items: input.formNames }],
				},
			],
		},
		{
			id: 'edit_commands',
			title: 'Команды',
			groups: [
				{
					title: 'Команды',
					fields: [
						{
							path: 'chartOfCalculationTypes.useStandardCommands',
							label: 'Использовать стандартные команды',
							control: 'check',
						},
					],
				},
			],
		},
		],
		{
			block: 'chartOfCalculationTypes',
			forms,
			auxiliaryForms: ['object', 'list', 'choice'],
			inputField: true,
			dataHistory: true,
			lockFields: dataLockFields,
			basedOn,
		}
	);
}

/** Вход спецификации плана счетов: формы, реквизиты и планы видов характеристик. */
export interface ChartOfAccountsEditSpecInput extends SimpleObjectEditSpecInput {
	/** Имена реквизитов объекта - кандидаты для ввода по строке и полей блокировки. */
	attributeNames?: readonly string[];
	/** Имена планов видов характеристик - кандидаты в виды субконто. */
	characteristicTypeNames?: readonly string[];
	/** Имена справочников конфигурации - кандидаты в основания. */
	catalogNames?: readonly string[];
	/** Имена документов конфигурации - кандидаты в основания. */
	documentNames?: readonly string[];
}

/**
 * Вкладки редактирования плана счетов: раскладка повторяет редактор EDT.
 * Признаки учёта и признаки учёта субконто ведутся своими списками, здесь только свойства.
 */
export function buildChartOfAccountsEditTabs(input: ChartOfAccountsEditSpecInput): MetadataEditTabSpec[] {
	const base = `ChartOfAccounts.${input.internalName}`;
	const forms = objectFormOptions('ChartOfAccounts', input.internalName, input.formNames, input.commonFormNames);
	const attributeOptions = (input.attributeNames ?? []).map((name) => ({
		value: `${base}.Attribute.${name}`,
		label: name,
	}));
	const inputByString: MetadataEditOption[] = [
		{ value: `${base}.StandardAttribute.Description`, label: 'Наименование' },
		{ value: `${base}.StandardAttribute.Code`, label: 'Код' },
		...attributeOptions,
	];
	const dataLockFields = lockFieldOptions(
		prefixOf(base),
		input.internalName,
		input.standardAttributeNames ?? ['Code', 'Description'],
		input.attributeNames
	);
	const basedOn = basedOnOptions(input);
	const extDimensionTypes: MetadataEditOption[] = [
		{ value: '', label: '(не заданы)' },
		...(input.characteristicTypeNames ?? []).map((name) => ({
			value: `ChartOfCharacteristicTypes.${name}`,
			label: name,
		})),
	];

	return withReferenceCommon(
		[
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
						{ path: 'object', label: 'Модуль объекта', control: 'moduleLink' },
						{ path: 'manager', label: 'Модуль менеджера', control: 'moduleLink' },
					],
				},
				{
					title: 'Субконто',
					fields: [
						{
							path: 'chartOfAccounts.extDimensionTypes',
							label: 'Виды субконто',
							control: 'select',
							options: extDimensionTypes,
							clearable: true,
						},
						{
							path: 'chartOfAccounts.maxExtDimensionCount',
							label: 'Максимальное количество субконто',
							control: 'number',
						},
					],
				},
				{
					title: 'Представление',
					fields: [
						{ path: 'chartOfAccounts.objectPresentationRu', label: 'Представление объекта', control: 'text' },
						{
							path: 'chartOfAccounts.extendedObjectPresentationRu',
							label: 'Расширенное представление объекта',
							control: 'text',
						},
						{ path: 'chartOfAccounts.listPresentationRu', label: 'Представление списка', control: 'text' },
						{
							path: 'chartOfAccounts.extendedListPresentationRu',
							label: 'Расширенное представление списка',
							control: 'text',
						},
						{ path: 'chartOfAccounts.explanationRu', label: 'Пояснение', control: 'textarea' },
					],
				},
				{
					title: 'Поле ввода',
					fields: [
						{ path: 'chartOfAccounts.quickChoice', label: 'Быстрый выбор', control: 'check' },
						{
							path: 'chartOfAccounts.choiceMode',
							label: 'Способ выбора',
							control: 'select',
							options: opts(
								['BOTH_WAYS', 'Обоими способами'],
								['FROM_FORM', 'Из формы'],
								['QUICK_CHOICE', 'Быстрый выбор']
							),
						},
						{
							path: 'chartOfAccounts.createOnInput',
							label: 'Создание при вводе',
							control: 'select',
							options: opts(['AUTO', 'Авто'], ['USE', 'Использовать'], ['DONT_USE', 'Не использовать']),
						},
						{
							path: 'chartOfAccounts.inputByString',
							label: 'Ввод по строке',
							control: 'refList',
							options: inputByString,
						},
						{
							path: 'chartOfAccounts.choiceHistoryOnInput',
							label: 'История выбора при вводе',
							control: 'select',
							options: CHOICE_HISTORY,
						},
					],
				},
				{
					title: 'Прочее',
					fields: [
						{ path: 'chartOfAccounts.basedOn', label: 'Вводится на основании', control: 'refList', options: basedOn },
						{
							path: 'chartOfAccounts.dataLockFields',
							label: 'Поля блокировки данных',
							control: 'refList',
							options: dataLockFields,
						},
						{
							path: 'chartOfAccounts.dataLockControlMode',
							label: 'Режим управления блокировкой данных',
							control: 'select',
							options: opts(
								['AUTOMATIC', 'Автоматический'],
								['MANAGED', 'Управляемый'],
								['AUTOMATIC_AND_MANAGED', 'Автоматический и управляемый']
							),
						},
						{
							path: 'chartOfAccounts.predefinedDataUpdate',
							label: 'Обновление предопределённых данных',
							control: 'select',
							options: opts(
								['AUTO', 'Авто'],
								['DONT_AUTO_UPDATE', 'Не обновлять автоматически'],
								['AUTO_UPDATE', 'Обновлять автоматически']
							),
						},
						{
							path: 'chartOfAccounts.includeHelpInContents',
							label: 'Включать в содержание справки',
							control: 'check',
						},
						{ path: 'chartOfAccounts.additionalIndexes', label: 'Дополнительные индексы', control: 'text' },
					],
				},
			],
		},
		{
			id: 'edit_data',
			title: 'Данные',
			groups: [
				{
					title: 'Код и наименование',
					fields: [
						{ path: 'chartOfAccounts.codeMask', label: 'Маска кода', control: 'text' },
						{ path: 'chartOfAccounts.codeLength', label: 'Длина кода', control: 'number' },
						{ path: 'chartOfAccounts.descriptionLength', label: 'Длина наименования', control: 'number' },
						{
							path: 'chartOfAccounts.codeSeries',
							label: 'Серии кодов',
							control: 'select',
							options: opts(
								['WHOLE_CHART_OF_ACCOUNTS', 'Во всём плане счетов'],
								['WITHIN_SUBORDINATION', 'В пределах подчинения']
							),
						},
						{ path: 'chartOfAccounts.checkUnique', label: 'Контроль уникальности', control: 'check' },
						{
							path: 'chartOfAccounts.defaultPresentation',
							label: 'Основное представление',
							control: 'select',
							options: opts(['AS_CODE', 'В виде кода'], ['AS_DESCRIPTION', 'В виде наименования']),
						},
						{
							path: 'chartOfAccounts.editType',
							label: 'Способ редактирования',
							control: 'select',
							options: opts(
								['IN_DIALOG', 'В диалоге'],
								['IN_LIST', 'В списке'],
								['BOTH_WAYS', 'Обоими способами']
							),
						},
					],
				},
			],
		},
		{
			id: 'edit_forms',
			title: 'Формы',
			groups: [
				{
					title: 'Основные формы',
					fields: [
						{
							path: 'chartOfAccounts.defaultObjectForm',
							label: 'Основная форма объекта',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'chartOfAccounts.defaultListForm',
							label: 'Основная форма списка',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'chartOfAccounts.defaultChoiceForm',
							label: 'Основная форма выбора',
							control: 'select',
							options: forms,
							clearable: true,
						},
					],
				},
				{
					title: 'Формы',
					fields: [{ path: '', label: 'Формы объекта', control: 'staticList', items: input.formNames }],
				},
			],
		},
		{
			id: 'edit_commands',
			title: 'Команды',
			groups: [
				{
					title: 'Команды',
					fields: [
						{
							path: 'chartOfAccounts.useStandardCommands',
							label: 'Использовать стандартные команды',
							control: 'check',
						},
					],
				},
			],
		},
		],
		{
			block: 'chartOfAccounts',
			forms,
			auxiliaryForms: ['object', 'list', 'choice'],
			inputField: true,
			dataHistory: true,
		}
	);
}

/** Вход спецификации задачи: формы, реквизиты адресации и регистры сведений. */
export interface TaskEditSpecInput extends SimpleObjectEditSpecInput {
	/** Имена справочников конфигурации - кандидаты в основания ввода. */
	catalogNames?: readonly string[];
	/** Имена документов конфигурации - кандидаты в основания ввода. */
	documentNames?: readonly string[];
	/** Имена реквизитов объекта - кандидаты для ввода по строке и полей блокировки. */
	attributeNames?: readonly string[];
	/** Имена реквизитов адресации - кандидаты в основной реквизит адресации. */
	addressingAttributeNames?: readonly string[];
	/** Имена регистров сведений - кандидаты в регистр адресации. */
	informationRegisterNames?: readonly string[];
	/** Имена параметров сеанса - кандидаты в текущего исполнителя. */
	sessionParameterNames?: readonly string[];
}

/**
 * Вкладки редактирования задачи: раскладка повторяет редактор EDT.
 * Адресация вынесена своей группой: без неё ролевая адресация не настраивается.
 */
export function buildTaskEditTabs(input: TaskEditSpecInput): MetadataEditTabSpec[] {
	const base = `Task.${input.internalName}`;
	const basedOn = basedOnOptions(input);
	const dataLockFields = lockFieldOptions(
		'Task',
		input.internalName,
		input.standardAttributeNames ?? ['Number', 'Date', 'Description'],
		input.attributeNames
	);
	const forms = objectFormOptions('Task', input.internalName, input.formNames, input.commonFormNames);
	const attributeOptions = (input.attributeNames ?? []).map((name) => ({
		value: `${base}.Attribute.${name}`,
		label: name,
	}));
	const addressingOptions = [
		{ value: '', label: '(не задан)' },
		...(input.addressingAttributeNames ?? []).map((name) => ({
			value: `${base}.AddressingAttribute.${name}`,
			label: name,
		})),
	];
	const registerOptions = [
		{ value: '', label: '(не задан)' },
		...(input.informationRegisterNames ?? []).map((name) => ({
			value: `InformationRegister.${name}`,
			label: name,
		})),
	];
	// Текущий исполнитель - параметр сеанса: платформа сравнивает с ним значение реквизита адресации.
	const performerOptions = [
		{ value: '', label: '(не задан)' },
		...(input.sessionParameterNames ?? []).map((name) => ({
			value: `SessionParameter.${name}`,
			label: name,
		})),
	];
	const inputByString: MetadataEditOption[] = [
		{ value: `${base}.StandardAttribute.Description`, label: 'Наименование' },
		{ value: `${base}.StandardAttribute.Number`, label: 'Номер' },
		...attributeOptions,
	];

	return withReferenceCommon(
		[
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
						{ path: 'object', label: 'Модуль объекта', control: 'moduleLink' },
						{ path: 'manager', label: 'Модуль менеджера', control: 'moduleLink' },
					],
				},
				{
					title: 'Адресация',
					fields: [
						{
							path: 'task.addressing',
							label: 'Адресация',
							control: 'select',
							options: registerOptions,
							clearable: true,
						},
						{
							path: 'task.mainAddressingAttribute',
							label: 'Основной реквизит адресации',
							control: 'select',
							options: addressingOptions,
							clearable: true,
						},
						{
							path: 'task.currentPerformer',
							label: 'Текущий исполнитель',
							control: 'select',
							options: performerOptions,
							clearable: true,
						},
					],
				},
				{
					title: 'Представление',
					fields: [
						{ path: 'task.objectPresentationRu', label: 'Представление объекта', control: 'text' },
						{
							path: 'task.extendedObjectPresentationRu',
							label: 'Расширенное представление объекта',
							control: 'text',
						},
						{ path: 'task.listPresentationRu', label: 'Представление списка', control: 'text' },
						{
							path: 'task.extendedListPresentationRu',
							label: 'Расширенное представление списка',
							control: 'text',
						},
						{ path: 'task.explanationRu', label: 'Пояснение', control: 'textarea' },
					],
				},
				{
					title: 'Нумерация',
					fields: [
						{
							path: 'task.numberType',
							label: 'Тип номера',
							control: 'select',
							options: opts(['STRING', 'Строка'], ['NUMBER', 'Число']),
						},
						{ path: 'task.numberLength', label: 'Длина номера', control: 'number' },
						{
							path: 'task.numberAllowedLength',
							label: 'Допустимая длина номера',
							control: 'select',
							options: opts(['VARIABLE', 'Переменная'], ['FIXED', 'Фиксированная']),
						},
						{ path: 'task.autonumbering', label: 'Автонумерация', control: 'check' },
						{ path: 'task.checkUnique', label: 'Контроль уникальности', control: 'check' },
						{
							path: 'task.taskNumberAutoPrefix',
							label: 'Автопрефикс номера',
							control: 'select',
							options: opts(['DONT_USE', 'Не использовать'], ['BUSINESS_PROCESS_NUMBER', 'Номер бизнес-процесса']),
						},
					],
				},
				{
					title: 'Прочее',
					fields: [
						{ path: 'task.includeHelpInContents', label: 'Включать в содержание справки', control: 'check' },
						{
							path: 'task.dataLockControlMode',
							label: 'Режим управления блокировкой данных',
							control: 'select',
							options: opts(
								['AUTOMATIC', 'Автоматический'],
								['MANAGED', 'Управляемый'],
								['AUTOMATIC_AND_MANAGED', 'Автоматический и управляемый']
							),
						},
						{ path: 'task.additionalIndexes', label: 'Дополнительные индексы', control: 'text' },
					],
				},
			],
		},
		{
			id: 'edit_data',
			title: 'Данные',
			groups: [
				{
					title: 'Номер и наименование',
					fields: [
						{ path: 'task.descriptionLength', label: 'Длина наименования', control: 'number' },
						{
							path: 'task.defaultPresentation',
							label: 'Основное представление',
							control: 'select',
							options: opts(['AS_NUMBER', 'В виде номера'], ['AS_DESCRIPTION', 'В виде наименования']),
						},
						{
							path: 'task.editType',
							label: 'Способ редактирования',
							control: 'select',
							options: opts(
								['IN_DIALOG', 'В диалоге'],
								['IN_LIST', 'В списке'],
								['BOTH_WAYS', 'Обоими способами']
							),
						},
						{ path: 'task.inputByString', label: 'Ввод по строке', control: 'refList', options: inputByString },
						{
							path: 'task.choiceHistoryOnInput',
							label: 'История выбора при вводе',
							control: 'select',
							options: CHOICE_HISTORY,
						},
					],
				},
			],
		},
		{
			id: 'edit_forms',
			title: 'Формы',
			groups: [
				{
					title: 'Основные формы',
					fields: [
						{
							path: 'task.defaultObjectForm',
							label: 'Основная форма объекта',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'task.defaultListForm',
							label: 'Основная форма списка',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'task.defaultChoiceForm',
							label: 'Основная форма выбора',
							control: 'select',
							options: forms,
							clearable: true,
						},
					],
				},
				{
					title: 'Формы',
					fields: [{ path: '', label: 'Формы объекта', control: 'staticList', items: input.formNames }],
				},
			],
		},
		{
			id: 'edit_commands',
			title: 'Команды',
			groups: [
				{
					title: 'Команды',
					fields: [
						{ path: 'task.useStandardCommands', label: 'Использовать стандартные команды', control: 'check' },
					],
				},
			],
		},
		],
		{
			block: 'task',
			forms,
			auxiliaryForms: ['object', 'list', 'choice'],
			inputField: true,
			dataHistory: true,
			lockFields: dataLockFields,
			basedOn,
		}
	);
}

/** Вход спецификации бизнес-процесса: формы, реквизиты и задачи конфигурации. */
export interface BusinessProcessEditSpecInput extends SimpleObjectEditSpecInput {
	/** Имена справочников конфигурации - кандидаты в основания ввода. */
	catalogNames?: readonly string[];
	/** Имена документов конфигурации - кандидаты в основания ввода. */
	documentNames?: readonly string[];
	/** Имена реквизитов объекта - кандидаты для ввода по строке. */
	attributeNames?: readonly string[];
	/** Имена задач конфигурации - кандидаты в задачу бизнес-процесса. */
	taskNames?: readonly string[];
}

/**
 * Вкладки редактирования бизнес-процесса: раскладка повторяет редактор EDT.
 * Карта маршрута правится в конфигураторе, здесь она показывается ссылкой.
 */
export function buildBusinessProcessEditTabs(input: BusinessProcessEditSpecInput): MetadataEditTabSpec[] {
	const base = `BusinessProcess.${input.internalName}`;
	const basedOn = basedOnOptions(input);
	const dataLockFields = lockFieldOptions(
		'BusinessProcess',
		input.internalName,
		input.standardAttributeNames ?? ['Number', 'Date'],
		input.attributeNames
	);
	const forms = objectFormOptions('BusinessProcess', input.internalName, input.formNames, input.commonFormNames);
	const inputByString: MetadataEditOption[] = [
		{ value: `${base}.StandardAttribute.Number`, label: 'Номер' },
		...(input.attributeNames ?? []).map((name) => ({
			value: `${base}.Attribute.${name}`,
			label: name,
		})),
	];
	const taskOptions = [
		{ value: '', label: '(не задана)' },
		...(input.taskNames ?? []).map((name) => ({ value: `Task.${name}`, label: name })),
	];

	return withReferenceCommon(
		[
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
						{
							path: 'businessProcess.task',
							label: 'Задача',
							control: 'select',
							options: taskOptions,
							clearable: true,
						},
						{
							path: 'businessProcess.createTaskInPrivilegedMode',
							label: 'Создавать задачи в привилегированном режиме',
							control: 'check',
						},
						{ path: 'businessProcess.flowchart', label: 'Карта маршрута', control: 'text', readonly: true },
						{ path: 'object', label: 'Модуль объекта', control: 'moduleLink' },
						{ path: 'manager', label: 'Модуль менеджера', control: 'moduleLink' },
					],
				},
				{
					title: 'Представление',
					fields: [
						{ path: 'businessProcess.objectPresentationRu', label: 'Представление объекта', control: 'text' },
						{
							path: 'businessProcess.extendedObjectPresentationRu',
							label: 'Расширенное представление объекта',
							control: 'text',
						},
						{ path: 'businessProcess.listPresentationRu', label: 'Представление списка', control: 'text' },
						{
							path: 'businessProcess.extendedListPresentationRu',
							label: 'Расширенное представление списка',
							control: 'text',
						},
						{ path: 'businessProcess.explanationRu', label: 'Пояснение', control: 'textarea' },
					],
				},
				{
					title: 'Нумерация',
					fields: [
						{
							path: 'businessProcess.numberType',
							label: 'Тип номера',
							control: 'select',
							options: opts(['STRING', 'Строка'], ['NUMBER', 'Число']),
						},
						{ path: 'businessProcess.numberLength', label: 'Длина номера', control: 'number' },
						{
							path: 'businessProcess.numberAllowedLength',
							label: 'Допустимая длина номера',
							control: 'select',
							options: opts(['VARIABLE', 'Переменная'], ['FIXED', 'Фиксированная']),
						},
						{
							path: 'businessProcess.numberPeriodicity',
							label: 'Периодичность номера',
							control: 'select',
							options: opts(
								['NONPERIODICAL', 'Непериодический'],
								['YEAR', 'В пределах года'],
								['QUARTER', 'В пределах квартала'],
								['MONTH', 'В пределах месяца'],
								['DAY', 'В пределах дня']
							),
						},
						{ path: 'businessProcess.autonumbering', label: 'Автонумерация', control: 'check' },
						{ path: 'businessProcess.checkUnique', label: 'Контроль уникальности', control: 'check' },
					],
				},
				{
					title: 'Прочее',
					fields: [
						{
							path: 'businessProcess.includeHelpInContents',
							label: 'Включать в содержание справки',
							control: 'check',
						},
						{
							path: 'businessProcess.dataLockControlMode',
							label: 'Режим управления блокировкой данных',
							control: 'select',
							options: opts(
								['AUTOMATIC', 'Автоматический'],
								['MANAGED', 'Управляемый'],
								['AUTOMATIC_AND_MANAGED', 'Автоматический и управляемый']
							),
						},
						{ path: 'businessProcess.additionalIndexes', label: 'Дополнительные индексы', control: 'text' },
					],
				},
			],
		},
		{
			id: 'edit_data',
			title: 'Данные',
			groups: [
				{
					title: 'Данные',
					fields: [
						{
							path: 'businessProcess.editType',
							label: 'Способ редактирования',
							control: 'select',
							options: opts(
								['IN_DIALOG', 'В диалоге'],
								['IN_LIST', 'В списке'],
								['BOTH_WAYS', 'Обоими способами']
							),
						},
						{
							path: 'businessProcess.inputByString',
							label: 'Ввод по строке',
							control: 'refList',
							options: inputByString,
						},
						{
							path: 'businessProcess.choiceHistoryOnInput',
							label: 'История выбора при вводе',
							control: 'select',
							options: CHOICE_HISTORY,
						},
					],
				},
			],
		},
		{
			id: 'edit_forms',
			title: 'Формы',
			groups: [
				{
					title: 'Основные формы',
					fields: [
						{
							path: 'businessProcess.defaultObjectForm',
							label: 'Основная форма объекта',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'businessProcess.defaultListForm',
							label: 'Основная форма списка',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'businessProcess.defaultChoiceForm',
							label: 'Основная форма выбора',
							control: 'select',
							options: forms,
							clearable: true,
						},
					],
				},
				{
					title: 'Формы',
					fields: [{ path: '', label: 'Формы объекта', control: 'staticList', items: input.formNames }],
				},
			],
		},
		{
			id: 'edit_commands',
			title: 'Команды',
			groups: [
				{
					title: 'Команды',
					fields: [
						{
							path: 'businessProcess.useStandardCommands',
							label: 'Использовать стандартные команды',
							control: 'check',
						},
					],
				},
			],
		},
		],
		{
			block: 'businessProcess',
			forms,
			auxiliaryForms: ['object', 'list', 'choice'],
			inputField: true,
			dataHistory: true,
			lockFields: dataLockFields,
			basedOn,
		}
	);
}

/** Вход спецификации плана видов характеристик. */
export interface ChartOfCharacteristicTypesEditSpecInput extends SimpleObjectEditSpecInput {
	/** Имена реквизитов объекта - кандидаты для ввода по строке и полей блокировки. */
	attributeNames?: readonly string[];
	/** Имена справочников конфигурации - кандидаты в дополнительные значения и в основания. */
	catalogNames?: readonly string[];
	/** Имена документов конфигурации - кандидаты в основания. */
	documentNames?: readonly string[];
}

/**
 * Вкладки редактирования плана видов характеристик: раскладка повторяет редактор EDT.
 * Тип значения характеристики правится палитрой типов, как у константы.
 */
export function buildChartOfCharacteristicTypesEditTabs(
	input: ChartOfCharacteristicTypesEditSpecInput
): MetadataEditTabSpec[] {
	const base = `ChartOfCharacteristicTypes.${input.internalName}`;
	const forms = objectFormOptions('ChartOfCharacteristicTypes', input.internalName, input.formNames, input.commonFormNames);
	const attributeOptions = (input.attributeNames ?? []).map((name) => ({
		value: `${base}.Attribute.${name}`,
		label: name,
	}));
	const inputByString: MetadataEditOption[] = [
		{ value: `${base}.StandardAttribute.Description`, label: 'Наименование' },
		{ value: `${base}.StandardAttribute.Code`, label: 'Код' },
		...attributeOptions,
	];
	const dataLockFields = lockFieldOptions(
		prefixOf(base),
		input.internalName,
		input.standardAttributeNames ?? ['Code', 'Description'],
		input.attributeNames
	);
	const basedOn = basedOnOptions(input);
	const extValues: MetadataEditOption[] = [
		{ value: '', label: '(не задан)' },
		...(input.catalogNames ?? []).map((name) => ({ value: `Catalog.${name}`, label: name })),
	];

	return withReferenceCommon(
		[
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
						{ path: 'chartOfCharacteristicTypes.type', label: 'Тип значения характеристики', control: 'type' },
						{
							path: 'chartOfCharacteristicTypes.characteristicExtValues',
							label: 'Дополнительные значения характеристик',
							control: 'select',
							options: extValues,
							clearable: true,
						},
						{ path: 'object', label: 'Модуль объекта', control: 'moduleLink' },
						{ path: 'manager', label: 'Модуль менеджера', control: 'moduleLink' },
					],
				},
				{
					title: 'Представление',
					fields: [
						{
							path: 'chartOfCharacteristicTypes.objectPresentationRu',
							label: 'Представление объекта',
							control: 'text',
						},
						{
							path: 'chartOfCharacteristicTypes.extendedObjectPresentationRu',
							label: 'Расширенное представление объекта',
							control: 'text',
						},
						{
							path: 'chartOfCharacteristicTypes.listPresentationRu',
							label: 'Представление списка',
							control: 'text',
						},
						{
							path: 'chartOfCharacteristicTypes.extendedListPresentationRu',
							label: 'Расширенное представление списка',
							control: 'text',
						},
						{ path: 'chartOfCharacteristicTypes.explanationRu', label: 'Пояснение', control: 'textarea' },
					],
				},
				{
					title: 'Иерархия',
					fields: [
						{ path: 'chartOfCharacteristicTypes.hierarchical', label: 'Иерархический', control: 'check' },
						{
							path: 'chartOfCharacteristicTypes.foldersOnTop',
							label: 'Размещать группы сверху',
							control: 'check',
							enabledWhen: [{ path: 'chartOfCharacteristicTypes.hierarchical', equals: true }],
						},
					],
				},
				{
					title: 'Нумерация',
					fields: [
						{ path: 'chartOfCharacteristicTypes.autonumbering', label: 'Автонумерация', control: 'check' },
						{ path: 'chartOfCharacteristicTypes.checkUnique', label: 'Контроль уникальности', control: 'check' },
						{
							path: 'chartOfCharacteristicTypes.codeSeries',
							label: 'Серии кодов',
							control: 'select',
							options: opts(
								['WHOLE_CHARACTERISTIC_KIND', 'Во всём плане видов характеристик'],
								['WITHIN_SUBORDINATION', 'В пределах подчинения']
							),
						},
					],
				},
				{
					title: 'Поле ввода',
					fields: [
						{ path: 'chartOfCharacteristicTypes.quickChoice', label: 'Быстрый выбор', control: 'check' },
						{
							path: 'chartOfCharacteristicTypes.choiceMode',
							label: 'Способ выбора',
							control: 'select',
							options: opts(
								['BOTH_WAYS', 'Обоими способами'],
								['FROM_FORM', 'Из формы'],
								['QUICK_CHOICE', 'Быстрый выбор']
							),
						},
						{
							path: 'chartOfCharacteristicTypes.createOnInput',
							label: 'Создание при вводе',
							control: 'select',
							options: opts(['AUTO', 'Авто'], ['USE', 'Использовать'], ['DONT_USE', 'Не использовать']),
						},
						{
							path: 'chartOfCharacteristicTypes.inputByString',
							label: 'Ввод по строке',
							control: 'refList',
							options: inputByString,
						},
						{
							path: 'chartOfCharacteristicTypes.choiceHistoryOnInput',
							label: 'История выбора при вводе',
							control: 'select',
							options: CHOICE_HISTORY,
						},
					],
				},
				{
					title: 'Прочее',
					fields: [
						{
							path: 'chartOfCharacteristicTypes.basedOn',
							label: 'Вводится на основании',
							control: 'refList',
							options: basedOn,
						},
						{
							path: 'chartOfCharacteristicTypes.dataLockFields',
							label: 'Поля блокировки данных',
							control: 'refList',
							options: dataLockFields,
						},
						{
							path: 'chartOfCharacteristicTypes.dataLockControlMode',
							label: 'Режим управления блокировкой данных',
							control: 'select',
							options: opts(
								['AUTOMATIC', 'Автоматический'],
								['MANAGED', 'Управляемый'],
								['AUTOMATIC_AND_MANAGED', 'Автоматический и управляемый']
							),
						},
						{
							path: 'chartOfCharacteristicTypes.predefinedDataUpdate',
							label: 'Обновление предопределённых данных',
							control: 'select',
							options: opts(
								['AUTO', 'Авто'],
								['DONT_AUTO_UPDATE', 'Не обновлять автоматически'],
								['AUTO_UPDATE', 'Обновлять автоматически']
							),
						},
						{
							path: 'chartOfCharacteristicTypes.includeHelpInContents',
							label: 'Включать в содержание справки',
							control: 'check',
						},
						{
							path: 'chartOfCharacteristicTypes.additionalIndexes',
							label: 'Дополнительные индексы',
							control: 'text',
						},
					],
				},
			],
		},
		{
			id: 'edit_data',
			title: 'Данные',
			groups: [
				{
					title: 'Код и наименование',
					fields: [
						{ path: 'chartOfCharacteristicTypes.codeLength', label: 'Длина кода', control: 'number' },
						{
							path: 'chartOfCharacteristicTypes.codeAllowedLength',
							label: 'Допустимая длина кода',
							control: 'select',
							options: opts(['VARIABLE', 'Переменная'], ['FIXED', 'Фиксированная']),
						},
						{
							path: 'chartOfCharacteristicTypes.descriptionLength',
							label: 'Длина наименования',
							control: 'number',
						},
						{
							path: 'chartOfCharacteristicTypes.defaultPresentation',
							label: 'Основное представление',
							control: 'select',
							options: opts(['AS_CODE', 'В виде кода'], ['AS_DESCRIPTION', 'В виде наименования']),
						},
						{
							path: 'chartOfCharacteristicTypes.editType',
							label: 'Способ редактирования',
							control: 'select',
							options: opts(
								['IN_DIALOG', 'В диалоге'],
								['IN_LIST', 'В списке'],
								['BOTH_WAYS', 'Обоими способами']
							),
						},
					],
				},
			],
		},
		{
			id: 'edit_forms',
			title: 'Формы',
			groups: [
				{
					title: 'Основные формы',
					fields: [
						{
							path: 'chartOfCharacteristicTypes.defaultObjectForm',
							label: 'Основная форма объекта',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'chartOfCharacteristicTypes.defaultFolderForm',
							label: 'Основная форма группы',
							control: 'select',
							options: forms,
							clearable: true,
							enabledWhen: [{ path: 'chartOfCharacteristicTypes.hierarchical', equals: true }],
						},
						{
							path: 'chartOfCharacteristicTypes.defaultListForm',
							label: 'Основная форма списка',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'chartOfCharacteristicTypes.defaultChoiceForm',
							label: 'Основная форма выбора',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'chartOfCharacteristicTypes.defaultFolderChoiceForm',
							label: 'Основная форма выбора группы',
							control: 'select',
							options: forms,
							clearable: true,
							enabledWhen: [{ path: 'chartOfCharacteristicTypes.hierarchical', equals: true }],
						},
					],
				},
				{
					title: 'Формы',
					fields: [{ path: '', label: 'Формы объекта', control: 'staticList', items: input.formNames }],
				},
			],
		},
		{
			id: 'edit_commands',
			title: 'Команды',
			groups: [
				{
					title: 'Команды',
					fields: [
						{
							path: 'chartOfCharacteristicTypes.useStandardCommands',
							label: 'Использовать стандартные команды',
							control: 'check',
						},
					],
				},
			],
		},
		],
		{
			block: 'chartOfCharacteristicTypes',
			forms,
			auxiliaryForms: ['object', 'folder', 'list', 'choice', 'folderChoice'],
			inputField: true,
			dataHistory: true,
		}
	);
}

/** Вход спецификации плана обмена: формы, реквизиты и кандидаты в основания. */
export interface ExchangePlanEditSpecInput extends SimpleObjectEditSpecInput {
	/** Имена реквизитов объекта - кандидаты для ввода по строке и полей блокировки. */
	attributeNames?: readonly string[];
	/** Имена справочников конфигурации - кандидаты в основания. */
	catalogNames?: readonly string[];
	/** Имена документов конфигурации - кандидаты в основания. */
	documentNames?: readonly string[];
}

/**
 * Вкладки редактирования плана обмена: раскладка повторяет редактор EDT.
 * Состав плана обмена ведётся отдельно, здесь только свойства.
 */
export function buildExchangePlanEditTabs(input: ExchangePlanEditSpecInput): MetadataEditTabSpec[] {
	const base = `ExchangePlan.${input.internalName}`;
	const forms = objectFormOptions('ExchangePlan', input.internalName, input.formNames, input.commonFormNames);
	const attributeOptions = (input.attributeNames ?? []).map((name) => ({
		value: `${base}.Attribute.${name}`,
		label: name,
	}));
	const inputByString: MetadataEditOption[] = [
		{ value: `${base}.StandardAttribute.Description`, label: 'Наименование' },
		{ value: `${base}.StandardAttribute.Code`, label: 'Код' },
		...attributeOptions,
	];
	const dataLockFields = lockFieldOptions(
		prefixOf(base),
		input.internalName,
		input.standardAttributeNames ?? ['Code', 'Description'],
		input.attributeNames
	);
	const basedOn = basedOnOptions(input);

	return withReferenceCommon(
		[
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
						{ path: 'object', label: 'Модуль объекта', control: 'moduleLink' },
						{ path: 'manager', label: 'Модуль менеджера', control: 'moduleLink' },
					],
				},
				{
					title: 'Представление',
					fields: [
						{ path: 'exchangePlan.objectPresentationRu', label: 'Представление объекта', control: 'text' },
						{
							path: 'exchangePlan.extendedObjectPresentationRu',
							label: 'Расширенное представление объекта',
							control: 'text',
						},
						{ path: 'exchangePlan.listPresentationRu', label: 'Представление списка', control: 'text' },
						{
							path: 'exchangePlan.extendedListPresentationRu',
							label: 'Расширенное представление списка',
							control: 'text',
						},
						{ path: 'exchangePlan.explanationRu', label: 'Пояснение', control: 'textarea' },
					],
				},
				{
					title: 'Обмен данными',
					fields: [
						{
							path: 'exchangePlan.distributedInfoBase',
							label: 'Распределённая информационная база',
							control: 'check',
						},
						{
							path: 'exchangePlan.includeConfigurationExtensions',
							label: 'Включать расширения конфигурации',
							control: 'check',
							enabledWhen: [{ path: 'exchangePlan.distributedInfoBase', equals: true }],
						},
					],
				},
				{
					title: 'Поле ввода',
					fields: [
						{ path: 'exchangePlan.quickChoice', label: 'Быстрый выбор', control: 'check' },
						{
							path: 'exchangePlan.choiceMode',
							label: 'Способ выбора',
							control: 'select',
							options: opts(
								['BOTH_WAYS', 'Обоими способами'],
								['FROM_FORM', 'Из формы'],
								['QUICK_CHOICE', 'Быстрый выбор']
							),
						},
						{
							path: 'exchangePlan.createOnInput',
							label: 'Создание при вводе',
							control: 'select',
							options: opts(['AUTO', 'Авто'], ['USE', 'Использовать'], ['DONT_USE', 'Не использовать']),
						},
						{
							path: 'exchangePlan.inputByString',
							label: 'Ввод по строке',
							control: 'refList',
							options: inputByString,
						},
						{
							path: 'exchangePlan.choiceHistoryOnInput',
							label: 'История выбора при вводе',
							control: 'select',
							options: CHOICE_HISTORY,
						},
					],
				},
				{
					title: 'Прочее',
					fields: [
						{ path: 'exchangePlan.basedOn', label: 'Вводится на основании', control: 'refList', options: basedOn },
						{
							path: 'exchangePlan.dataLockFields',
							label: 'Поля блокировки данных',
							control: 'refList',
							options: dataLockFields,
						},
						{
							path: 'exchangePlan.dataLockControlMode',
							label: 'Режим управления блокировкой данных',
							control: 'select',
							options: opts(
								['AUTOMATIC', 'Автоматический'],
								['MANAGED', 'Управляемый'],
								['AUTOMATIC_AND_MANAGED', 'Автоматический и управляемый']
							),
						},
						{
							path: 'exchangePlan.includeHelpInContents',
							label: 'Включать в содержание справки',
							control: 'check',
						},
						{ path: 'exchangePlan.additionalIndexes', label: 'Дополнительные индексы', control: 'text' },
					],
				},
			],
		},
		{
			id: 'edit_data',
			title: 'Данные',
			groups: [
				{
					title: 'Код и наименование',
					fields: [
						{ path: 'exchangePlan.codeLength', label: 'Длина кода', control: 'number' },
						{
							path: 'exchangePlan.codeAllowedLength',
							label: 'Допустимая длина кода',
							control: 'select',
							options: opts(['VARIABLE', 'Переменная'], ['FIXED', 'Фиксированная']),
						},
						{ path: 'exchangePlan.descriptionLength', label: 'Длина наименования', control: 'number' },
						{
							path: 'exchangePlan.defaultPresentation',
							label: 'Основное представление',
							control: 'select',
							options: opts(['AS_CODE', 'В виде кода'], ['AS_DESCRIPTION', 'В виде наименования']),
						},
						{
							path: 'exchangePlan.editType',
							label: 'Способ редактирования',
							control: 'select',
							options: opts(
								['IN_DIALOG', 'В диалоге'],
								['IN_LIST', 'В списке'],
								['BOTH_WAYS', 'Обоими способами']
							),
						},
					],
				},
			],
		},
		{
			id: 'edit_forms',
			title: 'Формы',
			groups: [
				{
					title: 'Основные формы',
					fields: [
						{
							path: 'exchangePlan.defaultObjectForm',
							label: 'Основная форма объекта',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'exchangePlan.defaultListForm',
							label: 'Основная форма списка',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'exchangePlan.defaultChoiceForm',
							label: 'Основная форма выбора',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'exchangePlan.auxiliaryObjectForm',
							label: 'Вспомогательная форма объекта',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'exchangePlan.auxiliaryListForm',
							label: 'Вспомогательная форма списка',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'exchangePlan.auxiliaryChoiceForm',
							label: 'Вспомогательная форма выбора',
							control: 'select',
							options: forms,
							clearable: true,
						},
					],
				},
				{
					title: 'Формы',
					fields: [{ path: '', label: 'Формы объекта', control: 'staticList', items: input.formNames }],
				},
			],
		},
		{
			id: 'edit_commands',
			title: 'Команды',
			groups: [
				{
					title: 'Команды',
					fields: [
						{
							path: 'exchangePlan.useStandardCommands',
							label: 'Использовать стандартные команды',
							control: 'check',
						},
					],
				},
			],
		},
		],
		{
			block: 'exchangePlan',
			forms,
			auxiliaryForms: [],
			inputField: true,
			dataHistory: true,
		}
	);
}

/** Вход спецификации журнала документов: формы объекта и документы конфигурации. */
export interface DocumentJournalEditSpecInput extends SimpleObjectEditSpecInput {
	/** Имена документов конфигурации - кандидаты в регистрируемые. */
	documentNames?: readonly string[];
}

/**
 * Вкладки редактирования журнала документов: раскладка повторяет редактор EDT.
 * Регистрируемые документы ведутся списком ссылок, графы журнала - на вкладке состава.
 */
export function buildDocumentJournalEditTabs(input: DocumentJournalEditSpecInput): MetadataEditTabSpec[] {
	const forms = objectFormOptions('DocumentJournal', input.internalName, input.formNames, input.commonFormNames);
	const documentOptions = (input.documentNames ?? []).map((name) => ({
		value: `Document.${name}`,
		label: name,
	}));
	return [
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
					],
				},
				{
					title: 'Представление',
					fields: [
						{ path: 'documentJournal.listPresentationRu', label: 'Представление списка', control: 'text' },
						{
							path: 'documentJournal.extendedListPresentationRu',
							label: 'Расширенное представление списка',
							control: 'text',
						},
						{ path: 'documentJournal.explanationRu', label: 'Пояснение', control: 'textarea' },
					],
				},
				{
					title: 'Прочее',
					fields: [
						{ path: 'documentJournal.includeHelpInContents', label: 'Включать в содержание справки', control: 'check' },
						{ path: 'documentJournal.additionalIndexes', label: 'Дополнительные индексы', control: 'text' },
					],
				},
			],
		},
		{
			id: 'edit_registered',
			title: 'Регистрируемые документы',
			groups: [
				{
					title: 'Регистрируемые документы',
					fields: [
						{
							path: 'documentJournal.registeredDocuments',
							label: 'Документы журнала',
							control: 'refList',
							options: documentOptions,
						},
					],
				},
			],
		},
		{
			id: 'edit_forms',
			title: 'Формы',
			groups: [
				{
					title: 'Основные формы',
					fields: [
						{
							path: 'documentJournal.defaultForm',
							label: 'Основная форма',
							control: 'select',
							options: forms,
							clearable: true,
						},
						{
							path: 'documentJournal.auxiliaryForm',
							label: 'Вспомогательная форма',
							control: 'select',
							options: forms,
							clearable: true,
						},
					],
				},
				{
					title: 'Формы',
					fields: [{ path: '', label: 'Формы объекта', control: 'staticList', items: input.formNames }],
				},
			],
		},
		{
			id: 'edit_commands',
			title: 'Команды',
			groups: [
				{
					title: 'Команды',
					fields: [
						{
							path: 'documentJournal.useStandardCommands',
							label: 'Использовать стандартные команды',
							control: 'check',
						},
					],
				},
			],
		},
		{
			id: 'edit_modules',
			title: 'Модули',
			groups: [
				{
					title: 'Модули',
					fields: [{ path: 'manager', label: 'Модуль менеджера', control: 'moduleLink' }],
				},
			],
		},
	];
}

/**
 * Вкладки редактирования общего модуля: контекст исполнения одной группой, как в EDT.
 */
/** Вкладки параметра сеанса: кроме имени и синонима у него только тип значения. */
export function buildSessionParameterEditTabs(): MetadataEditTabSpec[] {
	return [
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
					],
				},
				{
					title: 'Данные',
					fields: [{ path: 'sessionParameter.type', label: 'Тип', control: 'type' }],
				},
			],
		},
	];
}

/** Вкладки нумератора документов: нумерация, общая для документов с этим нумератором. */
export function buildDocumentNumeratorEditTabs(): MetadataEditTabSpec[] {
	return [
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
					],
				},
				{
					title: 'Нумерация',
					fields: [
						{
							path: 'documentNumerator.numberType',
							label: 'Тип номера',
							control: 'select',
							options: opts(['STRING', 'Строка'], ['NUMBER', 'Число']),
						},
						{ path: 'documentNumerator.numberLength', label: 'Длина номера', control: 'number' },
						{
							path: 'documentNumerator.numberAllowedLength',
							label: 'Допустимая длина номера',
							control: 'select',
							options: opts(['VARIABLE', 'Переменная'], ['FIXED', 'Фиксированная']),
						},
						{
							path: 'documentNumerator.numberPeriodicity',
							label: 'Периодичность номера',
							control: 'select',
							options: opts(
								['NONPERIODICAL', 'Непериодический'],
								['YEAR', 'В пределах года'],
								['QUARTER', 'В пределах квартала'],
								['MONTH', 'В пределах месяца'],
								['DAY', 'В пределах дня']
							),
						},
						{ path: 'documentNumerator.checkUnique', label: 'Контроль уникальности', control: 'check' },
					],
				},
			],
		},
	];
}

/** Вкладки подписки на событие: источник, событие и обработчик. */
export function buildEventSubscriptionEditTabs(): MetadataEditTabSpec[] {
	return [
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
					],
				},
				{
					title: 'Данные',
					fields: [
						{ path: 'eventSubscription.source', label: 'Источник', control: 'type' },
						{ path: 'eventSubscription.event', label: 'Событие', control: 'text' },
						{ path: 'eventSubscription.handler', label: 'Обработчик', control: 'text' },
					],
				},
			],
		},
	];
}

/** Вкладки регламентного задания: метод, ключ, расписание и перезапуски. */
export function buildScheduledJobEditTabs(): MetadataEditTabSpec[] {
	return [
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
					],
				},
				{
					title: 'Данные',
					fields: [
						{ path: 'scheduledJob.methodName', label: 'Имя метода', control: 'text' },
						{ path: 'scheduledJob.description', label: 'Наименование', control: 'text' },
						{ path: 'scheduledJob.key', label: 'Ключ', control: 'text' },
						{ path: 'scheduledJob.use', label: 'Использование', control: 'check' },
						{ path: 'scheduledJob.predefined', label: 'Предопределённое', control: 'check' },
						{ path: 'scheduledJob.schedule', label: 'Расписание', control: 'textarea' },
					],
				},
				{
					title: 'Прочее',
					fields: [
						{ path: 'scheduledJob.restartCountOnFailure', label: 'Число попыток при ошибке', control: 'number' },
						{
							path: 'scheduledJob.restartIntervalOnFailure',
							label: 'Интервал повтора при ошибке, с',
							control: 'number',
						},
					],
				},
			],
		},
	];
}

/** Вкладки общей команды: где команда появляется и с каким параметром работает. */
export function buildCommonCommandEditTabs(): MetadataEditTabSpec[] {
	return [
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
						{ path: 'commandModule', label: 'Модуль команды', control: 'moduleLink' },
					],
				},
				{
					title: 'Представление',
					fields: [
						{ path: 'commonCommand.toolTipRu', label: 'Подсказка', control: 'text' },
						{
							path: 'commonCommand.representation',
							label: 'Отображение',
							control: 'select',
							options: opts(
								['AUTO', 'Авто'],
								['TEXT', 'Текст'],
								['PICTURE', 'Картинка'],
								['PICTURE_AND_TEXT', 'Картинка и текст']
							),
						},
						{ path: 'commonCommand.shortcut', label: 'Сочетание клавиш', control: 'text' },
					],
				},
				{
					title: 'Данные',
					fields: [
						{ path: 'commonCommand.group', label: 'Группа', control: 'text' },
						{ path: 'commonCommand.commandParameterType', label: 'Тип параметра команды', control: 'type' },
						{
							path: 'commonCommand.parameterUseMode',
							label: 'Режим использования параметра',
							control: 'select',
							options: opts(['SINGLE', 'Одиночный'], ['MULTIPLE', 'Множественный']),
						},
						{ path: 'commonCommand.modifiesData', label: 'Изменяет сохраняемые данные', control: 'check' },
						{
							path: 'commonCommand.onMainServerUnavalableBehavior',
							label: 'Поведение при недоступности главного сервера',
							control: 'select',
							options: opts(
								['AUTO', 'Авто'],
								['MAKE_DISABLE', 'Выключать'],
								['DONT_CHANGE_BEHAVIOR', 'Не менять поведение']
							),
						},
					],
				},
				{
					title: 'Прочее',
					fields: [
						{
							path: 'commonCommand.includeHelpInContents',
							label: 'Включать в содержание справки',
							control: 'check',
						},
					],
				},
			],
		},
	];
}

/** Вкладки общего реквизита: разделение данных решает, где он появится. */
export function buildCommonAttributeEditTabs(): MetadataEditTabSpec[] {
	return [
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
						{ path: 'commonAttribute.type', label: 'Тип', control: 'type' },
					],
				},
				{
					title: 'Представление',
					fields: [{ path: 'commonAttribute.toolTipRu', label: 'Подсказка', control: 'text' }],
				},
				{
					title: 'Данные',
					fields: [
						{
							path: 'commonAttribute.autoUse',
							label: 'Автоиспользование',
							control: 'select',
							options: opts(['USE', 'Использовать'], ['DONT_USE', 'Не использовать']),
						},
						{
							path: 'commonAttribute.dataSeparation',
							label: 'Разделение данных',
							control: 'select',
							options: opts(['DONT_USE', 'Не использовать'], ['SEPARATE', 'Разделять']),
						},
						{
							path: 'commonAttribute.separatedDataUse',
							label: 'Использование разделённых данных',
							control: 'select',
							options: opts(
								['INDEPENDENTLY_AND_SIMULTANEOUSLY', 'Независимо и совместно'],
								['INDEPENDENTLY', 'Независимо']
							),
						},
						{ path: 'commonAttribute.dataSeparationValue', label: 'Значение разделителя', control: 'text' },
						{ path: 'commonAttribute.dataSeparationUse', label: 'Использование разделителя', control: 'text' },
						{
							path: 'commonAttribute.conditionalSeparation',
							label: 'Условное разделение',
							control: 'text',
						},
						{
							path: 'commonAttribute.usersSeparation',
							label: 'Разделение пользователей',
							control: 'select',
							options: opts(['SEPARATE', 'Разделять'], ['DONT_SEPARATE', 'Не разделять']),
						},
						{
							path: 'commonAttribute.authenticationSeparation',
							label: 'Разделение аутентификации',
							control: 'select',
							options: opts(['SEPARATE', 'Разделять'], ['DONT_SEPARATE', 'Не разделять']),
						},
						{
							path: 'commonAttribute.configurationExtensionsSeparation',
							label: 'Разделение расширений конфигурации',
							control: 'select',
							options: opts(['SEPARATE', 'Разделять'], ['DONT_SEPARATE', 'Не разделять']),
						},
						{
							path: 'commonAttribute.indexing',
							label: 'Индексирование',
							control: 'select',
							options: opts(['DONT_INDEX', 'Не индексировать'], ['INDEX', 'Индексировать']),
						},
					],
				},
				{
					title: 'Поле ввода',
					fields: [
						{ path: 'commonAttribute.passwordMode', label: 'Режим пароля', control: 'check' },
						{ path: 'commonAttribute.multiLine', label: 'Многострочный режим', control: 'check' },
						{ path: 'commonAttribute.mask', label: 'Маска', control: 'text' },
						{
							path: 'commonAttribute.fillChecking',
							label: 'Проверка заполнения',
							control: 'select',
							options: opts(['DONT_CHECK', 'Не проверять'], ['SHOW_ERROR', 'Выдавать ошибку']),
						},
						{ path: 'commonAttribute.choiceForm', label: 'Форма выбора', control: 'text' },
					],
				},
				{
					title: 'Блокировка и история',
					fields: [
						{
							path: 'commonAttribute.fullTextSearch',
							label: 'Полнотекстовый поиск',
							control: 'select',
							options: opts(['USE', 'Использовать'], ['DONT_USE', 'Не использовать']),
						},
						{
							path: 'commonAttribute.dataHistory',
							label: 'История данных',
							control: 'select',
							options: opts(['USE', 'Использовать'], ['DONT_USE', 'Не использовать']),
						},
					],
				},
			],
		},
	];
}

/** Вкладки общей картинки: сам файл правится не панелью. */
export function buildCommonPictureEditTabs(): MetadataEditTabSpec[] {
	return [
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
					],
				},
				{
					title: 'Данные',
					fields: [
						{
							path: 'commonPicture.availabilityForChoice',
							label: 'Доступна для выбора',
							control: 'check',
						},
						{
							path: 'commonPicture.availabilityForAppearance',
							label: 'Доступна для оформления',
							control: 'check',
						},
					],
				},
			],
		},
	];
}

/** Вкладки роли: состав прав живёт отдельным файлом и панелью не правится. */
export function buildRoleEditTabs(): MetadataEditTabSpec[] {
	return [
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
					],
				},
			],
		},
	];
}

/** Вкладки внешнего источника данных: таблицы и функции правятся в дереве. */
export function buildExternalDataSourceEditTabs(): MetadataEditTabSpec[] {
	return [
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
					],
				},
				{
					title: 'Блокировка и история',
					fields: [
						{
							path: 'externalDataSource.dataLockControlMode',
							label: 'Режим управления блокировкой данных',
							control: 'select',
							options: opts(['AUTOMATIC', 'Автоматический'], ['MANAGED', 'Управляемый']),
						},
					],
				},
			],
		},
	];
}

export function buildCommonModuleEditTabs(): MetadataEditTabSpec[] {
	return [
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
						{ path: 'module', label: 'Модуль', control: 'moduleLink' },
					],
				},
				{
					title: 'Контекст исполнения',
					fields: [
						{ path: 'commonModule.global', label: 'Глобальный', control: 'check' },
						{ path: 'commonModule.server', label: 'Сервер', control: 'check' },
						{ path: 'commonModule.serverCall', label: 'Вызов сервера', control: 'check' },
						{ path: 'commonModule.externalConnection', label: 'Внешнее соединение', control: 'check' },
						{ path: 'commonModule.client', label: 'Клиент (обычное приложение)', control: 'check' },
						{
							path: 'commonModule.clientManagedApplication',
							label: 'Клиент (управляемое приложение)',
							control: 'check',
						},
						{
							path: 'commonModule.clientOrdinaryApplication',
							label: 'Клиент (обычное приложение, толстый клиент)',
							control: 'check',
						},
					],
				},
				{
					title: 'Прочее',
					fields: [
						{ path: 'commonModule.privileged', label: 'Привилегированный', control: 'check' },
						{
							path: 'commonModule.returnValuesReuse',
							label: 'Повторное использование возвращаемых значений',
							control: 'select',
							options: opts(
								['DONT_USE', 'Не использовать'],
								['DURING_REQUEST', 'На время вызова'],
								['DURING_SESSION', 'На время сеанса']
							),
						},
					],
				},
			],
		},
	];
}

export interface RegisterEditSpecInput {
	internalName: string;
	formNames: readonly string[];
	commandNames: readonly string[];
	/** Имена общих форм конфигурации - кандидаты в основные формы объекта. */
	commonFormNames?: readonly string[];
	/** Регистр сведений или накопления: наборы свойств у них разные. */
	information: boolean;
}

const DATA_LOCK_CONTROL_MODE = opts(
	['AUTOMATIC', 'Автоматический'],
	['MANAGED', 'Управляемый'],
	['AUTOMATIC_AND_MANAGED', 'Автоматический и управляемый']
);

function registerFormOptions(input: RegisterEditSpecInput): MetadataEditOption[] {
	const prefix = input.information ? 'InformationRegister' : 'AccumulationRegister';
	return objectFormOptions(prefix, input.internalName, input.formNames, input.commonFormNames);
}

/**
 * Вкладки редактирования регистра сведений и накопления: раскладка повторяет редактор EDT
 * (Основные, Данные, Формы, Команды).
 */
export function buildRegisterEditTabs(input: RegisterEditSpecInput): MetadataEditTabSpec[] {
	const forms = registerFormOptions(input);
	const dataFields: MetadataEditField[] = input.information
		? [
				{
					path: 'register.editType',
					label: 'Способ редактирования',
					control: 'select',
					options: opts(
						['IN_DIALOG', 'В диалоге'],
						['IN_LIST', 'В списке'],
						['BOTH_WAYS', 'Обоими способами']
					),
				},
				{
					path: 'register.informationRegisterPeriodicity',
					label: 'Периодичность',
					control: 'select',
					options: opts(
						['NONPERIODICAL', 'Непериодический'],
						['RECORDER_POSITION', 'По позиции регистратора'],
						['SECOND', 'В пределах секунды'],
						['DAY', 'В пределах дня'],
						['MONTH', 'В пределах месяца'],
						['QUARTER', 'В пределах квартала'],
						['YEAR', 'В пределах года']
					),
				},
				{
					path: 'register.writeMode',
					label: 'Режим записи',
					control: 'select',
					options: opts(['INDEPENDENT', 'Независимый'], ['RECORDER_SUBORDINATE', 'Подчинение регистратору']),
				},
				{ path: 'register.mainFilterOnPeriod', label: 'Основной отбор по периоду', control: 'check' },
				{ path: 'register.enableTotalsSliceFirst', label: 'Разрешить итоги: срез первых', control: 'check' },
				{ path: 'register.enableTotalsSliceLast', label: 'Разрешить итоги: срез последних', control: 'check' },
				{ path: 'register.dataHistory', label: 'История данных', control: 'select', options: USE_DONT_USE },
				{
					path: 'register.updateDataHistoryImmediatelyAfterWrite',
					label: 'Обновлять историю данных сразу после записи',
					control: 'check',
					enabledWhen: [{ path: 'register.dataHistory', equals: 'USE' }],
				},
				{
					path: 'register.executeAfterWriteDataHistoryVersionProcessing',
					label: 'Выполнять обработку версий истории данных после записи',
					control: 'check',
					enabledWhen: [{ path: 'register.dataHistory', equals: 'USE' }],
				},
			]
		: [
				{
					path: 'register.registerType',
					label: 'Вид регистра',
					control: 'select',
					options: opts(['BALANCE', 'Остатки'], ['TURNOVERS', 'Обороты']),
				},
				{ path: 'register.enableTotalsSplitting', label: 'Разделение итогов', control: 'check' },
			];
	return withReferenceCommon(
		[
		{
			id: 'edit_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text' },
						{ path: 'comment', label: 'Комментарий', control: 'text' },
						{ path: 'recordSet', label: 'Модуль набора записей', control: 'moduleLink' },
						{ path: 'manager', label: 'Модуль менеджера', control: 'moduleLink' },
					],
				},
				{
					title: 'Представление',
					fields: [
						...(input.information
							? [
									{ path: 'register.recordPresentationRu', label: 'Представление записи', control: 'text' as const },
									{
										path: 'register.extendedRecordPresentationRu',
										label: 'Расширенное представление записи',
										control: 'text' as const,
									},
								]
							: []),
						{ path: 'register.listPresentationRu', label: 'Представление списка', control: 'text' },
						{
							path: 'register.extendedListPresentationRu',
							label: 'Расширенное представление списка',
							control: 'text',
						},
						{ path: 'register.explanationRu', label: 'Пояснение', control: 'textarea' },
					],
				},
				{
					title: 'Прочее',
					fields: [
						{
							path: 'register.dataLockControlMode',
							label: 'Режим управления блокировкой данных',
							control: 'select',
							options: DATA_LOCK_CONTROL_MODE,
						},
						{
							path: 'register.fullTextSearch',
							label: 'Полнотекстовый поиск',
							control: 'select',
							options: USE_DONT_USE,
						},
						{ path: 'register.includeHelpInContents', label: 'Включать в содержание справки', control: 'check' },
					],
				},
			],
		},
		{
			id: 'edit_data',
			title: 'Данные',
			groups: [{ title: input.information ? 'Данные' : 'Итоги', fields: dataFields }],
		},
		{
			id: 'edit_forms',
			title: 'Формы',
			groups: [
				{
					title: 'Основные формы',
					fields: [
						...(input.information
							? [
									{
										path: 'register.defaultRecordForm',
										label: 'Основная форма записи',
										control: 'select' as const,
										options: forms,
										clearable: true,
									},
								]
							: []),
						{
							path: 'register.defaultListForm',
							label: 'Основная форма списка',
							control: 'select',
							options: forms,
							clearable: true,
						},
					],
				},
				{
					title: 'Формы',
					fields: [{ path: '', label: 'Формы объекта', control: 'staticList', items: input.formNames }],
				},
			],
		},
		{
			id: 'edit_commands',
			title: 'Команды',
			groups: [
				{
					title: 'Команды',
					fields: [
						{ path: 'register.useStandardCommands', label: 'Использовать стандартные команды', control: 'check' },
					],
				},
			],
		},
		],
		{
			block: 'register',
			forms: forms,
			auxiliaryForms: input.information ? ['record', 'list'] : ['list'],
			dataHistory: input.information,
		}
	);
}

function isEditableField(field: MetadataEditField): boolean {
	return !field.readonly && field.control !== 'staticList' && field.control !== 'moduleLink' && field.path.length > 0;
}

function readPath(source: unknown, dotPath: string): unknown {
	let current: unknown = source;
	for (const part of dotPath.split('.')) {
		if (typeof current !== 'object' || current === null) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function writePath(target: Record<string, unknown>, dotPath: string, value: unknown): void {
	const parts = dotPath.split('.');
	let current: Record<string, unknown> = target;
	for (const part of parts.slice(0, -1)) {
		const next = current[part];
		if (typeof next !== 'object' || next === null) {
			return;
		}
		current = next as Record<string, unknown>;
	}
	current[parts.at(-1) as string] = value;
}

function normalizeRefList(
	field: MetadataEditField,
	value: unknown,
	currentValue: unknown
): { ok: boolean; value?: unknown } {
	if (!Array.isArray(value)) {
		return { ok: false };
	}
	const allowed = new Set<string>((field.options ?? []).map((option) => option.value));
	if (Array.isArray(currentValue)) {
		for (const item of currentValue) {
			if (typeof item === 'string') {
				allowed.add(item);
			}
		}
	}
	const out: string[] = [];
	for (const item of value) {
		if (typeof item === 'string' && allowed.has(item) && !out.includes(item)) {
			out.push(item);
		}
	}
	return { ok: true, value: out };
}

function normalizeFieldValue(
	field: MetadataEditField,
	value: unknown,
	rawValue: unknown
): { ok: boolean; value?: unknown } {
	switch (field.control) {
		case 'check':
			return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
		case 'number': {
			if (typeof value !== 'string' && typeof value !== 'number') {
				return { ok: false };
			}
			const text = String(value).trim();
			return /^\d+$/.test(text) ? { ok: true, value: text } : { ok: false };
		}
		case 'select': {
			if (value === null || value === '') {
				if (field.clearable) {
					// Пустой выбор очищаемого поля: если на диске значение было — пишем пустым, иначе не трогаем.
					const rawEmpty = rawValue === null || rawValue === undefined || rawValue === '';
					return { ok: true, value: rawEmpty ? (rawValue ?? null) : '' };
				}
				return { ok: true, value: null };
			}
			if (typeof value !== 'string') {
				return { ok: false };
			}
			const known = field.options?.some((option) => option.value === value) ?? false;
			return known ? { ok: true, value } : { ok: false };
		}
		case 'text':
		case 'textarea':
			return typeof value === 'string' ? { ok: true, value } : { ok: false };
		case 'type':
			return normalizeTypeValue(value, rawValue);
		default:
			return { ok: false };
	}
}

/**
 * Описание типа из webview: правим только примитивные типы с квалификаторами.
 * Ссылочный и составной тип отдаём как есть с диска — их правит пикер типов.
 */
function normalizeTypeValue(value: unknown, rawValue: unknown): { ok: boolean; value?: unknown } {
	if (!isRecord(value) || !Array.isArray(value.types)) {
		return { ok: false };
	}
	const types = value.types.filter((item): item is string => typeof item === 'string');
	if (types.length !== 1) {
		// Составной тип из панели не собираем: оставляем то, что на диске.
		return { ok: false };
	}
	const type = types[0];
	if (!PRIMITIVE_TYPES.some((option) => option.value === type)) {
		return { ok: false };
	}
	const rawTypes = isRecord(rawValue) && Array.isArray(rawValue.types) ? rawValue.types : [];
	const rawIsSinglePrimitive =
		rawTypes.length === 1 && PRIMITIVE_TYPES.some((option) => option.value === rawTypes[0]);
	if (!rawIsSinglePrimitive) {
		// На диске ссылочный или составной тип: панель их только показывает.
		return { ok: false };
	}
	const typeKept = rawTypes[0] === type;
	const next: Record<string, unknown> = { types: [type] };
	const stringQualifiers = normalizeQualifiers(value.stringQualifiers, {
		length: 'number',
		allowedLength: ['VARIABLE', 'FIXED'],
	});
	const numberQualifiers = normalizeQualifiers(value.numberQualifiers, {
		digits: 'number',
		fractionDigits: 'number',
		allowedSign: ['ANY', 'NONNEGATIVE'],
	});
	const dateQualifiers = normalizeQualifiers(value.dateQualifiers, {
		dateFractions: ['DATE', 'TIME', 'DATE_TIME'],
	});
	if (type === 'xs:string' && stringQualifiers) {
		next.stringQualifiers = stringQualifiers;
	} else if (type === 'xs:decimal' && numberQualifiers) {
		next.numberQualifiers = numberQualifiers;
	} else if (type === 'xs:dateTime' && dateQualifiers) {
		next.dateQualifiers = dateQualifiers;
	} else if (typeKept && isRecord(rawValue)) {
		// Тип не меняли, а квалификаторы webview не прислал — оставляем прочитанные.
		copyQualifiers(rawValue, next);
	}
	return { ok: true, value: next };
}

const QUALIFIER_KEYS = ['stringQualifiers', 'numberQualifiers', 'dateQualifiers', 'binaryDataQualifiers'] as const;

function copyQualifiers(from: Record<string, unknown>, to: Record<string, unknown>): void {
	for (const key of QUALIFIER_KEYS) {
		if (from[key] !== undefined && from[key] !== null) {
			to[key] = from[key];
		}
	}
}

/** @param shape поле → `'number'` (цифры) либо список допустимых значений */
function normalizeQualifiers(
	value: unknown,
	shape: Record<string, 'number' | readonly string[]>
): Record<string, string> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const [key, rule] of Object.entries(shape)) {
		const raw = value[key];
		if (typeof raw !== 'string' && typeof raw !== 'number') {
			return undefined;
		}
		const text = String(raw).trim();
		if (rule === 'number') {
			if (!/^\d+$/.test(text)) {
				return undefined;
			}
		} else if (!rule.includes(text)) {
			return undefined;
		}
		out[key] = text;
	}
	return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Канон раскладки: на какой вкладке живёт группа свойств. Порядок записей задаёт порядок вкладок,
 * порядок групп внутри записи - порядок групп на вкладке. Раскладку решает эта таблица, а не
 * построитель вида: иначе у каждого вида она разъезжается.
 */
const TAB_LAYOUT: ReadonlyArray<{ id: string; title: string; groups: readonly string[] }> = [
	{
		id: 'edit_main',
		title: 'Основные',
		groups: ['Основные', 'Контекст исполнения', 'Представление', 'Модули', 'Прочее'],
	},
	{
		id: 'edit_data',
		title: 'Данные',
		groups: [
			'Код и наименование',
			'Номер и наименование',
			'Представление значения',
			'Иерархия',
			'Владельцы',
			'Нумерация',
			'Данные',
			'Итоги',
			'Поле ввода',
			'Блокировка и история',
			// Разделы состава: единая форма видов без спеки кладёт их сюда же,
			// куда их кладут спеки - реквизиты и табличные части живут на «Данных»
			'Реквизиты',
			'Табличные части',
			'Измерения',
			'Ресурсы',
			'Значения',
			'Графы',
			'Признаки учёта',
			'Признаки учёта субконто',
			'Операции',
			'Шаблоны URL',
			'Каналы',
			'Таблицы',
			'Кубы',
			'Функции',
		],
	},
	{ id: 'edit_addressing', title: 'Адресация', groups: ['Адресация', 'Реквизиты адресации'] },
	{ id: 'edit_composition', title: 'Компоновка', groups: ['Компоновка'] },
	{ id: 'edit_subconto', title: 'Субконто', groups: ['Субконто'] },
	{ id: 'edit_calculation', title: 'Расчёт', groups: ['Расчёт', 'Перерасчёты'] },
	{ id: 'edit_movements', title: 'Движения', groups: ['Проведение', 'Движения'] },
	{ id: 'edit_registered', title: 'Регистрируемые документы', groups: ['Регистрируемые документы'] },
	{ id: 'edit_exchange', title: 'Обмен данными', groups: ['Обмен данными'] },
	{ id: 'edit_forms', title: 'Формы', groups: ['Основные формы', 'Вспомогательные формы', 'Формы'] },
	{ id: 'edit_commands', title: 'Команды', groups: ['Команды'] },
	{ id: 'edit_templates', title: 'Макеты', groups: ['Макеты'] },
	{ id: 'edit_basedon', title: 'Ввод на основании', groups: ['Ввод на основании'] },
];

/** Заголовки групп, которые знает канон раскладки: по ним группы расходятся по вкладкам. */
export const KNOWN_GROUP_TITLES: readonly string[] = TAB_LAYOUT.flatMap((tab) => tab.groups);

/** Канонический порядок вкладок: по нему панель вставляет недостающие вкладки состава. */
export const TAB_ORDER: ReadonlyArray<{ id: string; title: string }> = TAB_LAYOUT.map((tab) => ({
	id: tab.id,
	title: tab.title,
}));

/**
 * Свойства, место которым канон назначает сам: у разных видов они лежали кто где, хотя означают
 * одно и то же. Ссылки на модули собираются так же - по типу поля, а не по названию группы.
 */
const PROPERTY_GROUP: Readonly<Record<string, string>> = {
	dataLockFields: 'Блокировка и история',
	dataLockControlMode: 'Блокировка и история',
	fullTextSearch: 'Блокировка и история',
	dataHistory: 'Блокировка и история',
	updateDataHistoryImmediatelyAfterWrite: 'Блокировка и история',
	executeAfterWriteDataHistoryVersionProcessing: 'Блокировка и история',
	basedOn: 'Ввод на основании',
	quickChoice: 'Поле ввода',
	choiceMode: 'Поле ввода',
	createOnInput: 'Поле ввода',
	inputByString: 'Поле ввода',
	searchStringModeOnInputByString: 'Поле ввода',
	fullTextSearchOnInputByString: 'Поле ввода',
	choiceDataGetModeOnInputByString: 'Поле ввода',
	auxiliaryObjectForm: 'Вспомогательные формы',
	auxiliaryFolderForm: 'Вспомогательные формы',
	auxiliaryListForm: 'Вспомогательные формы',
	auxiliaryChoiceForm: 'Вспомогательные формы',
	auxiliaryFolderChoiceForm: 'Вспомогательные формы',
	auxiliaryRecordForm: 'Вспомогательные формы',
	auxiliaryForm: 'Вспомогательные формы',
	auxiliarySettingsForm: 'Вспомогательные формы',
	auxiliaryVariantForm: 'Вспомогательные формы',
	choiceHistoryOnInput: 'Поле ввода',
	includeHelpInContents: 'Прочее',
	additionalIndexes: 'Прочее',
	predefinedDataUpdate: 'Прочее',
};

/**
 * Порядок свойств внутри группы: вид объявляет их в своём порядке, а видно должно быть одно и то же
 * у всех. Свойства вне списка идут следом, сохраняя порядок объявления.
 */
const GROUP_FIELD_ORDER: Readonly<Record<string, readonly string[]>> = {
	'Поле ввода': [
		'quickChoice',
		'choiceMode',
		'createOnInput',
		'inputByString',
		'searchStringModeOnInputByString',
		'fullTextSearchOnInputByString',
		'choiceDataGetModeOnInputByString',
		'choiceHistoryOnInput',
	],
	'Блокировка и история': [
		'dataLockFields',
		'dataLockControlMode',
		'fullTextSearch',
		'dataHistory',
		'updateDataHistoryImmediatelyAfterWrite',
		'executeAfterWriteDataHistoryVersionProcessing',
	],
	'Вспомогательные формы': [
		'auxiliaryObjectForm',
		'auxiliaryFolderForm',
		'auxiliaryListForm',
		'auxiliaryChoiceForm',
		'auxiliaryFolderChoiceForm',
		'auxiliaryRecordForm',
		'auxiliaryForm',
		'auxiliarySettingsForm',
		'auxiliaryVariantForm',
	],
	'Основные формы': [
		'defaultObjectForm',
		'defaultFolderForm',
		'defaultListForm',
		'defaultChoiceForm',
		'defaultFolderChoiceForm',
		'defaultRecordForm',
		'defaultForm',
		'defaultSettingsForm',
		'defaultVariantForm',
		'auxiliaryObjectForm',
		'auxiliaryFolderForm',
		'auxiliaryListForm',
		'auxiliaryChoiceForm',
		'auxiliaryFolderChoiceForm',
		'auxiliaryRecordForm',
		'auxiliaryForm',
		'auxiliarySettingsForm',
		'auxiliaryVariantForm',
	],
	Прочее: ['predefinedDataUpdate', 'includeHelpInContents', 'additionalIndexes'],
};

const MODULES_GROUP = 'Модули';

/** Свойство поля: последний сегмент пути (`catalog.codeSeries` → `codeSeries`). */
function propertyOf(field: MetadataEditField): string {
	return field.path.slice(field.path.lastIndexOf('.') + 1);
}

function orderGroupFields(title: string, fields: readonly MetadataEditField[]): MetadataEditField[] {
	const order = GROUP_FIELD_ORDER[title];
	if (!order) {
		return [...fields];
	}
	const rank = (field: MetadataEditField): number => {
		const index = order.indexOf(propertyOf(field));
		return index === -1 ? order.length : index;
	};
	return fields
		.map((field, index) => ({ field, index }))
		.sort((a, b) => rank(a.field) - rank(b.field) || a.index - b.index)
		.map((item) => item.field);
}

/** Группа, которую канон назначает полю, или undefined - тогда поле остаётся в своей группе. */
function canonicalGroup(field: MetadataEditField): string | undefined {
	if (field.control === 'moduleLink') {
		return MODULES_GROUP;
	}
	return PROPERTY_GROUP[propertyOf(field)];
}

/**
 * Расставляет группы по вкладкам канона: набор и порядок вкладок у всех видов одинаковые,
 * пустые вкладки не показываются. Ссылки на модули собираются в одну группу - у каждого вида
 * они лежали в разных местах.
 */
export function normalizeTabLayout(tabs: readonly MetadataEditTabSpec[]): MetadataEditTabSpec[] {
	const byTitle = new Map<string, MetadataEditField[]>();
	const seen = new Set<string>();
	const put = (title: string, field: MetadataEditField): void => {
		// Одно свойство - одно поле: вид мог объявить его сам, а общий набор объявляет ещё раз.
		if (field.path.length > 0) {
			if (seen.has(field.path)) {
				return;
			}
			seen.add(field.path);
		}
		const fields = byTitle.get(title) ?? [];
		fields.push(field);
		byTitle.set(title, fields);
	};
	for (const tab of tabs) {
		for (const group of tab.groups) {
			for (const field of group.fields) {
				put(canonicalGroup(field) ?? group.title, field);
			}
		}
	}

	const out: MetadataEditTabSpec[] = [];
	for (const tab of TAB_LAYOUT) {
		const groups: MetadataEditGroup[] = [];
		for (const title of tab.groups) {
			const fields = byTitle.get(title);
			if (fields && fields.length > 0) {
				groups.push({ title, fields: orderGroupFields(title, fields) });
				byTitle.delete(title);
			}
		}
		if (groups.length > 0) {
			out.push({ id: tab.id, title: tab.title, groups });
		}
	}
	// Группа, которой в каноне нет, остаётся на «Основных»: потерять свойства хуже, чем показать
	// их не на своём месте. Что такие группы не заводятся, следит тест на заголовки групп.
	const unknown = [...byTitle.entries()].filter(([, fields]) => fields.length > 0);
	if (unknown.length > 0) {
		const main = out.find((tab) => tab.id === 'edit_main');
		const groups = unknown.map(([title, fields]) => ({ title, fields }));
		if (main) {
			out[out.indexOf(main)] = { ...main, groups: [...main.groups, ...groups] };
		} else {
			out.unshift({ id: 'edit_main', title: 'Основные', groups });
		}
	}
	return out;
}

/** Допустимые значения перечислимых свойств формата: `catalog.codeSeries` → константы модели. */
export type MetadataEnumDictionary = Readonly<Record<string, readonly string[]>>;

/**
 * Приводит варианты выпадающих списков к словарю формата: список значений задаёт модель,
 * спека даёт им подписи и порядок. Значения, которых в формате нет, из списка уходят: иначе
 * их можно было бы выбрать, а запись упала бы. Значения формата без подписи показываются
 * константой - лучше непривычная подпись, чем недоступное свойство.
 * Свойства вне словаря (ссылки на формы, хранилища и прочее) остаются как в спеке.
 */
/**
 * Подписи значений перечислимых свойств от md-sparrow: общие и у свойств, где значение называется
 * иначе. Своего словаря расширение не держит: он бы разошёлся с форматом.
 */
export interface EnumValueLabels {
	readonly values?: Readonly<Record<string, string>>;
	readonly byProperty?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Подпись значения; без подписи остаётся само значение. */
export function labelOf(labels: EnumValueLabels, property: string, value: string): string {
	return labels.byProperty?.[property]?.[value] ?? labels.values?.[value] ?? value;
}

export function applyEnumDictionary(
	tabs: readonly MetadataEditTabSpec[],
	dictionary: MetadataEnumDictionary,
	labels: EnumValueLabels = {}
): MetadataEditTabSpec[] {
	return tabs.map((tab) => ({
		...tab,
		groups: tab.groups.map((group) => ({
			...group,
			fields: group.fields.map((field) => {
				if (field.control !== 'select') {
					return field;
				}
				const known = dictionary[field.path];
				if (!known) {
					// Варианты приходят от md-sparrow: пока их нет, показываем значение полем ввода,
					// иначе список был бы пустым и свойство не посмотреть.
					return (field.options ?? []).length > 0 ? field : { ...field, control: 'text' as const };
				}
				const fromSpec = (field.options ?? []).filter(
					(option) => option.value === '' || known.includes(option.value)
				);
				const labelled = new Set(fromSpec.map((option) => option.value));
				const rest = known
					.filter((value) => !labelled.has(value))
					.map((value) => ({ value, label: labelOf(labels, field.path, value) }));
				return { ...field, options: [...fromSpec, ...rest] };
			}),
		})),
	}));
}

/**
 * Добавляет вкладку макетов: список в общем стиле панели, а не отдельная таблица поверх остального.
 * Вкладка есть и у объекта без макетов - место состава не должно появляться и исчезать.
 *
 * @param tabs Вкладки вида.
 * @param templateNames Имена макетов объекта.
 */
/** Списки состава по имени раздела: у общего построителя источник - структура объекта. */
export type GenericSectionLists = Partial<Record<MetadataObjectSectionSource, readonly string[]>>;

/**
 * Вкладки для вида без своей спеки.
 *
 * Форма у всех одна: «Основные» с именем, синонимом и комментарием, у видов с
 * формами - вкладка «Формы». Остальной состав вида рисует редактор состава на
 * тех же вкладках, что и у видов со спекой, а вкладку «Макеты» добавляет общая
 * обвязка панели.
 *
 * @param objectType Вид объекта в терминах выгрузки (WebService, CommonForm, …)
 * @param sections Списки имён по разделам из структуры объекта
 */
/** Описание скалярного свойства от md-sparrow: тип значения и допустимые значения. */
export interface ScalarPropertyMeta {
	readonly type: string;
	readonly allowed?: readonly string[];
}

/**
 * Поля скалярных свойств вида без моста.
 *
 * Тип управления задаёт md-sparrow: флажок, число, выпадающий список с
 * константами модели или текст. Группа берётся из канона по имени свойства,
 * незнакомые свойства остаются в «Прочем». Принадлежность объекта наружу не
 * выводится: по ней панель решает, редактировать ли заимствованный объект.
 *
 * @param labelForName Подпись свойства по ключу в нижнем camelCase
 * @param labelForValue Подпись значения перечислимого свойства
 */
export function buildScalarGroups(
	scalars: Readonly<Record<string, unknown>>,
	meta: Readonly<Record<string, ScalarPropertyMeta>>,
	labelForName: (key: string) => string,
	labelForValue: (property: string, value: string) => string,
	refOptions: Readonly<Record<string, readonly MetadataEditOption[]>> = {}
): MetadataEditGroup[] {
	const byGroup = new Map<string, MetadataEditField[]>();
	for (const [name, description] of Object.entries(meta)) {
		if (name === 'ObjectBelonging' || !(name in scalars)) {
			continue;
		}
		const key = name.charAt(0).toLowerCase() + name.slice(1);
		const label = labelForName(key);
		const path = `scalars.${name}`;
		const refs = refOptions[name];
		let field: MetadataEditField;
		if (refs && refs.length > 0) {
			// Ссылка выбирается из кандидатов конфигурации; текущее значение
			// вне списка досыпает общая обвязка
			field = { path, label, control: 'select', options: refs, clearable: true };
		} else if (description.type === 'boolean') {
			field = { path, label, control: 'check' };
		} else if (description.type === 'number') {
			field = { path, label, control: 'number' };
		} else if (description.type === 'enum') {
			field = {
				path,
				label,
				control: 'select',
				options: (description.allowed ?? []).map((value) => ({ value, label: labelForValue(key, value) })),
			};
		} else {
			field = { path, label, control: 'text' };
		}
		const group = PROPERTY_GROUP[key] ?? 'Прочее';
		const fields = byGroup.get(group) ?? [];
		fields.push(field);
		byGroup.set(group, fields);
	}
	return [...byGroup.entries()].map(([title, fields]) => ({ title, fields }));
}

export function buildGenericEditTabs(
	objectType: string,
	sections: GenericSectionLists,
	scalarGroups: readonly MetadataEditGroup[] = []
): MetadataEditTabSpec[] {
	const groups: MetadataEditGroup[] = [
		{
			title: 'Основные',
			fields: [
				{ path: 'internalName', label: 'Имя', control: 'text', readonly: true },
				{ path: 'synonymRu', label: 'Синоним', control: 'text' },
				{ path: 'comment', label: 'Комментарий', control: 'text' },
			],
		},
		...scalarGroups,
	];
	const known = METADATA_OBJECT_SECTION_SOURCES_BY_TYPE[objectType] ?? [];
	if (known.includes('forms')) {
		groups.push({
			title: 'Формы',
			fields: [{ path: '', label: 'Формы объекта', control: 'staticList', items: sections.forms ?? [] }],
		});
	}
	return [{ id: 'edit_main', title: 'Основные', groups }];
}

export function withTemplatesTab(
	tabs: readonly MetadataEditTabSpec[],
	templateNames: readonly string[]
): MetadataEditTabSpec[] {
	return [
		...tabs,
		{
			id: 'edit_templates',
			title: 'Макеты',
			groups: [
				{
					title: 'Макеты',
					fields: [{ path: '', label: 'Макеты объекта', control: 'staticList', items: templateNames }],
				},
			],
		},
	];
}

/**
 * Досыпает в списки выбора значение, которое уже стоит в файле, но в кандидаты не попало
 * (общая форма чужой подсистемы, объект из другой конфигурации, ссылка на удалённый объект).
 * Без этого поле выглядит пустым, хотя значение в файле есть, а выбор соседнего пункта
 * затирает его молча.
 */
export function ensureCurrentSelectValues(
	tabs: readonly MetadataEditTabSpec[],
	props: Record<string, unknown>
): MetadataEditTabSpec[] {
	return tabs.map((tab) => ({
		...tab,
		groups: tab.groups.map((group) => ({
			...group,
			fields: group.fields.map((field) => {
				if (field.control !== 'select' || !field.options) {
					return field;
				}
				const current = readPath(props, field.path);
				if (typeof current !== 'string' || current.length === 0) {
					return field;
				}
				if (field.options.some((option) => option.value === current)) {
					return field;
				}
				const short = current.slice(current.lastIndexOf('.') + 1);
				return { ...field, options: [...field.options, { value: current, label: short, hint: 'из файла' }] };
			}),
		})),
	}));
}

/**
 * Значения спеки, которых нет в словаре формата: панель их не покажет, а разработчику
 * нужно исправить спеку. Пустое значение - это очистка свойства, а не константа.
 */
export function findUnknownEnumValues(
	tabs: readonly MetadataEditTabSpec[],
	dictionary: MetadataEnumDictionary
): string[] {
	const out: string[] = [];
	for (const tab of tabs) {
		for (const group of tab.groups) {
			for (const field of group.fields) {
				const known = dictionary[field.path];
				if (field.control !== 'select' || !known) {
					continue;
				}
				for (const option of field.options ?? []) {
					if (option.value !== '' && !known.includes(option.value)) {
						out.push(`${field.path}: ${option.value}`);
					}
				}
			}
		}
	}
	return out;
}

/**
 * Переносит в глубокую копию rawProps только значения полей, которые спека объявляет редактируемыми.
 * Всё остальное (списки, структура, неизвестные поля) остаётся как на диске — webview им не доверяем.
 */
export function applyEditedScalars(
	rawProps: Record<string, unknown>,
	edited: unknown,
	tabs: readonly MetadataEditTabSpec[]
): Record<string, unknown> {
	const result = structuredClone(rawProps);
	if (typeof edited !== 'object' || edited === null) {
		return result;
	}
	for (const tab of tabs) {
		for (const group of tab.groups) {
			for (const field of group.fields) {
				if (!isEditableField(field)) {
					continue;
				}
				const incoming = readPath(edited, field.path);
				if (incoming === undefined) {
					continue;
				}
				const normalized =
					field.control === 'refList'
						? normalizeRefList(field, incoming, readPath(rawProps, field.path))
						: normalizeFieldValue(field, incoming, readPath(rawProps, field.path));
				if (normalized.ok) {
					writePath(result, field.path, normalized.value);
				}
			}
		}
	}
	return result;
}
