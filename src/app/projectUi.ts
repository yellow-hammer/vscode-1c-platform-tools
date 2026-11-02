import * as vscode from 'vscode';
import { INITIALIZE_PROJECT_COMMAND, OPEN_PROJECT_LIST_COMMAND } from '../features/projects/projectCommandIds';
import { logger } from '../shared/logger';

const log = logger.scope('ui');

const NOT_1C_PROJECT_MESSAGE = 'В рабочей области нет проекта 1С: ни в одной папке нет файла packagedef.';
const INITIALIZE_ACTION = 'Инициализировать проект';
const OPEN_LIST_ACTION = 'Открыть проект из списка';

/**
 * Создаёт handler с уведомлением, если в окне нет packagedef.
 */
export function createShowNot1CProjectMessage(): () => void {
	return (): void => {
		log.info(NOT_1C_PROJECT_MESSAGE);
		void vscode.window
			.showInformationMessage(NOT_1C_PROJECT_MESSAGE, INITIALIZE_ACTION, OPEN_LIST_ACTION)
			.then((action) => {
				if (action === INITIALIZE_ACTION) {
					void vscode.commands.executeCommand(INITIALIZE_PROJECT_COMMAND);
				} else if (action === OPEN_LIST_ACTION) {
					void vscode.commands.executeCommand(OPEN_PROJECT_LIST_COMMAND);
				}
			});
	};
}
