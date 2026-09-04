# Файлы настроек профиля запуска

Файлы для `src/test/shared/settingsGate.test.ts`: тест кладёт их во временный проект под
именем базового файла схемы и проверяет, что команды и панель видят профиль одинаково.

| Файл | Что в нём |
| --- | --- |
| `autumn-properties.bom.json` | формат vanessa-runner 3, BOM и комментарий |
| `env.bom.json` | формат vanessa-runner 2, BOM |
| `autumn-properties.v2-format.json` | плоские секции 2.x под именем файла 3.x |
| `autumn-properties.broken.json` | незакрытый JSON |
