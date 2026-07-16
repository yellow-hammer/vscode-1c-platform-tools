---
name: 1c-platform-tools-config
description: Конфигурации запуска и служебные файлы (env.json и env-профили, launch.json, .gitignore, .gitattributes). Используй, когда пользователь просит открыть/создать env.json, переключить профиль запуска, запустить 1С с параметрами, создать .gitignore/.gitattributes или другие служебные файлы проекта.
---

# Конфигурации запуска и служебные файлы: команды расширения

**Выполняй команды сам** (Execute Command), не проси пользователя искать файлы вручную.

## env-профили запуска

Профиль — самодостаточный файл настроек vanessa-runner в корне проекта:

- `env.json` — базовый профиль (по умолчанию);
- `env.<id>.json` — именованный профиль (`env.dev.json`, `env.prod.json`);
- `env.local.json` — личные переопределения разработчика (в `.gitignore`).

Активный профиль выбирается локально (не коммитится) и подставляется во все команды vrunner через `--settings`. Поверх него можно задать **временные параметры** (адрес ИБ, пользователь, пароль, версия платформы, дополнительные параметры) — отдельные флаги перекрывают значения файла и применяются ко **всем** командам vanessa-runner. Сам запуск Предприятия/Конфигуратора/тестов — обычными командами (см. навык 1c-platform-tools-run и др.) под активным профилем.

**Правило выбора профиля.** Если пользователь назвал профиль в запросе («запусти тесты под test», «переключись на storage») — переключи его: `1c-platform-tools.env.selectProfile` с аргументом-строкой (id `dev`, имя файла `env.dev.json` или подпись профиля). Если профиль не назван — ничего не переключай, работай под активным профилем из статус-бара. Для разового прогона под другим профилем без переключения передавай `settingsFile` в MCP-инструменте.

| Запрос пользователя (примеры) | Command ID |
|---|---|
| Выбрать/переключить профиль запуска | `1c-platform-tools.env.selectProfile` (аргумент-строка — без окна выбора) |
| Создать новый профиль (env.dev.json и т.п.) | `1c-platform-tools.env.createProfile` |
| Задать временные параметры (ИБ/версия/пользователь) на лету | `1c-platform-tools.env.setOverrides` |
| Сбросить временные параметры | `1c-platform-tools.env.clearOverrides` |
| Открыть env.json | `1c-platform-tools.config.env.edit` |
| Открыть launch.json | `1c-platform-tools.launch.editConfigurations` |

## Служебные файлы

Расширение создаёт служебные файлы из шаблонов. Существующий файл не перезатирается — открывается; отсутствующий создаётся. При создании `env.json` секции команд (vanessa/xunit/syntax-check) выбираются флажками.

| Запрос пользователя (примеры) | Command ID |
|---|---|
| Создать служебные файлы (меню выбора) | `1c-platform-tools.serviceFiles.create` |
| Создать базовый набор | `1c-platform-tools.serviceFiles.createRecommendedSet` |
| Создать .gitignore | `1c-platform-tools.serviceFiles.createGitignore` |
| Создать .gitattributes | `1c-platform-tools.serviceFiles.createGitattributes` |
| Создать env.json | `1c-platform-tools.serviceFiles.createEnvJson` |

## Назначение служебных файлов

- **env.json / env.<id>.json** — настройки vanessa-runner (подключение к ИБ, версия платформы, секции команд `default`/`vanessa`/`xunit`/...).
- **env.local.json** — локальные переопределения; не коммитится.
- **.gitignore** — исключения для 1С: `/build/`, `/oscript_modules/`, `env.local.json`, `lastUploadedCommit.txt`, бинарники `*.cf/*.cfe/*.epf/*.erf/*.dt`.
- **.gitattributes** — текст/бинарь и переводы строк для файлов 1С (`*.bsl`, `*.os`, `*.xml` — текст; `*.cf`, `*.epf` — бинарь).
- **lastUploadedCommit.txt** — служебный файл инкрементальной выгрузки конфигурации (хранит SHA последнего выгруженного коммита).
- **tools/** — конфиги инструментов (VAParams.json, vrunner.init.json, yaxunit.json, xUnitParams.json и пр.), на которые ссылаются секции env.json.

## Примеры

- «Запусти 1С с другой версией платформы» → `1c-platform-tools.env.setOverrides` (задать `--v8version`), затем запуск.
- «Переключись на dev-профиль» → `1c-platform-tools.env.selectProfile`.
- «Сделай gitignore для проекта 1С» → `1c-platform-tools.serviceFiles.createGitignore`.
