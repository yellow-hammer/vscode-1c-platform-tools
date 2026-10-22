import { SettingsSchema } from './envProfiles';

/** Путь секции команды 2.x в иерархии autumn-properties (3.x). */
const V3_SECTION_PATH: Record<string, string[]> = {
	default: [],
	vanessa: ['test', 'vanessa'],
	xunit: ['test', 'xunit'],
	yaxunit: ['test', 'yaxunit'],
	'syntax-check': ['validate', 'syntax-check'],
};

/** Свойство объекта JSON; у значений другого вида свойств нет. */
export function jsonProperty(node: unknown, key: string): unknown {
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
