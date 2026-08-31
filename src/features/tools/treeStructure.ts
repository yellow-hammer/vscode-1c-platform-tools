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
	getValidateEdtCommandName,
	getConvertSourcesCommandName,
	getConvertExtensionSourcesCommandName,
	getVanessaTestsCommandName,
	getAllureReportCommandName,
	getYAxUnitTestsCommandName,
	getLoadTestExtensionsCommandName,
	getBuildTestExtensionsCommandName,
	getDumpTestExtensionsCommandName,
	getDecompileTestExtensionsCommandName,
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
		groupLabel: 'Информационная база',
		sectionType: 'infobase',
		defaultCollapsibleState: 'collapsed',
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
		defaultCollapsibleState: 'expanded',
		commands: [
			{ command: '1c-platform-tools.cf.load', title: getLoadConfigurationFromSrcCommandName().title, treeLabel: '📥 Загрузить из src/cf' },
			{ command: '1c-platform-tools.cf.loadIncrement', title: getLoadConfigurationIncrementFromSrcCommandName().title, treeLabel: '📥 Загрузить изменения (git diff)' },
			{ command: '1c-platform-tools.cf.loadByList', title: getLoadConfigurationFromFilesByListCommandName().title, treeLabel: '📥 Загрузить из objlist.txt' },
			{ command: '1c-platform-tools.cf.loadFile', title: getLoadConfigurationFromCfCommandName().title, treeLabel: '📥 Загрузить из 1Cv8.cf' },
			{ command: '1c-platform-tools.infobase.updateDb', title: getUpdateConfigurationInInfobaseCommandName().title, treeLabel: '🔄 Обновить конфигурацию в ИБ' },
			{ command: '1c-platform-tools.cf.dump', title: getDumpConfigurationToSrcCommandName().title, treeLabel: '📤 Выгрузить в src/cf' },
			{ command: '1c-platform-tools.cf.dumpIncrement', title: getDumpConfigurationIncrementToSrcCommandName().title, treeLabel: '📤 Выгрузить изменения в src/cf' },
			{ command: '1c-platform-tools.cf.unload', title: getDumpConfigurationToCfCommandName().title, treeLabel: '📤 Выгрузить в 1Cv8.cf' },
			{ command: '1c-platform-tools.cf.compile', title: getBuildConfigurationCommandName().title, treeLabel: '🔨 Собрать 1Cv8.cf из src/cf' },
			{ command: '1c-platform-tools.cf.decompile', title: getDecompileConfigurationCommandName().title, treeLabel: '🔓 Разобрать 1Cv8.cf в src/cf' },
			{ command: '1c-platform-tools.cf.convert', title: getConvertSourcesCommandName().title, treeLabel: '🔀 Конвертировать исходники (EDT ↔ конфигуратор)' },
		],
	},
	{
		groupLabel: 'Расширения',
		sectionType: 'extension',
		defaultCollapsibleState: 'expanded',
		commands: [
			{ command: '1c-platform-tools.cfe.load', title: getLoadExtensionFromSrcCommandName().title, treeLabel: '📥 Загрузить из src/cfe' },
			{ command: '1c-platform-tools.cfe.loadByList', title: getLoadExtensionFromFilesByListCommandName().title, treeLabel: '📥 Загрузить из objlist.txt' },
			{ command: '1c-platform-tools.cfe.loadFile', title: getLoadExtensionFromCfeCommandName().title, treeLabel: '📥 Загрузить из *.cfe' },
			{ command: '1c-platform-tools.cfe.updateDb', title: getUpdateExtensionsInInfobaseCommandName().title, treeLabel: '🔄 Обновить расширения в ИБ' },
			{ command: '1c-platform-tools.cfe.dump', title: getDumpExtensionToSrcCommandName().title, treeLabel: '📤 Выгрузить в src/cfe' },
			{ command: '1c-platform-tools.cfe.unload', title: getDumpExtensionToCfeCommandName().title, treeLabel: '📤 Выгрузить в *.cfe' },
			{ command: '1c-platform-tools.cfe.compile', title: getBuildExtensionCommandName().title, treeLabel: '🔨 Собрать *.cfe из src/cfe' },
			{ command: '1c-platform-tools.cfe.decompile', title: getDecompileExtensionCommandName().title, treeLabel: '🔓 Разобрать *.cfe в src/cfe' },
			{ command: '1c-platform-tools.cfe.convert', title: getConvertExtensionSourcesCommandName().title, treeLabel: '🔀 Конвертировать исходники (EDT ↔ конфигуратор)' },
		],
	},
	{
		groupLabel: 'Внешние файлы',
		sectionType: 'externalFile',
		defaultCollapsibleState: 'collapsed',
		commands: [
			{ command: '1c-platform-tools.epf.compileProcessor', title: getBuildExternalProcessorCommandName().title, treeLabel: '🔨 Собрать обработки' },
			{ command: '1c-platform-tools.epf.compileReport', title: getBuildExternalReportCommandName().title, treeLabel: '🔨 Собрать отчёты' },
			{ command: '1c-platform-tools.epf.decompileProcessor', title: getDecompileExternalProcessorCommandName().title, treeLabel: '🔓 Разобрать обработки' },
			{ command: '1c-platform-tools.epf.decompileReport', title: getDecompileExternalReportCommandName().title, treeLabel: '🔓 Разобрать отчёты' },
			{ command: '1c-platform-tools.epf.clearCache', title: getClearCacheCommandName().title, treeLabel: '🗑️ Удалить кэш' },
		],
	},
	{
		groupLabel: 'Поддержка',
		sectionType: 'support',
		defaultCollapsibleState: 'collapsed',
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
			{ command: '1c-platform-tools.components.setGithubToken', title: 'Указать токен GitHub', treeLabel: '🔑 Указать токен GitHub' },
			{ command: '1c-platform-tools.components.forgetGithubToken', title: 'Забыть токен GitHub', treeLabel: '🔓 Забыть токен GitHub' },
			{ command: '1c-platform-tools.components.update', title: 'Обновить внешние компоненты', treeLabel: '🔄 Обновить внешние компоненты' },
			{ command: '1c-platform-tools.dependencies.installOscript', title: getInstallOneScriptCommandName().title, treeLabel: '📦 Установить OneScript' },
			{ command: '1c-platform-tools.dependencies.updateOpm', title: getUpdateOpmCommandName().title, treeLabel: '📦 Обновить пакетный менеджер opm' },
			{ command: '1c-platform-tools.dependencies.install', title: getInstallDependenciesCommandName().title, treeLabel: '📦 Установить зависимости' },
			{ command: '1c-platform-tools.dependencies.remove', title: getRemoveDependenciesCommandName().title, treeLabel: '🗑️ Удалить зависимости' },
		],
	},
	{
		groupLabel: 'Сеансы',
		sectionType: 'session',
		defaultCollapsibleState: 'collapsed',
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
		defaultCollapsibleState: 'expanded',
		commands: [
			{ command: '1c-platform-tools.run.enterprise', title: getRunEnterpriseCommandName().title, treeLabel: '▶️ Запустить Предприятие' },
			{ command: '1c-platform-tools.run.designer', title: getRunDesignerCommandName().title, treeLabel: '▶️ Запустить Конфигуратор' },
		],
	},
	{
		groupLabel: 'Тестовое окружение',
		sectionType: 'testEnvironment',
		defaultCollapsibleState: 'collapsed',
		commands: [
			{ command: '1c-platform-tools.test.loadExtensions', title: getLoadTestExtensionsCommandName().title, treeLabel: '📥 Загрузить тестовые расширения из tests/cfe' },
			{ command: '1c-platform-tools.test.dumpExtensions', title: getDumpTestExtensionsCommandName().title, treeLabel: '📤 Выгрузить тестовые расширения в tests/cfe' },
			{ command: '1c-platform-tools.test.compileExtensions', title: getBuildTestExtensionsCommandName().title, treeLabel: '🔨 Собрать тестовые *.cfe из tests/cfe' },
			{ command: '1c-platform-tools.test.compileEpf', title: getBuildTestEpfCommandName().title, treeLabel: '🔨 Собрать unit-тесты' },
			{ command: '1c-platform-tools.test.decompileExtensions', title: getDecompileTestExtensionsCommandName().title, treeLabel: '🔓 Разобрать тестовые *.cfe в tests/cfe' },
			{ command: '1c-platform-tools.test.decompileEpf', title: getDecompileTestEpfCommandName().title, treeLabel: '🔓 Разобрать unit-тесты' },
		],
	},
	{
		groupLabel: 'Тестирование',
		sectionType: 'test',
		defaultCollapsibleState: 'collapsed',
		commands: [
			{ command: '1c-platform-tools.test.xunit', title: getXUnitTestsCommandName().title, treeLabel: '🧪 XUnit тесты' },
			{ command: '1c-platform-tools.syntaxCheck.run', title: getSyntaxCheckCommandName().title, treeLabel: '🧪 Синтаксический контроль' },
			{ command: '1c-platform-tools.test.validateEdt', title: getValidateEdtCommandName().title, treeLabel: '🧪 Проверить проект EDT' },
			{ command: '1c-platform-tools.test.vanessa', title: getVanessaTestsCommandName('normal').title, treeLabel: '🧪 Vanessa тесты' },
			{ command: '1c-platform-tools.test.yaxunit', title: getYAxUnitTestsCommandName().title, treeLabel: '🧪 YAxUnit тесты' },
			{ command: '1c-platform-tools.test.allure', title: getAllureReportCommandName().title, treeLabel: '📊 Отчёт Allure' },
		],
	},
	{
		groupLabel: 'Установить версию',
		sectionType: 'setVersion',
		defaultCollapsibleState: 'collapsed',
		commands: [
			{ command: '1c-platform-tools.cf.setVersion', title: getSetVersionConfigurationCommandName().title, treeLabel: '🏷️ Конфигурации' },
			{ command: '1c-platform-tools.cfe.setVersion', title: getSetVersionExtensionCommandName().title, treeLabel: '🏷️ Расширения' },
		],
	},
	{
		groupLabel: 'Служебные файлы',
		sectionType: 'serviceFiles',
		defaultCollapsibleState: 'collapsed',
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
		commands: [
			{ command: '1c-platform-tools.mcp.configureCursor', title: getConfigureCursorMcpCommandName().title, treeLabel: '🔌 Настроить MCP для Cursor' },
			{ command: '1c-platform-tools.skills.add1cpt', title: getAdd1cptSkillsCommandName().title, treeLabel: '🤖 Добавить навыки расширения (команды и MCP)' },
			{ command: '1c-platform-tools.skills.addDevSkills', title: getAddDevSkillsCommandName().title, treeLabel: '📐 Добавить навыки разработки 1С (cc-1c-skills)' },
		],
	},
	{
		groupLabel: 'Помощь и поддержка',
		sectionType: 'helpAndSupport',
		defaultCollapsibleState: 'collapsed',
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
