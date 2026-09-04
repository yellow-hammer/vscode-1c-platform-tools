# Фикстуры дерева метаданных

Ответы `md-sparrow project-metadata-tree` на маленькие проекты из репозитория md-sparrow.
Используются в `src/test/metadata/metadataTreeView.test.ts`, чтобы дерево строилось
из того же JSON, что приходит в панель.

## unsupported-extension-tree.json

Проект `fixtures/unsupported-extension` из md-sparrow: основная конфигурация 2.20,
расширение `New` того же формата и расширение `Old` формата 2.9, которое библиотека
не читает. У `Old` в ответе `schemaSupported: false` и пустой `groups`.

`projectRoot` заменён на `fixture://unsupported-extension`, чтобы фикстура не зависела от машины.

### Регенерация

```bash
java -jar md-sparrow-*-all.jar project-metadata-tree <md-sparrow>/fixtures/unsupported-extension --pretty
```
