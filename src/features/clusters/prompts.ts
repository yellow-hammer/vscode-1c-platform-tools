/**
 * Диалоги консоли администрирования кластера.
 *
 * Ввод собран в одном модуле: команды остаются короткими, а формулировки
 * вопросов и проверки ввода не расходятся между похожими действиями.
 */

import * as vscode from 'vscode';
import type { InfobaseDropMode, RacCredentials } from './racArgs';

/**
 * Спрашивает администратора информационной базы.
 *
 * Вопрос возникает только тогда, когда rac отказал по аутентификации, поэтому
 * в заголовке named база, из-за которой он появился.
 *
 * @param infobaseName - Имя информационной базы
 * @returns Учётные данные или undefined при отказе
 */
export async function promptInfobaseCredentials(
	infobaseName: string
): Promise<RacCredentials | undefined> {
	const user = await vscode.window.showInputBox({
		title: `Администратор базы «${infobaseName}»`,
		prompt: 'Для этого действия платформа требует администратора информационной базы',
		ignoreFocusOut: true,
		validateInput: (value) => (value.trim() === '' ? 'Укажите имя администратора' : undefined),
	});
	if (user === undefined) {
		return undefined;
	}
	const password = await vscode.window.showInputBox({
		title: `Администратор базы «${infobaseName}»`,
		prompt: `Пароль пользователя ${user.trim()}`,
		password: true,
		ignoreFocusOut: true,
	});
	if (password === undefined) {
		return undefined;
	}
	return { user: user.trim(), password };
}

/** Параметры блокировки начала сеансов. */
export interface SessionLockPrompt {
	/** Сообщение, которое увидит пользователь при попытке входа. */
	deniedMessage: string;
	/** Код разрешения для входа вопреки блокировке. */
	permissionCode: string;
}

/**
 * Спрашивает параметры блокировки начала сеансов.
 *
 * @param infobaseName - Имя информационной базы
 * @returns Параметры блокировки или undefined при отказе
 */
export async function promptSessionLock(
	infobaseName: string
): Promise<SessionLockPrompt | undefined> {
	const deniedMessage = await vscode.window.showInputBox({
		title: `Блокировка сеансов базы «${infobaseName}»`,
		prompt: 'Сообщение, которое увидит пользователь при попытке начать сеанс',
		value: 'Выполняется обслуживание информационной базы',
		ignoreFocusOut: true,
	});
	if (deniedMessage === undefined) {
		return undefined;
	}
	const permissionCode = await vscode.window.showInputBox({
		title: `Блокировка сеансов базы «${infobaseName}»`,
		prompt: 'Код разрешения, позволяющий начать сеанс вопреки блокировке',
		value: 'KeyCode',
		ignoreFocusOut: true,
	});
	if (permissionCode === undefined) {
		return undefined;
	}
	return { deniedMessage, permissionCode };
}

/**
 * Спрашивает, что делать с базой данных при удалении информационной базы.
 *
 * Вопрос отдельный от подтверждения: у удаления три разных последствия, и
 * выбирать их кнопками в модальном окне пришлось бы вслепую.
 *
 * @param infobaseName - Имя информационной базы
 * @returns Выбранный вариант или undefined при отказе
 */
export async function promptInfobaseDropMode(
	infobaseName: string
): Promise<InfobaseDropMode | undefined> {
	const items: Array<vscode.QuickPickItem & { mode: InfobaseDropMode }> = [
		{
			label: 'Только из кластера',
			detail: 'База данных на сервере СУБД остаётся',
			mode: 'keep',
		},
		{
			label: 'Вместе с базой данных',
			detail: 'База данных удаляется на сервере СУБД',
			mode: 'drop',
		},
		{
			label: 'Очистить базу данных',
			detail: 'Данные удаляются, пустая база данных остаётся на сервере СУБД',
			mode: 'clear',
		},
	];
	const choice = await vscode.window.showQuickPick(items, {
		title: `Удаление базы «${infobaseName}»`,
		placeHolder: 'Что сделать с базой данных',
		ignoreFocusOut: true,
	});
	return choice?.mode;
}

/** Как завершать сеанс: молча или с сообщением пользователю. */
export type TerminateChoice = { confirmed: false } | { confirmed: true; errorMessage?: string };

/**
 * Спрашивает подтверждение завершения сеанса.
 *
 * Сообщение пользователю платформа показывает в окне закрываемого сеанса —
 * администратору обычно есть что сказать («идёт обслуживание»), поэтому вариант
 * с текстом предлагается прямо в подтверждении, а не отдельной командой.
 *
 * @param title - Заголовок подтверждения
 * @param detail - Пояснение о последствиях
 * @returns Решение пользователя и, при необходимости, текст сообщения
 */
export async function confirmSessionAction(
	title: string,
	detail: string
): Promise<TerminateChoice> {
	const plain = 'Выполнить';
	const withMessage = 'С сообщением…';
	const choice = await vscode.window.showWarningMessage(
		title,
		{ modal: true, detail },
		{ title: plain },
		{ title: withMessage }
	);
	if (choice?.title === plain) {
		return { confirmed: true };
	}
	if (choice?.title !== withMessage) {
		return { confirmed: false };
	}
	const errorMessage = await vscode.window.showInputBox({
		title,
		prompt: 'Сообщение, которое увидит пользователь',
		value: 'Выполняется обслуживание информационной базы',
		ignoreFocusOut: true,
	});
	return errorMessage === undefined ? { confirmed: false } : { confirmed: true, errorMessage };
}

/**
 * Спрашивает подтверждение необратимого действия.
 *
 * @param title - Заголовок вопроса
 * @param detail - Подробности: что именно произойдёт
 * @param confirmLabel - Подпись подтверждающей кнопки
 * @returns true, если пользователь подтвердил
 */
export async function confirmAction(
	title: string,
	detail: string,
	confirmLabel: string
): Promise<boolean> {
	const choice = await vscode.window.showWarningMessage(
		title,
		{ modal: true, detail },
		{ title: confirmLabel }
	);
	return choice?.title === confirmLabel;
}
