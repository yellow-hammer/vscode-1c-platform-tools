import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { VRunnerManager } from '../../../shared/vrunnerManager';
import type { CommandExecutionOptions, StructuredCommandResult } from '../../../shared/commandExecutionTypes';
import { findExecutable } from '../../../shared/executableLookup';
import { BUILD_SUBDIRS } from '../../../shared/pathDefaults';
import { logger } from '../../../shared/logger';
import { notifyQuiet, notifyQuietFailure } from '../../../shared/notify';
import { createVRunnerTask, type TaskOutputChain } from '../../tasks/vrunnerTask';
import { getMutationTestingCommandName } from '../../tools/commandNames';
import { outputTail } from '../../edt/edtRunner';
import { packagedefDeclaresDependency, resolveOneScriptRunner } from '../adapters/onescriptAdapter';
import { resolveOnescriptTestsPath } from '../onescriptTestsPath';
import {
	engineVersionSupported,
	excludedDirectories,
	isFrameworkDependentEngine,
	MUTATOS_MIN_ENGINE,
	mutatosCall,
	mutatosEntry,
	mutatosEnv,
	mutatosReports,
	mutatosTempEnv,
	oneUnitSuiteName,
	parseEngineVersion,
	relativeTestsDirs,
	selectionLabel,
	type MutatosReports,
	type TestSelection,
} from './mutatosRun';
import { listFiles, parseMutationReport, summarizeReport, summaryData, summaryLine, type MutationSummary } from './mutatosReport';
import { clearSurvivors, showSurvivors } from './mutatosDiagnostics';
import { findSourceDirectories } from './mutatosSources';
import { currentOnescriptProfiles } from '../onescriptEnv/profilesUi';

const log = logger.scope('mutatos');

/** Тип задачи мутационного прогона. */
const MUTATOS_TASK_TYPE = '1c-mutatos';

/** Кнопка сообщения о неустановленном mutatos. */
const INSTALL_DEPENDENCIES = 'Установить зависимости';
const OPEN_PACKAGEDEF = 'Открыть packagedef';

/** Причина, по которой прогон не запускается, и что предложить пользователю. */
interface NotStarted {
	message: string;
	actions?: { title: string; run: () => Thenable<unknown> }[];
}

/** Итог прогона задачи. */
interface RunOutcome {
	exitCode: number;
	summary?: MutationSummary;
}

/** Идущие прогоны по корням проектов: второй прогон одного проекта переписал бы отчёты первого. */
const running = new Map<string, Promise<RunOutcome>>();

/**
 * Запускает мутационное тестирование проекта задачей VS Code.
 *
 * Раннер тестов, mutatos в зависимостях проекта, каталог исходников, движок и
 * каталог рабочих копий проверяются до запуска: причина, по которой задача не
 * запустилась, показывается сообщением, а отказ самого mutatos виден в терминале
 * задачи. Прогоны одного проекта не накладываются: отчёты у них общие. Итог по
 * отчёту идёт в строку состояния, выжившие мутанты в Problems.
 *
 * @param vrunner - Менеджер инструментов проекта
 * @param opts - Опции выполнения; при wait: true ответ приходит после прогона
 * @param run.output - Общий терминал шагов команды
 * @param run.selection - Отбор тестов; без него мутанты проверяются всеми тестами проекта
 * @returns Результат при wait: true, с итогом по отчёту в data
 */
export async function runMutationTesting(
	vrunner: VRunnerManager,
	opts?: CommandExecutionOptions,
	run: { output?: TaskOutputChain; selection?: TestSelection; profileName?: string } = {}
): Promise<StructuredCommandResult | void> {
	const { output, selection, profileName } = run;
	const profiles = currentOnescriptProfiles();
	const selected = profiles?.store.names() ?? [];
	if (profileName === undefined && selected.length > 1) {
		let last: StructuredCommandResult | void = undefined;
		for (const name of selected) {
			last = await runMutationTesting(vrunner, opts, { output, selection, profileName: name });
			if (last !== undefined && last.success === false) {
				return last;
			}
		}
		return last;
	}
	const root = vrunner.getWorkspaceRoot();
	if (!root) {
		return notStarted({ message: 'Откройте рабочую область с проектом OneScript.' }, opts);
	}

	if (running.has(root)) {
		return notStarted({ message: 'Мутационное тестирование этого проекта уже идёт: дождитесь конца прогона или остановите задачу.' }, opts);
	}

	const missing = mutatosMissing(root);
	if (missing) {
		return notStarted(missing, opts);
	}

	if (resolveOneScriptRunner(root).kind !== 'oneunit') {
		return notStarted(
			{ message: 'mutatos проверяет мутантов тестами OneUnit, а в проекте выбран 1testrunner: настройка test.onescriptRunner.' },
			opts
		);
	}

	const reportsDir = reportsDirectory(vrunner, root);
	const reports = mutatosReports(reportsDir);
	const testsDirs = [path.resolve(root, resolveOnescriptTestsPath(root))];
	const outputDirs = [path.resolve(root, vrunner.getOutPath()), path.resolve(root, vrunner.getDistPath())];
	const sourcesDirs = findSourceDirectories(root, { skip: [...testsDirs, ...outputDirs] });
	if (sourcesDirs.length === 0) {
		return notStarted({ message: 'Исходников OneScript в проекте нет: файлы .os есть только в каталоге тестов или их нет совсем.' }, opts);
	}

	const engine = await resolveEngine(vrunner, root);
	if ('message' in engine) {
		return notStarted(engine, opts);
	}

	const excluded = excludedDirectories({
		root,
		sourcesDirs,
		testsDirs,
		outputDirs,
		hasTopLevel: (name) => fs.existsSync(path.join(root, name)),
	});

	const profilesNow = currentOnescriptProfiles();
	const requested = profileName ?? (profilesNow?.store.names().length === 1 ? profilesNow.store.names()[0] : undefined);
	const decision = profilesNow ? await profilesNow.decide(requested) : { kind: 'unchanged' as const };
	if (decision.kind === 'error') {
		return notStarted({ message: decision.message }, opts);
	}
	const env = mutatosEnv(decision.kind === 'env' ? decision.env : process.env, {
		binDir: decision.kind === 'env' ? '' : path.dirname(engine.oscript),
		testsDirs: relativeTestsDirs(root, testsDirs),
		excluded,
	});
	const call = mutatosCall({ oscript: engine.oscript, root, sourcesDirs, reports, selection });
	log.info(`mutatos: движок ${engine.oscript}, исключаемые каталоги ${excluded.join(',')}`);

	const commandTitle = getMutationTestingCommandName().title;
	const title = selection ? `${commandTitle} «${selectionLabel(selection)}»` : commandTitle;
	let printed = '';
	let startedAt = 0;
	const finished = new Promise<RunOutcome>((resolve) => {
		const task = createVRunnerTask({
			name: title,
			command: () => {
				startedAt = Date.now();
				const tempDir = path.join(os.tmpdir(), `1cpt-mutatos-${randomBytes(4).toString('hex')}`);
				prepareRun(reports, tempDir);
				return {
					command: call,
					env: mutatosTempEnv(env, tempDir),
					onExit: () => removeDirectory(tempDir),
				};
			},
			cwd: root,
			env,
			root,
			definition: taskDefinition(root, selection),
			// Итог разбирается после каждого запуска задачи, в том числе повторного
			exitCallback: (exitCode) => {
				const selected = selection !== undefined;
				const summary = showRunResults({ title, root, sourcesDirs, reports, startedAt, exitCode, selected });
				resolve({ exitCode, summary });
			},
			appendOutput: output?.append(),
			onOutput: (chunk) => {
				printed = outputTail(printed + chunk);
			},
		});
		// Конец задачи снимает признак идущего прогона и тогда, когда терминал так и не открылся
		const ended = vscode.tasks.onDidEndTask((event) => {
			if (event.execution.task === task) {
				ended.dispose();
				resolve({ exitCode: 1 });
			}
		});
		vscode.tasks.executeTask(task).then(undefined, (error: Error) => {
			ended.dispose();
			log.error(`Задача мутационного тестирования не запустилась: ${error.message}`);
			resolve({ exitCode: 1 });
		});
	});
	running.set(root, finished);
	void finished.finally(() => {
		if (running.get(root) === finished) {
			running.delete(root);
		}
	});

	if (opts?.wait !== true) {
		return;
	}
	const { exitCode, summary } = await finished;
	const artifacts = [reports.json, reports.html, reports.xml].filter((file) => fs.existsSync(file));
	return {
		success: exitCode === 0,
		exitCode,
		stdout: printed,
		stderr: exitCode === 0 ? '' : `mutatos завершился с кодом ${exitCode}`,
		artifact: artifacts.includes(reports.html) ? reports.html : undefined,
		artifacts,
		data: summary ? summaryData(summary, root) : undefined,
	};
}

/** Каталог отчётов mutatos проекта. */
function reportsDirectory(vrunner: VRunnerManager, root: string): string {
	return path.resolve(root, vrunner.getOutPath(), BUILD_SUBDIRS.mutatos);
}

/**
 * Определение задачи прогона: по нему VS Code отличает задачи друг от друга,
 * поэтому отбор входит в него.
 *
 * @param root - Корень проекта
 * @param selection - Отбор тестов
 */
function taskDefinition(root: string, selection?: TestSelection): vscode.TaskDefinition {
	if (!selection) {
		return { type: MUTATOS_TASK_TYPE, project: root };
	}
	return {
		type: MUTATOS_TASK_TYPE,
		project: root,
		suite: oneUnitSuiteName(selection.file),
		...(selection.method === undefined ? {} : { method: selection.method }),
	};
}

/**
 * Открывает HTML-отчёт последнего прогона во внешнем браузере.
 *
 * @param vrunner - Менеджер инструментов проекта
 */
export async function openMutationReport(vrunner: VRunnerManager): Promise<void> {
	const root = vrunner.getWorkspaceRoot();
	if (!root) {
		void vscode.window.showErrorMessage('Откройте рабочую область с проектом OneScript.');
		return;
	}
	const { html } = mutatosReports(reportsDirectory(vrunner, root));
	if (!fs.existsSync(html)) {
		void vscode.window.showInformationMessage(
			`Отчёта мутаций ещё нет: запустите «${getMutationTestingCommandName().title}».`
		);
		return;
	}
	await vscode.env.openExternal(vscode.Uri.file(html));
}

/**
 * Итог прогона по отчёту: выжившие в Problems, индекс в строке состояния.
 *
 * Без свежего отчёта итога нет: причина отказа видна в терминале задачи.
 *
 * @returns Итог или undefined, если отчёт не записан
 */
function showRunResults(run: {
	title: string;
	root: string;
	sourcesDirs: readonly string[];
	reports: MutatosReports;
	startedAt: number;
	exitCode: number;
	selected: boolean;
}): MutationSummary | undefined {
	const summary = readSummary(run.reports.json, run.sourcesDirs, run.startedAt);
	if (!summary) {
		return undefined;
	}
	showSurvivors(summary.survivors, run.reports.json, run.root);
	if (summary.unmapped > 0) {
		log.warn(`Выжившие мутанты без файла в ${run.sourcesDirs.join(', ')}: ${summary.unmapped}`);
	}
	const line = summaryLine(run.title, summary, run.selected);
	if (run.exitCode === 0) {
		notifyQuiet(line);
	} else {
		notifyQuietFailure(line);
	}
	return summary;
}

/**
 * Итог по отчёту, который записал этот прогон.
 *
 * @param json - Файл отчёта JSON
 * @param sourcesDirs - Каталоги исходников прогона
 * @param startedAt - Время запуска
 */
function readSummary(json: string, sourcesDirs: readonly string[], startedAt: number): MutationSummary | undefined {
	let text: string;
	try {
		if (fs.statSync(json).mtimeMs < startedAt) {
			log.warn(`Отчёт mutatos не обновлён прогоном: ${json}`);
			return undefined;
		}
		text = fs.readFileSync(json, 'utf8');
	} catch {
		return undefined;
	}
	try {
		return summarizeReport(parseMutationReport(text), sourcesDirs.flatMap((dir) => listFiles(dir)));
	} catch (error) {
		log.warn(`Отчёт mutatos не разобран: ${json}: ${(error as Error).message}`);
		return undefined;
	}
}

/**
 * Готовит запуск: прежние отчёты и выжившие в Problems удаляются, и после
 * прогона отчёты есть, только если их записал он; временный каталог создаётся
 * заново.
 */
function prepareRun(reports: MutatosReports, tempDir: string): void {
	clearSurvivors();
	try {
		fs.mkdirSync(path.dirname(reports.json), { recursive: true });
		for (const file of [reports.json, reports.html, reports.xml]) {
			fs.rmSync(file, { force: true });
		}
		fs.mkdirSync(tempDir, { recursive: true });
	} catch (error) {
		log.warn(`Подготовка прогона mutatos не удалась: ${(error as Error).message}`);
	}
}

/** Удаляет каталог; файлы, которые ещё держит завершающийся процесс, ждутся повтором. */
function removeDirectory(dir: string): void {
	void fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch((error: Error) => {
		log.warn(`Временный каталог mutatos не удалён: ${dir}: ${error.message}`);
	});
}

/**
 * Причина, если mutatos в проекте не установлен.
 *
 * @param root - Корень проекта
 */
function mutatosMissing(root: string): NotStarted | undefined {
	if (fs.existsSync(mutatosEntry(root))) {
		return undefined;
	}
	const packagedef = path.join(root, 'packagedef');
	let declared = false;
	try {
		declared = packagedefDeclaresDependency(fs.readFileSync(packagedef, 'utf8'), 'mutatos');
	} catch {
		// packagedef нет: подсказка та же
	}
	const install = { title: INSTALL_DEPENDENCIES, run: () => vscode.commands.executeCommand('1c-platform-tools.dependencies.install') };
	if (declared) {
		return {
			message: 'mutatos объявлен в packagedef, но не установлен: выполните «Установить зависимости».',
			actions: [install],
		};
	}
	const open = { title: OPEN_PACKAGEDEF, run: () => vscode.window.showTextDocument(vscode.Uri.file(packagedef)) };
	return {
		message: 'mutatos не установлен в проекте: добавьте в packagedef .РазработкаЗависитОт("mutatos") и выполните «Установить зависимости».',
		actions: fs.existsSync(packagedef) ? [open, install] : [install],
	};
}

/**
 * Движок OneScript для mutatos: выбранный так же, как для остальных команд.
 *
 * Нужен собственный исполняемый файл движка по абсолютному пути и версия не
 * ниже той, что требует mutatos.
 *
 * @param vrunner - Менеджер инструментов проекта
 * @param root - Корень проекта
 * @returns Путь к исполняемому файлу движка или причина отказа
 */
async function resolveEngine(vrunner: VRunnerManager, root: string): Promise<{ oscript: string } | NotStarted> {
	const setting = 'components.path.oscript';
	if (!(await vrunner.checkOscriptAvailable())) {
		return { message: `OneScript не найден: укажите путь к нему в настройке ${setting}.` };
	}
	const selected = vrunner.getResolvedOscriptPath() ?? 'oscript';
	const oscript = findExecutable(selected, await vrunner.oneScriptEnv(), root);
	if (!oscript) {
		return { message: `Не найден исполняемый файл OneScript ${selected}: укажите путь к нему в настройке ${setting}.` };
	}
	if (isFrameworkDependentEngine(oscript)) {
		return {
			message: `mutatos не работает с OneScript, который запускается через dotnet: ${oscript}. Укажите в настройке ${setting} сборку со своим рантаймом.`,
		};
	}
	const version = parseEngineVersion(await engineVersionOutput(oscript));
	if (!version) {
		return { message: `Не удалось узнать версию OneScript ${oscript}.` };
	}
	if (!engineVersionSupported(version.parts)) {
		return {
			message: `mutatos нужен OneScript не ниже ${MUTATOS_MIN_ENGINE.join('.')}, а выбран ${version.text}: ${oscript}. Укажите другой движок в настройке ${setting}.`,
		};
	}
	return { oscript };
}

/** Вывод `oscript -version`; пусто, если движок не ответил. */
function engineVersionOutput(oscript: string): Promise<string> {
	return new Promise((resolve) => {
		execFile(oscript, ['-version'], { timeout: 15000, windowsHide: true }, (error, stdout) => {
			resolve(error ? '' : String(stdout));
		});
	});
}

/**
 * Ответ команды, которая не запустилась: сообщение пользователю или результат агенту.
 */
async function notStarted(reason: NotStarted, opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
	log.warn(`Мутационное тестирование не запущено: ${reason.message}`);
	if (opts?.wait === true) {
		return { success: false, exitCode: -1, stdout: '', stderr: reason.message };
	}
	const actions = reason.actions ?? [];
	const picked = await vscode.window.showErrorMessage(reason.message, ...actions.map((action) => action.title));
	await actions.find((action) => action.title === picked)?.run();
}
