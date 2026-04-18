/**
 * Ограничения на имя справочника — в духе md-sparrow {@code CatalogNameConstraints}.
 * @module catalogNameConstraints
 */

/** Первая позиция: буква (Unicode) или «_»; далее — буквы, цифры, «_». */
const CATALOG_NAME_PATTERN = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/**
 * @returns сообщение об ошибке или `null`, если имя допустимо
 */
export function catalogNameInputError(trimmedName: string): string | null {
	if (!trimmedName) {
		return 'Введите имя';
	}
	if (!CATALOG_NAME_PATTERN.test(trimmedName)) {
		return 'Первый символ — буква или «_», далее буквы, цифры и «_»';
	}
	return null;
}
