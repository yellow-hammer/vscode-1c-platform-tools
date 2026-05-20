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

## Команды расширения

| Задача                  | Command ID                           |
|-------------------------|--------------------------------------|
| XUnit тесты             | `1c-platform-tools.test.xunit`       |
| Синтаксический контроль | `1c-platform-tools.test.syntaxCheck` |
| Vanessa тесты           | `1c-platform-tools.test.vanessa`     |
| Allure отчёт            | `1c-platform-tools.test.allure`      |

## MCP (mcp-1c-platform-tools)

Если доступны инструменты MCP, используй их: `test_xunit`, `test_syntaxCheck`, `test_vanessa`, `test_allure`.

### Параметр projectPath

Обязательный. Корень проекта 1С (каталог с `packagedef`). Если пользователь указал путь — используй его; иначе корень workspace.

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
