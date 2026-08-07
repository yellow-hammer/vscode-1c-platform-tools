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

/** Поле DTO объекта, в котором лежит узел этого вида; пусто - вид правке не поддаётся. */
const DTO_LIST_BY_NODE_KIND: Readonly<Record<string, string>> = {
	attribute: 'attributes',
	tabularSection: 'tabularSections',
	value: 'enumValues',
	dimension: 'dimensions',
	resource: 'resources',
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
	return [
		{
			id: 'child_main',
			title: 'Основные',
			groups: [
				{
					title: 'Основные',
					fields: [
						{ path: 'name', label: 'Имя', control: 'text', readonly: true },
						{ path: 'synonymRu', label: 'Синоним', control: 'text', readonly: !editable },
						{ path: 'comment', label: 'Комментарий', control: 'text', readonly: !editable },
						{ path: 'typeText', label: 'Тип', control: 'text', readonly: true },
					],
				},
			],
		},
	];
}

/** Узел из DTO объекта по имени: списки состава плоские, вложенности в них нет. */
export function findChildNode(objectDto: Record<string, unknown>, listName: string, name: string): ChildNodeDto | undefined {
	const list = objectDto[listName];
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
