<img src="../resources/brand/cat-sleep.png" alt="" width="72" align="right">

# Список дел 1С

> <img src="../resources/brand/cat-sleep.png" alt="" width="26" align="left"> Панель живёт внизу, рядом с терминалом.

Панель **Список дел 1С** в нижней панели VS Code собирает комментарии с тегами `TODO`, `FIXME`, `XXX`, `HACK`, `BUG` по файлам BSL, OScript, Markdown и Gherkin.

![Панель «Список дел 1С»](../walkthrough/images/step7.png)

## Работа с панелью

- Клик по элементу открывает файл на нужной строке.
- **Фильтры** — по тегу и по области поиска: весь проект, текущий файл, конфигурация, расширения, эпики, фичи.
- **Группировка** — плоским списком, по файлам или иерархически по области.

## Настройки

- `1c-platform-tools.todo.tags` — свои теги (регистр не учитывается).
- `1c-platform-tools.todo.include` — glob-паттерны сканируемых файлов.
- `1c-platform-tools.todo.exclude` — исключаемые сегменты пути (например `oscript_modules`).
