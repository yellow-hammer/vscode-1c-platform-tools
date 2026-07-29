/**
 * Разбор запросов IPC: проверка проекта и флагов выполнения.
 *
 * Здесь решается, выполнится ли вызов агента и в каком проекте. Модуль
 * намеренно не зависит от vscode: правила сверки путей проверяются тестами,
 * а не догадками о поведении на чужой файловой системе.
 */
import * as path from 'node:path';
import type { CommandExecutionOptions } from './commandExecutionTypes';

/**
 * Проверяет, что путь проекта совпадает с одной из папок рабочей области или
 * лежит внутри неё.
 *
 * Относительный путь считается от первой папки рабочей области. На Windows
 * регистр не учитывается. Пустой список папок означает, что проверять нечего.
 *
 * @param expectedProjectPath - Путь проекта из запроса
 * @param workspaceRoots - Пути папок, открытых в VS Code
 * @returns true, если путь принадлежит рабочей области
 */
export function isProjectPathInWorkspace(
	expectedProjectPath: string,
	workspaceRoots: readonly string[]
): boolean {
	if (workspaceRoots.length === 0) {
		return true;
	}
	const sep = path.sep;
	const norm = (value: string): string => (sep === '\\' ? value.toLowerCase() : value);
	const sameOrUnder = (a: string, b: string): boolean => {
		const aNorm = norm(a);
		const bNorm = norm(b);
		return (
			aNorm === bNorm ||
			aNorm.startsWith(norm(b + sep)) ||
			bNorm.startsWith(norm(a + sep))
		);
	};
	const firstRoot = path.resolve(workspaceRoots[0]);
	const expectedNorm = path.isAbsolute(expectedProjectPath)
		? path.resolve(expectedProjectPath)
		: path.resolve(firstRoot, expectedProjectPath);
	return workspaceRoots.some((root) => sameOrUnder(expectedNorm, path.resolve(root)));
}

/**
 * Извлекает флаги выполнения из первого элемента аргументов команды.
 *
 * MCP-сервер передаёт объект с флагами первым аргументом. Вызовы из UI и
 * старых клиентов приходят с другими аргументами: тогда флагов нет.
 *
 * @param args - Аргументы команды
 * @returns Флаги выполнения (пустой объект, если их нет)
 */
export function extractCommandFlags(args: unknown[]): CommandExecutionOptions {
	if (args.length === 0) {
		return {};
	}
	const first = args[0];
	if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
		return first as CommandExecutionOptions;
	}
	return {};
}
