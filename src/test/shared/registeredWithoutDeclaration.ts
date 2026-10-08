/**
 * Команды, зарегистрированные в коде без строки в package.json.
 * Общий список для сверки манифеста и списка инструментов MCP.
 */
export const REGISTERED_WITHOUT_DECLARATION: ReadonlySet<string> = new Set([
	'1c-platform-tools.env.status',
	'1c-platform-tools.env.refreshVersion',
	'1c-platform-tools.env.statusBarRefresh',
	'1c-platform-tools.epf.run',
	'1c-platform-tools.server.statusBarRefresh',
	'1c-platform-tools.serviceFiles.ensure',
	'1c-platform-tools.todo.openLocation',
]);
