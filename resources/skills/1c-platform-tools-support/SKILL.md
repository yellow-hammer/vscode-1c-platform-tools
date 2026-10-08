---
name: 1c-platform-tools-support
description: Поддержка конфигурации и поставка. Используй, когда пользователь просит выгрузить конфигурацию поставки, обновить поддержку из cf или cfu, снять с поддержки, создать комплект поставки, файлы поставки или шаблон.
---

# Поддержка и поставка

В MCP из этого раздела опубликован один инструмент: `cf_makeDist` (`1c-platform-tools.cf.makeDist`). Он выгружает конфигурацию поставки и при `wait: true` возвращает результат. Параметры файла: `outputDirectory`, `outputName`.

Остальные команды открывают мастер. Агентный вызов отклоняется до окон: «Команда открывает окна VS Code и недоступна агенту. Мастер поддержки/поставки выполняется пользователем в VS Code.» Попроси человека выполнить команду в палитре.

| Задача | Command ID | MCP |
|---|---|---|
| Выгрузить в 1Cv8dist.cf | `1c-platform-tools.cf.makeDist` | `cf_makeDist` |
| Загрузить из cf/cfu | `1c-platform-tools.support.updateCfg` | нет |
| Снять с поддержки | `1c-platform-tools.support.disableCfgSupport` | нет |
| Файл описания шаблона поставки | `1c-platform-tools.support.createDeliveryDescriptionFile` | нет |
| Файлы поставки и обновления | `1c-platform-tools.support.createDistributionFiles` | нет |
| Комплект поставки | `1c-platform-tools.support.createDistributivePackage` | нет |
| Файл списка шаблонов | `1c-platform-tools.support.createTemplateListFile` | нет |

## Примеры

- Выгрузка поставки: `cf_makeDist`.
- Комплект поставки собирает человек командой `1c-platform-tools.support.createDistributivePackage`.
