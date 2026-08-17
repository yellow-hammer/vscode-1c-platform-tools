/**
 * Описания команд для агента.
 *
 * Заголовки команд рассчитаны на палитру и меню, где строка должна быть
 * короткой, а объект действия понятен из категории и места вызова. Агент
 * видит команду вне этого контекста: «Конфигурацию» или «Удалить кэш» ему
 * ничего не говорят. Здесь для таких команд лежит развёрнутое описание,
 * которое подставляется вместо заголовка при выдаче списка инструментов MCP.
 *
 * Команды, у которых заголовок и так самодостаточен, в таблице не нужны.
 */

/** Описание команды для списка инструментов MCP. */
export interface AgentCommandDescription {
	/** Что делает команда: одна фраза, понятная без интерфейса. */
	title: string;
	/** Раздел, к которому команда относится. */
	category: string;
}

const TESTING = '1C: Тестирование';
const INFOBASE = '1C: Информационная база';
const CONFIGURATION = '1C: Конфигурация';
const EXTENSIONS = '1C: Расширения';
const EXTERNAL = '1C: Внешние файлы';
const DEPENDENCIES = '1C: Зависимости';
const LAUNCH = '1C: Запуск';
const ENVIRONMENT = '1C: Окружение';
const TASKS = '1C: Задачи';
const SESSIONS = '1C: Сеансы';
const PIPELINES = '1C: Пайплайны';

/** Описания команд, чей заголовок вне интерфейса непонятен. */
export const AGENT_COMMAND_DESCRIPTIONS: Record<string, AgentCommandDescription> = {
	// Команды, которых нет в палитре: заголовка у них нет вовсе
	'1c-platform-tools.env.status': {
		title: 'Показать состояние окружения запуска: версия vanessa-runner, активный профиль, файл настроек, строка подключения к ИБ',
		category: ENVIRONMENT,
	},
	'1c-platform-tools.epf.run': {
		title: 'Запустить внешнюю обработку или отчёт в Предприятии: путь в параметре execute, строка запуска в параметре command',
		category: LAUNCH,
	},
	'1c-platform-tools.env.refreshVersion': {
		title: 'Определить версию vanessa-runner заново',
		category: ENVIRONMENT,
	},

	// Тестирование: в палитре хватает названия фреймворка, агенту нужно действие
	'1c-platform-tools.test.xunit': {
		title: 'Запустить тесты xUnit; результат берётся из jUnit-отчёта прогона',
		category: TESTING,
	},
	'1c-platform-tools.test.vanessa': {
		title: 'Запустить сценарии Vanessa Automation; результат берётся из отчёта прогона',
		category: TESTING,
	},
	'1c-platform-tools.test.yaxunit': {
		title: 'Запустить тесты YAxUnit; результат берётся из jUnit-отчёта прогона',
		category: TESTING,
	},
	'1c-platform-tools.test.syntaxCheck': {
		title: 'Запустить синтаксический контроль конфигурации; ошибки возвращаются списком с путями к модулям',
		category: TESTING,
	},
	'1c-platform-tools.test.allure': {
		title: 'Построить отчёт Allure по результатам прогона',
		category: TESTING,
	},
	'1c-platform-tools.test.loadExtensions': {
		title: 'Загрузить тестовые расширения в ИБ из исходников (подкаталог cfe корня тестов, по умолчанию tests/cfe): YAxUnit и расширение с тестами; параметр extensions отбирает нужные',
		category: TESTING,
	},
	'1c-platform-tools.test.buildExtensions': {
		title: 'Собрать тестовые расширения из исходников в *.cfe в каталоге результатов сборки; параметр extensions отбирает нужные',
		category: TESTING,
	},
	'1c-platform-tools.test.dumpExtensions': {
		title: 'Выгрузить установленные тестовые расширения из ИБ в исходники: перенос существующего расширения с тестами под контроль версий',
		category: TESTING,
	},
	'1c-platform-tools.test.decompileExtensions': {
		title: 'Разобрать собранные тестовые *.cfe в исходники (tests/cfe): так раскладывают полученный со стороны YAxUnit.cfe; параметр extensions отбирает нужные',
		category: TESTING,
	},
	'1c-platform-tools.test.buildEpf': {
		title: 'Собрать обработки с тестами из исходников',
		category: TESTING,
	},
	'1c-platform-tools.test.decompileEpf': {
		title: 'Разобрать обработки с тестами в исходники',
		category: TESTING,
	},
	'1c-platform-tools.test.configure': {
		title: 'Включить или выключить тестовые фреймворки в панели тестирования (параметр frameworks)',
		category: TESTING,
	},

	// Информационная база
	'1c-platform-tools.infobase.updateDb': {
		title: 'Обновить конфигурацию базы данных из конфигурации ИБ',
		category: INFOBASE,
	},
	'1c-platform-tools.infobase.runUpdateHandlers': {
		title: 'Выполнить обработчики обновления в Предприятии после смены конфигурации',
		category: INFOBASE,
	},
	'1c-platform-tools.infobase.initialize': {
		title: 'Инициализировать данные в информационной базе',
		category: INFOBASE,
	},
	'1c-platform-tools.infobase.dumpDt': {
		title: 'Выгрузить информационную базу в файл .dt',
		category: INFOBASE,
	},
	'1c-platform-tools.infobase.restoreDt': {
		title: 'Загрузить информационную базу из файла .dt',
		category: INFOBASE,
	},
	'1c-platform-tools.infobase.blockExternalResources': {
		title: 'Запретить информационной базе работу с внешними ресурсами',
		category: INFOBASE,
	},

	// Сеансы: подключение к кластеру берётся из профиля запуска, поэтому в
	// описании только параметры разового вызова
	'1c-platform-tools.session.lock': {
		title: 'Запретить начало сеансов серверной информационной базы; подключение к кластеру берётся из профиля запуска, в вызове можно задать lockMessage (сообщение пользователю), accessCode (код допуска), lockStart и lockEnd (время блокировки, только vanessa-runner 2.x)',
		category: SESSIONS,
	},
	'1c-platform-tools.session.unlock': {
		title: 'Разрешить начало сеансов серверной информационной базы; параметр accessCode - код допуска',
		category: SESSIONS,
	},
	'1c-platform-tools.session.kill': {
		title: 'Завершить сеансы серверной информационной базы; параметры sessionFilter (например appid=Designer|name=Администратор), sessionFilterMode (ONLY, OFF, EXCEPT), keepSessionsUnlocked (не запрещать начало новых сеансов), а также sessionRetry и sessionTimeout - число попыток и ожидание, пока зависшие сеансы завершатся (только 3.x)',
		category: SESSIONS,
	},
	'1c-platform-tools.session.lockJobs': {
		title: 'Запретить выполнение регламентных заданий в серверной информационной базе: запрет входа сам по себе задания не останавливает',
		category: SESSIONS,
	},
	'1c-platform-tools.session.unlockJobs': {
		title: 'Разрешить выполнение регламентных заданий в серверной информационной базе',
		category: SESSIONS,
	},
	'1c-platform-tools.session.checkClosed': {
		title: 'Проверить, что сеансов нет: при найденных сеансах команда завершается ошибкой; параметры sessionFilter, sessionFilterMode и sessionTimeout - ожидание, пока сеансы закончатся (только 3.x)',
		category: SESSIONS,
	},
	'1c-platform-tools.session.list': {
		title: 'Показать сеансы информационной базы с детализацией; параметры sessionFilter, sessionFilterMode и sessionConnections (дополнительно показать соединения ИБ). Доступно только в vanessa-runner 3.x',
		category: SESSIONS,
	},

	// Конфигурация и расширения: каталоги настраиваются, поэтому в описании
	// говорится о смысле, а не о конкретном пути
	'1c-platform-tools.cf.load': {
		title: 'Загрузить конфигурацию в ИБ из исходников проекта',
		category: CONFIGURATION,
	},
	'1c-platform-tools.infobase.initFromSrc': {
		title: 'Загрузить конфигурацию в пустую ИБ из исходников проекта',
		category: CONFIGURATION,
	},
	'1c-platform-tools.cf.loadIncrement': {
		title: 'Загрузить в ИБ только изменённые объекты конфигурации (параметр sha задаёт коммит сравнения)',
		category: CONFIGURATION,
	},
	'1c-platform-tools.cf.loadByList': {
		title: 'Загрузить в ИБ объекты конфигурации по списку из objlist.txt',
		category: CONFIGURATION,
	},
	'1c-platform-tools.cf.loadFile': {
		title: 'Загрузить конфигурацию в ИБ из файла .cf',
		category: CONFIGURATION,
	},
	'1c-platform-tools.cf.dump': {
		title: 'Выгрузить конфигурацию ИБ в исходники проекта',
		category: CONFIGURATION,
	},
	'1c-platform-tools.cf.dumpIncrement': {
		title: 'Выгрузить в исходники только изменённые объекты конфигурации',
		category: CONFIGURATION,
	},
	'1c-platform-tools.cf.unload': {
		title: 'Выгрузить конфигурацию ИБ в файл .cf',
		category: CONFIGURATION,
	},
	'1c-platform-tools.cf.makeDist': {
		title: 'Выгрузить конфигурацию поставки в файл .cf',
		category: CONFIGURATION,
	},
	'1c-platform-tools.cf.compile': {
		title: 'Собрать файл .cf из исходников конфигурации, без загрузки в ИБ',
		category: CONFIGURATION,
	},
	'1c-platform-tools.cf.decompile': {
		title: 'Разобрать файл .cf в исходники конфигурации, без обращения к ИБ',
		category: CONFIGURATION,
	},
	'1c-platform-tools.cfe.load': {
		title: 'Загрузить расширения в ИБ из исходников проекта',
		category: EXTENSIONS,
	},
	'1c-platform-tools.cfe.loadByList': {
		title: 'Загрузить в ИБ объекты расширений по списку из objlist.txt',
		category: EXTENSIONS,
	},
	'1c-platform-tools.cfe.loadFile': {
		title: 'Загрузить расширения в ИБ из файлов .cfe',
		category: EXTENSIONS,
	},
	'1c-platform-tools.cfe.dump': {
		title: 'Выгрузить расширения ИБ в исходники проекта',
		category: EXTENSIONS,
	},
	'1c-platform-tools.cfe.unload': {
		title: 'Выгрузить расширения ИБ в файлы .cfe',
		category: EXTENSIONS,
	},
	'1c-platform-tools.cfe.compile': {
		title: 'Собрать файлы .cfe из исходников расширений, без загрузки в ИБ',
		category: EXTENSIONS,
	},
	'1c-platform-tools.cfe.decompile': {
		title: 'Разобрать файлы .cfe в исходники расширений, без обращения к ИБ',
		category: EXTENSIONS,
	},
	'1c-platform-tools.cfe.updateDb': {
		title: 'Обновить расширения, уже установленные в информационной базе',
		category: EXTENSIONS,
	},

	// Внешние файлы
	'1c-platform-tools.epf.compileProcessor': {
		title: 'Собрать внешние обработки из исходников',
		category: EXTERNAL,
	},
	'1c-platform-tools.epf.decompileProcessor': {
		title: 'Разобрать внешние обработки в исходники',
		category: EXTERNAL,
	},
	'1c-platform-tools.epf.compileReport': {
		title: 'Собрать внешние отчёты из исходников',
		category: EXTERNAL,
	},
	'1c-platform-tools.epf.decompileReport': {
		title: 'Разобрать внешние отчёты в исходники',
		category: EXTERNAL,
	},
	'1c-platform-tools.epf.clearCache': {
		title: 'Удалить кэш разбора внешних обработок и отчётов',
		category: EXTERNAL,
	},


	// Зависимости и задачи
	'1c-platform-tools.dependencies.initializePackagedef': {
		title: 'Создать описание пакета packagedef в корне проекта',
		category: DEPENDENCIES,
	},
	'1c-platform-tools.dependencies.initializeProjectStructure': {
		title: 'Создать стандартные каталоги проекта 1С',
		category: DEPENDENCIES,
	},
	'1c-platform-tools.dependencies.install': {
		title: 'Установить зависимости проекта по packagedef',
		category: DEPENDENCIES,
	},
	'1c-platform-tools.dependencies.remove': {
		title: 'Удалить установленные зависимости проекта',
		category: DEPENDENCIES,
	},
	'1c-platform-tools.dependencies.updateOpm': {
		title: 'Обновить пакетный менеджер opm',
		category: DEPENDENCIES,
	},
	'1c-platform-tools.dependencies.installOscript': {
		title: 'Установить OneScript',
		category: DEPENDENCIES,
	},
	'1c-platform-tools.launch.run': {
		title: 'Запустить задачу из конфигураций запуска проекта',
		category: TASKS,
	},
	'1c-platform-tools.oscript.run': {
		title: 'Запустить задачу OneScript (opm run)',
		category: TASKS,
	},

	// Запуск платформы: vrunner отдаёт управление сразу после старта
	'1c-platform-tools.run.enterprise': {
		title: 'Запустить 1С:Предприятие на активном профиле; результат - удалось ли стартовать, окно платформы остаётся у пользователя',
		category: LAUNCH,
	},
	'1c-platform-tools.run.designer': {
		title: 'Запустить Конфигуратор на активном профиле; результат - удалось ли стартовать, окно платформы остаётся у пользователя',
		category: LAUNCH,
	},

	// Пайплайны: цепочки команд из .1cpt/pipelines.json
	'1c-platform-tools.pipelines.run': {
		title: 'Запустить пайплайн - граф шагов из .1cpt/pipelines.json; параметр pipeline - идентификатор или название цепочки, без него команда не выполняется; шаги идут по связям, упавший шаг без ветки error останавливает свою ветку, шаг с подтверждением в неинтерактивном запуске завершается ошибкой; возвращается пошаговый отчёт',
		category: PIPELINES,
	},

	// Окружение
	'1c-platform-tools.env.selectProfile': {
		title: 'Переключить активный профиль запуска (параметр profile)',
		category: ENVIRONMENT,
	},
	'1c-platform-tools.env.clearOverrides': {
		title: 'Сбросить временные параметры запуска активного профиля',
		category: ENVIRONMENT,
	},
};

/**
 * Возвращает описание команды для агента.
 *
 * @param commandId - Идентификатор команды расширения
 * @returns Описание или undefined, если хватает заголовка из package.json
 */
export function agentCommandDescription(commandId: string): AgentCommandDescription | undefined {
	return AGENT_COMMAND_DESCRIPTIONS[commandId];
}
