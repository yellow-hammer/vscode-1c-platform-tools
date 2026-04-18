import * as vscode from 'vscode';
import { logger } from '../shared/logger';

const NOT_1C_PROJECT_MESSAGE =
	'Откройте папку проекта 1С (в корне должен быть файл packagedef). ' +
	'Чтобы создать новый проект, выполните команду «1C: Зависимости: Инициализировать проект» из палитры команд.';

/**
 * Создаёт handler с пользовательским уведомлением, если открыт не проект 1С.
 */
export function createShowNot1CProjectMessage(): () => void {
	return (): void => {
		logger.info(NOT_1C_PROJECT_MESSAGE);
		void vscode.window.showInformationMessage(NOT_1C_PROJECT_MESSAGE);
	};
}
