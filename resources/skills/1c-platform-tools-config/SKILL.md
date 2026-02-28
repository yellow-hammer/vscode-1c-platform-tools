---
name: 1c-platform-tools-config
description: Конфигурации запуска (env.json, launch.json). Используй, когда пользователь просит открыть env.json, launch.json, настройки запуска проекта, отредактировать конфигурацию запуска.
---

# Конфигурации запуска: команды расширения

Открывай env.json или launch.json через команды расширения. **Выполняй команду сам** (Execute Command), не проси пользователя искать файл вручную.

## Когда вызывать

| Запрос пользователя (примеры)              | Действие                          |
|--------------------------------------------|-----------------------------------|
| Открой env.json, настройки проекта         | `1c-platform-tools.config.env.edit` |
| Открой launch.json, конфигурации запуска   | `1c-platform-tools.launch.editConfigurations` |

## Команды расширения

| Задача              | Command ID                                    |
|---------------------|-----------------------------------------------|
| Открыть env.json    | `1c-platform-tools.config.env.edit`           |
| Открыть launch.json | `1c-platform-tools.launch.editConfigurations` |

## Примеры

- Выполни команду `1c-platform-tools.config.env.edit` — откроется env.json текущего проекта.
- Выполни `1c-platform-tools.launch.editConfigurations` — откроется launch.json или редактор конфигураций запуска.
