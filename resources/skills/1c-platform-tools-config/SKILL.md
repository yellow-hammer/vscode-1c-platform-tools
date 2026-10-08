---
name: 1c-platform-tools-config
description: Конфигурации запуска и служебные файлы (env.json и env-профили, launch.json, .gitignore, .gitattributes). Используй, когда пользователь просит открыть или создать env.json, переключить профиль запуска, запустить 1С с параметрами, создать .gitignore, .gitattributes или другие служебные файлы проекта.
---

# Конфигурации запуска и служебные файлы

Профиль — файл настроек vanessa-runner в корне проекта. Активный хранится в состоянии проекта, в git не входит, виден в строке состояния и подставляется во все команды vanessa-runner.

- vanessa-runner 2.x: `env.json` — базовый, `env.<id>.json` — именованный (`env.dev.json`);
- vanessa-runner 3.x: `autumn-properties.json` и `autumn-properties.<id>.json`;
- `env.local.json` — личные перекрытия, профилем не считается. Плоский объект с флагами `--ibconnection`, `--db-user`, `--db-pwd`, `--v8version`, `--additional`. Допустимы обёртки `default` (2.x) и `vrunner` (3.x).

Приоритет строки подключения: временные параметры, затем `env.local.json`, затем профиль. Временные параметры — адрес ИБ, пользователь, пароль, версия платформы, дополнительные аргументы — действуют на все команды vanessa-runner. В значениях работает `${gitBranch}`: `feature/RS-123` становится `feature-RS-123`, так делают отдельную базу на ветку (`"--ibconnection": "/F./build/${gitBranch}"`).

## Смена профиля

Перед операцией, которая зависит от окружения, вызови `env_status`. В ответе: `activeProfileId`, `settingsFile`, `settingsFileExists`, `settingsSchema` (`v2` или `v3`), `profiles` (`id`, `fileName`, `label`), `overrides`, `localOverrides`, `localOverridesFile`, `gitBranch`, `effectiveIbConnection` (уже с подстановкой ветки и перекрытиями), `vrunnerVersion`, `odata`. Пароль замаскирован.

Если пользователь назвал профиль («запусти тесты под test», «переключись на storage») — переключи его и дальше работай уже с ним. Если не назвал — не переключай, оставайся на активном. Разовый прогон под другим файлом настроек, без смены активного профиля, — параметр `settingsFile` у команды vanessa-runner.

`env_selectProfile` и Execute Command `1c-platform-tools.env.selectProfile` принимают id (`dev`), имя файла (`env.dev.json`, `autumn-properties.ci.json`) или подпись (`По умолчанию`). У MCP это параметр `profile`, у Execute Command — строка-аргумент. Без имени агентный вызов окно не открывает и возвращает ошибку со списком `available`. Успех: «Активирован профиль «id» (файл fileName).» Неизвестный профиль: «Профиль запуска «…» не найден. Доступные профили: …».

| Задача | Command ID | MCP | wait: true |
|---|---|---|---|
| Состояние окружения | `1c-platform-tools.env.status` | `env_status` | результат |
| Выбрать профиль | `1c-platform-tools.env.selectProfile` | `env_selectProfile` | результат |
| Сбросить временные параметры | `1c-platform-tools.env.clearOverrides` | `env_clearOverrides` | результат |
| Определить версию vanessa-runner заново | `1c-platform-tools.env.refreshVersion` | `env_refreshVersion` | результат |
| Открыть env.json | `1c-platform-tools.env.editSettingsFile` | `env_editSettingsFile` | пустой |
| Открыть редактор профиля | `1c-platform-tools.env.openProfileEditor` | `env_openProfileEditor` | пустой |
| Создать базовый набор служебных файлов | `1c-platform-tools.serviceFiles.createRecommendedSet` | `serviceFiles_createRecommendedSet` | пустой |
| Создать .gitignore | `1c-platform-tools.serviceFiles.createGitignore` | `serviceFiles_createGitignore` | пустой |
| Создать .gitattributes | `1c-platform-tools.serviceFiles.createGitattributes` | `serviceFiles_createGitattributes` | пустой |
| Создать env.json | `1c-platform-tools.serviceFiles.createEnvJson` | `serviceFiles_createEnvJson` | пустой |
| Создать профиль | `1c-platform-tools.env.createProfile` | нет | |
| Задать временные параметры окном | `1c-platform-tools.env.setOverrides` | нет | |
| Открыть launch.json | `1c-platform-tools.launch.editConfigurations` | нет | |
| Меню выбора служебного файла | `1c-platform-tools.serviceFiles.create` | нет | |

`env_editSettingsFile` и `env_openProfileEditor` открывают файл и исход не возвращают. Служебный файл, который уже есть, открывается и не перезаписывается; отсутствующий создаётся. `serviceFiles_createEnvJson` при создании спрашивает секции `vanessa`, `xunit`, `syntax-check` флажками: команда этот выбор у агента не принимает. `serviceFiles_createRecommendedSet` пишет отсутствующие файлы из шаблона без вопросов. Вызывай их с `wait: false`. При `wait: true` канал ответит, что wait не поддерживается, хотя файл уже мог открыться или создаться. Повтор из-за этой фразы не делай: проверь файл на диске.

Явный `settingsFile` у команды vanessa-runner отменяет перекрытия активного профиля и не отменяет `ibConnection`. Явный `ibConnection` убирает из перекрытий подключение, пользователя и пароль и передаётся в команду. В stdout это строки `[контекст]`: «Перекрытия активного профиля не применены: в вызове задан settingsFile.», «Из перекрытий профиля исключено подключение к ИБ: в вызове задана явная строка подключения.» и «Подключение из вызова: …». Если перекрытия применены, та же приставка показывает, какие именно.

`1c-platform-tools.env.createProfile` агенту недоступен: «Команда открывает окна VS Code и недоступна агенту. Имя профиля запрашивается в окне VS Code; профиль создаётся пользователем или файлом env.<id>.json.» Создай файл `env.<id>.json` сам.

`1c-platform-tools.env.setOverrides` агенту недоступен: «Команда открывает окна VS Code и недоступна агенту. Временные параметры задаются в окнах VS Code; для агента передавайте settingsFile или ibConnection в вызове.» Другую версию платформы или другую базу на один запуск передавай `settingsFile` или `ibConnection` в `run_enterprise`, `run_designer` или команду тестов.

`1c-platform-tools.launch.editConfigurations` в MCP нет. `tasks_edit` открывает `tasks.json`, не `launch.json`.

`1c-platform-tools.serviceFiles.create` — меню. Агентный вызов отвечает: «Команда открывает окна VS Code и недоступна агенту. Используйте serviceFiles.createRecommendedSet, createGitignore, createGitattributes, createEnvJson или serviceFiles.ensure с id файла.» В MCP есть четыре команды создания из таблицы. `1c-platform-tools.serviceFiles.ensure` в MCP нет.

## Что лежит в файлах

- `env.json` — подключение, платформа, секции команд.
- `.gitignore` — `/build/`, `/oscript_modules/`, `env.local.json`, `lastUploadedCommit.txt`, бинарники конфигурации.
- `.gitattributes` — текст и переводы строк для исходников 1С, бинарные cf и epf.
- `lastUploadedCommit.txt` — SHA инкрементальной загрузки в каталоге исходников конфигурации.

## Примеры

- Какой профиль активен: `env_status`.
- Переключить на dev: `env_selectProfile` с `profile: "dev"`.
- Gitignore проекта: `serviceFiles_createGitignore` с `wait: false`.
