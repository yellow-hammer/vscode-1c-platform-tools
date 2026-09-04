/**
 * Семантические намерения (интенты) команд vanessa-runner.
 *
 * Команды расширения описывают ЧТО нужно сделать (собрать конфигурацию,
 * загрузить расширение, прогнать тесты), не привязываясь к синтаксису CLI.
 * Конкретные аргументы строит адаптер выбранной мажорной версии vrunner
 * (см. {@link VRunnerCliAdapter}): CLI 2.x и 3.x несовместимы (BREAKING
 * CHANGES в 3.0), а часть намерений выражается разным ЧИСЛОМ команд —
 * например, разборка .cfe в 2.x требует загрузки в рабочую ИБ и выгрузки
 * из неё (2 команды), а в 3.x выполняется одной командой во временной ИБ.
 *
 * Замкнутость множества гарантирует компилятор: оба адаптера обязаны
 * обработать каждый вид интента (exhaustive switch + assertNever), поэтому
 * невозможно добавить команду, не описав её в обоих синтаксисах.
 *
 * Поле `common` — сквозные опции, одинаковые в обоих CLI (`--ibconnection`,
 * `--db-user`, `--db-pwd`, `--settings`, `--v8version`, …), уже в виде
 * готовых аргументов. Адаптер размещает их корректно для своей версии
 * (в 3.x — строго перед позиционными аргументами).
 */


/** Сквозные опции команды (аргументы, валидные в обоих CLI). */
export type CommonArgs = readonly string[];

/** Отбор тестов YAxUnit: имена расширений, модулей и полные имена тестов `Модуль.Тест`. */
export interface YaxunitFilter {
	extensions?: readonly string[];
	modules?: readonly string[];
	tests?: readonly string[];
}

/** Намерение для vanessa-runner (замкнутый union). */
export type VRunnerIntent =
	// ---- Информационная база ----
	/** Создать ИБ (и опционально загрузить конфигурацию из источника). */
	| { kind: 'infobase.init'; src?: string; common?: CommonArgs }
	/** Обновить конфигурацию БД (основную). */
	| { kind: 'infobase.updateDb'; common?: CommonArgs }
	/** Обновить БД конкретного расширения. */
	| { kind: 'infobase.updateExtension'; extensionName: string; common?: CommonArgs }
	/** Выгрузить ИБ в .dt. */
	| { kind: 'infobase.dumpDt'; out: string; common?: CommonArgs }
	/** Восстановить ИБ из .dt. */
	| { kind: 'infobase.restoreDt'; file: string; common?: CommonArgs }
	/** Список установленных в ИБ расширений. */
	| { kind: 'infobase.listExtensions'; json?: boolean; out?: string; common?: CommonArgs }

	// ---- Конфигурация (cf) ----
	/** Собрать .cf из исходников. */
	| { kind: 'cf.build'; src: string; out: string; common?: CommonArgs }
	/** Разобрать .cf-файл в исходники. */
	| { kind: 'cf.decompileFile'; file: string; out: string; common?: CommonArgs }
	/**
	 * Выгрузить конфигурацию ИБ в исходники.
	 *
	 * Выгрузка в непустой каталог идёт инкрементально: vanessa-runner сам просит
	 * у конфигуратора `-update`, а файл версий тот берёт из каталога выгрузки.
	 * Отдельной опции для файла версий здесь нет: `--versions` на файл внутри
	 * каталога выгрузки ломает инкремент - конфигуратор отвечает «Каталог не пуст».
	 */
	| { kind: 'cf.dumpIbToSrc'; out: string; common?: CommonArgs }
	/** Выгрузить конфигурацию ИБ в .cf. */
	| { kind: 'cf.unloadIbToCf'; out: string; common?: CommonArgs }
	/** Создать файл поставки (в 3.x команда пока не реализована — vrunner сообщит об этом сам). */
	| { kind: 'cf.makeDist'; out: string; common?: CommonArgs }
	/**
	 * Загрузить конфигурацию в ИБ из исходников.
	 *
	 * `updateDb` решает, применять ли загруженное к конфигурации БД (UpdateDBCfg):
	 * оба CLI умеют сделать это тем же вызовом, поэтому отдельным интентом
	 * применение не выражается.
	 */
	| {
		kind: 'cf.loadFromSrc';
		src: string;
		increment?: boolean;
		/** Файл со списком объектов для выборочной загрузки. */
		listFile?: string;
		updateDb: boolean;
		common?: CommonArgs;
	}
	/** Загрузить конфигурацию в ИБ из .cf-файла. */
	| { kind: 'cf.loadFileToIb'; file: string; updateDb: boolean; common?: CommonArgs }

	// ---- Расширения (cfe) ----
	/**
	 * Собрать .cfe из исходников (без загрузки в ИБ).
	 *
	 * `extensionName` — имя расширения из метаданных (Configuration.xml);
	 * оно может отличаться от имени каталога исходников. Если не задано,
	 * используется имя каталога.
	 */
	| { kind: 'cfe.buildCfe'; src: string; out: string; extensionName?: string; common?: CommonArgs }
	/** Загрузить расширение в ИБ из исходников (опционально обновить БД). */
	| { kind: 'cfe.loadFromSrc'; src: string; extensionName: string; updateDb?: boolean; common?: CommonArgs }
	/** Загрузить расширение в ИБ из .cfe-файла. */
	| { kind: 'cfe.loadFromCfeFile'; file: string; extensionName: string; common?: CommonArgs }
	/** Выгрузить установленное расширение из ИБ в исходники. */
	| { kind: 'cfe.dumpIbToSrc'; extensionName: string; out: string; common?: CommonArgs }
	/** Выгрузить установленное расширение из ИБ в .cfe. */
	| { kind: 'cfe.unloadIbToCfe'; extensionName: string; out: string; common?: CommonArgs }
	/**
	 * Разобрать .cfe-ФАЙЛ в исходники.
	 *
	 * В 2.x — двухшаговый поток через рабочую ИБ (loadext + decompileext),
	 * в 3.x — одна команда `cfe decompile --cfe-file` во временной ИБ,
	 * рабочая база не затрагивается.
	 */
	| { kind: 'cfe.decompileCfeFile'; file: string; extensionName: string; out: string; common?: CommonArgs }

	// ---- Внешние обработки и отчёты (epf/erf) ----
	/** Собрать обработки/отчёты из исходников (каталог — рекурсивно). */
	| { kind: 'epf.build'; src: string; out: string; common?: CommonArgs }
	/** Разобрать .epf/.erf (или каталог) в исходники. */
	| { kind: 'epf.decompile'; input: string; out: string; common?: CommonArgs }

	// ---- Запуск 1С ----
	/** Запустить 1С:Предприятие. */
	| { kind: 'run.enterprise'; command?: string; execute?: string; noWait?: boolean; common?: CommonArgs }
	/** Запустить Конфигуратор. */
	| { kind: 'run.designer'; additional?: string; noWait?: boolean; common?: CommonArgs }

	// ---- Тесты и проверка ----
	/** Прогнать xUnit-тесты (Vanessa-ADD). */
	| { kind: 'test.xunit'; testsPath?: string; reportsXunit?: string; common?: CommonArgs }
	/**
	 * Прогнать BDD-сценарии Vanessa.
	 *
	 * `featurePath` — конкретный файл/каталог фич; `vanessaSettings` — путь к
	 * файлу настроек Vanessa Automation (VAParams).
	 */
	| { kind: 'test.vanessa'; featurePath?: string; vanessaSettings?: string; common?: CommonArgs }
	/**
	 * Прогнать модульные тесты YAxUnit.
	 *
	 * `configPath` — готовый конфиг (`RunUnitTests=`); без него vanessa-runner 3
	 * собирает конфиг сам из опций и файла настроек, а 2.x без конфига тесты не
	 * запускает. `filter` и `report` выражаются только без готового конфига: с
	 * ним раннер берёт фильтр и путь отчёта из самого файла. Опции запуска
	 * приходят из секции `yaxunit` профиля 2.x.
	 */
	| {
		kind: 'test.yaxunit';
		configPath?: string;
		filter?: YaxunitFilter;
		/** Путь jUnit-отчёта; раннер пишет отчёт туда, когда готового конфига нет. */
		report?: string;
		ordinaryApp?: string;
		exitCodePath?: string;
		additional?: string;
		noWait?: boolean;
		common?: CommonArgs;
	}
	/** Синтаксический контроль конфигурации. */
	| { kind: 'validate.syntaxCheck'; common?: CommonArgs }

	// ---- Сеансы информационной базы (через rac и ras) ----
	/**
	 * Запретить начало сеансов.
	 *
	 * Подключение к кластеру (адрес RAS, база, администратор, пароль) задаётся
	 * в файле настроек проекта: vanessa-runner читает его сам, а аргументы
	 * командной строки перекрыли бы профиль. Здесь только параметры разового
	 * вызова: `deniedMessage` виден пользователю при попытке войти,
	 * `accessCode` пускает в заблокированную базу, время начала и окончания
	 * блокировки поддерживает только 2.x.
	 */
	| {
		kind: 'session.lock';
		deniedMessage?: string;
		accessCode?: string;
		lockStart?: string;
		lockEnd?: string;
		common?: CommonArgs;
	}
	/** Снять запрет начала сеансов. */
	| { kind: 'session.unlock'; accessCode?: string; common?: CommonArgs }
	/**
	 * Завершить сеансы.
	 *
	 * По умолчанию vanessa-runner заодно запрещает начало новых сеансов;
	 * `withoutLock` отключает это. `filter` отбирает сеансы по приложению и
	 * пользователю в записи 2.x (`appid=Designer|name=Иванов`), `filterMode`
	 * со значением `EXCEPT` инвертирует отбор.
	 *
	 * `retry` и `timeoutSeconds` есть только в 3.x: rac завершает сеансы
	 * асинхронно, поэтому vanessa-runner перечитывает список и добивает
	 * зависшие сеансы.
	 */
	| {
		kind: 'session.kill';
		filter?: string;
		filterMode?: string;
		withoutLock?: boolean;
		retry?: number;
		timeoutSeconds?: number;
		common?: CommonArgs;
	}
	/**
	 * Проверить, что сеансов нет: при найденных сеансах vanessa-runner
	 * завершается с ошибкой.
	 *
	 * `timeoutSeconds` есть только в 3.x: проверка повторяется, пока сеансы
	 * не закончатся или не выйдет время.
	 */
	| {
		kind: 'session.closed';
		filter?: string;
		filterMode?: string;
		timeoutSeconds?: number;
		common?: CommonArgs;
	}
	/**
	 * Показать список сеансов с детализацией. Действие есть только в 3.x.
	 *
	 * `connections` дополнительно выводит соединения информационной базы,
	 * включая зависшие соединения без сеанса.
	 */
	| {
		kind: 'session.list';
		filter?: string;
		filterMode?: string;
		connections?: boolean;
		common?: CommonArgs;
	}

	// ---- Регламентные задания (через rac и ras) ----
	/** Запретить выполнение регламентных заданий. */
	| { kind: 'jobs.lock'; common?: CommonArgs }
	/** Разрешить выполнение регламентных заданий. */
	| { kind: 'jobs.unlock'; common?: CommonArgs };

/** Вид интента. */
export type VRunnerIntentKind = VRunnerIntent['kind'];

/**
 * Адаптер мажорной версии CLI vanessa-runner.
 *
 * Превращает намерение в план — последовательность команд vrunner
 * (каждый элемент — массив аргументов одной команды). Сквозные настройки
 * (подключение, ibcmd и т. п.) адаптер не придумывает: они живут в файле
 * настроек проекта, который vanessa-runner читает сам.
 */
export interface VRunnerCliAdapter {
	plan(intent: VRunnerIntent): string[][];
}

/**
 * Гарантия полноты switch по видам интентов: недостижимо при корректной
 * типизации, компилятор укажет на необработанный вид.
 */
export function assertNever(intent: never): never {
	throw new Error(`Необработанный вид интента vrunner: ${JSON.stringify(intent)}`);
}

/** Последний сегмент пути (по / или \), без завершающих разделителей. */
export function lastPathSegment(p: string): string {
	const trimmed = p.replace(/[\\/]+$/, '');
	const parts = trimmed.split(/[\\/]/);
	return parts[parts.length - 1] ?? trimmed;
}
