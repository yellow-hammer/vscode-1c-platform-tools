# Руководство для контрибьютеров

Спасибо за интерес к **1C: Platform Tools**. Проект развивается как расширение VS Code для повседневной разработки 1С: команды vanessa-runner, панели проектов и артефактов, дерево метаданных, TODO, отладка и интеграция с AI/MCP.

## Как помочь

- Сообщить об ошибке через [bug report](.github/ISSUE_TEMPLATE/bug_report.md).
- Предложить функцию через [feature request](.github/ISSUE_TEMPLATE/feature_request.md).
- Исправить баг, добавить тесты, улучшить фичу или документацию.
- Помочь проверить работу на разных версиях платформы 1С, ОС и сценариях запуска.

Проблемы безопасности отправляйте по правилам из [SECURITY.md](SECURITY.md), не через публичные Issues.

## Окружение разработки

- Node.js `20.x` или новее, VS Code `1.103.0` или новее, Git.
- Для ручной проверки команд 1С: платформа 1С:Предприятие, OneScript, OPM и vanessa-runner.
- Для отладки 1С: [.NET 8](https://dotnet.microsoft.com/download/dotnet/8.0).
- Для дерева метаданных: JDK/JRE 21; при настройках по умолчанию расширение скачивает portable JRE само.

Рабочий цикл: `npm ci` → `F5` (Extension Development Host) → в новом окне открыть проект 1С с `packagedef`. Скрипты сборки и тестов — в `package.json` и задачах VS Code.

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
│   ├── metadata/                # дерево метаданных, свойства объектов, ER
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
- Для VS Code API и команд vrunner ориентируйтесь на существующие паттерны в коде: `BaseCommand`, `VRunnerManager`.
- Не используйте `console.log`/`console.error` в production-коде; используйте `logger` (скоуп на модуль: `logger.scope('компонент')`).
- Комментарии в коде и сообщения пользователю пишите на русском.
- UI-тексты должны быть короткими и полезными: без внутренних терминов, планов реализации и длинных пояснений.
- Не добавляйте legacy/fallback-совместимость без явной необходимости.
- XML метаданных не правьте вручную из TypeScript; операции с метаданными должны идти через md-sparrow.

## Команды и настройки

- Новые команды добавляйте в `package.json`, `src/features/tools/commandNames.ts` и нужный доменный модуль.
- Если команда должна быть в дереве **Инструменты 1С**, добавьте её в `TREE_GROUPS`.
- Для новых панелей добавляйте view/container в `package.json`, runtime-регистрацию в соответствующей feature-папке и flow в `src/app`.
- Кнопка **Настройки** в панели должна открывать релевантный раздел настроек.
- Все настройки расширения должны открываться с фильтром `@ext:yellow-hammer.1c-platform-tools`.

## Внешние компоненты

Два компонента живут в отдельных репозиториях и не бандлятся в VSIX — расширение скачивает их с GitHub Releases в рантайме. Для разработки самого компонента соберите его локально и укажите путь в настройках:

| Компонент             | Репозиторий                                                               | Локальная сборка          | Настройки (раздел «Внешние компоненты»)                                                                                 |
|-----------------------|---------------------------------------------------------------------------|---------------------------|-------------------------------------------------------------------------------------------------------------------------|
| Адаптер отладки (DAP) | [onec-debug-adapter](https://github.com/yellow-hammer/onec-debug-adapter) | `dotnet build -c Release` | `1c-platform-tools.components.adapterFile` — путь к `OnecDebugAdapter.dll`, `components.adapterAutoload: false`         |
| Дерево метаданных     | [md-sparrow](https://github.com/yellow-hammer/md-sparrow)                 | `gradlew shadowJar`       | `1c-platform-tools.components.metadataJarFile` — путь к `md-sparrow-*-all.jar`, `components.metadataJarAutoload: false` |

После изменения компонента достаточно пересобрать его и перезапустить сессию отладки (адаптер) или обновить дерево (md-sparrow) — переустановка расширения не нужна.

## Коммиты и Pull Request

Используйте [Conventional Commits](https://www.conventionalcommits.org/ru/v1.0.0/) на русском языке:

```txt
feat(metadata): добавить фильтр по подсистемам
fix(projects): исправить открытие проекта из пустого окна
docs(readme): обновить описание панелей
```

Перед PR:

1. Проверьте, что изменения сфокусированы на одной задаче.
2. Запустите `npm run lint`, `npm run compile` и `npm test`; для изменённых фич добавьте или обновите тесты в `src/test/`.
3. Обновите документацию (`README.md`, `docs/`, walkthrough, навыки), если менялось пользовательское поведение. `CHANGELOG.md` формируется релизным процессом — вручную его менять не нужно.
4. Заполните шаблон PR: что изменилось, как проверено, какие issues связаны.

Мейнтейнеры могут попросить доработки или дополнительные проверки.

## Релизы

Релиз выпускается тегом `vX.Y.Z` (`git tag v0.1.0 && git push origin v0.1.0`) или вручную: **Actions** → workflow **Release** → **Run workflow** (параметры: `version`, `skip_publish`, `draft`, `prerelease`). Workflow обновит версию в `package.json`, сгенерирует `CHANGELOG.md` из Conventional Commits, создаст GitHub Release и опубликует расширение в маркетплейсы.

Для публикации в секретах репозитория (**Settings** → **Secrets and variables** → **Actions**) должны быть заданы токены:

- `VSCE_PAT` — VS Code Marketplace: [Azure DevOps](https://dev.azure.com/) → Personal Access Tokens → New Token → Scopes: **Custom defined** → **Marketplace: Manage**;
- `OVSX_TOKEN` — Open VSX Registry: [open-vsx.org](https://open-vsx.org/) → [Access Tokens](https://open-vsx.org/user-settings/keys) → Generate Token (если namespace не создан — сначала создайте его в Namespaces и запросите ownership через issue в [EclipseFdn/open-vsx.org](https://github.com/EclipseFdn/open-vsx.org)).

## Вопросы и помощь

- [Discussions](https://github.com/yellow-hammer/vscode-1c-platform-tools/discussions)
- [Issues](https://github.com/yellow-hammer/vscode-1c-platform-tools/issues)
- Email: [i.karlo@outlook.com](mailto:i.karlo@outlook.com)

## Код поведения

Будьте вежливы, конструктивны и уважайте время других участников. Критика должна помогать улучшить проект.

## Лицензия

Внося вклад в проект, вы соглашаетесь с тем, что ваш вклад распространяется по [MIT License](LICENSE).
