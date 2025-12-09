# Архитектура расширения "1C Platform Tools"

## Обзор

Расширение VS Code для работы с проектами экосистемы 1С. Планируется TreeView в Activity Bar с разделами: задачи, зависимости, конфигурации, файлы. Текущая версия: 0.0.1 (начальная стадия).

## Структура проекта

```txt
src/
  extension.ts          # Точка входа (базовая реализация)
  test/                 # Тесты
resources/              # Иконки (1c-icon.svg, 1c-icon-light.svg)
docs/                   # Документация
out/                    # Скомпилированный код (генерируется)
```

## Компоненты

### Extension Entry Point (`src/extension.ts`)

**Текущее состояние**: Базовая реализация с тестовой командой `1c-platform-tools.helloWorld`.

**Планируется**:

- Создание `TreeViewProvider`
- Регистрация TreeView в Activity Bar
- Команды: `refresh`, `openSettings`

### Tree View Provider (планируется)

**Назначение**: Отображение иерархии проекта в TreeView.

**Структура дерева**:

```txt
1C Platform
├── Задачи (разбор обработок, отчетов, конфигураций, расширений)
├── Зависимости
├── Конфигурации запуска
└── Файлы конфигурации (bsl.json, bsl-project.json, build.gradle.kts, pom.xml)
```

**Реализация**: `TreeDataProvider<TreeItem>` с методами `getTreeItem()`, `getChildren()`, `refresh()`.

## Поток активации

1. VS Code вызывает `activate(context)`
2. Получение `workspaceFolders`
3. Создание `TreeViewProvider`
4. Регистрация TreeView и команд
5. Добавление подписок в `context.subscriptions`

## Типы и API

Все типы из `@types/vscode`:

- `ExtensionContext`, `TreeDataProvider<T>`, `TreeItem`, `Uri`, `Command`

## Конфигурация

- TypeScript: ES2022, Node16, strict mode
- ESLint: typescript-eslint
- Сборка: `tsc`, выход в `out/`
