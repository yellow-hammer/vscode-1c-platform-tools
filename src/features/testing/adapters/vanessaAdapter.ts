import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { VRunnerManager } from '../../../shared/vrunnerManager';
import { logger } from '../../../shared/logger';
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

const log = logger.scope('testing');

/**
 * Адаптер Vanessa Automation (BDD-сценарии в .feature файлах)
 *
 * Discovery: статический разбор Gherkin (Функционал → Сценарии).
 * Запуск: vrunner vanessa --settings env.json --ibconnection ... --path <файл> —
 * так же, как команда «Запустить текущий feature», но в батч-режиме env.json.
 *
 * Результаты читаются из отчётов, настроенных в самом проекте
 * (env.json → --vanessasettings → tools/VAParams.json): jUnit, а если он
 * выключен — Cucumber JSON (типичная конфигурация vanessa-bootstrap).
 *
 * Ограничение CLI: отдельный сценарий запустить нельзя — выполняется файл
 * целиком, статусы сценариев раскладываются из отчёта (testcase = сценарий).
 */
export class VanessaAdapter implements TestFrameworkAdapter {
	public readonly id = 'vanessa' as const;
	public readonly label = 'Vanessa Automation';

	constructor(private readonly vrunner: VRunnerManager) {}

	public isEnabled(): boolean {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		if (!config.get<boolean>('testing.frameworks.vanessa', true)) {
			return false;
		}
		// VA выполняет сценарии в информационной базе — без конфигурации
		// (чистая OneScript-библиотека) каталог фич принадлежит 1bdd
		return hasConfigurationSources(this.vrunner);
	}

	public getIncludeGlobs(): string[] {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const base = normalizeGlobBase(config.get<string>('testing.featuresPath', DEFAULT_TESTING.featuresPath));
		return [`${base}/**/*.feature`];
	}

	public parseFile(content: string): DiscoveredFile | undefined {
		return parseFeatureFile(content);
	}

	public describeFileLocation(fileUri: vscode.Uri, workspaceRoot: string) {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const base = config.get<string>('testing.featuresPath', DEFAULT_TESTING.featuresPath);
		return { segments: directorySegments(fileUri.fsPath, base, workspaceRoot) };
	}

	public async buildRunPlan(unit: RunUnit, reportDir: string): Promise<AdapterRunPlan> {
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = [
			'vanessa',
			...this.vrunner.getSettingsParam(),
			...ibConnectionParam,
			'--path',
			unit.fileUri.fsPath
		];

		const reportTarget = await this.findProjectReportTarget();
		if (reportTarget) {
			return { tool: 'vrunner', args, reportTarget };
		}

		// Проект без VAParams (или без настроенных отчётов): подключаем
		// собственные настройки VA с jUnit-отчётом в каталог прогона
		log.info('VAParams проекта не настроены на отчёты — используются настройки VA от расширения');
		const vanessaSettings = {
			'ВыполнитьСценарии': true,
			'ЗавершитьРаботуСистемы': true,
			'ДелатьОтчетВФорматеjUnit': true,
			'ОтчетjUnit': { 'КаталогВыгрузкиjUnit': reportDir }
		};
		const settingsPath = path.join(reportDir, 'vanessasettings.json');
		await fs.writeFile(settingsPath, JSON.stringify(vanessaSettings, null, 2), 'utf8');

		return {
			tool: 'vrunner',
			args: [...args, '--vanessasettings', settingsPath]
		};
	}

	/**
	 * Ищет настроенную в проекте цель отчёта VA
	 *
	 * env.json (vanessa.--vanessasettings) → VAParams.json → jUnit или Cucumber JSON.
	 */
	private async findProjectReportTarget(): Promise<ReportTarget | undefined> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return undefined;
		}

		try {
			const envJson = (await this.vrunner.readEnvJson()) as Record<string, unknown>;
			const vaSettingsRel = vanessaSettingsPathFromEnv(envJson) ?? './tools/VAParams.json';
			const vaSettingsPath = resolveConfigPath(vaSettingsRel, workspaceRoot);
			const vaParams = JSON.parse(await fs.readFile(vaSettingsPath, 'utf8')) as Record<string, unknown>;
			return vanessaReportTarget(vaParams, workspaceRoot);
		} catch (error) {
			log.debug(`Не удалось прочитать настройки VA проекта: ${(error as Error).message}`);
			return undefined;
		}
	}
}
