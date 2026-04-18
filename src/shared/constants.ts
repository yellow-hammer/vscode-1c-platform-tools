/**
 * Константы для работы с vrunner и обработками
 */

/**
 * Корневая папка vanessa-runner в oscript_modules
 */
export const VANESSA_RUNNER_ROOT = 'oscript_modules/vanessa-runner';

/**
 * Папка с обработками в vanessa-runner
 */
export const VANESSA_RUNNER_EPF = 'epf';

/**
 * Имена обработок vanessa-runner
 */
export const EPF_NAMES = {
	CLOSE_ENTERPRISE: 'ЗакрытьПредприятие.epf',
	BLOCK_EXTERNAL_RESOURCES: 'БлокировкаРаботыСВнешнимиРесурсами.epf',
	LOAD_EXTENSION: 'ЗагрузитьРасширениеВРежимеПредприятия.epf'
} as const;

/**
 * Команды для обработок
 */
export const EPF_COMMANDS = {
	UPDATE_DATABASE: 'ЗапуститьОбновлениеИнформационнойБазы;ЗавершитьРаботуСистемы;',
	BLOCK_EXTERNAL_RESOURCES: 'ЗапретитьРаботуСВнешнимиРесурсами;ЗавершитьРаботуСистемы',
	LOAD_EXTENSION: (cfeFilePath: string) => `Путь=${cfeFilePath};ЗавершитьРаботуСистемы;`
} as const;
