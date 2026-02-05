import * as vscode from 'vscode';
import * as path from 'node:path';
import { BaseCommand } from './baseCommand';
import { buildCommand, joinCommands, detectShellType } from '../utils/commandUtils';
import {
	getXUnitTestsCommandName,
	getSyntaxCheckCommandName,
	getVanessaTestsCommandName,
	getAllureReportCommandName
} from '../commandNames';

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
	async runXUnit(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		const commandName = getXUnitTestsCommandName();
		const args = ['xunit'];

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Запускает синтаксический контроль
	 * 
	 * Выполняет команду vrunner syntax-check для проверки синтаксиса модулей конфигурации.
	 * 
	 * @returns Промис, который разрешается после запуска команды
	 */
	async runSyntaxCheck(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		const commandName = getSyntaxCheckCommandName();
		const args = ['syntax-check'];

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
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
	async runVanessa(mode: 'normal' = 'normal'): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		const commandName = getVanessaTestsCommandName(mode);
		const args: string[] = ['vanessa'];

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Получает пути к результатам тестов для Allure
	 * 
	 * @param outPath - Путь к результатам сборки
	 * @returns Массив путей к результатам тестов
	 */
	private getAllureResultPaths(outPath: string): string[] {
		return [
			path.join(outPath, 'syntax-check', 'allure'),
			path.join(outPath, 'smoke', 'allure'),
			path.join(outPath, 'allure')
		];
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
	async generateAllureReport(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const outPath = this.vrunner.getOutPath();
		const commandName = getAllureReportCommandName();
		const allureResultPaths = this.getAllureResultPaths(outPath);
		const outputPath = 'build/allure-report';
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
