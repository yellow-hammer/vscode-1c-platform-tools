/**
 * Путь по метаданным 1С → путь к файлу модуля в исходниках
 *
 * vrunner syntax-check при --groupbymetadata: true пишет в атрибут testcase name
 * путь по метаданным с русскими именами объектов, например:
 *   - `ОбщийМодуль.РаботаСФайлами.Модуль`
 *   - `Справочник.Файлы.Форма.ФормаЭлемента.Форма`
 *   - `Обработка.Сканирование.МодульОбъекта`
 *
 * Здесь только разбор такого пути; раскладку файлов по формату исходников знает
 * `shared/objectPaths`. Проверку существования файла делает вызывающий код: для
 * тех типов и форм, что не разложились в .bsl, путь не возвращается, и
 * диагностика уходит на fallback-файл.
 *
 * Связано с [[ssl31-reference-test-config]]: формат проверен на ssl_3_1.
 */

import type { SourceFormat } from '../../shared/projectLayout';
import {
	formModuleFile,
	METADATA_TYPES,
	moduleFile,
	typeDirectory,
	type ModuleKind,
} from '../../shared/objectPaths';

/** Русские типы метаданных, известные маппингу (для разбора текста вывода). */
export const METADATA_TYPE_NAMES: readonly string[] = METADATA_TYPES;

/** Суффикс пути по метаданным → вид модуля объекта. */
const SUFFIX_MODULES: Record<string, ModuleKind> = {
	МодульМенеджера: 'manager',
	МодульОбъекта: 'object',
	МодульНабораЗаписей: 'recordSet',
	МодульЗначения: 'valueManager',
};

/**
 * Типы с единственным модулем.
 *
 * У общей команды файл называется CommandModule.bsl, а не Module.bsl.
 * Сверено с живыми проектами в обеих раскладках.
 */
const SINGLE_MODULES: Record<string, ModuleKind> = {
	ОбщийМодуль: 'module',
	HTTPСервис: 'module',
	WebСервис: 'module',
	ОбщаяКоманда: 'command',
};

/**
 * Строит путь к файлу модуля относительно каталога исходников
 *
 * @param metadataPath - Значение атрибута testcase name (например `ОбщийМодуль.Имя.Модуль`)
 * @param format - Формат исходников
 * @returns Относительный путь с разделителем «/» (например `CommonModules/Имя/Ext/Module.bsl`)
 *          или undefined, если тип/форма не раскладываются в .bsl
 */
export function resolveBslPathFromMetadata(
	metadataPath: string,
	format: SourceFormat = 'designer'
): string | undefined {
	const segments = metadataPath.split('.');
	if (segments.length < 3) {
		return undefined;
	}

	const type = segments[0];
	if (!typeDirectory(type)) {
		return undefined;
	}

	const objectName = segments[1];
	const suffix = segments[segments.length - 1];

	// Общая форма: объект сам является формой (ОбщаяФорма.Имя.Форма)
	if (type === 'ОбщаяФорма') {
		return segments.length === 3 && suffix === 'Форма'
			? formModuleFile(format, type, objectName)
			: undefined;
	}

	// Подчинённая форма: Тип.Объект.Форма.ИмяФормы.Форма
	if (segments.length === 5 && segments[2] === 'Форма' && suffix === 'Форма') {
		return formModuleFile(format, type, objectName, segments[3]);
	}

	if (segments.length !== 3) {
		return undefined;
	}

	// Модуль менеджера, объекта, набора записей
	const kind = SUFFIX_MODULES[suffix];
	if (kind) {
		return moduleFile(format, type, objectName, kind);
	}

	// Единственный модуль объекта; у общей команды суффикс бывает «МодульКоманды»
	const single = SINGLE_MODULES[type];
	if (single && (suffix === 'Модуль' || suffix === 'МодульКоманды')) {
		return moduleFile(format, type, objectName, single);
	}

	return undefined;
}
