/**
 * Свойства дочерних узлов объекта метаданных: реквизитов, табличных частей, значений и прочего.
 *
 * Правится то, что умеет писать `cf-md-object-set`: синоним и комментарий. Тип и остальные свойства
 * реквизита показываются, но не редактируются - для них нужна работа в модели md-sparrow.
 *
 * @module childNodePropertiesSpec
 */

import type { MetadataEditTabSpec } from '../metadata/metadataObjectEditSpec';

/** Узел состава в плоском виде: спека работает с ним, а не с местом в массиве DTO. */
export interface ChildNodeDto extends Record<string, unknown> {
	name: string;
	synonymRu?: string;
	comment?: string;
	/** Тип реквизита строкой представления: правка типов идёт в панели-вкладке. */
	typeText?: string;
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
export function childNodeTabs(editable: boolean): readonly MetadataEditTabSpec[] {
	// У вида узла, которого нет в свойствах объекта, читается только имя: пустые
	// «Синоним» и «Тип» выглядели бы как потерянные значения
	const fields = editable
		? [
				{ path: 'name', label: 'Имя', control: 'text' as const, readonly: true },
				{ path: 'synonymRu', label: 'Синоним', control: 'text' as const },
				{ path: 'comment', label: 'Комментарий', control: 'text' as const },
				{ path: 'typeText', label: 'Тип', control: 'text' as const, readonly: true },
			]
		: [{ path: 'name', label: 'Имя', control: 'text' as const, readonly: true }];
	return [
		{
			id: 'child_main',
			title: 'Основные',
			groups: [{ title: 'Основные', fields }],
		},
	];
}


/** Узел из DTO объекта по имени. */
export function findChildNode(
	objectDto: Record<string, unknown>,
	listName: string,
	name: string
): ChildNodeDto | undefined {
	return nodeFrom(objectDto[listName], name);
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
	name: string
): ChildNodeDto | undefined {
	const sections = objectDto.tabularSections;
	if (!Array.isArray(sections)) {
		return undefined;
	}
	const section = sections.find((item) => (item as { name?: string }).name === tabularSection) as
		| Record<string, unknown>
		| undefined;
	return section ? nodeFrom(section.attributes, name) : undefined;
}

function nodeFrom(list: unknown, name: string): ChildNodeDto | undefined {
	if (!Array.isArray(list)) {
		return undefined;
	}
	const found = list.find((item) => (item as { name?: string }).name === name) as Record<string, unknown> | undefined;
	if (!found) {
		return undefined;
	}
	return {
		name,
		synonymRu: typeof found.synonymRu === 'string' ? found.synonymRu : '',
		comment: typeof found.comment === 'string' ? found.comment : '',
		typeText: typeText(found.type),
	};
}

/** Тип реквизита строкой: в палитре он только показывается, поэтому хватает перечисления типов. */
function typeText(type: unknown): string | undefined {
	const types = (type as { types?: unknown })?.types;
	return Array.isArray(types) && types.length > 0 ? types.map((item) => String(item)).join(', ') : undefined;
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
	for (const key of ['synonymRu', 'comment']) {
		if (edits[key] !== undefined) {
			found[key] = edits[key];
		}
	}
	return next;
}
