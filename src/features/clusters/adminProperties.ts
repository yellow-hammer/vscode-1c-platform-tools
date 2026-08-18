/**
 * Карточка администратора кластера или центрального сервера.
 *
 * Платформа заводит и правит администратора одной командой регистрации: запись
 * с существующим именем перезаписывается. Поэтому карточка одна на оба случая,
 * а различается лишь тем, можно ли менять имя.
 *
 * Пароль платформа не отдаёт: при правке поле всегда пустое и задаётся заново.
 * Способов входа два, и они независимы — пароль, средства операционной системы
 * или оба сразу.
 */

import type { AdminRegistration } from './racArgs';
import type { AdminInfo } from './model';
import type { PropertySection, PropertyValues } from './propertiesForm';

/**
 * Разделы карточки администратора.
 *
 * @param editing - Правка существующей записи: имя менять нельзя, иначе
 *   платформа заведёт вторую учётную запись вместо изменения первой
 * @returns Разделы карточки
 */
export function adminSections(editing: boolean): PropertySection[] {
	return [
		{
			title: 'Администратор',
			fields: [
				{ key: 'name', title: 'Имя', kind: editing ? 'readonly' : 'text' },
				{ key: 'descr', title: 'Описание', kind: 'text' },
			],
		},
		{
			title: 'Способы входа',
			fields: [
				{ key: 'auth-pwd', title: 'Аутентификация паролем', kind: 'flag' },
				{
					key: 'pwd',
					title: 'Пароль',
					kind: 'password',
					hint: editing
						? 'Платформа не отдаёт сохранённый пароль: оставьте пустым, чтобы задать вход без пароля, или введите новый.'
						: 'Пароль администратора.',
				},
				{ key: 'auth-os', title: 'Аутентификация средствами ОС', kind: 'flag' },
				{
					key: 'os-user',
					title: 'Пользователь операционной системы',
					kind: 'text',
					hint: 'Имя учётной записи ОС, например DOMAIN\\user.',
				},
			],
		},
	];
}

/**
 * Готовит значения формы из записи администратора.
 *
 * @param admin - Администратор из вывода rac; пусто при создании
 * @returns Значения формы
 */
export function toAdminForm(admin?: AdminInfo): PropertyValues {
	return {
		name: admin?.name ?? '',
		descr: admin?.descr ?? '',
		'auth-pwd': !admin || admin.auth.includes('pwd') ? 'on' : 'off',
		'auth-os': admin?.auth.includes('os') ? 'on' : 'off',
		'os-user': admin?.osUser ?? '',
		pwd: '',
	};
}

/**
 * Проверяет заполненность карточки администратора.
 *
 * @param values - Значения формы
 * @returns Список замечаний; пустой список — можно сохранять
 */
export function validateAdminForm(values: PropertyValues): string[] {
	const problems: string[] = [];
	if ((values.name ?? '').trim() === '') {
		problems.push('«Имя»: не может быть пустым');
	}
	const byPassword = values['auth-pwd'] === 'on';
	const byOs = values['auth-os'] === 'on';
	if (!byPassword && !byOs) {
		problems.push('Выберите хотя бы один способ входа: пароль или средства операционной системы');
	}
	if (byOs && (values['os-user'] ?? '').trim() === '') {
		problems.push('«Пользователь операционной системы»: обязателен при входе средствами ОС');
	}
	return problems;
}

/**
 * Собирает данные для регистрации администратора.
 *
 * @param values - Значения формы
 * @returns Данные для rac
 */
export function toAdminRegistration(values: PropertyValues): AdminRegistration {
	const byPassword = values['auth-pwd'] === 'on';
	const byOs = values['auth-os'] === 'on';
	const auth = byPassword && byOs ? 'pwd,os' : byOs ? 'os' : 'pwd';
	return {
		name: (values.name ?? '').trim(),
		auth,
		password: byPassword ? (values.pwd ?? '') : undefined,
		descr: values.descr ?? '',
		osUser: byOs ? (values['os-user'] ?? '').trim() : undefined,
	};
}
