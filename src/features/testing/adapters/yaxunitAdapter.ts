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

const log = logger.scope('testing');

/**
 * Адаптер YAxUnit (модульные тесты в расширении конфигурации)
 *
 * Discovery: общие модули тестового расширения (paths.cfe → CommonModules → Module.bsl)
 * с регистрацией тестов через ДобавитьТест("...").
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
		return config.get<boolean>('testing.frameworks.yaxunit', true);
	}

	public getIncludeGlobs(): string[] {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const base = normalizeGlobBase(config.get<string>('paths.cfe', DEFAULT_PATHS.cfe));
		// Формат Конфигуратора: CommonModules/<Имя>/Ext/Module.bsl
		return [`${base}/*/CommonModules/*/Ext/Module.bsl`];
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

	public async buildRunPlan(unit: RunUnit, reportDir: string): Promise<AdapterRunPlan> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		const moduleName = extractModuleName(unit.fileUri.fsPath);
		const baseConfig = await this.readProjectConfig(workspaceRoot);

		// Фильтр поверх конфига проекта: модуль целиком либо выбранные тесты
		const baseFilter =
			baseConfig['filter'] && typeof baseConfig['filter'] === 'object'
				? (baseConfig['filter'] as Record<string, unknown>)
				: {};
		const filter = unit.caseNames && unit.caseNames.length > 0
			? { ...baseFilter, modules: null, tests: unit.caseNames.map((name) => `${moduleName}.${name}`) }
			: { ...baseFilter, modules: [moduleName], tests: null };

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
	 * Читает базовый конфиг YAxUnit проекта (tools/yaxunit.json)
	 *
	 * @returns Содержимое конфига или пустой объект, если файла нет
	 */
	private async readProjectConfig(workspaceRoot: string | undefined): Promise<Record<string, unknown>> {
		if (!workspaceRoot) {
			return {};
		}

		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const configured = config.get<string>('testing.yaxunitConfigPath', DEFAULT_TESTING.yaxunitConfigPath);
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
export function extractModuleName(fsPath: string): string {
	const segments = fsPath.split(/[\\/]/);
	const index = segments.lastIndexOf('CommonModules');
	if (index >= 0 && index + 1 < segments.length) {
		return segments[index + 1];
	}
	return path.basename(path.dirname(fsPath));
}
