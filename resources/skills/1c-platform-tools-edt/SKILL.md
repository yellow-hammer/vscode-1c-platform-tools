---
name: 1c-platform-tools-edt
description: Команды 1С:EDT. Используй, когда пользователь просит импортировать или выгрузить проект EDT, отформатировать модули, отсортировать объекты, показать сведения о проекте или проверить проект EDT.
---

# EDT: команды и MCP

Команды работают с активной конфигурацией формата EDT и установленной EDT. `projectPath` передавай, только если пользователь назвал проект.

Ответ инструмента исход не содержит. Вызывай с `wait: false`. При `wait: true` канал ответит, что wait не поддерживается, хотя команда уже могла выполниться. Повтор из-за этой фразы не делай.

| Задача | Command ID | MCP |
|---|---|---|
| Импортировать в проект EDT | `1c-platform-tools.edt.import` | `edt_import` |
| Выгрузить проект EDT в XML | `1c-platform-tools.edt.export` | `edt_export` |
| Проверить проект EDT | `1c-platform-tools.edt.validate` | `edt_validate` |
| Форматировать модули | `1c-platform-tools.edt.formatModules` | `edt_formatModules` |
| Сортировать объекты | `1c-platform-tools.edt.sortProject` | `edt_sortProj` |
| Сведения о проекте | `1c-platform-tools.edt.projectInfo` | `edt_projectInfo` |

`edt_validate` пишет `edt-validate.tsv` в каталог сборки и показывает замечания в Problems. В ответ инструмента таблица не входит. Проверка с разбором результата — `test_validateEdt` (`1c-platform-tools.test.validateEdt`): vanessa-runner 3.x, проект EDT.

Запуск IDE — `run_edt`, не команда из этой таблицы.

## Примеры

- Выгрузить XML: `edt_export` с `wait: false`.
- Узнать, что не так с проектом, и прочитать ответ: `test_validateEdt`.
