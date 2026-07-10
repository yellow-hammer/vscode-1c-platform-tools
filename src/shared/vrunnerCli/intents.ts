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

/** Намерение для vanessa-runner (замкнутый union). */
export type VRunnerIntent =
	// ---- Информационная база ----
	/** Создать ИБ (и опционально загрузить конфигурацию из источника). */
	| { kind: 'infobase.init'; src?: string; common?: CommonArgs }
	/** Загрузить конфигурацию из исходников и обновить БД. */
	| { kind: 'infobase.updateFromSrc'; src: string; gitIncrement?: boolean; common?: CommonArgs }
	/** Обновить конфигурацию БД (основную). */
	| { kind: 'infobase.updateDb'; common?: CommonArgs }
	/** Обновить БД конкретного расширения. */
	| { kind: 'infobase.updateExtension'; extensionName: string; common?: CommonArgs }
	/** Выгрузить ИБ в .dt. */
	| { kind: 'infobase.dumpDt'; out: string; common?: CommonArgs }
	/** Восстановить ИБ из .dt. */
	| { kind: 'infobase.restoreDt'; file: string; common?: CommonArgs }

	// ---- Конфигурация (cf) ----
	/** Собрать .cf из исходников. */
	| { kind: 'cf.build'; src: string; out: string; common?: CommonArgs }
	/** Разобрать .cf-файл в исходники. */
	| { kind: 'cf.decompileFile'; file: string; out: string; common?: CommonArgs }
	/**
	 * Выгрузить конфигурацию ИБ в исходники.
	 *
	 * `versionsFile` (ConfigDumpInfo.xml) включает инкрементальную выгрузку в
	 * 2.x (`--versions`); в 3.x такой опции нет — выполняется полная выгрузка.
	 */
	| { kind: 'cf.dumpIbToSrc'; out: string; versionsFile?: string; common?: CommonArgs }
	/** Выгрузить конфигурацию ИБ в .cf. */
	| { kind: 'cf.unloadIbToCf'; out: string; common?: CommonArgs }
	/** Создать файл поставки (в 3.x команда пока не реализована — vrunner сообщит об этом сам). */
	| { kind: 'cf.makeDist'; out: string; common?: CommonArgs }
	/** Загрузить конфигурацию в ИБ из .cf-файла (без обновления БД). */
	| { kind: 'cf.loadFileToIb'; file: string; common?: CommonArgs }

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
	| { kind: 'test.xunit'; testsPath?: string; common?: CommonArgs }
	/**
	 * Прогнать BDD-сценарии Vanessa.
	 *
	 * `featurePath` — конкретный файл/каталог фич; `vanessaSettings` — путь к
	 * файлу настроек Vanessa Automation (VAParams).
	 */
	| { kind: 'test.vanessa'; featurePath?: string; vanessaSettings?: string; common?: CommonArgs }
	/** Синтаксический контроль конфигурации. */
	| { kind: 'validate.syntaxCheck'; common?: CommonArgs };

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
