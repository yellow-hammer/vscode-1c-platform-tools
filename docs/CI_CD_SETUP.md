# План настройки CI/CD для проекта 1C Platform Tools

## Обзор

Настроен автоматический процесс релиза и публикации расширения в VS Code Marketplace при создании тега в GitHub.

## Что нужно сделать

### Шаг 1: Получение Personal Access Token (PAT) для VS Code Marketplace

1. Перейдите на [Azure DevOps](https://dev.azure.com/)
2. Войдите в систему (используйте тот же аккаунт, что и для VS Code Marketplace)
3. Перейдите в **User Settings** → **Personal Access Tokens**
   - Или напрямую: [PAT](https://dev.azure.com/_usersSettings/tokens)
4. Нажмите **+ New Token**
5. Заполните форму:
   - **Name**: `VS Code Marketplace Publishing` (или любое другое имя)
   - **Organization**: выберите вашу организацию (или `All accessible organizations`)
   - **Expiration**: выберите срок действия (рекомендуется 1-2 года)
   - **Scopes**: выберите **Custom defined**
     - В разделе **Marketplace** выберите **Manage**
6. Нажмите **Create**
7. **ВАЖНО**: Скопируйте токен сразу, он больше не будет показан!

### Шаг 2: Добавление секрета в GitHub

1. Перейдите в ваш репозиторий на GitHub: `https://github.com/yellow-hammer/1c-platform-tools`
2. Откройте **Settings** → **Secrets and variables** → **Actions**
3. Нажмите **New repository secret**
4. Заполните:
   - **Name**: `VSCE_PAT` (именно это имя используется в workflow)
   - **Secret**: вставьте скопированный токен из шага 1
5. Нажмите **Add secret**

### Шаг 3: Проверка workflow файла

Убедитесь, что файл `.github/workflows/release.yml` создан и содержит правильную конфигурацию.

### Шаг 4: Создание первого релиза

#### Вариант A: Через GitHub веб-интерфейс

1. Перейдите в раздел **Releases** вашего репозитория
2. Нажмите **Create a new release**
3. Заполните:
   - **Choose a tag**: создайте новый тег (например, `v0.0.1`)
   - **Release title**: `v0.0.1` (или описание)
   - **Description**: описание изменений (опционально)
4. Нажмите **Publish release**
5. GitHub Actions автоматически запустит workflow

#### Вариант B: Через командную строку

```bash
# Убедитесь, что версия в package.json соответствует тегу
# Создайте тег
git tag v0.0.1

# Отправьте тег в репозиторий
git push origin v0.0.1
```

### Шаг 5: Мониторинг процесса

1. Перейдите в раздел **Actions** вашего репозитория
2. Найдите запущенный workflow **Release**
3. Откройте его для просмотра логов
4. Дождитесь завершения всех шагов

### Шаг 6: Проверка результата

1. **GitHub Release**: проверьте, что релиз создан в разделе **Releases**
2. **VS Code Marketplace**: через несколько минут проверьте страницу расширения:
   - [Страница](https://marketplace.visualstudio.com/manage/publishers/yellow-hammer)
   - Новая версия должна появиться автоматически

## Что делает workflow

1. **Checkout code** - получает код из репозитория
2. **Setup Node.js** - настраивает Node.js 18
3. **Install dependencies** - устанавливает зависимости (`npm ci`)
4. **Run linter** - проверяет код линтером
5. **Compile TypeScript** - компилирует TypeScript код
6. **Get version from tag** - извлекает версию из тега (убирает префикс `v`)
7. **Update package.json version** - обновляет версию в `package.json`
8. **Generate changelog** - генерирует changelog через git-cliff (если установлен)
9. **Package extension** - упаковывает расширение в `.vsix` файл
10. **Create GitHub Release** - создает релиз на GitHub с прикрепленным `.vsix` файлом
11. **Publish to VS Code Marketplace** - публикует расширение в Marketplace

## Формат тегов

Используйте семантическое версионирование с префиксом `v`:

- `v0.0.1` - первый релиз
- `v0.1.0` - минорное обновление
- `v1.0.0` - мажорный релиз
- `v1.0.1` - патч

## Важные замечания

1. **Версия в package.json**: перед созданием тега убедитесь, что версия в `package.json` соответствует версии тега (workflow автоматически обновит её)
2. **Conventional Commits**: для правильной генерации changelog используйте [Conventional Commits](https://www.conventionalcommits.org/ru/v1.0.0/)
3. **Первый релиз**: для первого релиза может потребоваться ручная публикация в Marketplace через `vsce publish` (только один раз)
4. **Права доступа**: убедитесь, что у токена есть права на публикацию в Marketplace

## Устранение проблем

### Ошибка "Invalid Personal Access Token"

- Проверьте, что токен скопирован полностью
- Убедитесь, что токен не истек
- Проверьте, что у токена есть права **Manage** в разделе **Marketplace**

### Ошибка "Extension not found"

- Убедитесь, что расширение уже опубликовано в Marketplace хотя бы один раз
- Для первого релиза может потребоваться ручная публикация

### Ошибка "Version already exists"

- Версия уже существует в Marketplace
- Используйте новую версию (увеличьте номер версии)

## Дополнительные улучшения (опционально)

### CI для Pull Requests

Можно добавить workflow для проверки кода на каждом PR:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run compile
      - run: npm test
```

### Автоматическое обновление версии

Можно настроить автоматическое обновление версии в `package.json` при создании тега (уже реализовано в workflow).

## Полезные ссылки

- [VS Code Extension Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [vsce CLI](https://github.com/microsoft/vscode-vsce)
- [GitHub Actions](https://docs.github.com/en/actions)
- [Conventional Commits](https://www.conventionalcommits.org/ru/v1.0.0/)
