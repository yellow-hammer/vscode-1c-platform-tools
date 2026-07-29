---
name: 1c-platform-tools-test
description: Тестирование 1С. Используй, когда пользователь просит запустить тесты, XUnit, Vanessa, синтаксический контроль, построить Allure-отчёт.
---

# Тестирование: команды и MCP

Выполняй запуск тестов и отчётов через команды расширения или инструменты MCP. **Выполняй команду сам** (Execute Command или MCP), не проси пользователя нажимать палитру.

## Когда вызывать

| Запрос пользователя (примеры)             | Действие                                  |
|-------------------------------------------|-------------------------------------------|
| Запусти тесты, XUnit, Vanessa             | `test_xunit` / `test_vanessa` или команда |
| Синтаксический контроль                   | `test_syntaxCheck` или команда            |
| Построй Allure-отчёт                      | `test_allure` или команда                 |
| Собери/разбери unit тесты (.epf)          | команда buildEpf / decompileEpf           |

## Команды расширения

| Задача                        | Command ID                            |
|-------------------------------|---------------------------------------|
| XUnit тесты                   | `1c-platform-tools.test.xunit`        |
| Синтаксический контроль       | `1c-platform-tools.test.syntaxCheck`  |
| Vanessa тесты                 | `1c-platform-tools.test.vanessa`      |
| YAxUnit тесты                 | `1c-platform-tools.test.yaxunit`      |
| Allure отчёт                  | `1c-platform-tools.test.allure`       |
| Собрать unit тесты            | `1c-platform-tools.test.buildEpf`     |
| Разобрать unit тесты          | `1c-platform-tools.test.decompileEpf` |
| Запустить EPF в Предприятии   | `1c-platform-tools.externalProcessors.run`    |
| Настроить тестовые фреймворки | `1c-platform-tools.test.configure` |

Сборка/разборка unit тестов (тестовых обработок 1С): исходники в `src/tests` (настройка `paths.testsSrc`), собранные `.epf` — в `build/out/tests` (артефакт, в git не попадает). В `tests` — скриптовые `.os`-тесты OneScript; дымовые наборы Vanessa-ADD поставляются в пакете add (oscript_modules). Обе команды возвращают структурированный результат.

## Панель тестирования VS Code

Тесты также отображаются в нативной панели «Тестирование» (Test Explorer): Vanessa (.feature), xUnit (тестовые обработки в src/tests), YAxUnit, OneScript (.os в tests), 1bdd — с запуском отдельных тестов и статусами. Для интерактивной работы пользователя направляй туда; команды выше — для прогона «всего сразу» и агентных циклов.

## Запуск обработок в Предприятии (externalProcessors.run)

Служебные шаги (загрузка фикстур, инициализация ИБ внешней обработкой) — MCP `externalProcs_run` или Execute Command `1c-platform-tools.externalProcessors.run`:

```
{ "projectPath": "...", "execute": "./build/out/epf/ЗагрузкаФикстур.epf",
  "command": "Путь=./fixtures/Константы.xml;ЗавершитьРаботуСистемы" }
```

`execute` — путь к EPF/ERF, `command` — строка параметров `/C`; нужен хотя бы один из них.

## Настройка фреймворков (test.configure)

Неинтерактивно — MCP `test_configure` или Execute Command `1c-platform-tools.test.configure` с параметром `frameworks` (ключи: `vanessa`, `xunit`, `yaxunit`, `onescript`, `onebdd`; перечисленные включаются, остальные выключаются, недостающие каталоги создаются).

Агентный вызов без `frameworks` вернёт ошибку с подсказкой, окно не откроется. Интерактивный визард доступен только пользователю из палитры.

## MCP (mcp-1c-platform-tools)

Если доступны инструменты MCP, используй их: `test_xunit`, `test_syntaxCheck`, `test_vanessa`, `test_yaxunit`, `test_allure`, `externalProcs_run`, `test_configure`.

### Параметр projectPath

Обязательный. Корень проекта 1С (каталог с `packagedef`). Если пользователь указал путь — используй его; иначе корень workspace.

### Параметр settingsFile

Файл настроек vanessa-runner относительно `projectPath`; перекрывает активный профиль для конкретного вызова. Используй, когда нужен другой набор сценариев или другая ИБ без переключения профиля (например, init-профиль `tools/vrunner.init.json` вместо основного `env.json`).

### Параметр wait

`wait: true` — ждать завершения операции и получить структурированный результат:

```
{
  success: boolean,   // прогон тестов: true только если тесты прошли
  exitCode: number,
  stdout: string,     // вывод vrunner и сводка прогона
  stderr: string,
  tests?: {           // прогоны тестов: сводка по отчёту
    total, passed, failed, errors, skipped,
    reportPath, failedTests
  }
}
```

**`wait: true` — по умолчанию:** агент читает `success`, `exitCode`, счётчики тестов и решает, что делать дальше.

**`wait: false`:** команда уходит в терминал, результат прогона неизвестен — только когда пользователь смотрит выполнение сам.

## Поддержка wait: true (тесты)

| MCP-инструмент    | wait: true |
|-------------------|:----------:|
| `test_syntaxCheck`| ✅          |
| `test_xunit`      | ✅          |
| `test_vanessa`    | ✅          |
| `test_yaxunit`    | ✅          |
| `externalProcs_run`  | ✅          |
| `test_configure`| ✅ (с параметром `frameworks`) |
| `test_allure`     | ❌ (открывает браузер) |

## Примеры

- Проверка синтаксиса (агентный цикл):
  ```
  test_syntaxCheck { projectPath: "C:/projects/MyProject" }
  ```
  → вернёт `{ success: false, exitCode: 1, stdout: "ОШИБКА - ...", stderr: "" }`

- Прогон тестов под другим файлом настроек, без переключения профиля:
  ```
  test_vanessa { projectPath: "C:/projects/MyProject", settingsFile: "tools/vrunner.init.json" }
  ```
  → в ответе счётчики прогона и список упавших тестов

- Выполни команду `1c-platform-tools.test.xunit` для запуска XUnit-тестов текущего проекта.
- Вызови MCP `test_vanessa` с `projectPath` = корень проекта 1С.
