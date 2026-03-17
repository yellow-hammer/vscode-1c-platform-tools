---
name: 1c-platform-tools-support
description: >
  Управление поддержкой конфигурации и создание комплектов поставки через
  команды расширения и MCP — выгрузка в dist, обновление из cf/cfu, генерация
  файлов поставки. Используй, когда пользователь просит выгрузить в dist,
  обновить поддержку из cf/cfu, создать комплект поставки, файлы cf/cfu,
  шаблон поставки, или удалить поддержку конфигурации.
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

## Примеры MCP-вызовов

Выгрузить конфигурацию в dist:
```json
{"tool": "configuration_dumpToDist", "arguments": {"projectPath": "/path/to/project"}}
```

Создать файлы поставки (cf/cfu):
```json
{"tool": "support_createDistributionFiles", "arguments": {"projectPath": "/path/to/project"}}
```

## Порядок создания полного комплекта поставки

1. `configuration_dumpToDist` — выгрузить конфигурацию
2. `support_createDeliveryDescriptionFile` — создать описание шаблона
3. `support_createDistributionFiles` — создать cf/cfu
4. `support_createDistributivePackage` — собрать комплект
5. Проверить: убедиться, что файлы cf/cfu созданы в каталоге dist
