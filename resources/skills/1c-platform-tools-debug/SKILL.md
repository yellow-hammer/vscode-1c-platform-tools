---
name: 1c-platform-tools-debug
description: Замер производительности и просмотр значения в отладке 1С. Используй, когда пользователь просит начать или остановить замер производительности, очистить или показать его результаты, открыть значение переменной отладки.
---

# Отладка: замер и значение переменной

Исход операции эти инструменты не возвращают. Подключение к предмету отладки из дерева сеансов в MCP нет.

| Задача | Command ID | MCP |
|---|---|---|
| Начать замер | `1c-platform-tools.debug.measure.start` | `debug_measure_start` |
| Закончить замер | `1c-platform-tools.debug.measure.stop` | `debug_measure_stop` |
| Очистить результаты | `1c-platform-tools.debug.measure.clear` | `debug_measure_clear` |
| Показать результаты | `1c-platform-tools.debug.measure.showResults` | `debug_measure_showResults` |
| Показать значение переменной | `1c-platform-tools.debug.showVariableInWindow` | `debug_showVariableInWindow` |

Замер относится к сеансу отладки 1С. `debug_showVariableInWindow` открывает значение переменной этого сеанса в отдельном редакторе. Без сеанса и переменной команде нечего показывать.

Отладка через автономный сервер — `server_debug`, не команда из этой таблицы.

## Примеры

- Начать замер в текущем сеансе отладки: `debug_measure_start`.
- Закончить: `debug_measure_stop`.
