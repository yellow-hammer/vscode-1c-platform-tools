/**
 * Политика публикации команд расширения как инструментов MCP.
 *
 * Здесь два решения, которые агент видит напрямую: какие команды вообще
 * попадают в список инструментов и какие из них возвращают исход операции.
 * Списки живут рядом, чтобы не расходились: команда, обещающая синхронный
 * результат без его реализации, для агента хуже отсутствующей.
 */

/** Префикс идентификаторов команд расширения. */
export const COMMAND_PREFIX = '1c-platform-tools.';

/**
 * Команды, которые не публикуются как инструменты MCP: интерактивные мастера,
 * меню, деревья, навигация и справка. Короткий список инструментов важен и сам
 * по себе: при переполнении агентские клиенты урезают выборку и могут выкинуть
 * полезное.
 */
const HIDDEN_PREFIXES = [
	`${COMMAND_PREFIX}file.`,
	// Консоль кластера: команды работают с выделенным узлом дерева, а действия
	// вроде завершения сеанса необратимы и требуют подтверждения человеком
	`${COMMAND_PREFIX}clusters.`,
	`${COMMAND_PREFIX}infobaseList.`,
	`${COMMAND_PREFIX}metadata.`,
	`${COMMAND_PREFIX}projects.`,
	`${COMMAND_PREFIX}todo.`,
	`${COMMAND_PREFIX}focus`,
	`${COMMAND_PREFIX}artifacts.`,
	`${COMMAND_PREFIX}tools.`,
	`${COMMAND_PREFIX}support.`,
	// Мастер установки версии: спрашивает номер у человека
	`${COMMAND_PREFIX}cf.setVersion`,
	`${COMMAND_PREFIX}cfe.setVersion`,
	`${COMMAND_PREFIX}epf.setVersion`,
	`${COMMAND_PREFIX}skills.`,
	`${COMMAND_PREFIX}profile.`,
	`${COMMAND_PREFIX}help.`,
	`${COMMAND_PREFIX}mcp.`,
	`${COMMAND_PREFIX}refresh`,
	`${COMMAND_PREFIX}env.createProfile`,
	`${COMMAND_PREFIX}env.setOverrides`,
	`${COMMAND_PREFIX}env.statusBarRefresh`,
	`${COMMAND_PREFIX}dependencies.setupGit`,
	// Секрет вводит человек в поле с маскировкой, агенту его передавать незачем
	`${COMMAND_PREFIX}components.setGithubToken`,
	`${COMMAND_PREFIX}components.forgetGithubToken`,
	`${COMMAND_PREFIX}tasks.addOscript`,
	// Цель отладки выбирают в дереве по состоянию запущенных сеансов
	`${COMMAND_PREFIX}debug.connectTarget`,
	`${COMMAND_PREFIX}server.menu`,
	`${COMMAND_PREFIX}launch.editConfigurations`,
	`${COMMAND_PREFIX}config.env.edit`,
	`${COMMAND_PREFIX}project.createFromWelcome`,
	// Служебные: вызываются самим расширением, отдельного смысла для агента нет
	`${COMMAND_PREFIX}serviceFiles.ensure`,
	`${COMMAND_PREFIX}server.statusBarRefresh`,
];

/**
 * Команды, которые исход операции не возвращают: открывают окна VS Code либо
 * выполняются без структурированного результата. Агенту об этом сообщается в
 * описании инструмента, иначе он ждёт данных, которых не будет.
 */
const WITHOUT_SYNC_RESULT_PREFIXES = [
	`${COMMAND_PREFIX}file.`,
	`${COMMAND_PREFIX}metadata.`,
	`${COMMAND_PREFIX}projects.`,
	`${COMMAND_PREFIX}todo.`,
	`${COMMAND_PREFIX}focus`,
	`${COMMAND_PREFIX}artifacts.open`,
	`${COMMAND_PREFIX}artifacts.delete`,
	`${COMMAND_PREFIX}server.`,
	`${COMMAND_PREFIX}debug.`,
	// прогон синтаксического контроля исход возвращает, а Problems только правит
	`${COMMAND_PREFIX}syntaxCheck.refresh`,
	`${COMMAND_PREFIX}syntaxCheck.clear`,
	`${COMMAND_PREFIX}dependencies.`,
	`${COMMAND_PREFIX}components.update`,
	`${COMMAND_PREFIX}tasks.`,
];

/** Команды, которые исход операции возвращают, хотя их префикс в списке выше. */
const WITH_SYNC_RESULT_EXACT = [
	`${COMMAND_PREFIX}dependencies.initializePackagedef`,
];

/**
 * Команды, которые VS Code заводит сам для представлений и их контейнера:
 * к работе с 1С отношения не имеют, а в списке инструментов выглядят как
 * «open», «removeView» или «toggleVisibility».
 */
const HIDDEN_EXACT = [
	`${COMMAND_PREFIX}open`,
	`${COMMAND_PREFIX}removeView`,
	`${COMMAND_PREFIX}toggleVisibility`,
	`${COMMAND_PREFIX}resetViewLocation`,
	`${COMMAND_PREFIX}resetViewContainerLocation`,
	// Мастер выбора служебного файла: спрашивает, что создать. Команды на
	// конкретный файл (createEnvJson и другие) агенту доступны
	`${COMMAND_PREFIX}serviceFiles.create`,
	// Конструкторы пайплайнов и хуков: агент правит `.1cpt/pipelines.json` и
	// `.1cpt/hooks.json` файлами, запуск цепочки ему доступен командой pipelines.run
	`${COMMAND_PREFIX}pipelines.openEditor`,
	`${COMMAND_PREFIX}pipelines.addTemplates`,
	`${COMMAND_PREFIX}hooks.openEditor`,
	// Сохранение формы: приходит по Ctrl+S из активного редактора или панели свойств
	`${COMMAND_PREFIX}editors.save`,
	// Обновление внешних компонентов: спрашивает список галочками и загружает
	// выбранное. Ответить на такой вопрос агент не может
	`${COMMAND_PREFIX}components.update`,
	// Действия над строкой вида проектов; packagedef агент создаёт командой project.initialize
	`${COMMAND_PREFIX}project.makeCurrent`,
	`${COMMAND_PREFIX}project.separateConfiguration`,
	`${COMMAND_PREFIX}project.refresh`,
	`${COMMAND_PREFIX}project.openInNewWindow`,
	`${COMMAND_PREFIX}project.revealInExplorer`,
	`${COMMAND_PREFIX}project.openTerminal`,
	`${COMMAND_PREFIX}project.copyPath`,
	// Отчёт мутаций открывается в браузере человека; агенту итог и пути отчётов отдаёт прогон
	`${COMMAND_PREFIX}test.mutatosReport`,
	// Пункт меню узла панели тестирования: без узла команде нечего запускать
	`${COMMAND_PREFIX}test.mutatosItem`,
	// Выбор профиля тестов OneScript открывает список в окне VS Code
	`${COMMAND_PREFIX}test.selectOnescriptProfile`,
	`${COMMAND_PREFIX}test.openOnescriptProfiles`,
	// Имя задачи в вызов не передаётся: агент получает объект опций и промахивается
	`${COMMAND_PREFIX}tasks.run`,
	`${COMMAND_PREFIX}tasks.runOscript`,
];

/**
 * Команды окна: список проектов и выбор текущего. Выполняются без корня вызова,
 * projectPath к ним не применяется.
 */
const WINDOW_COMMANDS = [
	`${COMMAND_PREFIX}project.list`,
	`${COMMAND_PREFIX}project.select`,
];

/**
 * Команды инициализации проекта: projectPath у них каталог, в котором создаётся
 * packagedef, а не проект вызова.
 */
const DIRECTORY_COMMANDS = [
	`${COMMAND_PREFIX}project.initialize`,
	`${COMMAND_PREFIX}dependencies.initializePackagedef`,
];

/**
 * Определяет, публикуется ли команда как инструмент MCP.
 *
 * @param commandId - Идентификатор команды расширения
 * @returns true, если команда доступна агенту
 */
export function isCommandExposedToMcp(commandId: string): boolean {
	return (
		commandId.startsWith(COMMAND_PREFIX) &&
		!HIDDEN_EXACT.includes(commandId) &&
		!HIDDEN_PREFIXES.some((prefix) => commandId.startsWith(prefix))
	);
}

/**
 * Определяет, возвращает ли команда исход операции при wait: true.
 *
 * @param commandId - Идентификатор команды расширения
 * @returns true, если команда выполняется синхронно и возвращает результат
 */
export function commandSupportsWait(commandId: string): boolean {
	return (
		WITH_SYNC_RESULT_EXACT.includes(commandId) ||
		!WITHOUT_SYNC_RESULT_PREFIXES.some((prefix) => commandId.startsWith(prefix))
	);
}

/**
 * Определяет, выполняется ли команда в проекте вызова.
 *
 * @param commandId - Идентификатор команды расширения
 * @returns false у команд окна: им не нужны ни текущий проект, ни projectPath
 */
export function commandRunsInProject(commandId: string): boolean {
	return !WINDOW_COMMANDS.includes(commandId);
}

/**
 * Определяет, указывает ли projectPath команды каталог, с которым она работает.
 *
 * @param commandId - Идентификатор команды расширения
 * @returns true у команд инициализации проекта
 */
export function commandTargetsDirectory(commandId: string): boolean {
	return DIRECTORY_COMMANDS.includes(commandId);
}
