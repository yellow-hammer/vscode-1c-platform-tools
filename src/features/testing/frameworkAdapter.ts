import * as vscode from 'vscode';
import { DiscoveredFile } from './parsers/parserTypes';
import { JUnitCase } from './parsers/junitParser';
import { ReportTarget } from './projectTestConfig';

/**
 * Идентификаторы поддерживаемых тестовых фреймворков 1С
 */
export type TestFrameworkId = 'vanessa' | 'xunit' | 'yaxunit' | 'onescript' | 'onebdd';

/**
 * Единица запуска: файл целиком либо файл с подмножеством кейсов
 *
 * caseNames заполняется только для фреймворков с точечным запуском (YAxUnit);
 * для остальных запускается файл целиком.
 */
export interface RunUnit {
	/** URI тестового файла */
	fileUri: vscode.Uri;
	/** Имена выбранных кейсов; undefined — весь файл */
	caseNames?: string[];
}

/**
 * План запуска тестов для адаптера
 *
 * Результаты прогона контроллер читает из reportTarget (пути из конфигурации
 * проекта: env.json, tools/VAParams.json, tools/yaxunit.json). Если цель
 * не указана, читаются все *.xml из reportDir, переданного в buildRunPlan.
 */
/**
 * Подготовительный шаг плана запуска (например, сборка тестовой обработки)
 */
export interface AdapterRunStep {
	/** Исполнитель: vrunner (через VRunnerManager) или произвольная команда оболочки */
	tool: 'vrunner' | 'shell';
	/** Аргументы vrunner либо полная команда (для tool: 'shell' — args[0]) */
	args: string[];
	/** Короткое описание шага для вывода и сообщений об ошибках */
	title: string;
}

export interface AdapterRunPlan {
	/** Исполнитель: vrunner (через VRunnerManager) или произвольная команда оболочки */
	tool: 'vrunner' | 'shell';
	/** Аргументы vrunner (для tool: 'vrunner') либо полная команда (для tool: 'shell' — args[0]) */
	args: string[];
	/** Подготовительные шаги перед запуском (выполняются последовательно) */
	prepare?: AdapterRunStep[];
	/** Дополнительные переменные окружения */
	env?: NodeJS.ProcessEnv;
	/** Где и в каком формате искать отчёт; по умолчанию — *.xml (jUnit) в reportDir */
	reportTarget?: ReportTarget;
	/** Подсказка пользователю, если прогон завершился без отчёта (диагностика окружения) */
	noReportHint?: string;
}

/**
 * Положение файла в дереве тестов
 */
export interface FileTreeLocation {
	/** Сегменты каталогов между корнем фреймворка и файлом (пусто — файл прямо под корнем) */
	segments: string[];
	/** Отображаемое имя файла; не задано — берётся из разбора или имени файла */
	label?: string;
}

/**
 * Адаптер тестового фреймворка 1С для панели тестирования VS Code
 *
 * Каждый адаптер отвечает за: обнаружение своих файлов (glob), разбор
 * содержимого (делегирует parsers/*), построение плана запуска и указание,
 * где искать jUnit-отчёт.
 */
export interface TestFrameworkAdapter {
	/** Идентификатор фреймворка (используется в ID элементов и TestTag) */
	readonly id: TestFrameworkId;
	/** Отображаемое имя корневого узла в Test Explorer */
	readonly label: string;
	/**
	 * Нужен ли адаптеру временный scratch-каталог прогона (reportDir в buildRunPlan)
	 *
	 * true/undefined (по умолчанию) — туда стейджатся конфиги (yaxunit-config.json,
	 * vanessasettings.json) и/или туда же кладётся отчёт. false — адаптер пишет
	 * отчёт в собственный постоянный каталог и обязан задать reportTarget
	 * (так делают OneScript и 1bdd); контроллер не создаёт пустой временный каталог.
	 */
	readonly usesReportDir?: boolean;

	/**
	 * Преобразует testcase из jUnit-отчёта перед сопоставлением с деревом
	 *
	 * Нужен инструментам с нестандартной гранулярностью отчёта: например,
	 * 1bdd пишет testcase на каждый шаг (classname = сценарий) — адаптер
	 * агрегирует шаги в результаты сценариев.
	 */
	transformReportCases?(cases: JUnitCase[]): JUnitCase[];

	/** Включён ли фреймворк настройками (testing.frameworks.*) */
	isEnabled(): boolean;

	/** Glob-паттерны файлов тестов относительно корня workspace */
	getIncludeGlobs(): string[];

	/**
	 * Быстрая проверка по содержимому: является ли файл тестовым (для ленивого
	 * обнаружения)
	 *
	 * Реализуется адаптерами, чей glob шире множества тестовых файлов: например,
	 * YAxUnit матчит ВСЕ общие модули расширений, а тестовыми являются лишь те,
	 * что регистрируют тесты. Контроллер при обнаружении читает такой файл и
	 * создаёт узел только если проверка прошла; полный разбор кейсов всё равно
	 * откладывается до разворачивания узла (resolveHandler).
	 *
	 * Если не задан, glob считается точным признаком тестового файла и узел
	 * создаётся без чтения содержимого.
	 *
	 * @param content - Содержимое файла
	 */
	isTestFile?(content: string): boolean;

	/**
	 * Определяет положение файла в дереве: каталоги между корнем фреймворка
	 * и файлом (Test Explorer показывает их в режиме «Просмотреть в виде дерева»)
	 *
	 * @param fileUri - URI тестового файла
	 * @param workspaceRoot - Абсолютный путь к корню workspace
	 */
	describeFileLocation(fileUri: vscode.Uri, workspaceRoot: string): FileTreeLocation;

	/**
	 * Разбирает содержимое файла
	 *
	 * @param content - Содержимое файла
	 * @returns Структура с кейсами или undefined, если файл не тестовый
	 */
	parseFile(content: string): DiscoveredFile | undefined;

	/**
	 * Строит план запуска для одной единицы запуска
	 *
	 * Прогоны выполняются последовательно (одна ИБ), поэтому адаптер
	 * получает по одной единице за раз.
	 *
	 * @param unit - Единица запуска (файл, опционально подмножество кейсов)
	 * @param reportDir - Выделенный каталог отчёта прогона (абсолютный путь, уже создан)
	 * @returns План запуска
	 */
	buildRunPlan(unit: RunUnit, reportDir: string): Promise<AdapterRunPlan>;
}
