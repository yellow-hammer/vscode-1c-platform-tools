/**
 * Разделы настроек расширения: одно описание для кнопок панелей и для выбора
 * раздела в палитре.
 *
 * Каждая панель открывала настройки своим запросом, и запросы разошлись: где-то
 * префикс заканчивался точкой, где-то нет, а две команды открывали одно и то же
 * разными фильтрами. Раздел описывается здесь один раз.
 */

/** Идентификатор расширения для фильтра настроек VS Code. */
export const SETTINGS_EXT = '@ext:yellow-hammer.1c-platform-tools';

/** Раздел настроек: то, что видит пользователь, и по чему фильтруется список. */
export interface SettingsSection {
	/** Ключ раздела. */
	id: 'ipc' | 'tools' | 'projects' | 'artifacts' | 'todo' | 'metadata' | 'components' | 'testing' | 'all';
	/** Подпись в выборе раздела. */
	label: string;
	/** Пояснение в выборе раздела. */
	detail: string;
	/** Значок в выборе раздела. */
	icon: string;
	/**
	 * Префикс настроек раздела без завершающей точки: поиск VS Code сравнивает
	 * строку целиком, и точка в конце отсекает нужные настройки.
	 */
	prefix?: string;
}

/** Разделы настроек в порядке показа. */
export const SETTINGS_SECTIONS: SettingsSection[] = [
	{
		id: 'ipc',
		label: 'Сервер IPC',
		detail: 'MCP, порт, токен',
		icon: 'plug',
		prefix: '1c-platform-tools.ipc',
	},
	{
		id: 'projects',
		label: 'Проекты',
		detail: 'каталоги поиска, исключения, избранное',
		icon: 'folder-opened',
		prefix: '1c-platform-tools.projects',
	},
	{
		id: 'artifacts',
		label: 'Артефакты',
		detail: 'исключения при сканировании',
		icon: 'package',
		prefix: '1c-platform-tools.artifacts',
	},
	{
		id: 'todo',
		label: 'Список дел',
		detail: 'шаблоны, исключения, теги',
		icon: 'checklist',
		prefix: '1c-platform-tools.todo',
	},
	{
		id: 'metadata',
		label: 'Метаданные',
		detail: 'дерево метаданных, экспорт ER-диаграмм',
		icon: 'list-tree',
		prefix: '1c-platform-tools.metadata',
	},
	{
		id: 'testing',
		label: 'Тестирование',
		detail: 'фреймворки, каталоги тестов, тестовые расширения, отчёты',
		icon: 'beaker',
		prefix: '1c-platform-tools.testing',
	},
	{
		id: 'components',
		label: 'Внешние компоненты',
		detail: 'отладчик, дерево метаданных, OVM, Allure, JRE',
		icon: 'cloud-download',
		prefix: '1c-platform-tools.components',
	},
	{
		id: 'tools',
		label: 'Инструменты',
		detail: 'vanessa-runner, пути проекта, docker',
		icon: 'tools',
		prefix: '1c-platform-tools.paths',
	},
	{
		id: 'all',
		label: 'Все настройки расширения',
		detail: 'без фильтра по разделу',
		icon: 'settings-gear',
	},
];

/**
 * Строит запрос для `workbench.action.openSettings`.
 *
 * @param sectionId - Раздел настроек
 * @returns Строка запроса: расширение и префикс раздела
 */
export function settingsQuery(sectionId: SettingsSection['id']): string {
	const section = SETTINGS_SECTIONS.find((item) => item.id === sectionId);
	return section?.prefix ? `${SETTINGS_EXT} ${section.prefix}` : SETTINGS_EXT;
}
