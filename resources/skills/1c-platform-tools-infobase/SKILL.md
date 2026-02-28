---
name: 1c-platform-tools-infobase
description: Операции с информационными базами 1С. Используй, когда пользователь просит создать пустую ИБ, обновить базу, выгрузить/загрузить в dt, запретить внешние ресурсы, инициализировать данные ИБ.
---

# Информационные базы: команды расширения

Выполняй операции с ИБ через команды расширения. **Выполняй команду сам** (Execute Command), не проси пользователя нажимать палитру.

## Когда вызывать

| Запрос пользователя (примеры)              | Действие                         |
|--------------------------------------------|----------------------------------|
| Создать пустую базу, новую ИБ              | `1c-platform-tools.infobase.createEmpty` |
| Обновить ИБ, обновить конфигурацию в базе  | `1c-platform-tools.infobase.updateInfobase` |
| Выгрузить в dt, загрузить из dt            | `1c-platform-tools.infobase.dumpToDt` / `1c-platform-tools.infobase.loadFromDt` |
| Запретить внешние ресурсы                  | `1c-platform-tools.infobase.blockExternalResources` |

## Команды

| Задача                                | Command ID                                          |
|---------------------------------------|-----------------------------------------------------|
| Создать пустую ИБ                     | `1c-platform-tools.infobase.createEmpty`            |
| Обновить ИБ                           | `1c-platform-tools.infobase.updateInfobase`         |
| Постобработка обновления              | `1c-platform-tools.infobase.updateDatabase`         |
| Запретить работу с внешними ресурсами | `1c-platform-tools.infobase.blockExternalResources` |
| Инициализировать данные               | `1c-platform-tools.infobase.initialize`             |
| Выгрузить в dt                        | `1c-platform-tools.infobase.dumpToDt`               |
| Загрузить из dt                       | `1c-platform-tools.infobase.loadFromDt`             |

## Примеры

- Выполни `1c-platform-tools.infobase.createEmpty` — создание пустой ИБ (параметры из env.json).
- Выполни `1c-platform-tools.infobase.updateInfobase` для обновления конфигурации в базе текущего проекта.
