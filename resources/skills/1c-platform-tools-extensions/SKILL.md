---
name: 1c-platform-tools-extensions
description: Загрузка и выгрузка расширений конфигурации 1С. Используй, когда пользователь просит загрузить расширение из исходников, выгрузить в cfe, собрать или разобрать cfe, загрузить из objlist.
---

# Расширения: команды и MCP

Выполняй операции с расширениями через команды расширения или инструменты MCP. **Выполняй команду сам** (Execute Command или MCP), не проси пользователя нажимать палитру.

## Команды расширения

| Задача                          | Command ID                                         |
|---------------------------------|----------------------------------------------------|
| Загрузить расширение из src/cfe | `1c-platform-tools.extensions.loadFromSrc`         |
| Загрузить из objlist.txt        | `1c-platform-tools.extensions.loadFromFilesByList` |
| Загрузить из *.cfe              | `1c-platform-tools.extensions.loadFromCfe`         |
| Выгрузить расширение в src/cfe  | `1c-platform-tools.extensions.dumpToSrc`           |
| Выгрузить в *.cfe               | `1c-platform-tools.extensions.dumpToCfe`           |
| Собрать *.cfe из src/cfe        | `1c-platform-tools.extensions.build`               |
| Разобрать *.cfe в src/cfe       | `1c-platform-tools.extensions.decompile`           |

## MCP (mcp-1c-platform-tools)

Если доступны инструменты MCP, используй их: `extensions_loadFromSrc`, `extensions_dumpToSrc`, `extensions_loadFromFiles`, `extensions_loadFromCfe`, `extensions_dumpToCfe`, `extensions_build`, `extensions_decompileExt` и т.д.

### Параметр projectPath

Обязательный. Корень проекта 1С (каталог с `packagedef`). Если пользователь указал путь — используй его; иначе корень workspace.

## Примеры

- Загрузить расширение из исходников: MCP `extensions_loadFromSrc` или команда `1c-platform-tools.extensions.loadFromSrc` с projectPath.
- Выгрузить в cfe: `extensions_dumpToCfe` (MCP) или `1c-platform-tools.extensions.dumpToCfe` (команда).
