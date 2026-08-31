/**
 * Что можно делать с узлом состава объекта метаданных.
 *
 * Одна таблица на всё: по ней дерево выдаёт узлу токены возможностей, меню
 * показывает пункты, а обработчик собирает операцию md-sparrow. Раньше набор
 * пунктов был вписан в условия меню руками, и виды узлов разъезжались: реквизит
 * переименовывался, а измерение регистра - нет, хотя md-sparrow умеет оба.
 *
 * @module metadataChildMutations
 */

import type { MdSparrowOp } from './mdSparrowParams';

/** Вид узла состава, у которого есть операции. */
export type MutatableChildKind =
	| 'accountingFlag'
	| 'extDimensionAccountingFlag'
	| 'attribute'
	| 'tabularSection'
	| 'tabularAttribute'
	| 'dimension'
	| 'resource'
	| 'value'
	| 'command';

interface ChildMutationSpec {
	/** Общая часть имени операций md-sparrow. */
	readonly op: string;
	/** md-sparrow умеет дублировать узел. */
	readonly duplicate: boolean;
	/** Операция требует имени табличной части, в которой лежит узел. */
	readonly insideTabularSection?: boolean;
}

/**
 * Виды узлов и их операции.
 *
 * Проверено по списку подкоманд md-sparrow: у команды объекта дублирования нет,
 * у остальных видов есть.
 */
const SPEC_BY_KIND: Readonly<Record<MutatableChildKind, ChildMutationSpec>> = {
	attribute: { op: 'cf-md-attribute', duplicate: true },
	tabularSection: { op: 'cf-md-tabular-section', duplicate: true },
	tabularAttribute: { op: 'cf-md-tabular-attribute', duplicate: true, insideTabularSection: true },
	dimension: { op: 'cf-md-dimension', duplicate: true },
	resource: { op: 'cf-md-resource', duplicate: true },
	value: { op: 'cf-md-enum-value', duplicate: true },
	command: { op: 'cf-md-command', duplicate: false },
	accountingFlag: { op: 'cf-md-accounting-flag', duplicate: false },
	extDimensionAccountingFlag: { op: 'cf-md-ext-dimension-accounting-flag', duplicate: false },
};

/** Раздел объекта, в который добавляют узел: вид раздела -> вид его узлов. */
const CHILD_KIND_BY_SECTION: Readonly<Record<string, MutatableChildKind>> = {
	attributes: 'attribute',
	tabularSections: 'tabularSection',
	dimensions: 'dimension',
	resources: 'resource',
	values: 'value',
	commands: 'command',
	accountingFlags: 'accountingFlag',
	extDimensionAccountingFlags: 'extDimensionAccountingFlag',
};

/** Узел этого вида умеет переименовываться и удаляться. */
export function childKindIsMutatable(kind: string): kind is MutatableChildKind {
	return kind in SPEC_BY_KIND;
}

/** Узел этого вида умеет дублироваться. */
export function childKindSupportsDuplicate(kind: string): boolean {
	return childKindIsMutatable(kind) && SPEC_BY_KIND[kind].duplicate;
}

/** Вид узлов раздела: в этот раздел можно добавлять, если он известен. */
export function childKindOfSection(sectionKind: string): MutatableChildKind | undefined {
	return CHILD_KIND_BY_SECTION[sectionKind];
}

/** Название нового узла для заголовка окна ввода имени. */
export function childKindTitle(kind: MutatableChildKind): string {
	const titles: Record<MutatableChildKind, string> = {
		attribute: 'Новый реквизит',
		tabularSection: 'Новая табличная часть',
		tabularAttribute: 'Новый реквизит табличной части',
		dimension: 'Новое измерение',
		resource: 'Новый ресурс',
		value: 'Новое значение перечисления',
		command: 'Новая команда',
		accountingFlag: 'Новый признак учёта',
		extDimensionAccountingFlag: 'Новый признак учёта субконто',
	};
	return titles[kind];
}

/** Сообщение об успехе после добавления узла. */
export function childKindAddedMessage(kind: MutatableChildKind, name: string): string {
	const messages: Record<MutatableChildKind, string> = {
		attribute: `Реквизит «${name}» добавлен.`,
		tabularSection: `Табличная часть «${name}» добавлена.`,
		tabularAttribute: `Реквизит «${name}» добавлен в табличную часть.`,
		dimension: `Измерение «${name}» добавлено.`,
		resource: `Ресурс «${name}» добавлен.`,
		value: `Значение «${name}» добавлено.`,
		command: `Команда «${name}» добавлена.`,
		accountingFlag: `Признак учёта «${name}» добавлен`,
		extDimensionAccountingFlag: `Признак учёта субконто «${name}» добавлен`,
	};
	return messages[kind];
}

/** Режим операции над узлом состава. */
export type ChildMutationMode = 'add' | 'rename' | 'delete' | 'duplicate';

/** Операция md-sparrow для вида узла и режима. */
export function childMutationOp(kind: MutatableChildKind, mode: ChildMutationMode): MdSparrowOp {
	return `${SPEC_BY_KIND[kind].op}-${mode}` as MdSparrowOp;
}

/** Операции вида требуют имени табличной части. */
export function childKindNeedsTabularSection(kind: MutatableChildKind): boolean {
	return SPEC_BY_KIND[kind].insideTabularSection === true;
}

/**
 * Ключ правила поддержки узла состава: правило поставки заведено на каждый
 * элемент объекта, а не только на его файл.
 *
 * Ключ строит md-sparrow из той же общей части операций, поэтому виды
 * элементов формата в расширении не дублируются.
 *
 * @param tabularSection Имя табличной части для узла внутри неё.
 */
export function childSupportElementKey(
	kind: string,
	name: string,
	tabularSection?: string
): string | undefined {
	if (!childKindIsMutatable(kind)) {
		return undefined;
	}
	const spec = SPEC_BY_KIND[kind];
	const path = spec.insideTabularSection && tabularSection ? `${tabularSection}/${name}` : name;
	return `element:${spec.op}:${path}`;
}
