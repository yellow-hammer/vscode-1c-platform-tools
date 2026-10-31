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
	getLockSessionsCommandName,
	getUnlockSessionsCommandName,
	getKillSessionsCommandName,
	getCheckSessionsClosedCommandName,
	getListSessionsCommandName,
	getLockScheduledJobsCommandName,
	getUnlockScheduledJobsCommandName,
	getInstallDependenciesCommandName,
	getRemoveDependenciesCommandName,
	getInitializePackagedefCommandName,
	getInitializeProjectStructureCommandName,
	getInstallOneScriptCommandName,
	getSelectOneScriptCommandName,
	getBuildPackageCommandName,
	getInstallPackageCommandName,
	getOneScriptTestsCommandName,
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
	getEdtImportCommandName,
	getEdtExportCommandName,
	getEdtValidateCommandName,
	getEdtFormatCommandName,
	getEdtSortCommandName,
	getEdtProjectInfoCommandName,
	getRunEdtCommandName,
	getConvertSourcesCommandName,
	getConvertExtensionSourcesCommandName,
	getVanessaTestsCommandName,
	getAllureReportCommandName,
	getYAxUnitTestsCommandName,
	getMutationTestingCommandName,
	getLoadTestExtensionsCommandName,
	getBuildTestExtensionsCommandName,
	getDumpTestExtensionsCommandName,
	getDecompileTestExtensionsCommandName,
	getAddYaxunitCommandName,
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
	getConfigureCursorMcpCommandName,
	getAddDevSkillsCommandName,
	getAdd1cptSkillsCommandName,
	getAddOnescriptSkillsCommandName,
	getAddVanessaAutomationSkillsCommandName,
	getAddYaxunitSkillsCommandName,
	getAddXunitSkillsCommandName
} from './commandNames';
import type { ProjectKind } from '../../shared/projectKind';

/** Формат исходников активной конфигурации: выгрузка конфигуратора или проект 1С:EDT. */
export type TreeSourceFormat = 'designer' | 'edt';

/**
 * Черта проекта, от которой зависит состав дерева: проект 1С, проект OneScript
 * или пакет OneScript. Пакетом собирается проект OneScript и проект 1С, чей
 * `packagedef` объявляет классы, модули или исполняемый файл.
 */
export type TreeProjectTrait = 'onec' | 'onescript' | 'package';

/** Только у проекта 1С. */
const ONEC: readonly TreeProjectTrait[] = ['onec'];

/** У проекта любого вида. */
const ANY: readonly TreeProjectTrait[] = ['onec', 'onescript'];

/** У проекта, который собирается пакетом OneScript. */
const PACKAGE: readonly TreeProjectTrait[] = ['package'];

/** Элемент команды в группе (одна строка в дереве и в списке избранного) */
export interface TreeCommandEntry {
	command: string;
	title: string;
	/** Подпись в дереве (с эмодзи) */
	treeLabel: string;
	/** Форматы исходников, у которых команда есть в дереве; без ограничения показывается всегда */
	formats?: readonly TreeSourceFormat[];
	/** Черты проекта, у которых команда есть в дереве; без ограничения как у группы */
	projects?: readonly TreeProjectTrait[];
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
	/** Черты проекта, у которых группа есть в дереве */
	projects: readonly TreeProjectTrait[];
	commands: TreeCommandEntry[];
}

/**
 * Единый список групп и команд для дерева команд и окна настройки избранного.
 * Добавление новой команды: добавить объект в commands нужной группы.
 */
export const TREE_GROUPS: TreeGroup[] = [
	{
		groupLabel: 'Информационная база',
		sectionType: 'infobase',
		defaultCollapsibleState: 'collapsed',
		projects: ONEC,
		commands: [
			{ command: '1c-platform-tools.infobase.create', title: getCreateEmptyInfobaseCommandName().title, treeLabel: '➕ Создать пустую ИБ' },
			{ command: '1c-platform-tools.infobase.runUpdateHandlers', title: getUpdateDatabaseCommandName().title, treeLabel: '🔄 Выполнить обработчики обновления' },
			{ command: '1c-platform-tools.infobase.blockExternalResources', title: getBlockExternalResourcesCommandName().title, treeLabel: '🚫 Запретить работу с внешними ресурсами' },
			{ command: '1c-platform-tools.infobase.initialize', title: getInitializeCommandName().title, treeLabel: '🚀 Инициализировать данные' },
			{ command: '1c-platform-tools.infobase.dumpDt', title: getDumpInfobaseToDtCommandName().title, treeLabel: '📤 Выгрузить в dt' },
			{ command: '1c-platform-tools.infobase.restoreDt', title: getLoadInfobaseFromDtCommandName().title, treeLabel: '📥 Загрузить из dt' },
		],
	},
	{
		groupLabel: 'Конфигурация',
		sectionType: 'configuration',
		defaultCollapsibleState: 'collapsed',
		projects: ONEC,
		commands: [
			{ command: '1c-platform-tools.cf.load', title: getLoadConfigurationFromSrcCommandName().title, treeLabel: '📥 Загрузить из исходного кода'},
			{ command: '1c-platform-tools.cf.loadIncrement', title: getLoadConfigurationIncrementFromSrcCommandName().title, treeLabel: '📥 Загрузить изменения (git diff)' , formats: ['designer']},
			{ command: '1c-platform-tools.cf.loadByList', title: getLoadConfigurationFromFilesByListCommandName().title, treeLabel: '📥 Загрузить из objlist.txt' , formats: ['designer']},
			{ command: '1c-platform-tools.cf.loadFile', title: getLoadConfigurationFromCfCommandName().title, treeLabel: '📥 Загрузить из 1Cv8.cf' },
			{ command: '1c-platform-tools.infobase.updateDb', title: getUpdateConfigurationInInfobaseCommandName().title, treeLabel: '🔄 Обновить конфигурацию в ИБ' },
			{ command: '1c-platform-tools.cf.dump', title: getDumpConfigurationToSrcCommandName().title, treeLabel: '📤 Выгрузить в исходный код'},
			{ command: '1c-platform-tools.cf.dumpIncrement', title: getDumpConfigurationIncrementToSrcCommandName().title, treeLabel: '📤 Выгрузить изменения в исходный код' , formats: ['designer']},
			{ command: '1c-platform-tools.cf.unload', title: getDumpConfigurationToCfCommandName().title, treeLabel: '📤 Выгрузить в 1Cv8.cf' },
			{ command: '1c-platform-tools.cf.compile', title: getBuildConfigurationCommandName().title, treeLabel: '🔨 Собрать 1Cv8.cf из исходного кода'},
			{ command: '1c-platform-tools.cf.decompile', title: getDecompileConfigurationCommandName().title, treeLabel: '🔓 Разобрать 1Cv8.cf в исходный код'},
			{ command: '1c-platform-tools.cf.convert', title: getConvertSourcesCommandName().title, treeLabel: '🔀 Конвертировать исходный код (EDT ↔ конфигуратор)' },
		],
	},
	{
		groupLabel: 'Расширения',
		sectionType: 'extension',
		defaultCollapsibleState: 'collapsed',
		projects: ONEC,
		commands: [
			{ command: '1c-platform-tools.cfe.load', title: getLoadExtensionFromSrcCommandName().title, treeLabel: '📥 Загрузить из исходного кода'},
			{ command: '1c-platform-tools.cfe.loadByList', title: getLoadExtensionFromFilesByListCommandName().title, treeLabel: '📥 Загрузить из objlist.txt' , formats: ['designer']},
			{ command: '1c-platform-tools.cfe.loadFile', title: getLoadExtensionFromCfeCommandName().title, treeLabel: '📥 Загрузить из *.cfe' },
			{ command: '1c-platform-tools.cfe.updateDb', title: getUpdateExtensionsInInfobaseCommandName().title, treeLabel: '🔄 Обновить расширения в ИБ' },
			{ command: '1c-platform-tools.cfe.dump', title: getDumpExtensionToSrcCommandName().title, treeLabel: '📤 Выгрузить в исходный код'},
			{ command: '1c-platform-tools.cfe.unload', title: getDumpExtensionToCfeCommandName().title, treeLabel: '📤 Выгрузить в *.cfe' },
			{ command: '1c-platform-tools.cfe.compile', title: getBuildExtensionCommandName().title, treeLabel: '🔨 Собрать *.cfe из исходного кода'},
			{ command: '1c-platform-tools.cfe.decompile', title: getDecompileExtensionCommandName().title, treeLabel: '🔓 Разобрать *.cfe в исходный код'},
			{ command: '1c-platform-tools.cfe.convert', title: getConvertExtensionSourcesCommandName().title, treeLabel: '🔀 Конвертировать исходный код (EDT ↔ конфигуратор)' },
		],
	},
	{
		groupLabel: 'Внешние файлы',
		sectionType: 'externalFile',
		defaultCollapsibleState: 'collapsed',
		projects: ONEC,
		commands: [
			{ command: '1c-platform-tools.epf.compileProcessor', title: getBuildExternalProcessorCommandName().title, treeLabel: '🔨 Собрать обработки' },
			{ command: '1c-platform-tools.epf.compileReport', title: getBuildExternalReportCommandName().title, treeLabel: '🔨 Собрать отчёты' },
			{ command: '1c-platform-tools.epf.decompileProcessor', title: getDecompileExternalProcessorCommandName().title, treeLabel: '🔓 Разобрать обработки' },
			{ command: '1c-platform-tools.epf.decompileReport', title: getDecompileExternalReportCommandName().title, treeLabel: '🔓 Разобрать отчёты' },
			{ command: '1c-platform-tools.epf.clearCache', title: getClearCacheCommandName().title, treeLabel: '🗑️ Удалить кэш' },
		],
	},
	{
		groupLabel: 'EDT',
		sectionType: 'edt',
		defaultCollapsibleState: 'collapsed',
		projects: ONEC,
		commands: [
			{ command: '1c-platform-tools.edt.import', title: getEdtImportCommandName().title, treeLabel: '📥 Импортировать в проект EDT' , formats: ['designer']},
			{ command: '1c-platform-tools.edt.export', title: getEdtExportCommandName().title, treeLabel: '📤 Выгрузить проект EDT в XML' , formats: ['edt']},
			{ command: '1c-platform-tools.edt.formatModules', title: getEdtFormatCommandName().title, treeLabel: '🧹 Форматировать модули' , formats: ['edt']},
			{ command: '1c-platform-tools.edt.sortProject', title: getEdtSortCommandName().title, treeLabel: '🔤 Сортировать объекты' , formats: ['edt']},
			{ command: '1c-platform-tools.edt.projectInfo', title: getEdtProjectInfoCommandName().title, treeLabel: 'ℹ️ Сведения о проекте' , formats: ['edt']},
		],
	},
	{
		groupLabel: 'Поддержка',
		sectionType: 'support',
		defaultCollapsibleState: 'collapsed',
		projects: ONEC,
		commands: [
			{ command: '1c-platform-tools.cf.makeDist', title: getDumpConfigurationToDistCommandName().title, treeLabel: '📤 Выгрузить в 1Cv8dist.cf' },
			{ command: '1c-platform-tools.support.updateCfg', title: getUpdateCfgSupportCommandName().title, treeLabel: '📥 Загрузить из cf/cfu' },
			{ command: '1c-platform-tools.support.disableCfgSupport', title: getDisableCfgSupportCommandName().title, treeLabel: '🗑️ Снять' },
		],
	},
	{
		groupLabel: 'Поставка',
		sectionType: 'delivery',
		defaultCollapsibleState: 'collapsed',
		projects: ONEC,
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
		projects: ANY,
		commands: [
			{ command: '1c-platform-tools.dependencies.initializePackagedef', title: getInitializePackagedefCommandName().title, treeLabel: '📝 Инициализировать проект' },
			{ command: '1c-platform-tools.dependencies.initializeProjectStructure', title: getInitializeProjectStructureCommandName().title, treeLabel: '📁 Инициализировать структуру проекта', projects: ONEC },
			{ command: '1c-platform-tools.dependencies.setupGit', title: getSetupGitCommandName().title, treeLabel: '🔧 Настроить Git' },
			{ command: '1c-platform-tools.components.setGithubToken', title: 'Указать токен GitHub', treeLabel: '🔑 Указать токен GitHub' },
			{ command: '1c-platform-tools.components.forgetGithubToken', title: 'Забыть токен GitHub', treeLabel: '🔓 Забыть токен GitHub' },
			{ command: '1c-platform-tools.components.update', title: 'Обновить внешние компоненты', treeLabel: '🔄 Обновить внешние компоненты' },
			{ command: '1c-platform-tools.dependencies.installOscript', title: getInstallOneScriptCommandName().title, treeLabel: '📦 Установить OneScript' },
			{ command: '1c-platform-tools.dependencies.selectOscript', title: getSelectOneScriptCommandName().title, treeLabel: '🔀 Выбрать версию OneScript' },
			{ command: '1c-platform-tools.dependencies.updateOpm', title: getUpdateOpmCommandName().title, treeLabel: '📦 Обновить пакетный менеджер opm' },
			{ command: '1c-platform-tools.dependencies.install', title: getInstallDependenciesCommandName().title, treeLabel: '📦 Установить зависимости' },
			{ command: '1c-platform-tools.dependencies.remove', title: getRemoveDependenciesCommandName().title, treeLabel: '🗑️ Удалить зависимости' },
		],
	},
	{
		groupLabel: 'Пакет',
		sectionType: 'package',
		defaultCollapsibleState: 'collapsed',
		projects: PACKAGE,
		commands: [
			{ command: '1c-platform-tools.package.build', title: getBuildPackageCommandName().title, treeLabel: '📦 Собрать пакет' },
			{ command: '1c-platform-tools.package.install', title: getInstallPackageCommandName().title, treeLabel: '📥 Установить собранный пакет' },
		],
	},
	{
		groupLabel: 'Сеансы',
		sectionType: 'session',
		defaultCollapsibleState: 'collapsed',
		projects: ONEC,
		commands: [
			{ command: '1c-platform-tools.session.lock', title: getLockSessionsCommandName().title, treeLabel: '🔒 Запретить начало сеансов' },
			{ command: '1c-platform-tools.session.unlock', title: getUnlockSessionsCommandName().title, treeLabel: '🔓 Разрешить начало сеансов' },
			{ command: '1c-platform-tools.session.lockJobs', title: getLockScheduledJobsCommandName().title, treeLabel: '🔒 Запретить регламентные задания' },
			{ command: '1c-platform-tools.session.unlockJobs', title: getUnlockScheduledJobsCommandName().title, treeLabel: '🔓 Разрешить регламентные задания' },
			{ command: '1c-platform-tools.session.kill', title: getKillSessionsCommandName().title, treeLabel: '⛔ Завершить сеансы' },
			{ command: '1c-platform-tools.session.list', title: getListSessionsCommandName().title, treeLabel: '📋 Показать сеансы' },
			{ command: '1c-platform-tools.session.checkClosed', title: getCheckSessionsClosedCommandName().title, treeLabel: '🔍 Проверить отсутствие сеансов' },
		],
	},
	{
		groupLabel: 'Запуск',
		sectionType: 'run',
		defaultCollapsibleState: 'collapsed',
		projects: ONEC,
		commands: [
			{ command: '1c-platform-tools.run.enterprise', title: getRunEnterpriseCommandName().title, treeLabel: '▶️ Запустить Предприятие' },
			{ command: '1c-platform-tools.run.designer', title: getRunDesignerCommandName().title, treeLabel: '▶️ Запустить Конфигуратор' },
			{ command: '1c-platform-tools.run.edt', title: getRunEdtCommandName().title, treeLabel: '▶️ Запустить EDT', formats: ['edt'] },
		],
	},
	{
		groupLabel: 'Тестовое окружение',
		sectionType: 'testEnvironment',
		defaultCollapsibleState: 'collapsed',
		projects: ONEC,
		commands: [
			{ command: '1c-platform-tools.test.addYaxunit', title: getAddYaxunitCommandName().title, treeLabel: '⬇️ Добавить YAxUnit'},
			{ command: '1c-platform-tools.test.loadExtensions', title: getLoadTestExtensionsCommandName().title, treeLabel: '📥 Загрузить тестовые расширения из исходного кода'},
			{ command: '1c-platform-tools.test.dumpExtensions', title: getDumpTestExtensionsCommandName().title, treeLabel: '📤 Выгрузить тестовые расширения в исходный код'},
			{ command: '1c-platform-tools.test.compileExtensions', title: getBuildTestExtensionsCommandName().title, treeLabel: '🔨 Собрать тестовые *.cfe из исходного кода'},
			{ command: '1c-platform-tools.test.compileEpf', title: getBuildTestEpfCommandName().title, treeLabel: '🔨 Собрать unit-тесты' },
			{ command: '1c-platform-tools.test.decompileExtensions', title: getDecompileTestExtensionsCommandName().title, treeLabel: '🔓 Разобрать тестовые *.cfe в исходный код'},
			{ command: '1c-platform-tools.test.decompileEpf', title: getDecompileTestEpfCommandName().title, treeLabel: '🔓 Разобрать unit-тесты' },
		],
	},
	{
		groupLabel: 'Тестирование',
		sectionType: 'test',
		defaultCollapsibleState: 'collapsed',
		projects: ANY,
		commands: [
			{ command: '1c-platform-tools.test.xunit', title: getXUnitTestsCommandName().title, treeLabel: '🧪 XUnit тесты', projects: ONEC },
			{ command: '1c-platform-tools.syntaxCheck.run', title: getSyntaxCheckCommandName().title, treeLabel: '🧪 Синтаксический контроль', projects: ONEC },
			{ command: '1c-platform-tools.edt.validate', title: getEdtValidateCommandName().title, treeLabel: '🧪 Проверка проекта EDT', formats: ['edt'], projects: ONEC },
			{ command: '1c-platform-tools.test.vanessa', title: getVanessaTestsCommandName('normal').title, treeLabel: '🧪 Vanessa тесты', projects: ONEC },
			{ command: '1c-platform-tools.test.yaxunit', title: getYAxUnitTestsCommandName().title, treeLabel: '🧪 YAxUnit тесты', projects: ONEC },
			{ command: '1c-platform-tools.test.onescript', title: getOneScriptTestsCommandName().title, treeLabel: '🧪 Тесты OneScript', projects: PACKAGE },
			{ command: '1c-platform-tools.test.mutatos', title: getMutationTestingCommandName().title, treeLabel: '🧬 Мутационное тестирование' },
			{ command: '1c-platform-tools.test.allure', title: getAllureReportCommandName().title, treeLabel: '📊 Отчёт Allure' },
		],
	},
	{
		groupLabel: 'Установить версию',
		sectionType: 'setVersion',
		defaultCollapsibleState: 'collapsed',
		projects: ONEC,
		commands: [
			{ command: '1c-platform-tools.cf.setVersion', title: getSetVersionConfigurationCommandName().title, treeLabel: '🏷️ Конфигурации' },
			{ command: '1c-platform-tools.cfe.setVersion', title: getSetVersionExtensionCommandName().title, treeLabel: '🏷️ Расширения' },
		],
	},
	{
		groupLabel: 'Служебные файлы',
		sectionType: 'serviceFiles',
		defaultCollapsibleState: 'collapsed',
		projects: ONEC,
		commands: [
			{ command: '1c-platform-tools.serviceFiles.create', title: 'Создать служебные файлы', treeLabel: 'Создать служебные файлы' },
			{ command: '1c-platform-tools.serviceFiles.createRecommendedSet', title: 'Создать базовый набор служебных файлов', treeLabel: 'Базовый набор' },
			{ command: '1c-platform-tools.serviceFiles.createGitignore', title: 'Создать .gitignore', treeLabel: '.gitignore' },
			{ command: '1c-platform-tools.serviceFiles.createGitattributes', title: 'Создать .gitattributes', treeLabel: '.gitattributes' },
			{ command: '1c-platform-tools.serviceFiles.createEnvJson', title: 'Создать env.json', treeLabel: 'env.json' },
		],
	},
	{
		groupLabel: 'Навыки для AI',
		sectionType: 'skills',
		defaultCollapsibleState: 'collapsed',
		projects: ANY,
		commands: [
			{ command: '1c-platform-tools.mcp.configureCursor', title: getConfigureCursorMcpCommandName().title, treeLabel: '🔌 Настроить MCP для Cursor' },
			{ command: '1c-platform-tools.skills.add1cpt', title: getAdd1cptSkillsCommandName().title, treeLabel: '🤖 Добавить навыки расширения (команды и MCP)' },
			{ command: '1c-platform-tools.skills.addDevSkills', title: getAddDevSkillsCommandName().title, treeLabel: '📐 Добавить навыки разработки 1С (cc-1c-skills)', projects: ONEC },
			{ command: '1c-platform-tools.skills.addOnescript', title: getAddOnescriptSkillsCommandName().title, treeLabel: '🤖 Добавить навыки OneScript' },
			{ command: '1c-platform-tools.skills.addVanessaAutomation', title: getAddVanessaAutomationSkillsCommandName().title, treeLabel: '🤖 Добавить навыки Vanessa Automation', projects: ONEC },
			{ command: '1c-platform-tools.skills.addYaxunit', title: getAddYaxunitSkillsCommandName().title, treeLabel: '🤖 Добавить навыки YAxUnit', projects: ONEC },
			{ command: '1c-platform-tools.skills.addXunit', title: getAddXunitSkillsCommandName().title, treeLabel: '🤖 Добавить навыки xUnit', projects: ONEC },
		],
	},
	{
		groupLabel: 'Помощь и поддержка',
		sectionType: 'helpAndSupport',
		defaultCollapsibleState: 'collapsed',
		projects: ANY,
		commands: [
			{ command: '1c-platform-tools.help.openGetStarted', title: 'С чего начать?', treeLabel: 'С чего начать?' },
			{ command: '1c-platform-tools.help.openDocs', title: 'Документация', treeLabel: 'Документация', icon: 'book' },
			{ command: '1c-platform-tools.help.copyEnvironmentSummary', title: 'Скопировать сводку окружения', treeLabel: 'Скопировать сводку окружения', icon: 'copy' },
			{ command: '1c-platform-tools.help.openCreateIssue', title: 'Сообщить о проблемах', treeLabel: 'Сообщить о проблемах', icon: 'comment-discussion' },
			{ command: '1c-platform-tools.help.openWriteReview', title: 'Написать отзыв', treeLabel: 'Написать отзыв', icon: 'feedback' },
			{ command: '1c-platform-tools.help.openSponsor', title: 'Стать спонсором', treeLabel: 'Стать спонсором', icon: 'heart' },
		],
	},
];

/** Подпись команды в дереве без ведущего эмодзи. */
function labelWithoutEmoji(treeLabel: string): string {
	return treeLabel.replace(/^[^\p{L}\p{N}.]+/u, '').trim();
}

/**
 * Черты проекта для дерева.
 *
 * Пока вид проекта не известен, дерево такое же, как у проекта 1С.
 *
 * @param kind - Вид проекта
 * @param isPackage - Проект собирается пакетом OneScript
 */
export function treeTraitsOf(kind: ProjectKind | undefined, isPackage: boolean): ReadonlySet<TreeProjectTrait> {
	if (kind === 'onescript') {
		return new Set<TreeProjectTrait>(['onescript', 'package']);
	}
	return new Set<TreeProjectTrait>(isPackage ? ['onec', 'package'] : ['onec']);
}

/** Черты проекта 1С без пакета: дерево, каким оно было до определения вида. */
const ONEC_TRAITS: ReadonlySet<TreeProjectTrait> = new Set(ONEC);

/** Есть ли что-то из списка у проекта. */
function fits(projects: readonly TreeProjectTrait[], traits: ReadonlySet<TreeProjectTrait>): boolean {
	return projects.some((trait) => traits.has(trait));
}

/**
 * Есть ли группа у проекта.
 *
 * @param group - Группа дерева
 * @param traits - Черты проекта
 */
export function groupVisibleFor(group: TreeGroup, traits: ReadonlySet<TreeProjectTrait> = ONEC_TRAITS): boolean {
	return fits(group.projects, traits);
}

/**
 * Команды группы, которые есть у проекта с исходниками этого формата.
 *
 * @param group - Группа дерева
 * @param format - Формат активной конфигурации; без него состав полный
 * @param traits - Черты проекта; без них как у проекта 1С
 */
export function groupCommandsFor(
	group: TreeGroup,
	format: TreeSourceFormat | undefined,
	traits: ReadonlySet<TreeProjectTrait> = ONEC_TRAITS
): TreeCommandEntry[] {
	return group.commands.filter(
		(entry) => (!format || !entry.formats || entry.formats.includes(format)) && fits(entry.projects ?? group.projects, traits)
	);
}

/**
 * Есть ли избранная команда у проекта: команда группы дерева проверяется как в
 * группе, команды без группы (цепочки, задачи) есть у любого проекта.
 *
 * @param command - Идентификатор команды
 * @param sectionType - Группа, из которой команда добавлена в избранное
 * @param traits - Черты проекта
 */
export function favoriteVisibleFor(command: string, sectionType: string | undefined, traits: ReadonlySet<TreeProjectTrait>): boolean {
	const group = TREE_GROUPS.find((item) => item.sectionType === sectionType);
	if (!group) {
		return true;
	}
	const entry = group.commands.find((item) => item.command === command);
	return fits(entry?.projects ?? group.projects, traits);
}

/**
 * Ключ избранного: команда вместе с аргументами.
 *
 * @param entry - Запись избранного или пункт окна настройки
 */
export function favoriteKey(entry: { command: string; arguments?: unknown[] }): string {
	return `${entry.command}|${JSON.stringify(entry.arguments ?? [])}`;
}

/**
 * Избранное, которое дерево проекта показывает, а окно настройки из проекта не
 * строит: цепочки, задачи и обработки других проектов. Окно показывает их
 * отдельно, иначе их нельзя было бы ни оставить, ни убрать.
 *
 * @param current - Сохранённое избранное
 * @param offered - Ключи {@link favoriteKey} пунктов, построенных окном
 * @param traits - Черты проекта
 */
export function favoritesFromElsewhere<T extends { command: string; sectionType?: string; arguments?: unknown[] }>(
	current: readonly T[],
	offered: ReadonlySet<string>,
	traits: ReadonlySet<TreeProjectTrait>
): T[] {
	return current.filter((entry) => favoriteVisibleFor(entry.command, entry.sectionType, traits) && !offered.has(favoriteKey(entry)));
}

/**
 * Избранное после окна настройки. Избранное общее для всех проектов, а окно
 * показывает не всё: то, чего в окне не было, остаётся как было. Записи стоят
 * на своих местах, снятые убираются, новые отмеченные идут в конец.
 *
 * @param current - Сохранённое избранное
 * @param chosen - Отмеченное в окне
 * @param offered - Ключи {@link favoriteKey} всех пунктов окна
 */
export function mergeFavorites<T extends { command: string; arguments?: unknown[] }>(
	current: readonly T[],
	chosen: readonly T[],
	offered: ReadonlySet<string>
): T[] {
	const picked = new Map(chosen.map((entry) => [favoriteKey(entry), entry]));
	const merged: T[] = [];
	for (const entry of current) {
		const key = favoriteKey(entry);
		if (!offered.has(key)) {
			merged.push(entry);
			continue;
		}
		const kept = picked.get(key);
		if (kept !== undefined) {
			merged.push(kept);
			picked.delete(key);
		}
	}
	return [...merged, ...picked.values()];
}

/**
 * Подпись команды такая же, как в её группе.
 *
 * Избранное показывает те же команды, что и группы, поэтому подпись берётся из
 * структуры по идентификатору, а не из записи избранного: сохранённая запись
 * несёт заголовок на момент добавления и после переименования команды протухает.
 *
 * @param command Идентификатор команды расширения
 * @returns Подпись без эмодзи либо {@code undefined}, если команды нет в дереве
 */
export function treeCommandLabel(command: string): string | undefined {
	for (const group of TREE_GROUPS) {
		const entry = group.commands.find((item) => item.command === command);
		if (entry) {
			return labelWithoutEmoji(entry.treeLabel);
		}
	}
	return undefined;
}
