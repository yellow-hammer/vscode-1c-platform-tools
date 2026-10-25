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
	/** Каталог, в котором команда инициализации создаёт packagedef. */
	root?: string;
	/** Путь к env.json относительно projectPath. */
	settingsFile?: string;
	/** Явная строка подключения к ИБ. */
	ibConnection?: string;
	/** SHA коммита для инкрементальной загрузки (пустая строка — полная загрузка). */
	sha?: string;
	/**
	 * Обновлять ли конфигурацию БД тем же вызовом после загрузки.
	 *
	 * Без явного значения решает настройка `cf.load.updateDb`;
	 * вопрос при этом задаётся только интерактивному пользователю.
	 */
	updateDb?: boolean;
	/** Явный список имён расширений; без него — сохранённый выбор проекта. */
	extensions?: string[];
	/** Профиль: для env.selectProfile — какой выбрать, для pipelines.run — на этот прогон (id, имя файла или подпись). */
	profile?: string;
	/** Окружение: для env.selectEnvironment — какое выбрать, для pipelines.run — на этот прогон; пустая строка — по умолчанию. */
	environment?: string;
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
	/** Каталог собранных файлов: относительно projectPath или абсолютный, с переменными. */
	outputDirectory?: string;
	/** Имя собранного файла без расширения, с переменными `${name}`, `${folder}`, `${version}`, `${gitBranch}`. */
	outputName?: string;
	/** Метод HTTP запроса к OData: GET, POST, PUT, PATCH, DELETE (odata.query). */
	method?: string;
	/** Ресурс OData: набор, элемент, свойство или `$metadata` (odata.query). */
	resource?: string;
	/** Адрес своей публикации ИБ; без него запрос идёт в автономный сервер проекта (odata.query). */
	url?: string;
	/** Отбор `$filter` (odata.query). */
	filter?: string;
	/** Поля `$select` через запятую (odata.query). */
	select?: string;
	/** Связанные данные `$expand` (odata.query). */
	expand?: string;
	/** Сортировка `$orderby` (odata.query). */
	orderby?: string;
	/** Число записей `$top` (odata.query). */
	top?: number;
	/** Пропуск записей `$skip` (odata.query). */
	skip?: number;
	/** Тело POST, PUT и PATCH: объект или строка JSON (odata.query). */
	body?: unknown;
	/** Объекты, которые включить в состав стандартного интерфейса OData (odata.setup). */
	include?: string[];
	/** Объекты, которые исключить из состава стандартного интерфейса OData (odata.setup). */
	exclude?: string[];
	/** Вернуть все объекты, которые можно включить в состав (odata.setup). */
	available?: boolean;
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
	/** Собранные файлы, когда команда собирает несколько объектов. */
	artifacts?: string[];
	/** Сводка прогона тестов по jUnit-отчёту (только тестовые команды). */
	tests?: TestRunStats;
	/** Ошибки синтаксического контроля по jUnit-отчёту (только syntax-check). */
	errors?: SyntaxCheckError[];
	/** Данные команды для агента (например, список проектов). */
	data?: unknown;
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
