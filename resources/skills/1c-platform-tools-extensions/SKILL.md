---
name: 1c-platform-tools-extensions
description: Загрузка и выгрузка расширений конфигурации 1С. Используй, когда пользователь просит загрузить расширение из исходников, выгрузить в cfe, собрать или разобрать cfe, обновить расширения в базе, конвертировать исходники расширения.
---

# Расширения: команды и MCP

Выполняй операции из таблицы сам, кроме `cfe_borrowObject` и `cfe_loadByList`. Исходники расширение находит в проекте само. `projectPath` передавай, только если пользователь назвал проект.

Если пользователь назвал расширения, передай `extensions`: имя каталога, путь от корня проекта или имя из метаданных. Явный список окно не открывает и сохранённый выбор не меняет. Без параметра сначала берётся непустая настройка `1c-platform-tools.cfe.selected`, иначе сохранённый выбор проекта, а если он пуст или уже не подходит составу — все расширения. У тестовых расширений тот же порядок, настройка отбора — `1c-platform-tools.test.cfe.selected`.

| Задача | Command ID | MCP | wait: true |
|---|---|---|---|
| Загрузить из исходного кода | `1c-platform-tools.cfe.load` | `cfe_load` | результат |
| Загрузить из *.cfe | `1c-platform-tools.cfe.loadFile` | `cfe_loadFile` | результат |
| Загрузить из objlist.txt | `1c-platform-tools.cfe.loadByList` | `cfe_loadByList` | отказ |
| Выгрузить в исходный код | `1c-platform-tools.cfe.dump` | `cfe_dump` | результат |
| Выгрузить в *.cfe | `1c-platform-tools.cfe.unload` | `cfe_unload` | результат |
| Собрать *.cfe | `1c-platform-tools.cfe.compile` | `cfe_compile` | результат |
| Разобрать *.cfe | `1c-platform-tools.cfe.decompile` | `cfe_decompile` | результат |
| Конвертировать исходный код | `1c-platform-tools.cfe.convert` | `cfe_convert` | результат |
| Обновить расширения в базе | `1c-platform-tools.cfe.updateDb` | `cfe_updateDb` | результат |
| Добавить объект в расширение | `1c-platform-tools.cfe.borrowObject` | `cfe_borrowObject` | пустой |

`cfe_load` принимает `updateDb`. `cfe_compile` и `cfe_unload` принимают `outputDirectory` и `outputName`.

`cfe_loadByList` при `wait: true` сразу отвечает «Частичная загрузка расширений по objlist — несколько шагов; wait: true недоступен» и ничего не загружает. Агенту не вызывай.

`cfe_borrowObject` работает с выделенным узлом метаданных и окном выбора. Для агента его не вызывай: параметр `extensions` в схеме эту команду не заменяет.

Версию расширения человек ставит командой `1c-platform-tools.cfe.setVersion`. Инструмента MCP нет, агентный вызов отклоняется.

## Тестовые расширения

YAxUnit и расширение с тестами лежат под каталогом тестов (настройка `1c-platform-tools.test.directoryName`, по умолчанию `tests`), собранные `*.cfe` — в каталоге сборки. Команды таблицы выше их не трогают. Без параметра `extensions` порядок тот же: непустая настройка `1c-platform-tools.test.cfe.selected`, затем сохранённый выбор, иначе все. Параметр есть у четырёх команд с `Exts` в имени.

| Задача | Command ID | MCP | wait: true |
|---|---|---|---|
| Загрузить тестовые расширения | `1c-platform-tools.test.loadExtensions` | `test_loadExts` | результат |
| Выгрузить тестовые расширения | `1c-platform-tools.test.dumpExtensions` | `test_dumpExts` | результат |
| Собрать тестовые расширения | `1c-platform-tools.test.compileExtensions` | `test_compileExts` | результат |
| Разобрать тестовые расширения | `1c-platform-tools.test.decompileExtensions` | `test_decompileExts` | результат |
| Добавить YAxUnit | `1c-platform-tools.test.addYaxunit` | `test_addYaxunit` | результат |

## Примеры

- Загрузить одно расширение: `cfe_load` с `extensions: ["МоёРасширение"]`.
- Выгрузить в cfe: `cfe_unload`.
- Обновить уже установленные расширения: `cfe_updateDb`.
