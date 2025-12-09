# VS Code Extension API - Справочник

Ссылки на документацию VS Code Extension API для индексации Cursor Agent.

## Основные ресурсы

- **API Reference**: <https://code.visualstudio.com/api/references/vscode-api>
- **Extension Guidelines**: <https://code.visualstudio.com/api/references/extension-guidelines>
- **Extension Manifest**: <https://code.visualstudio.com/api/references/extension-manifest>

## Специфические API

- **Tree View**: <https://code.visualstudio.com/api/extension-guides/tree-view>
- **Commands**: <https://code.visualstudio.com/api/extension-guides/command>
- **Workspace**: <https://code.visualstudio.com/api/extension-guides/workspace>
- **Window**: <https://code.visualstudio.com/api/extension-guides/window>

## Ключевые типы

```typescript
// ExtensionContext
interface ExtensionContext {
  subscriptions: Disposable[];
  workspaceState: Memento;
  extensionPath: string;
}

// TreeDataProvider
interface TreeDataProvider<T> {
  onDidChangeTreeData?: Event<T | undefined | null | void>;
  getTreeItem(element: T): TreeItem | Thenable<TreeItem>;
  getChildren(element?: T): ProviderResult<T[]>;
}

// TreeItem
class TreeItem {
  label: string | TreeItemLabel;
  collapsibleState: TreeItemCollapsibleState;
  command?: Command;
  iconPath?: string | Uri | { light: string | Uri; dark: string | Uri } | ThemeIcon;
}
```

## Локальная документация

Типы доступны через `@types/vscode` в `node_modules/@types/vscode/index.d.ts`.

## Правила для Cursor Agent

1. Всегда использовать типы из `@types/vscode`, не `any`
2. Команды регистрировать в `package.json` → `contributes.commands`
3. Подписки добавлять в `context.subscriptions`
4. Использовать `vscode.Uri` для путей файлов
5. Проверять `workspaceFolders` перед работой с файлами
6. Использовать `Thenable`, `ProviderResult` для TreeDataProvider
