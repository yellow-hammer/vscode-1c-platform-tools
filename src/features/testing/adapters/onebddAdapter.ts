import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { VRunnerManager } from '../../../shared/vrunnerManager';
import { TestFrameworkAdapter, AdapterRunPlan, RunUnit } from '../frameworkAdapter';
import { DiscoveredFile } from '../parsers/parserTypes';
import { parseFeatureFile } from '../parsers/featureParser';
import { JUnitCase } from '../parsers/junitParser';
import { resolveConfigPath } from '../projectTestConfig';
import { normalizeGlobBase, directorySegments } from './adapterUtils';
import { hasConfigurationSources } from './xunitAdapter';
import { DEFAULT_TESTING } from '../../../shared/pathDefaults';

/**
 * Адаптер 1bdd — BDD-сценарии для OneScript-проектов
 *
 * Те же Gherkin .feature файлы, что и у Vanessa Automation, но выполняются
 * консольным раннером 1bdd без платформы 1С. Каталог фич принадлежит 1bdd
 * только в чистых OneScript-проектах (без исходников конфигурации src/cf) —
 * в проектах 1С фичи относятся к Vanessa Automation.
 *
 * Запуск: `1bdd exec <файл> -junit-out <отчёт>`; отдельный сценарий —
 * через `-name <имя>` (точечный запуск поддерживается).
 *
 * Особенность отчёта 1bdd: testcase — это ШАГ (classname = имя сценария,
 * name = имя шага, статус — атрибутом status). Перед сопоставлением с деревом
 * шаги агрегируются в результаты сценариев (transformReportCases).
 */
export class OneBddAdapter implements TestFrameworkAdapter {
	public readonly id = 'onebdd' as const;
	public readonly label = '1bdd (OneScript)';
	/** Отчёты пишутся в build/out/1bdd, временный каталог не нужен */
	public readonly usesReportDir = false;

	constructor(private readonly vrunner: VRunnerManager) {}

	public isEnabled(): boolean {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		if (!config.get<boolean>('testing.frameworks.onebdd', true)) {
			return false;
		}
		// В проектах 1С каталог фич принадлежит Vanessa Automation
		return !hasConfigurationSources(this.vrunner);
	}

	public getIncludeGlobs(): string[] {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const base = normalizeGlobBase(config.get<string>('testing.featuresPath', DEFAULT_TESTING.featuresPath));
		return [`${base}/**/*.feature`];
	}

	public parseFile(content: string): DiscoveredFile | undefined {
		return parseFeatureFile(content);
	}

	public transformReportCases(cases: JUnitCase[]): JUnitCase[] {
		return aggregateBddStepsToScenarios(cases);
	}

	public describeFileLocation(fileUri: vscode.Uri, workspaceRoot: string) {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const base = config.get<string>('testing.featuresPath', DEFAULT_TESTING.featuresPath);
		return { segments: directorySegments(fileUri.fsPath, base, workspaceRoot) };
	}

	public async buildRunPlan(unit: RunUnit, _reportDir: string): Promise<AdapterRunPlan> {
		// Отчёты складываем в build/out/1bdd (постоянное место):
		// оттуда их читает и панель, и команда «Allure отчёт»
		const workspaceRoot = this.vrunner.getWorkspaceRoot() ?? '';
		const reportsDir = path.join(workspaceRoot, this.vrunner.getOutPath(), '1bdd');
		await fs.mkdir(reportsDir, { recursive: true });
		const reportFile = path.join(
			reportsDir,
			`${path.basename(unit.fileUri.fsPath, '.feature')}.xml`
		);
		const args = [this.getRunnerCommand(), 'exec', `"${unit.fileUri.fsPath}"`];

		// Точечный запуск одного сценария
		if (unit.caseNames?.length === 1) {
			args.push('-name', `"${unit.caseNames[0]}"`);
		}
		args.push('-junit-out', `"${reportFile}"`);

		return {
			tool: 'shell',
			args: [args.join(' ')],
			reportTarget: { format: 'junit', path: reportFile }
		};
	}

	/**
	 * Путь к 1bdd: настройка testing.onebddPath (относительные пути — от корня
	 * проекта) → локальная установка oscript_modules/bin → PATH
	 */
	private getRunnerCommand(): string {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		const customPath = config.get<string>('testing.onebddPath', '').trim();

		if (customPath.length > 0) {
			const resolved = workspaceRoot ? resolveConfigPath(customPath, workspaceRoot) : customPath;
			return `"${resolved}"`;
		}

		if (workspaceRoot) {
			const name = process.platform === 'win32' ? '1bdd.bat' : '1bdd';
			const localPath = path.join(workspaceRoot, 'oscript_modules', 'bin', name);
			if (fsSync.existsSync(localPath)) {
				return `"${localPath}"`;
			}
		}
		return '1bdd';
	}
}

/**
 * Агрегирует testcase-шаги отчёта 1bdd в результаты сценариев
 *
 * В отчёте 1bdd: classname = имя сценария, name = имя шага. Статус сценария:
 * любой упавший шаг → failed; все шаги skipped (не реализованы/не выполнялись) →
 * skipped; иначе passed. Длительности шагов суммируются, сообщения падений
 * объединяются.
 *
 * @param stepCases - testcase из отчёта (по одному на шаг)
 * @returns По одному JUnitCase на сценарий (name = имя сценария)
 */
export function aggregateBddStepsToScenarios(stepCases: JUnitCase[]): JUnitCase[] {
	const byScenario = new Map<string, JUnitCase[]>();
	for (const step of stepCases) {
		const scenario = step.className || step.name;
		const bucket = byScenario.get(scenario);
		if (bucket) {
			bucket.push(step);
		} else {
			byScenario.set(scenario, [step]);
		}
	}

	const result: JUnitCase[] = [];
	for (const [scenario, steps] of byScenario) {
		const failedStep = steps.find((step) => step.status === 'failed' || step.status === 'error');
		const allSkipped = steps.every((step) => step.status === 'skipped');

		let timeMs: number | undefined;
		for (const step of steps) {
			if (step.timeMs !== undefined) {
				timeMs = (timeMs ?? 0) + step.timeMs;
			}
		}

		result.push({
			suiteName: steps[0].suiteName,
			className: steps[0].suiteName,
			name: scenario,
			status: failedStep ? 'failed' : allSkipped ? 'skipped' : 'passed',
			timeMs,
			message: failedStep ? `Шаг: ${failedStep.name}` : undefined,
			details: failedStep?.details ?? failedStep?.message
		});
	}
	return result;
}
