---
name: 1c-platform-tools-test
description: Тестирование 1С. Используй, когда пользователь просит запустить тесты, XUnit, Vanessa, синтаксический контроль, построить Allure-отчёт.
---

# Тестирование: команды и MCP

Выполняй запуск тестов и отчётов через команды расширения или инструменты MCP. **Выполняй команду сам** (Execute Command или MCP), не проси пользователя нажимать палитру.

## Когда вызывать

| Запрос пользователя (примеры)     | Действие                    |
|-----------------------------------|-----------------------------|
| Запусти тесты, XUnit, Vanessa     | `test_xunit` / `test_vanessa` или команда |
| Синтаксический контроль            | `test_syntaxCheck` или команда |
| Построй Allure-отчёт              | `test_allure` или команда   |

## Команды расширения

| Задача                  | Command ID                           |
|-------------------------|--------------------------------------|
| XUnit тесты             | `1c-platform-tools.test.xunit`       |
| Синтаксический контроль | `1c-platform-tools.test.syntaxCheck` |
| Vanessa тесты           | `1c-platform-tools.test.vanessa`     |
| Allure отчёт            | `1c-platform-tools.test.allure`     |

## MCP (mcp-1c-platform-tools)

Если доступны инструменты MCP, используй их: `test_xunit`, `test_syntaxCheck`, `test_vanessa`, `test_allure`.

### Параметр projectPath

Обязательный. Корень проекта 1С (каталог с `packagedef`). Если пользователь указал путь — используй его; иначе корень workspace.

## Примеры

- Вызови MCP `test_vanessa` с `projectPath` = корень проекта 1С.
- Выполни команду `1c-platform-tools.test.xunit` для запуска XUnit-тестов текущего проекта.
