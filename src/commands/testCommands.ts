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
	 * @param mode - Режим запуска тестов (в настоящее время не используется, зарезервировано для будущих расширений)
	 * @returns Промис, который разрешается после запуска команды
	 */
	async runVanessa(mode: 'normal' = 'normal'): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
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

		const buildPath = this.vrunner.getBuildPath();
		const commandName = getAllureReportCommandName();
		const allurePaths = [
			path.join(buildPath, 'syntax-check', 'allure'),
			path.join(buildPath, 'smoke', 'allure'),
			path.join(buildPath, 'allure')
		];
		const outputPath = 'build/allure-report';

		const generateArgs = [
			'generate',
			...allurePaths,
			'-c',
			'-o',
			outputPath
		];

		const openArgs = ['open', outputPath];
		const allurePath = this.vrunner.getAllurePath();
		const shellType = detectShellType();

		const generateCommand = buildCommand(allurePath, generateArgs, shellType);
		const openCommand = buildCommand(allurePath, openArgs, shellType);
		const fullCommand = joinCommands([generateCommand, openCommand], shellType);

		const terminal = vscode.window.createTerminal({
			name: commandName.title,
			cwd: workspaceRoot
		});

		terminal.sendText(fullCommand);
		terminal.show();
	}
}
