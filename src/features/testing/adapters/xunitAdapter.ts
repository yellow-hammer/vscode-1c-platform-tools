import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fsSync from 'node:fs';
import { VRunnerManager } from '../../../shared/vrunnerManager';
import { logger } from '../../../shared/logger';
import { TestFrameworkAdapter, AdapterRunPlan, RunUnit, FileTreeLocation } from '../frameworkAdapter';
import { DiscoveredFile } from '../parsers/parserTypes';
import { parseBslTestModule } from '../parsers/bslTestParser';
import {
	extractJUnitPathFromReportsXunit,
	reportsXunitFromEnv,
	resolveConfigPath
} from '../projectTestConfig';
import { normalizeGlobBase, directorySegments } from './adapterUtils';

const log = logger.scope('testing');

/**
 * Описание исходника тестовой обработки (формат decompileepf)
 */
export interface EpfTestSourceInfo {
	/** Имя обработки (= имя будущего .epf) */
	processorName: string;
	/** Каталог обработки с <Имя>.xml — аргумент compileepf */
	processorDir: string;
}

/**
 * Адаптер модульных тестов xUnitFor1C / Vanessa-ADD
 *
 * Тесты для 1С — это внешние обработки: discovery идёт по разобранным
 * исходникам (paths.testsSrc, ObjectModule.bsl в формате decompileepf).
 * Перед прогоном обработка собирается в .epf в каталог тестов (vrunner
 * кэширует сборку), затем запускается бинарник.
 *
 * Файлы .os в каталоге тестов — мир OneScript (1testrunner): xddTestRunner
 * в 1С подключает только внешние обработки, поэтому .os здесь не сканируются.
 *
 * Запуск: vrunner xunit <файл> с настройками проекта (env.json).
 * Путь jUnit-отчёта берётся из env.json (xunit.--reportsxunit, синтаксис
 * ГенераторОтчетаJUnitXML{...} или jUnit:...); если не настроен —
 * передаётся --reportsxunit с каталогом прогона расширения.
 *
 * Ограничение CLI: отдельный метод запустить нельзя — выполняется файл целиком,
 * статусы методов раскладываются из jUnit-отчёта (testcase = метод).
 */
export class XUnitAdapter implements TestFrameworkAdapter {
	public readonly id = 'xunit' as const;
	public readonly label = 'xUnit (Vanessa-ADD)';

	constructor(private readonly vrunner: VRunnerManager) {}

	public isEnabled(): boolean {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		if (!config.get<boolean>('testing.frameworks.xunit', true)) {
			return false;
		}
		return hasConfigurationSources(this.vrunner);
	}

	public getIncludeGlobs(): string[] {
		const epfBase = normalizeGlobBase(this.vrunner.getTestsSrcPath());
		return [`${epfBase}/**/Ext/ObjectModule.bsl`];
	}

	public parseFile(content: string): DiscoveredFile | undefined {
		return parseBslTestModule(content, 'xunit');
	}

	public describeFileLocation(fileUri: vscode.Uri, workspaceRoot: string): FileTreeLocation {
		// Исходник тестовой обработки: узел называется именем обработки
		const epfInfo = epfTestSourceInfo(fileUri.fsPath);
		if (epfInfo) {
			const epfBase = this.vrunner.getTestsSrcPath();
			const wrapperDir = path.dirname(epfInfo.processorDir);
			const segments = directorySegments(
				path.join(wrapperDir, 'placeholder'),
				epfBase,
				workspaceRoot
			);
			return { segments, label: epfInfo.processorName };
		}

		return { segments: directorySegments(fileUri.fsPath, this.vrunner.getTestsPath(), workspaceRoot) };
	}

	public async buildRunPlan(unit: RunUnit, reportDir: string): Promise<AdapterRunPlan> {
		const epfInfo = epfTestSourceInfo(unit.fileUri.fsPath);

		// Исходник обработки: перед прогоном собираем её в build/out/tests и
		// запускаем оттуда собранный .epf. compileepf инкрементальный — если
		// исходник не менялся, сборка пропускается, и запускается уже собранный
		// ранее бинарник. Собрать вручную можно командой «Собрать unit тесты».
		if (epfInfo) {
			const binariesPath = path.join(this.vrunner.getOutPath(), 'tests');
			const ibConnectionParam = await this.vrunner.getIbConnectionParam();
			const builtEpf = path.join(binariesPath, `${epfInfo.processorName}.epf`);
			const basePlan = await this.buildXunitPlan(builtEpf, reportDir);
			return {
				...basePlan,
				prepare: [
					{
						tool: 'vrunner',
						args: ['compileepf', epfInfo.processorDir, binariesPath, ...ibConnectionParam],
						title: `Сборка обработки ${epfInfo.processorName}`
					}
				]
			};
		}

		return this.buildXunitPlan(unit.fileUri.fsPath, reportDir);
	}

	/**
	 * Строит план запуска vrunner xunit для файла или собранного .epf
	 */
	private async buildXunitPlan(targetPath: string, reportDir: string): Promise<AdapterRunPlan> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		const baseArgs = ['xunit', targetPath, ...this.vrunner.getSettingsParam()];

		// Путь jUnit из конфигурации проекта (env.json, секция xunit)
		if (workspaceRoot) {
			try {
				const envJson = (await this.vrunner.readEnvJson()) as Record<string, unknown>;
				const reportsXunit = reportsXunitFromEnv(envJson);
				const junitRel = reportsXunit ? extractJUnitPathFromReportsXunit(reportsXunit) : undefined;
				if (junitRel) {
					return {
						tool: 'vrunner',
						args: baseArgs,
						reportTarget: { format: 'junit', path: resolveConfigPath(junitRel, workspaceRoot) },
						noReportHint: XUNIT_NO_REPORT_HINT
					};
				}
			} catch (error) {
				log.debug(`Не удалось прочитать env.json для xunit: ${(error as Error).message}`);
			}
		}

		// env.json не настроен на jUnit — направляем отчёт в каталог прогона
		const reportFile = path.join(reportDir, 'xunit.xml');
		return {
			tool: 'vrunner',
			args: [...baseArgs, '--reportsxunit', `jUnit:${reportFile}`],
			noReportHint: XUNIT_NO_REPORT_HINT
		};
	}
}

/**
 * Подсказка при прогоне xUnit без отчёта
 *
 * Типичная причина «Не найдено загруженных тестов» — защита от опасных
 * действий блокирует подключение внешней обработки (FAQ Vanessa-ADD).
 */
const XUNIT_NO_REPORT_HINT =
	'Если в выводе «Не найдено загруженных тестов» — включена защита от опасных действий ' +
	'(видно в технической информации прогона). Решения из FAQ Vanessa-ADD: прописать ' +
	'DisableUnsafeActionProtection=.* в conf.cfg платформы, либо создать пользователя ИБ ' +
	'со снятым флагом «Защита от опасных действий» и запускаться под ним.';

/**
 * Распознаёт исходник тестовой обработки по пути к ObjectModule.bsl
 *
 * Структура decompileepf: <обёртки>/<Имя>/<Имя>.xml + <Имя>/<Имя>/Ext/ObjectModule.bsl.
 * processorDir — внешний каталог с <Имя>.xml (аргумент compileepf).
 *
 * @param fsPath - Путь к файлу
 * @returns Описание обработки или undefined, если это не ObjectModule.bsl
 */
export function epfTestSourceInfo(fsPath: string): EpfTestSourceInfo | undefined {
	const segments = fsPath.split(/[\\/]/);
	if (segments.length < 4) {
		return undefined;
	}
	const fileName = segments[segments.length - 1].toLowerCase();
	const extDir = segments[segments.length - 2];
	if (fileName !== 'objectmodule.bsl' || extDir.toLowerCase() !== 'ext') {
		return undefined;
	}

	const processorName = segments[segments.length - 3];
	// Внешний каталог обработки: обычно дублирует имя (<Имя>/<Имя>/Ext/...)
	const innerDir = segments.slice(0, -2).join(path.sep);
	const outerDir = path.dirname(innerDir);
	const processorDir = path.basename(outerDir) === processorName ? outerDir : innerDir;

	return { processorName, processorDir };
}

/**
 * Проверяет наличие исходников конфигурации 1С в проекте
 *
 * Тесты xUnit/Vanessa-ADD выполняются внутри информационной базы — без
 * конфигурации (чистая OneScript-библиотека) фреймворк не имеет смысла,
 * и каталог тестов отдаётся адаптеру OneScript.
 */
export function hasConfigurationSources(vrunner: VRunnerManager): boolean {
	const workspaceRoot = vrunner.getWorkspaceRoot();
	if (!workspaceRoot) {
		return false;
	}
	return fsSync.existsSync(path.join(workspaceRoot, vrunner.getCfPath()));
}
