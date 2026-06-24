/**
 * Маппинг пути по метаданным 1С → путь к файлу модуля в выгрузке конфигуратора
 *
 * vrunner syntax-check при --groupbymetadata: true пишет в атрибут testcase name
 * путь по метаданным с русскими именами объектов, например:
 *   - `ОбщийМодуль.РаботаСФайлами.Модуль`
 *   - `Справочник.Файлы.Форма.ФормаЭлемента.Форма`
 *   - `Обработка.Сканирование.МодульОбъекта`
 *
 * В выгрузке конфигуратора (формат src/cf) русские имена объектов = имена папок,
 * а тип метаданных раскладывается в английский подкаталог (ОбщийМодуль →
 * CommonModules). Здесь только построение пути-кандидата (чистая функция);
 * проверку существования файла делает вызывающий код — для тех типов и форм,
 * что не разложились в .bsl, путь не возвращается, и диагностика уходит на
 * fallback-файл.
 *
 * Связано с [[ssl31-reference-test-config]]: формат проверен на ssl_3_1.
 * Расширяет частичный маппинг из metadataBoilerplateNames (только создаваемые
 * объекты) типами HTTPСервис/ОбщаяФорма/модулей менеджера-объекта-формы.
 */

/** Русский тип метаданных → английский подкаталог выгрузки src/cf */
const TYPE_TO_SUBDIR: Record<string, string> = {
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

/** Типы с единственным модулем в Ext/Module.bsl (суффикс «Модуль») */
const SINGLE_MODULE_TYPES = new Set(['ОбщийМодуль', 'HTTPСервис', 'WebСервис', 'ОбщаяКоманда']);

/** Суффикс пути модуля объекта → имя файла .bsl в каталоге Ext */
const MODULE_SUFFIX_TO_FILE: Record<string, string> = {
	МодульМенеджера: 'ManagerModule.bsl',
	МодульОбъекта: 'ObjectModule.bsl',
	МодульНабораЗаписей: 'RecordSetModule.bsl',
	МодульЗначения: 'ValueManagerModule.bsl',
};

/**
 * Строит путь к файлу модуля относительно корня src/cf по пути из метаданных
 *
 * @param metadataPath - Значение атрибута testcase name (например `ОбщийМодуль.Имя.Модуль`)
 * @returns Относительный путь с разделителем «/» (например `CommonModules/Имя/Ext/Module.bsl`)
 *          или undefined, если тип/форма не раскладываются в .bsl
 */
export function resolveBslPathFromMetadata(metadataPath: string): string | undefined {
	const segments = metadataPath.split('.');
	if (segments.length < 3) {
		return undefined;
	}

	const type = segments[0];
	const subdir = TYPE_TO_SUBDIR[type];
	if (!subdir) {
		return undefined;
	}

	const objectName = segments[1];
	const suffix = segments[segments.length - 1];

	// Общая форма: объект сам является формой (ОбщаяФорма.Имя.Форма)
	if (type === 'ОбщаяФорма') {
		if (segments.length === 3 && suffix === 'Форма') {
			return `${subdir}/${objectName}/Ext/Form/Module.bsl`;
		}
		return undefined;
	}

	// Подчинённая форма: Тип.Объект.Форма.ИмяФормы.Форма
	if (segments.length === 5 && segments[2] === 'Форма' && suffix === 'Форма') {
		const formName = segments[3];
		return `${subdir}/${objectName}/Forms/${formName}/Ext/Form/Module.bsl`;
	}

	// Модуль менеджера/объекта/набора записей
	const moduleFile = MODULE_SUFFIX_TO_FILE[suffix];
	if (segments.length === 3 && moduleFile) {
		return `${subdir}/${objectName}/Ext/${moduleFile}`;
	}

	// Единственный модуль объекта (Ext/Module.bsl)
	if (segments.length === 3 && suffix === 'Модуль' && SINGLE_MODULE_TYPES.has(type)) {
		return `${subdir}/${objectName}/Ext/Module.bsl`;
	}

	return undefined;
}
