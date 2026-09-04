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
	Подсистема: 'Subsystems',
	Роль: 'Roles',
	ОбщаяКартинка: 'CommonPictures',
	ОбщийМакет: 'CommonTemplates',
	ОпределяемыйТип: 'DefinedTypes',
	ЭлементСтиля: 'StyleItems',
	ХранилищеНастроек: 'SettingsStorages',
	WSСсылка: 'WSReferences',
	ПодпискаНаСобытие: 'EventSubscriptions',
	РегламентноеЗадание: 'ScheduledJobs',
	ОбщийРеквизит: 'CommonAttributes',
	ФункциональнаяОпция: 'FunctionalOptions',
	ПараметрФункциональнойОпции: 'FunctionalOptionsParameters',
	ПараметрСеанса: 'SessionParameters',
	КритерийОтбора: 'FilterCriteria',
	Последовательность: 'Sequences',
	Нумератор: 'DocumentNumerators',
	ПакетXDTO: 'XDTOPackages',
	Язык: 'Languages',
	Стиль: 'Styles',
	ГруппаКоманд: 'CommandGroups',
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

/** Формат исходников по файлу: описание объекта EDT лежит в `.mdo`, содержимое формы в `.form`. */
export function formatOfFile(file: string): SourceFormat {
	const extension = path.extname(file).toLowerCase();
	return extension === '.mdo' || extension === '.form' ? 'edt' : 'designer';
}

/**
 * Каталог объекта по файлу его описания.
 *
 * У выгрузки конфигуратора каталог назван по файлу и лежит рядом с ним, у EDT описание
 * лежит внутри каталога. Имя берётся у файла, а не у объекта: у внешнего файла каталог
 * носит имя артефакта, а объект внутри своё.
 *
 * @param objectFile - Полный путь к описанию объекта
 */
export function objectDirectoryOf(objectFile: string): string {
	if (formatOfFile(objectFile) === 'edt') {
		return path.dirname(objectFile);
	}
	return path.join(path.dirname(objectFile), path.basename(objectFile, path.extname(objectFile)));
}

/**
 * Полный путь к модулю объекта по файлу его описания.
 *
 * @param objectFile - Полный путь к описанию объекта
 * @param kind - Вид модуля
 */
export function moduleFileOf(objectFile: string, kind: ModuleKind): string {
	const directory = objectDirectoryOf(objectFile);
	return formatOfFile(objectFile) === 'edt'
		? path.join(directory, MODULE_FILES[kind])
		: path.join(directory, 'Ext', MODULE_FILES[kind]);
}

/**
 * Полный путь к содержимому формы по файлу объекта-владельца.
 *
 * Без имени формы путь ведёт к содержимому общей формы: она сама является формой.
 *
 * @param objectFile - Полный путь к описанию объекта
 * @param formName - Имя формы объекта
 */
export function formContentFileOf(objectFile: string, formName?: string): string {
	const directory =
		formName === undefined
			? objectDirectoryOf(objectFile)
			: path.join(objectDirectoryOf(objectFile), 'Forms', formName);
	return formatOfFile(objectFile) === 'edt' ? path.join(directory, 'Form.form') : path.join(directory, 'Ext', 'Form.xml');
}

/**
 * Модуль формы рядом с её содержимым.
 *
 * @param formContentFile - Полный путь к содержимому формы
 */
export function formModuleNextTo(formContentFile: string): string {
	return formatOfFile(formContentFile) === 'edt'
		? path.join(path.dirname(formContentFile), 'Module.bsl')
		: path.join(path.dirname(formContentFile), 'Form', 'Module.bsl');
}

/**
 * Полный путь к модулю формы по файлу объекта-владельца; без имени формы - общей формы.
 *
 * @param objectFile - Полный путь к описанию объекта
 * @param formName - Имя формы объекта
 */
export function formModuleFileOf(objectFile: string, formName?: string): string {
	return formModuleNextTo(formContentFileOf(objectFile, formName));
}

/**
 * Полный путь к модулю команды объекта.
 *
 * @param objectFile - Полный путь к описанию объекта
 * @param commandName - Имя команды
 */
export function commandModuleFileOf(objectFile: string, commandName: string): string {
	const directory = path.join(objectDirectoryOf(objectFile), 'Commands', commandName);
	return formatOfFile(objectFile) === 'edt'
		? path.join(directory, MODULE_FILES.command)
		: path.join(directory, 'Ext', MODULE_FILES.command);
}

/**
 * Файл объекта-владельца по содержимому его формы.
 *
 * У общей формы владельца нет: над её каталогом нет каталога `Forms`.
 *
 * @param formContentFile - Полный путь к содержимому формы
 */
export function formOwnerFileOf(formContentFile: string): string | undefined {
	const parts = formContentFile.split(/[\\/]/);
	const forms = parts.lastIndexOf('Forms');
	if (forms < 1) {
		return undefined;
	}
	const objectDirectory = path.join(...parts.slice(0, forms));
	return formatOfFile(formContentFile) === 'edt'
		? path.join(objectDirectory, `${path.basename(objectDirectory)}.mdo`)
		: `${objectDirectory}.xml`;
}

/**
 * Файл со свойствами формы: имя, синоним, тип.
 *
 * В выгрузке конфигуратора это свой файл рядом с каталогом формы, в EDT свойства
 * формы записаны в описании объекта-владельца, и своего файла у формы нет.
 *
 * @param objectFile - Полный путь к описанию объекта
 * @param formName - Имя формы объекта
 * @returns Путь либо undefined, если свойства лежат в описании владельца
 */
export function formDescriptorFileOf(objectFile: string, formName: string): string | undefined {
	return formatOfFile(objectFile) === 'edt'
		? undefined
		: path.join(objectDirectoryOf(objectFile), 'Forms', `${formName}.xml`);
}

/**
 * Каталог справки объекта.
 *
 * @param objectFile - Полный путь к описанию объекта
 */
export function helpDirectoryOf(objectFile: string): string {
	const directory = objectDirectoryOf(objectFile);
	return formatOfFile(objectFile) === 'edt' ? path.join(directory, 'Help') : path.join(directory, 'Ext', 'Help');
}

/**
 * Модуль конфигурации или расширения.
 *
 * @param sourceDir - Каталог исходников: выгрузка конфигуратора либо `src` проекта EDT
 * @param format - Формат исходников
 * @param fileName - Имя файла модуля
 */
export function configurationModuleFile(sourceDir: string, format: SourceFormat, fileName: string): string {
	return format === 'edt' ? path.join(sourceDir, 'Configuration', fileName) : path.join(sourceDir, 'Ext', fileName);
}

/**
 * Содержимое макета: `Ext/Template.xml` у конфигуратора, `Template.dcs` у EDT.
 *
 * Без имени макета путь ведёт к содержимому общего макета: он сам является макетом.
 *
 * @param objectFile - Полный путь к описанию объекта
 * @param templateName - Имя макета объекта
 */
export function templateContentFileOf(objectFile: string, templateName?: string): string {
	const directory =
		templateName === undefined
			? objectDirectoryOf(objectFile)
			: path.join(objectDirectoryOf(objectFile), 'Templates', templateName);
	return formatOfFile(objectFile) === 'edt'
		? path.join(directory, 'Template.dcs')
		: path.join(directory, 'Ext', 'Template.xml');
}

/**
 * Файл со свойствами макета объекта.
 *
 * У конфигуратора это свой файл рядом с каталогом макета; у EDT свойства макета
 * записаны в описании объекта-владельца, и своего файла у макета нет.
 *
 * @param objectFile - Полный путь к описанию объекта
 * @param templateName - Имя макета объекта
 * @returns Путь либо undefined, если свойства лежат в описании владельца
 */
export function templateDescriptorFileOf(objectFile: string, templateName: string): string | undefined {
	return formatOfFile(objectFile) === 'edt'
		? undefined
		: path.join(objectDirectoryOf(objectFile), 'Templates', `${templateName}.xml`);
}

/**
 * Каталог вложенных подсистем.
 *
 * @param subsystemFile - Полный путь к описанию подсистемы
 */
export function nestedSubsystemsDirectoryOf(subsystemFile: string): string {
	return path.join(objectDirectoryOf(subsystemFile), 'Subsystems');
}

/**
 * Файл описания вложенной подсистемы.
 *
 * @param subsystemFile - Полный путь к описанию подсистемы-владельца
 * @param name - Имя вложенной подсистемы
 */
export function nestedSubsystemFileOf(subsystemFile: string, name: string): string {
	const directory = nestedSubsystemsDirectoryOf(subsystemFile);
	return formatOfFile(subsystemFile) === 'edt'
		? path.join(directory, name, `${name}.mdo`)
		: path.join(directory, `${name}.xml`);
}

/**
 * Файл описания конфигурации или расширения.
 *
 * @param root - Конфигурация или расширение
 */
export function configurationDescriptorFile(root: SourceRoot): string {
	return root.format === 'edt'
		? path.join(sourceDirectory(root), 'Configuration', 'Configuration.mdo')
		: path.join(sourceDirectory(root), 'Configuration.xml');
}
