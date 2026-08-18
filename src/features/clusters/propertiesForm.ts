/**
 * Описание карточки свойств: поля, разделы и вычисление правок.
 *
 * Карточек в консоли две — у информационной базы и у кластера, — и устроены они
 * одинаково: разделы с полями, часть только для чтения, сохраняются только
 * изменённые значения. Общее описание живёт здесь, а что именно показывать и
 * куда отправлять, знают модули объектов.
 */

/** Как показывать и править поле. */
export type PropertyKind =
	| 'readonly'
	| 'text'
	| 'number'
	| 'flag'
	| 'date'
	| 'select'
	| 'password';

/** Поле карточки. */
export interface PropertyField {
	/** Имя поля в выводе rac. */
	key: string;
	/** Подпись поля. */
	title: string;
	/** Тип значения. */
	kind: PropertyKind;
	/** Пояснение под полем. */
	hint?: string;
	/** Варианты для kind === 'select': значение и подпись. */
	options?: Array<[string, string]>;
}

/** Раздел карточки. */
export interface PropertySection {
	title: string;
	fields: PropertyField[];
}

/** Значения полей карточки. */
export type PropertyValues = Record<string, string>;

/**
 * Собирает значения формы из ответа rac.
 *
 * @param record - Поля объекта
 * @param sections - Разделы карточки
 * @returns Значения формы: у отсутствующего поля пустая строка, а не undefined
 */
export function toPropertyValues(
	record: Record<string, string>,
	sections: PropertySection[]
): PropertyValues {
	const values: PropertyValues = {};
	for (const section of sections) {
		for (const field of section.fields) {
			values[field.key] = record[field.key] ?? '';
		}
	}
	return values;
}

/**
 * Отбирает поля, которые действительно изменили.
 *
 * Отправлять форму целиком нельзя: команды платформы присваивают каждое
 * перечисленное поле, и параметр, которого администратор не касался, затёр бы
 * правку, сделанную в это же время в другой консоли.
 *
 * @param before - Значения, прочитанные с сервера
 * @param after - Значения формы
 * @param sections - Разделы карточки
 * @returns Только изменённые поля
 */
export function changedValues(
	before: PropertyValues,
	after: PropertyValues,
	sections: PropertySection[]
): PropertyValues {
	const editable = sections
		.flatMap((section) => section.fields)
		.filter((field) => field.kind !== 'readonly')
		.map((field) => field.key);
	const changed: PropertyValues = {};
	for (const key of editable) {
		const from = before[key] ?? '';
		const to = after[key] ?? '';
		if (from !== to) {
			changed[key] = to;
		}
	}
	return changed;
}

/**
 * Проверяет числовые поля карточки.
 *
 * @param values - Значения формы
 * @param sections - Разделы карточки
 * @returns Замечания по полям, которые платформа не примет
 */
export function validateNumbers(values: PropertyValues, sections: PropertySection[]): string[] {
	const problems: string[] = [];
	for (const section of sections) {
		for (const field of section.fields) {
			if (field.kind !== 'number') {
				continue;
			}
			const value = (values[field.key] ?? '').trim();
			if (value !== '' && !/^\d+$/.test(value)) {
				problems.push(`«${field.title}»: ожидается целое число`);
			}
		}
	}
	return problems;
}
