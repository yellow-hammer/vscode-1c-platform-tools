/**
 * Спецификация редактируемых вкладок панели свойств объекта метаданных.
 * Спека — единственный источник правды о том, какие поля DTO можно менять из webview:
 * по ней строится форма и по ней же фильтруются значения при сохранении.
 * Значения enum-свойств — имена Java-констант md-sparrow (`BOTH_WAYS`, `QUICK_CHOICE`).
 * @module metadataObjectEditSpec
 */

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

interface CatalogEditSpecInput {
	internalName: string;
	formNames: readonly string[];
	commandNames: readonly string[];
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

function formOptions(internalName: string, formNames: readonly string[]): MetadataEditOption[] {
	return [
		{ value: '', label: '(не задана)' },
		...formNames.map((name) => ({ value: `Catalog.${internalName}.Form.${name}`, label: name })),
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

function dataLockFieldsOptions(input: CatalogEditSpecInput): MetadataEditOption[] {
	const base = `Catalog.${input.internalName}`;
	const out: MetadataEditOption[] = [
		{ value: `${base}.StandardAttribute.Code`, label: 'Код' },
		{ value: `${base}.StandardAttribute.Description`, label: 'Наименование' },
	];
	if (input.hasOwners) {
		out.push({ value: `${base}.StandardAttribute.Owner`, label: 'Владелец' });
	}
	if (input.hierarchical) {
		out.push({ value: `${base}.StandardAttribute.Parent`, label: 'Родитель' });
	}
	for (const name of input.attributeNames ?? []) {
		out.push({ value: `${base}.Attribute.${name}`, label: name });
	}
	return out;
}

function basedOnOptions(input: CatalogEditSpecInput): MetadataEditOption[] {
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
	const forms = formOptions(input.internalName, input.formNames);
	const owners = ownerOptions(input.internalName, input.catalogNames ?? []);
	const inputByString = inputByStringOptions(input.internalName, input.attributeNames ?? []);
	const dataLockFields = dataLockFieldsOptions(input);
	const basedOn = basedOnOptions(input);
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
							path: 'catalog.editType',
							label: 'Способ редактирования',
							control: 'select',
							options: opts(['IN_DIALOG', 'В диалоге'], ['IN_LIST', 'В списке'], ['BOTH_WAYS', 'Обоими способами']),
						},
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
					title: 'Код',
					fields: [
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
						{ path: '', label: 'Команды объекта', control: 'staticList', items: input.commandNames },
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
	];
}

export interface DocumentEditSpecInput {
	internalName: string;
	formNames: readonly string[];
	commandNames: readonly string[];
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

function documentFormOptions(internalName: string, formNames: readonly string[]): MetadataEditOption[] {
	return [
		{ value: '', label: '(не задана)' },
		...formNames.map((name) => ({ value: `Document.${internalName}.Form.${name}`, label: name })),
	];
}

function documentInputByStringOptions(internalName: string, attributeNames: readonly string[]): MetadataEditOption[] {
	const base = `Document.${internalName}`;
	return [
		{ value: `${base}.StandardAttribute.Number`, label: 'Номер' },
		...attributeNames.map((name) => ({ value: `${base}.Attribute.${name}`, label: name })),
	];
}

function documentDataLockFieldsOptions(input: DocumentEditSpecInput): MetadataEditOption[] {
	const base = `Document.${input.internalName}`;
	return [
		{ value: `${base}.StandardAttribute.Number`, label: 'Номер' },
		{ value: `${base}.StandardAttribute.Date`, label: 'Дата' },
		...(input.attributeNames ?? []).map((name) => ({ value: `${base}.Attribute.${name}`, label: name })),
	];
}

/**
 * Вкладки редактирования документа: раскладка повторяет редактор EDT
 * (Основные, Данные, Движения, Формы, Команды, Ввод на основании).
 */
export function buildDocumentEditTabs(input: DocumentEditSpecInput): MetadataEditTabSpec[] {
	const forms = documentFormOptions(input.internalName, input.formNames);
	const inputByString = documentInputByStringOptions(input.internalName, input.attributeNames ?? []);
	const dataLockFields = documentDataLockFieldsOptions(input);
	const basedOn = basedOnOptions({
		internalName: input.internalName,
		formNames: [],
		commandNames: [],
		catalogNames: input.catalogNames,
		documentNames: input.documentNames,
	});
	const numerators: MetadataEditOption[] = [
		{ value: '', label: '(не задан)' },
		...(input.numeratorNames ?? []).map((name) => ({ value: `DocumentNumerator.${name}`, label: name })),
	];
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
						{ path: '', label: 'Команды объекта', control: 'staticList', items: input.commandNames },
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
	];
}

export interface SimpleObjectEditSpecInput {
	internalName: string;
	formNames: readonly string[];
	commandNames: readonly string[];
}

const CHOICE_HISTORY = opts(['AUTO', 'Авто'], ['DONT_USE', 'Не использовать']);

function enumFormOptions(internalName: string, formNames: readonly string[]): MetadataEditOption[] {
	return [
		{ value: '', label: '(не задана)' },
		...formNames.map((name) => ({ value: `Enum.${internalName}.Form.${name}`, label: name })),
	];
}

/**
 * Вкладки редактирования перечисления: раскладка повторяет редактор EDT.
 * Значения перечисления правятся отдельно.
 */
export function buildEnumEditTabs(input: SimpleObjectEditSpecInput): MetadataEditTabSpec[] {
	const forms = enumFormOptions(input.internalName, input.formNames);
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
						{ path: '', label: 'Команды объекта', control: 'staticList', items: input.commandNames },
					],
				},
			],
		},
	];
}

function constantFormOptions(internalName: string, formNames: readonly string[]): MetadataEditOption[] {
	return [
		{ value: '', label: '(не задана)' },
		...formNames.map((name) => ({ value: `Constant.${internalName}.Form.${name}`, label: name })),
	];
}

/**
 * Вкладки редактирования константы: раскладка повторяет редактор EDT.
 * Тип значения правится палитрой типов.
 */
export function buildConstantEditTabs(input: SimpleObjectEditSpecInput): MetadataEditTabSpec[] {
	const forms = constantFormOptions(input.internalName, input.formNames);
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
						{ path: '', label: 'Команды объекта', control: 'staticList', items: input.commandNames },
					],
				},
			],
		},
	];
}

/**
 * Вкладки редактирования общего модуля: контекст исполнения одной группой, как в EDT.
 */
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
