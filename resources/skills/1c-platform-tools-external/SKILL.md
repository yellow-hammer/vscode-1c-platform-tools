---
name: 1c-platform-tools-external
description: Сборка и разборка внешних обработок и отчётов (EPF/ERF). Используй, когда пользователь просит собрать EPF/ERF, разобрать обработку или отчёт в исходники, удалить кэш внешних файлов.
---

# Внешние обработки и отчёты: команды и MCP

Выполняй сборку и разборку EPF и ERF через команды расширения или инструменты MCP. **Выполняй команду сам** (Execute Command или MCP), не проси пользователя нажимать палитру.

## Команды расширения

| Задача                      | Command ID                                       |
|-----------------------------|--------------------------------------------------|
| Собрать обработки   | `1c-platform-tools.epf.compileProcessor`     |
| Разобрать обработки | `1c-platform-tools.epf.decompileProcessor` |
| Собрать отчёты      | `1c-platform-tools.epf.compileReport`        |
| Разобрать отчёты    | `1c-platform-tools.epf.decompileReport`    |
| Удалить кэш                 | `1c-platform-tools.epf.clearCache`     |

## MCP (mcp-1c-platform-tools)

Если доступны инструменты MCP, используй их: `epf_compileProc`, `epf_decompileProc`, `epf_compileReport`, `epf_decompileReport`, `epf_clearCache` и т.д.

### Параметр projectPath

Обязательный. Корень проекта 1С (каталог с `packagedef`). Если пользователь указал путь — используй его; иначе корень workspace.

## Примеры

- Собрать обработки: MCP `epf_compileProc` или команда `1c-platform-tools.epf.compileProcessor` с projectPath корня проекта.
- Разобрать отчёты в исходники: `epf_decompileReport` (MCP) или `1c-platform-tools.epf.decompileReport` (команда).
