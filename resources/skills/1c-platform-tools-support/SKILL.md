---
name: 1c-platform-tools-support
description: Поддержка конфигурации и поставка. Используй, когда пользователь просит выгрузить в dist, обновить поддержку из cf/cfu, создать комплект поставки, файлы cf/cfu, шаблон поставки.
---

# Поддержка и поставка: команды и MCP

Выполняй операции с поддержкой и поставкой через команды расширения или инструменты MCP. **Выполняй команду сам** (Execute Command или MCP), не проси пользователя нажимать палитру.

## Команды расширения

### Поддержка

| Задача                  | Command ID                                    |
|-------------------------|-----------------------------------------------|
| Выгрузить в 1Cv8dist.cf | `1c-platform-tools.configuration.dumpToDist`  |
| Загрузить из cf/cfu     | `1c-platform-tools.support.updateCfg`         |
| Удалить поддержку       | `1c-platform-tools.support.disableCfgSupport` |

### Поставка

| Задача                                       | Command ID                                                |
|----------------------------------------------|-----------------------------------------------------------|
| Создать файл описания шаблона поставки       | `1c-platform-tools.support.createDeliveryDescriptionFile` |
| Создать файлы поставки и обновления (cf/cfu) | `1c-platform-tools.support.createDistributionFiles`       |
| Создать комплект поставки                    | `1c-platform-tools.support.createDistributivePackage`     |
| Создать файл списка шаблонов                 | `1c-platform-tools.support.createTemplateListFile`        |

## MCP (mcp-1c-platform-tools)

Если доступны инструменты MCP, используй их для тех же операций (имена формируются из command ID: configuration_dumpToDist, support_updateCfg и т.д.).

### Параметр projectPath

Обязательный. Корень проекта 1С (каталог с `packagedef`). Если пользователь указал путь — используй его; иначе корень workspace.

## Примеры

- Вызови `configuration_dumpToDist` или команду `1c-platform-tools.configuration.dumpToDist` с projectPath корня проекта.
- Для создания комплекта поставки — `support_createDistributivePackage` (MCP) или `1c-platform-tools.support.createDistributivePackage` (команда).
