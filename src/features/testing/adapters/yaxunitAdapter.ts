import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { VRunnerManager } from '../../../shared/vrunnerManager';
import { logger } from '../../../shared/logger';
import { TestFrameworkAdapter, AdapterRunPlan, RunUnit } from '../frameworkAdapter';
import { DiscoveredFile } from '../parsers/parserTypes';
import { parseBslTestModule } from '../parsers/bslTestParser';
import { resolveConfigPath } from '../projectTestConfig';
import { normalizeGlobBase } from './adapterUtils';
import { DEFAULT_PATHS, DEFAULT_TESTING } from '../../../shared/pathDefaults';
import { resolveExtensionNameFromSrc } from '../../extensions/extensionNames';

const log = logger.scope('testing');

/**
 * Адаптер YAxUnit (модульные тесты в расширении конфигурации)
 *
 * Discovery: общие модули тестового расширения с регистрацией тестов через
 * ДобавитьТест("..."). Смотрим оба корня расширений: и решения (paths.cfe), и
 * тестовых (<paths.tests>/cfe) - расширение с тестами держат отдельно от поставки,
 * но и внутри решения оно встречается.
 *
 * Запуск: vrunner run --command RunUnitTests=<конфиг>. За основу берётся
 * конфиг проекта (testing.yaxunitConfigPath, по умолчанию tools/yaxunit.json) —
 * из него же берётся reportPath; поверх накладывается filter по выбранному
 * модулю или конкретным тестам (единственный фреймворк с точечным запуском).
 */
export class YaxunitAdapter implements TestFrameworkAdapter {
	public readonly id = 'yaxunit' as const;
	public readonly label = 'YAxUnit';

	constructor(private readonly vrunner: VRunnerManager) {}

	public isEnabled(): boolean {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<boolean>('test.frameworks.yaxunit', true);
	}

	public getIncludeGlobs(): string[] {
		const roots = [this.vrunner.getCfePath(), this.vrunner.getTestsCfePath()];
		return roots
			.map((root) => normalizeGlobBase(root))
			.filter((base, index, all) => base.length > 0 && all.indexOf(base) === index)
			.flatMap((base) => [
				// форматы конфигуратора и EDT
				`${base}/*/CommonModules/*/Ext/Module.bsl`,
				`${base}/*/src/CommonModules/*/Module.bsl`,
			]);
	}

	public parseFile(content: string): DiscoveredFile | undefined {
		return parseBslTestModule(content, 'yaxunit');
	}

	public isTestFile(content: string): boolean {
		// glob матчит все общие модули расширений (включая сам фреймворк YAxUnit:
		// ЮТ*-модули). Тестовый — лишь модуль с фактически зарегистрированными
		// тестами (.ДобавитьТест("Имя")); по нему же parseFile строит кейсы.
		// Служебные модули фреймворка таких регистраций не содержат и отсекаются.
		return parseBslTestModule(content, 'yaxunit') !== undefined;
	}

	public describeFileLocation(fileUri: vscode.Uri, _workspaceRoot: string) {
		// Путь .../cfe/<Расширение>/CommonModules/<Модуль>/Module.bsl →
		// в дереве: <Расширение> → <Модуль> (вместо бессмысленного Module.bsl)
		const segments = fileUri.fsPath.split(/[\\/]/);
		const index = segments.lastIndexOf('CommonModules');
		const extensionName = index >= 2 ? segments[index - 1] : undefined;
		return {
			segments: extensionName ? [extensionName] : [],
			label: extractModuleName(fileUri.fsPath)
		};
	}

	/**
	 * Модули тестового расширения прогоняются одним запуском 1С: фильтр YAxUnit
	 * принимает список модулей, отдельный сеанс на модуль только умножает время.
	 */
	public batchGroupKey(): string {
		return 'all';
	}

	/**
	 * Батч-прогон: один запуск 1С со списком модулей в фильтре.
	 *
	 * Отчёт общий, кейсы раскладываются по файлам через имя модуля в classname.
	 *
	 * @param units - Файлы прогона (модули тестового расширения)
	 * @param reportDir - Каталог отчёта прогона
	 * @returns План батч-прогона
	 */
	public async buildBatchRunPlan(units: RunUnit[], reportDir: string): Promise<AdapterRunPlan | undefined> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		const baseConfig = await this.readProjectConfig(workspaceRoot);
		const baseFilter =
			baseConfig['filter'] && typeof baseConfig['filter'] === 'object'
				? (baseConfig['filter'] as Record<string, unknown>)
				: {};
		const modules = [...new Set(units.map((unit) => extractModuleName(unit.fileUri.fsPath)))];
		const extensions = await this.extensionNames(units);

		const reportPathRaw =
			typeof baseConfig['reportPath'] === 'string' && baseConfig['reportPath'].length > 0
				? baseConfig['reportPath']
				: path.join(reportDir, 'report.xml');
		const reportPathAbsolute = workspaceRoot
			? resolveConfigPath(reportPathRaw, workspaceRoot)
			: reportPathRaw;

		const runConfig: Record<string, unknown> = {
			...baseConfig,
			filter: { ...baseFilter, extensions, modules, tests: null },
			reportPath: reportPathRaw,
			reportFormat: baseConfig['reportFormat'] ?? 'jUnit',
			closeAfterTests: baseConfig['closeAfterTests'] ?? true
		};

		const configPath = path.join(reportDir, 'yaxunit-config.json');
		await fs.writeFile(configPath, JSON.stringify(runConfig, null, 2), 'utf8');

		const connectionArgs = await this.vrunner.getIbConnectionParam();
		const [args] = await this.vrunner.planIntent({
			kind: 'run.enterprise',
			command: `RunUnitTests=${configPath}`,
			common: connectionArgs
		});

		return {
			tool: 'vrunner',
			args,
			reportTarget: { format: 'junit', path: reportPathAbsolute }
		};
	}

	public async buildRunPlan(unit: RunUnit, reportDir: string): Promise<AdapterRunPlan> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		const moduleName = extractModuleName(unit.fileUri.fsPath);
		const baseConfig = await this.readProjectConfig(workspaceRoot);

		// Фильтр поверх конфига проекта: модуль целиком либо выбранные тесты
		const baseFilter =
			baseConfig['filter'] && typeof baseConfig['filter'] === 'object'
				? (baseConfig['filter'] as Record<string, unknown>)
				: {};
		const extensions = await this.extensionNames([unit]);
		const filter = unit.caseNames && unit.caseNames.length > 0
			? {
				...baseFilter,
				extensions,
				modules: null,
				tests: unit.caseNames.map((name) => `${moduleName}.${name}`)
			}
			: { ...baseFilter, extensions, modules: [moduleName], tests: null };

		const reportPathRaw =
			typeof baseConfig['reportPath'] === 'string' && baseConfig['reportPath'].length > 0
				? baseConfig['reportPath']
				: path.join(reportDir, 'report.xml');
		const reportPathAbsolute = workspaceRoot
			? resolveConfigPath(reportPathRaw, workspaceRoot)
			: reportPathRaw;

		const runConfig: Record<string, unknown> = {
			...baseConfig,
			filter,
			reportPath: reportPathRaw,
			reportFormat: baseConfig['reportFormat'] ?? 'jUnit',
			closeAfterTests: baseConfig['closeAfterTests'] ?? true
		};

		const configPath = path.join(reportDir, 'yaxunit-config.json');
		await fs.writeFile(configPath, JSON.stringify(runConfig, null, 2), 'utf8');

		const noReportHint =
			'Для YAxUnit в информационной базе должны быть загружены: расширение-движок YAXUNIT ' +
			'(yaxunit.cfe с https://github.com/bia-technologies/yaxunit/releases) и тестовое расширение ' +
			'с вашими тестами. У обоих отключите «Безопасный режим» и «Защиту от опасных действий».';

		// --settings активного профиля подставляет planIntent централизованно.
		const [args] = await this.vrunner.planIntent(
			{ kind: 'run.enterprise', command: `RunUnitTests=${configPath}` }
		);
		return {
			tool: 'vrunner',
			args,
			reportTarget: { format: 'junit', path: reportPathAbsolute },
			noReportHint
		};
	}

	/**
	 * Имена расширений, которым принадлежат запускаемые модули.
	 *
	 * Фильтр YAxUnit отбирает тесты по имени расширения. В конфиге проекта оно
	 * задано одним списком, а панель показывает модули из обоих корней (решения
	 * и тестового): со списком из конфига запуск модуля из другого расширения
	 * дал бы пустой отчёт. Имя берём из метаданных исходников - оно может не
	 * совпадать с именем каталога.
	 *
	 * @param units - Файлы прогона
	 * @returns Имена расширений без повторов
	 */
	private async extensionNames(units: RunUnit[]): Promise<string[]> {
		const dirs = [...new Set(
			units
				.map((unit) => extensionSourceDir(unit.fileUri.fsPath))
				.filter((dir): dir is string => dir !== undefined)
		)];
		const names = await Promise.all(dirs.map((dir) => resolveExtensionNameFromSrc(dir)));
		return [...new Set(names)];
	}

	/**
	 * Читает базовый конфиг YAxUnit проекта (tools/yaxunit.json)
	 *
	 * @returns Содержимое конфига или пустой объект, если файла нет
	 */
	private async readProjectConfig(workspaceRoot: string | undefined): Promise<Record<string, unknown>> {
		if (!workspaceRoot) {
			return {};
		}

		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const configured = config.get<string>('test.yaxunitConfigPath', DEFAULT_TESTING.yaxunitConfigPath);
		const configPath = resolveConfigPath(configured, workspaceRoot);

		try {
			return JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>;
		} catch (error) {
			log.debug(`Конфиг YAxUnit ${configPath} не прочитан: ${(error as Error).message}`);
			return {};
		}
	}
}

/**
 * Извлекает имя общего модуля из пути .../CommonModules/<Имя>/Module.bsl
 */
export function extensionSourceDir(fsPath: string): string | undefined {
	const segments = fsPath.split(/[\\/]/);
	const index = segments.lastIndexOf('CommonModules');
	if (index < 1) {
		return undefined;
	}
	return segments.slice(0, index).join(path.sep);
}

export function extractModuleName(fsPath: string): string {
	const segments = fsPath.split(/[\\/]/);
	const index = segments.lastIndexOf('CommonModules');
	if (index >= 0 && index + 1 < segments.length) {
		return segments[index + 1];
	}
	return path.basename(path.dirname(fsPath));
}
