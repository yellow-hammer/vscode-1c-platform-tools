/**
 * Свойства информационной базы: чтение и правка.
 *
 * Блокировку сеансов и регламентных заданий можно включить командой из дерева,
 * но у базы есть и остальные параметры — сообщение блокировки, интервал, код
 * доступа, выдача лицензий, профили безопасности. По одному их спрашивать
 * бессмысленно: администратор смотрит на них вместе и меняет два-три сразу.
 *
 * Модуль чистый: какие поля показывать, что из них редактируется и что именно
 * отправлять в rac. Отправляются только изменённые поля — вызов `infobase
 * update` присваивает всё, что в нём перечислено, и лишняя опция затёрла бы
 * чужую настройку.
 */

import type { InfobaseUpdate } from './racArgs';
import type { RacRecord } from './racOutput';
import {
	changedValues,
	toPropertyValues,
	type PropertySection,
	type PropertyValues,
} from './propertiesForm';

/**
 * Разделы карточки базы.
 *
 * Первый раздел только для чтения: размещение базы правится вместе с самой
 * базой и с сервером СУБД, из консоли кластера так не делают. Дальше идут
 * параметры режима работы — их и меняют.
 */
export const INFOBASE_SECTIONS: PropertySection[] = [
	{
		title: 'Размещение',
		fields: [
			{ key: 'name', title: 'Имя базы', kind: 'readonly' },
			{ key: 'dbms', title: 'СУБД', kind: 'readonly' },
			{ key: 'db-server', title: 'Сервер баз данных', kind: 'readonly' },
			{ key: 'db-name', title: 'База данных', kind: 'readonly' },
			{ key: 'db-user', title: 'Пользователь СУБД', kind: 'readonly' },
		],
	},
	{
		title: 'Блокировка сеансов',
		fields: [
			{ key: 'sessions-deny', title: 'Начало сеансов запрещено', kind: 'flag' },
			{
				key: 'denied-message',
				title: 'Сообщение пользователю',
				kind: 'text',
				hint: 'Текст увидит тот, кто попробует войти в базу во время блокировки.',
			},
			{
				key: 'permission-code',
				title: 'Код разрешения',
				kind: 'text',
				hint: 'Позволяет войти вопреки блокировке: указывается в параметре запуска /UC.',
			},
			{
				key: 'denied-from',
				title: 'Блокировка с',
				kind: 'date',
				hint: 'Пустое значение включает блокировку сразу. Формат: 2026-08-18T22:00:00.',
			},
			{ key: 'denied-to', title: 'Блокировка по', kind: 'date' },
		],
	},
	{
		title: 'Режим работы',
		fields: [
			{ key: 'scheduled-jobs-deny', title: 'Регламентные задания запрещены', kind: 'flag' },
			{
				key: 'license-distribution',
				title: 'Выдача лицензий сервером',
				kind: 'select',
				options: [
					['allow', 'Разрешена'],
					['deny', 'Запрещена'],
				],
				hint: 'Запрет заставляет клиентов искать лицензию самостоятельно.',
			},
			{ key: 'descr', title: 'Описание', kind: 'text' },
		],
	},
	{
		title: 'Профили безопасности',
		fields: [
			{ key: 'security-profile-name', title: 'Профиль безопасности', kind: 'text' },
			{
				key: 'safe-mode-security-profile-name',
				title: 'Профиль безопасного режима',
				kind: 'text',
				hint: 'Применяется к внешнему коду: обработкам, отчётам, расширениям.',
			},
		],
	},
];

/** Значения полей карточки базы. */
export type InfobaseFormValues = PropertyValues;

/**
 * Собирает значения формы из ответа rac.
 *
 * Флаги платформа отдаёт как `on`/`off`, а выдачу лицензий — как `allow`/`deny`;
 * форма работает с теми же значениями, чтобы сравнение с исходным состоянием
 * было честным.
 *
 * @param record - Поля базы из вывода rac
 * @returns Значения для формы
 */
export function toInfobaseForm(record: RacRecord): InfobaseFormValues {
	return toPropertyValues(record, INFOBASE_SECTIONS);
}

/**
 * Готовит изменение базы: только то, что действительно поменяли.
 *
 * `infobase update` присваивает каждое перечисленное поле, поэтому отправлять
 * форму целиком нельзя — параметр, которого администратор не касался, затёр бы
 * чужую правку, сделанную в другой консоли. Пустое значение при этом
 * осмысленно: так поле очищается.
 *
 * @param before - Значения, прочитанные с сервера
 * @param after - Значения формы
 * @returns Изменение для rac; пустой объект, если менять нечего
 */
export function buildInfobaseChange(
	before: InfobaseFormValues,
	after: InfobaseFormValues
): InfobaseUpdate {
	const change: InfobaseUpdate = {};
	for (const [key, to] of Object.entries(changedValues(before, after, INFOBASE_SECTIONS))) {
		switch (key) {
			case 'sessions-deny':
				change.sessionsDeny = to === 'on';
				break;
			case 'scheduled-jobs-deny':
				change.scheduledJobsDeny = to === 'on';
				break;
			case 'denied-message':
				change.deniedMessage = to;
				break;
			case 'permission-code':
				change.permissionCode = to;
				break;
			case 'denied-from':
				change.deniedFrom = to;
				break;
			case 'denied-to':
				change.deniedTo = to;
				break;
			case 'license-distribution':
				change.licenseDistribution = to === 'deny' ? 'deny' : 'allow';
				break;
			case 'descr':
				change.descr = to;
				break;
			case 'security-profile-name':
				change.securityProfile = to;
				break;
			case 'safe-mode-security-profile-name':
				change.safeModeSecurityProfile = to;
				break;
			default:
				break;
		}
	}
	return change;
}

/**
 * Проверяет значения формы перед отправкой.
 *
 * @param values - Значения формы
 * @returns Список замечаний; пустой список — можно сохранять
 */
export function validateInfobaseForm(values: InfobaseFormValues): string[] {
	const problems: string[] = [];
	const dateFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
	for (const key of ['denied-from', 'denied-to']) {
		const value = (values[key] ?? '').trim();
		if (value !== '' && !dateFormat.test(value)) {
			problems.push(`«${key === 'denied-from' ? 'Блокировка с' : 'Блокировка по'}»: ожидается 2026-08-18T22:00:00`);
		}
	}
	if (values['sessions-deny'] === 'on' && (values['denied-message'] ?? '').trim() === '') {
		problems.push('При запрете сеансов стоит указать сообщение: иначе пользователь не поймёт, что происходит');
	}
	return problems;
}

/**
 * Сообщает, есть ли что отправлять.
 *
 * @param change - Подготовленное изменение
 * @returns true, если изменений нет
 */
export function isEmptyInfobaseChange(change: InfobaseUpdate): boolean {
	return Object.keys(change).length === 0;
}
