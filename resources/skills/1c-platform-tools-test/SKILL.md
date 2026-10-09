---
name: 1c-platform-tools-test
description: Тестирование 1С. Используй, когда пользователь просит запустить тесты xUnit, Vanessa, YAxUnit, мутационное тестирование, синтаксический контроль, проверку проекта EDT, собрать тестовые обработки или построить отчёт Allure.
---

# Тестирование: команды и MCP

Выполняй прогон сам. `projectPath` передавай, только если пользователь назвал проект. `settingsFile` — файл настроек vanessa-runner на один вызов, без смены активного профиля. Другая база на этот прогон — `ibConnection`. У `test_validateEdt` строки подключения нет: параметр базу не меняет.

Профили переменных среды oneunit и 1testrunner лежат в `.vscode/onescript-tests.json`. Переключение — команда «Профиль тестов OneScript» или профиль запуска в панели тестов. На тесты 1С профиль не действует. Без файла прогон как раньше.

`wait: true` по умолчанию. Прогон с упавшими тестами приходит как ошибка вызова. Поле `tests`: `total`, `passed`, `failed`, `errors`, `skipped`, `reportPath`, `failedTests`.

| Задача | Command ID | MCP | wait: true |
|---|---|---|---|
| xUnit | `1c-platform-tools.test.xunit` | `test_xunit` | результат |
| Vanessa | `1c-platform-tools.test.vanessa` | `test_vanessa` | результат |
| YAxUnit | `1c-platform-tools.test.yaxunit` | `test_yaxunit` | результат |
| Мутационное тестирование | `1c-platform-tools.test.mutatos` | `test_mutatos` | результат |
| Синтаксический контроль | `1c-platform-tools.syntaxCheck.run` | `syntaxCheck_run` | результат |
| Обновить ошибки в Problems | `1c-platform-tools.syntaxCheck.refresh` | `syntaxCheck_refresh` | без исхода |
| Очистить ошибки в Problems | `1c-platform-tools.syntaxCheck.clear` | `syntaxCheck_clear` | без исхода |
| Отчёт Allure | `1c-platform-tools.test.allure` | `test_allure` | отказ |
| Включить фреймворки | `1c-platform-tools.test.configure` | `test_configure` | результат |
| Собрать unit-тесты | `1c-platform-tools.test.compileEpf` | `test_compileEpf` | результат |
| Разобрать unit-тесты | `1c-platform-tools.test.decompileEpf` | `test_decompileEpf` | результат |
| Проверить проект EDT | `1c-platform-tools.test.validateEdt` | `test_validateEdt` | результат |
| Загрузить тестовые расширения | `1c-platform-tools.test.loadExtensions` | `test_loadExts` | результат |
| Выгрузить тестовые расширения | `1c-platform-tools.test.dumpExtensions` | `test_dumpExts` | результат |
| Собрать тестовые расширения | `1c-platform-tools.test.compileExtensions` | `test_compileExts` | результат |
| Разобрать тестовые расширения | `1c-platform-tools.test.decompileExtensions` | `test_decompileExts` | результат |
| Добавить YAxUnit | `1c-platform-tools.test.addYaxunit` | `test_addYaxunit` | результат |
| Запустить EPF в Предприятии | `1c-platform-tools.epf.run` | `epf_run` | результат |

## Синтаксический контроль

`syntaxCheck_run` добавляет `errors`: `filepath` (модуль от корня проекта), `metadataPath`, `severity` (`error` или `warning`), `message`. Правь код по этому списку. `syntaxCheck_refresh` и `syntaxCheck_clear` только меняют панель Problems и исход прогона не возвращают.

## Allure и отчёт мутаций

`test_allure` при `wait: true` отвечает «Allure-отчёт открывается в браузере; wait: true недоступен» и отчёт не строит. С `wait: false` отчёт строится и открывается в браузере.

`test_mutatos` возвращает итог прогона и пути отчётов. Команда `1c-platform-tools.test.mutatosReport` открывает HTML у человека и в MCP не публикуется. `1c-platform-tools.test.mutatosItem` — пункт меню узла панели, инструмента нет.

## Фреймворки и тестовое окружение

`test_configure` с `frameworks`: `vanessa`, `xunit`, `yaxunit`, `onescript`, `onebdd`. Перечисленные включаются, остальные выключаются, недостающие каталоги создаются без вопроса. Без `frameworks` агентный вызов возвращает «Настройка тестов без параметра frameworks требует выбора в UI; передайте frameworks (vanessa, xunit, yaxunit, onescript, onebdd)», окно не открывается. Неизвестное имя возвращает список доступных ключей.

Тестовые расширения лежат под каталогом из настройки `1c-platform-tools.test.directoryName` (по умолчанию `tests`), собранные `*.cfe` — в каталоге сборки. Команды расширений решения их не трогают. Перед YAxUnit расширения должны быть в базе: `test_loadExts`. Параметр `extensions` есть у `test_loadExts`, `test_dumpExts`, `test_compileExts`, `test_decompileExts`. Явный список окно не открывает и сохранённый выбор не меняет. Без параметра сначала берётся непустая настройка `1c-platform-tools.test.cfe.selected`, иначе сохранённый выбор проекта, а если он пуст или уже не подходит составу — все тестовые расширения. У `test_addYaxunit` параметра `extensions` нет: команда скачивает релиз YAxUnit и разбирает его в исходники.

`test_compileEpf` и `test_decompileEpf` собирают и разбирают тестовые обработки. Исходники — выгрузка конфигуратора или проект 1С:EDT под каталогом тестов, собранные `.epf` лежат в каталоге сборки и в git не входят. Обе команды возвращают результат. Там же скриптовые `.os`-тесты OneScript. Дымовые наборы Vanessa-ADD приходят пакетом add в каталоге oscript_modules.

В дереве «Инструменты 1С» сборка, разборка и тестовые расширения — группа «Тестовое окружение», прогон — группа «Тестирование».

`test_validateEdt` проверяет проект EDT через vanessa-runner 3.x и возвращает результат. На формате конфигуратора и на vanessa-runner 2.x команда возвращает ошибку. Это другая команда, чем `edt_validate`.

## epf_run

Служебный шаг (фикстуры, инициализация базы обработкой) — `epf_run`. `execute` — путь к `.epf` или `.erf`, `command` — строка `/C`. Нужен хотя бы один.

```
epf_run { "execute": "./build/out/epf/ЗагрузкаФикстур.epf", "command": "Путь=./fixtures/Константы.xml;ЗавершитьРаботуСистемы" }
```

## Панель «Тестирование»

В панели «Тестирование» человек запускает отдельные тесты: Vanessa (`.feature`), xUnit (обработки), YAxUnit, OneScript (`.os` в каталоге тестов), 1bdd. Команды этого навыка гоняют набор целиком.

## Примеры

- Синтаксический контроль текущего проекта: `syntaxCheck_run`.
- Vanessa на файле `tools/vrunner.init.json`: `test_vanessa` с `settingsFile: "tools/vrunner.init.json"`.
- xUnit: `test_xunit`.
