# VS Code API - Паттерны использования

Документация по использованию VS Code API в расширении 1C Platform Tools.

## Содержание

- [Работа с workspace](#работа-с-workspace)
- [Уведомления пользователю](#уведомления-пользователю)
- [Команды](#команды)
- [Терминалы](#терминалы)
- [TreeView](#treeview)
- [Конфигурация](#конфигурация)
- [Контекст](#контекст)
- [Файловая система](#файловая-система)

## Работа с workspace

### Проверка workspace

Всегда проверяйте наличие workspace перед работой с файлами:

```typescript
const workspaceFolders = vscode.workspace.workspaceFolders;
if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('Не открыта рабочая область');
    return;
}

const workspaceRoot = workspaceFolders[0].uri.fsPath;
```

### Получение пути к файлу

Используйте `vscode.Uri` для работы с путями:

```typescript
import * as path from 'node:path';

const workspaceRoot = workspaceFolders[0].uri.fsPath;
const filePath = path.join(workspaceRoot, 'src', 'cf', 'Configuration.xml');
const fileUri = vscode.Uri.file(filePath);
```

### Относительные пути

Предпочитайте относительные пути для файлов внутри workspace:

```typescript
// ✅ Хорошо - относительный путь
const relativePath = path.join('oscript_modules', 'bin', 'vrunner.bat');

// ❌ Плохо - абсолютный путь
const absolutePath = path.join(workspaceRoot, 'oscript_modules', 'bin', 'vrunner.bat');
```

## Уведомления пользователю

### Информационные сообщения

```typescript
vscode.window.showInformationMessage('Операция выполнена успешно');
```

### Сообщения с действиями

```typescript
const action = await vscode.window.showInformationMessage(
    'Файл изменен. Перезагрузить?',
    'Да',
    'Нет'
);

if (action === 'Да') {
    // Выполнить действие
}
```

### Предупреждения и ошибки

```typescript
vscode.window.showWarningMessage('Предупреждение: операция может занять время');
vscode.window.showErrorMessage('Ошибка: не удалось выполнить операцию');
```

### Выбор из списка

```typescript
const items = [
    { label: 'Конфигурация', value: 'cf' },
    { label: 'Расширение', value: 'cfe' },
];

const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Выберите тип файла'
});

if (selected) {
    console.log(selected.value);
}
```

### Ввод текста

```typescript
const input = await vscode.window.showInputBox({
    prompt: 'Введите имя файла',
    placeHolder: 'Configuration.xml',
    validateInput: (value) => {
        if (!value) {
            return 'Имя файла не может быть пустым';
        }
        return null;
    }
});

if (input) {
    // Использовать введенное значение
}
```

## Команды

### Регистрация команды

```typescript
const command = vscode.commands.registerCommand('1c-platform-tools.myCommand', () => {
    // Логика команды
});

context.subscriptions.push(command);
```

### Выполнение команды

```typescript
// Выполнить другую команду
await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:yellow-hammer.1c-platform-tools');

// Установить контекст
await vscode.commands.executeCommand('setContext', '1c-platform-tools.is1CProject', true);
```

### Команды с параметрами

```typescript
vscode.commands.registerCommand('1c-platform-tools.command', (uri?: vscode.Uri) => {
    if (uri) {
        // Работа с переданным URI
    }
});
```

## Терминалы

### Создание терминала

```typescript
const terminal = vscode.window.createTerminal({
    name: '1C Platform Tools',
    cwd: workspaceRoot
});

terminal.sendText('vrunner --help');
terminal.show();
```

### Использование активного терминала

```typescript
const terminal = vscode.window.activeTerminal || vscode.window.createTerminal();
terminal.sendText('command');
```

### Выполнение команды через child_process

Для выполнения команд vrunner используйте `child_process.exec`:

```typescript
import { exec } from 'node:child_process';

exec('vrunner --help', { cwd: workspaceRoot }, (error, stdout, stderr) => {
    if (error) {
        vscode.window.showErrorMessage(`Ошибка: ${error.message}`);
        return;
    }
    console.log(stdout);
});
```

**Важно**: При формировании команд для терминала используйте утилиты из `commandUtils.ts` (`buildCommand`, `escapeCommandArgs`), которые автоматически экранируют аргументы с учетом типа оболочки. Это особенно важно для PowerShell, где точка с запятой `;` является разделителем команд.

## TreeView

### Создание TreeView

```typescript
const treeDataProvider = new PlatformTreeDataProvider(context.extensionUri);
const treeView = vscode.window.createTreeView('1c-platform-tools', {
    treeDataProvider: treeDataProvider,
    showCollapseAll: true,
});

context.subscriptions.push(treeView);
```

### Реализация TreeDataProvider

```typescript
export class PlatformTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = 
        new vscode.EventEmitter<TreeItem | undefined | null | void>();
    
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeItem): Thenable<TreeItem[]> {
        // Возвратить элементы дерева
    }
}
```

## Конфигурация

### Получение настроек

```typescript
const config = vscode.workspace.getConfiguration('1c-platform-tools');
const srcPath = config.get<string>('paths.src', 'src/cf'); // значение по умолчанию
```

### Чтение настроек с проверкой

```typescript
const config = vscode.workspace.getConfiguration('1c-platform-tools');
const vrunnerPath = config.get<string>('vrunner.path', 'vrunner');

if (!vrunnerPath) {
    vscode.window.showErrorMessage('Не указан путь к vrunner');
    return;
}
```

### Обновление настроек

```typescript
const config = vscode.workspace.getConfiguration('1c-platform-tools');
await config.update('paths.src', 'src/cf', vscode.ConfigurationTarget.Workspace);
```

## Контекст

### Установка контекста

Контекст используется для условного отображения элементов UI:

```typescript
// В extension.ts при активации
await vscode.commands.executeCommand('setContext', '1c-platform-tools.is1CProject', true);

// В package.json для условного отображения
"when": "1c-platform-tools.is1CProject == true"
```

### Проверка контекста

```typescript
const contextValue = await vscode.commands.executeCommand('getContext', '1c-platform-tools.is1CProject');
```

## Файловая система

### Чтение файлов

```typescript
import * as fs from 'node:fs/promises';

try {
    const content = await fs.readFile(filePath, 'utf-8');
    // Работа с содержимым
} catch (error) {
    vscode.window.showErrorMessage(`Не удалось прочитать файл: ${error}`);
}
```

### Запись файлов

```typescript
import * as fs from 'node:fs/promises';

try {
    await fs.writeFile(filePath, content, 'utf-8');
    vscode.window.showInformationMessage('Файл сохранен');
} catch (error) {
    vscode.window.showErrorMessage(`Не удалось сохранить файл: ${error}`);
}
```

### Проверка существования файла

```typescript
import * as fs from 'node:fs/promises';

try {
    await fs.access(filePath);
    // Файл существует
} catch {
    // Файл не существует
}
```

### Работа с директориями

```typescript
import * as fs from 'node:fs/promises';

// Создать директорию
await fs.mkdir(dirPath, { recursive: true });

// Прочитать содержимое директории
const entries = await fs.readdir(dirPath);

// Проверить, является ли путь директорией
const stats = await fs.stat(path);
const isDirectory = stats.isDirectory();
```

## BaseCommand

Для всех команд расширения рекомендуется использовать базовый класс `BaseCommand`, который предоставляет общие методы:

```typescript
import { BaseCommand } from './baseCommand';

export class MyCommands extends BaseCommand {
    async myMethod(): Promise<void> {
        // Автоматическая проверка workspace
        const workspaceRoot = this.ensureWorkspace();
        if (!workspaceRoot) {
            return; // Ошибка уже показана пользователю
        }

        // Доступ к VRunnerManager
        const srcPath = this.vrunner.getCfPath();
    }
}
```

Подробнее о `BaseCommand` см. в [документации по vrunner](vrunner-patterns.md#basecommand).

## Лучшие практики

1. **Используйте BaseCommand** для всех классов команд
2. **Всегда проверяйте workspace** перед работой с файлами (или используйте `this.ensureWorkspace()`)
3. **Используйте асинхронные операции** для работы с файловой системой
4. **Обрабатывайте ошибки** и показывайте понятные сообщения пользователю
5. **Используйте относительные пути** для файлов внутри workspace
6. **Регистрируйте все подписки** в `context.subscriptions` для автоматической очистки
7. **Используйте `vscode.Uri`** для работы с путями вместо строк
8. **Кэшируйте результаты** конфигурации и других операций, где это возможно

## Дополнительные ресурсы

- [VS Code Extension API](https://code.visualstudio.com/api/references/vscode-api)
- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [Extension Samples](https://github.com/microsoft/vscode-extension-samples)
