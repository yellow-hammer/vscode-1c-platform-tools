# Руководство для контрибьютеров

Спасибо за интерес к **1C: Platform Tools**. Проект развивается как расширение VS Code для повседневной разработки 1С: команды vanessa-runner, панели проектов и артефактов, дерево метаданных, TODO, отладка и интеграция с AI/MCP.

## Как помочь

- Сообщить об ошибке через [bug report](.github/ISSUE_TEMPLATE/bug_report.md).
- Предложить функцию через [feature request](.github/ISSUE_TEMPLATE/feature_request.md).
- Улучшить README, walkthrough, `docs/` или тексты навыков в `resources/skills/`.
- Исправить баг, добавить тесты или улучшить существующую фичу.
- Помочь проверить работу на разных версиях платформы 1С, ОС и сценариях запуска.

Проблемы безопасности отправляйте по правилам из [SECURITY.md](SECURITY.md), не через публичные Issues.

## Требования

- Node.js `20.x` или новее.
- npm.
- VS Code `1.103.0` или новее.
- Git.
- Для ручной проверки команд 1С: платформа 1С:Предприятие, OneScript, OPM и vanessa-runner.
- Для DAP-отладки и сборки адаптера: [.NET 8](https://dotnet.microsoft.com/download/dotnet/8.0).

## Основные команды

- `npm run compile` собирает расширение через esbuild.
- `npm run watch` запускает сборку в watch-режиме.
- `npm run lint` проверяет `src` через ESLint.
- `npm test` запускает VS Code extension tests; перед тестами выполняются `compile` и `lint`.
- `npm run package` собирает VSIX.
- `npm run build:onec-adapter` скачивает или собирает `onec-debug-adapter`.

## Ручная проверка

1. Откройте репозиторий в VS Code.
2. Нажмите `F5`, чтобы запустить Extension Development Host.
3. В новом окне откройте проект 1С с `packagedef` или выполните **1C: Зависимости: Инициализировать проект**.
4. Проверьте затронутую область: дерево **Инструменты 1С**, панели **Проекты 1С**, **Артефакты 1С**, **Метаданные 1С**, **Список дел**, DAP или AI/MCP.
5. Если менялись пользовательские тексты, проверьте их в интерфейсе на русском языке.

## Архитектура проекта

Ключевые точки входа:

```txt
src/
├── extension.ts                 # re-export точки входа
├── app/
│   ├── activate.ts              # активация расширения
│   ├── bootstrapApp.ts          # сборка приложения
│   ├── register*Flow.ts         # подключение крупных фич
│   └── projectLifecycle.ts      # контекст проекта 1С
├── commands/
│   ├── baseCommand.ts           # базовый класс команд
│   ├── commandRegistry.ts       # регистрация core-команд
│   └── *Commands.ts             # доменные команды vrunner и сервиса
├── features/
│   ├── tools/                   # дерево «Инструменты 1С», избранное, помощь
│   ├── projects/                # панель «Проекты 1С»
│   ├── artifacts/               # панель «Артефакты 1С»
│   ├── metadata/                # md-sparrow, дерево метаданных, ER
│   ├── todo/                    # TODO-панель и сканер
│   └── debug/                   # DAP-интеграция
├── shared/                      # инфраструктура, vrunner, IPC, логирование
├── utils/                       # общие утилиты
├── webviews/                    # webview-код
└── test/                        # тесты
```

Полезные файлы:

- `src/features/tools/treeStructure.ts` — единый источник групп дерева **Инструменты 1С** и команд избранного.
- `src/features/tools/commandNames.ts` — пользовательские названия команд.
- `src/shared/vrunnerManager.ts` — запуск vanessa-runner.
- `src/shared/projectStructure.ts` — структура проекта для команды инициализации.
- `src/shared/logger.ts` — логирование в Output.
- `package.json` — contribution points VS Code: команды, панели, настройки, walkthrough.
- `resources/skills/` — навыки для AI-агентов.
- `walkthrough/` — страницы onboarding в VS Code.

## Стандарты кода

- Пишите на TypeScript и избегайте `any`.
- Используйте типы из `@types/vscode`.
- Импорты держите в начале файла.
- Для VS Code API ориентируйтесь на существующие паттерны в проекте и `docs/vscode-api.md`.
- Для команд vrunner используйте `BaseCommand` и `VRunnerManager`, подробности в `docs/vrunner-patterns.md`.
- Не используйте `console.log`/`console.error` в production-коде; используйте `logger`.
- Комментарии в коде и сообщения пользователю пишите на русском.
- UI-тексты должны быть короткими и полезными: без внутренних терминов, планов реализации и длинных пояснений.
- Не добавляйте legacy/fallback-совместимость без явной необходимости.
- XML метаданных не правьте вручную из TypeScript; операции с метаданными должны идти через md-sparrow.

## Работа с командами и настройками

- Новые команды добавляйте в `package.json`, `src/features/tools/commandNames.ts` и нужный доменный модуль.
- Если команда должна быть в дереве **Инструменты 1С**, добавьте её в `TREE_GROUPS`.
- Для новых панелей добавляйте view/container в `package.json`, runtime-регистрацию в соответствующей feature-папке и flow в `src/app`.
- Кнопка **Настройки** в панели должна открывать релевантный раздел настроек.
- Все настройки расширения должны открываться с фильтром `@ext:yellow-hammer.1c-platform-tools`.

## Тестирование

Минимум перед PR:

```bash
npm run lint
npm run compile
npm test
```

Если менялась конкретная пользовательская фича, добавьте или обновите тесты в `src/test/`, когда это разумно. Для изменений в UI или интеграциях обязательно опишите ручную проверку в PR.

## Отладчик 1С

Расширение использует внешний DAP-процесс из репозитория [yellow-hammer/onec-debug-adapter](https://github.com/yellow-hammer/onec-debug-adapter).

Для обычной разработки расширения отдельная настройка адаптера не нужна: при сборке VSIX `npm run build:onec-adapter` скачает релиз адаптера с GitHub Releases или соберёт соседний репозиторий `../onec-debug-adapter`, если релиз недоступен.

Для разработки адаптера рядом с расширением:

```bash
cd ..
git clone https://github.com/yellow-hammer/onec-debug-adapter.git
cd onec-debug-adapter
dotnet publish onec-debug-adapter.csproj -c Release -o ../vscode-1c-platform-tools/bin/onec-debug-adapter
```

После этого вернитесь в репозиторий расширения, выполните `npm run compile` и запустите Extension Development Host.

## Документация

Обновляйте документацию вместе с изменением поведения:

- `README.md` — пользовательский обзор и быстрый старт.
- `CONTRIBUTING.md` — правила разработки.
- `docs/` — подробные технические материалы.
- `walkthrough/` — onboarding внутри VS Code.
- `resources/skills/` — инструкции для AI-агентов.

`CHANGELOG.md` формируется релизным процессом, вручную его обычно менять не нужно.

## Коммиты и Pull Request

Используйте [Conventional Commits](https://www.conventionalcommits.org/ru/v1.0.0/) на русском языке:

```txt
feat(metadata): добавить фильтр по подсистемам
fix(projects): исправить открытие проекта из пустого окна
docs(readme): обновить описание панелей
```

Перед PR:

1. Проверьте, что изменения сфокусированы на одной задаче.
2. Запустите `npm run lint`, `npm run compile` и `npm test`.
3. Обновите документацию, walkthrough или навыки, если менялось пользовательское поведение.
4. Заполните шаблон PR: что изменилось, как проверено, какие issues связаны.

Мейнтейнеры могут попросить доработки или дополнительные проверки.

## Вопросы и помощь

- [Discussions](https://github.com/yellow-hammer/vscode-1c-platform-tools/discussions)
- [Issues](https://github.com/yellow-hammer/vscode-1c-platform-tools/issues)
- Email: [i.karlo@outlook.com](mailto:i.karlo@outlook.com)

## Код поведения

Будьте вежливы, конструктивны и уважайте время других участников. Критика должна помогать улучшить проект.

## Лицензия

Внося вклад в проект, вы соглашаетесь с тем, что ваш вклад распространяется по [MIT License](LICENSE).
