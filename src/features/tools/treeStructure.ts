/**
 * Единый источник данных для дерева команд и списка избранного.
 * Добавление новой команды: добавить запись в соответствующую группу ниже.
 */

import {
	getCreateEmptyInfobaseCommandName,
	getUpdateConfigurationInInfobaseCommandName,
	getUpdateExtensionsInInfobaseCommandName,
	getUpdateDatabaseCommandName,
	getBlockExternalResourcesCommandName,
	getInitializeCommandName,
	getDumpInfobaseToDtCommandName,
	getLoadInfobaseFromDtCommandName,
	getInstallDependenciesCommandName,
	getRemoveDependenciesCommandName,
	getInitializePackagedefCommandName,
	getInitializeProjectStructureCommandName,
	getInstallOneScriptCommandName,
	getSetupGitCommandName,
	getUpdateOpmCommandName,
	getLoadConfigurationFromSrcCommandName,
	getLoadConfigurationIncrementFromSrcCommandName,
	getLoadConfigurationFromFilesByListCommandName,
	getLoadConfigurationFromCfCommandName,
	getDumpConfigurationToSrcCommandName,
	getDumpConfigurationIncrementToSrcCommandName,
	getDumpConfigurationToCfCommandName,
	getDumpConfigurationToDistCommandName,
	getBuildConfigurationCommandName,
	getDecompileConfigurationCommandName,
	getLoadExtensionFromSrcCommandName,
	getLoadExtensionFromFilesByListCommandName,
	getLoadExtensionFromCfeCommandName,
	getDumpExtensionToSrcCommandName,
	getDumpExtensionToCfeCommandName,
	getBuildExtensionCommandName,
	getDecompileExtensionCommandName,
	getBuildExternalProcessorCommandName,
	getDecompileExternalProcessorCommandName,
	getBuildExternalReportCommandName,
	getDecompileExternalReportCommandName,
	getClearCacheCommandName,
	getRunEnterpriseCommandName,
	getRunDesignerCommandName,
	getXUnitTestsCommandName,
	getSyntaxCheckCommandName,
	getVanessaTestsCommandName,
	getAllureReportCommandName,
	getYAxUnitTestsCommandName,
	getBuildTestEpfCommandName,
	getDecompileTestEpfCommandName,
	getSetVersionConfigurationCommandName,
	getSetVersionExtensionCommandName,
	getUpdateCfgSupportCommandName,
	getDisableCfgSupportCommandName,
	getCreateTemplateListFileCommandName,
	getCreateDeliveryDescriptionFileCommandName,
	getCreateDistributivePackageCommandName,
	getCreateDistributionFilesCommandName,
	getAddDevSkillsCommandName,
	getAdd1cptSkillsCommandName
} from './commandNames';

/** Элемент команды в группе (одна строка в дереве и в списке избранного) */
export interface TreeCommandEntry {
	command: string;
	title: string;
	/** Подпись в дереве (с эмодзи) */
	treeLabel: string;
	/** Иконка для дерева (codicon, например 'comment-discussion') — опционально */
	icon?: string;
}

/** Состояние сворачивания группы по умолчанию */
export type TreeGroupCollapsibleState = 'collapsed' | 'expanded';

/** Группа команд (корневой узел дерева и раздел в настройке избранного) */
export interface TreeGroup {
	groupLabel: string;
	sectionType: string;
	/** Состояние сворачивания группы при отображении */
	defaultCollapsibleState: TreeGroupCollapsibleState;
	commands: TreeCommandEntry[];
}

/**
 * Единый список групп и команд для дерева команд и окна настройки избранного.
 * Добавление новой команды: добавить объект в commands нужной группы.
 */
export const TREE_GROUPS: TreeGroup[] = [
	{
		groupLabel: 'Информационные базы',
		sectionType: 'infobase',
		defaultCollapsibleState: 'collapsed',
		commands: [
			{ command: '1c-platform-tools.infobase.createEmpty', title: getCreateEmptyInfobaseCommandName().title, treeLabel: '➕ Создать пустую ИБ' },
			{ command: '1c-platform-tools.infobase.updateDatabase', title: getUpdateDatabaseCommandName().title, treeLabel: '🔄 Постобработка обновления' },
			{ command: '1c-platform-tools.infobase.blockExternalResources', title: getBlockExternalResourcesCommandName().title, treeLabel: '🚫 Запретить работу с внешними ресурсами' },
			{ command: '1c-platform-tools.infobase.initialize', title: getInitializeCommandName().title, treeLabel: '🚀 Инициализировать данные' },
			{ command: '1c-platform-tools.infobase.dumpToDt', title: getDumpInfobaseToDtCommandName().title, treeLabel: '📤 Выгрузить в dt' },
			{ command: '1c-platform-tools.infobase.loadFromDt', title: getLoadInfobaseFromDtCommandName().title, treeLabel: '📥 Загрузить из dt' },
		],
	},
	{
		groupLabel: 'Конфигурация',
		sectionType: 'configuration',
		defaultCollapsibleState: 'expanded',
		commands: [
			{ command: '1c-platform-tools.configuration.loadFromSrc', title: getLoadConfigurationFromSrcCommandName().title, treeLabel: '📥 Загрузить из src/cf' },
			{ command: '1c-platform-tools.configuration.loadIncrementFromSrc', title: getLoadConfigurationIncrementFromSrcCommandName().title, treeLabel: '📥 Загрузить изменения (git diff)' },
			{ command: '1c-platform-tools.configuration.loadFromFilesByList', title: getLoadConfigurationFromFilesByListCommandName().title, treeLabel: '📥 Загрузить из objlist.txt' },
			{ command: '1c-platform-tools.configuration.loadFromCf', title: getLoadConfigurationFromCfCommandName().title, treeLabel: '📥 Загрузить из 1Cv8.cf' },
			{ command: '1c-platform-tools.infobase.updateInfobase', title: getUpdateConfigurationInInfobaseCommandName().title, treeLabel: '🔄 Обновить конфигурацию в ИБ' },
			{ command: '1c-platform-tools.configuration.dumpToSrc', title: getDumpConfigurationToSrcCommandName().title, treeLabel: '📤 Выгрузить в src/cf' },
			{ command: '1c-platform-tools.configuration.dumpIncrementToSrc', title: getDumpConfigurationIncrementToSrcCommandName().title, treeLabel: '📤 Выгрузить изменения в src/cf' },
			{ command: '1c-platform-tools.configuration.dumpToCf', title: getDumpConfigurationToCfCommandName().title, treeLabel: '📤 Выгрузить в 1Cv8.cf' },
			{ command: '1c-platform-tools.configuration.build', title: getBuildConfigurationCommandName().title, treeLabel: '🔨 Собрать 1Cv8.cf из src/cf' },
			{ command: '1c-platform-tools.configuration.decompile', title: getDecompileConfigurationCommandName().title, treeLabel: '🔓 Разобрать 1Cv8.cf в src/cf' },
		],
	},
	{
		groupLabel: 'Расширения',
		sectionType: 'extension',
		defaultCollapsibleState: 'expanded',
		commands: [
			{ command: '1c-platform-tools.extensions.loadFromSrc', title: getLoadExtensionFromSrcCommandName().title, treeLabel: '📥 Загрузить из src/cfe' },
			{ command: '1c-platform-tools.extensions.loadFromFilesByList', title: getLoadExtensionFromFilesByListCommandName().title, treeLabel: '📥 Загрузить из objlist.txt' },
			{ command: '1c-platform-tools.extensions.loadFromCfe', title: getLoadExtensionFromCfeCommandName().title, treeLabel: '📥 Загрузить из *.cfe' },
			{ command: '1c-platform-tools.extensions.updateInInfobase', title: getUpdateExtensionsInInfobaseCommandName().title, treeLabel: '🔄 Обновить расширения в ИБ' },
			{ command: '1c-platform-tools.extensions.dumpToSrc', title: getDumpExtensionToSrcCommandName().title, treeLabel: '📤 Выгрузить в src/cfe' },
			{ command: '1c-platform-tools.extensions.dumpToCfe', title: getDumpExtensionToCfeCommandName().title, treeLabel: '📤 Выгрузить в *.cfe' },
			{ command: '1c-platform-tools.extensions.build', title: getBuildExtensionCommandName().title, treeLabel: '🔨 Собрать *.cfe из src/cfe' },
			{ command: '1c-platform-tools.extensions.decompile', title: getDecompileExtensionCommandName().title, treeLabel: '🔓 Разобрать *.cfe в src/cfe' },
		],
	},
	{
		groupLabel: 'Внешние файлы',
		sectionType: 'externalFile',
		defaultCollapsibleState: 'collapsed',
		commands: [
			{ command: '1c-platform-tools.externalProcessors.build', title: getBuildExternalProcessorCommandName().title, treeLabel: '🔨 Собрать внешнюю обработку' },
			{ command: '1c-platform-tools.externalReports.build', title: getBuildExternalReportCommandName().title, treeLabel: '🔨 Собрать внешний отчет' },
			{ command: '1c-platform-tools.test.buildEpf', title: getBuildTestEpfCommandName().title, treeLabel: '🔨 Собрать unit тесты' },
			{ command: '1c-platform-tools.externalProcessors.decompile', title: getDecompileExternalProcessorCommandName().title, treeLabel: '🔓 Разобрать внешнюю обработку' },
			{ command: '1c-platform-tools.externalReports.decompile', title: getDecompileExternalReportCommandName().title, treeLabel: '🔓 Разобрать внешний отчет' },
			{ command: '1c-platform-tools.test.decompileEpf', title: getDecompileTestEpfCommandName().title, treeLabel: '🔓 Разобрать unit тесты' },
			{ command: '1c-platform-tools.externalFiles.clearCache', title: getClearCacheCommandName().title, treeLabel: '🗑️ Удалить кэш' },
		],
	},
	{
		groupLabel: 'Поддержка',
		sectionType: 'support',
		defaultCollapsibleState: 'collapsed',
		commands: [
			{ command: '1c-platform-tools.configuration.dumpToDist', title: getDumpConfigurationToDistCommandName().title, treeLabel: '📤 Выгрузить в 1Cv8dist.cf' },
			{ command: '1c-platform-tools.support.updateCfg', title: getUpdateCfgSupportCommandName().title, treeLabel: '📥 Загрузить из cf/cfu' },
			{ command: '1c-platform-tools.support.disableCfgSupport', title: getDisableCfgSupportCommandName().title, treeLabel: '🗑️ Удалить' },
		],
	},
	{
		groupLabel: 'Поставка',
		sectionType: 'delivery',
		defaultCollapsibleState: 'collapsed',
		commands: [
			{ command: '1c-platform-tools.support.createDeliveryDescriptionFile', title: getCreateDeliveryDescriptionFileCommandName().title, treeLabel: '📄 Создать файл описания шаблона поставки' },
			{ command: '1c-platform-tools.support.createDistributionFiles', title: getCreateDistributionFilesCommandName().title, treeLabel: '📦 Создать файлы поставки и обновления (cf/cfu)' },
			{ command: '1c-platform-tools.support.createDistributivePackage', title: getCreateDistributivePackageCommandName().title, treeLabel: '📦 Создать комплект' },
			{ command: '1c-platform-tools.support.createTemplateListFile', title: getCreateTemplateListFileCommandName().title, treeLabel: '📄 Создать файл списка шаблонов' },
		],
	},
	{
		groupLabel: 'Зависимости',
		sectionType: 'dependency',
		defaultCollapsibleState: 'collapsed',
		commands: [
			{ command: '1c-platform-tools.dependencies.initializePackagedef', title: getInitializePackagedefCommandName().title, treeLabel: '📝 Инициализировать проект' },
			{ command: '1c-platform-tools.dependencies.initializeProjectStructure', title: getInitializeProjectStructureCommandName().title, treeLabel: '📁 Инициализировать структуру проекта' },
			{ command: '1c-platform-tools.dependencies.setupGit', title: getSetupGitCommandName().title, treeLabel: '🔧 Настроить Git' },
			{ command: '1c-platform-tools.dependencies.installOscript', title: getInstallOneScriptCommandName().title, treeLabel: '📦 Установить OneScript' },
			{ command: '1c-platform-tools.dependencies.updateOpm', title: getUpdateOpmCommandName().title, treeLabel: '📦 Установить пакетный менеджер' },
			{ command: '1c-platform-tools.dependencies.install', title: getInstallDependenciesCommandName().title, treeLabel: '📦 Установить зависимости' },
			{ command: '1c-platform-tools.dependencies.remove', title: getRemoveDependenciesCommandName().title, treeLabel: '🗑️ Удалить зависимости' },
		],
	},
	{
		groupLabel: 'Запуск',
		sectionType: 'run',
		defaultCollapsibleState: 'expanded',
		commands: [
			{ command: '1c-platform-tools.run.enterprise', title: getRunEnterpriseCommandName().title, treeLabel: '▶️ Запустить Предприятие' },
			{ command: '1c-platform-tools.run.designer', title: getRunDesignerCommandName().title, treeLabel: '▶️ Запустить Конфигуратор' },
		],
	},
	{
		groupLabel: 'Тестирование',
		sectionType: 'test',
		defaultCollapsibleState: 'collapsed',
		commands: [
			{ command: '1c-platform-tools.test.xunit', title: getXUnitTestsCommandName().title, treeLabel: '🧪 XUnit тесты' },
			{ command: '1c-platform-tools.test.syntaxCheck', title: getSyntaxCheckCommandName().title, treeLabel: '🧪 Синтаксический контроль' },
			{ command: '1c-platform-tools.test.vanessa', title: getVanessaTestsCommandName('normal').title, treeLabel: '🧪 Vanessa тесты' },
			{ command: '1c-platform-tools.test.yaxunit', title: getYAxUnitTestsCommandName().title, treeLabel: '🧪 YAxUnit тесты' },
			{ command: '1c-platform-tools.test.allure', title: getAllureReportCommandName().title, treeLabel: '📊 Allure отчет' },
		],
	},
	{
		groupLabel: 'Установить версию',
		sectionType: 'setVersion',
		defaultCollapsibleState: 'collapsed',
		commands: [
			{ command: '1c-platform-tools.setVersion.configuration', title: getSetVersionConfigurationCommandName().title, treeLabel: '🏷️ Конфигурации' },
			{ command: '1c-platform-tools.setVersion.extension', title: getSetVersionExtensionCommandName().title, treeLabel: '🏷️ Расширения' },
		],
	},
	{
		groupLabel: 'Служебные файлы',
		sectionType: 'serviceFiles',
		defaultCollapsibleState: 'collapsed',
		commands: [
			{ command: '1c-platform-tools.serviceFiles.create', title: 'Создать служебные файлы', treeLabel: 'Создать служебные файлы' },
			{ command: '1c-platform-tools.serviceFiles.createRecommendedSet', title: 'Создать базовый набор', treeLabel: 'Базовый набор' },
			{ command: '1c-platform-tools.serviceFiles.createGitignore', title: 'Создать .gitignore', treeLabel: '.gitignore' },
			{ command: '1c-platform-tools.serviceFiles.createGitattributes', title: 'Создать .gitattributes', treeLabel: '.gitattributes' },
			{ command: '1c-platform-tools.serviceFiles.createEnvJson', title: 'Создать env.json', treeLabel: 'env.json' },
		],
	},
	{
		groupLabel: 'Навыки для AI',
		sectionType: 'skills',
		defaultCollapsibleState: 'collapsed',
		commands: [
			{ command: '1c-platform-tools.skills.addDevSkills', title: getAddDevSkillsCommandName().title, treeLabel: '📐 Добавить навыки разработки 1С (cc-1c-skills)' },
			{ command: '1c-platform-tools.skills.add1cpt', title: getAdd1cptSkillsCommandName().title, treeLabel: '🤖 Добавить навыки расширения (команды и MCP)' },
		],
	},
	{
		groupLabel: 'Помощь и поддержка',
		sectionType: 'helpAndSupport',
		defaultCollapsibleState: 'collapsed',
		commands: [
			{ command: '1c-platform-tools.getStarted.open', title: 'С чего начать?', treeLabel: 'С чего начать?' },
			{ command: '1c-platform-tools.help.openCreateIssue', title: 'Сообщить о проблемах', treeLabel: 'Сообщить о проблемах', icon: 'comment-discussion' },
			{ command: '1c-platform-tools.help.openWriteReview', title: 'Написать отзыв', treeLabel: 'Написать отзыв', icon: 'feedback' },
			{ command: '1c-platform-tools.help.openSponsor', title: 'Стать спонсором', treeLabel: 'Стать спонсором', icon: 'heart' },
		],
	},
];
