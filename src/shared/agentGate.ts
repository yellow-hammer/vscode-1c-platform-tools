import type { StructuredCommandResult } from './commandExecutionTypes';

/**
 * Гейт агентных вызовов: команды, вызванные агентом (MCP), не должны
 * открывать окна VS Code — пользователь может быть не за экраном
 * (web-сессия agent-клиента, телефон).
 *
 * MCP всегда передаёт первым аргументом простой объект опций с известными
 * ключами; палитра и command-ссылки не передают ничего, а команды деревьев,
 * в том числе кнопки заголовка панели, получают элемент дерева.
 */

/** Ключи объекта опций, которые передаёт MCP. */
const AGENT_OPTION_KEYS = [
	'wait',
	'projectPath',
	'settingsFile',
	'ibConnection',
	'sha',
	'extensions',
	'frameworks',
	'execute',
	'command',
	'resource',
	'include',
	'exclude',
	'packageName',
	'dependencyTarget',
] as const;

/**
 * Простой объект: литерал или результат `JSON.parse`, а не экземпляр класса.
 *
 * @param arg - Проверяемое значение
 */
export function isPlainObject(arg: unknown): arg is Record<string, unknown> {
	if (typeof arg !== 'object' || arg === null) {
		return false;
	}
	const proto = Object.getPrototypeOf(arg);
	return proto === Object.prototype || proto === null;
}

/**
 * Распознаёт объект опций агентного вызова.
 *
 * @param arg - Первый аргумент команды
 * @returns true для объекта опций MCP (включая пустой объект); false для элементов деревьев
 */
export function isAgentOptions(arg: unknown): boolean {
	if (!isPlainObject(arg)) {
		return false;
	}
	const keys = Object.keys(arg);
	if (keys.length === 0) {
		return true;
	}
	return AGENT_OPTION_KEYS.some((key) => key in (arg as Record<string, unknown>));
}

/**
 * Структурированный отказ агенту от интерактивной команды.
 *
 * @param hint - Подсказка, как выполнить операцию без интерактива
 * @returns Результат с текстом отказа в stderr
 */
export function agentInteractiveError(hint: string): StructuredCommandResult {
	return {
		success: false,
		exitCode: 1,
		stdout: '',
		stderr: `Команда открывает окна VS Code и недоступна агенту. ${hint}`,
	};
}

/**
 * Обёртка обработчика чисто интерактивной команды: агентный вызов
 * отклоняется структурированной ошибкой до открытия окон, поведение
 * из палитры/деревьев не меняется.
 *
 * @param hint - Подсказка агенту (неинтерактивная альтернатива)
 * @param handler - Исходный обработчик команды
 * @returns Обработчик с гейтом
 */
export function uiOnlyHandler(
	hint: string,
	handler: (...args: unknown[]) => unknown
): (...args: unknown[]) => unknown {
	return (...args: unknown[]) => {
		if (isAgentOptions(args[0])) {
			return agentInteractiveError(hint);
		}
		return handler(...args);
	};
}
