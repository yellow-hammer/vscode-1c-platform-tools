---
name: 1c-platform-tools
description: "Операции с платформой 1С в этом проекте — командами расширения 1C: Platform Tools. Используй, когда пользователь просит загрузить или выгрузить конфигурацию, запустить Конфигуратор или Предприятие, установить зависимости, выполнить операцию с платформой 1С. Опубликованные команды выполняй сам. Мастера, которые открывают окно, не вызывай."
---

# Команды 1C: Platform Tools для агента

Если пользователь назвал команду или инструмент по имени, вызови именно её. Таблицы ниже — когда имя не названо.

Команду с заполненной колонкой MCP выполняй сам, кроме тех, что ниже помечены «не вызывай»: у них окно, отказ при `wait: true` или нет параметра, без которого команда бессмысленна. `projectPath` передавай, только если пользователь назвал проект: без него вызов идёт в текущий и текущий не меняет. Исходники конфигурации и расширений расширение находит само.

Не вызывай: `cf_loadByList`, `cfe_loadByList` (при `wait: true` отказ, загрузки нет), `cfe_borrowObject`, `epf_addBspRegistration` (окно и выделенный узел), `server_selectServices` (окно выбора сервисов, параметров нет). Запуск задачи по имени в MCP нет: человек запускает `1c-platform-tools.tasks.run` и `1c-platform-tools.tasks.runOscript` из палитры.

Колонка «нет» — инструмента нет. Такую команду через канал агента не вызывай и имя инструмента не собирай. Подробности по доменам — в навыках `1c-platform-tools-*`. Полный список имён MCP и колонка `wait: true` — в навыке `1c-platform-tools-mcp`.

## Проекты окна

Проект — каталог с `packagedef`. `project_list` возвращает проекты, вид `kind` (`designer`, `edt`, `onec`, `onescript`) и текущий. `project_select` с `root` делает проект текущим, в том числе у пользователя. `project_list` и `project_select` параметра `projectPath` не имеют. Без `wait` команда списка открывает окно выбора у человека; у MCP `wait: true` по умолчанию, список приходит в ответ.

`project_init` и `deps_initPackagedef` создают `packagedef` в обязательном `projectPath` и делают проект текущим. Для Execute Command каталог можно передать и полем `root`. Существующий `packagedef` не перезаписывается.

| Задача | Command ID | MCP |
|---|---|---|
| Список проектов | `1c-platform-tools.project.list` | `project_list` |
| Выбрать проект | `1c-platform-tools.project.select` | `project_select` |
| Создать packagedef | `1c-platform-tools.project.initialize` | `project_init` |
| Показать панель свойств | `1c-platform-tools.properties.show` | `properties_show` |

## Информационные базы

| Задача | Command ID | MCP |
|---|---|---|
| Создать пустую ИБ | `1c-platform-tools.infobase.create` | `infobase_create` |
| Инициализировать конфигурацию из исходного кода | `1c-platform-tools.infobase.initFromSrc` | `infobase_initFromSrc` |
| Обновить конфигурацию базы | `1c-platform-tools.infobase.updateDb` | `infobase_updateDb` |
| Выполнить обработчики обновления | `1c-platform-tools.infobase.runUpdateHandlers` | `infobase_runUpdateHandlers` |
| Инициализировать данные | `1c-platform-tools.infobase.initialize` | `infobase_init` |
| Выгрузить в dt | `1c-platform-tools.infobase.dumpDt` | `infobase_dumpDt` |
| Загрузить из dt | `1c-platform-tools.infobase.restoreDt` | `infobase_restoreDt` |
| Запретить внешние ресурсы | `1c-platform-tools.infobase.blockExternalResources` | `infobase_blockExtRes` |

## Конфигурация

| Задача | Command ID | MCP |
|---|---|---|
| Загрузить из исходного кода | `1c-platform-tools.cf.load` | `cf_load` |
| Загрузить изменения | `1c-platform-tools.cf.loadIncrement` | `cf_loadInc` |
| Загрузить из objlist.txt | `1c-platform-tools.cf.loadByList` | `cf_loadByList` |
| Загрузить из 1Cv8.cf | `1c-platform-tools.cf.loadFile` | `cf_loadFile` |
| Выгрузить в исходный код | `1c-platform-tools.cf.dump` | `cf_dump` |
| Выгрузить изменения | `1c-platform-tools.cf.dumpIncrement` | `cf_dumpInc` |
| Выгрузить в 1Cv8.cf | `1c-platform-tools.cf.unload` | `cf_unload` |
| Собрать 1Cv8.cf | `1c-platform-tools.cf.compile` | `cf_compile` |
| Разобрать 1Cv8.cf | `1c-platform-tools.cf.decompile` | `cf_decompile` |
| Конвертировать исходный код | `1c-platform-tools.cf.convert` | `cf_convert` |
| Выгрузить поставку | `1c-platform-tools.cf.makeDist` | `cf_makeDist` |

## Расширения

Тестовые расширения лежат в каталоге из настройки `1c-platform-tools.test.directoryName`.

| Задача | Command ID | MCP |
|---|---|---|
| Загрузить из исходного кода | `1c-platform-tools.cfe.load` | `cfe_load` |
| Загрузить из objlist.txt | `1c-platform-tools.cfe.loadByList` | `cfe_loadByList` |
| Загрузить из *.cfe | `1c-platform-tools.cfe.loadFile` | `cfe_loadFile` |
| Выгрузить в исходный код | `1c-platform-tools.cfe.dump` | `cfe_dump` |
| Выгрузить в *.cfe | `1c-platform-tools.cfe.unload` | `cfe_unload` |
| Собрать *.cfe | `1c-platform-tools.cfe.compile` | `cfe_compile` |
| Разобрать *.cfe | `1c-platform-tools.cfe.decompile` | `cfe_decompile` |
| Конвертировать исходный код | `1c-platform-tools.cfe.convert` | `cfe_convert` |
| Обновить расширения в базе | `1c-platform-tools.cfe.updateDb` | `cfe_updateDb` |
| Добавить объект в расширение | `1c-platform-tools.cfe.borrowObject` | `cfe_borrowObject` |
| Загрузить тестовые расширения | `1c-platform-tools.test.loadExtensions` | `test_loadExts` |
| Выгрузить тестовые расширения | `1c-platform-tools.test.dumpExtensions` | `test_dumpExts` |
| Собрать тестовые расширения | `1c-platform-tools.test.compileExtensions` | `test_compileExts` |
| Разобрать тестовые расширения | `1c-platform-tools.test.decompileExtensions` | `test_decompileExts` |
| Добавить YAxUnit | `1c-platform-tools.test.addYaxunit` | `test_addYaxunit` |

## Внешние обработки и отчёты

| Задача | Command ID | MCP |
|---|---|---|
| Собрать обработки | `1c-platform-tools.epf.compileProcessor` | `epf_compileProc` |
| Разобрать обработки | `1c-platform-tools.epf.decompileProcessor` | `epf_decompileProc` |
| Собрать отчёты | `1c-platform-tools.epf.compileReport` | `epf_compileReport` |
| Разобрать отчёты | `1c-platform-tools.epf.decompileReport` | `epf_decompileReport` |
| Удалить кэш | `1c-platform-tools.epf.clearCache` | `epf_clearCache` |
| Запустить обработку в Предприятии | `1c-platform-tools.epf.run` | `epf_run` |
| Добавить регистрацию БСП | `1c-platform-tools.epf.addBspRegistration` | `epf_addBspRegistration` |

## Поддержка, поставка и версия

В MCP из поддержки есть только `cf_makeDist`. Остальное — мастера для человека.

| Задача | Command ID | MCP |
|---|---|---|
| Загрузить из cf/cfu | `1c-platform-tools.support.updateCfg` | нет |
| Снять с поддержки | `1c-platform-tools.support.disableCfgSupport` | нет |
| Файл описания шаблона | `1c-platform-tools.support.createDeliveryDescriptionFile` | нет |
| Файлы поставки и обновления | `1c-platform-tools.support.createDistributionFiles` | нет |
| Комплект поставки | `1c-platform-tools.support.createDistributivePackage` | нет |
| Файл списка шаблонов | `1c-platform-tools.support.createTemplateListFile` | нет |
| Версия конфигурации | `1c-platform-tools.cf.setVersion` | нет |
| Версия расширения | `1c-platform-tools.cfe.setVersion` | нет |
| Версия обработки | `1c-platform-tools.epf.setVersionProcessor` | нет |
| Версия отчёта | `1c-platform-tools.epf.setVersionReport` | нет |

## Зависимости

| Задача | Command ID | MCP |
|---|---|---|
| Создать packagedef | `1c-platform-tools.dependencies.initializePackagedef` | `deps_initPackagedef` |
| Создать каталоги проекта | `1c-platform-tools.dependencies.initializeProjectStructure` | `deps_initProjStruct` |
| Установить OneScript | `1c-platform-tools.dependencies.installOscript` | `deps_installOscript` |
| Обновить opm | `1c-platform-tools.dependencies.updateOpm` | `deps_updateOpm` |
| Установить зависимости | `1c-platform-tools.dependencies.install` | `deps_install` |
| Удалить зависимости | `1c-platform-tools.dependencies.remove` | `deps_remove` |
| Настроить Git | `1c-platform-tools.dependencies.setupGit` | нет |

Зависимости ставь через `deps_install`. Если oscript уже есть, `deps_installOscript` не вызывай: он ставит интерпретатор. К `opm install` в терминале переходи, когда MCP недоступен. Git-мастер агенту недоступен: настраивай git командами git.

## Запуск, сервер, отладка

| Задача | Command ID | MCP |
|---|---|---|
| Предприятие | `1c-platform-tools.run.enterprise` | `run_enterprise` |
| Конфигуратор | `1c-platform-tools.run.designer` | `run_designer` |
| EDT | `1c-platform-tools.run.edt` | `run_edt` |
| Запустить автономный сервер | `1c-platform-tools.server.start` | `server_start` |
| Остановить автономный сервер | `1c-platform-tools.server.stop` | `server_stop` |
| Перезапустить автономный сервер | `1c-platform-tools.server.restart` | `server_restart` |
| Отладка автономного сервера | `1c-platform-tools.server.debug` | `server_debug` |
| Журнал автономного сервера | `1c-platform-tools.server.showLogs` | `server_showLogs` |
| Конфиг публикации | `1c-platform-tools.server.openConfig` | `server_openConfig` |
| Открыть публикацию в браузере | `1c-platform-tools.server.openInBrowser` | `server_openInBrowser` |
| Выбрать публикуемые сервисы | `1c-platform-tools.server.selectServices` | `server_selectServices` |
| Начать замер | `1c-platform-tools.debug.measure.start` | `debug_measure_start` |
| Закончить замер | `1c-platform-tools.debug.measure.stop` | `debug_measure_stop` |
| Очистить замер | `1c-platform-tools.debug.measure.clear` | `debug_measure_clear` |
| Показать результаты замера | `1c-platform-tools.debug.measure.showResults` | `debug_measure_showResults` |
| Показать значение переменной | `1c-platform-tools.debug.showVariableInWindow` | `debug_showVariableInWindow` |

## Тестирование

| Задача | Command ID | MCP |
|---|---|---|
| xUnit | `1c-platform-tools.test.xunit` | `test_xunit` |
| Vanessa | `1c-platform-tools.test.vanessa` | `test_vanessa` |
| YAxUnit | `1c-platform-tools.test.yaxunit` | `test_yaxunit` |
| Мутационное тестирование | `1c-platform-tools.test.mutatos` | `test_mutatos` |
| Синтаксический контроль | `1c-platform-tools.syntaxCheck.run` | `syntaxCheck_run` |
| Обновить Problems | `1c-platform-tools.syntaxCheck.refresh` | `syntaxCheck_refresh` |
| Очистить Problems | `1c-platform-tools.syntaxCheck.clear` | `syntaxCheck_clear` |
| Allure | `1c-platform-tools.test.allure` | `test_allure` |
| Включить фреймворки | `1c-platform-tools.test.configure` | `test_configure` |
| Собрать unit-тесты | `1c-platform-tools.test.compileEpf` | `test_compileEpf` |
| Разобрать unit-тесты | `1c-platform-tools.test.decompileEpf` | `test_decompileEpf` |
| Проверить проект EDT | `1c-platform-tools.test.validateEdt` | `test_validateEdt` |
| Открыть отчёт мутаций в браузере | `1c-platform-tools.test.mutatosReport` | нет |

## EDT

| Задача | Command ID | MCP |
|---|---|---|
| Импорт в EDT | `1c-platform-tools.edt.import` | `edt_import` |
| Выгрузка EDT в XML | `1c-platform-tools.edt.export` | `edt_export` |
| Проверка EDT | `1c-platform-tools.edt.validate` | `edt_validate` |
| Форматировать модули | `1c-platform-tools.edt.formatModules` | `edt_formatModules` |
| Сортировать объекты | `1c-platform-tools.edt.sortProject` | `edt_sortProj` |
| Сведения о проекте EDT | `1c-platform-tools.edt.projectInfo` | `edt_projectInfo` |

## Сеансы

| Задача | Command ID | MCP |
|---|---|---|
| Запретить начало сеансов | `1c-platform-tools.session.lock` | `session_lock` |
| Разрешить начало сеансов | `1c-platform-tools.session.unlock` | `session_unlock` |
| Запретить регламентные задания | `1c-platform-tools.session.lockJobs` | `session_lockJobs` |
| Разрешить регламентные задания | `1c-platform-tools.session.unlockJobs` | `session_unlockJobs` |
| Завершить сеансы | `1c-platform-tools.session.kill` | `session_kill` |
| Проверить, что сеансов нет | `1c-platform-tools.session.checkClosed` | `session_checkClosed` |
| Показать сеансы | `1c-platform-tools.session.list` | `session_list` |

## OData и пайплайны

| Задача | Command ID | MCP |
|---|---|---|
| Запрос OData | `1c-platform-tools.odata.query` | `odata_query` |
| Состав OData | `1c-platform-tools.odata.setup` | `odata_setup` |
| Запустить пайплайн | `1c-platform-tools.pipelines.run` | `pipelines_run` |

## Окружение, задачи, служебные файлы

| Задача | Command ID | MCP |
|---|---|---|
| Состояние окружения | `1c-platform-tools.env.status` | `env_status` |
| Выбрать профиль | `1c-platform-tools.env.selectProfile` | `env_selectProfile` |
| Сбросить временные параметры | `1c-platform-tools.env.clearOverrides` | `env_clearOverrides` |
| Определить версию vanessa-runner | `1c-platform-tools.env.refreshVersion` | `env_refreshVersion` |
| Открыть env.json | `1c-platform-tools.env.editSettingsFile` | `env_editSettingsFile` |
| Редактор профиля | `1c-platform-tools.env.openProfileEditor` | `env_openProfileEditor` |
| Создать профиль | `1c-platform-tools.env.createProfile` | нет |
| Временные параметры окном | `1c-platform-tools.env.setOverrides` | нет |
| Открыть launch.json | `1c-platform-tools.launch.editConfigurations` | нет |
| Открыть tasks.json | `1c-platform-tools.tasks.edit` | `tasks_edit` |
| Обновить дерево задач | `1c-platform-tools.tasks.view` | `tasks_view` |
| Запустить задачу | `1c-platform-tools.tasks.run` | нет |
| Запустить задачу OneScript | `1c-platform-tools.tasks.runOscript` | нет |
| Базовый набор служебных файлов | `1c-platform-tools.serviceFiles.createRecommendedSet` | `serviceFiles_createRecommendedSet` |
| Создать .gitignore | `1c-platform-tools.serviceFiles.createGitignore` | `serviceFiles_createGitignore` |
| Создать .gitattributes | `1c-platform-tools.serviceFiles.createGitattributes` | `serviceFiles_createGitattributes` |
| Создать env.json | `1c-platform-tools.serviceFiles.createEnvJson` | `serviceFiles_createEnvJson` |
| Меню служебных файлов | `1c-platform-tools.serviceFiles.create` | нет |

## Метаданные и справка

Команды метаданных, ER-диаграммы и справки в MCP не публикуются. В том числе `1c-platform-tools.metadata.getProjectTree`, `1c-platform-tools.metadata.er.openCanvas`, `1c-platform-tools.metadata.er.openForObject`, `1c-platform-tools.help.copyEnvironmentSummary`. Имя инструмента для них не собирай. Состояние окружения запуска читает `env_status`.

## Дополнительные навыки

Навык 1c-platform-tools отвечает за пакетные операции: загрузка и выгрузка, сборка EPF/ERF, запуск. Свойства объектов пишет панель свойств расширения, XML метаданных руками не правь. Для остального редактирования XML, форм, ролей и СКД ставится [cc-1c-skills](https://github.com/Nikolay-Shirokov/cc-1c-skills): слэш-команды вроде `/epf-build` и `/cf-edit`. Команды расширения запускают операции, cc-1c-skills правит исходники.

Опубликованную команду выполняй сам. Не пиши, что из чата вызвать нельзя, и не отсылай к Ctrl+Shift+P. Палитру или панель «1С: Инструменты» называй только если в твоём наборе нет выполнения команд. `1cv8` и bat-файлы вручную не запускай: подключение задано в проекте.
