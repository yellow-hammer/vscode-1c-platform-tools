/**
 * Реестр служебных файлов проекта 1С.
 *
 * Единый источник: какие файлы расширение создаёт из шаблонов и куда. Используется
 * командами создания и деревом (отображение наличия файла).
 */

import { SettingsSchema, baseSettingsFileName } from '../../shared/envProfiles';

/** Описание служебного файла */
export interface ServiceFileSpec {
	/** Стабильный идентификатор */
	id: string;
	/** Путь относительно корня проекта (например '.gitignore', 'tools/VAParams.json') */
	relPath: string;
	/** Имя шаблона в resources/templates (может содержать подкаталог, например 'tools/x.json.template'). Отсутствует, если файл генерируется из кода */
	templateName?: string;
	/** Подпись для UI */
	label: string;
	/** Пояснение для UI */
	description: string;
	/** Входит в «рекомендованный набор» (создаётся скопом) */
	recommended: boolean;
}

/** Все известные служебные файлы */
export const SERVICE_FILES: ServiceFileSpec[] = [
	{
		id: 'gitignore',
		relPath: '.gitignore',
		templateName: 'gitignore.template',
		label: '.gitignore',
		description: 'исключения для проекта 1С',
		recommended: true,
	},
	{
		id: 'gitattributes',
		relPath: '.gitattributes',
		templateName: 'gitattributes.template',
		label: '.gitattributes',
		description: 'текст/бинарь для файлов 1С',
		recommended: true,
	},
	{
		id: 'launchProfile',
		relPath: 'env.json',
		label: 'Профиль запуска',
		description: 'настройки vanessa-runner: env.json (2.x) или autumn-properties.json (3.x)',
		recommended: true,
	},
	{
		id: 'vrunner',
		relPath: 'tools/vrunner.json',
		label: 'vrunner.json',
		description: 'настройки vanessa-runner (пакетный прогон)',
		recommended: false,
	},
	{
		id: 'vrunnerInit',
		relPath: 'tools/vrunner.init.json',
		label: 'vrunner.init.json',
		description: 'настройки vanessa-runner (интерактивное открытие VA)',
		recommended: false,
	},
	{
		id: 'vaParams',
		relPath: 'tools/VAParams.json',
		templateName: 'tools/VAParams.json.template',
		label: 'VAParams.json',
		description: 'параметры Vanessa Automation (пакетный прогон)',
		recommended: false,
	},
	{
		id: 'vaParamsInit',
		relPath: 'tools/VAParams.init.json',
		templateName: 'tools/VAParams.init.json.template',
		label: 'VAParams.init.json',
		description: 'параметры Vanessa Automation (интерактивно)',
		recommended: false,
	},
	{
		id: 'xunit',
		relPath: 'tools/xUnitParams.json',
		templateName: 'tools/xUnitParams.json.template',
		label: 'xUnitParams.json',
		description: 'параметры дымовых тестов xUnit',
		recommended: false,
	},
	{
		id: 'yaxunit',
		relPath: 'tools/yaxunit.json',
		templateName: 'tools/yaxunit.json.template',
		label: 'yaxunit.json',
		description: 'конфигурация YAxUnit',
		recommended: false,
	},
	{
		id: 'syntaxExcludes',
		relPath: 'tools/syntax-check-excludes.txt',
		templateName: 'tools/syntax-check-excludes.txt.template',
		label: 'syntax-check-excludes.txt',
		description: 'исключения синтаксического контроля',
		recommended: false,
	},
	{
		id: 'hooks',
		relPath: '.1cpt/hooks.json',
		label: 'hooks.json',
		description: 'хуки pre/post/onError на команды расширения',
		recommended: false,
	},
	// tools/README.md создаётся командой «Инициализировать структуру проекта»
	// (см. PROJECT_STRUCTURE), здесь не дублируется.
];

/**
 * Возвращает описание служебного файла по id
 *
 * @param id - Идентификатор файла
 * @returns Описание или undefined
 */
export function getServiceFileSpec(id: string): ServiceFileSpec | undefined {
	return SERVICE_FILES.find((spec) => spec.id === id);
}

/**
 * Спецификация «Профиля запуска» под схему установленного vanessa-runner.
 *
 * Пункт один, а файл зависит от версии: env.json для 2.x,
 * autumn-properties.json для 3.x (оба раннер читает из корня сам).
 *
 * @param schema - Схема настроек по версии vrunner
 * @returns Спецификация с фактическим файлом
 */
export function resolveLaunchProfileSpec(schema: SettingsSchema): ServiceFileSpec {
	const fileName = baseSettingsFileName(schema);
	return {
		id: 'launchProfile',
		relPath: fileName,
		label: 'Профиль запуска',
		description: schema === 'v3' ? 'настройки vanessa-runner 3' : 'настройки vanessa-runner 2',
		recommended: true,
	};
}
