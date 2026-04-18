# Свойства объектов метаданных (cf-md-object)

Расширение открывает webview **«Свойства объекта»** для узлов дерева метаданных с известным путём к XML и поддерживаемым `kind`: **справочник**, **константа**, **перечисление**, **документ**, **отчёт**, **обработка**, **задача**, **план счетов**, **план видов характеристик**, **план видов расчёта**, **общий модуль**, **подсистема**, **параметр сеанса**, **план обмена**, **общий реквизит**, **общая картинка**, **нумератор документов**, **внешний источник данных**, **роль**. Данные читаются и записываются только через подпроцесс **md-sparrow** (JAXB), без правки XML в TypeScript.

## CLI (md-sparrow)

| Команда                                      | Назначение           |
|----------------------------------------------|----------------------|
| `cf-md-object-get <путь.xml> -v V2_20/V2_21` | stdout: один JSON    |
| `cf-md-object-set <путь.xml> <json> -v …`    | запись из файла JSON |

### CRUD дочерних узлов объекта

Для операций из дерева метаданных используются отдельные CLI-команды md-sparrow:

| Команда                                               | Назначение                |
|-------------------------------------------------------|---------------------------|
| `cf-md-attribute-add/rename/delete/duplicate`         | Реквизиты объекта         |
| `cf-md-tabular-section-add/rename/delete/duplicate`   | Табличные части объекта   |
| `cf-md-tabular-attribute-add/rename/delete/duplicate` | Реквизиты табличной части |

## Поля JSON (`MdObjectPropertiesDto`)

Общие поля:

- `kind`: `"catalog"` \| `"constant"` \| `"enum"` \| `"document"` \| `"report"` \| `"dataProcessor"` \| `"task"` \| `"chartOfAccounts"` \| `"chartOfCharacteristicTypes"` \| `"chartOfCalculationTypes"` \| `"commonModule"` \| `"subsystem"` \| `"sessionParameter"` \| `"exchangePlan"` \| `"commonAttribute"` \| `"commonPicture"` \| `"documentNumerator"` \| `"externalDataSource"` \| `"role"`
- `internalName`: имя объекта (как в XML; при сохранении должно совпадать с именем файла без `.xml`)
- `synonymRu`, `comment`: строки; для `catalog` / `document` / `exchangePlan` синоним ru синхронизируется с представлениями так же, как в узком сценарии `cf-catalog-form-get/set`

## Матрица поддерживаемых типов

| objectType (дерево)          | kind (DTO)                   | containerLocal (XML)         | Поддержка полей                                                                  |
|------------------------------|------------------------------|------------------------------|----------------------------------------------------------------------------------|
| `Catalog`                    | `catalog`                    | `Catalog`                    | расширенная (`catalog`, `attributes`, `tabularSections`, `synonymRu`, `comment`) |
| `Document`                   | `document`                   | `Document`                   | расширенная (`attributes`, `tabularSections`, `synonymRu`, `comment`)            |
| `Subsystem`                  | `subsystem`                  | `Subsystem`                  | расширенная (`nestedSubsystems`, `contentRefs` чтение, `synonymRu`, `comment`)   |
| `ExchangePlan`               | `exchangePlan`               | `ExchangePlan`               | расширенная (`attributes`, `tabularSections`, `synonymRu`, `comment`)            |
| `Constant`                   | `constant`                   | `Constant`                   | базовая (`synonymRu`, `comment`)                                                 |
| `Enum`                       | `enum`                       | `Enum`                       | базовая (`synonymRu`, `comment`)                                                 |
| `Report`                     | `report`                     | `Report`                     | базовая (`synonymRu`, `comment`)                                                 |
| `DataProcessor`              | `dataProcessor`              | `DataProcessor`              | базовая (`synonymRu`, `comment`)                                                 |
| `Task`                       | `task`                       | `Task`                       | базовая (`synonymRu`, `comment`)                                                 |
| `ChartOfAccounts`            | `chartOfAccounts`            | `ChartOfAccounts`            | базовая (`synonymRu`, `comment`)                                                 |
| `ChartOfCharacteristicTypes` | `chartOfCharacteristicTypes` | `ChartOfCharacteristicTypes` | базовая (`synonymRu`, `comment`)                                                 |
| `ChartOfCalculationTypes`    | `chartOfCalculationTypes`    | `ChartOfCalculationTypes`    | базовая (`synonymRu`, `comment`)                                                 |
| `CommonModule`               | `commonModule`               | `CommonModule`               | базовая (`synonymRu`, `comment`)                                                 |
| `SessionParameter`           | `sessionParameter`           | `SessionParameter`           | базовая (`synonymRu`, `comment`)                                                 |
| `CommonAttribute`            | `commonAttribute`            | `CommonAttribute`            | базовая (`synonymRu`, `comment`)                                                 |
| `CommonPicture`              | `commonPicture`              | `CommonPicture`              | базовая (`synonymRu`, `comment`)                                                 |
| `DocumentNumerator`          | `documentNumerator`          | `DocumentNumerator`          | базовая (`synonymRu`, `comment`)                                                 |
| `ExternalDataSource`         | `externalDataSource`         | `ExternalDataSource`         | базовая (`synonymRu`, `comment`)                                                 |
| `Role`                       | `role`                       | `Role`                       | базовая (`synonymRu`, `comment`)                                                 |

Для `catalog`, `document`, `exchangePlan`:

- `attributes[]`, `tabularSections[]`: элементы `{ "name", "synonymRu", "comment" }`. Имя **не меняется** через форму; при сохранении число и порядок элементов должны совпадать с XML.

Для `subsystem`:

- `nestedSubsystems[]`: строки — вложенные подсистемы в `ChildObjects`
- `contentRefs[]`: только **чтение** (состав подсистемы из `Properties/Content`); при `cf-md-object-set` не изменяется

## Отображение в UI: дерево vs форма свойств

- **Дерево метаданных** использует структурные секции (реквизиты, формы, команды и т.д.) только для навигации.
- **Форма свойств объекта** использует отдельные профили вкладок:
  - scalar-группы параметров,
  - структурные секции из `cf-md-object-structure-get`,
  - специальные вкладки (например состав подсистемы).
- Непокрытые scalar-поля показываются в fallback-вкладке `Прочее`.

### Табличные части

- Во вкладке `Табличные части` каждая табличная часть отображается как разворачиваемый блок.
- Внутри блока показываются реквизиты табличной части.
- Источник реквизитов: приоритет `cf-md-object-structure-get`; при отсутствии — данные из `cf-md-object-get`.

### Подсистемы

- Вкладка `Состав` показывает:
  - сводку по типам ссылок (`Catalog`, `Document`, ...),
  - полный список элементов состава.

## Эталоны для проверки

Round-trip и регрессии — на выгрузках вроде submodule **fixtures/ssl31** в md-sparrow; пустая конфигурация — [1c-platform-samples](https://github.com/yellow-hammer/1c-platform-samples) `src/cf` (см. правила эталона пустой выгрузки).

## Ограничения текущего этапа

- Для всех перечисленных `kind` поддержаны базовые поля `internalName/synonymRu/comment` с гранулярной записью.
- Расширенные поля `catalog` и список `attributes/tabularSections` остаются полными только для типов, где это уже реализовано ранее (`catalog`, `document`, `exchangePlan`).
- Для `subsystem` дополнительно поддержаны `nestedSubsystems` и чтение `contentRefs` (как и раньше).
