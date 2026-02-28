---
name: 1c-platform-tools-dependencies
description: Зависимости и структура проекта 1С. Используй, когда пользователь просит установить зависимости, инициализировать проект, установить OneScript или opm, настроить packagedef или структуру проекта.
---

# Зависимости и проект: команды и MCP

Выполняй инициализацию проекта, установку OneScript и зависимостей через команды расширения или инструменты MCP. **Выполняй команду сам** (Execute Command или MCP), не проси пользователя нажимать палитру.

## Команды расширения

| Задача                                 | Command ID                                                  |
|----------------------------------------|-------------------------------------------------------------|
| Инициализировать проект (packagedef)   | `1c-platform-tools.dependencies.initializePackagedef`       |
| Инициализировать структуру проекта     | `1c-platform-tools.dependencies.initializeProjectStructure` |
| Настроить Git                          | `1c-platform-tools.dependencies.setupGit`                   |
| Установить OneScript                   | `1c-platform-tools.dependencies.installOscript`             |
| Установить пакетный менеджер OneScript | `1c-platform-tools.dependencies.updateOpm`                  |
| Установить зависимости                 | `1c-platform-tools.dependencies.install`                    |
| Удалить зависимости                    | `1c-platform-tools.dependencies.remove`                     |

## MCP (mcp-1c-platform-tools)

Для зависимостей в первую очередь вызывай **deps_install** (packagedef, vrunner) и **deps_installOscript** (opm, vanessa и др.). Есть также инструменты для initializePackagedef, initializeProjectStructure и т.д. **Всегда передавай параметр `projectPath`**. К терминалу с `opm install add` прибегай только если MCP недоступен.

## Правило

При настройке окружения или установке зависимостей вызывай команду расширения или MCP (deps_install, deps_installOscript). Не переходи в терминал по привычке, пока не убедился, что MCP недоступен.
