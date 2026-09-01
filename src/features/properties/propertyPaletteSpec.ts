/**
 * Перевод спецификации свойств в строки палитры и обратно.
 *
 * Спека вкладок (`metadataObjectEditSpec`) описывает свойства данными: путь в DTO, подпись, вид
 * контрола, варианты. Панель-вкладка рисует по ней форму, палитра - плоский список групп. Один
 * источник правды на оба хоста: разойтись они не могут.
 *
 * @module propertyPaletteSpec
 */

import type {
	MetadataEditControl,
	MetadataEditField,
	MetadataEditTabSpec,
} from '../metadata/metadataObjectEditSpec';
import type { PropertyControlKind, PropertyGroup, PropertyRow } from './propertyPaletteView';

/** Значение по пути вида `catalog.choiceMode`. */
export function readPath(source: unknown, dotPath: string): unknown {
	let current: unknown = source;
	for (const part of dotPath.split('.')) {
		if (typeof current !== 'object' || current === null) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

/**
 * Вид редактора палитры по виду контрола спеки.
 *
 * Составные редакторы (список ссылок, подбор типа, ссылка на модуль) палитра не рисует: им нужна
 * ширина панели-вкладки. Значение показывается текстом, править его там же.
 */
function controlKind(control: MetadataEditControl): PropertyControlKind | undefined {
	switch (control) {
		case 'text':
			return 'text';
		case 'textarea':
			return 'multiline';
		case 'check':
			return 'boolean';
		case 'number':
			return 'number';
		case 'select':
			return 'select';
		default:
			return undefined;
	}
}

/** Текст значения для строк, которые палитра только показывает. */
function readonlyText(value: unknown): string | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	if (Array.isArray(value)) {
		return value.length === 0 ? undefined : value.map((item) => String(item)).join(', ');
	}
	if (typeof value === 'object') {
		return undefined;
	}
	return String(value);
}

/** Поле недоступно, пока не выполнены условия спеки: в конфигураторе оно тоже погашено. */
function enabled(field: MetadataEditField, dto: unknown): boolean {
	return (field.enabledWhen ?? []).every((condition) => readPath(dto, condition.path) === condition.equals);
}

function row(field: MetadataEditField, dto: unknown): PropertyRow | undefined {
	const value = readPath(dto, field.path);
	const kind = controlKind(field.control);
	const options = field.options?.map((option) => ({ value: option.value, label: option.label }));
	if (kind === undefined) {
		const text = readonlyText(value);
		return text === undefined
			? undefined
			: { key: field.path, label: field.label, kind: 'text', value: text, readonly: true, hint: field.path };
	}
	if (field.readonly === true || !enabled(field, dto)) {
		// Погашенная строка остаётся своего вида: флажок и выбор показываются словами словаря
		const text = readonlyText(value);
		return text === undefined
			? undefined
			: { key: field.path, label: field.label, kind, value: text, readonly: true, hint: field.path, options };
	}
	return {
		key: field.path,
		label: field.label,
		kind,
		value: value === undefined || value === null ? undefined : String(value),
		readonly: false,
		hint: field.path,
		options,
		...(field.rebuilds ? { rebuilds: true } : {}),
	};
}

/**
 * Группы палитры по вкладкам спеки.
 *
 * Вкладки схлопываются в один список: палитра узкая, закладок в ней нет. Одноимённые группы
 * разных вкладок сливаются - в конфигураторе такая группа тоже одна.
 */
export function paletteGroupsFromSpec(tabs: readonly MetadataEditTabSpec[], dto: unknown): PropertyGroup[] {
	const byTitle = new Map<string, PropertyRow[]>();
	for (const tab of tabs) {
		for (const group of tab.groups) {
			const rows = byTitle.get(group.title) ?? [];
			for (const field of group.fields) {
				const built = row(field, dto);
				if (built && !rows.some((existing) => existing.key === built.key)) {
					rows.push(built);
				}
			}
			if (rows.length > 0) {
				byTitle.set(group.title, rows);
			}
		}
	}
	return [...byTitle.entries()].map(([title, rows]) => ({ title, rows }));
}

/**
 * Правки палитры поверх DTO: значения приводятся к типу поля по спеке.
 *
 * @param dto   DTO, прочитанный перед показом.
 * @param tabs  Спека, по которой строились строки.
 * @param edits Изменённые значения: ключ строки - путь в DTO.
 * @returns Копия DTO с правками.
 */
export function applyPaletteEdits(
	dto: Record<string, unknown>,
	tabs: readonly MetadataEditTabSpec[],
	edits: Readonly<Record<string, string>>
): Record<string, unknown> {
	const next = structuredClone(dto);
	for (const tab of tabs) {
		for (const group of tab.groups) {
			for (const field of group.fields) {
				const incoming = edits[field.path];
				if (incoming === undefined || controlKind(field.control) === undefined) {
					continue;
				}
				writePath(next, field.path, typedValue(field.control, incoming));
			}
		}
	}
	return next;
}

/** Палитра отдаёт строки, а DTO ждёт булево и число. */
function typedValue(control: MetadataEditControl, value: string): unknown {
	if (control === 'check') {
		return value === 'true';
	}
	if (control === 'number') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : value;
	}
	return value;
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
	current[parts[parts.length - 1]] = value;
}
