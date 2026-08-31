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
	/** Исходники конфигурации (path.cf) */
	cf: 'src/cf',
	/** Исходники расширений (path.cfe) */
	cfe: 'src/cfe',
	/** Исходники внешних обработок (path.epf) */
	epf: 'src/epf',
	/** Исходники внешних отчётов (path.erf) */
	erf: 'src/erf',
	/** Корень тестов: *.os и подкаталоги исходников (path.tests) */
	tests: 'tests',
	/** Результаты сборки (path.out) */
	out: 'build/out',
	/** Каталог шаблонов поставки (path.dist) */
	dist: 'build/dist'
} as const;

/**
 * Подкаталоги внутри корня тестов (path.tests).
 *
 * Раскладка фиксированная: настройки на каждый подкаталог не заводим, иначе
 * корень тестов повторялся бы в каждой из них, а переименование каталога
 * правилось бы в нескольких местах. Один корень - один переезд.
 */
export const TESTS_SUBDIRS = {
	/** Исходники тестовых расширений: <path.tests>/cfe */
	cfe: 'cfe',
	/** Исходники тестовых обработок: <path.tests>/epf */
	epf: 'epf'
} as const;

/**
 * Путь подкаталога тестов относительно корня проекта.
 *
 * @param testsRoot - Корень тестов (path.tests)
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
 * Подкаталоги результатов сборки внутри `path.out` по типу артефакта.
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

/** Дефолты путей группы 1c-platform-tools.test.* */
export const DEFAULT_TESTING = {
	/** Каталог feature-файлов (test.path.features) */
	featuresPath: 'features',
	/** Каталог тестов OneScript: устарел, каталог задаётся в path.tests */
	onescriptTestsPath: 'tests',
	/** Каталог временных файлов прогонов (test.path.reports) */
	reportsPath: 'build/out/testapi',
	/** Базовый конфиг YAxUnit (test.path.yaxunitConfig) */
	yaxunitConfigPath: 'tools/yaxunit.json'
} as const;

/** Дефолты путей группы 1c-platform-tools.vrunner.path.* */
export const DEFAULT_VRUNNER = {
	/** Файл настроек инициализации ИБ (vrunner.path.initSettings) */
	initSettingsPath: 'tools/vrunner.init.json'
} as const;

/** Дефолты группы 1c-platform-tools env-профилей */
export const DEFAULT_ENV = {
	/** Идентификатор профиля по умолчанию (env.defaultProfile); '' — базовый env.json */
	defaultProfile: ''
} as const;

/**
 * Полный ключ настройки для каждого дефолта.
 *
 * Имена свойств в коде и хвосты ключей настроек не совпадают: ключ называет
 * путь словом `path` перед предметом, а свойство читается как обычное поле.
 * Связь описана здесь один раз, по ней же проверяется совпадение с манифестом.
 */
export const SETTING_DEFAULTS: ReadonlyArray<{ readonly key: string; readonly value: string }> = [
	{ key: '1c-platform-tools.path.cf', value: DEFAULT_PATHS.cf },
	{ key: '1c-platform-tools.path.cfe', value: DEFAULT_PATHS.cfe },
	{ key: '1c-platform-tools.path.epf', value: DEFAULT_PATHS.epf },
	{ key: '1c-platform-tools.path.erf', value: DEFAULT_PATHS.erf },
	{ key: '1c-platform-tools.path.tests', value: DEFAULT_PATHS.tests },
	{ key: '1c-platform-tools.path.out', value: DEFAULT_PATHS.out },
	{ key: '1c-platform-tools.path.dist', value: DEFAULT_PATHS.dist },
	{ key: '1c-platform-tools.test.path.features', value: DEFAULT_TESTING.featuresPath },
	{ key: '1c-platform-tools.test.path.onescriptTests', value: DEFAULT_TESTING.onescriptTestsPath },
	{ key: '1c-platform-tools.test.path.reports', value: DEFAULT_TESTING.reportsPath },
	{ key: '1c-platform-tools.test.path.yaxunitConfig', value: DEFAULT_TESTING.yaxunitConfigPath },
	{ key: '1c-platform-tools.vrunner.path.initSettings', value: DEFAULT_VRUNNER.initSettingsPath },
	{ key: '1c-platform-tools.env.defaultProfile', value: DEFAULT_ENV.defaultProfile },
];
