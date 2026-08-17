---
name: 1c-platform-tools-configuration
description: Загрузка и выгрузка конфигурации 1С. Используй, когда пользователь просит загрузить конфигурацию из исходников, выгрузить в cf, загрузить инкремент, выгрузить изменения, собрать или разобрать 1Cv8.cf.
---

# Конфигурация: команды и MCP

Выполняй операции с конфигурацией через команды расширения или инструменты MCP. **Выполняй команду сам** (Execute Command или MCP), не проси пользователя нажимать палитру.

## Команды расширения

| Задача                                | Command ID                                             |
|---------------------------------------|--------------------------------------------------------|
| Загрузить конфигурацию из src/cf      | `1c-platform-tools.cf.load`          |
| Обновить конфигурацию в ИБ            | `1c-platform-tools.infobase.updateDb`            |
| Загрузить только изменения (git diff) | `1c-platform-tools.cf.loadIncrement` |
| Загрузить из objlist.txt              | `1c-platform-tools.cf.loadByList`  |
| Загрузить из 1Cv8.cf                  | `1c-platform-tools.cf.loadFile`           |
| Выгрузить конфигурацию в src/cf       | `1c-platform-tools.cf.dump`            |
| Выгрузить изменения в src/cf          | `1c-platform-tools.cf.dumpIncrement`   |
| Выгрузить в 1Cv8.cf                   | `1c-platform-tools.cf.unload`             |
| Собрать 1Cv8.cf из src/cf             | `1c-platform-tools.cf.compile`                |
| Разобрать 1Cv8.cf в src/cf            | `1c-platform-tools.cf.decompile`            |

## Загрузка изменений (git diff) без интерактива

`loadIncrementFromSrc` без аргументов запрашивает SHA коммита в UI. Чтобы выполнить без запроса, передай аргументом объект с `sha`:

- MCP: `cf_loadInc` с параметром `sha` (пустая строка — полная загрузка), либо Execute Command `1c-platform-tools.cf.loadIncrement` с тем же аргументом.

SHA — коммит последней загрузки: изменения возьмутся от него до текущего состояния. Текущее значение хранится в `src/cf/lastUploadedCommit.txt`. Обычно нужен SHA HEAD на момент прошлой загрузки; получить текущий — `git rev-parse HEAD`.

## MCP (mcp-1c-platform-tools)

Если доступны инструменты MCP, используй их для тех же операций: `cf_load`, `infobase_updateDb` (только обновление БД), `cf_dump`, `cf_loadInc`, `cf_dumpInc`, `cf_loadByList`, `cf_loadFile`, `cf_unload`, `cf_compile`, `cf_decompile` и т.д. **Всегда передавай параметр `projectPath`** — корень проекта 1С (каталог с `packagedef`).

## Правило

Для загрузки/выгрузки/сборки конфигурации сразу вызывай команду расширения или MCP-инструмент. Не запускай 1cv8 или скрипты вручную; настройки в env.json.
