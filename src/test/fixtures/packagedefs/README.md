# packagedef настоящих пакетов OneScript

Файлы `packagedef` из репозиториев пакетов как есть: на них проверяется разбор
описания пакета (`src/shared/packagedef.ts`).

| Файл | Репозиторий | Что в нём важно |
|------|-------------|-----------------|
| `fs.packagedef` | oscript-library/fs | только имя, версия и `ВключитьФайл` |
| `json.packagedef` | oscript-library/json | `lib.config` вместо `ОпределяетКласс` |
| `1testrunner.packagedef` | oscript-library/1testrunner | версия вычисляется сценарием, `ИсполняемыйФайл` с именем команды |
| `mutatos.packagedef` | oscript-library/mutatos | `ВерсияСреды`, обычные и `РазработкаЗависитОт` с версиями |
| `autumn.packagedef` | autumn-library/autumn | пакет и в `ЗависитОт`, и в `РазработкаЗависитОт`, `ОпределяетКласс`, `ОпределяетМодуль` |
| `oneunit.packagedef` | oscript-library/OneUnit | имя и версия вычисляются, `ИсполняемыйФайл` без имени команды |
| `gitsync.packagedef` | oscript-library/gitsync | `ВерсияСреды` из переменной, переменная с тем же именем |

Обновить файлы:

```bash
for repo in oscript-library/fs oscript-library/json oscript-library/1testrunner oscript-library/mutatos autumn-library/autumn oscript-library/OneUnit oscript-library/gitsync; do
  name=$(basename "$repo" | tr '[:upper:]' '[:lower:]')
  git clone --depth 1 "https://github.com/$repo" "/tmp/$name"
  cp "/tmp/$name/packagedef" "src/test/fixtures/packagedefs/$name.packagedef"
done
```
