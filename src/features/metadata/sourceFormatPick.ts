/**
 * Выбор формата исходников: одни и те же подписи, пояснение называет объект.
 * @module metadata/sourceFormatPick
 */

import type { SourceFormat } from '../../shared/projectLayout';

/** Объект, для которого выбирается формат. */
export type SourceFormatSubject = 'configuration' | 'extension' | 'report' | 'processor';

/** Пункт списка форматов. */
export interface SourceFormatPick {
	label: string;
	description: string;
	format: SourceFormat;
}

const DESCRIPTION: Readonly<Record<SourceFormatSubject, Readonly<Record<SourceFormat, string>>>> = {
	configuration: { designer: 'файлы конфигурации', edt: 'проект конфигурации' },
	extension: { designer: 'файлы расширения', edt: 'проект расширения' },
	report: { designer: 'файл отчёта', edt: 'проект отчёта' },
	processor: { designer: 'файл обработки', edt: 'проект обработки' },
};

/**
 * Два пункта выбора формата.
 *
 * @param subject - Конфигурация, расширение, отчёт или обработка
 */
export function sourceFormatPicks(subject: SourceFormatSubject): [SourceFormatPick, SourceFormatPick] {
	const text = DESCRIPTION[subject];
	return [
		{ label: 'Проект в формате 1С:Конфигуратор', description: text.designer, format: 'designer' },
		{ label: 'Проект в формате 1С:EDT', description: text.edt, format: 'edt' },
	];
}
