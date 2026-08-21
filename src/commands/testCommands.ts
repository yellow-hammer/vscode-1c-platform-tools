import * as vscode from 'vscode';
import * as path from 'node:path';
import { BaseCommand } from './baseCommand';
import { buildCommand, buildProcessCommand, joinCommands, detectShellType, PROCESS_HOST_SHELL } from '../utils/commandUtils';
import { createVRunnerTask } from '../features/tasks/vrunnerTask';
import { findFreePort, isRemoteEnvironment, openLocalUrl } from '../shared/remoteEnv';
import { showComponentError } from '../shared/githubToken';
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
import type { CommandExecutionOptions, StructuredCommandResult, SyntaxCheckError } from '../shared/commandExecutionTypes';
import { DEFAULT_TESTING, DEFAULT_PATHS, BUILD_SUBDIRS } from '../shared/pathDefaults';
import { legacyTestsSrcHint } from '../features/testing/legacyTestsSrc';
import * as fs from 'node:fs/promises';
import { settingValue, resolveConfigPath, reportsXunitFromEnv, extractJUnitPathFromReportsXunit, extractAllurePathFromReportsXunit, vanessaReportTarget, vanessaSettingsPathFromEnv, syntaxCheckJUnitPathFromEnv, syntaxCheckAllurePathsFromEnv } from '../features/testing/projectTestConfig';
import { parseSyntaxCheckFindings, toSyntaxCheckErrors, SyntaxCheckFinding } from '../features/diagnostics/syntaxCheckJUnit';
import { readRunSummary, formatRunSummary, RunReportFormat } from '../features/testing/runReportSummary';
import { ensureAllure } from '../shared/allureComponent';
import { logger } from '../shared/logger';

const log = logger.scope('testing');

const NL = '\n';

/** Порт, с которого ищется свободный для отчёта Allure в удалённом окружении. */
const DEFAULT_ALLURE_PORT = 8090;

/** Путь jUnit-отчёта syntax-check, когда он не задан в настройках прогона. */
const DEFAULT_SYNTAX_CHECK_JUNIT = 'build/out/syntax-check/junit/junit.xml';

/** Цель отчёта прогона: путь и формат. */
interface RunReportTarget {
	path: string;
	format: RunReportFormat;
}

/** Убирает BOM в начале JSON-файла. */
function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Команды для тестирования
 *
 * Предоставляет методы для запуска различных типов тестов:
 * XUnit тесты, синтаксический контроль, Vanessa тесты и генерация Allure отчетов
 */
export class TestCommands extends BaseCommand {
	/**
	 * @param context - Контекст расширения: из него берётся кэш загружаемых
	 *   компонентов (Allure). Без него команда отчёта работает по PATH.
	 */
	constructor(private readonly context?: vscode.ExtensionContext) {
		super();
	}

	/**
	 * Настройки vanessa-runner для прогона: явный settingsFile вызова либо
	 * активный профиль.
	 */
	private async readRunSettings(
		opts?: CommandExecutionOptions
	): Promise<{ settings: Record<string, unknown>; schema: 'v2' | 'v3' }> {
		if (opts?.settingsFile) {
			const settings = (await this.vrunner.readEnvJson(opts.settingsFile)) as Record<string, unknown>;
			// Схема определяется по самому файлу: он может быть другого формата,
			// чем активный профиль (корневой ключ vrunner — формат 3.x)
			return { settings, schema: 'vrunner' in settings ? 'v3' : 'v2' };
		}
		return this.vrunner.readActiveSettings();
	}

	/**
	 * Путь jUnit-отчёта прогона по конфигурации проекта.
	 *
	 * vanessa: файл VAParams (--vanessasettings) → КаталогОтчетаJUnit;
	 * xunit: --reportsxunit → путь генератора jUnit;
	 * yaxunit: конфиг testing.yaxunitConfigPath → reportPath.
	 *
	 * @returns Абсолютный путь к файлу/каталогу отчёта или undefined
	 */
	private async resolveRunReportTarget(
		framework: 'vanessa' | 'xunit' | 'yaxunit',
		opts?: CommandExecutionOptions
	): Promise<RunReportTarget | undefined> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return undefined;
		}
		try {
			if (framework === 'yaxunit') {
				const config = vscode.workspace.getConfiguration('1c-platform-tools');
				const configPath = config.get<string>('test.yaxunitConfigPath', DEFAULT_TESTING.yaxunitConfigPath);
				const raw = await fs.readFile(path.join(workspaceRoot, configPath), 'utf8');
				const parsed = JSON.parse(stripBom(raw)) as Record<string, unknown>;
				const reportPath = parsed['reportPath'];
				return typeof reportPath === 'string' && reportPath.length > 0
					? { path: resolveConfigPath(reportPath, workspaceRoot), format: 'junit' }
					: undefined;
			}
			const { settings, schema } = await this.readRunSettings(opts);
			if (framework === 'xunit') {
				const reportsXunit = reportsXunitFromEnv(settings, schema);
				const junitRel = reportsXunit ? extractJUnitPathFromReportsXunit(reportsXunit) : undefined;
				return junitRel ? { path: resolveConfigPath(junitRel, workspaceRoot), format: 'junit' } : undefined;
			}
			const vaSettingsRel = settingValue(settings, schema, 'vanessa', 'vanessasettings');
			if (typeof vaSettingsRel !== 'string' || vaSettingsRel.length === 0) {
				return undefined;
			}
			const vaRaw = await fs.readFile(resolveConfigPath(vaSettingsRel, workspaceRoot), 'utf8');
			const vaParams = JSON.parse(stripBom(vaRaw)) as Record<string, unknown>;
			// Цель отчёта VA определяется так же, как в панели тестирования:
			// jUnit, а при выключенном jUnit — Cucumber JSON
			const target = vanessaReportTarget(vaParams, workspaceRoot);
			return target ? { path: target.path, format: target.format } : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * Создаёт каталог отчёта перед прогоном: vanessa-automation и генераторы
	 * jUnit не создают каталоги сами и молча пропускают выгрузку отчёта.
	 *
	 * @param framework - Фреймворк прогона (vanessa: путь — каталог, иначе файл)
	 * @param reportPath - Путь отчёта из конфигурации
	 */
	private async ensureReportDir(
		framework: 'vanessa' | 'xunit' | 'yaxunit',
		target: RunReportTarget | undefined
	): Promise<void> {
		if (!target) {
			return;
		}
		const dir = framework === 'vanessa' ? target.path : path.dirname(target.path);
		try {
			await fs.mkdir(dir, { recursive: true });
		} catch {
			// каталог не создался — прогон сам сообщит об отсутствии отчёта
		}
	}

	/**
	 * Дополняет структурированный результат прогона фактическим результатом
	 * тестов из jUnit-отчёта.
	 *
	 * Код возврата vrunner не отражает результат тестов, поэтому: упавшие
	 * тесты, отсутствующий или устаревший отчёт дают success: false. Сводка
	 * добавляется в stdout и в поле tests.
	 */
	private async withRunReport(
		result: StructuredCommandResult | void,
		framework: 'vanessa' | 'xunit' | 'yaxunit',
		startedAtMs: number,
		opts?: CommandExecutionOptions,
		resolvedTarget?: RunReportTarget
	): Promise<StructuredCommandResult | void> {
		if (opts?.wait !== true || result === undefined) {
			return result;
		}
		const target = resolvedTarget ?? await this.resolveRunReportTarget(framework, opts);
		if (!target) {
			return {
				...result,
				success: false,
				stderr: [result.stderr, 'Путь отчёта прогона (jUnit или Cucumber JSON) не настроен в конфигурации проекта; результат тестов неизвестен.']
					.filter(Boolean).join(NL),
			};
		}
		const stats = await readRunSummary(target.path, startedAtMs, target.format);
		if (!stats) {
			return {
				...result,
				success: false,
				stderr: [result.stderr, `Отчёт прогона не найден или не обновился (ожидался: ${target.path}); результат тестов неизвестен.`]
					.filter(Boolean).join(NL),
			};
		}
		const testsGreen = stats.failed === 0 && stats.errors === 0 && stats.total > 0;
		return {
			...result,
			success: result.success && testsGreen,
			stdout: [result.stdout, formatRunSummary(stats)].filter(Boolean).join(NL),
			tests: stats,
		};
	}

	/**
	 * Запускает XUnit тесты
	 *
	 * Выполняет команду vrunner xunit для запуска модульных тестов в формате XUnit.
	 *
	 * @returns Промис, который разрешается после запуска команды
	 */
	async runXUnit(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const commandName = getXUnitTestsCommandName();
		const startedAtMs = Date.now();
		const reportTarget = await this.resolveRunReportTarget('xunit', opts);
		await this.ensureReportDir('xunit', reportTarget);
		const result = await this.runIntent(
			{ kind: 'test.xunit' },
			opts, commandName.title, undefined, commandName.id
		);
		return this.withRunReport(result, 'xunit', startedAtMs, opts, reportTarget);
	}

	/**
	 * Абсолютный путь к jUnit-отчёту синтаксического контроля.
	 *
	 * Берётся из настроек прогона (секция syntax-check), с откатом на стандартный.
	 *
	 * @param opts - Опции выполнения (нужны для выбора файла настроек)
	 * @param workspaceRoot - Корень проекта
	 * @returns Абсолютный путь к файлу отчёта
	 */
	private async syntaxCheckJUnitPath(
		opts: CommandExecutionOptions | undefined,
		workspaceRoot: string
	): Promise<string> {
		let rel = DEFAULT_SYNTAX_CHECK_JUNIT;
		try {
			const { settings, schema } = await this.readRunSettings(opts);
			rel = syntaxCheckJUnitPathFromEnv(settings, schema) ?? rel;
		} catch {
			// Настройки нечитаемы — берём стандартный путь отчёта
		}
		return resolveConfigPath(rel, workspaceRoot);
	}

	/**
	 * Создаёт каталог jUnit-отчёта синтаксического контроля перед прогоном.
	 *
	 * vanessa-runner 3 не создаёт каталог сам и завершается ошибкой записи
	 * отчёта, а `build` в проектах не хранится в репозитории.
	 *
	 * @param opts - Опции выполнения (нужны для выбора файла настроек)
	 */
	private async ensureSyntaxCheckReportDir(opts?: CommandExecutionOptions): Promise<void> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return;
		}
		try {
			await fs.mkdir(path.dirname(await this.syntaxCheckJUnitPath(opts, workspaceRoot)), { recursive: true });
		} catch {
			// каталог не создался — прогон сам сообщит об отсутствии отчёта
		}
	}

	/**
	 * Запускает синтаксический контроль.
	 *
	 * При вызове без аргументов (из UI) запускает vrunner syntax-check в терминале.
	 * При вызове с { wait: true } выполняет синхронно и возвращает StructuredCommandResult
	 * — используется MCP-агентами в автономном цикле «проверка → фикс → проверка».
	 * В синхронном режиме к результату добавляется разбор jUnit-отчёта: агент
	 * получает адреса ошибок, а не простыню stdout.
	 *
	 * @param opts — опции выполнения; при wait: true — синхронный режим без диалогов
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async runSyntaxCheck(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const commandName = getSyntaxCheckCommandName();
		await this.ensureSyntaxCheckReportDir(opts);
		const result = await this.runIntent(
			{ kind: 'validate.syntaxCheck' },
			opts, commandName.title, undefined, commandName.id
		);
		if (!result || !opts?.wait) {
			return result;
		}

		const errors = await this.readSyntaxCheckErrors(opts);
		return errors.length > 0 ? { ...result, errors } : result;
	}

	/**
	 * Читает ошибки синтаксического контроля из jUnit-отчёта.
	 *
	 * Путь к отчёту берётся из настроек прогона (секция syntax-check,
	 * --junitpath), с откатом на стандартный. Отсутствие отчёта — не ошибка:
	 * проверка могла упасть до его записи, тогда остаётся stdout.
	 *
	 * @param opts — опции выполнения (нужны для выбора файла настроек)
	 * @returns список ошибок (пустой, если отчёта нет или он не разобрался)
	 */
	private async readSyntaxCheckErrors(
		opts?: CommandExecutionOptions
	): Promise<SyntaxCheckError[]> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return [];
		}

		const reportPath = await this.syntaxCheckJUnitPath(opts, workspaceRoot);

		let xml: string;
		try {
			xml = await fs.readFile(reportPath, 'utf8');
		} catch {
			return [];
		}

		let findings: SyntaxCheckFinding[];
		try {
			findings = parseSyntaxCheckFindings(xml);
		} catch {
			return [];
		}

		const cfRel = vscode.workspace
			.getConfiguration('1c-platform-tools')
			.get<string>('paths.cf', DEFAULT_PATHS.cf);

		return toSyntaxCheckErrors(findings, cfRel);
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
		const startedAtMs = Date.now();
		const reportTarget = await this.resolveRunReportTarget('vanessa', opts);
		await this.ensureReportDir('vanessa', reportTarget);
		const result = await this.runIntent(
			{ kind: 'test.vanessa' },
			opts, commandName.title, undefined, commandName.id
		);
		return this.withRunReport(result, 'vanessa', startedAtMs, opts, reportTarget);
	}

	/**
	 * Запускает внешнюю обработку/отчёт в Предприятии через vrunner run
	 *
	 * Выполняет vrunner run --execute <epf> --command <параметры /C> под активным
	 * профилем (или явным settingsFile). Сценарий — служебные шаги инициализации:
	 * загрузка фикстур, служебные EPF и т.п.
	 *
	 * @param opts — опции выполнения: execute (путь к EPF/ERF), command (строка /C),
	 *               settingsFile, ibConnection; при wait: true — синхронный режим
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async runEnterpriseProcessor(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			if (opts?.wait === true) {
				return this.executionError('Откройте рабочую область с проектом 1С');
			}
			return;
		}

		const execute = typeof opts?.execute === 'string' && opts.execute.trim() !== '' ? opts.execute.trim() : undefined;
		const commandParam = typeof opts?.command === 'string' && opts.command.trim() !== '' ? opts.command.trim() : undefined;
		if (!execute && !commandParam) {
			const message = 'Укажите execute (путь к EPF/ERF) или command (строка параметров /C)';
			if (opts?.wait === true) {
				return this.executionError(message);
			}
			vscode.window.showErrorMessage(message);
			return;
		}

		const connectionArgs = await this.vrunner.getIbConnectionParam(opts?.ibConnection);
		return this.runIntent(
			{ kind: 'run.enterprise', execute, command: commandParam, common: connectionArgs },
			opts, 'Запуск обработки в Предприятии', undefined, '1c-platform-tools.epf.run'
		);
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
		const configPath = config.get<string>('test.yaxunitConfigPath', DEFAULT_TESTING.yaxunitConfigPath);
		// --settings активного профиля подставляет planIntent; здесь — только явный
		// адрес ИБ из вызова MCP (перекрывает ИБ профиля), иначе пусто.
		const connectionArgs = await this.vrunner.getIbConnectionParam(opts?.ibConnection);
		const yaxCmd = getYAxUnitTestsCommandName();
		const startedAtMs = Date.now();
		const reportTarget = await this.resolveRunReportTarget('yaxunit', opts);
		await this.ensureReportDir('yaxunit', reportTarget);
		const result = await this.runIntent(
			{ kind: 'run.enterprise', command: `RunUnitTests=${configPath}`, common: connectionArgs },
			opts, yaxCmd.title, undefined, yaxCmd.id
		);
		return this.withRunReport(result, 'yaxunit', startedAtMs, opts, reportTarget);
	}

	/**
	 * Собирает тестовые обработки из исходников в бинарники
	 *
	 * Выполняет vrunner compileepf <paths.tests>/epf <paths.out>/tests/epf:
	 * разобранные исходники тестовых обработок (tests/epf) собираются в .epf
	 * в каталог результатов сборки (build/out/tests/epf) — собранные артефакты
	 * не попадают в git. vrunner кэширует сборку и пересобирает только
	 * изменённые обработки.
	 *
	 * @param opts — опции выполнения; при wait: true — синхронный режим
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	async buildTestEpf(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const legacy = this.legacyTestsSrcMessage(opts);
		if (legacy) {
			return legacy === 'blocked' ? undefined : legacy;
		}
		const sourcesPath = this.vrunner.getTestsSrcPath();
		const binariesPath = path.join(this.vrunner.getOutPath(), BUILD_SUBDIRS.testsEpf);
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const buildEpfCmd = getBuildTestEpfCommandName();
		return this.runIntent(
			{ kind: 'epf.build', src: sourcesPath, out: binariesPath, common: ibConnectionParam },
			opts, buildEpfCmd.title, binariesPath, buildEpfCmd.id
		);
	}

	/**
	 * Разбирает бинарники тестовых обработок в исходники
	 *
	 * Выполняет vrunner decompileepf <paths.tests> <paths.tests>/epf:
	 * .epf из каталога тестов раскладываются в исходники (tests/epf) —
	 * удобно для первичного переноса существующих бинарных тестов под контроль версий.
	 *
	 * @param opts — опции выполнения; при wait: true — синхронный режим
	 * @returns void в UI-режиме, StructuredCommandResult при wait: true
	 */
	/**
	 * Сообщение о старой раскладке тестовых обработок (src/tests вместо tests/epf).
	 *
	 * Команда с несуществующим каталогом исходников упала бы ошибкой vrunner,
	 * из которой причина не видна: отвечаем прямо, что переехало и что сделать.
	 *
	 * @param opts - Опции выполнения
	 * @returns Результат-ошибку в режиме wait, 'blocked' после показа сообщения
	 *          в UI, либо undefined, если раскладка в порядке
	 */
	private legacyTestsSrcMessage(
		opts?: CommandExecutionOptions
	): StructuredCommandResult | 'blocked' | undefined {
		const cwd = this.getExecutionCwd(opts);
		if (!cwd) {
			return undefined;
		}
		const hint = legacyTestsSrcHint(cwd);
		if (!hint) {
			return undefined;
		}
		if (opts?.wait === true) {
			return this.executionError(hint);
		}
		void vscode.window.showWarningMessage(hint);
		return 'blocked';
	}

	async decompileTestEpf(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		const legacy = this.legacyTestsSrcMessage(opts);
		if (legacy) {
			return legacy === 'blocked' ? undefined : legacy;
		}
		const sourcesPath = this.vrunner.getTestsSrcPath();
		const binariesPath = this.vrunner.getTestsPath();
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const decompileEpfCmd = getDecompileTestEpfCommandName();
		return this.runIntent(
			{ kind: 'epf.decompile', input: binariesPath, out: sourcesPath, common: ibConnectionParam },
			opts, decompileEpfCmd.title, sourcesPath, decompileEpfCmd.id
		);
	}

	/**
	 * Каталоги результатов, объявленные в файлах настроек проекта.
	 *
	 * Пути отчётов проект уже описал сам: env.json (`xunit --reportsxunit` -
	 * оба генератора, `syntax-check --junitpath`, `--allure-results` и
	 * `--allure-results2`), файл параметров VA из `--vanessasettings` и конфиг
	 * YAxUnit. Обход каталогов угадывает их по именам, поэтому нестандартную
	 * раскладку отчётов теряет.
	 *
	 * Каждая опция описывает либо файл отчёта, либо каталог результатов - это
	 * известно из её смысла, а не из вида пути. Allure принимает каталоги,
	 * поэтому у файловых опций берётся каталог файла.
	 *
	 * @param workspaceRoot - Корень workspace
	 * @returns Абсолютные пути существующих каталогов результатов
	 */
	private async declaredResultDirs(workspaceRoot: string): Promise<string[]> {
		const declared: Array<{ value: string; kind: 'file' | 'dir' }> = [];
		try {
			const { settings, schema } = await this.vrunner.readActiveSettings();

			const reportsXunit = reportsXunitFromEnv(settings, schema);
			if (reportsXunit) {
				// оба генератора указывают на файл отчёта
				for (const value of [
					extractJUnitPathFromReportsXunit(reportsXunit),
					extractAllurePathFromReportsXunit(reportsXunit)
				]) {
					if (value) {
						declared.push({ value, kind: 'file' });
					}
				}
			}

			const syntaxJUnit = syntaxCheckJUnitPathFromEnv(settings, schema);
			if (syntaxJUnit) {
				declared.push({ value: syntaxJUnit, kind: 'file' });
			}
			for (const value of syntaxCheckAllurePathsFromEnv(settings, schema)) {
				declared.push({ value, kind: 'dir' });
			}

			const vaSettingsRel = vanessaSettingsPathFromEnv(settings, schema);
			if (vaSettingsRel) {
				const vaPath = resolveConfigPath(vaSettingsRel, workspaceRoot);
				try {
					const raw = await fs.readFile(vaPath, 'utf8');
					// VA задаёт каталоги выгрузки, а не файлы отчётов
					const target = vanessaReportTarget(
						JSON.parse(stripBom(raw)) as Record<string, unknown>,
						workspaceRoot
					);
					if (target) {
						declared.push({ value: target.path, kind: 'dir' });
					}
				} catch (error) {
					log.debug(`Файл параметров VA ${vaPath} не прочитан: ${(error as Error).message}`);
				}
			}
		} catch (error) {
			log.debug(`Настройки активного профиля не прочитаны: ${(error as Error).message}`);
		}

		const yaxunitTarget = await this.resolveRunReportTarget('yaxunit');
		if (yaxunitTarget) {
			declared.push({ value: yaxunitTarget.path, kind: 'file' });
		}

		const dirs = new Set<string>();
		for (const { value, kind } of declared) {
			const dir = kind === 'file'
				? path.dirname(resolveConfigPath(value, workspaceRoot))
				: resolveConfigPath(value, workspaceRoot);
			// Каталога нет — прогон в него ещё не писал; Allure на пустом источнике падает
			try {
				if ((await fs.stat(dir)).isDirectory()) {
					dirs.add(dir);
				}
			} catch {
				log.debug(`Каталог результатов ${dir} не существует, пропущен`);
			}
		}
		return [...dirs];
	}

	/**
	 * Получает пути к результатам тестов для Allure
	 *
	 * Сначала берутся каталоги, объявленные в файлах настроек проекта, затем к
	 * ним добавляется обход каталога сборки: так подхватываются и отчёты
	 * прогонов из панели тестирования, которые в настройках не описаны.
	 *
	 * @param workspaceRoot - Корень workspace
	 * @param outPath - Путь к результатам сборки (относительно workspace)
	 * @returns Массив путей к результатам тестов (относительно workspace)
	 */
	private async getAllureResultPaths(workspaceRoot: string, outPath: string): Promise<string[]> {
		const absoluteDirs = new Set<string>(await this.declaredResultDirs(workspaceRoot));
		for (const dir of collectAllureResultDirs(path.join(workspaceRoot, outPath))) {
			absoluteDirs.add(dir);
		}
		return [...absoluteDirs].map((dir) => path.relative(workspaceRoot, dir));
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
		const allureResultPaths = await this.getAllureResultPaths(workspaceRoot, outPath);
		if (allureResultPaths.length === 0) {
			void vscode.window.showWarningMessage(
				`Результаты тестов не найдены в «${outPath}». ` +
				'Сначала выполните прогон тестов (Vanessa, xUnit, YAxUnit или синтаксический контроль).'
			);
			return;
		}
		const outputPath = path.join(outPath, 'allure-report');
		let allurePath: string;
		try {
			allurePath = this.context
				? await ensureAllure(this.context)
				: this.vrunner.getAllurePath();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void showComponentError(`Не удалось подготовить Allure: ${message}`);
			return;
		}
		if (this.vrunner.shouldUseTasks()) {
			const generateArgs = ['generate', ...allureResultPaths, '-c', '-o', outputPath];
			// В удалённом окружении браузера рядом с allure нет: фиксируем порт,
			// чтобы открыть отчёт у пользователя через проброс
			const port = isRemoteEnvironment() ? await findFreePort(DEFAULT_ALLURE_PORT) : undefined;
			const openArgs = port === undefined
				? ['open', outputPath]
				: ['open', outputPath, '-h', 'localhost', '-p', String(port)];
			const command = joinCommands(
				[buildProcessCommand(allurePath, generateArgs), buildProcessCommand(allurePath, openArgs)],
				PROCESS_HOST_SHELL
			);
			await vscode.tasks.executeTask(createVRunnerTask({
				name: commandName.title,
				command,
				cwd: workspaceRoot,
			}));
			if (port !== undefined) {
				await openLocalUrl(`http://localhost:${port}/`);
			}
			return;
		}

		const shellType = detectShellType();

		const generateCommand = this.buildAllureGenerateCommand(
			allurePath,
			allureResultPaths,
			outputPath,
			shellType
		);
		const openCommand = this.buildAllureOpenCommand(allurePath, outputPath, shellType);
		const fullCommand = joinCommands([generateCommand, openCommand], shellType);

		/* eslint-disable no-restricted-syntax -- execution.useTasks === false: терминал выбран пользователем */
		const terminal = vscode.window.createTerminal({
			name: commandName.title,
			cwd: workspaceRoot
		});

		terminal.sendText(fullCommand);
		terminal.show();
		/* eslint-enable no-restricted-syntax */
	}
}
