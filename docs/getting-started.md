<img src="../resources/brand/cat-hi.png" alt="" width="72" align="right">

# С чего начать

> <img src="../resources/brand/cat-hi.png" alt="" width="26" align="left"> Поставить, открыть проект, заполнить профиль — и дерево команд готово к работе.

## Установка

Поиск по `1C: Platform Tools` в панели расширений (`Ctrl+Shift+X`) или ссылкой:

| Редактор | Откуда ставить |
|----------|----------------|
| Visual Studio Code | [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=yellow-hammer.1c-platform-tools) |
| Cursor, Windsurf, VSCodium | [Open VSX](https://open-vsx.org/extension/yellow-hammer/1c-platform-tools) |
| Без доступа к маркетплейсу | файл `.vsix` из [релизов](https://github.com/yellow-hammer/vscode-1c-platform-tools/releases), `Extensions: Install from VSIX…` |

В Cursor работают те же панели и команды; MCP там подключается своим файлом `.cursor/mcp.json` — его пишет команда расширения, см. [MCP-сервер](https://yellow-hammer.github.io/vscode-1c-platform-tools/mcp/).

Расширение активируется, когда в рабочей области есть проект 1С: каталог с файлом `packagedef`. Проектов в окне может быть несколько, см. [Проекты в рабочей области](tools.md#проекты-в-рабочей-области). Панели **1С: Проекты** и **1С: Администрирование** работают и без открытого проекта: первая поможет найти и открыть нужный, вторая не привязана к рабочей области вовсе.

## Что нужно для работы

- **Платформа 1С:Предприятие 8** — клиент, конфигуратор, `1cestart`, `rac`/`ras`, `ibsrv`, `ibcmd`.
- **OneScript, OPM и vanessa-runner** — из раздела **Зависимости** в дереве **1С: Инструменты**.
- **1С:EDT** — если исходный код ведётся в формате EDT, см. [Формат EDT](edt.md).
- **MCP** — расширение [1C: Platform Tools MCP](https://marketplace.visualstudio.com/items?itemName=yellow-hammer.mcp-1c-platform-tools), если команды вызывает агент, см. [MCP-сервер](https://yellow-hammer.github.io/vscode-1c-platform-tools/mcp/).

<img src="../resources/brand/bird.png" alt="" width="28" align="left"> Без локальной 1С команды можно выполнять в Docker — см. [Docker и ibcmd](docker.md).

## Первые шаги

1. Откройте существующий проект 1С с файлом `packagedef` или выполните команду **1С: Зависимости: Инициализировать проект**.
2. При необходимости выполните **1С: Зависимости: Инициализировать структуру проекта**. Будут созданы каталоги по шаблону [vanessa-bootstrap](https://github.com/yellow-hammer/vanessa-bootstrap).
3. Настройте подключение к ИБ в основном [профиле запуска](launch-profiles.md). Формат файла зависит от установленного vanessa-runner (расширение определяет версию автоматически):

   ```jsonc
   // env.json — vanessa-runner 2
   { "default": { "--ibconnection": "/F./build/ib" } }

   // autumn-properties.json — vanessa-runner 3
   { "vrunner": { "ibconnection": "/F./build/ib" } }
   ```

   Профиль можно создать из дерева **Служебные файлы** (пункт «Осн. профиль запуска») или из статус-бара.

4. Установите зависимости через раздел **Зависимости** или команду **1С: Зависимости: Установить зависимости**.
5. Откройте панель **1С: Инструменты** и запускайте нужные команды из дерева.

Пошаговое знакомство со всеми панелями есть и внутри редактора — walkthrough **Начало работы с 1C: Platform Tools** (Help → Welcome или `F1` → `Welcome: Open Walkthrough`).
