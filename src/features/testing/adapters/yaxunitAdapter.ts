import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { VRunnerManager } from '../../../shared/vrunnerManager';
import { logger } from '../../../shared/logger';
import { TestFrameworkAdapter, AdapterRunPlan, RunUnit } from '../frameworkAdapter';
import { DiscoveredFile } from '../parsers/parserTypes';
import { parseBslTestModule } from '../parsers/bslTestParser';
import { resolveConfigPath, yaxunitSectionFromEnv, type YaxunitProfileSection } from '../projectTestConfig';
import { activeSourceGlobBases, normalizeGlobBase } from './adapterUtils';
import { DEFAULT_TESTING } from '../../../shared/pathDefaults';
import { resolveExtensionNameFromSrc } from '../../extensions/extensionNames';
import type { SettingsSchema } from '../../../shared/envProfiles';
import type { YaxunitFilter } from '../../../shared/vrunnerCli';

const log = logger.scope('testing');

const NO_REPORT_HINT =
	'Для YAxUnit в информационной базе должны быть загружены: расширение-движок YAXUNIT ' +
	'(yaxunit.cfe с https://github.com/bia-technologies/yaxunit/releases) и тестовое расширение ' +
	'с вашими тестами. У обоих отключите «Безопасный режим» и «Защиту от опасных действий».';

/**
 * Адаптер YAxUnit (модульные тесты в расширении конфигурации)
 *
 * Discovery: общие модули тестового расширения с регистрацией тестов через
 * ДобавитьТест("..."). Смотрим оба корня расширений: и решения (path.cfe), и
 * тестовых (<path.tests>/cfe) - расширение с тестами держат отдельно от поставки,
 * но и внутри решения оно встречается.
 *
 * Запуск: готовый конфиг из секции yaxunit активного профиля, иначе из
 * настройки test.path.yaxunitConfig; из него же reportPath, поверх ложится
 * filter по выбранному модулю или тестам (единственный фреймворк с точечным
 * запуском). На vanessa-runner 2 это run --command RunUnitTests=<копия> с
 * опциями секции, на 3 - test yaxunit; без конфига фильтр и отчёт уходят
 * опциями команды, остальное раннер берёт из профиля.
 */
export class YaxunitAdapter implements TestFrameworkAdapter {
	public readonly id = 'yaxunit' as const;
	public readonly label = 'YAxUnit';

	constructor(private readonly vrunner: VRunnerManager) {}

	public isEnabled(): boolean {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		return config.get<boolean>('test.frameworks.yaxunit', true);
	}

	public async getIncludeGlobs(): Promise<string[]> {
		const configured = [this.vrunner.getCfePath(), this.vrunner.getTestsCfePath()]
			.map((root) => normalizeGlobBase(root))
			.filter((base) => base.length > 0)
			.flatMap((base) => [
				// расширения лежат подкаталогами настроенного пути
				`${base}/*/CommonModules/*/Ext/Module.bsl`,
				`${base}/*/src/CommonModules/*/Module.bsl`,
			]);

		// В формате EDT конфигурация и расширения - отдельные проекты рабочей
		// области, настроенными путями их не описать.
		const projects = (await activeSourceGlobBases(this.vrunner)).map(
			(base) => `${base}/src/CommonModules/*/Module.bsl`
		);

		return [...configured, ...projects].filter((glob, index, all) => all.indexOf(glob) === index);
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
		const modules = [...new Set(units.map((unit) => extractModuleName(unit.fileUri.fsPath)))];
		const extensions = await this.extensionNames(units);
		const connectionArgs = await this.vrunner.getIbConnectionParam();
		return this.plan({ extensions, modules }, reportDir, connectionArgs);
	}

	public async buildRunPlan(unit: RunUnit, reportDir: string): Promise<AdapterRunPlan> {
		const moduleName = extractModuleName(unit.fileUri.fsPath);
		const extensions = await this.extensionNames([unit]);
		// Модуль целиком либо выбранные тесты
		const filter: YaxunitFilter =
			unit.caseNames && unit.caseNames.length > 0
				? { extensions, tests: unit.caseNames.map((name) => `${moduleName}.${name}`) }
				: { extensions, modules: [moduleName] };
		// --settings активного профиля подставляет planIntent централизованно.
		return this.plan(filter, reportDir);
	}

	/**
	 * План прогона по фильтру.
	 *
	 * С готовым конфигом фильтр накладывается на его копию в каталоге прогона:
	 * раннер использует готовый конфиг как есть. Без конфига, что бывает только
	 * на vanessa-runner 3, фильтр и путь отчёта уходят опциями test yaxunit, а
	 * остальное раннер берёт из секции vrunner.test.yaxunit профиля.
	 *
	 * @param filter - Отбор тестов прогона
	 * @param reportDir - Каталог отчёта прогона
	 * @param common - Сквозные опции команды
	 * @returns План прогона
	 */
	private async plan(filter: YaxunitFilter, reportDir: string, common?: string[]): Promise<AdapterRunPlan> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		const { settings, schema } = await this.vrunner.readActiveSettings();
		const profile = yaxunitSectionFromEnv(settings, schema);
		const baseConfig = await this.readBaseConfig(profile, schema, workspaceRoot);
		const runOptions = {
			ordinaryApp: profile.ordinaryApp,
			exitCodePath: profile.exitCodePath,
			additional: profile.additional,
			noWait: profile.noWait,
		};
		const ownReport = path.join(reportDir, 'report.xml');

		if (baseConfig === undefined) {
			const sectionReport =
				profile.report && workspaceRoot ? resolveConfigPath(profile.report, workspaceRoot) : undefined;
			const [args] = await this.vrunner.planIntent({
				kind: 'test.yaxunit',
				filter,
				report: sectionReport ? undefined : ownReport,
				...runOptions,
				common,
			});
			return {
				tool: 'vrunner',
				args,
				reportTarget: { format: 'junit', path: sectionReport ?? ownReport },
				noReportHint: NO_REPORT_HINT,
			};
		}

		const baseFilter =
			baseConfig['filter'] && typeof baseConfig['filter'] === 'object'
				? (baseConfig['filter'] as Record<string, unknown>)
				: {};
		const reportPathRaw =
			typeof baseConfig['reportPath'] === 'string' && baseConfig['reportPath'].length > 0
				? baseConfig['reportPath']
				: ownReport;
		const runConfig: Record<string, unknown> = {
			...baseConfig,
			filter: {
				...baseFilter,
				extensions: filter.extensions ?? null,
				modules: filter.modules ?? null,
				tests: filter.tests ?? null,
			},
			reportPath: reportPathRaw,
			reportFormat: baseConfig['reportFormat'] ?? 'jUnit',
			closeAfterTests: baseConfig['closeAfterTests'] ?? true,
		};
		const configPath = path.join(reportDir, 'yaxunit-config.json');
		await fs.writeFile(configPath, JSON.stringify(runConfig, null, 2), 'utf8');

		const [args] = await this.vrunner.planIntent({ kind: 'test.yaxunit', configPath, ...runOptions, common });
		return {
			tool: 'vrunner',
			args,
			reportTarget: {
				format: 'junit',
				path: workspaceRoot ? resolveConfigPath(reportPathRaw, workspaceRoot) : reportPathRaw,
			},
			noReportHint: NO_REPORT_HINT,
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
	 * Готовый конфиг прогона: из секции профиля, иначе из настройки test.path.yaxunitConfig.
	 *
	 * На vanessa-runner 2 конфиг есть всегда: без файла база пустая, фильтр и
	 * отчёт панель задаёт сама. На 3 файла из настройки может не быть, тогда
	 * конфиг собирает раннер из секции профиля. Конфиг из профиля обязан читаться.
	 *
	 * @returns Содержимое конфига или undefined, когда готового конфига нет
	 */
	private async readBaseConfig(
		profile: YaxunitProfileSection,
		schema: SettingsSchema,
		workspaceRoot: string | undefined
	): Promise<Record<string, unknown> | undefined> {
		if (!workspaceRoot) {
			return schema === 'v3' ? undefined : {};
		}
		const configured = vscode.workspace
			.getConfiguration('1c-platform-tools')
			.get<string>('test.path.yaxunitConfig', DEFAULT_TESTING.yaxunitConfigPath);
		const configPath = resolveConfigPath(profile.configPath ?? configured, workspaceRoot);
		try {
			return JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>;
		} catch (error) {
			if (profile.configPath) {
				throw new Error(`Конфиг YAxUnit из профиля не прочитан: ${configPath}. ${(error as Error).message}`);
			}
			log.debug(`Конфиг YAxUnit ${configPath} не прочитан: ${(error as Error).message}`);
			return schema === 'v3' ? undefined : {};
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
