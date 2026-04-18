/**
 * Константы модуля «Проекты 1С».
 */

export const FAVORITES_FILENAME = 'projects.json';

/** Источник вызова команды. */
export enum InvocationSource {
	Palette = 0,
	SideBar = 1,
	StatusBar = 2,
}

/** Специальный тег для проектов без тегов. */
export const UNTAGGED_LABEL = '(без тегов)';
