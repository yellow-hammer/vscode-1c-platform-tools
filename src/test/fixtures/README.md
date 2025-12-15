# Фикстуры для тестирования

Эта директория содержит фикстуры для тестирования расширения 1C Platform Tools.

## Структура

```txt
fixtures/
├── workspace-templates/     # Шаблоны тестовых проектов 1С
│   ├── minimal-1c-project/  # Минимальный проект (Configuration.xml, env.json, etc.)
│   ├── full-1c-project/      # Полный проект с исходниками
│   └── empty-project/        # Пустой проект
├── mocks/                    # Моки для VS Code API
│   └── vscodeMocks.ts
└── helpers/                  # Утилиты для работы с фикстурами
    ├── testWorkspace.ts      # Создание и управление тестовыми workspace
    └── testContext.ts        # Создание тестового контекста расширения
```

## Использование

### Базовое использование

```typescript
import { createTestContext } from './fixtures/helpers/testContext';

suite('My Tests', () => {
    let testContext: Awaited<ReturnType<typeof createTestContext>>;

    suiteSetup(async () => {
        // Создаем workspace на основе шаблона
        testContext = await createTestContext({
            template: 'minimal-1c-project'
        });
    });

    suiteTeardown(async () => {
        // Очищаем временный workspace
        await testContext.cleanup();
    });

    test('test something', async () => {
        const workspacePath = testContext.workspacePath;
        // Используем workspacePath для тестов
    });
});
```

### Модификация файлов в шаблоне

```typescript
const context = await createTestContext({
    template: 'minimal-1c-project',
    modifyFiles: {
        'env.json': (content) => {
            const env = JSON.parse(content);
            env.default['--ibconnection'] = '/Fcustom/path';
            return JSON.stringify(env, null, 2);
        }
    }
});
```

### Добавление кастомных файлов

```typescript
const context = await createTestContext({
    template: 'minimal-1c-project',
    customFiles: {
        'custom-file.json': JSON.stringify({ test: true }, null, 2),
        'src/cf/CustomModule.bsl': 'Процедура Тест()\nКонецПроцедуры'
    }
});
```

### Использование моков VS Code API

```typescript
import { InputBoxMock, MessageMock } from './fixtures/mocks/vscodeMocks';
import * as vscode from 'vscode';

suite('Commands Tests', () => {
    let inputBoxMock: InputBoxMock;
    let messageMock: MessageMock;

    setup(() => {
        inputBoxMock = new InputBoxMock();
        messageMock = new MessageMock();

        // Подменяем VS Code API
        (vscode.window as any).showInputBox = inputBoxMock.showInputBox.bind(inputBoxMock);
        (vscode.window as any).showInformationMessage = messageMock.showInformationMessage.bind(messageMock);
    });

    test('command with input', async () => {
        inputBoxMock.setResponses(['ответ1', 'ответ2']);
        
        const result1 = await vscode.window.showInputBox({ prompt: 'Вопрос 1' });
        assert.strictEqual(result1, 'ответ1');
    });
});
```

### Чтение эталонных файлов из шаблонов

```typescript
import { readFixtureFile } from './fixtures/helpers/testWorkspace';

const envContent = await readFixtureFile('minimal-1c-project', 'env.json');
const env = JSON.parse(envContent);
```

## Доступные шаблоны

### minimal-1c-project

Минимальный проект 1С с базовыми файлами:

- `Configuration.xml` - конфигурация
- `env.json` - параметры окружения
- `.bsl-language-server.json` - настройки BSL
- `packagedef` - определение пакета

### full-1c-project

Полный проект с исходниками:

- Все файлы из `minimal-1c-project`
- `src/cf/TestModule.bsl` - пример модуля
- `src/cf/TestForm.xml` - пример формы
- Расширенный `env.json` с секциями для разных команд

### empty-project

Пустой проект без файлов (для тестов, где нужна чистая директория)

## Добавление новых шаблонов

1. Создайте директорию в `workspace-templates/`
2. Добавьте необходимые файлы проекта
3. Добавьте тип шаблона в `TestWorkspaceOptions` в `testWorkspace.ts`
4. Используйте новый шаблон в тестах

## Примечания

- Все тестовые workspace создаются во временной директории и автоматически удаляются после тестов
- Файлы копируются из шаблонов, поэтому можно безопасно модифицировать их в тестах
- Моки VS Code API должны быть установлены в `setup()` и очищены в `teardown()`
