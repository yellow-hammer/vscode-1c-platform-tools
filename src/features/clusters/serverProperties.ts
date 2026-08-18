/**
 * Свойства рабочего сервера кластера.
 *
 * Набор полей повторяет диалог консоли кластера: размещение сервера, пределы
 * памяти рабочих процессов, ограничения на процесс и расписание перезапуска.
 *
 * Часть полей платформа отдаёт, но менять не даёт: имя компьютера и порт агента
 * задаются при добавлении сервера в кластер, а имя сервера в 8.5 команда
 * `server update` не принимает. Такие поля показываются только для чтения.
 */

import type { RacRecord } from './racOutput';
import {
	changedValues,
	toPropertyValues,
	validateNumbers,
	type PropertySection,
	type PropertyValues,
} from './propertiesForm';

/** Разделы карточки рабочего сервера. */
export const SERVER_SECTIONS: PropertySection[] = [
	{
		title: 'Размещение',
		fields: [
			{ key: 'name', title: 'Имя сервера', kind: 'readonly' },
			{ key: 'agent-host', title: 'Компьютер', kind: 'readonly' },
			{ key: 'agent-port', title: 'Порт агента', kind: 'readonly' },
			{ key: 'cluster-port', title: 'Порт главного менеджера', kind: 'readonly' },
			{
				key: 'port-range',
				title: 'Диапазон портов процессов',
				kind: 'text',
				hint: 'Формат: 1560:1591. Несколько диапазонов перечисляются через запятую.',
			},
			{
				key: 'using',
				title: 'Использование',
				kind: 'select',
				options: [
					['main', 'Центральный сервер'],
					['normal', 'Обычный сервер'],
				],
			},
		],
	},
	{
		title: 'Память рабочих процессов',
		fields: [
			{
				key: 'safe-call-memory-limit',
				title: 'Безопасный расход за вызов, байт',
				kind: 'number',
				hint: 'Значение 0 отключает ограничение.',
			},
			{ key: 'safe-working-processes-memory-limit', title: 'Предел памяти процессов, байт', kind: 'number' },
			{ key: 'critical-total-memory', title: 'Критический объём памяти, байт', kind: 'number' },
			{ key: 'temporary-allowed-total-memory', title: 'Временно допустимый объём, байт', kind: 'number' },
			{
				key: 'temporary-allowed-total-memory-time-limit',
				title: 'Интервал превышения, с',
				kind: 'number',
			},
			{ key: 'memory-limit', title: 'Предел памяти на процесс, КБ', kind: 'number' },
		],
	},
	{
		title: 'Ограничения на процесс',
		fields: [
			{ key: 'infobases-limit', title: 'Информационных баз на процесс', kind: 'number' },
			{ key: 'connections-limit', title: 'Соединений на процесс', kind: 'number' },
			{
				key: 'dedicate-managers',
				title: 'Менеджер под каждый сервис',
				kind: 'select',
				options: [
					['none', 'Все сервисы в одном менеджере'],
					['all', 'Отдельный менеджер на сервис'],
				],
			},
		],
	},
	{
		title: 'Дополнительно',
		fields: [
			{ key: 'service-principal-name', title: 'Имя службы (SPN)', kind: 'text' },
			{
				key: 'restart-schedule',
				title: 'Расписание перезапуска',
				kind: 'text',
				hint: 'Формат расписания платформы. Пустое значение отключает перезапуск по расписанию.',
			},
		],
	},
];

/**
 * Готовит значения формы из ответа rac.
 *
 * @param record - Поля сервера
 * @returns Значения формы
 */
export function toServerForm(record: RacRecord): PropertyValues {
	return toPropertyValues(record, SERVER_SECTIONS);
}

/**
 * Готовит изменение сервера: только изменённые поля.
 *
 * @param before - Значения, прочитанные с сервера
 * @param after - Значения формы
 * @returns Опции для `server update`
 */
export function buildServerChange(
	before: PropertyValues,
	after: PropertyValues
): Record<string, string> {
	return changedValues(before, after, SERVER_SECTIONS);
}

/**
 * Проверяет значения формы сервера.
 *
 * @param values - Значения формы
 * @returns Список замечаний; пустой список — можно сохранять
 */
export function validateServerForm(values: PropertyValues): string[] {
	const problems = validateNumbers(values, SERVER_SECTIONS);
	const range = (values['port-range'] ?? '').trim();
	if (range !== '' && !/^\d{1,5}:\d{1,5}(\s*,\s*\d{1,5}:\d{1,5})*$/.test(range)) {
		problems.push('«Диапазон портов процессов»: ожидается 1560:1591');
	}
	return problems;
}
