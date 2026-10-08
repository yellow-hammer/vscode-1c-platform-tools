---
name: 1c-platform-tools-run
description: Запуск Конфигуратора, Предприятия и EDT. Используй, когда пользователь просит запустить Конфигуратор, Предприятие, открыть 1С или запустить EDT.
---

# Запуск 1С

Выполняй запуск сам. Подключение и платформа берутся из активного профиля проекта. `projectPath` передавай, только если пользователь назвал проект.

| Запрос | Command ID | MCP | wait: true |
|---|---|---|---|
| Конфигуратор | `1c-platform-tools.run.designer` | `run_designer` | результат |
| Предприятие | `1c-platform-tools.run.enterprise` | `run_enterprise` | результат |
| EDT | `1c-platform-tools.run.edt` | `run_edt` | пустой |

`run_designer` и `run_enterprise` возвращают, удалось ли стартовать. Окно платформы остаётся у пользователя.

`run_enterprise` принимает `execute` (путь к `.epf` или `.erf`) и `command` (строка `/C`). Запуск обработки как отдельная команда — `epf_run`.

`run_edt` открывает проект в EDT и исход в ответ не кладёт. Вызывай с `wait: false`: при `wait: true` канал сообщит, что wait не поддерживается, хотя запуск уже мог пройти. Повтор из-за этой фразы не делай.

Подключение берётся из активного профиля. `1cv8` вручную не запускай.

`launch.json` открывает человек командой `1c-platform-tools.launch.editConfigurations`. Редактор задач — `tasks_edit`.

## Примеры

- Конфигуратор текущего проекта: `run_designer`.
- Предприятие другого проекта: `run_enterprise` с `projectPath`.
- EDT: `run_edt` с `wait: false`.
