/**
 * Пути исходников объектов метаданных в обеих раскладках.
 *
 * Раскладки отличаются в трёх местах: в EDT исходники лежат в подкаталоге `src`
 * проекта, описание объекта - один файл `<Имя>.mdo` рядом с каталогом объекта,
 * а модули лежат в самом каталоге, без промежуточного `Ext`.
 *
 * Модуль чистый: он не ходит на диск и не знает про vscode, поэтому его правила
 * одинаково годятся и панелям, и командам, и разбору отчётов.
 * @module objectPaths
 */

import * as path from 'node:path';
import type { SourceFormat, SourceRoot } from './projectLayout';

/** Русский тип метаданных - английский каталог в исходниках. */
const TYPE_DIRECTORIES: Record<string, string> = {
	ОбщийМодуль: 'CommonModules',
	HTTPСервис: 'HTTPServices',
	WebСервис: 'WebServices',
	ОбщаяФорма: 'CommonForms',
	ОбщаяКоманда: 'CommonCommands',
	Справочник: 'Catalogs',
	Документ: 'Documents',
	Обработка: 'DataProcessors',
	Отчет: 'Reports',
	РегистрСведений: 'InformationRegisters',
	РегистрНакопления: 'AccumulationRegisters',
	РегистрБухгалтерии: 'AccountingRegisters',
	РегистрРасчета: 'CalculationRegisters',
	ПланВидовХарактеристик: 'ChartsOfCharacteristicTypes',
	ПланСчетов: 'ChartsOfAccounts',
	ПланВидовРасчета: 'ChartsOfCalculationTypes',
	ПланОбмена: 'ExchangePlans',
	БизнесПроцесс: 'BusinessProcesses',
	Задача: 'Tasks',
	Перечисление: 'Enums',
	Константа: 'Constants',
	ЖурналДокументов: 'DocumentJournals',
};

/** Вид модуля объекта - имя файла. */
const MODULE_FILES = {
	object: 'ObjectModule.bsl',
	manager: 'ManagerModule.bsl',
	recordSet: 'RecordSetModule.bsl',
	valueManager: 'ValueManagerModule.bsl',
	command: 'CommandModule.bsl',
	module: 'Module.bsl',
} as const;

/** Вид модуля объекта. */
export type ModuleKind = keyof typeof MODULE_FILES;

/** Русские типы метаданных, известные раскладке. */
export const METADATA_TYPES: readonly string[] = Object.keys(TYPE_DIRECTORIES);

/**
 * Каталог типа метаданных.
 *
 * @param type - Русское имя типа: `Справочник`, `ОбщийМодуль`
 * @returns Английский каталог или undefined для неизвестного типа
 */
export function typeDirectory(type: string): string | undefined {
	return TYPE_DIRECTORIES[type];
}

/**
 * Каталог исходников корня: в EDT они лежат в подкаталоге `src`.
 *
 * @param root - Конфигурация или расширение
 */
export function sourceDirectory(root: SourceRoot): string {
	return root.format === 'edt' ? path.join(root.dir, 'src') : root.dir;
}

/**
 * Каталог объекта относительно каталога исходников.
 *
 * @param type - Русское имя типа
 * @param name - Имя объекта
 */
export function objectDirectory(type: string, name: string): string | undefined {
	const directory = typeDirectory(type);
	return directory ? `${directory}/${name}` : undefined;
}

/**
 * Файл описания объекта относительно каталога исходников.
 *
 * Раскладки расходятся: в выгрузке конфигуратора описание лежит рядом с
 * каталогом объекта (`Catalogs/Валюты.xml`), в EDT - внутри него
 * (`Catalogs/Валюты/Валюты.mdo`). Проверено на ssl_3_1 в обоих форматах.
 *
 * @param format - Формат исходников
 * @param type - Русское имя типа
 * @param name - Имя объекта
 */
export function objectFile(format: SourceFormat, type: string, name: string): string | undefined {
	const directory = typeDirectory(type);
	if (!directory) {
		return undefined;
	}
	return format === 'edt' ? `${directory}/${name}/${name}.mdo` : `${directory}/${name}.xml`;
}

/**
 * Файл модуля объекта относительно каталога исходников.
 *
 * @param format - Формат исходников
 * @param type - Русское имя типа
 * @param name - Имя объекта
 * @param kind - Вид модуля
 */
export function moduleFile(
	format: SourceFormat,
	type: string,
	name: string,
	kind: ModuleKind
): string | undefined {
	const directory = objectDirectory(type, name);
	if (!directory) {
		return undefined;
	}
	return format === 'edt'
		? `${directory}/${MODULE_FILES[kind]}`
		: `${directory}/Ext/${MODULE_FILES[kind]}`;
}

/**
 * Каталог форм объекта относительно каталога исходников.
 *
 * У общей формы форм нет: она сама является формой.
 *
 * @param type - Русское имя типа
 * @param name - Имя объекта
 */
export function formsDirectory(type: string, name: string): string | undefined {
	const directory = objectDirectory(type, name);
	return directory ? `${directory}/Forms` : undefined;
}

/**
 * Файл модуля формы относительно каталога исходников.
 *
 * Без имени формы путь строится для общей формы, которая сама является формой.
 *
 * @param format - Формат исходников
 * @param type - Русское имя типа
 * @param name - Имя объекта
 * @param formName - Имя формы объекта
 */
export function formModuleFile(
	format: SourceFormat,
	type: string,
	name: string,
	formName?: string
): string | undefined {
	const directory = objectDirectory(type, name);
	if (!directory) {
		return undefined;
	}

	if (formName === undefined) {
		return format === 'edt' ? `${directory}/Module.bsl` : `${directory}/Ext/Form/Module.bsl`;
	}
	return format === 'edt'
		? `${directory}/Forms/${formName}/Module.bsl`
		: `${directory}/Forms/${formName}/Ext/Form/Module.bsl`;
}

/**
 * Полный путь к файлу исходников.
 *
 * @param root - Конфигурация или расширение
 * @param relative - Путь относительно каталога исходников
 */
export function sourcePath(root: SourceRoot, relative: string): string {
	return path.join(sourceDirectory(root), ...relative.split('/'));
}
