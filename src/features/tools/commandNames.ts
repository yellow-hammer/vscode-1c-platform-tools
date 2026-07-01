/**
 * Утилиты для получения названий и заголовков команд
 * Используется для единообразного отображения команд в интерфейсе
 */

export interface CommandNameAndTitle {
	id: string;
	name: string;
	title: string;
}

/**
 * Получить название и заголовок для команды создания пустой информационной базы
 */
export function getCreateEmptyInfobaseCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.infobase.createEmpty',
		name: 'Создать пустую',
		title: 'Создать пустую'
	};
}

/**
 * Получить название и заголовок для команды обновления конфигурации в ИБ (vrunner updatedb).
 *
 * Применяет изменения основной конфигурации к БД информационной базы. Не затрагивает расширения —
 * для них есть отдельная команда «Обновить расширения в ИБ» (vrunner updateext).
 */
export function getUpdateConfigurationInInfobaseCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.infobase.updateInfobase',
		name: 'Обновить конфигурацию в ИБ',
		title: 'Обновить конфигурацию в ИБ'
	};
}

/**
 * Получить название и заголовок для команды обновления расширений в ИБ (vrunner updateext по всем).
 *
 * Применяет изменения каждого расширения из src/cfe/<имя> к БД информационной базы.
 */
export function getUpdateExtensionsInInfobaseCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.extensions.updateInInfobase',
		name: 'Обновить расширения в ИБ',
		title: 'Обновить расширения в ИБ'
	};
}

/**
 * Получить название и заголовок для команды загрузки конфигурации из *.cf
 */
export function getLoadConfigurationFromCfCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.configuration.loadFromCf',
		name: 'Загрузка конфигурации из CF',
		title: 'Загрузить конфигурацию из *.cf'
	};
}

/**
 * Получить название и заголовок для команды загрузки расширений
 */
export function getLoadExtensionsCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.extensions.loadFromSrc',
		name: 'Загрузка расширений',
		title: 'Загрузка расширений'
	};
}

/**
 * Получить название и заголовок для команды обновления базы данных
 */
export function getUpdateDatabaseCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.infobase.updateDatabase',
		name: 'Запустить обновление',
		title: 'Запустить обновление'
	};
}

/**
 * Получить название и заголовок для команды блокировки внешних ресурсов
 */
export function getBlockExternalResourcesCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.infobase.blockExternalResources',
		name: 'Запретить работу с внешними ресурсами',
		title: 'Запретить работу с внешними ресурсами'
	};
}

/**
 * Получить название и заголовок для команды инициализации данных
 */
export function getInitializeCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.infobase.initialize',
		name: 'Инициализировать данные',
		title: 'Инициализировать данные'
	};
}

/**
 * Получить название и заголовок для команды выгрузки информационной базы в dt
 */
export function getDumpInfobaseToDtCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.infobase.dumpToDt',
		name: 'Выгрузить в dt',
		title: 'Выгрузить в dt'
	};
}

/**
 * Получить название и заголовок для команды загрузки информационной базы из dt
 */
export function getLoadInfobaseFromDtCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.infobase.loadFromDt',
		name: 'Загрузить из dt',
		title: 'Загрузить из dt'
	};
}

/**
 * Получить название и заголовок для команды установки зависимостей
 */
export function getInstallDependenciesCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.dependencies.install',
		name: 'Установить зависимости',
		title: 'Установить зависимости'
	};
}

/**
 * Получить название и заголовок для команды удаления зависимостей
 */
export function getRemoveDependenciesCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.dependencies.remove',
		name: 'Удалить зависимости',
		title: 'Удалить зависимости'
	};
}

/**
 * Получить название и заголовок для команды инициализации проекта (packagedef)
 */
export function getInitializePackagedefCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.dependencies.initPackagedef',
		name: 'Инициализировать проект',
		title: 'Инициализировать проект'
	};
}

/**
 * Получить название и заголовок для команды инициализации структуры проекта
 */
export function getInitializeProjectStructureCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.dependencies.initProjectStructure',
		name: 'Инициализировать структуру проекта',
		title: 'Инициализировать структуру проекта'
	};
}

/**
 * Получить название и заголовок для команды добавления навыков разработки 1С (cc-1c-skills)
 */
export function getAddDevSkillsCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.service.addDevSkills',
		name: 'Добавить навыки разработки 1С (cc-1c-skills)',
		title: 'Добавить навыки разработки 1С (cc-1c-skills)'
	};
}

/**
 * Получить название и заголовок для команды добавления навыков расширения (команды и MCP)
 */
export function getAdd1cptSkillsCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.service.add1cptSkills',
		name: 'Добавить навыки расширения (команды и MCP)',
		title: 'Добавить навыки расширения (команды и MCP)'
	};
}

/**
 * Получить название и заголовок для команды установки OPM
 */
export function getUpdateOpmCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.service.updateOpm',
		name: 'Установить пакетный менеджер OneScript',
		title: 'Установить пакетный менеджер OneScript'
	};
}

/**
 * Получить название и заголовок для команды установки OneScript
 */
export function getInstallOneScriptCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.service.installOneScript',
		name: 'Установить OneScript',
		title: 'Установить OneScript'
	};
}

/**
 * Получить название и заголовок для команды настройки Git
 */
export function getSetupGitCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.service.setupGit',
		name: 'Настроить Git',
		title: 'Настроить Git'
	};
}

/**
 * Получить название и заголовок для команды сборки конфигурации
 */
export function getBuildConfigurationCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.configuration.build',
		name: 'Собрать конфигурацию',
		title: 'Собрать конфигурацию'
	};
}

/**
 * Получить название и заголовок для команды сборки расширений
 */
export function getBuildExtensionsCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.extensions.build',
		name: 'Собрать расширения',
		title: 'Собрать расширения'
	};
}

/**
 * Получить название и заголовок для команды сборки внешней обработки
 */
export function getBuildExternalProcessorCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.artifacts.buildProcessor',
		name: 'Собрать внешнюю обработку',
		title: 'Собрать внешнюю обработку'
	};
}

/**
 * Получить название и заголовок для команды сборки внешнего отчета
 */
export function getBuildExternalReportCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.artifacts.buildReport',
		name: 'Собрать внешний отчет',
		title: 'Собрать внешний отчет'
	};
}

/**
 * Получить название и заголовок для команды разбора конфигурации
 */
export function getDecompileConfigurationCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.configuration.decompile',
		name: 'Разобрать конфигурацию',
		title: 'Разобрать конфигурацию'
	};
}

/**
 * Получить название и заголовок для команды разбора внешней обработки
 */
export function getDecompileExternalProcessorCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.artifacts.decompileProcessor',
		name: 'Разобрать внешнюю обработку',
		title: 'Разобрать внешнюю обработку'
	};
}

/**
 * Получить название и заголовок для команды разбора внешнего отчета
 */
export function getDecompileExternalReportCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.artifacts.decompileReport',
		name: 'Разобрать внешний отчет',
		title: 'Разобрать внешний отчет'
	};
}

/**
 * Получить название и заголовок для команды очистки кэша
 */
export function getClearCacheCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.externalFiles.clearCache',
		name: 'Удалить кэш',
		title: 'Удалить кэш'
	};
}

/**
 * Получить название и заголовок для команды разбора расширения
 */
export function getDecompileExtensionCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.extensions.decompile',
		name: 'Разобрать расширение',
		title: 'Разобрать расширение'
	};
}

/**
 * Получить название и заголовок для команды запуска Предприятия
 */
export function getRunEnterpriseCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.run.enterprise',
		name: '1С:Предприятие',
		title: 'Запустить Предприятие'
	};
}

/**
 * Получить название и заголовок для команды запуска Конфигуратора
 */
export function getRunDesignerCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.run.designer',
		name: 'Конфигуратор',
		title: 'Запустить Конфигуратор'
	};
}

/**
 * Получить название и заголовок для команды XUnit тестов
 */
export function getXUnitTestsCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.test.xunit',
		name: 'XUnit тесты',
		title: 'XUnit тесты'
	};
}

/**
 * Получить название и заголовок для команды синтаксического контроля
 */
export function getSyntaxCheckCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.test.syntaxCheck',
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
			id: '1c-platform-tools.test.vanessa',
			name: 'Vanessa тесты (текущий файл)',
			title: 'Запустить текущий feature'
		};
	}
	return {
		id: '1c-platform-tools.test.vanessa',
		name: 'Vanessa тесты',
		title: 'Vanessa тесты'
	};
}

/**
 * Получить название и заголовок для команды Allure отчета
 */
export function getAllureReportCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.test.allure',
		name: 'Allure отчет',
		title: 'Allure отчет'
	};
}

/**
 * Получить название и заголовок для команды YAxUnit тестов
 */
export function getYAxUnitTestsCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.test.yaxunit',
		name: 'YAxUnit тесты',
		title: 'YAxUnit тесты'
	};
}

/**
 * Получить название и заголовок для команды сборки unit тестов
 */
export function getBuildTestEpfCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.test.buildEpf',
		name: 'Собрать unit тесты',
		title: 'Собрать unit тесты'
	};
}

/**
 * Получить название и заголовок для команды разборки unit тестов
 */
export function getDecompileTestEpfCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.test.decompileEpf',
		name: 'Разобрать unit тесты',
		title: 'Разобрать unit тесты'
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
			id: '1c-platform-tools.configuration.loadFromSrc.init',
			name: 'Инициализация конфигурации',
			title: 'Загрузить конфигурацию из src/cf'
		};
	}
	return {
		id: '1c-platform-tools.configuration.loadFromSrc',
		name: 'Обновление конфигурации',
		title: 'Загрузить конфигурацию из src/cf'
	};
}

/**
 * Получить название и заголовок для команды выгрузки конфигурации в src/cf
 */
export function getDumpConfigurationToSrcCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.configuration.dumpToSrc',
		name: 'Выгрузить конфигурацию в src/cf',
		title: 'Выгрузить конфигурацию в src/cf'
	};
}

/**
 * Получить название и заголовок для команды инкрементальной выгрузки конфигурации в src/cf (только изменения)
 */
export function getDumpConfigurationIncrementToSrcCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.configuration.dumpIncrementToSrc',
		name: 'Выгрузить изменения в src/cf',
		title: 'Выгрузить изменения в src/cf'
	};
}

/**
 * Получить название и заголовок для команды выгрузки конфигурации в 1Cv8.cf
 */
export function getDumpConfigurationToCfCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.configuration.dumpToCf',
		name: 'Выгрузить конфигурацию в 1Cv8.cf',
		title: 'Выгрузить конфигурацию в 1Cv8.cf'
	};
}

/**
 * Получить название и заголовок для команды выгрузки файла поставки в 1Cv8dist.cf
 */
export function getDumpConfigurationToDistCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.configuration.dumpToDist',
		name: 'Выгрузить в 1Cv8dist.cf',
		title: 'Выгрузить в 1Cv8dist.cf'
	};
}

/**
 * Получить название и заголовок для команды инкрементальной загрузки конфигурации из src/cf (git diff)
 */
export function getLoadConfigurationIncrementFromSrcCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.configuration.loadIncrementFromSrc',
		name: 'Загрузить изменения (git diff)',
		title: 'Загрузить изменения (git diff)'
	};
}

/**
 * Получить название и заголовок для команды загрузки объектов конфигурации из файлов по списку в objlist.txt
 */
export function getLoadConfigurationFromFilesByListCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.configuration.loadFromFilesByList',
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
		id: '1c-platform-tools.extensions.loadFromSrc',
		name: 'Загрузить расширения из src/cfe',
		title: 'Загрузить расширения из src/cfe'
	};
}

/**
 * Получить название и заголовок для команды частичной загрузки расширения из списка в objlist.txt
 */
export function getLoadExtensionFromFilesByListCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.extensions.loadFromFilesByList',
		name: 'Загрузить из objlist.txt',
		title: 'Загрузить из objlist.txt'
	};
}

/**
 * Получить название и заголовок для команды загрузки расширения из *.cfe
 */
export function getLoadExtensionFromCfeCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.extensions.loadFromCfe',
		name: 'Загрузить расширение из *.cfe',
		title: 'Загрузить расширение из *.cfe'
	};
}

/**
 * Получить название и заголовок для команды выгрузки расширений в src/cfe
 */
export function getDumpExtensionToSrcCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.extensions.dumpToSrc',
		name: 'Выгрузить расширения в src/cfe',
		title: 'Выгрузить расширения в src/cfe'
	};
}

/**
 * Получить название и заголовок для команды выгрузки расширения в *.cfe
 */
export function getDumpExtensionToCfeCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.extensions.dumpToCfe',
		name: 'Выгрузить расширение в *.cfe',
		title: 'Выгрузить расширение в *.cfe'
	};
}

/**
 * Получить название и заголовок для команды сборки расширения
 */
export function getBuildExtensionCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.extensions.build',
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
		id: '1c-platform-tools.setVersion.configuration',
		name: 'Конфигурации',
		title: 'Конфигурации'
	};
}

/**
 * Получить название и заголовок для команды установки версии расширениям
 */
export function getSetVersionExtensionCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.setVersion.extension',
		name: 'Расширения',
		title: 'Расширения'
	};
}

/**
 * Получить название и заголовок для команды установки версии внешнему отчёту
 * @param reportName - Имя отчёта для отображения
 */
export function getSetVersionReportCommandName(reportName: string): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.setVersion.report',
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
		id: '1c-platform-tools.setVersion.processor',
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
		id: '1c-platform-tools.support.updateCfg',
		name: 'Загрузить из cf/cfu',
		title: 'Загрузить из cf/cfu'
	};
}

/**
 * Получить название и заголовок для команды снятия конфигурации с поддержки
 */
export function getDisableCfgSupportCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.support.disableCfg',
		name: 'Удалить',
		title: 'Удалить'
	};
}

/**
 * Получить название и заголовок для команды создания файла списка шаблонов конфигураций
 */
export function getCreateTemplateListFileCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.support.createTemplateListFile',
		name: 'Создать файл списка шаблонов',
		title: 'Создать файл списка шаблонов'
	};
}

/**
 * Получить название и заголовок для команды создания файла описания комплекта поставки (edf) по шаблону
 */
export function getCreateDeliveryDescriptionFileCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.support.createDeliveryDescriptionFile',
		name: 'Создать файл описания шаблона поставки',
		title: 'Создать файл описания шаблона поставки'
	};
}

/**
 * Получить название и заголовок для команды создания комплекта поставки (/CreateDistributivePackage)
 */
export function getCreateDistributivePackageCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.support.createDistributivePackage',
		name: 'Создать комплект',
		title: 'Создать комплект'
	};
}

/**
 * Получить название и заголовок для команды создания файлов поставки и обновления (cf/cfu)
 */
export function getCreateDistributionFilesCommandName(): CommandNameAndTitle {
	return {
		id: '1c-platform-tools.support.createDistributionFiles',
		name: 'Создать файлы поставки и обновления (cf/cfu)',
		title: 'Создать файлы поставки и обновления (cf/cfu)'
	};
}
