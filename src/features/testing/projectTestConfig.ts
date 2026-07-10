import * as path from 'node:path';
import { SettingsSchema } from '../../shared/envProfiles';

/** Путь секции команды 2.x в иерархии autumn-properties (3.x). */
const V3_SECTION_PATH: Record<string, string[]> = {
	default: [],
	vanessa: ['test', 'vanessa'],
	xunit: ['test', 'xunit'],
	'syntax-check': ['validate', 'syntax-check'],
};

/**
 * Читает значение опции команды из файла настроек с учётом схемы vanessa-runner.
 *
 * В 2.x (env.json) опции лежат плоско: `<секция>["--<опция>"]`. В 3.x
 * (autumn-properties.json) — вложенно: `vrunner.<путь секции>.<опция>` без
 * префикса `--`. Возвращает значение как оно записано в файле.
 *
 * @param settings - Разобранное содержимое файла настроек
 * @param schema - Схема настроек (по версии vrunner)
 * @param section - Имя секции команды 2.x (vanessa/xunit/syntax-check/default)
 * @param option - Имя опции без префикса (vanessasettings/reportsxunit/…)
 * @returns Значение опции или undefined
 */
export function settingValue(
	settings: Record<string, unknown>,
	schema: SettingsSchema,
	section: string,
	option: string
): unknown {
	if (schema === 'v3') {
		let current: unknown = settings['vrunner'];
		for (const segment of V3_SECTION_PATH[section] ?? [section]) {
			if (typeof current !== 'object' || current === null) {
				return undefined;
			}
			current = (current as Record<string, unknown>)[segment];
		}
		return typeof current === 'object' && current !== null
			? (current as Record<string, unknown>)[option]
			: undefined;
	}
	const sectionValue = settings[section];
	return typeof sectionValue === 'object' && sectionValue !== null
		? (sectionValue as Record<string, unknown>)[`--${option}`]
		: undefined;
}

/**
 * Чтение тестовой конфигурации проекта (env.json + tools/*)
 *
 * Расширение не генерирует собственные служебные файлы, а использует те,
 * что уже есть в проекте (см. vanessa-bootstrap): env.json с секциями
 * vanessa/xunit, tools/VAParams.json, tools/yaxunit.json.
 * Чистые функции — тестируются без vscode.
 */

/**
 * Цель отчёта прогона: где и в каком формате искать результаты
 */
export interface ReportTarget {
	/** Формат отчёта */
	format: 'junit' | 'cucumber';
	/** Абсолютный путь к файлу или каталогу отчёта */
	path: string;
}

/**
 * Подставляет $workspaceRoot и разрешает относительный путь от корня workspace
 *
 * @param value - Путь из конфига (например '$workspaceRoot/build/out' или './tools/x.json')
 * @param workspaceRoot - Абсолютный путь к корню workspace
 * @returns Абсолютный нормализованный путь
 */
export function resolveConfigPath(value: string, workspaceRoot: string): string {
	let result = value.trim().replace(/^\$workspaceRoot[\\/]?/, '');
	if (!path.isAbsolute(result)) {
		result = path.join(workspaceRoot, result);
	}
	return path.normalize(result);
}

/**
 * Извлекает путь jUnit-отчёта из значения --reportsxunit
 *
 * Поддерживаются оба синтаксиса vanessa-runner:
 * - `ГенераторОтчетаJUnitXML{build/out/junit.xml};ГенераторОтчетаAllureXMLВерсия2{...}`
 * - `jUnit:build/out/junit.xml`
 *
 * @param reportsXunit - Значение параметра --reportsxunit из env.json
 * @returns Путь к jUnit XML (как записан в конфиге) или undefined
 */
export function extractJUnitPathFromReportsXunit(reportsXunit: string): string | undefined {
	for (const part of reportsXunit.split(';')) {
		const generatorMatch = /ГенераторОтчетаJUnitXML\s*\{([^}]+)\}/i.exec(part);
		if (generatorMatch) {
			return generatorMatch[1].trim();
		}
		const shortMatch = /^\s*jUnit\s*:\s*(.+)$/i.exec(part);
		if (shortMatch) {
			return shortMatch[1].trim();
		}
	}
	return undefined;
}

/**
 * Определяет цель отчёта Vanessa Automation по содержимому VAParams.json
 *
 * Приоритет: jUnit (если включён и задан каталог) → Cucumber JSON.
 * В реальных проектах jUnit у VA часто выключен, а Cucumber JSON включён.
 *
 * @param vaParams - Разобранное содержимое VAParams.json
 * @param workspaceRoot - Корень workspace для подстановки $workspaceRoot
 * @returns Цель отчёта или undefined, если ни один формат не настроен
 */
export function vanessaReportTarget(
	vaParams: Record<string, unknown>,
	workspaceRoot: string
): ReportTarget | undefined {
	if (vaParams['ДелатьОтчетВФорматеjUnit'] === true) {
		const junitSection = vaParams['ОтчетjUnit'];
		const dir =
			junitSection && typeof junitSection === 'object'
				? (junitSection as Record<string, unknown>)['КаталогВыгрузкиjUnit']
				: undefined;
		if (typeof dir === 'string' && dir.length > 0) {
			return { format: 'junit', path: resolveConfigPath(dir, workspaceRoot) };
		}
	}

	if (vaParams['ДелатьОтчетВФорматеCucumberJson'] === true) {
		const cucumberSection = vaParams['ОтчетCucumber'];
		const dir =
			cucumberSection && typeof cucumberSection === 'object'
				? (cucumberSection as Record<string, unknown>)['КаталогВыгрузкиCucumberJson']
				: undefined;
		if (typeof dir === 'string' && dir.length > 0) {
			return { format: 'cucumber', path: resolveConfigPath(dir, workspaceRoot) };
		}
	}

	return undefined;
}

/**
 * Извлекает путь к файлу настроек VA из env.json (секция vanessa)
 *
 * @param envJson - Разобранное содержимое env.json
 * @returns Путь из --vanessasettings или undefined
 */
export function vanessaSettingsPathFromEnv(
	settings: Record<string, unknown>,
	schema: SettingsSchema = 'v2'
): string | undefined {
	const value = settingValue(settings, schema, 'vanessa', 'vanessasettings');
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Извлекает значение --reportsxunit из env.json (секция xunit)
 *
 * @param envJson - Разобранное содержимое env.json
 * @returns Значение параметра или undefined
 */
export function reportsXunitFromEnv(
	settings: Record<string, unknown>,
	schema: SettingsSchema = 'v2'
): string | undefined {
	const value = settingValue(settings, schema, 'xunit', 'reportsxunit');
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Извлекает путь jUnit-отчёта синтаксического контроля из env.json (секция syntax-check)
 *
 * Схемо-зависимо: 2.x — `syntax-check["--junitpath"]`, 3.x —
 * `vrunner.validate.syntax-check.junitpath` (см. settingValue).
 *
 * @param envJson - Разобранное содержимое env.json
 * @returns Путь как записан в конфиге (относительный/с $workspaceRoot) или undefined
 */
export function syntaxCheckJUnitPathFromEnv(
	settings: Record<string, unknown>,
	schema: SettingsSchema = 'v2'
): string | undefined {
	const value = settingValue(settings, schema, 'syntax-check', 'junitpath');
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Определяет, включена ли группировка результатов syntax-check по метаданным
 *
 * При --groupbymetadata: true атрибут testcase name содержит путь по метаданным
 * (`ОбщийМодуль.Имя.Модуль`), который маппится в файл модуля. При false формат
 * иной — маппинг в .bsl не гарантирован, диагностика падает на fallback-файл.
 *
 * @param envJson - Разобранное содержимое env.json
 * @returns true/false как задано в конфиге; undefined, если опции нет
 */
export function syntaxCheckGroupByMetadataFromEnv(
	settings: Record<string, unknown>,
	schema: SettingsSchema = 'v2'
): boolean | undefined {
	const value = settingValue(settings, schema, 'syntax-check', 'groupbymetadata');
	return typeof value === 'boolean' ? value : undefined;
}
