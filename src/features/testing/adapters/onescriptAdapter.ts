import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { VRunnerManager } from '../../../shared/vrunnerManager';
import { TestFrameworkAdapter, AdapterRunPlan, RunUnit } from '../frameworkAdapter';
import { DiscoveredFile } from '../parsers/parserTypes';
import { parseBslTestModule } from '../parsers/bslTestParser';
import { resolveConfigPath } from '../projectTestConfig';
import { normalizeGlobBase, directorySegments } from './adapterUtils';
import { DEFAULT_TESTING } from '../../../shared/pathDefaults';

/** Раннер тестов OneScript */
type OneScriptRunner = '1testrunner' | 'oneunit';

/**
 * Адаптер тестов OneScript
 *
 * Discovery: .os модули в каталоге тестов OneScript — классический стиль
 * (ИсполняемыеСценарии) и аннотационный (&Тест над процедурой).
 *
 * Запуск — без платформы 1С, раннер выбирается настройкой
 * testing.onescriptRunner ('auto' — по наличию oneunit в oscript_modules/bin):
 * - 1testrunner: `-run <файл> [ИмяТеста] xddReportPath <каталог>` — jUnit-отчёт;
 * - OneUnit: `execute -f <файл> [-m <метод>] --junit <отчёт>` — jUnit-отчёт.
 *
 * Отчёты складываются в build/out/onescript — их подхватывает команда
 * «Allure отчёт». Для старых версий 1testrunner без поддержки xddReportPath
 * прогон завершится errored с подсказкой обновить зависимости.
 *
 * Путь к раннеру: настройка testing.onescriptRunnerPath (поддерживает
 * относительные пути от корня проекта), иначе локальный oscript_modules/bin,
 * иначе PATH.
 */
export class OneScriptAdapter implements TestFrameworkAdapter {
	public readonly id = 'onescript' as const;
	public readonly label = 'OneScript';
	/** Отчёты пишутся в build/out/onescript, временный каталог не нужен */
	public readonly usesReportDir = false;

	constructor(private readonly vrunner: VRunnerManager) {}

	public isEnabled(): boolean {
		// Конфликта с xUnit нет: .os-файлы — всегда OneScript,
		// тесты xUnit для 1С — внешние обработки (исходники в paths.testsSrc)
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<boolean>('testing.frameworks.onescript', true);
	}

	public getIncludeGlobs(): string[] {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const base = normalizeGlobBase(config.get<string>('testing.onescriptTestsPath', DEFAULT_TESTING.onescriptTestsPath));
		return [`${base}/**/*.os`];
	}

	public parseFile(content: string): DiscoveredFile | undefined {
		return parseBslTestModule(content, 'xunit');
	}

	public describeFileLocation(fileUri: vscode.Uri, workspaceRoot: string) {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const base = config.get<string>('testing.onescriptTestsPath', DEFAULT_TESTING.onescriptTestsPath);
		return { segments: directorySegments(fileUri.fsPath, base, workspaceRoot) };
	}

	public async buildRunPlan(unit: RunUnit, _reportDir: string): Promise<AdapterRunPlan> {
		const runner = this.resolveRunner();
		const quotedFile = `"${unit.fileUri.fsPath}"`;
		// Точечный запуск возможен только для одного теста
		const singleCase = unit.caseNames?.length === 1 ? unit.caseNames[0] : undefined;

		// Отчёты складываем в build/out/onescript (постоянное место):
		// оттуда их читает и панель, и команда «Allure отчёт»
		const workspaceRoot = this.vrunner.getWorkspaceRoot() ?? '';
		const reportsDir = path.join(workspaceRoot, this.vrunner.getOutPath(), 'onescript');
		await fs.mkdir(reportsDir, { recursive: true });
		const reportFile = path.join(reportsDir, `${path.basename(unit.fileUri.fsPath)}.xml`);

		if (runner.kind === 'oneunit') {
			const args = [runner.command, 'execute', '-f', quotedFile];
			if (singleCase) {
				args.push('-m', `"${singleCase}"`);
			}
			args.push('--junit', `"${reportFile}"`);
			return {
				tool: 'shell',
				args: [args.join(' ')],
				reportTarget: { format: 'junit', path: reportFile }
			};
		}

		// 1testrunner: jUnit через xddReportPath <каталог> —
		// внутри создаётся <имяФайлаТеста>.xml (testcase = метод, статус атрибутом)
		const args = [runner.command, '-run', quotedFile];
		if (singleCase) {
			args.push(`"${singleCase}"`);
		}
		args.push('xddReportPath', `"${reportsDir}"`);
		return {
			tool: 'shell',
			args: [args.join(' ')],
			reportTarget: { format: 'junit', path: reportFile },
			noReportHint:
				'Отчёт xddReportPath не создан — возможно, установлена старая версия 1testrunner. ' +
				'Обновите зависимости проекта (opm update 1testrunner).'
		};
	}

	/**
	 * Определяет раннер и команду его запуска
	 *
	 * Порядок: testing.onescriptRunnerPath (относительные пути — от корня
	 * проекта) → локальная установка в oscript_modules/bin → PATH.
	 */
	private resolveRunner(): { kind: OneScriptRunner; command: string } {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		const runnerSetting = config.get<string>('testing.onescriptRunner', 'auto');
		const customPath = config.get<string>('testing.onescriptRunnerPath', '').trim();

		// Явно заданный путь к раннеру: вид раннера — по имени файла
		if (customPath.length > 0) {
			const resolved = workspaceRoot ? resolveConfigPath(customPath, workspaceRoot) : customPath;
			const kind: OneScriptRunner = path
				.basename(resolved)
				.toLowerCase()
				.includes('oneunit')
				? 'oneunit'
				: '1testrunner';
			return { kind, command: `"${resolved}"` };
		}

		const kind = this.resolveRunnerKind(runnerSetting, workspaceRoot);
		const localPath = this.findLocalRunner(kind, workspaceRoot);
		return { kind, command: localPath ? `"${localPath}"` : kind };
	}

	/**
	 * Выбирает вид раннера: явная настройка либо автоопределение
	 * по наличию oneunit в локальных зависимостях
	 */
	private resolveRunnerKind(setting: string, workspaceRoot: string | undefined): OneScriptRunner {
		if (setting === '1testrunner' || setting === 'oneunit') {
			return setting;
		}
		if (this.findLocalRunner('oneunit', workspaceRoot)) {
			return 'oneunit';
		}
		return '1testrunner';
	}

	/**
	 * Ищет раннер в локальной установке oscript_modules/bin
	 */
	private findLocalRunner(
		kind: OneScriptRunner,
		workspaceRoot: string | undefined
	): string | undefined {
		if (!workspaceRoot) {
			return undefined;
		}
		const name = process.platform === 'win32' ? `${kind}.bat` : kind;
		const localPath = path.join(workspaceRoot, 'oscript_modules', 'bin', name);
		return fsSync.existsSync(localPath) ? localPath : undefined;
	}
}
