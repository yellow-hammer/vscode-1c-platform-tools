---
name: 1c-platform-tools-extensions
description: Загрузка и выгрузка расширений конфигурации 1С. Используй, когда пользователь просит загрузить расширение из исходников, выгрузить в cfe, собрать или разобрать cfe, загрузить из objlist.
---

# Расширения: команды и MCP

Выполняй операции с расширениями через команды расширения или инструменты MCP. **Выполняй команду сам** (Execute Command или MCP), не проси пользователя нажимать палитру.

## Команды расширения

| Задача                          | Command ID                                         |
|---------------------------------|----------------------------------------------------|
| Загрузить расширение из src/cfe | `1c-platform-tools.cfe.load`         |
| Загрузить из objlist.txt        | `1c-platform-tools.cfe.loadByList` |
| Загрузить из *.cfe              | `1c-platform-tools.cfe.loadFile`         |
| Выгрузить расширение в src/cfe  | `1c-platform-tools.cfe.dump`           |
| Выгрузить в *.cfe               | `1c-platform-tools.cfe.unload`           |
| Собрать *.cfe из src/cfe        | `1c-platform-tools.cfe.compile`               |
| Разобрать *.cfe в src/cfe       | `1c-platform-tools.cfe.decompile`           |

## Тестовые расширения

Расширения, нужные только для прогона тестов (YAxUnit и расширение с тестами), лежат отдельно:
`tests/cfe` (подкаталог корня тестов `path.tests`), собранные `*.cfe` — в `build/out/tests/cfe`. Команды выше
их не трогают, для них своя четвёрка (в дереве - группа «Тестовое окружение»):

| Задача                              | Command ID                                     |
|-------------------------------------|------------------------------------------------|
| Загрузить тестовые из tests/cfe     | `1c-platform-tools.test.loadExtensions`        |
| Выгрузить тестовые в tests/cfe      | `1c-platform-tools.test.dumpExtensions`        |
| Собрать тестовые *.cfe              | `1c-platform-tools.test.compileExtensions`       |
| Разобрать тестовые *.cfe            | `1c-platform-tools.test.decompileExtensions`   |

Параметр `extensions` работает так же и отбирает каталоги в `tests/cfe`. Инструменты MCP:
`test_loadExts`, `test_dumpExts`, `test_buildExts`, `test_decompileExts`.

## MCP (mcp-1c-platform-tools)

Если доступны инструменты MCP, используй их: `cfe_load`, `cfe_dump`, `cfe_loadByList`, `cfe_loadFile`, `cfe_unload`, `cfe_compile`, `cfe_decompile` и т.д.

### Параметр projectPath

Обязательный. Корень проекта 1С (каталог с `packagedef`). Если пользователь указал путь — используй его; иначе корень workspace.

### Выбор расширений

В проекте может быть несколько расширений (каталоги в `src/cfe`). Если пользователь назвал конкретные — передай их параметром `extensions`: команда выполнится только для них и без окна выбора. Без параметра используется сохранённый выбор проекта (или все расширения); явный список сохранённый выбор не меняет. Постоянный отбор без окна выбора задаётся в settings.json: `1c-platform-tools.cfe.selected` для расширений решения, `1c-platform-tools.test.cfe.selected` для тестовых.

## Примеры

- Загрузить расширение из исходников: MCP `cfe_load` или команда `1c-platform-tools.cfe.load` с projectPath.
- Выгрузить в cfe: `cfe_unload` (MCP) или `1c-platform-tools.cfe.unload` (команда).
- Загрузить только одно расширение: `cfe_load` с `extensions: ["МоёРасширение"]`.
