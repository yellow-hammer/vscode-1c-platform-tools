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
import { MODULES_DIRECTORY, oneScriptTestsPath, readPackageManifest } from '../../../shared/oneScriptLayout';
import { dependsOn, parsePackagedef } from '../../../shared/packagedef';
import { projectConfiguration } from '../../../shared/projectConfiguration';
import { BUILD_SUBDIRS } from '../../../shared/pathDefaults';

/** Раннер тестов OneScript */
export type OneScriptRunner = '1testrunner' | 'oneunit';

/**
 * Адаптер тестов OneScript
 *
 * Discovery: .os модули в каталоге тестов OneScript — классический стиль
 * (ИсполняемыеСценарии) и аннотационный (&Тест над процедурой).
 *
 * Запуск — без платформы 1С, раннер выбирается настройкой test.onescriptRunner
 * ('auto' — oneunit, если он локально в oscript_modules/bin или объявлен в packagedef,
 * иначе 1testrunner):
 * - 1testrunner: `-run <файл> xddReportPath <каталог>` — jUnit-отчёт. Имя файла
 *   отчёта раннер выбирает сам по набору тестов, поэтому точечный фильтр не
 *   передаём (при одном тесте имя расходится с <файл>.os.xml и отчёт не находится)
 *   — гоняем весь файл, панель раскладывает результаты по кейсам;
 * - OneUnit: `execute -f <файл> [-m <метод>] [-t <теги>] --junit <отчёт>` — точечный
 *   запуск надёжен, отчёт пишется в явный файл, теги отбирают тесты с `&Тег`.
 *
 * Отчёты складываются в build/out/onescript — их подхватывает команда
 * «Allure отчёт». Для старых версий 1testrunner без поддержки xddReportPath
 * прогон завершится errored с подсказкой обновить зависимости.
 *
 * Путь к раннеру: настройка test.path.onescriptRunner (поддерживает
 * относительные пути от корня проекта), иначе локальный oscript_modules/bin,
 * иначе PATH.
 */
export class OneScriptAdapter implements TestFrameworkAdapter {
	public readonly id = 'onescript' as const;
	public readonly label = 'OneScript';
	public readonly usesVanessaRunner = false;
	/** Отчёты пишутся в build/out/onescript, временный каталог не нужен */
	public readonly usesReportDir = false;

	constructor(private readonly vrunner: VRunnerManager) {}

	public async isEnabled(): Promise<boolean> {
		// Конфликта с xUnit нет: .os-файлы всегда OneScript,
		// тесты xUnit для 1С это внешние обработки
		const config = projectConfiguration(this.vrunner.getWorkspaceRoot());
		return config.get<boolean>('test.frameworks.onescript', true);
	}

	public getIncludeGlobs(): string[] {
		const base = normalizeGlobBase(oneScriptTestsPath(this.vrunner.getWorkspaceRoot()));
		return [`${base}/**/*.os`];
	}

	public parseFile(content: string): DiscoveredFile | undefined {
		return parseBslTestModule(content, 'xunit');
	}

	public isTestFile(content: string): boolean {
		// glob матчит все .os под каталогом тестов, включая вспомогательные классы
		// (билдеры/стабы/фикстуры, например в tests/unit/utils/). Тестовый — лишь
		// модуль с ИсполняемыеСценарии/ЗаполнитьНаборТестов/ПолучитьСписокТестов или
		// аннотацией &Тест; по нему же parseFile строит кейсы. Без этой проверки
		// дерево заполняли бы все хелперы, а их «прогон» падал бы без jUnit-отчёта.
		return parseBslTestModule(content, 'xunit') !== undefined;
	}

	public describeFileLocation(fileUri: vscode.Uri, workspaceRoot: string) {
		return { segments: directorySegments(fileUri.fsPath, oneScriptTestsPath(workspaceRoot), workspaceRoot) };
	}

	public async buildRunPlan(unit: RunUnit, _reportDir: string): Promise<AdapterRunPlan> {
		const runner = this.resolveRunner();
		const quotedFile = `"${unit.fileUri.fsPath}"`;
		// Точечный запуск надёжен только у OneUnit (явный --junit <файл>).
		// У 1testrunner имя отчёта выбирается раннером — фильтр его ломает (см. ниже).
		const singleCase = unit.caseNames?.length === 1 ? unit.caseNames[0] : undefined;

		const reportsDir = await this.ensureReportsDir();
		const reportFile = path.join(reportsDir, `${path.basename(unit.fileUri.fsPath)}.xml`);

		if (runner.kind === 'oneunit') {
			const args = [runner.command, 'execute', '-f', quotedFile];
			if (singleCase) {
				args.push('-m', `"${singleCase}"`);
			}
			args.push(...tagsFilter(unit.tags), '--junit', `"${reportFile}"`);
			return {
				tool: 'shell',
				args: [args.join(' ')],
				reportTarget: { format: 'junit', path: reportFile }
			};
		}

		// 1testrunner: jUnit через xddReportPath <каталог> — внутри создаётся
		// <имяФайлаТеста>.xml (testcase = метод, статус атрибутом).
		//
		// Точечный фильтр (`-run <файл> "ИмяТеста"`) намеренно НЕ передаём: при одном
		// отобранном тесте 1testrunner формирует имя файла отчёта из схлопнутого набора
		// тестов, и оно расходится с ожидаемым <файл>.os.xml — отчёт пишется, но панель
		// его не находит («без jUnit-отчёта»). Поэтому всегда гоняем весь файл, а нужный
		// кейс панель подсветит при раскладке результатов.
		const args = [runner.command, '-run', quotedFile, 'xddReportPath', `"${reportsDir}"`];
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
	 * Строит план батч-прогона нескольких файлов одним процессом OneUnit
	 *
	 * `oneunit execute -f <файл1> -f <файл2> ... --junit <общий отчёт>` гонит все
	 * выбранные файлы за один запуск (один холодный старт вместо N) и пишет общий
	 * jUnit-отчёт; контроллер раскладывает его по файлам. Передаём именно -f по
	 * каждому файлу (а не -d по каталогу), чтобы прогнать ровно отобранные тесты и
	 * не зацепить вспомогательные классы из utils/ (см. isTestFile).
	 *
	 * 1testrunner прогоняет каталог целиком: `-runall <каталог> xddReportPath
	 * <каталог отчётов>` пишет общий отчёт `<имя каталога>.xml`, где classname
	 * кейса — имя файла теста; контроллер раскладывает его по файлам. Батч
	 * применим, когда выбранные файлы лежат в одном каталоге: иначе прогон
	 * захватил бы лишние файлы.
	 */
	public async buildBatchRunPlan(units: RunUnit[], _reportDir: string): Promise<AdapterRunPlan | undefined> {
		const runner = this.resolveRunner();
		const reportsDir = await this.ensureReportsDir();

		if (runner.kind === 'oneunit') {
			const reportFile = path.join(reportsDir, '_oneunit-batch.xml');
			const args = [runner.command, 'execute'];
			for (const unit of units) {
				args.push('-f', `"${unit.fileUri.fsPath}"`);
			}
			args.push(...tagsFilter(units[0]?.tags), '--junit', `"${reportFile}"`);

			return {
				tool: 'shell',
				args: [args.join(' ')],
				reportTarget: { format: 'junit', path: reportFile }
			};
		}

		// 1testrunner отбирает тесты каталогом, а не списком файлов: батч возможен,
		// только если весь каталог состоит из выбранных файлов
		const dirs = new Set(units.map((unit) => path.dirname(unit.fileUri.fsPath)));
		if (dirs.size !== 1) {
			return undefined;
		}
		const testsDir = [...dirs][0];
		const dirFiles = await this.testFilesInDirectory(testsDir);
		const selected = new Set(units.map((unit) => path.resolve(unit.fileUri.fsPath).toLowerCase()));
		if (dirFiles.length !== selected.size || dirFiles.some((file) => !selected.has(file))) {
			return undefined;
		}

		const reportFile = path.join(reportsDir, `${path.basename(testsDir)}.xml`);
		const args = [runner.command, '-runall', `"${testsDir}"`, 'xddReportPath', `"${reportsDir}"`];
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
	 * Возвращает тестовые файлы каталога (без вложенных) в нижнем регистре
	 *
	 * @param dirPath - Каталог тестов
	 * @returns Абсолютные пути тестовых файлов
	 */
	private async testFilesInDirectory(dirPath: string): Promise<string[]> {
		let entries: string[];
		try {
			entries = (await fs.readdir(dirPath, { withFileTypes: true }))
				.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.os'))
				.map((entry) => path.join(dirPath, entry.name));
		} catch {
			return [];
		}

		const testFiles: string[] = [];
		for (const filePath of entries) {
			try {
				if (this.isTestFile(await fs.readFile(filePath, 'utf8'))) {
					testFiles.push(path.resolve(filePath).toLowerCase());
				}
			} catch {
				// нечитаемый файл в наборе не участвует
			}
		}
		return testFiles;
	}

	/**
	 * Гарантирует существование постоянного каталога отчётов build/out/onescript
	 *
	 * Отчёты складываются туда (а не во временный каталог прогона): оттуда их
	 * читает и панель тестирования, и команда «Allure отчёт».
	 */
	private async ensureReportsDir(): Promise<string> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot() ?? '';
		const reportsDir = path.join(workspaceRoot, this.vrunner.getOutPath(), BUILD_SUBDIRS.onescript);
		await fs.mkdir(reportsDir, { recursive: true });
		return reportsDir;
	}

	/**
	 * Определяет раннер и команду его запуска
	 */
	private resolveRunner(): { kind: OneScriptRunner; command: string } {
		return resolveOneScriptRunner(this.vrunner.getWorkspaceRoot());
	}
}

/**
 * Отбор тестов OneUnit по тегам: тесты, у которых есть хотя бы один из них.
 *
 * @param tags - Теги `&Тег`; без них отбора нет
 */
function tagsFilter(tags: readonly string[] | undefined): string[] {
	return tags && tags.length > 0 ? ['-t', `"${tags.join(',')}"`] : [];
}

/**
 * Раннер тестов OneScript проекта: вид и исполняемый файл
 *
 * Порядок: test.path.onescriptRunner (относительные пути — от корня
 * проекта) → локальная установка в oscript_modules/bin → PATH.
 *
 * @param workspaceRoot - Корень проекта, чьи настройки читаются
 * @returns Вид раннера и путь к нему либо имя для поиска в PATH
 */
export function oneScriptRunnerProgram(workspaceRoot: string | undefined): { kind: OneScriptRunner; file: string } {
	const config = projectConfiguration(workspaceRoot);
	const runnerSetting = config.get<string>('test.onescriptRunner', 'auto');
	const customPath = config.get<string>('test.path.onescriptRunner', '').trim();

	// Явно заданный путь к раннеру: вид раннера — по имени файла
	if (customPath.length > 0) {
		const resolved = workspaceRoot ? resolveConfigPath(customPath, workspaceRoot) : customPath;
		const kind: OneScriptRunner = path
			.basename(resolved)
			.toLowerCase()
			.includes('oneunit')
			? 'oneunit'
			: '1testrunner';
		return { kind, file: resolved };
	}

	const kind = resolveRunnerKind(runnerSetting, workspaceRoot);
	return { kind, file: findLocalRunner(kind, workspaceRoot) ?? kind };
}

/**
 * Раннер тестов OneScript проекта и команда его запуска для строки оболочки
 *
 * @param workspaceRoot - Корень проекта, чьи настройки читаются
 */
export function resolveOneScriptRunner(workspaceRoot: string | undefined): { kind: OneScriptRunner; command: string } {
	const { kind, file } = oneScriptRunnerProgram(workspaceRoot);
	return { kind, command: file === kind ? kind : `"${file}"` };
}

/**
 * Выбирает вид раннера: явная настройка либо автоопределение
 *
 * auto → oneunit, если он стоит локально (oscript_modules/bin) ИЛИ объявлен
 * зависимостью проекта в packagedef (.ЗависитОт/.РазработкаЗависитОт("oneunit")).
 * Второй признак ловит случай, когда oneunit установлен глобально (в PATH, не в
 * проекте): без него автоопределение молча уступало бы место 1testrunner, и
 * oneunit-тесты падали бы на нём с ошибкой компиляции. Иначе — исторический
 * дефолт 1testrunner. Глобальный oneunit как команда подхватится из PATH
 * (resolveOneScriptRunner отдаёт голое имя, если локального бинарника нет).
 */
function resolveRunnerKind(setting: string, workspaceRoot: string | undefined): OneScriptRunner {
	if (setting === '1testrunner' || setting === 'oneunit') {
		return setting;
	}
	if (findLocalRunner('oneunit', workspaceRoot) || packagedefDependsOn('oneunit', workspaceRoot)) {
		return 'oneunit';
	}
	return '1testrunner';
}

/**
 * Объявляет ли packagedef проекта зависимость от пакета
 *
 * Признак «проект использует этот раннер»: например, vanessa-runner объявляет
 * .РазработкаЗависитОт("oneunit", ...). Файл packagedef небольшой, читаем
 * синхронно (как и проверку локального бинарника).
 */
function packagedefDependsOn(packageName: string, workspaceRoot: string | undefined): boolean {
	const manifest = workspaceRoot === undefined ? undefined : readPackageManifest(workspaceRoot);
	return manifest !== undefined && dependsOn(manifest, packageName);
}

/**
 * Ищет раннер в локальной установке oscript_modules/bin
 */
function findLocalRunner(kind: OneScriptRunner, workspaceRoot: string | undefined): string | undefined {
	if (!workspaceRoot) {
		return undefined;
	}
	const name = process.platform === 'win32' ? `${kind}.bat` : kind;
	const localPath = path.join(workspaceRoot, MODULES_DIRECTORY, 'bin', name);
	return fsSync.existsSync(localPath) ? localPath : undefined;
}

/**
 * Объявляет ли содержимое packagedef зависимость от пакета: `.ЗависитОт("имя", ...)`
 * или `.РазработкаЗависитОт("имя", ...)`.
 *
 * @param packagedef - Содержимое файла packagedef
 * @param packageName - Имя пакета (например, 'oneunit')
 */
export function packagedefDeclaresDependency(packagedef: string, packageName: string): boolean {
	return dependsOn(parsePackagedef(packagedef), packageName);
}
