---
name: 1c-platform-tools-dependencies
description: Зависимости и структура проекта 1С. Используй, когда пользователь просит установить зависимости, инициализировать packagedef, создать каталоги проекта, установить OneScript или обновить opm.
---

# Зависимости и проект: команды и MCP

Сначала инструменты MCP. К `opm install` в терминале переходи, когда сервера нет.

| Задача | Command ID | MCP | wait: true |
|---|---|---|---|
| Создать packagedef | `1c-platform-tools.dependencies.initializePackagedef` | `deps_initPackagedef` | результат |
| Создать packagedef (команда проекта) | `1c-platform-tools.project.initialize` | `project_init` | результат |
| Создать каталоги проекта | `1c-platform-tools.dependencies.initializeProjectStructure` | `deps_initProjStruct` | без исхода |
| Установить зависимости | `1c-platform-tools.dependencies.install` | `deps_install` | без исхода |
| Установить OneScript | `1c-platform-tools.dependencies.installOscript` | `deps_installOscript` | без исхода |
| Обновить opm | `1c-platform-tools.dependencies.updateOpm` | `deps_updateOpm` | без исхода |
| Удалить зависимости | `1c-platform-tools.dependencies.remove` | `deps_remove` | без исхода |
| Настроить Git | `1c-platform-tools.dependencies.setupGit` | нет | |

`deps_initPackagedef` и `project_init` делают одно и то же: `projectPath` обязателен, в этом каталоге создаётся `packagedef`, проект становится текущим. Существующий файл не перезаписывается. Для Execute Command каталог можно передать и полем `root`.

`deps_initProjStruct` создаёт каталоги шаблона и README в пустых каталогах. Уже лежащие README не перезаписываются. Исход в ответ не входит.

`deps_install` ставит зависимости по `packagedef`. `deps_installOscript` ставит OneScript. Если oscript уже есть, вызывай `deps_install`, а `deps_installOscript` — когда интерпретатора нет.

`1c-platform-tools.dependencies.setupGit` открывает мастер и агенту недоступен. Ответ: «Команда открывает окна VS Code и недоступна агенту. Мастер настройки git выполняется пользователем; для агента настройте git командами git config.» Настраивай git командами git.

## Примеры

- Зависимости текущего проекта: `deps_install`.
- Нет oscript: `deps_installOscript`, затем `deps_install`.
- Новый каталог сделать проектом: `project_init` с `projectPath`.
