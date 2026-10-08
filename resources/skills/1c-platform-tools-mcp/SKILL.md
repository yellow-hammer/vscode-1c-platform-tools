---
name: 1c-platform-tools-mcp
description: Инструменты MCP сервера mcp-1c-platform-tools. Используй, когда нужно вызвать операцию 1С через MCP. Имена бери только из таблиц этого навыка.
---

# MCP: инструменты mcp-1c-platform-tools

Если пользователь назвал инструмент по имени, вызови этот инструмент. Таблицы ниже — когда имя не названо.

Сервер публикует команды расширения. Имя в таблице — точное: его не собирают из command id вручную. Имени нет в таблицах — инструмента нет, другое имя не подбирай.

## Проекты окна и projectPath

Проект — каталог с `packagedef`. В окне их может быть несколько.

| Инструмент | Параметры | Что делает |
|---|---|---|
| `project_list` | `wait` | Проекты окна: корень, имя, `kind` (`designer`, `edt`, `onec`, `onescript`), текущий проект и `candidates` без `packagedef`. `projectPath` нет |
| `project_select` | `root`, `wait` | Делает проект текущим, в том числе у пользователя. `root` — корень из `project_list`. `projectPath` нет |
| `project_init` | `projectPath`, `wait` | Создаёт `packagedef` в каталоге `projectPath` и делает проект текущим. `projectPath` обязателен. Существующий `packagedef` не перезаписывается |

У остальных инструментов `projectPath` необязателен: без него вызов идёт в текущем проекте и текущий проект не меняет. Относительный путь считается от текущего. Тот же `packagedef` создаёт `deps_initPackagedef`.

## Параметр wait

`wait: true` по умолчанию. В ответе `success`, `exitCode`, `stdout`, `stderr`, при необходимости `artifact`, `artifacts`, `tests`, `errors`, `data`.

`wait: false` запускает команду без ожидания структурированного исхода.

Колонка «wait: true» в таблицах:

- **результат** — жди ответ и читай его;
- **без исхода** — ответ только подтверждает запуск, stdout операции нет;
- **отказ** — при `wait: true` команда сразу возвращает ошибку и ничего не делает; нужен `wait: false`;
- **пустой** — обработчик ничего не возвращает. При `wait: true` канал отвечает, что wait не поддерживается, хотя действие уже могло выполниться. Вызывай с `wait: false` и не повторяй вызов из-за этой фразы.

Упавшие тесты, ненулевой код и непустой `errors` приходят как ошибка вызова. У `syntaxCheck_run` поле `errors`: `filepath` (путь к модулю от корня проекта), `metadataPath`, `severity` (`error` или `warning`), `message`. Правь исходники по `errors`. У прогона тестов поле `tests`: `total`, `passed`, `failed`, `errors`, `skipped`, `reportPath`, `failedTests`.

## Общие параметры

`settingsFile` и `ibConnection` есть у команд vanessa-runner. Их нет у `env_status`, `env_selectProfile`, `env_clearOverrides`, `env_refreshVersion`, `env_editSettingsFile`, `env_openProfileEditor`, `deps_initPackagedef`, `deps_initProjStruct`, `deps_install`, `deps_installOscript`, `deps_updateOpm`, `deps_remove`, `pipelines_run`, `project_list`, `project_select` и `project_init`. У `odata_query` есть `settingsFile` и нет `ibConnection`.

Каталоги исходников инструменты не принимают: конфигурацию, расширения и внешние файлы расширение находит в проекте само.

Явный `settingsFile` отменяет перекрытия активного профиля и не отменяет `ibConnection`. Явный `ibConnection` убирает из перекрытий подключение, пользователя и пароль и передаётся в команду. Замечания приходят в stdout строками `[контекст]`, в том числе «Подключение из вызова: …». Длинный вывод в ответе обрезается до хвоста: первая строка `[начало вывода пропущено: N символов]`.

Отдельные параметры есть только у своих команд: `sha` у `cf_loadInc`, `updateDb` у `cf_load`, `cf_loadInc`, `cf_loadFile`, `cf_loadByList` и `cfe_load`, `extensions` у `cfe_load`, `cfe_loadFile`, `cfe_loadByList`, `cfe_dump`, `cfe_unload`, `cfe_compile`, `cfe_decompile`, `cfe_convert`, `cfe_updateDb`, `cfe_borrowObject`, `test_loadExts`, `test_dumpExts`, `test_compileExts` и `test_decompileExts`, `outputDirectory` и `outputName` у `cf_unload`, `cf_compile`, `cf_makeDist`, `cfe_unload`, `cfe_compile`, `epf_compileProc` и `epf_compileReport`, `profile` у `env_selectProfile`, `frameworks` у `test_configure`, `execute` и `command` у `run_enterprise` и `epf_run`, `pipeline` у `pipelines_run`. Параметры сеанса — в разделе «Сеансы», параметры OData — у `odata_query` и `odata_setup`.

`outputName` — имя файла без расширения. Переменные: `${name}`, `${folder}`, `${version}`, `${gitBranch}`. Одно имя без переменных на несколько объектов команду не запускает.

## Конфигурация

Загрузка изменений, выгрузка изменений и загрузка по `objlist.txt` есть у выгрузки конфигуратора. Агентный вызов `cf_loadInc` без `sha` отклоняется: пустая строка — полная загрузка. SHA пишется в `lastUploadedCommit.txt` в каталоге исходников конфигурации.

| Инструмент | Command ID | wait: true | Параметры |
|---|---|---|---|
| `cf_load` | `1c-platform-tools.cf.load` | результат | `updateDb` |
| `cf_loadInc` | `1c-platform-tools.cf.loadIncrement` | результат | `sha`, `updateDb` |
| `cf_loadFile` | `1c-platform-tools.cf.loadFile` | результат | `updateDb` |
| `cf_loadByList` | `1c-platform-tools.cf.loadByList` | отказ | «Загрузка по objlist.txt требует подготовки списка в UI; wait: true недоступен» |
| `cf_dump` | `1c-platform-tools.cf.dump` | результат | |
| `cf_dumpInc` | `1c-platform-tools.cf.dumpIncrement` | результат | |
| `cf_unload` | `1c-platform-tools.cf.unload` | результат | `outputDirectory`, `outputName` |
| `cf_compile` | `1c-platform-tools.cf.compile` | результат | `outputDirectory`, `outputName` |
| `cf_decompile` | `1c-platform-tools.cf.decompile` | результат | |
| `cf_convert` | `1c-platform-tools.cf.convert` | результат | |
| `cf_makeDist` | `1c-platform-tools.cf.makeDist` | результат | `outputDirectory`, `outputName` |

`infobase_updateDb` обновляет конфигурацию базы отдельно от загрузки. `updateDb: true` у `cf_load`, `cf_loadInc` и `cf_loadFile` делает это тем же запуском. Без параметра загрузка не обновляет базу, если в настройках проекта не задано иное.

## Расширения

`extensions` — имя каталога, путь от корня проекта или имя из метаданных. Явный список окно не открывает и сохранённый выбор не меняет. Без параметра сначала берётся непустая настройка (`1c-platform-tools.cfe.selected` у расширений решения, `1c-platform-tools.test.cfe.selected` у тестовых), иначе сохранённый выбор проекта, а если он пуст или уже не подходит составу — все расширения.

| Инструмент | Command ID | wait: true | Параметры |
|---|---|---|---|
| `cfe_load` | `1c-platform-tools.cfe.load` | результат | `extensions`, `updateDb` |
| `cfe_loadFile` | `1c-platform-tools.cfe.loadFile` | результат | `extensions` |
| `cfe_loadByList` | `1c-platform-tools.cfe.loadByList` | отказ | «Частичная загрузка расширений по objlist — несколько шагов; wait: true недоступен» |
| `cfe_dump` | `1c-platform-tools.cfe.dump` | результат | `extensions` |
| `cfe_unload` | `1c-platform-tools.cfe.unload` | результат | `extensions`, `outputDirectory`, `outputName` |
| `cfe_compile` | `1c-platform-tools.cfe.compile` | результат | `extensions`, `outputDirectory`, `outputName` |
| `cfe_decompile` | `1c-platform-tools.cfe.decompile` | результат | `extensions` |
| `cfe_convert` | `1c-platform-tools.cfe.convert` | результат | `extensions` |
| `cfe_updateDb` | `1c-platform-tools.cfe.updateDb` | результат | `extensions` |
| `cfe_borrowObject` | `1c-platform-tools.cfe.borrowObject` | пустой | работает с выделенным узлом метаданных и окном выбора, для агента не вызывай |

Тестовые расширения (каталог задаёт настройка `1c-platform-tools.test.directoryName`, отбор — `1c-platform-tools.test.cfe.selected`):

| Инструмент | Command ID | wait: true |
|---|---|---|
| `test_loadExts` | `1c-platform-tools.test.loadExtensions` | результат |
| `test_dumpExts` | `1c-platform-tools.test.dumpExtensions` | результат |
| `test_compileExts` | `1c-platform-tools.test.compileExtensions` | результат |
| `test_decompileExts` | `1c-platform-tools.test.decompileExtensions` | результат |
| `test_addYaxunit` | `1c-platform-tools.test.addYaxunit` | результат |

У четырёх команд с `Exts` в имени есть параметр `extensions`. У `test_addYaxunit` его нет.

## Информационная база

| Инструмент | Command ID | wait: true |
|---|---|---|
| `infobase_create` | `1c-platform-tools.infobase.create` | результат |
| `infobase_initFromSrc` | `1c-platform-tools.infobase.initFromSrc` | результат |
| `infobase_updateDb` | `1c-platform-tools.infobase.updateDb` | результат |
| `infobase_runUpdateHandlers` | `1c-platform-tools.infobase.runUpdateHandlers` | результат |
| `infobase_init` | `1c-platform-tools.infobase.initialize` | результат |
| `infobase_dumpDt` | `1c-platform-tools.infobase.dumpDt` | результат |
| `infobase_restoreDt` | `1c-platform-tools.infobase.restoreDt` | результат |
| `infobase_blockExtRes` | `1c-platform-tools.infobase.blockExternalResources` | результат |

## Внешние обработки и отчёты

| Инструмент | Command ID | wait: true | Параметры |
|---|---|---|---|
| `epf_compileProc` | `1c-platform-tools.epf.compileProcessor` | результат | `outputDirectory`, `outputName` |
| `epf_decompileProc` | `1c-platform-tools.epf.decompileProcessor` | результат | |
| `epf_compileReport` | `1c-platform-tools.epf.compileReport` | результат | `outputDirectory`, `outputName` |
| `epf_decompileReport` | `1c-platform-tools.epf.decompileReport` | результат | |
| `epf_clearCache` | `1c-platform-tools.epf.clearCache` | отказ | «Очистка кэша — файловая операция, не vrunner» |
| `epf_run` | `1c-platform-tools.epf.run` | результат | `execute`, `command`; нужен хотя бы один |
| `epf_addBspRegistration` | `1c-platform-tools.epf.addBspRegistration` | пустой | спрашивает представление и пишет в выделенный объект; для агента не вызывай |

## Запуск, сервер, отладка

`run_designer` и `run_enterprise` возвращают, удалось ли стартовать; окно платформы остаётся у пользователя. `run_enterprise` принимает `execute` и `command`, как `epf_run`.

| Инструмент | Command ID | wait: true |
|---|---|---|
| `run_designer` | `1c-platform-tools.run.designer` | результат |
| `run_enterprise` | `1c-platform-tools.run.enterprise` | результат |
| `run_edt` | `1c-platform-tools.run.edt` | пустой |
| `server_start` | `1c-platform-tools.server.start` | без исхода |
| `server_stop` | `1c-platform-tools.server.stop` | без исхода |
| `server_restart` | `1c-platform-tools.server.restart` | без исхода |
| `server_debug` | `1c-platform-tools.server.debug` | без исхода |
| `server_showLogs` | `1c-platform-tools.server.showLogs` | без исхода |
| `server_openConfig` | `1c-platform-tools.server.openConfig` | без исхода |
| `server_openInBrowser` | `1c-platform-tools.server.openInBrowser` | без исхода |
| `server_selectServices` | `1c-platform-tools.server.selectServices` | без исхода, не вызывай |
| `debug_measure_start` | `1c-platform-tools.debug.measure.start` | без исхода |
| `debug_measure_stop` | `1c-platform-tools.debug.measure.stop` | без исхода |
| `debug_measure_clear` | `1c-platform-tools.debug.measure.clear` | без исхода |
| `debug_measure_showResults` | `1c-platform-tools.debug.measure.showResults` | без исхода |
| `debug_showVariableInWindow` | `1c-platform-tools.debug.showVariableInWindow` | без исхода |

`debug_showVariableInWindow` открывает значение переменной текущего сеанса отладки. Замер относится к сеансу отладки 1С. `server_selectServices` открывает окно выбора сервисов и параметров не принимает: состав публикации отмечает человек, агенту инструмент не вызывай.

## Зависимости

| Инструмент | Command ID | wait: true |
|---|---|---|
| `deps_initPackagedef` | `1c-platform-tools.dependencies.initializePackagedef` | результат |
| `deps_initProjStruct` | `1c-platform-tools.dependencies.initializeProjectStructure` | без исхода |
| `deps_install` | `1c-platform-tools.dependencies.install` | без исхода |
| `deps_installOscript` | `1c-platform-tools.dependencies.installOscript` | без исхода |
| `deps_updateOpm` | `1c-platform-tools.dependencies.updateOpm` | без исхода |
| `deps_remove` | `1c-platform-tools.dependencies.remove` | без исхода |

`deps_initPackagedef` совпадает с `project_init`: обязательный `projectPath`, создаёт `packagedef`. `deps_install` ставит зависимости по `packagedef`, `deps_installOscript` ставит OneScript. К `opm install` в терминале переходи, когда этих инструментов нет.

## Окружение и служебные файлы

`env_status` возвращает JSON: `activeProfileId`, `settingsFile`, `settingsFileExists`, `settingsSchema`, `profiles`, `overrides`, `localOverrides`, `gitBranch`, `effectiveIbConnection`, `vrunnerVersion`, `odata`. Пароль замаскирован. Перед операцией, которая зависит от окружения, смотри этот ответ.

| Инструмент | Command ID | wait: true |
|---|---|---|
| `env_status` | `1c-platform-tools.env.status` | результат |
| `env_selectProfile` | `1c-platform-tools.env.selectProfile` | результат |
| `env_clearOverrides` | `1c-platform-tools.env.clearOverrides` | результат |
| `env_refreshVersion` | `1c-platform-tools.env.refreshVersion` | результат |
| `env_editSettingsFile` | `1c-platform-tools.env.editSettingsFile` | пустой |
| `env_openProfileEditor` | `1c-platform-tools.env.openProfileEditor` | пустой |
| `serviceFiles_createRecommendedSet` | `1c-platform-tools.serviceFiles.createRecommendedSet` | пустой |
| `serviceFiles_createGitignore` | `1c-platform-tools.serviceFiles.createGitignore` | пустой |
| `serviceFiles_createGitattributes` | `1c-platform-tools.serviceFiles.createGitattributes` | пустой |
| `serviceFiles_createEnvJson` | `1c-platform-tools.serviceFiles.createEnvJson` | пустой |

`env_selectProfile`: параметр `profile` — id (`dev`), имя файла (`env.dev.json`, `autumn-properties.ci.json`) или подпись (`По умолчанию`). Профиль из запроса пользователя («под test», «переключись на storage») переключай этой командой. Неназванный не переключай. Разовый прогон без смены активного профиля — `settingsFile` у команды vanessa-runner. Без `profile` вызов возвращает ошибку и список доступных id, окно не открывает.

## Тестирование

| Инструмент | Command ID | wait: true |
|---|---|---|
| `test_xunit` | `1c-platform-tools.test.xunit` | результат |
| `test_vanessa` | `1c-platform-tools.test.vanessa` | результат |
| `test_yaxunit` | `1c-platform-tools.test.yaxunit` | результат |
| `test_mutatos` | `1c-platform-tools.test.mutatos` | результат |
| `syntaxCheck_run` | `1c-platform-tools.syntaxCheck.run` | результат |
| `syntaxCheck_refresh` | `1c-platform-tools.syntaxCheck.refresh` | без исхода |
| `syntaxCheck_clear` | `1c-platform-tools.syntaxCheck.clear` | без исхода |
| `test_allure` | `1c-platform-tools.test.allure` | отказ |
| `test_configure` | `1c-platform-tools.test.configure` | результат |
| `test_compileEpf` | `1c-platform-tools.test.compileEpf` | результат |
| `test_decompileEpf` | `1c-platform-tools.test.decompileEpf` | результат |
| `test_validateEdt` | `1c-platform-tools.test.validateEdt` | результат |

`test_allure` при `wait: true` отвечает «Allure-отчёт открывается в браузере; wait: true недоступен» и отчёт не строит. Вызов с `wait: false` строит отчёт и открывает его в браузере.

`test_configure`: `frameworks` — `vanessa`, `xunit`, `yaxunit`, `onescript`, `onebdd`. Перечисленные включаются, остальные выключаются. Без `frameworks` агентный вызов возвращает ошибку.

`test_validateEdt` — проверка проекта EDT через vanessa-runner 3.x, с результатом. Команда `edt_validate` — другая.

## EDT

Команды ниже для проекта формата EDT. Ответ инструмента исход не содержит (колонка «пустой»). Проверка с результатом — `test_validateEdt`.

| Инструмент | Command ID | wait: true |
|---|---|---|
| `edt_import` | `1c-platform-tools.edt.import` | пустой |
| `edt_export` | `1c-platform-tools.edt.export` | пустой |
| `edt_validate` | `1c-platform-tools.edt.validate` | пустой |
| `edt_formatModules` | `1c-platform-tools.edt.formatModules` | пустой |
| `edt_sortProj` | `1c-platform-tools.edt.sortProject` | пустой |
| `edt_projectInfo` | `1c-platform-tools.edt.projectInfo` | пустой |

## Сеансы

Подключение к кластеру берётся из профиля. У `session_lock`, `session_unlock`, `session_lockJobs`, `session_unlockJobs`, `session_kill`, `session_checkClosed` и `session_list` есть `lockMessage`, `accessCode`, `lockStart`, `lockEnd` (время — только vanessa-runner 2.x).

| Инструмент | Command ID | Дополнительно |
|---|---|---|
| `session_lock` | `1c-platform-tools.session.lock` | |
| `session_unlock` | `1c-platform-tools.session.unlock` | |
| `session_lockJobs` | `1c-platform-tools.session.lockJobs` | |
| `session_unlockJobs` | `1c-platform-tools.session.unlockJobs` | |
| `session_kill` | `1c-platform-tools.session.kill` | `sessionFilter`, `sessionFilterMode`, `keepSessionsUnlocked`, `sessionRetry`, `sessionTimeout` |
| `session_checkClosed` | `1c-platform-tools.session.checkClosed` | `sessionFilter`, `sessionFilterMode`, `sessionTimeout` |
| `session_list` | `1c-platform-tools.session.list` | `sessionFilter`, `sessionFilterMode`, `sessionConnections`; только vanessa-runner 3.x |

У всех семи `wait: true` возвращает результат. `sessionFilterMode`: `ONLY`, `OFF`, `EXCEPT`; `DEFAULT` и `ALL` — только vanessa-runner 2.x.

## Пайплайны, задачи, панель свойств

| Инструмент | Command ID | wait: true |
|---|---|---|
| `pipelines_run` | `1c-platform-tools.pipelines.run` | результат |
| `tasks_edit` | `1c-platform-tools.tasks.edit` | без исхода |
| `tasks_view` | `1c-platform-tools.tasks.view` | без исхода |
| `properties_show` | `1c-platform-tools.properties.show` | пустой |

`pipelines_run`: параметр `pipeline` обязателен (id или название из `.1cpt/pipelines.json`). Без него команда не выбирает цепочку сама.

`tasks_edit` открывает `tasks.json`. `tasks_view` обновляет дерево задач. Запуск задачи по имени в MCP нет: `1c-platform-tools.tasks.run` и `1c-platform-tools.tasks.runOscript` выполняет человек из палитры. `properties_show` только показывает панель свойств.

## Данные базы через OData

| Задача | Инструмент MCP |
|---|---|
| Прочитать, создать, изменить, удалить данные | `odata_query` |
| Показать или изменить состав интерфейса | `odata_setup` |

**`odata_query`** обращается к `…/odata/standard.odata/`:

- адрес — публикация запущенного автономного сервера проекта (`server_start`, в составе публикации нужен OData) либо своя публикация из параметра `url` (корень публикации, например `http://srv/base`);
- `resource` — набор (`Catalog_Номенклатура`), элемент (`Catalog_Номенклатура(guid'…')`), свойство или `$metadata`;
- `method` — `GET` по умолчанию; `POST` создаёт, `PATCH` меняет переданные поля, `PUT` заменяет элемент целиком (поля не из `body` сбрасываются — для правки не используй), `DELETE` удаляет: вызывай их только по явной просьбе пользователя;
- выборка — `filter`, `select`, `expand`, `orderby`, `top`, `skip`; тело записи — `body`: строка с JSON объекта (`{"Description":"Стол"}`);
- учётная запись — `db-user` и `db-pwd` активного профиля (или `settingsFile`), пароль в вызов не передаётся.

Своя публикация из `url` — обычно чужая или продуктивная база. К ней только `GET`, всегда с `select` и `top`; учётная запись — из профиля, который назвал пользователь (`settingsFile`). `odata_setup` работает с базой Предприятия: `ibConnection`, если он передан, иначе база профиля. К публикации из `url` он не обращается.

Ответ содержит код HTTP и тело. Большая выборка урезается по записям с пометкой: сузь её `top`, `select`, `filter`. Ошибка объясняет причину: сервер не запущен или OData не опубликован, 401 по учётной записи профиля, объект не входит в состав интерфейса.

**`odata_setup`** работает с базой Предприятия (`ibConnection` или база профиля): состав интерфейса хранится в информационной базе.

- без `include` и `exclude` возвращает текущий состав именами наборов OData (`Catalog_Номенклатура`): при запущенном сервере из `$metadata`, без него — запуском Предприятия;
- `include` / `exclude` точечно включают и исключают объекты, остальной состав не меняется; имена полные (`Справочник.Номенклатура`) или как набор OData (`Catalog_Номенклатура`);
- `available: true` добавляет объекты проекта вне состава; у большой конфигурации список может быть неполным — это сказано в ответе.

Изменение состава выполняет служебная обработка в Предприятии: нужны административные права. Автономный сервер этой базы на время запуска останавливается и поднимается снова.

## Команды без инструмента

Мастера открывают окна и агентный вызов отклоняют. В MCP их нет, command id через канал агента не выполняется:

- поддержка и поставка, кроме `cf_makeDist`: `1c-platform-tools.support.updateCfg`, `1c-platform-tools.support.disableCfgSupport`, `1c-platform-tools.support.createDeliveryDescriptionFile`, `1c-platform-tools.support.createDistributionFiles`, `1c-platform-tools.support.createDistributivePackage`, `1c-platform-tools.support.createTemplateListFile`;
- версия: `1c-platform-tools.cf.setVersion`, `1c-platform-tools.cfe.setVersion`, `1c-platform-tools.epf.setVersionProcessor`, `1c-platform-tools.epf.setVersionReport`;
- `1c-platform-tools.dependencies.setupGit`, `1c-platform-tools.env.createProfile`, `1c-platform-tools.env.setOverrides`, `1c-platform-tools.launch.editConfigurations`, `1c-platform-tools.serviceFiles.create`;
- метаданные, кластер, список баз, панели проектов и дел, артефакты, справка.

Другую версию платформы или другую базу на один вызов передавай параметрами `settingsFile` или `ibConnection` рабочей команды. Профиль создаётся файлом `env.<id>.json`. Git настраивается командами git.

## Примеры

- Загрузка конфигурации текущего проекта: `cf_load`.
- Загрузка и обновление базы тем же запуском: `cf_load` с `updateDb: true`.
- Конфигуратор: `run_designer`.
- Зависимости: `deps_install`. OneScript: `deps_installOscript`.
- Другой проект: `project_list`, затем `project_select` с `root`.
- Десять товаров: `odata_query` с `resource: "Catalog_Номенклатура"`, `top: 10`, `select: "Ref_Key,Description"`. Ошибка про состав — `odata_setup` с `include: ["Catalog_Номенклатура"]` и повтор запроса.
- Синтаксический контроль: `syntaxCheck_run`.
