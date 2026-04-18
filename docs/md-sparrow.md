# Панель «Метаданные 1С» в 1C: Platform Tools

Этот документ описывает только интеграцию в расширении `1c-platform-tools`.
Внутреннее устройство `md-sparrow` (Md Classes, XML-контракт библиотеки, структура CLI и т.п.) относится к репозиторию библиотеки и его документации.

## Что делает расширение

- показывает дерево метаданных по `src/cf`, `src/cfe`, `src/erf`, `src/epf`;
- выполняет операции из UI: обновление дерева, создание объектов, редактирование свойств, мутации дочерних узлов;
- вызывает `md-sparrow` как отдельный подпроцесс `java -jar ...`.

Программный доступ к последнему дереву: команда `1c-platform-tools.metadata.getProjectTree`.

## Первый запуск

1. Убедитесь, что в корне проекта есть `packagedef`.
2. Откройте активность **«Метаданные 1С»**.
3. При настройках по умолчанию расширение автоматически:
   - скачает portable JRE 21;
   - скачает `md-sparrow-*-all.jar` из последнего стабильного релиза `yellow-hammer/md-sparrow`.

Если нужна локальная сборка, задайте `1c-platform-tools.metadata.jarFile` (абсолютный путь к `md-sparrow-*-all.jar`).

## Настройки интеграции

Ключи `1c-platform-tools.metadata.*`:

- `autoloadJar`
- `autoloadJre`
- `jarFile`
- `javaExecutable`

При нехватке лимита GitHub API можно задать переменную окружения `PLATFORM_TOOLS_MD_SPARROW_GITHUB_TOKEN`.

## Где документация Md Classes / md-sparrow

- Репозиторий и релизы: [md-sparrow](https://github.com/yellow-hammer/md-sparrow)
- Детали библиотечного CLI и формата данных: документация в репозитории `md-sparrow`
- Webview-контракт свойств в рамках `1cpt`: [metadata-properties.md](metadata-properties.md)
