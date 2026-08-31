/**
 * Уведомление, когда для кластера или базы нет подходящего набора.
 *
 * Не Quick Pick и не модальное окно: короткое сообщение в углу и кнопка
 * открыть форму учётных данных. Повтор той же причины гасится на время,
 * чтобы раскрытие дерева не засыпало уголок.
 */

import * as vscode from 'vscode';

/** Почему набор не подошёл. */
export type MissingCredentialsKind =
	| 'clusterMissing'
	| 'clusterRejected'
	| 'agentMissing'
	| 'agentRejected'
	| 'infobaseMissing'
	| 'infobaseRejected';

/** Событие для уведомления. */
export interface MissingCredentialsEvent {
	kind: MissingCredentialsKind;
	infobaseName?: string;
}

/** Подпись кнопки в уведомлении. */
const OPEN_ACTION = 'Открыть';

/** Сколько не повторять то же уведомление. */
const COOLDOWN_MS = 45_000;

/**
 * Собирает короткий текст уведомления.
 *
 * @param event - Причина
 * @returns Текст для угла экрана
 */
export function missingCredentialsMessage(event: MissingCredentialsEvent): string {
	switch (event.kind) {
		case 'clusterMissing':
			return 'Нет учётных данных администратора кластера';
		case 'clusterRejected':
			return 'Набор администратора кластера не принят';
		case 'agentMissing':
			return 'Нет учётных данных администратора центрального сервера';
		case 'agentRejected':
			return 'Набор администратора центрального сервера не принят';
		case 'infobaseMissing':
			return event.infobaseName
				? `Нет учётных данных для базы «${event.infobaseName}»`
				: 'Нет учётных данных информационной базы';
		case 'infobaseRejected':
			return event.infobaseName
				? `Набор не принят для базы «${event.infobaseName}»`
				: 'Набор информационной базы не принят';
		default: {
			const exhaustive: never = event.kind;
			return exhaustive;
		}
	}
}

/**
 * Создаёт обработчик: показывает уведомление и открывает форму по кнопке.
 *
 * @param openForm - Открыть форму учётных данных; получает причину, чтобы
 * форма открылась на нужной группе наборов
 * @returns Функция, которую вызывает сервис кластера
 */
export function createCredentialsNotifier(
	openForm: (event: MissingCredentialsEvent) => void
): (event: MissingCredentialsEvent) => void {
	const lastShown = new Map<string, number>();
	return (event) => {
		const key = `${event.kind}:${event.infobaseName ?? ''}`;
		const now = Date.now();
		if ((lastShown.get(key) ?? 0) + COOLDOWN_MS > now) {
			return;
		}
		lastShown.set(key, now);
		void vscode.window.showInformationMessage(missingCredentialsMessage(event), OPEN_ACTION).then((choice) => {
			if (choice === OPEN_ACTION) {
				openForm(event);
			}
		});
	};
}
