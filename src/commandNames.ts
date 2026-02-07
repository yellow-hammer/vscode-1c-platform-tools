/**
 * Утилиты для получения названий и заголовков команд
 * Используется для единообразного отображения команд в интерфейсе
 */

export interface CommandNameAndTitle {
	name: string;
	title: string;
}

/**
 * Получить название и заголовок для команды создания пустой информационной базы
 */
export function getCreateEmptyInfobaseCommandName(): CommandNameAndTitle {
	return {
		name: 'Создать пустую',
		title: 'Создать пустую'
	};
}

/**
 * Получить название и заголовок для команды обновления информационной базы (vrunner updatedb)
 */
export function getUpdateInfobaseCommandName(): CommandNameAndTitle {
	return {
		name: 'Обновить ИБ',
		title: 'Обновить ИБ'
	};
}

/**
 * Получить название и заголовок для команды загрузки конфигурации из *.cf
 */
export function getLoadConfigurationFromCfCommandName(): CommandNameAndTitle {
	return {
		name: 'Загрузка конфигурации из CF',
		title: 'Загрузить конфигурацию из *.cf'
	};
}

/**
 * Получить название и заголовок для команды загрузки расширений
 */
export function getLoadExtensionsCommandName(): CommandNameAndTitle {
	return {
		name: 'Загрузка расширений',
		title: 'Загрузка расширений'
	};
}

/**
 * Получить название и заголовок для команды обновления базы данных
 */
export function getUpdateDatabaseCommandName(): CommandNameAndTitle {
	return {
		name: 'Запустить обновление',
		title: 'Запустить обновление'
	};
}

/**
 * Получить название и заголовок для команды блокировки внешних ресурсов
 */
export function getBlockExternalResourcesCommandName(): CommandNameAndTitle {
	return {
		name: 'Запретить работу с внешними ресурсами',
		title: 'Запретить работу с внешними ресурсами'
	};
}

/**
 * Получить название и заголовок для команды инициализации данных
 */
export function getInitializeCommandName(): CommandNameAndTitle {
	return {
		name: 'Инициализировать данные',
		title: 'Инициализировать данные'
	};
}

/**
 * Получить название и заголовок для команды выгрузки информационной базы в dt
 */
export function getDumpInfobaseToDtCommandName(): CommandNameAndTitle {
	return {
		name: 'Выгрузить в dt',
		title: 'Выгрузить в dt'
	};
}

/**
 * Получить название и заголовок для команды загрузки информационной базы из dt
 */
export function getLoadInfobaseFromDtCommandName(): CommandNameAndTitle {
	return {
		name: 'Загрузить из dt',
		title: 'Загрузить из dt'
	};
}

/**
 * Получить название и заголовок для команды установки зависимостей
 */
export function getInstallDependenciesCommandName(): CommandNameAndTitle {
	return {
		name: 'Установить зависимости',
		title: 'Установить зависимости'
	};
}

/**
 * Получить название и заголовок для команды удаления зависимостей
 */
export function getRemoveDependenciesCommandName(): CommandNameAndTitle {
	return {
		name: 'Удалить зависимости',
		title: 'Удалить зависимости'
	};
}

/**
 * Получить название и заголовок для команды инициализации проекта (packagedef)
 */
export function getInitializePackagedefCommandName(): CommandNameAndTitle {
	return {
		name: 'Инициализировать проект',
		title: 'Инициализировать проект'
	};
}

/**
 * Получить название и заголовок для команды инициализации структуры проекта
 */
export function getInitializeProjectStructureCommandName(): CommandNameAndTitle {
	return {
		name: 'Инициализировать структуру проекта',
		title: 'Инициализировать структуру проекта'
	};
}

/**
 * Получить название и заголовок для команды установки OPM
 */
export function getUpdateOpmCommandName(): CommandNameAndTitle {
	return {
		name: 'Установить OPM',
		title: 'Установить OPM'
	};
}

/**
 * Получить название и заголовок для команды установки OneScript
 */
export function getInstallOneScriptCommandName(): CommandNameAndTitle {
	return {
		name: 'Установить OneScript',
		title: 'Установить OneScript'
	};
}

/**
 * Получить название и заголовок для команды настройки Git
 */
export function getSetupGitCommandName(): CommandNameAndTitle {
	return {
		name: 'Настроить Git',
		title: 'Настроить Git'
	};
}

/**
 * Получить название и заголовок для команды сборки конфигурации
 */
export function getBuildConfigurationCommandName(): CommandNameAndTitle {
	return {
		name: 'Собрать конфигурацию',
		title: 'Собрать конфигурацию'
	};
}

/**
 * Получить название и заголовок для команды сборки расширений
 */
export function getBuildExtensionsCommandName(): CommandNameAndTitle {
	return {
		name: 'Собрать расширения',
		title: 'Собрать расширения'
	};
}

/**
 * Получить название и заголовок для команды сборки внешней обработки
 */
export function getBuildExternalProcessorCommandName(): CommandNameAndTitle {
	return {
		name: 'Собрать внешнюю обработку',
		title: 'Собрать внешнюю обработку'
	};
}

/**
 * Получить название и заголовок для команды сборки внешнего отчета
 */
export function getBuildExternalReportCommandName(): CommandNameAndTitle {
	return {
		name: 'Собрать внешний отчет',
		title: 'Собрать внешний отчет'
	};
}

/**
 * Получить название и заголовок для команды разбора конфигурации
 */
export function getDecompileConfigurationCommandName(): CommandNameAndTitle {
	return {
		name: 'Разобрать конфигурацию',
		title: 'Разобрать конфигурацию'
	};
}

/**
 * Получить название и заголовок для команды разбора внешней обработки
 */
export function getDecompileExternalProcessorCommandName(): CommandNameAndTitle {
	return {
		name: 'Разобрать внешнюю обработку',
		title: 'Разобрать внешнюю обработку'
	};
}

/**
 * Получить название и заголовок для команды разбора внешнего отчета
 */
export function getDecompileExternalReportCommandName(): CommandNameAndTitle {
	return {
		name: 'Разобрать внешний отчет',
		title: 'Разобрать внешний отчет'
	};
}

/**
 * Получить название и заголовок для команды очистки кэша
 */
export function getClearCacheCommandName(): CommandNameAndTitle {
	return {
		name: 'Удалить кэш',
		title: 'Удалить кэш'
	};
}

/**
 * Получить название и заголовок для команды разбора расширения
 */
export function getDecompileExtensionCommandName(): CommandNameAndTitle {
	return {
		name: 'Разобрать расширение',
		title: 'Разобрать расширение'
	};
}

/**
 * Получить название и заголовок для команды запуска Предприятия
 */
export function getRunEnterpriseCommandName(): CommandNameAndTitle {
	return {
		name: '1С:Предприятие',
		title: 'Запустить Предприятие'
	};
}

/**
 * Получить название и заголовок для команды запуска Конфигуратора
 */
export function getRunDesignerCommandName(): CommandNameAndTitle {
	return {
		name: 'Конфигуратор',
		title: 'Запустить Конфигуратор'
	};
}

/**
 * Получить название и заголовок для команды XUnit тестов
 */
export function getXUnitTestsCommandName(): CommandNameAndTitle {
	return {
		name: 'XUnit тесты',
		title: 'XUnit тесты'
	};
}

/**
 * Получить название и заголовок для команды синтаксического контроля
 */
export function getSyntaxCheckCommandName(): CommandNameAndTitle {
	return {
		name: 'Синтаксический контроль',
		title: 'Синтаксический контроль'
	};
}

/**
 * Получить название и заголовок для команды Vanessa тестов
 */
export function getVanessaTestsCommandName(mode: 'normal' | 'currentFile' = 'normal'): CommandNameAndTitle {
	if (mode === 'currentFile') {
		return {
			name: 'Vanessa тесты (текущий файл)',
			title: 'Запустить текущий feature'
		};
	}
	return {
		name: 'Vanessa тесты',
		title: 'Vanessa тесты'
	};
}

/**
 * Получить название и заголовок для команды Allure отчета
 */
export function getAllureReportCommandName(): CommandNameAndTitle {
	return {
		name: 'Allure отчет',
		title: 'Allure отчет'
	};
}

// ============================================================================
// Команды для работы с конфигурацией
// ============================================================================

/**
 * Получить название и заголовок для команды загрузки конфигурации из src/cf
 */
export function getLoadConfigurationFromSrcCommandName(mode: 'init' | 'update' = 'update'): CommandNameAndTitle {
	if (mode === 'init') {
		return {
			name: 'Инициализация конфигурации',
			title: 'Загрузить конфигурацию из src/cf'
		};
	}
	return {
		name: 'Обновление конфигурации',
		title: 'Загрузить конфигурацию из src/cf'
	};
}

/**
 * Получить название и заголовок для команды выгрузки конфигурации в src/cf
 */
export function getDumpConfigurationToSrcCommandName(): CommandNameAndTitle {
	return {
		name: 'Выгрузить конфигурацию в src/cf',
		title: 'Выгрузить конфигурацию в src/cf'
	};
}

/**
 * Получить название и заголовок для команды инкрементальной выгрузки конфигурации в src/cf (только изменения)
 */
export function getDumpConfigurationIncrementToSrcCommandName(): CommandNameAndTitle {
	return {
		name: 'Выгрузить изменения в src/cf',
		title: 'Выгрузить изменения в src/cf'
	};
}

/**
 * Получить название и заголовок для команды выгрузки конфигурации в 1Cv8.cf
 */
export function getDumpConfigurationToCfCommandName(): CommandNameAndTitle {
	return {
		name: 'Выгрузить конфигурацию в 1Cv8.cf',
		title: 'Выгрузить конфигурацию в 1Cv8.cf'
	};
}

/**
 * Получить название и заголовок для команды выгрузки файла поставки в 1Cv8dist.cf
 */
export function getDumpConfigurationToDistCommandName(): CommandNameAndTitle {
	return {
		name: 'Выгрузить в 1Cv8dist.cf',
		title: 'Выгрузить в 1Cv8dist.cf'
	};
}

/**
 * Получить название и заголовок для команды инкрементальной загрузки конфигурации из src/cf (git diff)
 */
export function getLoadConfigurationIncrementFromSrcCommandName(): CommandNameAndTitle {
	return {
		name: 'Загрузить изменения (git diff)',
		title: 'Загрузить изменения (git diff)'
	};
}

/**
 * Получить название и заголовок для команды загрузки объектов конфигурации из файлов по списку в objlist.txt
 */
export function getLoadConfigurationFromFilesByListCommandName(): CommandNameAndTitle {
	return {
		name: 'Загрузить из objlist.txt',
		title: 'Загрузить из objlist.txt'
	};
}

// ============================================================================
// Команды для работы с расширениями
// ============================================================================

/**
 * Получить название и заголовок для команды загрузки расширений из src/cfe
 */
export function getLoadExtensionFromSrcCommandName(): CommandNameAndTitle {
	return {
		name: 'Загрузить расширения из src/cfe',
		title: 'Загрузить расширения из src/cfe'
	};
}

/**
 * Получить название и заголовок для команды загрузки расширения из *.cfe
 */
export function getLoadExtensionFromCfeCommandName(): CommandNameAndTitle {
	return {
		name: 'Загрузить расширение из *.cfe',
		title: 'Загрузить расширение из *.cfe'
	};
}

/**
 * Получить название и заголовок для команды выгрузки расширений в src/cfe
 */
export function getDumpExtensionToSrcCommandName(): CommandNameAndTitle {
	return {
		name: 'Выгрузить расширения в src/cfe',
		title: 'Выгрузить расширения в src/cfe'
	};
}

/**
 * Получить название и заголовок для команды выгрузки расширения в *.cfe
 */
export function getDumpExtensionToCfeCommandName(): CommandNameAndTitle {
	return {
		name: 'Выгрузить расширение в *.cfe',
		title: 'Выгрузить расширение в *.cfe'
	};
}

/**
 * Получить название и заголовок для команды сборки расширения
 */
export function getBuildExtensionCommandName(): CommandNameAndTitle {
	return {
		name: 'Собрать расширение',
		title: 'Собрать расширение'
	};
}

// ============================================================================
// Команды релиза (установка версий)
// ============================================================================

/**
 * Получить название и заголовок для команды установки версии конфигурации
 */
export function getSetVersionConfigurationCommandName(): CommandNameAndTitle {
	return {
		name: 'Конфигурации',
		title: 'Конфигурации'
	};
}

/**
 * Получить название и заголовок для команды установки версии всем расширениям
 */
export function getSetVersionAllExtensionsCommandName(): CommandNameAndTitle {
	return {
		name: 'Все',
		title: 'Все'
	};
}

/**
 * Получить название и заголовок для команды установки версии расширению
 * @param extensionName - Имя расширения для отображения
 */
export function getSetVersionExtensionCommandName(extensionName: string): CommandNameAndTitle {
	return {
		name: extensionName,
		title: extensionName
	};
}

/**
 * Получить название и заголовок для команды установки версии внешнему отчёту
 * @param reportName - Имя отчёта для отображения
 */
export function getSetVersionReportCommandName(reportName: string): CommandNameAndTitle {
	return {
		name: reportName,
		title: reportName
	};
}

/**
 * Получить название и заголовок для команды установки версии внешней обработке
 * @param processorName - Имя обработки для отображения
 */
export function getSetVersionProcessorCommandName(processorName: string): CommandNameAndTitle {
	return {
		name: processorName,
		title: processorName
	};
}

// ============================================================================
// Команды поддержки конфигурации (designer --additional)
// ============================================================================

/**
 * Получить название и заголовок для команды обновления конфигурации на поддержке (UpdateCfg)
 */
export function getUpdateCfgSupportCommandName(): CommandNameAndTitle {
	return {
		name: 'Загрузить из cf/cfu',
		title: 'Загрузить из cf/cfu'
	};
}

/**
 * Получить название и заголовок для команды снятия конфигурации с поддержки
 */
export function getDisableCfgSupportCommandName(): CommandNameAndTitle {
	return {
		name: 'Удалить',
		title: 'Удалить'
	};
}

/**
 * Получить название и заголовок для команды создания файла списка шаблонов конфигураций
 */
export function getCreateTemplateListFileCommandName(): CommandNameAndTitle {
	return {
		name: 'Создать файл списка шаблонов',
		title: 'Создать файл списка шаблонов'
	};
}

/**
 * Получить название и заголовок для команды создания файла описания комплекта поставки (edf) по шаблону
 */
export function getCreateDeliveryDescriptionFileCommandName(): CommandNameAndTitle {
	return {
		name: 'Создать файл описания шаблона поставки',
		title: 'Создать файл описания шаблона поставки'
	};
}

/**
 * Получить название и заголовок для команды создания комплекта поставки (/CreateDistributivePackage)
 */
export function getCreateDistributivePackageCommandName(): CommandNameAndTitle {
	return {
		name: 'Создать комплект',
		title: 'Создать комплект'
	};
}

/**
 * Получить название и заголовок для команды создания файлов поставки и обновления (cf/cfu)
 */
export function getCreateDistributionFilesCommandName(): CommandNameAndTitle {
	return {
		name: 'Создать файлы поставки и обновления (cf/cfu)',
		title: 'Создать файлы поставки и обновления (cf/cfu)'
	};
}
