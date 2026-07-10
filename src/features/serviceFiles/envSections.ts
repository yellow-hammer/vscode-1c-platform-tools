/**
 * Опциональные секции env.json (vanessa / xunit / синтаксический контроль).
 *
 * При создании env.json пользователь отмечает нужные секции; базовая секция
 * `default` присутствует всегда. Слияние (mergeEnvSections) — чистая функция.
 */

/** Опциональная секция env.json */
export interface EnvSectionOption {
	/** Ключ секции в env.json (он же id) */
	id: string;
	/** Подпись для QuickPick */
	label: string;
	/** Пояснение */
	description: string;
	/** Содержимое секции */
	section: Record<string, unknown>;
}

/** Секции команд, которые можно добавить в env.json по выбору */
export const ENV_OPTIONAL_SECTIONS: EnvSectionOption[] = [
	{
		id: 'vanessa',
		label: 'vanessa',
		description: 'Сценарные тесты Vanessa Automation (BDD/feature)',
		section: {
			'--vanessasettings': './tools/VAParams.json',
			'--pathvanessa': './oscript_modules/vanessa-automation-single/vanessa-automation-single.epf',
			'--additional': '/DisplayAllFunctions /L ru',
		},
	},
	{
		id: 'xunit',
		label: 'xunit',
		description: 'Дымовые тесты xUnit (xddTestRunner)',
		section: {
			'--xddConfig': './tools/xUnitParams.json',
			'testsPath': '$addRoot/tests/smoke',
			'--reportsxunit':
				'ГенераторОтчетаJUnitXML{build/out/smoke/junit/junit.xml};ГенераторОтчетаAllureXMLВерсия2{build/out/smoke/allure/allure.xml}',
			'--xddExitCodePath': './build/xddExitCodePath.txt',
		},
	},
	{
		id: 'syntax-check',
		label: 'syntax-check',
		description: 'Синтаксический контроль конфигурации',
		section: {
			'--groupbymetadata': true,
			'--exception-file': 'tools/syntax-check-excludes.txt',
			'--junitpath': 'build/out/syntax-check/junit/junit.xml',
			'--allure-results2': 'build/out/syntax-check/allure',
			'--mode': [
				'-ExtendedModulesCheck',
				'-ThinClient',
				'-WebClient',
				'-Server',
				'-ExternalConnection',
				'-ThickClientOrdinaryApplication',
			],
		},
	},
];

/**
 * Добавляет к базовому объекту env.json выбранные секции команд
 *
 * @param base - Базовый объект env.json (с секцией default)
 * @param selectedIds - Идентификаторы выбранных секций
 * @returns Новый объект env.json с добавленными секциями
 */
export function mergeEnvSections(
	base: Record<string, unknown>,
	selectedIds: string[]
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...base };
	for (const option of ENV_OPTIONAL_SECTIONS) {
		if (selectedIds.includes(option.id)) {
			result[option.id] = option.section;
		}
	}
	return result;
}

/** Опциональная секция autumn-properties.json (формат vanessa-runner 3.0) */
export interface AutumnSectionOption {
	/** Идентификатор (тот же, что и у v2-секции — для общего QuickPick) */
	id: string;
	/** Пояснение */
	description: string;
	/** Путь секции внутри `vrunner` (каскад команд), например ['test','vanessa'] */
	path: string[];
	/** Содержимое секции в формате 3.0 */
	section: Record<string, unknown>;
}

/**
 * Те же секции, что и {@link ENV_OPTIONAL_SECTIONS}, но в формате 3.0:
 * ключи без `--`, каскад `vrunner.<команда>`, `pathvanessa`→`bddrunner-path`,
 * генераторы отчётов `jUnit{}`/`allure{}`, режимы синтакс-контроля без `-`.
 */
export const AUTUMN_OPTIONAL_SECTIONS: AutumnSectionOption[] = [
	{
		id: 'vanessa',
		description: 'Сценарные тесты Vanessa Automation (BDD/feature)',
		path: ['test', 'vanessa'],
		section: {
			vanessasettings: './tools/VAParams.json',
			'bddrunner-path': './oscript_modules/vanessa-automation-single/vanessa-automation-single.epf',
			additional: '/DisplayAllFunctions /L ru',
		},
	},
	{
		id: 'xunit',
		description: 'Дымовые тесты xUnit (xddTestRunner)',
		path: ['test', 'xunit'],
		section: {
			xddConfig: './tools/xUnitParams.json',
			reportsxunit: 'jUnit{build/out/smoke/junit/junit.xml};allure{build/out/smoke/allure/allure.xml}',
			xddExitCodePath: './build/xddExitCodePath.txt',
		},
	},
	{
		id: 'syntax-check',
		description: 'Синтаксический контроль конфигурации',
		path: ['validate', 'syntax-check'],
		section: {
			groupbymetadata: true,
			'exception-file': 'tools/syntax-check-excludes.txt',
			junitpath: 'build/out/syntax-check/junit/junit.xml',
			'allure-results2': 'build/out/syntax-check/allure',
			mode: [
				'ExtendedModulesCheck',
				'ThinClient',
				'WebClient',
				'Server',
				'ExternalConnection',
				'ThickClientOrdinaryApplication',
			],
		},
	},
];

/**
 * Добавляет к autumn-объекту выбранные секции команд (вложение под `vrunner`
 * по пути секции, каскад vanessa-runner 3.0).
 *
 * @param base - Базовый объект `{ vrunner: { … } }`
 * @param selectedIds - Идентификаторы выбранных секций
 * @returns Новый объект autumn-properties с добавленными секциями
 */
export function mergeAutumnSections(
	base: Record<string, unknown>,
	selectedIds: string[]
): Record<string, unknown> {
	const result = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
	const vrunner = (result.vrunner ??= {}) as Record<string, unknown>;
	for (const option of AUTUMN_OPTIONAL_SECTIONS) {
		if (!selectedIds.includes(option.id)) {
			continue;
		}
		let node = vrunner;
		for (const key of option.path.slice(0, -1)) {
			node = (node[key] ??= {}) as Record<string, unknown>;
		}
		node[option.path[option.path.length - 1]] = option.section;
	}
	return result;
}
