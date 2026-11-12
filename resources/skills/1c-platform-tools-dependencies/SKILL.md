---
name: 1c-platform-tools-dependencies
description: Зависимости и структура проекта 1С и OneScript. Используй, когда пользователь просит установить зависимости, инициализировать packagedef, создать каталоги проекта, установить или выбрать версию OneScript, обновить opm, собрать или установить пакет OneScript, проверить версии зависимостей, диагностику пакетов или обновить версии в packagedef.
---

# Зависимости и проект: команды и MCP

Перед операциями и при ошибке про раннер или библиотеку вызови `deps_check`. «не установлен»: `deps_install`. Нет oscript: сначала `deps_installOscript`. Сначала инструменты MCP. К `opm install` в терминале переходи, когда сервера нет.

| Задача | Command ID | MCP | wait: true |
|---|---|---|---|
| Создать packagedef | `1c-platform-tools.dependencies.initializePackagedef` | `deps_initPackagedef` | результат |
| Создать packagedef (команда проекта) | `1c-platform-tools.project.initialize` | `project_init` | результат |
| Создать каталоги проекта | `1c-platform-tools.dependencies.initializeProjectStructure` | `deps_initProjStruct` | без исхода |
| Установить OneScript | `1c-platform-tools.dependencies.installOscript` | `deps_installOscript` | без исхода |
| Обновить пакетный менеджер | `1c-platform-tools.dependencies.updateOpm` | `deps_updateOpm` | без исхода |
| Установить зависимости | `1c-platform-tools.dependencies.install` | `deps_install` | без исхода |
| Проверить версии зависимостей | `1c-platform-tools.dependencies.check` | `deps_check` | результат |
| Диагностика зависимостей | `1c-platform-tools.dependencies.doctor` | `deps_doctor` | результат |
| Обновить версии | `1c-platform-tools.dependencies.upgrade` | `deps_upgrade` | результат |
| Удалить зависимости | `1c-platform-tools.dependencies.remove` | `deps_remove` | без исхода |
| Собрать пакет OneScript | `1c-platform-tools.package.build` | `package_build` | результат |
| Установить собранный пакет | `1c-platform-tools.package.install` | `package_install` | результат |
| Опубликовать пакет | `1c-platform-tools.package.push` | `package_push` | результат |
| Настроить Git | `1c-platform-tools.dependencies.setupGit` | нет | |

`deps_initPackagedef` и `project_init` делают одно и то же: `projectPath` обязателен, в этом каталоге создаётся `packagedef`, проект становится текущим. Пустой каталог получает описание проекта 1С, каталог с файлами `.os` или каталогами классов и модулей — описание пакета OneScript. Существующий файл не перезаписывается. Для Execute Command каталог можно передать и полем `root`.

`deps_initProjStruct` у проекта OneScript создаёт каталоги `src/Классы`, `src/Модули`, `tests` и `tests/oscript.cfg`. Программу он не создаёт: файл `src/main.os` и строка `.ИсполняемыйФайл` добавляются отдельно. У проекта 1С — каталоги шаблона и README. Существующие файлы не перезаписываются. Класс клади в `src/Классы`, модуль в `src/Модули`: объявление в `packagedef` дописывает инициализация каталогов. Исход в ответ не входит.

`deps_install` ставит зависимости по `packagedef`. `deps_installOscript` ставит OneScript. Если oscript уже есть, вызывай `deps_install`, а `deps_installOscript` — когда интерпретатора нет.

`deps_check`, `deps_doctor` и `deps_upgrade` вызывай с `wait: true`. `deps_doctor` ещё смотрит использование пакетов в коде `.os`. В `data.packages` версия из packagedef, установленная, доступная, от какого пакета пришёл (`via`) и проблемы. `deps_upgrade` записывает новые версии в packagedef и пакеты не ставит: передай `dependencyTarget` (`latest`, `minor` или `patch`), при необходимости `packageName`, затем `deps_install`. Нужен OneScript 2.2 или новее. depos берётся из oscript_modules проекта, иначе из установки OneScript. Если его нет ни там, ни там, допиши `.РазработкаЗависитОт("depos")` и вызови `deps_install`.

Движок OneScript у каждого проекта свой: `components.path.oscript`; установка OVM, выбранная для проекта; движок машины (текущая установка OVM, иначе `oscript` из PATH), если он не ниже `ВерсияСреды` в `packagedef`; иначе установка версии из `ВерсияСреды` (если такой нет, самая новая той же старшей версии, но не ниже). Если подходящей установки нет, остаётся движок машины, и opm откажется ставить пакет: скажи человеку, что нужна версия не ниже `ВерсияСреды`. Версию проекта выбирает человек в палитре; `deps_installOscript` ставит версию рядом с остальными, а машину переключает только первая установка, когда `current` OVM ещё нет. Движок по пути агент задаёт настройкой `components.path.oscript`.

`package_build` собирает `<Имя>-<Версия>.ospx` по `packagedef` в `build/out/ospx`, путь к пакету приходит в `artifact`. `package_install` ставит собранный пакет в движок проекта (`opm install -f`): пакет версии из `packagedef`, иначе самый новый. `package_push` публикует пакет (`opm push`): токен `GITHUB_OAUTH_TOKEN` и канал `OPM_HUB_CHANNEL` берутся из окружения запуска.

`1c-platform-tools.dependencies.setupGit` открывает мастер и агенту недоступен. Ответ: «Команда открывает окна VS Code и недоступна агенту. Мастер настройки git выполняется пользователем; для агента настройте git командами git config.» Настраивай git командами git.

## Примеры

- Зависимости текущего проекта: `deps_install`.
- Нет oscript: `deps_installOscript`, затем `deps_install`.
- Новый каталог сделать проектом: `project_init` с `projectPath`.
- Собрать и проверить пакет OneScript: `package_build`, затем `package_install`, оба с `wait: true`.
- Версии зависимостей: `deps_check` с `wait: true`. Поднять минимумы в `packagedef` до исправлений: `deps_upgrade` с `dependencyTarget` = `patch` и `wait: true`, затем `deps_install`. Проблемы зависимостей: `deps_doctor`.
