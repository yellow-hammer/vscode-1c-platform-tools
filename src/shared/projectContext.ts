/**
 * Уведомление о том, что в рабочей области появился проект 1С (создан packagedef).
 * Используется для полной активации расширения после инициализации packagedef из палитры команд.
 */

let onProjectCreatedCallback: (() => void) | undefined;

/**
 * Регистрирует callback, вызываемый при создании файла packagedef в workspace
 * (после успешного выполнения «Инициализировать проект»).
 */
export function setOnProjectCreated(callback: () => void): void {
	onProjectCreatedCallback = callback;
}

/**
 * Вызывается после успешного создания packagedef.
 * Приводит к полной активации расширения (контекст is1CProject, обновление дерева).
 */
export function notifyProjectCreated(): void {
	onProjectCreatedCallback?.();
}
