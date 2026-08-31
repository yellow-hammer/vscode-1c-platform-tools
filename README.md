<img src="resources/brand/cat.png" alt="" width="88" align="right">

# 1C: Platform Tools

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/yellow-hammer.1c-platform-tools?label=VS%20Marketplace&logo=visualstudiocode&color=0098FF)](https://marketplace.visualstudio.com/items?itemName=yellow-hammer.1c-platform-tools)
[![Open VSX](https://img.shields.io/open-vsx/v/yellow-hammer/1c-platform-tools?label=Open%20VSX&logo=eclipseide&color=C160EF)](https://open-vsx.org/extension/yellow-hammer/1c-platform-tools)
[![OpenYellow](https://openyellow.openintegrations.dev/data/badges/1113279075.png)](https://openyellow.org/grid?filter=top&repo=1113279075)
[![telegram chat](resources/badges/telegram-chat.png)](https://t.me/wonder_yellow)
[![Ask Devin](resources/badges/deepwiki-badge.png)](https://deepwiki.com/yellow-hammer/vscode-1c-platform-tools)

Расширение для Visual Studio Code (а также Cursor, Windsurf и VSCodium), которое собирает повседневные инструменты разработки 1С в одном интерфейсе: команды vanessa-runner, навигацию по проектам и артефактам, дерево метаданных, TODO-панель, отладку и интеграцию с AI-агентами.

![Панель команд 1C: Platform Tools](resources/treeview-screenshot.png)

## Документация

- Руководства по функциям — на сайте [yellow-hammer.github.io/vscode-1c-platform-tools](https://yellow-hammer.github.io/vscode-1c-platform-tools/).
- Знакомство с панелями по шагам — прямо в редакторе: **Help → Welcome → Начало работы с 1C: Platform Tools**.

## Возможности

- **[1С: Инструменты](docs/tools.md)** — дерево команд: информационная база, конфигурация, расширения, внешние файлы, поставка, запуск, тестовое окружение, зависимости, выбор установки OneScript.
- **[1С: Проекты](docs/projects.md)** — поиск проектов, избранное, теги, переключение через статус-бар и палитру команд.
- **[1С: Администрирование](docs/admin.md)** — список информационных баз платформы и запуск Предприятия или Конфигуратора; консоль кластера через `rac`: подключения к `ras`, сеансы, соединения, блокировки.
- **[1С: Артефакты](docs/artifacts.md)** — дерево `*.cf`/`*.cfe`/`*.epf`/`*.erf` с действиями сборки и разбора.
- **[1С: Метаданные](docs/metadata.md)** — дерево метаданных, свойства и состав объектов, формы, макеты и схемы компоновки, поддержка поставщика, поиск по имени и фильтр по подсистемам.
- **[1С: Свойства](docs/metadata.md#палитра-свойств)** — палитра свойств выделенного узла, как в конфигураторе.
- **[1С: Список дел](docs/todo.md)** — панель меток TODO/FIXME/XXX/HACK/BUG в коде проекта.
- **[Служебные файлы](docs/service-files.md)** — создание из шаблонов: `.gitignore`, `.gitattributes`, профиль запуска, файлы `tools/*`.
- **[Профили запуска](docs/launch-profiles.md)** — параметры подключения к ИБ, активный профиль в статус-баре, своя база на каждую ветку.
- **[Автоматизация](docs/automation.md)** — пайплайны: визуальный редактор цепочек с ветками на успех и ошибку; хуки команд до, после и при ошибке.
- **[Автономный сервер](docs/autonomous-server.md)** — публикация файловой ИБ через `ibsrv`: локальная разработка и отладка HTTP/Web/OData-сервисов, открытие в браузере.
- **[ER-диаграммы](docs/er-diagrams.md)** — интерактивные схемы связей метаданных, экспорт в Mermaid, Draw.io, SVG, PNG.
- **[Тестирование](docs/testing.md)** — панель тестирования VS Code: Vanessa, xUnit, YAxUnit, OneScript и 1bdd, запуск из редактора, статусы и переход к падению.
- **[Отладка 1С](docs/debug.md)** — точки останова с условиями, изменение значений переменных, отладка расширений и внешних обработок, замер производительности.
- **[AI и MCP](docs/ai-mcp.md)** — навыки для агентов, запуск команд через файл-триггер и MCP-сервер [mcp-1c-platform-tools](https://github.com/yellow-hammer/mcp-1c-platform-tools).
- **[Docker и ibcmd](docs/docker.md)** — выполнение команд в контейнере без локальной платформы 1С, включая GitHub Codespaces.
- **[Внешние компоненты](docs/components.md)** — отладчик, дерево метаданных, JRE, OVM и Allure: загрузка, свои сборки и работа без доступа к GitHub.
- **[Сочетания клавиш](docs/keyboard.md)** — панели по номеру, синтаксический контроль как в конфигураторе.

## Установка

Поиск по `1C: Platform Tools` в панели расширений (`Ctrl+Shift+X`) или ссылкой:

| Редактор | Откуда ставить |
|----------|----------------|
| Visual Studio Code | [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=yellow-hammer.1c-platform-tools) |
| Cursor, Windsurf, VSCodium | [Open VSX](https://open-vsx.org/extension/yellow-hammer/1c-platform-tools) |
| Без доступа к маркетплейсу | файл `.vsix` из [релизов](https://github.com/yellow-hammer/vscode-1c-platform-tools/releases), `Extensions: Install from VSIX…` |

В Cursor работают те же панели и команды; MCP там подключается своим файлом `.cursor/mcp.json` - его пишет команда расширения, см. [AI и MCP](docs/ai-mcp.md).

Расширение активируется для проекта 1С при наличии файла `packagedef` в корне рабочей папки. Панели **1С: Проекты** и **1С: Администрирование** работают и без открытого проекта: первая поможет найти и открыть нужный, вторая не привязана к рабочей области вовсе.

## Что нужно для работы

- **Платформа 1С:Предприятие 8** — клиент, конфигуратор, `1cestart`, `rac`/`ras`, `ibsrv`, `ibcmd`.
- **OneScript, OPM и vanessa-runner** — из раздела **Зависимости** в дереве **1С: Инструменты**.
- **MCP** — расширение [mcp-1c-platform-tools](https://github.com/yellow-hammer/mcp-1c-platform-tools), если команды вызывает агент.

<img src="resources/brand/bird.png" alt="" width="28" align="left"> Без локальной 1С команды можно выполнять в Docker — см. [Docker и ibcmd](docs/docker.md).

## Быстрый старт

1. Откройте существующий проект 1С с файлом `packagedef` или выполните команду **1С: Зависимости: Инициализировать проект**.
2. При необходимости выполните **1С: Зависимости: Инициализировать структуру проекта**. Будут созданы каталоги по шаблону [vanessa-bootstrap](https://github.com/yellow-hammer/vanessa-bootstrap).
3. Настройте подключение к ИБ в основном [профиле запуска](docs/launch-profiles.md). Формат файла зависит от установленного vanessa-runner (расширение определяет версию автоматически):

   ```jsonc
   // env.json — vanessa-runner 2
   { "default": { "--ibconnection": "/F./build/ib" } }

   // autumn-properties.json — vanessa-runner 3
   { "vrunner": { "ibconnection": "/F./build/ib" } }
   ```

   Профиль можно создать из дерева **Служебные файлы** (пункт «Осн. профиль запуска») или из статус-бара.

4. Установите зависимости через раздел **Зависимости** или команду **1С: Зависимости: Установить зависимости**.
5. Откройте панель **1С: Инструменты** и запускайте нужные команды из дерева.

Рекомендуемая структура проекта:

```txt
project/
├── .1cpt/                  # Пайплайны и хуки команд
├── build/
│   ├── ib/                 # Информационная база
│   └── out/                # Результаты сборки
├── features/               # Сценарии Gherkin (Vanessa Automation)
├── src/
│   ├── cf/                 # Исходники конфигурации
│   ├── cfe/                # Исходники расширений
│   ├── epf/                # Исходники внешних обработок
│   └── erf/                # Исходники внешних отчётов
├── tasks/                  # Задачи OScript
├── tests/                  # Скриптовые тесты OneScript (*.os)
│   ├── cfe/                # Исходники тестовых расширений (YAxUnit и тесты)
│   └── epf/                # Исходники тестовых обработок (xUnit)
├── tools/                  # Настройки и вспомогательные утилиты
├── env.json                # Осн. профиль запуска (или autumn-properties.json для vrunner 3)
└── packagedef              # Файл проекта и зависимостей OPM
```

## Важные нюансы

- Команды выполняются задачами VS Code: вывод виден в панели задачи, прогон можно остановить. Интерактивный терминал возвращается настройкой `execution.useTasks`.
- По умолчанию расширение ищет `vrunner` и может использовать `oscript_modules/bin/vrunner.bat` проекта.
- Пути в настройках проекта задаются относительно workspace, если не указано иное.

<!--
## Подпись кода

Подпись кода для релизов предоставляется бесплатно программой [SignPath Foundation](https://signpath.org/), сертификат выпущен от её имени.
-->

## Автор и поддержка

<img src="resources/brand/cat-hi.png" alt="" width="72" align="right">

Автор: Ivan Karlo (<i.karlo@outlook.com>)

Поддержать проект:

- [Boosty](https://boosty.to/1carlo/donate)
- [Чаевые](https://pay.cloudtips.ru/p/d752cb43)
