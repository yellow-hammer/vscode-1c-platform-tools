---
name: 1c-platform-tools-session
description: Сеансы серверной информационной базы 1С. Используй, когда пользователь просит запретить или разрешить вход, завершить сеансы, проверить что сеансов нет, показать сеансы, запретить или разрешить регламентные задания.
---

# Сеансы информационной базы

Подключение к кластеру берётся из профиля запуска. `projectPath` передавай, только если пользователь назвал проект. `wait: true` возвращает результат у всех команд таблицы.

У каждого инструмента есть `lockMessage`, `accessCode`, `lockStart`, `lockEnd`. Время блокировки действует на vanessa-runner 2.x.

| Задача | Command ID | MCP | Дополнительно |
|---|---|---|---|
| Запретить начало сеансов | `1c-platform-tools.session.lock` | `session_lock` | |
| Разрешить начало сеансов | `1c-platform-tools.session.unlock` | `session_unlock` | |
| Запретить регламентные задания | `1c-platform-tools.session.lockJobs` | `session_lockJobs` | |
| Разрешить регламентные задания | `1c-platform-tools.session.unlockJobs` | `session_unlockJobs` | |
| Завершить сеансы | `1c-platform-tools.session.kill` | `session_kill` | `sessionFilter`, `sessionFilterMode`, `keepSessionsUnlocked`, `sessionRetry`, `sessionTimeout` |
| Проверить, что сеансов нет | `1c-platform-tools.session.checkClosed` | `session_checkClosed` | `sessionFilter`, `sessionFilterMode`, `sessionTimeout` |
| Показать сеансы | `1c-platform-tools.session.list` | `session_list` | `sessionFilter`, `sessionFilterMode`, `sessionConnections` |

`session_list` доступен на vanessa-runner 3.x. `sessionFilter` — например `appid=Designer`. `sessionFilterMode`: `ONLY`, `OFF`, `EXCEPT`; `DEFAULT` и `ALL` — только vanessa-runner 2.x. `sessionRetry` и `sessionTimeout` у завершения — vanessa-runner 3.x. Запрет входа сам по себе регламентные задания не останавливает: для этого `session_lockJobs`.

## Примеры

- Закрыть сеансы конфигуратора: `session_kill` с `sessionFilter: "appid=Designer"`.
- Дождаться пустой базы: `session_checkClosed`.
- Показать сеансы и соединения: `session_list` с `sessionConnections: true`.
