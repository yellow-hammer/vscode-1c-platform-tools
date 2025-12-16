# План настройки CI/CD для проекта 1C Platform Tools

## Обзор

Настроен автоматический процесс релиза и публикации расширения в **VS Code Marketplace** и **Open VSX Registry** при создании тега в GitHub.

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

### Шаг 2: Создание и верификация Namespace в Open VSX Registry

1. Перейдите на [Open VSX Registry](https://open-vsx.org/)
2. Войдите в систему (или зарегистрируйтесь, если еще не зарегистрированы)
3. Перейдите в **User Settings** → **Namespaces**
   - Или напрямую: [Namespaces](https://open-vsx.org/user-settings/namespaces)
4. Нажмите **CREATE NAMESPACE** и создайте namespace `yellow-hammer` (или используйте существующий)
5. **ВАЖНО - Верификация Namespace**: После создания namespace он будет неверифицированным. Для верификации:
   - Перейдите на [GitHub репозиторий Open VSX](https://github.com/EclipseFdn/open-vsx.org)
   - Создайте новый issue с запросом на получение ownership namespace `yellow-hammer`
   - Укажите ваш GitHub username и подтвердите, что вы владелец этого namespace
   - После одобрения namespace станет верифицированным, и расширения будут отображаться с зеленой галочкой ✅

### Шаг 3: Получение Personal Access Token (PAT) для Open VSX Registry

1. Перейдите на [Open VSX Registry](https://open-vsx.org/)
2. Войдите в систему
3. Перейдите в **User Settings** → **Access Tokens**
   - Или напрямую: [Access Tokens](https://open-vsx.org/user-settings/keys)
4. Нажмите **Create Token** или **Generate Token**
5. Заполните форму (если требуется):
   - **Name**: `GitHub Actions Publishing` (или любое другое имя)
   - **Expiration**: выберите срок действия (рекомендуется 1-2 года)
6. Нажмите **Create** или **Generate**
7. **ВАЖНО**: Скопируйте токен сразу, он больше не будет показан!

### Шаг 4: Добавление секретов в GitHub

1. Перейдите в ваш репозиторий на GitHub: `https://github.com/yellow-hammer/1c-platform-tools`
2. Откройте **Settings** → **Secrets and variables** → **Actions**
3. Добавьте первый секрет для VS Code Marketplace:
   - Нажмите **New repository secret**
   - **Name**: `VSCE_PAT` (именно это имя используется в workflow)
   - **Secret**: вставьте токен из шага 1 (VS Code Marketplace)
   - Нажмите **Add secret**
4. Добавьте второй секрет для Open VSX Registry:
   - Нажмите **New repository secret**
   - **Name**: `OVSX_TOKEN` (именно это имя используется в workflow)
   - **Secret**: вставьте токен из шага 2 (Open VSX Registry)
   - Нажмите **Add secret**

### Шаг 5: Проверка workflow файла

Убедитесь, что файл `.github/workflows/release.yml` создан и содержит правильную конфигурацию.

### Шаг 6: Создание релиза

#### Вариант A: Через командную строку (рекомендуется)

```bash
# 1. Убедитесь, что все изменения закоммичены
git add .
git commit -m "feat: описание изменений"

# 2. Создайте тег с версией (например, v0.1.0)
git tag v0.1.0

# 3. Отправьте коммиты и тег в репозиторий
git push origin main
git push origin v0.1.0
```

**Важно**:

- Версия в `package.json` будет автоматически обновлена workflow при создании тега
- Используйте семантическое версионирование: `v0.1.0`, `v0.2.0`, `v1.0.0` и т.д.
- Тег должен начинаться с `v` (например, `v0.1.0`, а не `0.1.0`)

#### Вариант B: Через GitHub веб-интерфейс

1. Перейдите в раздел **Releases** вашего репозитория
2. Нажмите **Create a new release**
3. Заполните:
   - **Choose a tag**: создайте новый тег (например, `v0.1.0`)
   - **Release title**: `v0.1.0` (или описание)
   - **Description**: описание изменений (опционально, но будет перезаписано автоматически сгенерированным changelog)
4. Нажмите **Publish release**
5. GitHub Actions автоматически запустит workflow

**Примечание**: При создании релиза через веб-интерфейс описание будет автоматически заменено на сгенерированный changelog.

### Шаг 7: Мониторинг процесса

1. Перейдите в раздел **Actions** вашего репозитория
2. Найдите запущенный workflow **Release**
3. Откройте его для просмотра логов
4. Дождитесь завершения всех шагов

### Шаг 8: Проверка результата

1. **GitHub Release**: проверьте, что релиз создан в разделе **Releases**
2. **Open VSX Registry**: через несколько минут проверьте страницу расширения:
   - [Страница расширения](https://open-vsx.org/extension/yellow-hammer/1c-platform-tools)
   - Новая версия должна появиться автоматически
3. **VS Code Marketplace**: через несколько минут проверьте страницу расширения:
   - [Страница издателя](https://marketplace.visualstudio.com/manage/publishers/yellow-hammer)
   - Новая версия должна появиться автоматически

## Процесс публикации релиза

### Последовательность шагов

```txt
1. Создание тега (v0.1.0)
   ↓
2. Push тега в репозиторий
   ↓
3. Запуск GitHub Actions workflow
   ↓
4. Checkout кода (с полной историей)
   ↓
5. Установка Node.js 20 и зависимостей
   ↓
6. Проверка кода (lint) и компиляция
   ↓
7. Извлечение версии из тега
   ↓
8. Обновление версии в package.json
   ├─ Переключение на основную ветку (main/master)
   ├─ Обновление версии в package.json
   └─ Коммит изменений обратно в репозиторий
   ↓
9. ⭐ ГЕНЕРАЦИЯ CHANGELOG (git-cliff)
   ├─ Установка git-cliff (если нужно)
   ├─ Генерация CHANGELOG.md из коммитов
   └─ Сохранение в output переменную
   ↓
10. Упаковка расширения (.vsix)
   ↓
11. Создание GitHub Release
    ├─ Прикрепление .vsix файла
    └─ Использование changelog в описании
   ↓
12. Публикация в Open VSX Registry
    └─ Сохранение пути к .vsix файлу
   ↓
13. Публикация в VS Code Marketplace
    └─ Использование уже собранного .vsix файла
```

### Когда формируется changelog

**Changelog формируется на шаге 9**, после обновления версии в `package.json`, но **до** упаковки расширения.

**Детали процесса генерации:**

1. Workflow проверяет наличие `git-cliff` в системе
2. Если отсутствует, автоматически устанавливает через `cargo install git-cliff` (5-6 минут при первом запуске)
3. Запускает `git-cliff -o CHANGELOG.md` для генерации changelog на основе коммитов между тегами
4. Читает содержимое `CHANGELOG.md` и сохраняет в output переменную `changelog`
5. Использует этот changelog в описании GitHub Release (шаг 11)

**Важно**:

- Для правильной генерации changelog используйте [Conventional Commits](https://www.conventionalcommits.org/ru/v1.0.0/)
- Changelog генерируется на основе всех коммитов между тегами
- Файл `CHANGELOG.md` создается временно в процессе workflow и не коммитится в репозиторий
- Если генерация changelog не удалась (например, git-cliff не установился), используется fallback с ссылкой на историю коммитов

## Что делает workflow

1. **Checkout code** - получает код из репозитория (с полной историей для git-cliff)
2. **Setup Node.js** - настраивает Node.js 20
3. **Install dependencies** - устанавливает зависимости (`npm ci`)
4. **Run linter** - проверяет код линтером (`npm run lint`)
5. **Compile TypeScript** - компилирует TypeScript код (`npm run compile`)
6. **Get version from tag** - извлекает версию из тега (убирает префикс `v`, например `v0.1.0` → `0.1.0`)
7. **Switch to main branch and update version** - переключается на основную ветку, обновляет версию в `package.json` с помощью `npm version` и коммитит изменения обратно в репозиторий
8. **Generate changelog** - генерирует changelog через `git-cliff`:
   - Автоматически устанавливает `git-cliff` через `cargo install git-cliff` (если не установлен)
   - Генерирует `CHANGELOG.md` на основе коммитов в формате Conventional Commits
   - Сохраняет changelog в output для использования в GitHub Release
   - Если установка не удалась, используется fallback с ссылкой на историю коммитов
9. **Package extension** - упаковывает расширение в `.vsix` файл (`npm run package` → `vsce package`) с уже обновленной версией
10. **Create GitHub Release** - создает релиз на GitHub:
    - Прикрепляет `.vsix` файл
    - Использует сгенерированный changelog в описании релиза
    - Автоматически публикует (не draft)
11. **Publish to Open VSX Registry** - публикует расширение в Open VSX Registry через `HaaLeo/publish-vscode-extension@v1`:
    - Использует токен из секрета `OVSX_TOKEN`
    - Пропускает дубликаты версий (`skipDuplicate: true`)
    - Сохраняет путь к `.vsix` файлу для следующего шага
12. **Publish to Visual Studio Marketplace** - публикует расширение в VS Code Marketplace через `HaaLeo/publish-vscode-extension@v1`:
    - Использует токен из секрета `VSCE_PAT`
    - Использует уже собранный `.vsix` файл из предыдущего шага (не пересобирает)
    - Пропускает дубликаты версий (`skipDuplicate: true`)

## Формат тегов

Используйте семантическое версионирование с префиксом `v`:

- `v0.0.1` - первый релиз
- `v0.1.0` - минорное обновление
- `v1.0.0` - мажорный релиз
- `v1.0.1` - патч

## Важные замечания

1. **Версия в package.json**: workflow автоматически обновляет версию в `package.json` на основе тега и коммитит изменения обратно в репозиторий, поэтому не нужно обновлять её вручную перед созданием тега
2. **Conventional Commits**: для правильной генерации changelog используйте [Conventional Commits](https://www.conventionalcommits.org/ru/v1.0.0/):
   - `feat:` - новая функциональность
   - `fix:` - исправление ошибок
   - `docs:` - изменения в документации
   - `refactor:` - рефакторинг кода
   - `test:` - добавление тестов
   - `chore:` - обновление зависимостей, конфигурации и т.д.
3. **Первый релиз**: для первого релиза может потребоваться ручная публикация в Marketplace и Open VSX Registry через `vsce publish` (только один раз для каждого реестра)
4. **Права доступа**: 
   - Для VS Code Marketplace: убедитесь, что у токена есть права **Manage** в разделе **Marketplace**
   - Для Open VSX Registry: токен должен иметь права на публикацию расширений
5. **Установка git-cliff**: при первом запуске workflow автоматически установит `git-cliff` через cargo, что может занять 5-6 минут. Последующие запуски будут быстрее, так как git-cliff будет уже установлен
6. **Changelog**: changelog генерируется автоматически на основе коммитов между тегами и используется в описании GitHub Release
7. **Двойная публикация**: расширение публикуется одновременно в Open VSX Registry и VS Code Marketplace. Оба реестра используют один и тот же `.vsix` файл, что гарантирует идентичность версий
8. **Верификация Namespace в Open VSX**: После создания namespace в Open VSX Registry он будет неверифицированным. Для верификации нужно создать issue в [GitHub репозитории Open VSX](https://github.com/EclipseFdn/open-vsx.org) с запросом на ownership. Неверифицированные расширения публикуются успешно, но отображаются с предупреждающим значком ⚠️. Подробнее: [Namespace Access Documentation](https://github.com/eclipse/openvsx/wiki/Namespace-Access)

## Устранение проблем

### Ошибка "Invalid Personal Access Token" (VS Code Marketplace)

- Проверьте, что токен `VSCE_PAT` скопирован полностью
- Убедитесь, что токен не истек
- Проверьте, что у токена есть права **Manage** в разделе **Marketplace** в Azure DevOps

### Ошибка "Invalid Personal Access Token" (Open VSX Registry)

- Проверьте, что токен `OVSX_TOKEN` скопирован полностью
- Убедитесь, что токен не истек
- Проверьте, что токен создан на странице [Open VSX Access Tokens](https://open-vsx.org/user-settings/keys)

### Ошибка "Extension not found"

- Убедитесь, что расширение уже опубликовано в Marketplace/Open VSX хотя бы один раз
- Для первого релиза может потребоваться ручная публикация в каждый реестр

### Ошибка "Version already exists"

- Версия уже существует в реестре (Marketplace или Open VSX)
- Используйте новую версию (увеличьте номер версии)
- Workflow автоматически пропускает дубликаты (`skipDuplicate: true`), но лучше использовать уникальные версии

### Ошибка "Unknown publisher" (Open VSX Registry)

- **Причина**: Namespace (издатель) еще не создан в Open VSX Registry
- **Решение**: 
  1. Перейдите на [Open VSX Registry](https://open-vsx.org/)
  2. Войдите в систему
  3. Перейдите в **User Settings** → **Namespaces**: [Namespaces](https://open-vsx.org/user-settings/namespaces)
  4. Нажмите **CREATE NAMESPACE** и создайте namespace `yellow-hammer`
  5. После создания namespace последующие публикации будут работать автоматически

### Предупреждение "Namespace is not verified" (Open VSX Registry)

- **Причина**: Namespace создан, но не верифицирован (не заявлены права на ownership)
- **Последствия**: Расширения будут публиковаться, но будут отображаться с предупреждающим значком ⚠️ вместо зеленой галочки ✅
- **Решение - Верификация Namespace**:
  1. Перейдите на [GitHub репозиторий Open VSX](https://github.com/EclipseFdn/open-vsx.org)
  2. Создайте новый issue с запросом на получение ownership namespace `yellow-hammer`
  3. Укажите ваш GitHub username и подтвердите, что вы владелец этого namespace
  4. Подробная инструкция: [Namespace Access Documentation](https://github.com/eclipse/openvsx/wiki/Namespace-Access)
  5. После одобрения issue namespace станет верифицированным, и все расширения будут отображаться как проверенные

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
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run compile
      - run: npm test
```

### Автоматическое обновление версии

Автоматическое обновление версии в `package.json` при создании тега уже реализовано в workflow на шаге "Update package.json version". Версия извлекается из тега (убирается префикс `v`) и обновляется в `package.json` с помощью `npm version --no-git-tag-version`.

## Полезные ссылки

- [VS Code Extension Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Open VSX Registry](https://open-vsx.org/)
- [Open VSX Publishing Guide](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions)
- [Azure DevOps Personal Access Tokens](https://dev.azure.com/_usersSettings/tokens)
- [Open VSX Access Tokens](https://open-vsx.org/user-settings/keys)
- [vsce CLI](https://github.com/microsoft/vscode-vsce)
- [GitHub Actions](https://docs.github.com/en/actions)
- [Conventional Commits](https://www.conventionalcommits.org/ru/v1.0.0/)
