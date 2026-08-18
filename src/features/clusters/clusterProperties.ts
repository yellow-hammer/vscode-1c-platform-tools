/**
 * Свойства кластера серверов: чтение и правка.
 *
 * Кластер — объект уровня агента: его параметры читаются без аутентификации,
 * а меняются только администратором центрального сервера. Поэтому карточка
 * открывается всегда, а сохранение требует, чтобы в подключении был задан
 * администратор центрального сервера.
 *
 * Платформа читает флаги как `1`/`0`, а принимает как `yes`/`no` — карточка
 * переводит их сама, иначе сохранение падало бы на разборе параметра.
 */

import type { ClusterUpdate } from './racArgs';
import { isRacFlagOn } from './model';
import type { RacRecord } from './racOutput';
import { validateNumbers, type PropertySection, type PropertyValues } from './propertiesForm';

/**
 * Разделы карточки кластера.
 *
 * Порядок повторяет консоль кластера: сначала «что это за кластер», потом
 * параметры перезапуска рабочих процессов, потом сеансы и отказоустойчивость.
 */
export const CLUSTER_SECTIONS: PropertySection[] = [
	{
		title: 'Кластер',
		fields: [
			{ key: 'cluster', title: 'Идентификатор', kind: 'readonly' },
			{ key: 'host', title: 'Центральный сервер', kind: 'readonly' },
			{ key: 'port', title: 'Порт менеджера', kind: 'readonly' },
			{ key: 'name', title: 'Имя кластера', kind: 'text' },
		],
	},
	{
		title: 'Перезапуск рабочих процессов',
		fields: [
			{
				key: 'lifetime-limit',
				title: 'Период перезапуска, с',
				kind: 'number',
				hint: 'Значение 0 отключает перезапуск по расписанию.',
			},
			{
				key: 'max-memory-size',
				title: 'Порог памяти процесса, КБ',
				kind: 'number',
				hint: 'Превышение дольше указанного времени приводит к перезапуску процесса.',
			},
			{ key: 'max-memory-time-limit', title: 'Время превышения, с', kind: 'number' },
			{ key: 'errors-count-threshold', title: 'Порог ошибок, %', kind: 'number' },
			{ key: 'kill-problem-processes', title: 'Завершать зависшие процессы', kind: 'flag' },
			{ key: 'kill-by-memory-with-dump', title: 'Снимать дамп при превышении памяти', kind: 'flag' },
		],
	},
	{
		title: 'Сеансы и отказоустойчивость',
		fields: [
			{
				key: 'expiration-timeout',
				title: 'Принудительное завершение, с',
				kind: 'number',
				hint: 'Через сколько секунд неактивный сеанс завершается принудительно.',
			},
			{ key: 'session-fault-tolerance-level', title: 'Уровень отказоустойчивости', kind: 'number' },
			{
				key: 'load-balancing-mode',
				title: 'Балансировка нагрузки',
				kind: 'select',
				options: [
					['performance', 'По производительности'],
					['memory', 'По памяти'],
				],
			},
			{ key: 'security-level', title: 'Уровень безопасности соединений', kind: 'number' },
		],
	},
	{
		title: 'Дополнительно',
		fields: [
			{ key: 'ping-period', title: 'Период проверки связи, мс', kind: 'number' },
			{ key: 'ping-timeout', title: 'Таймаут проверки связи, мс', kind: 'number' },
			{
				key: 'allow-access-right-audit-events-recording',
				title: 'Записывать события аудита прав доступа',
				kind: 'flag',
			},
			{
				key: 'restart-schedule',
				title: 'Расписание перезапуска',
				kind: 'text',
				hint: 'Формат расписания платформы. Пустое значение отключает перезапуск по расписанию.',
			},
		],
	},
];

/** Поля, которые принимает `cluster update`. */
const UPDATABLE = new Set(
	CLUSTER_SECTIONS.flatMap((section) => section.fields)
		.filter((field) => field.kind !== 'readonly')
		.map((field) => field.key)
);

/**
 * Готовит изменение кластера: только то, что действительно поменяли.
 *
 * Флаги переводятся в `yes`/`no`: платформа читает их числом, а принимает
 * словом, и отправка прочитанного значения обратно завалила бы разбор.
 *
 * @param before - Значения, прочитанные с сервера
 * @param after - Значения формы
 * @returns Опции для `cluster update`
 */
export function buildClusterChange(before: PropertyValues, after: PropertyValues): ClusterUpdate {
	const change: ClusterUpdate = {};
	const flags = new Set(
		CLUSTER_SECTIONS.flatMap((section) => section.fields)
			.filter((field) => field.kind === 'flag')
			.map((field) => field.key)
	);
	for (const key of UPDATABLE) {
		const from = before[key] ?? '';
		const to = after[key] ?? '';
		if (from === to) {
			continue;
		}
		change[key] = flags.has(key) ? (isRacFlagOn(to) ? 'yes' : 'no') : to;
	}
	return change;
}

/**
 * Приводит прочитанные значения к виду формы.
 *
 * @param record - Поля кластера из вывода rac
 * @returns Значения формы
 */
export function toClusterForm(record: RacRecord): PropertyValues {
	const values: PropertyValues = {};
	for (const section of CLUSTER_SECTIONS) {
		for (const field of section.fields) {
			const raw = record[field.key] ?? '';
			values[field.key] = field.kind === 'flag' ? (isRacFlagOn(raw) ? 'on' : 'off') : raw;
		}
	}
	return values;
}

/**
 * Проверяет значения формы кластера.
 *
 * @param values - Значения формы
 * @returns Список замечаний; пустой список — можно сохранять
 */
export function validateClusterForm(values: PropertyValues): string[] {
	const problems = validateNumbers(values, CLUSTER_SECTIONS);
	if ((values.name ?? '').trim() === '') {
		problems.unshift('«Имя кластера»: не может быть пустым');
	}
	return problems;
}
