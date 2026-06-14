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
