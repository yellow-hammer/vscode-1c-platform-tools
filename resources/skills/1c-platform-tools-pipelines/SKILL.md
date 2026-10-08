---
name: 1c-platform-tools-pipelines
description: Пайплайны проекта 1С из .1cpt/pipelines.json. Используй, когда пользователь просит запустить пайплайн или цепочку шагов.
---

# Пайплайны

| Задача | Command ID | MCP | wait: true |
|---|---|---|---|
| Запустить цепочку | `1c-platform-tools.pipelines.run` | `pipelines_run` | результат |

Параметр `pipeline` обязателен: id или название из `.1cpt/pipelines.json`. Без него команда цепочку за пользователя не выбирает и возвращает ошибку со списком доступных.

Шаги идут по связям. Упавший шаг без ветки error останавливает свою ветку. Шаг с подтверждением в агентном запуске завершается ошибкой. В ответе пошаговый отчёт.

Редактор цепочек и добавление шаблонов в MCP не публикуются: `1c-platform-tools.pipelines.openEditor`, `1c-platform-tools.pipelines.addTemplates`. Файл `.1cpt/pipelines.json` правь сам. То же для хуков: `1c-platform-tools.hooks.openEditor`, файл `.1cpt/hooks.json`.

## Примеры

- Запустить цепочку `load`: `pipelines_run` с `pipeline: "load"`.
