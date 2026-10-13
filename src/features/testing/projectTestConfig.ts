import * as path from 'node:path';
import { SettingsSchema } from '../../shared/envProfiles';

/** Путь секции команды 2.x в иерархии autumn-properties (3.x). */
const V3_SECTION_PATH: Record<string, string[]> = {
	default: [],
	vanessa: ['test', 'vanessa'],
	xunit: ['test', 'xunit'],
	yaxunit: ['test', 'yaxunit'],
	'syntax-check': ['validate', 'syntax-check'],
};

/** Свойство объекта JSON; у значений другого вида свойств нет. */
function jsonProperty(node: unknown, key: string): unknown {
	return typeof node === 'object' && node !== null && !Array.isArray(node)
		? (node as Record<string, unknown>)[key]
		: undefined;
}

/**
 * Читает значение опции команды из файла настроек с учётом схемы vanessa-runner.
 *
 * В 2.x (env.json) опции лежат плоско: `<секция>["--<опция>"]`. В 3.x
 * (autumn-properties.json) — вложенно, без префикса `--`, и vanessa-runner
 * ищет опцию каскадом: `vrunner.<путь секции>.<опция>`, затем на каждом
 * уровне выше до `vrunner.<опция>`; команда получает первое найденное.
 * Возвращает значение как оно записано в файле.
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
		const sectionPath = V3_SECTION_PATH[section] ?? [section];
		for (let depth = sectionPath.length; depth >= 0; depth--) {
			const node = sectionPath.slice(0, depth).reduce(jsonProperty, settings['vrunner']);
			const value = jsonProperty(node, option);
			if (value !== undefined && value !== null) {
				return value;
			}
		}
		return undefined;
	}
	const sectionValue = settings[section];
	return typeof sectionValue === 'object' && sectionValue !== null
		? (sectionValue as Record<string, unknown>)[`--${option}`]
		: undefined;
}

/**
 * Секция YAxUnit активного профиля: что расширение переносит в запуск тестов.
 *
 * В 2.x секцию `yaxunit` vanessa-runner не читает, её ключи те же, что у
 * команды `run`: `--command` с `RunUnitTests=<конфиг>` задаёт готовый конфиг,
 * остальные уходят в командную строку. В 3.x секцию `vrunner.test.yaxunit`
 * раннер читает сам, расширению нужны только готовый конфиг и путь отчёта.
 */
export interface YaxunitProfileSection {
	/** Готовый конфиг YAxUnit как записан в профиле. */
	configPath?: string;
	/** Путь jUnit-отчёта из настроек 3.x: без готового конфига раннер пишет отчёт туда. */
	report?: string;
	/** Режим клиента для `vrunner run` (2.x). */
	ordinaryApp?: string;
	/** Файл кода возврата для `vrunner run` (2.x). */
	exitCodePath?: string;
	/** Дополнительные параметры запуска 1С (2.x). */
	additional?: string;
	/** Не ждать завершения 1С (2.x). */
	noWait?: boolean;
}

/**
 * Путь конфига из строки запуска `RunUnitTests=<путь>`; параметры после `;` отбрасываются.
 *
 * @param command - Значение `--command` секции yaxunit
 * @returns Путь как записан в профиле или undefined, если строка не про YAxUnit
 */
export function yaxunitConfigPathFromCommand(command: string): string | undefined {
	const match = /^\s*RunUnitTests\s*=\s*([^;]*)/i.exec(command);
	const value = match?.[1].trim();
	return value ? value : undefined;
}

/**
 * Читает секцию YAxUnit активного профиля с учётом схемы.
 *
 * @param settings - Разобранное содержимое файла настроек
 * @param schema - Схема файла настроек (2.x или 3.x)
 * @returns Значения секции; пустой объект, если секции нет
 */
export function yaxunitSectionFromEnv(
	settings: Record<string, unknown>,
	schema: SettingsSchema = 'v2'
): YaxunitProfileSection {
	const text = (option: string): string | undefined => {
		const value = settingValue(settings, schema, 'yaxunit', option);
		if (typeof value === 'number') {
			return String(value);
		}
		return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
	};
	if (schema === 'v3') {
		// Отчёт за прогон один. Отчёт другого формата панель не прочитает: путь остаётся раннеру
		const formats = reportFormats(settingValue(settings, schema, 'yaxunit', 'report-format'));
		const junit = formats.length === 0 || (formats.length === 1 && formats[0] === 'junit');
		return {
			configPath: text('yaxunit-config'),
			report: junit ? text('report-path') ?? text('report') : undefined,
		};
	}
	const command = text('command');
	return {
		configPath: command ? yaxunitConfigPathFromCommand(command) : undefined,
		ordinaryApp: text('ordinaryapp'),
		exitCodePath: text('exitCodePath'),
		additional: text('additional'),
		noWait: settingValue(settings, schema, 'yaxunit', 'no-wait') === true ? true : undefined,
	};
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
		// 2.x: ГенераторОтчетаJUnitXML{путь}; 3.x: jUnit{путь}; краткий: jUnit:путь
		const braceMatch = /(?:ГенераторОтчетаJUnitXML|jUnit)\s*\{([^}]+)\}/i.exec(part);
		if (braceMatch) {
			return braceMatch[1].trim();
		}
		const shortMatch = /^\s*jUnit\s*:\s*(.+)$/i.exec(part);
		if (shortMatch) {
			return shortMatch[1].trim();
		}
	}
	return undefined;
}

/**
 * Извлекает путь Allure-результатов из значения --reportsxunit
 *
 * Тот же синтаксис, что у jUnit-генератора:
 * - `ГенераторОтчетаAllureXMLВерсия2{build/out/allure/allure.xml}`
 * - `allure{...}` или `allure:путь`
 *
 * @param reportsXunit - Значение параметра --reportsxunit из env.json
 * @returns Путь к Allure-результатам (как записан в конфиге) или undefined
 */
export function extractAllurePathFromReportsXunit(reportsXunit: string): string | undefined {
	for (const part of reportsXunit.split(';')) {
		const braceMatch = /(?:ГенераторОтчетаAllureXML[^\s{]*|allure)\s*\{([^}]+)\}/i.exec(part);
		if (braceMatch) {
			return braceMatch[1].trim();
		}
		const shortMatch = /^\s*allure\s*:\s*(.+)$/i.exec(part);
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
/**
 * Истина в терминах настроек VA: булево true либо строки «Истина»/«True».
 *
 * @param value - Значение флага из VAParams
 * @returns true, если флаг включён
 */
export function vaFlagOn(value: unknown): boolean {
	if (typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'string') {
		const lowered = value.trim().toLowerCase();
		return lowered === 'истина' || lowered === 'true';
	}
	return false;
}

/**
 * Каталог выгрузки отчёта VA: плоское поле или вложенная секция.
 *
 * Vanessa Automation принимает оба написания настроек, в живых конфигах
 * встречаются оба; регистр буквы j в именах ключей также различается.
 *
 * @param vaParams - Разобранное содержимое VAParams
 * @param flatKeys - Имена плоских полей каталога
 * @param sections - Пары «секция, ключ каталога»
 * @returns Каталог как записан в конфиге или undefined
 */
function vaReportDir(
	vaParams: Record<string, unknown>,
	flatKeys: string[],
	sections: [string, string][]
): string | undefined {
	for (const key of flatKeys) {
		const value = vaParams[key];
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}
	for (const [section, key] of sections) {
		const sectionValue = vaParams[section];
		if (typeof sectionValue === 'object' && sectionValue !== null) {
			const value = (sectionValue as Record<string, unknown>)[key];
			if (typeof value === 'string' && value.length > 0) {
				return value;
			}
		}
	}
	return undefined;
}

export function vanessaReportTarget(
	vaParams: Record<string, unknown>,
	workspaceRoot: string
): ReportTarget | undefined {
	if (vaFlagOn(vaParams['ДелатьОтчетВФорматеjUnit'])) {
		const dir = vaReportDir(
			vaParams,
			['КаталогВыгрузкиJUnit', 'КаталогВыгрузкиjUnit', 'КаталогОтчетаJUnit'],
			[['ОтчетJUnit', 'КаталогВыгрузкиJUnit'], ['ОтчетjUnit', 'КаталогВыгрузкиjUnit']]
		);
		if (dir) {
			return { format: 'junit', path: resolveConfigPath(dir, workspaceRoot) };
		}
	}

	if (vaFlagOn(vaParams['ДелатьОтчетВФорматеCucumberJson'])) {
		const dir = vaReportDir(
			vaParams,
			['КаталогВыгрузкиCucumberJson'],
			[['ОтчетCucumber', 'КаталогВыгрузкиCucumberJson']]
		);
		if (dir) {
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

/** Непустая строка настройки либо undefined. */
function textSetting(value: unknown): string | undefined {
	if (typeof value === 'number') {
		return String(value);
	}
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Путь к bddRunner.epf из файла настроек.
 *
 * Сначала каскад vanessa-runner: `vrunner.test.vanessa.bddrunner-path`, затем
 * уровни выше и старое имя `pathvanessa`. Если блок `test` не записан, читаются
 * секция `vrunner.vanessa` и ключ `vanessa.bddrunner-path`: их раннер не видит,
 * а команда без `--bddrunner-path` падает, когда рядом с OneScript нет vanessa-add.
 *
 * @param settings - Разобранное содержимое файла настроек
 * @param schema - Схема файла (2.x или 3.x)
 * @returns Путь как записан в файле или undefined
 */
export function bddRunnerPathFromSettings(
	settings: Record<string, unknown>,
	schema: SettingsSchema = 'v2'
): string | undefined {
	const fromCascade = textSetting(settingValue(settings, schema, 'vanessa', 'bddrunner-path'))
		?? textSetting(settingValue(settings, schema, 'vanessa', 'pathvanessa'));
	if (fromCascade) {
		return fromCascade;
	}
	const extra = schema === 'v3'
		? [
			['vrunner', 'vanessa', 'bddrunner-path'],
			['vrunner', 'vanessa', 'pathvanessa'],
			['vrunner', 'vanessa.bddrunner-path'],
			['vanessa.bddrunner-path'],
			['vanessa', 'bddrunner-path'],
			['vanessa', '--bddrunner-path'],
			['vanessa', '--pathvanessa'],
		]
		: [
			['vanessa', 'bddrunner-path'],
			['vanessa.bddrunner-path'],
		];
	for (const segments of extra) {
		let node: unknown = settings;
		for (const segment of segments) {
			node = jsonProperty(node, segment);
		}
		const value = textSetting(node);
		if (value) {
			return value;
		}
	}
	return undefined;
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
 * Форматы отчёта из значения `report-format`: строка или список, без повторов.
 *
 * @param value - Значение опции как записано в настройках
 * @returns Форматы в нижнем регистре
 */
function reportFormats(value: unknown): string[] {
	const listed = (Array.isArray(value) ? value : [value])
		.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
		.map((item) => item.trim().toLowerCase());
	return [...new Set(listed)];
}

/**
 * Путь отчёта формата из пары `report-format` / `report-path` секции 3.x.
 *
 * С одним форматом `report-path` и есть путь отчёта, с несколькими это
 * каталог, где отчёт лежит под именем `nameInDir`. Без `report-format`
 * отчёт пишется в формате junit.
 *
 * @param settings - Разобранные настройки в формате 3.x
 * @param section - Секция команды (см. settingValue)
 * @param format - Формат отчёта в нижнем регистре
 * @param nameInDir - Имя отчёта внутри каталога
 * @returns Путь как записан в конфиге или undefined, если отчёт не запрошен
 */
function reportPathFromSettings(
	settings: Record<string, unknown>,
	section: string,
	format: string,
	nameInDir: string
): string | undefined {
	const reportPath = settingValue(settings, 'v3', section, 'report-path');
	if (typeof reportPath !== 'string' || reportPath.trim().length === 0) {
		return undefined;
	}
	const listed = reportFormats(settingValue(settings, 'v3', section, 'report-format'));
	const formats = listed.length > 0 ? listed : ['junit'];
	if (!formats.includes(format)) {
		return undefined;
	}
	const trimmed = reportPath.trim();
	return formats.length === 1 ? trimmed : `${trimmed.replace(/[\\/]+$/, '')}/${nameInDir}`;
}

/**
 * Извлекает путь jUnit-отчёта синтаксического контроля из env.json (секция syntax-check)
 *
 * Схемо-зависимо: 2.x — `syntax-check["--junitpath"]`, 3.x — пара
 * `report-format` / `report-path` команды `validate syntax-check`, а без
 * junit в паре `junitpath`.
 *
 * @param envJson - Разобранное содержимое env.json
 * @returns Путь как записан в конфиге (относительный/с $workspaceRoot) или undefined
 */
export function syntaxCheckJUnitPathFromEnv(
	settings: Record<string, unknown>,
	schema: SettingsSchema = 'v2'
): string | undefined {
	const reported = schema === 'v3'
		? reportPathFromSettings(settings, 'syntax-check', 'junit', 'junit.xml')
		: undefined;
	if (reported) {
		return reported;
	}
	const value = settingValue(settings, schema, 'syntax-check', 'junitpath');
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Каталоги Allure-результатов синтаксического контроля из env.json
 *
 * В 2.x у проверки две опции, заданы могут быть обе: `--allure-results`
 * (Allure, xml) и `--allure-results2` (Allure2, json). В 3.x каталог задаёт
 * пара `report-format` / `report-path`, а без allure в паре `allure-results`.
 *
 * @param settings - Разобранные настройки активного профиля
 * @param schema - Схема файла настроек (2.x или 3.x)
 * @returns Пути как записаны в конфиге
 */
export function syntaxCheckAllurePathsFromEnv(
	settings: Record<string, unknown>,
	schema: SettingsSchema = 'v2'
): string[] {
	if (schema === 'v3') {
		const reported = reportPathFromSettings(settings, 'syntax-check', 'allure', 'allure');
		if (reported) {
			return [reported];
		}
	}
	const paths: string[] = [];
	for (const option of schema === 'v3' ? ['allure-results'] : ['allure-results', 'allure-results2']) {
		const value = settingValue(settings, schema, 'syntax-check', option);
		if (typeof value === 'string' && value.length > 0) {
			paths.push(value);
		}
	}
	return paths;
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
