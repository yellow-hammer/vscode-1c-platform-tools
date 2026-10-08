---
name: 1c-platform-tools-infobase
description: Операции с информационными базами 1С. Используй, когда пользователь просит создать пустую ИБ, инициализировать конфигурацию из исходников, обновить базу, выполнить обработчики обновления, выгрузить или загрузить dt, запретить внешние ресурсы, инициализировать данные.
---

# Информационные базы: команды и MCP

Выполняй операции сам. Параметры подключения берутся из профиля проекта. `projectPath` передавай, только если пользователь назвал проект. `wait: true` возвращает результат у всех команд этой таблицы.

| Задача | Command ID | MCP |
|---|---|---|
| Создать пустую ИБ | `1c-platform-tools.infobase.create` | `infobase_create` |
| Инициализировать конфигурацию из исходного кода | `1c-platform-tools.infobase.initFromSrc` | `infobase_initFromSrc` |
| Обновить конфигурацию базы | `1c-platform-tools.infobase.updateDb` | `infobase_updateDb` |
| Выполнить обработчики обновления | `1c-platform-tools.infobase.runUpdateHandlers` | `infobase_runUpdateHandlers` |
| Инициализировать данные | `1c-platform-tools.infobase.initialize` | `infobase_init` |
| Выгрузить в dt | `1c-platform-tools.infobase.dumpDt` | `infobase_dumpDt` |
| Загрузить из dt | `1c-platform-tools.infobase.restoreDt` | `infobase_restoreDt` |
| Запретить внешние ресурсы | `1c-platform-tools.infobase.blockExternalResources` | `infobase_blockExtRes` |

`infobase_initFromSrc` загружает конфигурацию в пустую базу. `infobase_updateDb` обновляет конфигурацию базы из уже загруженной конфигурации. Обработчики обновления — отдельный запуск Предприятия, `infobase_runUpdateHandlers`.

Загрузка конфигурации из исходников в существующую базу — `cf_load`, не команда из этой таблицы.

## Примеры

- Пустая база: `infobase_create`.
- Обновить конфигурацию базы: `infobase_updateDb`.
- Снять dt и развернуть его: `infobase_dumpDt`, затем `infobase_restoreDt`.
