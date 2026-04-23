/**
 * Человекочитаемые русские названия видов связей ER-графа.
 *
 * Используется в метках рёбер Cytoscape и в текстах описания панели.
 *
 * @module webviews/metadataErCanvas/relationLabels
 */

export const RELATION_LABELS: Readonly<Record<string, string>> = {
	catalogOwners: 'Владелец',
	typeComposite: 'Тип',
	documentPostingRegisters: 'Движение по регистру',
	documentBasedOn: 'На основании',
	registerDimensionType: 'Тип измерения',
	registerResourceType: 'Тип ресурса',
	subsystemMembership: 'В подсистеме',
	subsystemNesting: 'Вложенная подсистема',
	sequenceDocuments: 'Документ последовательности',
	sequenceRegisters: 'Регистр последовательности',
	filterCriterionType: 'Тип критерия отбора',
	filterCriterionContent: 'Состав критерия отбора',
	documentJournalEntries: 'Журнал документов',
	functionalOptionLocation: 'Хранилище ФО',
	functionalOptionAffected: 'Управляется ФО',
	fopUseBinding: 'Параметр ФО',
	roleObjectRights: 'Права роли',
	exchangePlanContent: 'Состав плана обмена',
	commonAttributeUsage: 'Охватывает объект',
	commandParameterType: 'Тип параметра команды',
	registerChartOfAccounts: 'План счетов регистра',
	registerChartOfCalculationTypes: 'План видов расчётов регистра',
	chartOfAccountsExtDimensions: 'Виды субконто',
	characteristicExtValues: 'Значения характеристик',
	subscriptionSource: 'Источник подписки',
	subscriptionHandler: 'Обработчик подписки',
	scheduledJobHandler: 'Обработчик задания',
};

/** Группа видов связей для отображения в панели фильтров. */
export interface RelationGroup {
	readonly label: string;
	readonly kinds: readonly string[];
}

/**
 * Логические группы видов связей — отображаются как заголовки разделов в панели фильтров.
 *
 * Порядок групп и элементов внутри задаёт одновременно и порядок сортировки в {@link RELATION_SORT_ORDER}.
 */
export const RELATION_GROUPS: readonly RelationGroup[] = [
	{
		label: 'Типы и реквизиты',
		kinds: ['typeComposite', 'commonAttributeUsage', 'commandParameterType'],
	},
	{
		label: 'Подсистемы',
		kinds: ['subsystemMembership', 'subsystemNesting'],
	},
	{
		label: 'Права и обмен',
		kinds: ['roleObjectRights', 'exchangePlanContent'],
	},
	{
		label: 'Подписки и задания',
		kinds: ['subscriptionSource', 'subscriptionHandler', 'scheduledJobHandler'],
	},
	{
		label: 'Документы и справочники',
		kinds: ['catalogOwners', 'documentBasedOn', 'documentPostingRegisters', 'documentJournalEntries', 'chartOfAccountsExtDimensions', 'characteristicExtValues'],
	},
	{
		label: 'Регистры и последовательности',
		kinds: ['registerDimensionType', 'registerResourceType', 'registerChartOfAccounts', 'registerChartOfCalculationTypes', 'sequenceDocuments', 'sequenceRegisters'],
	},
	{
		label: 'Отборы и функциональные опции',
		kinds: ['filterCriterionContent', 'filterCriterionType', 'functionalOptionAffected', 'functionalOptionLocation', 'fopUseBinding'],
	},
];

/** Элемент сгруппированного списка: либо заголовок группы, либо вид связи. */
export type GroupedRelationItem =
	| { readonly type: 'header'; readonly label: string }
	| { readonly type: 'kind'; readonly kind: string };

/**
 * Раскладывает набор доступных видов связей по группам {@link RELATION_GROUPS}.
 *
 * Заголовок группы добавляется только если хотя бы один её вид присутствует в {@code available}.
 * Виды, не попавшие ни в одну группу, добавляются в конец в алфавитном порядке без заголовка.
 */
export function groupRelationKinds(available: readonly string[]): GroupedRelationItem[] {
	const availableSet = new Set(available);
	const result: GroupedRelationItem[] = [];
	const placed = new Set<string>();

	for (const group of RELATION_GROUPS) {
		const inGroup = group.kinds.filter((k) => availableSet.has(k));
		if (inGroup.length === 0) {
			continue;
		}
		result.push({ type: 'header', label: group.label });
		for (const kind of inGroup) {
			result.push({ type: 'kind', kind });
			placed.add(kind);
		}
	}

	const rest = [...available].filter((k) => !placed.has(k)).sort((a, b) => a.localeCompare(b, 'ru'));
	for (const kind of rest) {
		result.push({ type: 'kind', kind });
	}

	return result;
}

/**
 * Приоритетный порядок видов связей в фильтре — производный от {@link RELATION_GROUPS}.
 * Незнакомые виды при сортировке добавляются в конец в алфавитном порядке.
 */
export const RELATION_SORT_ORDER: readonly string[] = RELATION_GROUPS.flatMap((g) => g.kinds);

/** Возвращает читаемое русское название вида связи, либо исходный идентификатор. */
export function relationLabel(kind: string): string {
	return RELATION_LABELS[kind] ?? kind;
}

/**
 * Сортирует виды связей по логическому порядку {@link RELATION_SORT_ORDER}.
 * Незнакомые виды добавляются в конец в алфавитном порядке.
 */
export function sortRelationKinds(kinds: string[]): string[] {
	const orderIndex = new Map(RELATION_SORT_ORDER.map((k, i) => [k, i]));
	return [...kinds].sort((a, b) => {
		const ia = orderIndex.get(a) ?? Number.MAX_SAFE_INTEGER;
		const ib = orderIndex.get(b) ?? Number.MAX_SAFE_INTEGER;
		if (ia !== ib) {
			return ia - ib;
		}
		return a.localeCompare(b, 'ru');
	});
}

/**
 * Разбирает путь из поля {@code via} и возвращает короткое имя атрибута/измерения.
 *
 * Примеры:
 * - `attributes.ТипВопроса.type[0]`           → `ТипВопроса`
 * - `tabularSections.Товары.attributes.Количество.type[0]` → `Товары.Количество`
 * - `dimensions.Организация.type[0]`           → `Организация`
 * - `resources.Сумма.type[0]`                  → `Сумма`
 * - `owners[0]`, `content[N]`, `source[N]`, `commandParameterType[N]` → `null`
 * - `location`, `handler`, `methodName`        → `null`
 */
export function humanVia(path: string): string | null {
	// Индексные ссылки без семантики — не показываем
	if (/^(content|rights|owners|use|documents|registerRecords|basedOn|registeredDocuments|childObjects|source|commandParameterType)\[/.test(path)) {
		return null;
	}
	if (path === 'location' || path === 'handler' || path === 'methodName'
		|| path === 'chartOfAccounts' || path === 'chartOfCalculationTypes' || path === 'extDimensionTypes'
		|| path === 'characteristicExtValues') {
		return null;
	}
	// attributes.НазваниеРеквизита.type[N]
	const attrMatch = /^attributes\.([^.[]+)\./.exec(path);
	if (attrMatch) {
		return attrMatch[1];
	}
	// tabularSections.ТС.attributes.Реквизит.type[N]
	const tsAttrMatch = /^tabularSections\.([^.[]+)\.attributes\.([^.[]+)\./.exec(path);
	if (tsAttrMatch) {
		return `${tsAttrMatch[1]}.${tsAttrMatch[2]}`;
	}
	// dimensions.Имя.type[N]
	const dimMatch = /^dimensions\.([^.[]+)\./.exec(path);
	if (dimMatch) {
		return dimMatch[1];
	}
	// resources.Имя.type[N]
	const resMatch = /^resources\.([^.[]+)\./.exec(path);
	if (resMatch) {
		return resMatch[1];
	}
	return null;
}
