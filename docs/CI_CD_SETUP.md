# Настройка CI/CD для проекта 1C: Platform tools

## Получение токенов для публикации

### VS Code Marketplace

1. Перейдите на [Azure DevOps](https://dev.azure.com/) и войдите (используйте тот же аккаунт, что и для VS Code Marketplace)
2. Откройте [Personal Access Tokens](https://dev.azure.com/_usersSettings/tokens)
3. Нажмите **+ New Token**
4. Заполните:
   - **Name**: любое имя (например, `VS Code Marketplace Publishing`)
   - **Organization**: выберите организацию или `All accessible organizations`
   - **Expiration**: срок действия (рекомендуется 1-2 года)
   - **Scopes**: выберите **Custom defined** → в разделе **Marketplace** выберите **Manage**
5. Нажмите **Create** и сразу скопируйте токен (он больше не будет показан)

### Open VSX Registry

1. Перейдите на [Open VSX Registry](https://open-vsx.org/) и войдите
2. Откройте [Access Tokens](https://open-vsx.org/user-settings/keys)
3. Нажмите **Create Token** или **Generate Token**
4. Заполните имя (например, `GitHub Actions Publishing`) и срок действия
5. Нажмите **Create** или **Generate** и сразу скопируйте токен

**Примечание**: Если namespace еще не создан, сначала создайте его в [Namespaces](https://open-vsx.org/user-settings/namespaces). Для верификации namespace создайте issue в [GitHub репозитории Open VSX](https://github.com/EclipseFdn/open-vsx.org) с запросом на ownership.

## Добавление токенов в GitHub

1. Откройте репозиторий на GitHub
2. Перейдите в **Settings** → **Secrets and variables** → **Actions**
3. Добавьте первый секрет:
   - Нажмите **New repository secret**
   - **Name**: `VSCE_PAT` (именно это имя)
   - **Secret**: вставьте токен для VS Code Marketplace
   - Нажмите **Add secret**
4. Добавьте второй секрет:
   - Нажмите **New repository secret**
   - **Name**: `OVSX_TOKEN` (именно это имя)
   - **Secret**: вставьте токен для Open VSX Registry
   - Нажмите **Add secret**

## Создание релиза

### Автоматически через тег

Создайте тег с версией (например, `v0.1.0`) и запушьте его:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Workflow автоматически:

- Обновит версию в `package.json`
- Сгенерирует `CHANGELOG.md`
- Создаст GitHub Release
- Опубликует в оба маркетплейса

### Вручную через workflow_dispatch

1. Перейдите в раздел **Actions** репозитория
2. Выберите workflow **Release**
3. Нажмите **Run workflow**
4. Заполните параметры:
   - **version** (обязательно): версия релиза, например `0.1.0` или `0.1.0-alpha.1`
   - **skip_publish**: пропустить публикацию в маркетплейсы (по умолчанию `false`)
   - **draft**: создать черновик релиза (по умолчанию `false`)
   - **prerelease**: создать предварительный релиз (по умолчанию `false`)
5. Нажмите **Run workflow**

**Примеры версий для prerelease:**

- `0.1.0-alpha.1` - первая alpha версия
- `0.1.0-beta.2` - вторая beta версия
- `0.1.0-rc.1` - первый release candidate
- `1.0.0-alpha` - alpha мажорного релиза

**Когда использовать:**

- **draft**: для предварительного просмотра релиза перед публикацией
- **prerelease**: для alpha, beta, rc версий, которые нужно опубликовать, но пометить как нестабильные
- **skip_publish**: если нужно только создать GitHub Release без публикации в маркетплейсы

## Важные замечания

- Используйте семантическое версионирование: `v0.1.0`, `v0.2.0`, `v1.0.0`
- Тег должен начинаться с `v` (например, `v0.1.0`)
- Для правильной генерации `CHANGELOG.md` используйте [Conventional Commits](https://www.conventionalcommits.org/ru/v1.0.0/)
- Версия в `package.json` обновляется автоматически при создании релиза
