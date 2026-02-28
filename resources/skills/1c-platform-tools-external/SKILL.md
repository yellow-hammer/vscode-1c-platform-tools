---
name: 1c-platform-tools-external
description: Сборка и разборка внешних обработок и отчётов (EPF/ERF). Используй, когда пользователь просит собрать EPF/ERF, разобрать обработку или отчёт в исходники, удалить кэш внешних файлов.
---

# Внешние обработки и отчёты: команды и MCP

Выполняй сборку и разборку EPF и ERF через команды расширения или инструменты MCP. **Выполняй команду сам** (Execute Command или MCP), не проси пользователя нажимать палитру.

## Команды расширения

| Задача                      | Command ID                                       |
|-----------------------------|--------------------------------------------------|
| Собрать внешнюю обработку   | `1c-platform-tools.externalProcessors.build`     |
| Разобрать внешнюю обработку | `1c-platform-tools.externalProcessors.decompile` |
| Собрать внешний отчёт       | `1c-platform-tools.externalReports.build`        |
| Разобрать внешний отчёт     | `1c-platform-tools.externalReports.decompile`    |
| Удалить кэш                 | `1c-platform-tools.externalFiles.clearCache`     |

## MCP (mcp-1c-platform-tools)

Если доступны инструменты MCP, используй их: `externalProcs_build`, `externalProcs_decompile`, `externalReports_build`, `externalReports_decompile`, `externalFiles_clearCache` и т.д.

### Параметр projectPath

Обязательный. Корень проекта 1С (каталог с `packagedef`). Если пользователь указал путь — используй его; иначе корень workspace.

## Примеры

- Собрать обработку: MCP `externalProcs_build` или команда `1c-platform-tools.externalProcessors.build` с projectPath корня проекта.
- Разобрать отчёт в исходники: `externalReports_decompile` (MCP) или `1c-platform-tools.externalReports.decompile` (команда).
