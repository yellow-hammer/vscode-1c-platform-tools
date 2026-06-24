import * as path from 'node:path';

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
export function vanessaSettingsPathFromEnv(envJson: Record<string, unknown>): string | undefined {
	const vanessaSection = envJson['vanessa'];
	if (vanessaSection && typeof vanessaSection === 'object') {
		const value = (vanessaSection as Record<string, unknown>)['--vanessasettings'];
		if (typeof value === 'string' && value.length > 0) {
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
export function reportsXunitFromEnv(envJson: Record<string, unknown>): string | undefined {
	const xunitSection = envJson['xunit'];
	if (xunitSection && typeof xunitSection === 'object') {
		const value = (xunitSection as Record<string, unknown>)['--reportsxunit'];
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

/**
 * Извлекает путь jUnit-отчёта синтаксического контроля из env.json (секция syntax-check)
 *
 * Формат vanessa-runner v2: `syntax-check.--junitpath` (см. envSections.ts).
 * В vanessa-runner v3 структура env.json иная (`vrunner.<путь>.<опция>`) —
 * не поддерживается, пока миграция на v3 не реализована (issue #118).
 *
 * @param envJson - Разобранное содержимое env.json
 * @returns Путь как записан в конфиге (относительный/с $workspaceRoot) или undefined
 */
export function syntaxCheckJUnitPathFromEnv(envJson: Record<string, unknown>): string | undefined {
	const section = envJson['syntax-check'];
	if (section && typeof section === 'object') {
		const value = (section as Record<string, unknown>)['--junitpath'];
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}
	return undefined;
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
	envJson: Record<string, unknown>
): boolean | undefined {
	const section = envJson['syntax-check'];
	if (section && typeof section === 'object') {
		const value = (section as Record<string, unknown>)['--groupbymetadata'];
		if (typeof value === 'boolean') {
			return value;
		}
	}
	return undefined;
}
