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
	/**
	 * Обновлять ли конфигурацию БД тем же вызовом после загрузки.
	 *
	 * Без явного значения решает настройка `configuration.updateDbAfterLoad`;
	 * вопрос при этом задаётся только интерактивному пользователю.
	 */
	updateDb?: boolean;
	/** Явный список имён расширений; без него — сохранённый выбор проекта. */
	extensions?: string[];
	/** Имя env-профиля для env.selectProfile (id, имя файла или подпись). */
	profile?: string;
	/** Ключи включаемых тестовых фреймворков (test.configure). */
	frameworks?: string[];
	/** Путь к внешней обработке/отчёту для запуска в Предприятии (vrunner run --execute). */
	execute?: string;
	/** Строка параметров запуска /C (vrunner run --command). */
	command?: string;
	/** Сообщение при попытке начать сеанс в заблокированной базе. */
	lockMessage?: string;
	/** Код допуска в заблокированную базу. */
	accessCode?: string;
	/** Время начала блокировки сеансов, например 2040-12-31T23:59:59 (только 2.x). */
	lockStart?: string;
	/** Время окончания блокировки сеансов (только 2.x). */
	lockEnd?: string;
	/** Отбор сеансов: appid=Designer|name=Администратор. */
	sessionFilter?: string;
	/** Режим отбора сеансов: ONLY, OFF, EXCEPT; DEFAULT и ALL - только 2.x. */
	sessionFilterMode?: string;
	/** Не запрещать начало сеансов при их завершении. */
	keepSessionsUnlocked?: boolean;
	/** Ожидание завершения сеансов, секунды (только 3.x). */
	sessionTimeout?: number;
	/** Число попыток добить зависшие сеансы при завершении (только 3.x). */
	sessionRetry?: number;
	/** Показывать соединения информационной базы вместе с сеансами (только 3.x). */
	sessionConnections?: boolean;
	/** Идентификатор или название пайплайна для запуска (pipelines.run). */
	pipeline?: string;
}

/**
 * Сводка прогона тестов по jUnit-отчёту (wait: true у тестовых команд).
 */
export interface TestRunStats {
	/** Всего тестов в отчёте. */
	total: number;
	/** Успешно пройдено. */
	passed: number;
	/** Упало (failure). */
	failed: number;
	/** Ошибки выполнения (error). */
	errors: number;
	/** Пропущено. */
	skipped: number;
	/** Файл или каталог отчёта, по которому построена сводка. */
	reportPath: string;
	/** Имена упавших тестов (с ограничением количества). */
	failedTests: string[];
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
	/** Сводка прогона тестов по jUnit-отчёту (только тестовые команды). */
	tests?: TestRunStats;
	/** Ошибки синтаксического контроля по jUnit-отчёту (только syntax-check). */
	errors?: SyntaxCheckError[];
}

/**
 * Ошибка синтаксического контроля с адресом в исходниках.
 * Возвращается агенту, чтобы он правил код, а не вычитывал stdout.
 */
export interface SyntaxCheckError {
	/** Путь к файлу модуля относительно корня проекта (если раскладывается). */
	filepath: string;
	/** Путь по метаданным из отчёта (ОбщийМодуль.Имя.Модуль). */
	metadataPath: string;
	/** Уровень: ошибка или предупреждение. */
	severity: 'error' | 'warning';
	/** Текст сообщения. */
	message: string;
}
