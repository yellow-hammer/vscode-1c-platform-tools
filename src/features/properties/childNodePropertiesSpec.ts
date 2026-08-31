/**
 * Свойства дочерних узлов объекта метаданных: реквизитов, табличных частей, значений и прочего.
 *
 * Правится то, что умеет писать `cf-md-object-set`: синоним, комментарий и свойства палитры узла.
 * Тип показывается строкой: пикер составного типа живёт в панели-вкладке.
 *
 * @module childNodePropertiesSpec
 */

import { typeDisplayText } from '../metadata/metadataObjectEditSpec';
import type { MetadataEditField, MetadataEditGroup, MetadataEditTabSpec } from '../metadata/metadataObjectEditSpec';

/** Узел состава в плоском виде: спека работает с ним, а не с местом в массиве DTO. */
export interface ChildNodeDto extends Record<string, unknown> {
	name: string;
	synonymRu?: string;
	comment?: string;
	/** Тип строкой представления: показывается, когда типов несколько. */
	typeText?: string;
	/** Единственный тип: правится списком прямо в палитре. */
	typeSingle?: string;
	/** Квалификаторы типа: набор зависит от примитива, у ссылочного их нет. */
	typeLength?: string;
	typeAllowedLength?: string;
	typeDigits?: string;
	typeFractionDigits?: string;
	typeAllowedSign?: string;
	typeDateFractions?: string;
	toolTipRu?: string;
	fillChecking?: string;
	indexing?: string;
	fullTextSearch?: string;
	dataHistory?: string;
	use?: string;
	quickChoice?: string;
	createOnInput?: string;
	choiceHistoryOnInput?: string;
	choiceForm?: string;
	/** Параметры выбора строкой: значение типизировано, поэтому только показ. */
	choiceParametersText?: string;
	/** Связи параметров выбора строкой: правятся на вкладке объекта. */
	choiceParameterLinksText?: string;
}

/**
 * Свойства палитры узла: их отдаёт md-sparrow, а варианты значений приходят
 * словарём перечислений. Пустое свойство у вида узла, которому оно не положено,
 * в палитру не попадает.
 */
const PALETTE_FIELDS: readonly {
	path: string;
	label: string;
	control: 'text' | 'select';
	readonly?: boolean;
}[] = [
	{ path: 'toolTipRu', label: 'Подсказка', control: 'text' },
	{ path: 'fillChecking', label: 'Проверка заполнения', control: 'select' },
	{ path: 'indexing', label: 'Индексирование', control: 'select' },
	{ path: 'fullTextSearch', label: 'Полнотекстовый поиск', control: 'select' },
	{ path: 'dataHistory', label: 'История данных', control: 'select' },
	{ path: 'use', label: 'Использование', control: 'select' },
	{ path: 'quickChoice', label: 'Быстрый выбор', control: 'select' },
	{ path: 'createOnInput', label: 'Создание при вводе', control: 'select' },
	{ path: 'choiceHistoryOnInput', label: 'История выбора при вводе', control: 'select' },
	{ path: 'choiceForm', label: 'Форма выбора', control: 'text' },
	{ path: 'choiceParametersText', label: 'Параметры выбора', control: 'text', readonly: true },
	{ path: 'choiceParameterLinksText', label: 'Связи параметров выбора', control: 'text', readonly: true },
];

/** Свойства палитры, которые узел этого вида действительно несёт. */
export function childNodePaletteFields(node: ChildNodeDto | undefined): readonly string[] {
	if (!node) {
		return [];
	}
	return PALETTE_FIELDS.filter((field) => {
		const value = node[field.path];
		return typeof value === 'string' && value !== '';
	}).map((field) => field.path);
}

/**
 * Поле DTO объекта, в котором лежит узел этого вида.
 *
 * Список полный: md-sparrow читает свойства у всех видов состава. Реквизит
 * табличной части лежит внутри своей части, поэтому у него своего поля нет -
 * его ищет {@link findChildNode} по имени части.
 */
const DTO_LIST_BY_NODE_KIND: Readonly<Record<string, string>> = {
	attribute: 'attributes',
	tabularSection: 'tabularSections',
	value: 'enumValues',
	dimension: 'dimensions',
	resource: 'resources',
	command: 'commands',
	column: 'columns',
	accountingFlag: 'accountingFlags',
	extDimensionAccountingFlag: 'extDimensionAccountingFlags',
	addressingAttribute: 'addressingAttributes',
	recalculation: 'recalculations',
	operation: 'operations',
	urlTemplate: 'urlTemplates',
	channel: 'channels',
	table: 'tables',
	cube: 'cubes',
	function: 'functions',
};

/** Название вида узла для подзаголовка палитры. */
const NODE_KIND_LABEL: Readonly<Record<string, string>> = {
	attribute: 'Реквизит',
	tabularSection: 'Табличная часть',
	tabularAttribute: 'Реквизит табличной части',
	value: 'Значение перечисления',
	dimension: 'Измерение',
	resource: 'Ресурс',
	form: 'Форма',
	command: 'Команда',
	template: 'Макет',
	addressingAttribute: 'Реквизит адресации',
	accountingFlag: 'Признак учёта',
	extDimensionAccountingFlag: 'Признак учёта субконто',
	recalculation: 'Перерасчёт',
	column: 'Колонка',
	operation: 'Операция',
	urlTemplate: 'Шаблон URL',
	channel: 'Канал',
	table: 'Таблица',
	cube: 'Куб',
	function: 'Функция',
};

export function childNodeKindLabel(nodeKind: string): string {
	return NODE_KIND_LABEL[nodeKind] ?? nodeKind;
}

/** Список DTO объекта, в котором живёт узел; пусто - палитра его только показывает. */
export function childNodeDtoList(nodeKind: string): string | undefined {
	return DTO_LIST_BY_NODE_KIND[nodeKind];
}

/**
 * Спека узла состава.
 *
 * @param editable Узел лежит в списке, который умеет писать `cf-md-object-set`.
 */
export function childNodeTabs(
	editable: boolean,
	node?: ChildNodeDto,
	typeOptions: readonly { value: string; label: string; hint?: string }[] = []
): readonly MetadataEditTabSpec[] {
	// У вида узла, которого нет в свойствах объекта, читается только имя: пустые
	// «Синоним» и «Тип» выглядели бы как потерянные значения
	if (!editable) {
		return [
			{
				id: 'child_main',
				title: 'Основные',
				groups: [
					{ title: 'Основные', fields: [{ path: 'name', label: 'Имя', control: 'text' as const, readonly: true }] },
				],
			},
		];
	}

	const present = new Set(childNodePaletteFields(node));
	const main: MetadataEditField[] = [
		{ path: 'name', label: 'Имя', control: 'text' as const, readonly: true },
		{ path: 'synonymRu', label: 'Синоним', control: 'text' as const },
		{ path: 'comment', label: 'Комментарий', control: 'text' as const },
	];
	if (node?.typeSingle !== undefined) {
		// Кандидаты приходят от md-sparrow; без них список был бы пустым, и тип не посмотреть
		main.push(
			typeOptions.length > 0
				? { path: 'typeSingle', label: 'Тип', control: 'select' as const, options: typeOptions, rebuilds: true }
				: { path: 'typeSingle', label: 'Тип', control: 'text' as const, readonly: true }
		);
		main.push(...qualifierFields(node.typeSingle));
	} else if (node?.typeText !== undefined) {
		main.push({ path: 'typeText', label: 'Тип', control: 'text' as const, readonly: true });
	}
	const groups: MetadataEditGroup[] = [{ title: 'Основные', fields: main }];
	const palette = PALETTE_FIELDS.filter((field) => present.has(field.path)).map((field) => ({
		path: field.path,
		label: field.label,
		control: field.control,
		...(field.readonly ? { readonly: true } : {}),
	}));
	if (palette.length > 0) {
		groups.push({ title: 'Использование', fields: palette });
	}
	return [{ id: 'child_main', title: 'Основные', groups }];
}


/** Узел из DTO объекта по имени. */
export function findChildNode(
	objectDto: Record<string, unknown>,
	listName: string,
	name: string,
	kindLabels: Readonly<Record<string, string>> = {}
): ChildNodeDto | undefined {
	return nodeFrom(objectDto[listName], name, kindLabels);
}

/**
 * Реквизит табличной части: он лежит внутри своей части, а не отдельным списком.
 *
 * @param objectDto Свойства объекта
 * @param tabularSection Имя табличной части
 * @param name Имя реквизита
 */
export function findTabularAttribute(
	objectDto: Record<string, unknown>,
	tabularSection: string,
	name: string,
	kindLabels: Readonly<Record<string, string>> = {}
): ChildNodeDto | undefined {
	const sections = objectDto.tabularSections;
	if (!Array.isArray(sections)) {
		return undefined;
	}
	const section = sections.find((item) => (item as { name?: string }).name === tabularSection) as
		| Record<string, unknown>
		| undefined;
	return section ? nodeFrom(section.attributes, name, kindLabels) : undefined;
}

function nodeFrom(
	list: unknown,
	name: string,
	kindLabels: Readonly<Record<string, string>>
): ChildNodeDto | undefined {
	if (!Array.isArray(list)) {
		return undefined;
	}
	const found = list.find((item) => (item as { name?: string }).name === name) as Record<string, unknown> | undefined;
	if (!found) {
		return undefined;
	}
	const types = typeList(found.type);
	const node: ChildNodeDto = {
		name,
		synonymRu: typeof found.synonymRu === 'string' ? found.synonymRu : '',
		comment: typeof found.comment === 'string' ? found.comment : '',
	};
	// Один тип правится списком, составной показывается строкой: список его не выражает
	if (types.length === 1) {
		node.typeSingle = types[0];
		readQualifiers(found.type, node);
	} else if (types.length > 1) {
		node.typeText = typeText(found.type, kindLabels);
	}
	for (const field of PALETTE_FIELDS) {
		const value = found[field.path];
		if (typeof value === 'string' && value !== '') {
			node[field.path] = value;
		}
	}
	const parameters = choiceParametersText(found.choiceParameters);
	if (parameters) {
		node.choiceParametersText = parameters;
	}
	const links = choiceParameterLinksText(found.choiceParameterLinks);
	if (links) {
		node.choiceParameterLinksText = links;
	}
	return node;
}

/** Параметры выбора строкой: «имя = значение» через точку с запятой. */
function choiceParametersText(value: unknown): string {
	if (!Array.isArray(value)) {
		return '';
	}
	return value
		.map((item) => {
			const record = item as { name?: unknown; valueText?: unknown };
			const name = typeof record.name === 'string' ? record.name : '';
			const text = typeof record.valueText === 'string' ? valueText(record.valueText) : '';
			return text ? `${name} = ${text}` : name;
		})
		.filter((text) => text !== '')
		.join('; ');
}

/** Значение параметра: булево платформа показывает словами, а не true и false. */
function valueText(value: string): string {
	if (value === 'true') {
		return 'Истина';
	}
	if (value === 'false') {
		return 'Ложь';
	}
	return value;
}

/**
 * Путь к данным без служебных сегментов вида: в XML он записан как
 * `Catalog.Номенклатура.Attribute.Склад`, человеку нужен `Номенклатура.Склад`.
 */
function dataPathText(path: string): string {
	const parts = path.split('.');
	if (parts.length < 2) {
		return path;
	}
	// Сегменты чередуются «вид, имя»: оставляем имена
	return parts.filter((_, index) => index % 2 === 1).join('.') || path;
}

/** Связи параметров выбора строкой: «имя ← путь к данным». */
function choiceParameterLinksText(value: unknown): string {
	if (!Array.isArray(value)) {
		return '';
	}
	return value
		.map((item) => {
			const record = item as { name?: unknown; dataPath?: unknown };
			const name = typeof record.name === 'string' ? record.name : '';
			const dataPath = typeof record.dataPath === 'string' ? dataPathText(record.dataPath) : '';
			return dataPath ? `${name} ← ${dataPath}` : name;
		})
		.filter((text) => text !== '')
		.join('; ');
}

/**
 * Тип реквизита строкой: примитивы по-русски, ссылочные видом и именем.
 *
 * Подписи видов приходят от md-sparrow, поэтому в палитру не попадает служебное
 * `cfg:CatalogRef.…` - для человека это шум.
 */
function typeText(type: unknown, kindLabels: Readonly<Record<string, string>>): string | undefined {
	const types = typeList(type);
	if (types.length === 0) {
		return undefined;
	}
	return types.map((item) => typeDisplayText(item, kindLabels)).join(', ');
}

/** Квалификаторы примитива в плоские поля палитры: у платформы они лежат рядом с типом. */
function readQualifiers(type: unknown, node: ChildNodeDto): void {
	const record = (type ?? {}) as Record<string, unknown>;
	const str = record.stringQualifiers as { length?: unknown; allowedLength?: unknown } | undefined;
	if (str) {
		node.typeLength = str.length === undefined || str.length === null ? '' : String(str.length);
		node.typeAllowedLength = typeof str.allowedLength === 'string' ? str.allowedLength : '';
	}
	const num = record.numberQualifiers as
		| { digits?: unknown; fractionDigits?: unknown; allowedSign?: unknown }
		| undefined;
	if (num) {
		node.typeDigits = num.digits === undefined || num.digits === null ? '' : String(num.digits);
		node.typeFractionDigits =
			num.fractionDigits === undefined || num.fractionDigits === null ? '' : String(num.fractionDigits);
		node.typeAllowedSign = typeof num.allowedSign === 'string' ? num.allowedSign : '';
	}
	const date = record.dateQualifiers as { dateFractions?: unknown } | undefined;
	if (date) {
		node.typeDateFractions = typeof date.dateFractions === 'string' ? date.dateFractions : '';
	}
}

/** Поля квалификаторов по выбранному примитиву: у ссылочного типа их не бывает. */
function qualifierFields(type: string | undefined): MetadataEditField[] {
	if (type === 'xs:string') {
		return [
			{ path: 'typeLength', label: 'Длина', control: 'number' },
			{
				path: 'typeAllowedLength',
				label: 'Допустимая длина',
				control: 'select',
				options: [
					{ value: 'VARIABLE', label: 'Переменная' },
					{ value: 'FIXED', label: 'Фиксированная' },
				],
			},
		];
	}
	if (type === 'xs:decimal') {
		return [
			{ path: 'typeDigits', label: 'Длина', control: 'number' },
			{ path: 'typeFractionDigits', label: 'Точность', control: 'number' },
			{
				path: 'typeAllowedSign',
				label: 'Неотрицательное',
				control: 'select',
				options: [
					{ value: 'ANY', label: 'Любой знак' },
					{ value: 'NONNEGATIVE', label: 'Неотрицательное' },
				],
			},
		];
	}
	if (type === 'xs:dateTime') {
		return [
			{
				path: 'typeDateFractions',
				label: 'Состав даты',
				control: 'select',
				options: [
					{ value: 'DATE', label: 'Дата' },
					{ value: 'TIME', label: 'Время' },
					{ value: 'DATE_TIME', label: 'Дата и время' },
				],
			},
		];
	}
	return [];
}

/** Типы значения списком. */
function typeList(type: unknown): string[] {
	const types = (type as { types?: unknown })?.types;
	return Array.isArray(types) ? types.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Кладёт правки узла обратно в DTO объекта.
 *
 * @returns Копия DTO объекта с изменённым узлом либо {@code undefined}, если узла в списке нет.
 */
export function applyChildNodeEdits(
	objectDto: Record<string, unknown>,
	listName: string,
	name: string,
	edits: Readonly<Record<string, string>>
): Record<string, unknown> | undefined {
	const next = structuredClone(objectDto);
	const list = next[listName];
	if (!Array.isArray(list)) {
		return undefined;
	}
	const found = list.find((item) => (item as { name?: string }).name === name) as Record<string, unknown> | undefined;
	if (!found) {
		return undefined;
	}
	const writable = PALETTE_FIELDS.filter((field) => !field.readonly).map((field) => field.path);
	for (const key of ['synonymRu', 'comment', ...writable]) {
		if (edits[key] !== undefined) {
			found[key] = edits[key];
		}
	}
	const currentTypes = typeList(found.type);
	const nextType = edits.typeSingle !== undefined && edits.typeSingle !== '' ? edits.typeSingle : currentTypes[0];
	if (nextType !== undefined) {
		const typeChanged = edits.typeSingle !== undefined && edits.typeSingle !== currentTypes[0];
		found.type = typeChanged
			? typeValue(nextType)
			: withQualifiers(nextType, found.type as Record<string, unknown> | undefined, edits);
	}
	return next;
}

/**
 * Квалификаторы поверх прочитанного типа: правится то, что пришло из палитры,
 * остальное остаётся как в файле.
 */
function withQualifiers(
	type: string,
	current: Record<string, unknown> | undefined,
	edits: Readonly<Record<string, string>>
): Record<string, unknown> {
	const value: Record<string, unknown> = { ...(current ?? {}), types: [type] };
	if (type === 'xs:string') {
		const qualifiers = { ...((value.stringQualifiers as Record<string, unknown>) ?? {}) };
		applyEdit(qualifiers, 'length', edits.typeLength);
		applyEdit(qualifiers, 'allowedLength', edits.typeAllowedLength);
		value.stringQualifiers = qualifiers;
	}
	if (type === 'xs:decimal') {
		const qualifiers = { ...((value.numberQualifiers as Record<string, unknown>) ?? {}) };
		applyEdit(qualifiers, 'digits', edits.typeDigits);
		applyEdit(qualifiers, 'fractionDigits', edits.typeFractionDigits);
		applyEdit(qualifiers, 'allowedSign', edits.typeAllowedSign);
		value.numberQualifiers = qualifiers;
	}
	if (type === 'xs:dateTime') {
		const qualifiers = { ...((value.dateQualifiers as Record<string, unknown>) ?? {}) };
		applyEdit(qualifiers, 'dateFractions', edits.typeDateFractions);
		value.dateQualifiers = qualifiers;
	}
	return value;
}

function applyEdit(target: Record<string, unknown>, key: string, value: string | undefined): void {
	if (value !== undefined) {
		target[key] = value;
	}
}

/** Квалификаторы, которые платформа заводит новому примитиву. */
const DEFAULT_QUALIFIERS: Readonly<Record<string, Record<string, unknown>>> = {
	'xs:string': { stringQualifiers: { length: '10', allowedLength: 'VARIABLE' } },
	'xs:decimal': { numberQualifiers: { digits: '10', fractionDigits: '0', allowedSign: 'ANY' } },
	'xs:dateTime': { dateQualifiers: { dateFractions: 'DATE' } },
};

/** Описание типа из выбранного значения: платформа хранит типы списком. */
function typeValue(type: string): Record<string, unknown> {
	return { types: [type], ...(DEFAULT_QUALIFIERS[type] ?? {}) };
}
