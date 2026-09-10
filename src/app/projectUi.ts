import * as vscode from 'vscode';
import { logger } from '../shared/logger';

const log = logger.scope('ui');

const NOT_1C_PROJECT_MESSAGE =
	'Первая папка рабочей области не проект 1С: в её корне нет файла packagedef. ' +
	'Откройте папку проекта первой или создайте проект командой «1С: Зависимости: Инициализировать проект».';

/**
 * Создаёт handler с пользовательским уведомлением, если открыт не проект 1С.
 */
export function createShowNot1CProjectMessage(): () => void {
	return (): void => {
		log.info(NOT_1C_PROJECT_MESSAGE);
		void vscode.window.showInformationMessage(NOT_1C_PROJECT_MESSAGE);
	};
}
