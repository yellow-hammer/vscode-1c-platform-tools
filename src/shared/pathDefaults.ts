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
	/** Исходники тестовых обработок (paths.testsSrc) */
	testsSrc: 'src/tests',
	/** Каталог скриптовых тестов OneScript (paths.tests) */
	tests: 'tests',
	/** Результаты сборки (paths.out) */
	out: 'build/out',
	/** Каталог шаблонов поставки (paths.dist) */
	dist: 'build/dist'
} as const;

/** Дефолты путей группы 1c-platform-tools.testing.* */
export const DEFAULT_TESTING = {
	/** Каталог feature-файлов (testing.featuresPath) */
	featuresPath: 'features',
	/** Каталог тестов OneScript (testing.onescriptTestsPath) */
	onescriptTestsPath: 'tests',
	/** Каталог временных файлов прогонов (testing.reportsPath) */
	reportsPath: 'build/out/testapi',
	/** Базовый конфиг YAxUnit (testing.yaxunitConfigPath) */
	yaxunitConfigPath: 'tools/yaxunit.json',
	/** Настройки vanessa-runner для прогона (testing.vrunnerSettings) */
	vrunnerSettings: 'tools/vrunner.json'
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
