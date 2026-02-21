# Паттерны работы с vrunner

Документация по использованию vrunner (vanessa-runner) в расширении 1C: Platform tools.

## Содержание

- [BaseCommand](#basecommand)
- [VRunnerManager](#vrunnermanager)
- [Выполнение команд](#выполнение-команд)
- [Работа с путями](#работа-с-путями)
- [Параметры подключения к ИБ](#параметры-подключения-к-иб)
- [Утилиты для команд](#утилиты-для-команд)
- [Константы](#константы)
- [Обработка ошибок](#обработка-ошибок)
- [Примеры использования](#примеры-использования)

## BaseCommand

`BaseCommand` - базовый класс для всех команд расширения. Предоставляет общие методы для проверки workspace и работы с файловой системой.

### Использование

Все классы команд наследуются от `BaseCommand`:

```typescript
import { BaseCommand } from './baseCommand';

export class ConfigurationCommands extends BaseCommand {
    async loadFromSrc(): Promise<void> {
        const workspaceRoot = this.ensureWorkspace();
        if (!workspaceRoot) {
            return;
        }
        // ...
    }
}
```

### Основные методы

- `ensureWorkspace()` - проверяет наличие workspace и показывает ошибку, если его нет
- `checkDirectoryExists(dirPath, errorMessage?)` - проверяет существование директории
- `getDirectories(dirPath, errorMessage?)` - получает список директорий в указанной папке
- `getFilesByExtension(dirPath, extension, errorMessage?)` - получает список файлов с указанным расширением
- `ensureDirectoryExists(dirPath, errorMessage?)` - создает директорию, если она не существует
- `addIbcmdIfNeeded(args)` - добавляет параметр `--ibcmd` к аргументам команды, если это необходимо
- `vrunner` - доступ к экземпляру VRunnerManager через `this.vrunner`

### Пример использования

```typescript
export class MyCommands extends BaseCommand {
    async myMethod(): Promise<void> {
        // Проверка workspace
        const workspaceRoot = this.ensureWorkspace();
        if (!workspaceRoot) {
            return;
        }

        // Проверка существования директории
        const dirPath = path.join(workspaceRoot, 'src', 'cf');
        if (!(await this.checkDirectoryExists(dirPath))) {
            return;
        }

        // Получение списка директорий
        const directories = await this.getDirectories(dirPath);
        
        // Получение файлов по расширению
        const cfFiles = await this.getFilesByExtension(dirPath, '.xml');

        // Использование vrunner
        const srcPath = this.vrunner.getCfPath();
    }
}
```

## VRunnerManager

`VRunnerManager` - синглтон для работы с vrunner. Используйте его для получения путей и выполнения команд.

### Получение экземпляра

```typescript
import { VRunnerManager } from '../vrunnerManager';

// В BaseCommand доступен через this.vrunner
// Или напрямую:
const vrunnerManager = VRunnerManager.getInstance(context);
```

### Основные методы

- `getVRunnerPath()` - получить путь к vrunner
- `getCfPath()` - получить путь к исходникам конфигурации
- `getOutPath()` - получить путь к папке результатов сборки (ранее `getBuildPath()`)
- `getEpfPath()` - получить путь к исходникам внешних обработок
- `getErfPath()` - получить путь к исходникам внешних отчетов
- `getCfePath()` - получить путь к исходникам расширений
- `getWorkspaceRoot()` - получить путь к workspace
- `getIbConnectionParam()` - получить параметр подключения к ИБ (возвращает массив)
- `getUseIbcmd()` - проверить, включена ли настройка использования ibcmd
- `executeVRunnerInTerminal()` - выполнить команду vrunner в терминале (автоматически обрабатывает аргументы)
- `executeVRunner()` - выполнить команду vrunner синхронно (для проверок)
- `executeOpmInTerminal()` - выполнить команду opm в терминале (автоматически обрабатывает аргументы)
- `executeOpm()` - выполнить команду opm синхронно (для проверок)
- `executeAllureInTerminal()` - выполнить команду allure в терминале (автоматически обрабатывает аргументы)
- `executeAllure()` - выполнить команду allure синхронно (для проверок)
- `executeOneScriptInTerminal()` - выполнить скрипт OneScript в терминале (автоматически обрабатывает аргументы)

## Выполнение команд

### Выполнение в терминале (рекомендуется)

Для большинства команд рекомендуется использовать `executeVRunnerInTerminal()`, который автоматически создает терминал и выполняет команду:

```typescript
export class ConfigurationCommands extends BaseCommand {
    async loadFromSrc(): Promise<void> {
        const workspaceRoot = this.ensureWorkspace();
        if (!workspaceRoot) {
            return;
        }

        const srcPath = this.vrunner.getCfPath();
        const ibConnectionParam = await this.vrunner.getIbConnectionParam();
        const args = ['update-dev', '--src', srcPath, ...ibConnectionParam];

        this.vrunner.executeVRunnerInTerminal(args, {
            cwd: workspaceRoot,
            name: 'Загрузка конфигурации'
        });
    }
}
```

### Синхронное выполнение (для проверок)

Для проверок и получения результата используйте `executeVRunner()`:

```typescript
const result = await this.vrunner.executeVRunner(['version']);

if (result.success) {
    vscode.window.showInformationMessage('Команда выполнена успешно');
    console.log(result.stdout);
} else {
    vscode.window.showErrorMessage(`Ошибка: ${result.stderr}`);
}
```

### Выполнение команд OPM

Метод `executeOpmInTerminal()` автоматически обрабатывает аргументы (преобразует абсолютные пути в относительные и нормализует для оболочки):

```typescript
// В терминале
this.vrunner.executeOpmInTerminal(['install', 'package-name'], {
    cwd: workspaceRoot,
    name: 'Установка зависимостей',
    shellType: 'powershell' // опционально, определяется автоматически
});

// Синхронно (для проверок)
const result = await this.vrunner.executeOpm(['list']);
```

### Выполнение команд Allure

Метод `executeAllureInTerminal()` автоматически обрабатывает аргументы и нормализует пути для указанной оболочки:

```typescript
// В терминале
this.vrunner.executeAllureInTerminal(['serve', 'allure-results'], {
    cwd: workspaceRoot,
    name: 'Allure отчет',
    shellType: 'bash' // опционально, определяется автоматически
});

// Синхронно (для проверок)
const result = await this.vrunner.executeAllure(['version']);
```

### Выполнение скриптов OneScript

```typescript
this.vrunner.executeOneScriptInTerminal('script.os', ['arg1', 'arg2'], {
    cwd: workspaceRoot,
    name: 'Выполнение скрипта'
});
```

## Работа с путями

### Путь к vrunner

`getVRunnerPath()` возвращает:

- Относительный путь `oscript_modules/bin/vrunner.bat`, если найден в workspace
- `vrunner`, если не найден (будет искаться в PATH)

```typescript
const vrunnerPath = vrunnerManager.getVRunnerPath();
// 'oscript_modules/bin/vrunner.bat' или 'vrunner'
```

### Путь к исходникам

```typescript
const srcPath = vrunnerManager.getCfPath();
// По умолчанию: 'src/cf'
// Можно изменить в настройках расширения
```

### Путь к результатам сборки

```typescript
const outPath = vrunnerManager.getOutPath();
// По умолчанию: 'out' (ранее 'build/out')
```

### Путь к внешним файлам

```typescript
const epfPath = vrunnerManager.getEpfPath(); // Внешние обработки
const erfPath = vrunnerManager.getErfPath(); // Внешние отчеты
```

## Параметры подключения к ИБ

### Получение параметра

`getIbConnectionParam()` читает параметр из `env.json` и возвращает массив параметров:

```typescript
// Асинхронный метод, возвращает массив ['--ibconnection', '/F./build/ib']
const ibConnectionParam = await this.vrunner.getIbConnectionParam();

// Использование с spread оператором
const args = ['update-dev', '--src', srcPath, ...ibConnectionParam];
```

### Структура env.json

```json
{
  "default": {
    "--ibconnection": "/F./build/ib"
  }
}
```

### Использование в командах

```typescript
const ibConnectionParam = await this.vrunner.getIbConnectionParam();
const args = [
    'update-dev',
    '--src', this.vrunner.getCfPath(),
    ...ibConnectionParam
];

this.vrunner.executeVRunnerInTerminal(args, {
    cwd: workspaceRoot
});
```

### Параметры настроек

Для получения параметра `--settings` используйте `getSettingsParam()`:

```typescript
const settingsParam = this.vrunner.getSettingsParam('env.json');
// Возвращает: ['--settings', 'env.json']
```

## Использование ibcmd

### Что такое ibcmd

`ibcmd` — это утилита командной строки платформы 1С:Предприятие, которая позволяет выполнять операции с конфигурацией (загрузка, выгрузка, сборка, разбор) без запуска графического интерфейса Конфигуратора. Использование `ibcmd` значительно ускоряет выполнение операций и удобно для автоматизации процессов разработки.

**Важно:** Для работы `ibcmd` необходимо, чтобы платформа 1С:Предприятие была установлена с флагом **"Сервер 1С: Предприятия 8"**. Если при установке платформы этот компонент не был выбран, `ibcmd` будет недоступен.

### Проверка настройки использования ibcmd

Метод `getUseIbcmd()` проверяет, включена ли настройка использования `ibcmd`:

```typescript
if (this.vrunner.getUseIbcmd()) {
    // Использовать ibcmd
    args.push('--ibcmd');
}
```

Настройка берется из VS Code (`1c-platform-tools.useIbcmd`). По умолчанию: `false`.

### Использование в командах

При выполнении команд с информационной базой проверяйте настройку и добавляйте параметр `--ibcmd`:

```typescript
const ibConnectionParam = await this.vrunner.getIbConnectionParam();
const args = ['update-dev', '--src', srcPath, ...ibConnectionParam];

if (this.vrunner.getUseIbcmd()) {
    args.push('--ibcmd');
}

this.vrunner.executeVRunnerInTerminal(args, {
    cwd: workspaceRoot,
    name: 'Загрузка конфигурации'
});
```

### Примеры использования

Команды, которые поддерживают `ibcmd`:

- Загрузка конфигурации из исходников (`init-dev`, `update-dev`)
- Загрузка конфигурации из файла (`load`)
- Выгрузка конфигурации в исходники (`dump`)
- Выгрузка конфигурации в файл (`dumpcf`)
- Сборка конфигурации (`compile`)
- Разбор конфигурации (`decompile`)
- Операции с расширениями (загрузка, выгрузка, сборка, разбор)
- Операции с информационными базами (создание, обновление, выгрузка/загрузка dt)

Все эти команды автоматически проверяют настройку `useIbcmd` и добавляют параметр `--ibcmd` при необходимости.

## Утилиты для команд

В модуле `src/utils/commandUtils.ts` находятся утилиты для работы с командами:

### escapeCommandArgs

Экранирует аргументы команды для безопасной передачи в терминал. Автоматически адаптируется под тип оболочки:

- **PowerShell**: использует одинарные кавычки, экранирует аргументы с пробелами, `$`, обратными кавычками `` ` `` или точкой с запятой `;`
- **cmd/bash**: использует двойные кавычки для аргументов с пробелами

```typescript
import { escapeCommandArgs } from '../utils/commandUtils';

// В cmd/bash
const args = ['--src', 'path with spaces'];
const escaped = escapeCommandArgs(args, 'cmd');
// Результат: '--src "path with spaces"'

// В PowerShell
const argsWithSemicolon = ['--command', 'command1;command2'];
const escapedPS = escapeCommandArgs(argsWithSemicolon, 'powershell');
// Результат: '--command '\''command1;command2'\'''
```

### buildCommand

Формирует команду для выполнения в терминале с учетом платформы:

```typescript
import { buildCommand } from '../utils/commandUtils';

const command = buildCommand('vrunner', ['--help']);
// На Windows: 'chcp 65001 >nul && vrunner --help'
// На других платформах: 'vrunner --help'
```

### joinCommands

Объединяет несколько команд через `&&`:

```typescript
import { joinCommands } from '../utils/commandUtils';

const commands = ['command1', 'command2', 'command3'];
const joined = joinCommands(commands);
// Результат: 'command1 && command2 && command3'
```

## Константы

В модуле `src/constants.ts` определены константы для работы с vanessa-runner:

```typescript
import { 
    VANESSA_RUNNER_ROOT, 
    VANESSA_RUNNER_EPF, 
    EPF_NAMES, 
    EPF_COMMANDS 
} from '../constants';

// Путь к корневой папке vanessa-runner
const runnerRoot = path.join(workspaceRoot, VANESSA_RUNNER_ROOT);

// Имена обработок
const closeEnterpriseEpf = EPF_NAMES.CLOSE_ENTERPRISE; // 'ЗакрытьПредприятие.epf'

// Команды для обработок
const updateCommand = EPF_COMMANDS.UPDATE_DATABASE;
const loadExtensionCommand = EPF_COMMANDS.LOAD_EXTENSION('/path/to/file.cfe');
```

## Обработка ошибок

### Проверка результата выполнения

```typescript
const result = await this.vrunner.executeVRunner(['compile', '--src', srcPath]);

if (!result.success) {
    vscode.window.showErrorMessage(
        `Ошибка выполнения команды: ${result.stderr || 'Неизвестная ошибка'}`
    );
    return;
}

// Команда выполнена успешно
vscode.window.showInformationMessage('Сборка завершена успешно');
```

### Логирование ошибок

```typescript
const result = await this.vrunner.executeVRunner(['update-dev', '--src', srcPath]);

if (!result.success) {
    console.error('VRunner execution failed:', {
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout
    });
    
    vscode.window.showErrorMessage(`Ошибка: ${result.stderr}`);
}
```

### Обработка ошибок в BaseCommand

Методы `BaseCommand` автоматически показывают ошибки пользователю:

```typescript
// checkDirectoryExists автоматически показывает ошибку, если директория не найдена
if (!(await this.checkDirectoryExists(dirPath))) {
    return; // Ошибка уже показана пользователю
}

// getDirectories возвращает пустой массив и показывает ошибку при проблемах
const directories = await this.getDirectories(dirPath);
if (directories.length === 0) {
    // Возможно, была ошибка - она уже показана пользователю
}
```

## Примеры использования

### Загрузка конфигурации из исходников

```typescript
import { BaseCommand } from './baseCommand';

export class ConfigurationCommands extends BaseCommand {
    public async loadFromSrc(mode: 'init' | 'update' = 'update'): Promise<void> {
        const workspaceRoot = this.ensureWorkspace();
        if (!workspaceRoot) {
            return;
        }

        const command = mode === 'init' ? 'init-dev' : 'update-dev';
        const srcPath = this.vrunner.getCfPath();
        const ibConnectionParam = await this.vrunner.getIbConnectionParam();
        const args = [command, '--src', srcPath, ...ibConnectionParam];

        this.vrunner.executeVRunnerInTerminal(args, {
            cwd: workspaceRoot,
            name: 'Загрузка конфигурации'
        });
    }
}
```

### Сборка конфигурации

```typescript
public async compile(): Promise<void> {
    const workspaceRoot = this.ensureWorkspace();
    if (!workspaceRoot) {
        return;
    }

    const srcPath = this.vrunner.getCfPath();
    const outPath = this.vrunner.getOutPath();
    const outputPath = path.join(outPath, '1Cv8.cf');
    const args = ['compile', '--src', srcPath, '--out', outputPath];

    this.vrunner.executeVRunnerInTerminal(args, {
        cwd: workspaceRoot,
        name: 'Сборка конфигурации'
    });
}
```

### Разбор конфигурации

```typescript
public async decompile(): Promise<void> {
    const workspaceRoot = this.ensureWorkspace();
    if (!workspaceRoot) {
        return;
    }

    const outPath = this.vrunner.getOutPath();
    const inputPath = path.join(outPath, '1Cv8.cf');
    const srcPath = this.vrunner.getCfPath();

    // Проверка существования файла
    if (!(await this.checkDirectoryExists(path.dirname(inputPath)))) {
        return;
    }

    const args = ['decompile', '--in', inputPath, '--out', srcPath];

    this.vrunner.executeVRunnerInTerminal(args, {
        cwd: workspaceRoot,
        name: 'Разбор конфигурации'
    });
}
```

### Работа с расширениями

Пример работы с расширениями с использованием общих методов для устранения дублирования:

```typescript
export class ExtensionsCommands extends BaseCommand {
    // Приватный метод для выполнения команд в терминале
    private executeCommandsInTerminal(
        commands: string[],
        terminalName: string,
        workspaceRoot: string,
        shellType: ReturnType<typeof detectShellType>
    ): void {
        const terminal = vscode.window.createTerminal({
            name: terminalName,
            cwd: workspaceRoot
        });
        terminal.sendText(joinCommands(commands, shellType));
        terminal.show();
    }

    // Приватный метод для получения списка расширений
    private async getExtensionFoldersFromSrc(workspaceRoot: string): Promise<string[] | undefined> {
        const cfePath = this.vrunner.getCfePath();
        const extensionsSrcPath = path.join(workspaceRoot, cfePath);

        if (!(await this.checkDirectoryExists(extensionsSrcPath))) {
            return undefined;
        }

        const extensionFolders = await this.getDirectories(extensionsSrcPath);
        if (extensionFolders.length === 0) {
            vscode.window.showInformationMessage(`В папке ${cfePath} не найдено расширений`);
            return undefined;
        }

        return extensionFolders;
    }

    async compile(): Promise<void> {
        const workspaceRoot = this.ensureWorkspace();
        if (!workspaceRoot) {
            return;
        }

        const extensionFolders = await this.getExtensionFoldersFromSrc(workspaceRoot);
        if (!extensionFolders) {
            return;
        }

        const outPath = this.vrunner.getOutPath();
        const vrunnerPath = this.vrunner.getVRunnerPath();
        const shellType = detectShellType();
        const cfePath = this.vrunner.getCfePath();

        const commands: string[] = [];
        for (const extensionFolder of extensionFolders) {
            const extensionFileName = `${extensionFolder}.cfe`;
            const srcPath = path.join(cfePath, extensionFolder);
            const outputPath = path.join(outPath, 'cfe', extensionFileName);
            const args = ['compileexttocfe', '--src', srcPath, '--out', outputPath];
            commands.push(buildCommand(vrunnerPath, args, shellType));
        }

        this.executeCommandsInTerminal(commands, 'Сборка расширений', workspaceRoot, shellType);
    }
}
```

## Использование addIbcmdIfNeeded

Метод `addIbcmdIfNeeded()` из `BaseCommand` автоматически добавляет параметр `--ibcmd` к аргументам команды, если это необходимо:

```typescript
const args = ['load', '--src', cfFilePath, ...ibConnectionParam];
const argsWithIbcmd = this.addIbcmdIfNeeded(args);
// Если ibcmd включен и команда поддерживает его, добавится '--ibcmd'
```

Это заменяет ручную проверку:

```typescript
// ❌ Старый способ (не использовать)
if (this.vrunner.getUseIbcmd() && this.vrunner.supportsIbcmd(args)) {
    args.push('--ibcmd');
}

// ✅ Новый способ
const args = this.addIbcmdIfNeeded(['load', '--src', cfFilePath, ...ibConnectionParam]);
```

## Лучшие практики

1. **Наследуйтесь от BaseCommand** для всех классов команд
2. **Используйте `this.ensureWorkspace()`** вместо ручной проверки workspace
3. **Используйте `this.vrunner`** вместо `VRunnerManager.getInstance()`
4. **Используйте `this.addIbcmdIfNeeded()`** для добавления параметра `--ibcmd` вместо ручной проверки
5. **Используйте `getOutPath()`** вместо устаревшего `getBuildPath()` для получения пути к результатам сборки
6. **Избегайте множественных `push()`** - используйте массивы и один вызов `push()` со spread оператором
7. **Используйте `executeVRunnerInTerminal()`** для команд, которые должны выполняться в терминале
8. **Используйте `executeVRunner()`** только для проверок и синхронных операций
9. **Используйте методы BaseCommand** для работы с файловой системой (`checkDirectoryExists`, `getDirectories`, `getFilesByExtension`)
10. **Обрабатывайте ошибки** - методы BaseCommand автоматически показывают ошибки пользователю
11. **Используйте относительные пути** для файлов внутри workspace (методы выполнения команд автоматически преобразуют абсолютные пути в относительные)
12. **Не беспокойтесь о нормализации путей** - методы `executeVRunnerInTerminal()`, `executeOpmInTerminal()`, `executeAllureInTerminal()` автоматически нормализуют пути для указанной оболочки
13. **Не беспокойтесь об экранировании аргументов** - утилиты `buildCommand()` и `escapeCommandArgs()` автоматически экранируют аргументы с учетом типа оболочки (включая точку с запятой в PowerShell)
14. **Логируйте ошибки** для отладки
15. **Используйте правильные параметры** для команд vrunner (см. документацию vrunner)
16. **Используйте spread оператор** для параметров подключения: `...ibConnectionParam`
17. **Выносите общую логику** в приватные методы классов команд (например, создание терминала, получение списка файлов)

## Дополнительные ресурсы

- [vanessa-runner документация](https://github.com/Pr-Mex/vanessa-runner)
- [VRunnerManager исходный код](../src/vrunnerManager.ts)
