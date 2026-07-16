/**
 * Типы для синхронного выполнения команд расширения через IPC (wait: true).
 */

/**
 * Флаги, которые MCP-сервер передаёт первым элементом args при вызове executeCommand.
 * Совместимы с IpcCommandFlags на стороне ipcServer.
 */
export interface CommandExecutionOptions {
	/** При true — команда выполняется синхронно и возвращает StructuredCommandResult. */
	wait?: boolean;
	/** Путь к корню проекта (передаётся из MCP вместо или вместе с контекстом workspace). */
	projectPath?: string;
	/** Путь к env.json относительно projectPath. */
	settingsFile?: string;
	/** Явная строка подключения к ИБ. */
	ibConnection?: string;
	/** SHA коммита для инкрементальной загрузки (пустая строка — полная загрузка). */
	sha?: string;
	/** Явный список имён расширений; без него — сохранённый выбор проекта. */
	extensions?: string[];
	/** Ключи включаемых тестовых фреймворков (testing.configure). */
	frameworks?: string[];
	/** Путь к внешней обработке/отчёту для запуска в Предприятии (vrunner run --execute). */
	execute?: string;
	/** Строка параметров запуска /C (vrunner run --command). */
	command?: string;
	/** Переопределения стандартных путей. */
	pathsOverride?: {
		cf?: string;
		out?: string;
		cfe?: string;
		epf?: string;
		erf?: string;
	};
}

/**
 * Результат синхронного выполнения команды.
 * Возвращается командой при wait: true; ipcServer оборачивает в commandResult.
 */
export interface StructuredCommandResult {
	/** Признак успешного завершения (exitCode === 0). */
	success: boolean;
	/** Код возврата vrunner. */
	exitCode: number;
	/** Стандартный вывод. */
	stdout: string;
	/** Стандартный вывод ошибок. */
	stderr: string;
	/** Путь к итоговому артефакту (.epf, .cf, .cfe и т.п.), если применимо. */
	artifact?: string;
}
