/**
 * Константы для работы с vrunner и обработками
 */

/**
 * Путь к обработке из поставки vanessa-runner для параметра --execute.
 * Макрос $runnerRoot разворачивает сам vrunner в свой каталог — работает
 * и для локальной установки (oscript_modules), и для глобальной.
 */
export function vanessaRunnerEpf(epfName: string): string {
	return `$runnerRoot/epf/${epfName}`;
}

/**
 * Имена обработок vanessa-runner
 */
export const EPF_NAMES = {
	CLOSE_ENTERPRISE: 'ЗакрытьПредприятие.epf',
	BLOCK_EXTERNAL_RESOURCES: 'БлокировкаРаботыСВнешнимиРесурсами.epf',
	/** Загрузка .cfe в режиме предприятия, vanessa-runner 2.x */
	LOAD_EXTENSION: 'ЗагрузитьРасширениеВРежимеПредприятия.epf',
	/** То же в 3.x — обработка переименована (параметр Путь= прежний) */
	LOAD_EXTENSION_V3: 'РаботаСРасширениями.epf'
} as const;

/**
 * Команды для обработок
 */
export const EPF_COMMANDS = {
	UPDATE_DATABASE: 'ЗапуститьОбновлениеИнформационнойБазы;ЗавершитьРаботуСистемы;',
	BLOCK_EXTERNAL_RESOURCES: 'ЗапретитьРаботуСВнешнимиРесурсами;ЗавершитьРаботуСистемы',
	LOAD_EXTENSION: (cfeFilePath: string) => `Путь=${cfeFilePath};ЗавершитьРаботуСистемы;`
} as const;
