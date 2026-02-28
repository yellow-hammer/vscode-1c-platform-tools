# Бинарники отладчика 1С (DAP)

Здесь должен находиться собранный [onec-debug-adapter](https://github.com/yellow-hammer/onec-debug-adapter) в подкаталоге `onec-debug-adapter/`.

Требуется .NET 8 SDK для сборки.

## Сборка

Из корня репозитория расширения выполните:

```bash
npm run build:onec-adapter
```

Скрипт клонирует репозиторий onec-debug-adapter в каталог `../onec-debug-adapter` (вне корня проекта, чтобы исходники не попадали в VSIX) и выполняет `dotnet publish` в `bin/onec-debug-adapter/`.

Либо вручную (клон вне проекта; подставьте свой путь к корню расширения):

```bash
git clone https://github.com/yellow-hammer/onec-debug-adapter.git ../onec-debug-adapter
cd ../onec-debug-adapter
dotnet publish -c Release -o <ПУТЬ_К_КОРНЮ_РАСШИРЕНИЯ>/bin/onec-debug-adapter
```

После сборки в `bin/onec-debug-adapter/` должны быть файлы `OnecDebugAdapter.dll` и зависимости.
