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

`tasks_edit` открывает `tasks.json`. `tasks_view` обновляет дерево.

`1c-platform-tools.tasks.run` и `1c-platform-tools.tasks.runOscript` в MCP нет. Человек запускает их из палитры. Файл задачи OneScript лежит в каталоге из `path.onescriptTasks`, по умолчанию `tasks/<имя>.os`.

Команда `1c-platform-tools.tasks.addOscript` спрашивает имя файла в окне и в MCP не публикуется. Новый файл создавай в этом каталоге сам.

## Примеры

- Открыть список задач: `tasks_edit`.
