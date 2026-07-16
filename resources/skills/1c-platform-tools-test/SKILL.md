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
| Запустить EPF в Предприятии   | `1c-platform-tools.enterprise.run`    |
| Настроить тестовые фреймворки | `1c-platform-tools.testing.configure` |

Сборка/разборка unit тестов (тестовых обработок 1С): исходники в `src/tests` (настройка `paths.testsSrc`), собранные `.epf` — в `build/out/tests` (артефакт, в git не попадает). В `tests` — скриптовые `.os`-тесты OneScript; дымовые наборы Vanessa-ADD поставляются в пакете add (oscript_modules). Обе команды поддерживают `wait: true`.

## Панель тестирования VS Code

Тесты также отображаются в нативной панели «Тестирование» (Test Explorer): Vanessa (.feature), xUnit (тестовые обработки в src/tests), YAxUnit, OneScript (.os в tests), 1bdd — с запуском отдельных тестов и статусами. Для интерактивной работы пользователя направляй туда; команды выше — для прогона «всего сразу» и агентных циклов.

## Запуск обработок в Предприятии (enterprise_run)

Служебные шаги (загрузка фикстур, инициализация ИБ внешней обработкой) — через `1c-platform-tools.enterprise.run` (MCP: `enterprise_run`):

```
enterprise_run {
  projectPath: "C:/projects/MyProject",
  execute: "./build/out/epf/ЗагрузкаФикстур.epf",
  command: "Путь=./fixtures/Константы.xml;ЗавершитьРаботуСистемы",
  wait: true
}
```

`execute` — путь к EPF/ERF, `command` — строка параметров `/C`; нужен хотя бы один из них.

## Настройка фреймворков (testing_configure)

Неинтерактивно — с параметром `frameworks` (ключи: `vanessa`, `xunit`, `yaxunit`, `onescript`, `onebdd`; перечисленные включаются, остальные выключаются, недостающие каталоги создаются):

```
testing_configure { projectPath: "...", frameworks: ["vanessa", "yaxunit"], wait: true }
```

Без `frameworks` команда открывает визард в UI и с `wait: true` вернёт ошибку.

## MCP (mcp-1c-platform-tools)

Если доступны инструменты MCP, используй их: `test_xunit`, `test_syntaxCheck`, `test_vanessa`, `test_allure`, `enterprise_run`, `testing_configure`.

### Параметр projectPath

Обязательный. Корень проекта 1С (каталог с `packagedef`). Если пользователь указал путь — используй его; иначе корень workspace.

### Параметр settingsFile

Файл настроек vanessa-runner относительно `projectPath`; перекрывает активный профиль для конкретного вызова. Используй, когда нужен другой набор сценариев или другая ИБ без переключения профиля (например, init-профиль `tools/vrunner.init.json` вместо основного `env.json`).

### Параметр wait

`wait: true` — ждать завершения операции и получить структурированный результат:

```
{
  success: boolean,   // true = exitCode 0
  exitCode: number,
  stdout: string,     // вывод vrunner (прогресс, найденные ошибки)
  stderr: string
}
```

**Когда использовать `wait: false` (по умолчанию):** запуск из UI — пользователь видит ход выполнения в терминале. Используй для интерактивного запуска без ожидания.

**Когда использовать `wait: true`:** автономный агентный цикл — агент читает `success`, `exitCode`, `stdout`/`stderr` и решает, что делать дальше.

## Поддержка wait: true (тесты)

| MCP-инструмент    | wait: true |
|-------------------|:----------:|
| `test_syntaxCheck`| ✅          |
| `test_xunit`      | ✅          |
| `test_vanessa`    | ✅          |
| `enterprise_run`  | ✅          |
| `testing_configure`| ✅ (только с `frameworks`) |
| `test_allure`     | ❌ (открывает браузер) |

## Примеры

- Синхронная проверка синтаксиса (агентный цикл):
  ```
  test_syntaxCheck { projectPath: "C:/projects/MyProject", wait: true }
  ```
  → вернёт `{ success: false, exitCode: 1, stdout: "ОШИБКА - ...", stderr: "" }`

- Запуск синтакс-проверки из UI (пользователь видит терминал):
  ```
  test_syntaxCheck { projectPath: "C:/projects/MyProject" }
  ```
  → вернёт подсказку использовать wait: true для получения результата

- Выполни команду `1c-platform-tools.test.xunit` для запуска XUnit-тестов текущего проекта.
- Вызови MCP `test_vanessa` с `projectPath` = корень проекта 1С.
