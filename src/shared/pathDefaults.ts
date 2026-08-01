/**
 * Значения по умолчанию для настроек-путей (единый источник)
 *
 * Дублирование дефолтов между файлами приводит к рассинхрону при изменении.
 * Эти константы — единственный источник дефолтов для кода; они должны
 * совпадать с `default` в contributes.configuration (package.json).
 *
 * Формат единый: относительный путь от корня проекта без ведущего `./`.
 */

/** Дефолты группы 1c-platform-tools.paths.* */
export const DEFAULT_PATHS = {
	/** Исходники конфигурации (paths.cf) */
	cf: 'src/cf',
	/** Исходники расширений (paths.cfe) */
	cfe: 'src/cfe',
	/** Исходники внешних обработок (paths.epf) */
	epf: 'src/epf',
	/** Исходники внешних отчётов (paths.erf) */
	erf: 'src/erf',
	/** Корень тестов: *.os и подкаталоги исходников (paths.tests) */
	tests: 'tests',
	/** Результаты сборки (paths.out) */
	out: 'build/out',
	/** Каталог шаблонов поставки (paths.dist) */
	dist: 'build/dist'
} as const;

/**
 * Подкаталоги внутри корня тестов (paths.tests).
 *
 * Раскладка фиксированная: настройки на каждый подкаталог не заводим, иначе
 * корень тестов повторялся бы в каждой из них, а переименование каталога
 * правилось бы в нескольких местах. Один корень - один переезд.
 */
export const TESTS_SUBDIRS = {
	/** Исходники тестовых расширений: <paths.tests>/cfe */
	cfe: 'cfe',
	/** Исходники тестовых обработок: <paths.tests>/epf */
	epf: 'epf'
} as const;

/**
 * Путь подкаталога тестов относительно корня проекта.
 *
 * @param testsRoot - Корень тестов (paths.tests)
 * @param subdir - Подкаталог из TESTS_SUBDIRS
 * @returns Путь относительно корня проекта, через прямые слэши
 */
export function testsSubPath(testsRoot: string, subdir: string): string {
	const root = normalizeRelative(testsRoot);
	return root.length > 0 ? `${root}/${subdir}` : subdir;
}

/** Приводит путь настройки к виду «от корня проекта, через прямые слэши, без хвостового». */
function normalizeRelative(value: string): string {
	return value
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\.\//, '')
		.replace(/\/+$/, '');
}

/**
 * Подкаталоги результатов сборки внутри `paths.out` по типу артефакта.
 *
 * Раскладка наша: ни vanessa-runner, ни его файлы настроек эти каталоги не
 * объявляют - пути передаются командам аргументами. Держим их одной картой,
 * чтобы литерал не расползался по командам.
 *
 * Тестовое собирается отдельно от решения: иначе «Загрузить расширения из
 * *.cfe» затянула бы в базу тесты.
 */
export const BUILD_SUBDIRS = {
	/** Расширения решения: build/out/cfe */
	cfe: 'cfe',
	/** Внешние обработки: build/out/epf */
	epf: 'epf',
	/** Внешние отчёты: build/out/erf */
	erf: 'erf',
	/** Тестовые расширения: build/out/tests/cfe */
	testsCfe: 'tests/cfe',
	/** Тестовые обработки: build/out/tests/epf */
	testsEpf: 'tests/epf'
} as const;

/** Дефолты путей группы 1c-platform-tools.testing.* */
export const DEFAULT_TESTING = {
	/** Каталог feature-файлов (testing.featuresPath) */
	featuresPath: 'features',
	/** Каталог тестов OneScript: устарел, каталог задаётся в paths.tests */
	onescriptTestsPath: 'tests',
	/** Каталог временных файлов прогонов (testing.reportsPath) */
	reportsPath: 'build/out/testapi',
	/** Базовый конфиг YAxUnit (testing.yaxunitConfigPath) */
	yaxunitConfigPath: 'tools/yaxunit.json'
} as const;

/** Дефолты путей группы 1c-platform-tools.vrunner.* */
export const DEFAULT_VRUNNER = {
	/** Файл настроек инициализации ИБ (vrunner.initSettingsPath) */
	initSettingsPath: 'tools/vrunner.init.json'
} as const;

/** Дефолты группы 1c-platform-tools env-профилей */
export const DEFAULT_ENV = {
	/** Идентификатор профиля по умолчанию (defaultEnvProfile); '' — базовый env.json */
	defaultProfile: ''
} as const;
