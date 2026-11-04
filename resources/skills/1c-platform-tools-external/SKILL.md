---
name: 1c-platform-tools-external
description: Сборка и разборка внешних обработок и отчётов (EPF/ERF). Используй, когда пользователь просит собрать EPF или ERF, разобрать обработку или отчёт в исходники, удалить кэш внешних файлов, запустить обработку в Предприятии.
---

# Внешние обработки и отчёты: команды и MCP

Выполняй операции из таблицы сам, кроме `epf_addBspRegistration`. Каталоги исходников в вызов не передаются. `projectPath` передавай, только если пользователь назвал проект.

| Задача | Command ID | MCP | wait: true |
|---|---|---|---|
| Собрать обработки | `1c-platform-tools.epf.compileProcessor` | `epf_compileProc` | результат |
| Разобрать обработки | `1c-platform-tools.epf.decompileProcessor` | `epf_decompileProc` | результат |
| Собрать отчёты | `1c-platform-tools.epf.compileReport` | `epf_compileReport` | результат |
| Разобрать отчёты | `1c-platform-tools.epf.decompileReport` | `epf_decompileReport` | результат |
| Удалить кэш | `1c-platform-tools.epf.clearCache` | `epf_clearCache` | отказ |
| Запустить обработку или отчёт в Предприятии | `1c-platform-tools.epf.run` | `epf_run` | результат |
| Добавить регистрацию БСП | `1c-platform-tools.epf.addBspRegistration` | `epf_addBspRegistration` | пустой |

`epf_compileProc` и `epf_compileReport` принимают `outputDirectory` и `outputName` (имя без расширения; переменные `${name}`, `${folder}`, `${version}`, `${gitBranch}`).

`epf_clearCache` при `wait: true` сразу отказывается («Очистка кэша — файловая операция, не vrunner») и кэш не удаляет. Для очистки вызови с `wait: false`.

`epf_run`: `execute` — путь к `.epf` или `.erf`, `command` — строка `/C`. Нужен хотя бы один. Те же параметры есть у `run_enterprise`.

`epf_addBspRegistration` спрашивает представление в окне и пишет в выделенный объект метаданных. Для агента его не вызывай.

Версию обработки или отчёта человек ставит командами `1c-platform-tools.epf.setVersionProcessor` и `1c-platform-tools.epf.setVersionReport`. Инструментов MCP нет.

## Примеры

- Собрать обработки: `epf_compileProc`.
- Разобрать отчёты: `epf_decompileReport`.
- Запустить обработку: `epf_run` с `execute` и при необходимости `command`.
