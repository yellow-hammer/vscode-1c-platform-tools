---
name: 1c-platform-tools-configuration
description: Загрузка и выгрузка конфигурации 1С. Используй, когда пользователь просит загрузить конфигурацию из исходников, выгрузить в cf, загрузить инкремент, выгрузить изменения, собрать или разобрать 1Cv8.cf, конвертировать исходники.
---

# Конфигурация: команды и MCP

Выполняй операции сам, инструментом MCP или командой расширения, кроме `cf_loadByList`: при `wait: true` отказ, загрузки нет, агенту не вызывай. Исходники расширение находит в проекте само: выгрузка конфигуратора или проект 1С:EDT.

`projectPath` передавай, только если пользователь назвал проект. `wait: true` по умолчанию возвращает результат, кроме строки «отказ».

Загрузка изменений, выгрузка изменений и загрузка по `objlist.txt` есть у выгрузки конфигуратора.

| Задача | Command ID | MCP | wait: true |
|---|---|---|---|
| Загрузить из исходного кода | `1c-platform-tools.cf.load` | `cf_load` | результат |
| Загрузить изменения | `1c-platform-tools.cf.loadIncrement` | `cf_loadInc` | результат |
| Загрузить из 1Cv8.cf | `1c-platform-tools.cf.loadFile` | `cf_loadFile` | результат |
| Загрузить из objlist.txt | `1c-platform-tools.cf.loadByList` | `cf_loadByList` | отказ |
| Выгрузить в исходный код | `1c-platform-tools.cf.dump` | `cf_dump` | результат |
| Выгрузить изменения | `1c-platform-tools.cf.dumpIncrement` | `cf_dumpInc` | результат |
| Выгрузить в 1Cv8.cf | `1c-platform-tools.cf.unload` | `cf_unload` | результат |
| Собрать 1Cv8.cf | `1c-platform-tools.cf.compile` | `cf_compile` | результат |
| Разобрать 1Cv8.cf | `1c-platform-tools.cf.decompile` | `cf_decompile` | результат |
| Конвертировать исходный код | `1c-platform-tools.cf.convert` | `cf_convert` | результат |
| Выгрузить поставку | `1c-platform-tools.cf.makeDist` | `cf_makeDist` | результат |

Обновление конфигурации базы отдельной командой — `infobase_updateDb` (`1c-platform-tools.infobase.updateDb`). Загрузка в пустую базу — `infobase_initFromSrc`.

## Параметры

- `cf_load`, `cf_loadInc`, `cf_loadFile`: `updateDb`. Без него база не обновляется, если в настройках проекта не задано иное. `cf_load` с `updateDb: true` обновляет базу тем же запуском.
- `cf_loadInc`: `sha` — коммит прошлой загрузки, изменения берутся от него до текущего состояния. Пустая строка — полная загрузка. Вызов без `sha` отклоняется и коммит в окне не спрашивает. Значение пишется в `lastUploadedCommit.txt` в каталоге исходников конфигурации. Текущий коммит — `git rev-parse HEAD`. На vanessa-runner 2.x загрузка изменений без обновления базы выполняется полной загрузкой: в stdout будет `[контекст]` с этой оговоркой.
- `cf_loadByList` при `wait: true` сразу отвечает «Загрузка по objlist.txt требует подготовки списка в UI; wait: true недоступен» и ничего не загружает.
- `cf_unload`, `cf_compile`, `cf_makeDist`: `outputDirectory`, `outputName` (имя без расширения; переменные `${name}`, `${folder}`, `${version}`, `${gitBranch}`).

## Примеры

- Загрузить исходники текущего проекта: `cf_load`.
- Загрузить изменения от SHA: `cf_loadInc` с `sha`.
- Собрать cf в каталог сборки: `cf_compile`.
