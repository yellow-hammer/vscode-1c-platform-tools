import * as vscode from 'vscode';
import * as path from 'node:path';
import { BaseCommand } from './baseCommand';
import { buildCommand, joinCommands, detectShellType } from '../utils/commandUtils';
import {
	getXUnitTestsCommandName,
	getSyntaxCheckCommandName,
	getVanessaTestsCommandName,
	getAllureReportCommandName,
	getBuildTestEpfCommandName,
	getDecompileTestEpfCommandName,
	getYAxUnitTestsCommandName
} from '../features/tools/commandNames';
import { collectAllureResultDirs } from '../utils/allureResults';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';
import { DEFAULT_TESTING } from '../shared/pathDefaults';

/**
 * Команды для тестирования
 *
 * Предоставляет методы для запуска различных типов тестов:
 * XUnit тесты, синтаксический контроль, Vanessa тесты и генерация Allure отчетов
 */
export class TestCommands extends BaseCommand {

	/**
	 * Запускает XUnit тесты
	 *
	 * Выполняет команду vrunner xunit для запуска модульных тестов в формате XUnit.
	 *
	 * @returns Промис, который разрешается после запуска команды
	 */
	async runXUnit(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const commandName = getXUnitTestsCommandName();
		return this.runVRunner(['xunit', ...this.vrunner.getActiveSettingsParamIfExists()], opts, commandName.title);
	}

	/**
	 * Запускает синтаксический контроль.
	 *
	 * При вызове без аргументов (из UI) запускает vrunner syntax-check в терминале.
	 * При вызове с { wait: true } выполняет синхронно и возвращает StructuredCommandResult
	 * — используется MCP-агентами в автономном цикле «проверка → фикс → проверка».
	 *
	 * TODO: при переводе остальных команд на wait: true — распарсить stdout
	 * vrunner syntax-check в массив errors[{ filepath, line, column, severity, message, mode }].
	 *
	 * @param opts — опции выполнения; при wait: true — синхронный режим без диалогов
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async runSyntaxCheck(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const commandName = getSyntaxCheckCommandName();
		return this.runVRunner(['syntax-check', ...this.vrunner.getActiveSettingsParamIfExists()], opts, commandName.title);
	}

	/**
	 * Запускает Vanessa тесты
	 *
	 * Выполняет команду vrunner vanessa для запуска функциональных тестов в формате Vanessa.
	 *
	 * @param mode - Режим запуска тестов. В настоящее время не используется и всегда равен 'normal'.
	 *               Зарезервировано для будущих расширений (например, 'smoke', 'full', 'integration').
	 * @returns Промис, который разрешается после запуска команды
	 */
	async runVanessa(
		mode: 'normal' = 'normal',
		opts?: CommandExecutionOptions
	): Promise<StructuredCommandResult | void> {
		const commandName = getVanessaTestsCommandName(mode);
		return this.runVRunner(['vanessa', ...this.vrunner.getActiveSettingsParamIfExists()], opts, commandName.title);
	}

	/**
	 * Запускает тесты YAxUnit
	 *
	 * Выполняет vrunner run --command RunUnitTests=<конфиг>. Конфиг прогона —
	 * testing.yaxunitConfigPath (по умолчанию tools/yaxunit.json), отчёт
	 * и фильтры берутся из него.
	 *
	 * Предварительно в ИБ должны быть загружены расширение-движок YAXUNIT
	 * и тестовое расширение (с отключённым безопасным режимом).
	 *
	 * @param opts — опции выполнения; при wait: true — синхронный режим
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async runYAxUnit(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			if (opts?.wait === true) {
				return this.executionError('Откройте рабочую область с проектом 1С');
			}
			return;
		}

		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const configPath = config.get<string>('testing.yaxunitConfigPath', DEFAULT_TESTING.yaxunitConfigPath);
		// Выбранный профиль подставляется через --settings; при «Не выбран» — адрес ИБ
		const settingsParam = this.vrunner.getActiveSettingsParamIfExists();
		const connectionArgs = settingsParam.length > 0
			? settingsParam
			: await this.vrunner.getIbConnectionParam(opts?.ibConnection);
		const args = ['run', '--command', `RunUnitTests=${configPath}`, ...connectionArgs];
		return this.runVRunner(args, opts, getYAxUnitTestsCommandName().title);
	}

	/**
	 * Собирает тестовые обработки из исходников в бинарники
	 *
	 * Выполняет vrunner compileepf <paths.testsSrc> <paths.out>/tests:
	 * разобранные исходники тестовых обработок (src/tests) собираются в .epf
	 * в каталог результатов сборки (build/out/tests) — собранные артефакты
	 * не попадают в git. vrunner кэширует сборку и пересобирает только
	 * изменённые обработки.
	 *
	 * @param opts — опции выполнения; при wait: true — синхронный режим
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async buildTestEpf(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const sourcesPath = this.vrunner.getTestsSrcPath();
		const binariesPath = path.join(this.vrunner.getOutPath(), 'tests');
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['compileepf', sourcesPath, binariesPath, ...ibConnectionParam];
		return this.runVRunner(args, opts, getBuildTestEpfCommandName().title, binariesPath);
	}

	/**
	 * Разбирает бинарники тестовых обработок в исходники
	 *
	 * Выполняет vrunner decompileepf <paths.tests> <paths.testsSrc>:
	 * .epf из каталога тестов раскладываются в исходники (src/tests) —
	 * удобно для первичного переноса существующих бинарных тестов под контроль версий.
	 *
	 * @param opts — опции выполнения; при wait: true — синхронный режим
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async decompileTestEpf(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const sourcesPath = this.vrunner.getTestsSrcPath();
		const binariesPath = this.vrunner.getTestsPath();
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['decompileepf', binariesPath, sourcesPath, ...ibConnectionParam];
		return this.runVRunner(args, opts, getDecompileTestEpfCommandName().title, sourcesPath);
	}

	/**
	 * Получает пути к результатам тестов для Allure
	 *
	 * Сканирует каталог результатов сборки и возвращает все реально
	 * существующие источники: каталоги allure, jUnit (в т.ч. yaxunit)
	 * и Cucumber JSON — Allure 2 понимает все три формата.
	 *
	 * @param workspaceRoot - Корень workspace
	 * @param outPath - Путь к результатам сборки (относительно workspace)
	 * @returns Массив путей к результатам тестов (относительно workspace)
	 */
	private getAllureResultPaths(workspaceRoot: string, outPath: string): string[] {
		const absoluteDirs = collectAllureResultDirs(path.join(workspaceRoot, outPath));
		return absoluteDirs.map((dir) => path.relative(workspaceRoot, dir));
	}

	/**
	 * Формирует команду для генерации Allure отчета
	 *
	 * @param allurePath - Путь к исполняемому файлу allure
	 * @param resultPaths - Пути к результатам тестов
	 * @param outputPath - Путь для сохранения отчета
	 * @param shellType - Тип оболочки терминала
	 * @returns Строка команды для генерации отчета
	 */
	private buildAllureGenerateCommand(
		allurePath: string,
		resultPaths: string[],
		outputPath: string,
		shellType: ReturnType<typeof detectShellType>
	): string {
		const args = [
			'generate',
			...resultPaths,
			'-c',
			'-o',
			outputPath
		];
		return buildCommand(allurePath, args, shellType);
	}

	/**
	 * Формирует команду для открытия Allure отчета
	 *
	 * @param allurePath - Путь к исполняемому файлу allure
	 * @param reportPath - Путь к сгенерированному отчету
	 * @param shellType - Тип оболочки терминала
	 * @returns Строка команды для открытия отчета
	 */
	private buildAllureOpenCommand(
		allurePath: string,
		reportPath: string,
		shellType: ReturnType<typeof detectShellType>
	): string {
		return buildCommand(allurePath, ['open', reportPath], shellType);
	}

	/**
	 * Формирует Allure отчет из результатов тестирования
	 *
	 * Выполняет команду `allure generate` с несколькими путями к результатам тестов
	 * (syntax-check, smoke, общий allure) и открывает сгенерированный отчет в браузере.
	 *
	 * @returns Промис, который разрешается после запуска команд
	 */
	async generateAllureReport(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const reject = this.rejectIfWait(
			opts,
			'Allure-отчёт открывается в браузере; wait: true недоступен'
		);
		if (reject) {
			return reject;
		}

		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const outPath = this.vrunner.getOutPath();
		const commandName = getAllureReportCommandName();
		const allureResultPaths = this.getAllureResultPaths(workspaceRoot, outPath);
		if (allureResultPaths.length === 0) {
			void vscode.window.showWarningMessage(
				`Результаты тестов не найдены в «${outPath}». ` +
				'Сначала выполните прогон тестов (Vanessa, xUnit, YAxUnit или синтаксический контроль).'
			);
			return;
		}
		const outputPath = path.join(outPath, 'allure-report');
		const allurePath = this.vrunner.getAllurePath();
		const shellType = detectShellType();

		const generateCommand = this.buildAllureGenerateCommand(
			allurePath,
			allureResultPaths,
			outputPath,
			shellType
		);
		const openCommand = this.buildAllureOpenCommand(allurePath, outputPath, shellType);
		const fullCommand = joinCommands([generateCommand, openCommand], shellType);

		const terminal = vscode.window.createTerminal({
			name: commandName.title,
			cwd: workspaceRoot
		});

		terminal.sendText(fullCommand);
		terminal.show();
	}
}
