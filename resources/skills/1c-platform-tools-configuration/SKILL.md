---
name: 1c-platform-tools-configuration
description: Загрузка и выгрузка конфигурации 1С. Используй, когда пользователь просит загрузить конфигурацию из исходников, выгрузить в cf, загрузить инкремент, выгрузить изменения, собрать или разобрать 1Cv8.cf.
---

# Конфигурация: команды и MCP

Выполняй операции с конфигурацией через команды расширения или инструменты MCP. **Выполняй команду сам** (Execute Command или MCP), не проси пользователя нажимать палитру.

## Команды расширения

| Задача                                | Command ID                                             |
|---------------------------------------|--------------------------------------------------------|
| Загрузить конфигурацию из src/cf      | `1c-platform-tools.configuration.loadFromSrc`          |
| Загрузить только изменения (git diff) | `1c-platform-tools.configuration.loadIncrementFromSrc` |
| Загрузить из objlist.txt              | `1c-platform-tools.configuration.loadFromFilesByList`  |
| Загрузить из 1Cv8.cf                  | `1c-platform-tools.configuration.loadFromCf`           |
| Выгрузить конфигурацию в src/cf       | `1c-platform-tools.configuration.dumpToSrc`            |
| Выгрузить изменения в src/cf          | `1c-platform-tools.configuration.dumpIncrementToSrc`   |
| Выгрузить в 1Cv8.cf                   | `1c-platform-tools.configuration.dumpToCf`             |
| Собрать 1Cv8.cf из src/cf             | `1c-platform-tools.configuration.build`                |
| Разобрать 1Cv8.cf в src/cf            | `1c-platform-tools.configuration.decompile`            |

## MCP (mcp-1c-platform-tools)

Если доступны инструменты MCP, используй их для тех же операций: `configuration_loadFromSrc`, `configuration_dumpToSrc`, `configuration_loadIncFromSrc`, `configuration_dumpIncToSrc`, `configuration_loadFromFiles`, `configuration_loadFromCf`, `configuration_dumpToCf`, `configuration_build`, `configuration_decompileCfg` и т.д. **Всегда передавай параметр `projectPath`** — корень проекта 1С (каталог с `packagedef`).

## Правило

Для загрузки/выгрузки/сборки конфигурации сразу вызывай команду расширения или MCP-инструмент. Не запускай 1cv8 или скрипты вручную; настройки в env.json.
