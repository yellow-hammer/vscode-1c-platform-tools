import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { VRunnerManager } from '../../../shared/vrunnerManager';
import { TestFrameworkAdapter, AdapterRunPlan, RunUnit } from '../frameworkAdapter';
import { DiscoveredFile } from '../parsers/parserTypes';
import { parseFeatureFile } from '../parsers/featureParser';
import {
	ReportTarget,
	resolveConfigPath,
	vanessaReportTarget,
	vanessaSettingsPathFromEnv
} from '../projectTestConfig';
import { normalizeGlobBase, directorySegments } from './adapterUtils';
import { hasConfigurationSources } from './xunitAdapter';
import { DEFAULT_TESTING } from '../../../shared/pathDefaults';
import { projectConfiguration } from '../../../shared/projectConfiguration';

/**
 * Адаптер Vanessa Automation (BDD-сценарии в .feature файлах)
 *
 * Discovery: статический разбор Gherkin (Функционал → Сценарии).
 * Запуск: vrunner vanessa, путь к фиче в featurePath.
 *
 * Результаты читаются из файла vanessasettings: jUnit, а если он выключен,
 * Cucumber JSON.
 *
 * Ограничение CLI: отдельный сценарий запустить нельзя — выполняется файл
 * целиком, статусы сценариев раскладываются из отчёта (testcase = сценарий).
 */
export class VanessaAdapter implements TestFrameworkAdapter {
	public readonly id = 'vanessa' as const;
	public readonly label = 'Vanessa Automation';
	public readonly usesVanessaRunner = true;

	constructor(private readonly vrunner: VRunnerManager) {}

	public async isEnabled(): Promise<boolean> {
		const config = projectConfiguration(this.vrunner.getWorkspaceRoot());
		if (!config.get<boolean>('test.frameworks.vanessa', true)) {
			return false;
		}
		// VA выполняет сценарии в информационной базе — без конфигурации
		// (чистая OneScript-библиотека) каталог фич принадлежит 1bdd
		return hasConfigurationSources(this.vrunner);
	}

	public getIncludeGlobs(): string[] {
		const config = projectConfiguration(this.vrunner.getWorkspaceRoot());
		const base = normalizeGlobBase(config.get<string>('test.path.features', DEFAULT_TESTING.featuresPath));
		return [`${base}/**/*.feature`];
	}

	public parseFile(content: string): DiscoveredFile | undefined {
		return parseFeatureFile(content);
	}

	public describeFileLocation(fileUri: vscode.Uri, workspaceRoot: string) {
		const config = projectConfiguration(workspaceRoot);
		const base = config.get<string>('test.path.features', DEFAULT_TESTING.featuresPath);
		return { segments: directorySegments(fileUri.fsPath, base, workspaceRoot) };
	}

	public async buildRunPlan(unit: RunUnit, _reportDir: string): Promise<AdapterRunPlan> {
		// --settings активного профиля подставляет planIntent централизованно.
		const reportTarget = await this.findProjectReportTarget();
		const [args] = await this.vrunner.planIntent(
			{ kind: 'test.vanessa', featurePath: unit.fileUri.fsPath }
		);
		return reportTarget ? { tool: 'vrunner', args, reportTarget } : { tool: 'vrunner', args };
	}

	/**
	 * Состав прогона решается в buildBatchRunPlan, поэтому группа одна.
	 */
	public batchGroupKey(): string {
		return 'all';
	}

	/**
	 * Батч-прогон одним сеансом, когда выбор можно выразить одним путём.
	 *
	 * `--feature-path` принимает каталог или файл и не повторяется: две опции
	 * подряд оставляют последнюю. Поэтому одним сеансом идут только два случая:
	 * выбран весь набор проекта и выбран каталог целиком. Произвольная россыпь
	 * файлов возвращает undefined, и контроллер прогоняет их поштучно - иначе в
	 * прогон попали бы соседние фичи каталога.
	 *
	 * @param units - Файлы прогона
	 * @param _reportDir - Каталог отчёта прогона (не используется)
	 * @param discovered - Все обнаруженные фичи проекта
	 * @returns План батч-прогона либо undefined
	 */
	public async buildBatchRunPlan(
		units: RunUnit[],
		_reportDir: string,
		discovered: readonly vscode.Uri[]
	): Promise<AdapterRunPlan | undefined> {
		const featurePath = singlePathForSelection(units, discovered);
		if (featurePath === undefined) {
			return undefined;
		}

		const reportTarget = await this.findProjectReportTarget();
		// --settings активного профиля подставляет planIntent централизованно.
		const [args] = await this.vrunner.planIntent(
			featurePath === '' ? { kind: 'test.vanessa' } : { kind: 'test.vanessa', featurePath }
		);
		return reportTarget ? { tool: 'vrunner', args, reportTarget } : { tool: 'vrunner', args };
	}

	/**
	 * Цель отчёта из файла vanessasettings. Ключа нет: цели нет.
	 */
	private async findProjectReportTarget(): Promise<ReportTarget | undefined> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return undefined;
		}

		const { settings, schema } = await this.vrunner.readActiveSettings();
		const vaSettingsRel = vanessaSettingsPathFromEnv(settings, schema);
		if (!vaSettingsRel) {
			return undefined;
		}
		const vaSettingsPath = resolveConfigPath(vaSettingsRel, workspaceRoot);
		const vaParams = JSON.parse(stripBom(await fs.readFile(vaSettingsPath, 'utf8'))) as Record<string, unknown>;
		return vanessaReportTarget(vaParams, workspaceRoot);
	}
}

/**
 * Путь, которым выражается выбор пользователя, если это возможно.
 *
 * @param units - Выбранные файлы
 * @param discovered - Все обнаруженные фичи
 * @returns Пустая строка - весь набор проекта; путь каталога - каталог целиком;
 *          undefined - одним путём выбор не выражается
 */
export function singlePathForSelection(
	units: readonly { fileUri: vscode.Uri }[],
	discovered: readonly vscode.Uri[]
): string | undefined {
	const chosen = new Set(units.map((unit) => unit.fileUri.fsPath));
	if (discovered.length > 0 && discovered.every((uri) => chosen.has(uri.fsPath))) {
		return '';
	}

	const dirs = new Set(units.map((unit) => path.dirname(unit.fileUri.fsPath)));
	if (dirs.size !== 1) {
		return undefined;
	}
	const dir = [...dirs][0];
	const inDir = discovered.filter((uri) => path.dirname(uri.fsPath) === dir);
	return inDir.every((uri) => chosen.has(uri.fsPath)) ? dir : undefined;
}

/** Убирает BOM в начале JSON-файла. */
function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
