---
name: 1c-platform-tools-tasks
description: Задачи VS Code и задачи OneScript. Используй, когда пользователь просит открыть tasks.json, обновить список задач или добавить файл задачи OneScript. Запуск задачи по имени этими инструментами агенту недоступен.
---

# Задачи проекта

| Задача | Command ID | MCP | wait: true |
|---|---|---|---|
| Открыть tasks.json | `1c-platform-tools.tasks.edit` | `tasks_edit` | без исхода |
| Обновить дерево задач | `1c-platform-tools.tasks.view` | `tasks_view` | без исхода |
| Запустить задачу VS Code | `1c-platform-tools.tasks.run` | нет | |
| Запустить задачу OneScript | `1c-platform-tools.tasks.runOscript` | нет | |

`tasks_edit` открывает `tasks.json`. `tasks_view` обновляет дерево и список имён задач не возвращает.

Задачи OneScript и задачи VS Code это разные списки. Задача OneScript это файл `*.os` в каталоге из `path.onescriptTasks`, по умолчанию tasks, без вложенных папок. Имя задачи это имя файла без расширения. `1c-platform-tools.tasks.run` и `1c-platform-tools.tasks.runOscript` в MCP нет. Человек запускает задачу OneScript из палитры: это `opm run` с именем файла. Агент файл читает сам. Команда `1c-platform-tools.tasks.addOscript` спрашивает имя в окне и в MCP не публикуется. Новый файл создавай в этом каталоге сам.

Если файлов `*.os` в каталоге задач нет, пакет собирают `package_build`, ставят `package_install`, публикуют `package_push`, тесты каталога tests гоняет `test_onescript`, зависимости ставит `deps_install`. Это не замена отсутствующей задачи, которую человек просил запустить по имени.

## Примеры

- Открыть список задач: `tasks_edit`.
