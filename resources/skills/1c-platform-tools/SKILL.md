---
name: 1c-platform-tools
description: Операции с платформой 1С в этом проекте — командами расширения 1C: Platform Tools. Используй, когда пользователь просит загрузить/выгрузить конфигурацию, запустить Конфигуратор или Предприятие, установить зависимости, выполнить любую операцию с платформой 1С. Выполняй команды сам (Execute Command / MCP), не запускай внешние скрипты.
---

# Команды 1C: Platform Tools для агента

**Если пользователь называет команду или MCP-инструмент по имени** (например «через run_designer», «вызови 1c-platform-tools.run.designer») — сразу вызови именно её, передай projectPath. Не заходи сначала в скилл и не перебирай все инструменты; таблицы ниже — когда задача сформулирована без имени команды.

Выполняй операции 1С через команды расширения. **Ты должен сам выполнять команду**, а не просить пользователя: при запросе «Запусти Конфигуратор» — вызови `1c-platform-tools.run.designer`, при «Запусти Предприятие» — `1c-platform-tools.run.enterprise` и т.д. по таблице ниже. Используй инструмент выполнения команд редактора (Execute Command / runCommand / выполнить команду VS Code). **Не пиши пользователю «из чата вызвать нельзя» или «нажмите Ctrl+Shift+P»** — выполни команду сам. Только если в твоём наборе инструментов нет выполнения команд — тогда предложи пользователю палитру или панель «1С: Инструменты».

## Информационные базы

| Задача                                | Command ID                                          |
|---------------------------------------|-----------------------------------------------------|
| Создать пустую ИБ                     | `1c-platform-tools.infobase.create`            |
| Обновить конфигурацию в ИБ            | `1c-platform-tools.infobase.updateDb`         |
| Выполнить обработчики обновления              | `1c-platform-tools.infobase.runUpdateHandlers`         |
| Запретить работу с внешними ресурсами | `1c-platform-tools.infobase.blockExternalResources` |
| Инициализировать данные               | `1c-platform-tools.infobase.initialize`             |
| Выгрузить в dt                        | `1c-platform-tools.infobase.dumpDt`               |
| Загрузить из dt                       | `1c-platform-tools.infobase.restoreDt`             |

## Конфигурация

| Задача                                | Command ID                                             |
|---------------------------------------|--------------------------------------------------------|
| Загрузить конфигурацию из src/cf      | `1c-platform-tools.cf.load`          |
| Загрузить только изменения (git diff) | `1c-platform-tools.cf.loadIncrement` |
| Загрузить из objlist.txt              | `1c-platform-tools.cf.loadByList`  |
| Загрузить из 1Cv8.cf                  | `1c-platform-tools.cf.loadFile`           |
| Выгрузить конфигурацию в src/cf       | `1c-platform-tools.cf.dump`            |
| Выгрузить изменения в src/cf          | `1c-platform-tools.cf.dumpIncrement`   |
| Выгрузить в 1Cv8.cf                   | `1c-platform-tools.cf.unload`             |
| Собрать 1Cv8.cf из src/cf             | `1c-platform-tools.cf.compile`                |
| Разобрать 1Cv8.cf в src/cf            | `1c-platform-tools.cf.decompile`            |

## Расширения

| Задача                          | Command ID                                         |
|---------------------------------|----------------------------------------------------|
| Загрузить расширение из src/cfe | `1c-platform-tools.cfe.load`         |
| Загрузить из objlist.txt        | `1c-platform-tools.cfe.loadByList` |
| Загрузить из *.cfe              | `1c-platform-tools.cfe.loadFile`         |
| Выгрузить расширение в src/cfe  | `1c-platform-tools.cfe.dump`           |
| Выгрузить в *.cfe               | `1c-platform-tools.cfe.unload`           |
| Собрать *.cfe из src/cfe        | `1c-platform-tools.cfe.compile`               |
| Разобрать *.cfe в src/cfe       | `1c-platform-tools.cfe.decompile`           |

Тестовые расширения (YAxUnit и расширение с тестами) лежат отдельно, в `tests/cfe`
(подкаталог корня тестов `path.tests`), и обслуживаются своими командами: `1c-platform-tools.test.loadExtensions`,
`test.dumpExtensions`, `test.buildExtensions`, `test.decompileExtensions`.

## Внешние обработки и отчёты

| Задача                      | Command ID                                       |
|-----------------------------|--------------------------------------------------|
| Собрать внешнюю обработку   | `1c-platform-tools.epf.compileProcessor`     |
| Разобрать внешнюю обработку | `1c-platform-tools.epf.decompileProcessor` |
| Собрать внешний отчёт       | `1c-platform-tools.epf.compileReport`        |
| Разобрать внешний отчёт     | `1c-platform-tools.epf.decompileReport`    |
| Удалить кэш                 | `1c-platform-tools.epf.clearCache`     |

## Поддержка и поставка

| Задача                                       | Command ID                                                |
|----------------------------------------------|-----------------------------------------------------------|
| Выгрузить в 1Cv8dist.cf                      | `1c-platform-tools.cf.makeDist`              |
| Загрузить из cf/cfu                          | `1c-platform-tools.support.updateCfg`                     |
| Снять с поддержки                            | `1c-platform-tools.support.disableCfgSupport`             |
| Создать файл описания шаблона поставки       | `1c-platform-tools.support.createDeliveryDescriptionFile` |
| Создать файлы поставки и обновления (cf/cfu) | `1c-platform-tools.support.createDistributionFiles`       |
| Создать комплект поставки                    | `1c-platform-tools.support.createDistributivePackage`     |
| Создать файл списка шаблонов                 | `1c-platform-tools.support.createTemplateListFile`        |

## Зависимости и проект

| Задача                                 | Command ID                                                  |
|----------------------------------------|-------------------------------------------------------------|
| Инициализировать проект (packagedef)   | `1c-platform-tools.dependencies.initializePackagedef`       |
| Инициализировать структуру проекта     | `1c-platform-tools.dependencies.initializeProjectStructure` |
| Настроить Git                          | `1c-platform-tools.dependencies.setupGit`                   |
| Установить OneScript                   | `1c-platform-tools.dependencies.installOscript`             |
| Обновить пакетный менеджер opm | `1c-platform-tools.dependencies.updateOpm`                  |
| Установить зависимости                 | `1c-platform-tools.dependencies.install`                    |
| Удалить зависимости                    | `1c-platform-tools.dependencies.remove`                     |

### Порядок при настройке зависимостей

1. **Сначала проверь инструменты MCP** (сервер mcp-1c-platform-tools). В нём есть:
   - **deps_install** — установка зависимостей проекта (packagedef, vrunner и т.п.).
   - **deps_installOscript** — установка зависимостей OneScript (opm add, модули вроде vanessa-automation-single).
   Если MCP доступен — вызывай эти инструменты с нужным `projectPath`; **не переходи в терминал** с `opm install add` по привычке.

2. **Проверка OneScript**: если нужно подготовить окружение — проверь наличие **oscript** в системе. Если oscript **нет** — вызови установку (`1c-platform-tools.dependencies.installOscript` или MCP-аналог). Если oscript **уже есть** — выполняй только установку зависимостей (через MCP: `deps_install` и при необходимости `deps_installOscript`; или команды расширения `dependencies.install` / `dependencies.updateOpm`).

3. К терминалу (opm, vrunner вручную) прибегай только если MCP недоступен или инструменты не покрывают сценарий.

## Запуск

| Задача                 | Command ID                         |
|------------------------|------------------------------------|
| Запустить Предприятие  | `1c-platform-tools.run.enterprise` |
| Запустить Конфигуратор | `1c-platform-tools.run.designer`   |

## Тестирование

| Задача                  | Command ID                           |
|-------------------------|--------------------------------------|
| XUnit тесты             | `1c-platform-tools.test.xunit`       |
| Синтаксический контроль | `1c-platform-tools.syntaxCheck.run` |
| Vanessa тесты           | `1c-platform-tools.test.vanessa`     |
| Allure отчёт            | `1c-platform-tools.test.allure`      |

## Установить версию

| Задача                         | Command ID                                   |
|--------------------------------|----------------------------------------------|
| Установить версию конфигурации | `1c-platform-tools.cf.setVersion` |

## Конфигурации запуска

| Задача              | Command ID                                    |
|---------------------|-----------------------------------------------|
| Открыть env.json    | `1c-platform-tools.env.editSettingsFile`           |
| Открыть launch.json | `1c-platform-tools.launch.editConfigurations` |

## Метаданные и ER-диаграмма

| Задача                                 | Command ID                                               |
|----------------------------------------|----------------------------------------------------------|
| Получить дерево метаданных проекта     | `1c-platform-tools.metadata.getProjectTree`              |
| Открыть ER-диаграмму                   | `1c-platform-tools.metadata.er.openCanvas`               |
| Открыть ER-диаграмму объекта           | `1c-platform-tools.metadata.er.openForObject`            |

## MCP

Если у тебя есть инструменты MCP **mcp-1c-platform-tools**, используй их для тех же операций: загрузка конфигурации — `cf_load`, выгрузка — `cf_dump`, расширения — `cfe_load` / `cfe_dump`, сборка/разбор обработок и отчётов — `epf_compileProc`, `epf_compileReport`, `epf_decompileProc`, `epf_decompileReport` и т.д. **Для зависимостей** — в первую очередь вызывай **deps_install** и **deps_installOscript**; не переходи в терминал с `opm install add`, пока не убедился, что MCP недоступен. В каждый вызов передавай `projectPath` — корень проекта 1С (каталог с `packagedef`). Имена формируются из command ID: убирается префикс, точки → `_`, длинные слова сокращаются (`dependencies` → `deps`, `Processors` → `Procs`). Полный список возвращается сервером при подключении.

## Дополнительные навыки (Claude Code)

Навык 1c-platform-tools отвечает за **пакетные операции**: загрузка/выгрузка конфигурации и расширений, сборка/разбор EPF/ERF, запуск Конфигуратора/Предприятия — через команды расширения или MCP. Свойства и состав объектов метаданных правит панель свойств расширения: она пишет XML точечно и сверяет результат, поэтому руками эти файлы править не нужно. Для **остального редактирования XML-исходников и валидации форм/ролей/СКД** можно дополнительно использовать набор [cc-1c-skills](https://github.com/Nikolay-Shirokov/cc-1c-skills) (Claude Code): скопируй `.claude/skills/` из того репозитория в корень проекта — появятся слэш-команды (`/epf-build`, `/cf-edit` и др.). Итого: команды расширения и MCP — за «что запустить» (load/dump/build); cc-1c-skills — за «как править и генерировать» XML и объекты. Актуальность cc-1c-skills поддерживай обновлением копии из репозитория по желанию пользователя.

## Правило

Для любой операции (запуск Конфигуратора/Предприятия, загрузка конфигурации, сборка и т.д.) — **сразу выполни команду расширения** по таблице выше через свой инструмент выполнения команд (или MCP, если доступен). Не перекладывай на пользователя («нажмите Ctrl+Shift+P», «из чата вызвать нельзя»). Только если у тебя нет инструмента для выполнения команд — тогда подскажи палитру или панель «1С: Инструменты». Не запускай bat-файлы или 1cv8 вручную; настройки заданы в проекте (env.json).
