---
name: 1c-platform-tools-server
description: Автономный сервер 1С (ibsrv). Используй, когда пользователь просит запустить, остановить или перезапустить автономный сервер, открыть публикацию, журнал, конфиг, отладку сервера или выбрать публикуемые сервисы.
---

# Автономный сервер

Команды управляют ibsrv текущей базы. Исход операции в ответ не входит: ответ подтверждает запуск. `projectPath` передавай, только если пользователь назвал проект.

| Задача | Command ID | MCP |
|---|---|---|
| Запустить | `1c-platform-tools.server.start` | `server_start` |
| Остановить | `1c-platform-tools.server.stop` | `server_stop` |
| Перезапустить | `1c-platform-tools.server.restart` | `server_restart` |
| Отладка | `1c-platform-tools.server.debug` | `server_debug` |
| Журнал | `1c-platform-tools.server.showLogs` | `server_showLogs` |
| Конфиг публикации | `1c-platform-tools.server.openConfig` | `server_openConfig` |
| Открыть публикацию в браузере | `1c-platform-tools.server.openInBrowser` | `server_openInBrowser` |
| Выбрать публикуемые сервисы | `1c-platform-tools.server.selectServices` | `server_selectServices` |

Для OData в составе публикации нужен отмеченный сервис OData. Отмечает его человек: `server_selectServices` открывает окно выбора и параметров не принимает, агенту его не вызывай. Адрес опубликованного OData виден в `env_status`, поле `odata`. Меню сервера в MCP нет.

## Примеры

- Поднять сервер: `server_start`.
- Остановить: `server_stop`.
