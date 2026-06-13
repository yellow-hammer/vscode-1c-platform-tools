import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { runCancellableCommand, CancellableProcessResult } from '../../shared/cancellableProcess';
import { logger } from '../../shared/logger';
import { TestFrameworkAdapter, RunUnit, AdapterRunPlan } from './frameworkAdapter';
import { frameworkRootId, fileItemId, caseItemId } from './testItemIds';
import { directoryNodeId, directoryNodeFsPath, dedupedCaseId } from './treeLayout';
import { mapResults, KnownCase } from './testResultMapper';
import { parseJUnitXml, JUnitCase } from './parsers/junitParser';
import { parseCucumberJson } from './parsers/cucumberParser';
import { ReportTarget } from './projectTestConfig';
import { RunQueue } from './runQueue';
import { DEFAULT_TESTING } from '../../shared/pathDefaults';

const log = logger.scope('testing');

/**
 * Сегменты пути, исключаемые при поиске тестовых файлов
 *
 * Берутся из настройки testing.exclude (по аналогии с artifacts.exclude
 * и todo.exclude); .git исключается всегда.
 */
function getExcludeSegments(): string[] {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const configured = config.get<string[]>('testing.exclude');
	const segments = Array.isArray(configured)
		? configured.filter((segment): segment is string => typeof segment === 'string' && segment.length > 0)
		: ['oscript_modules', 'build'];
	return [...new Set([...segments, '.git'])];
}

/**
 * Glob-исключение для vscode.workspace.findFiles из сегментов настройки
 */
function buildExcludeGlob(segments: string[]): string {
	return `**/{${segments.join(',')}}/**`;
}

/** Максимальный размер хвоста вывода в сообщении об ошибке запуска */
const ERROR_OUTPUT_TAIL_LENGTH = 4096;

/** Задержка дебаунса пересборки дерева (мс) — схлопывает массовые файловые события */
const REBUILD_DEBOUNCE_MS = 400;

/**
 * Подсказка при падении прогона из-за отсутствующего раннера
 *
 * Типичная ситуация: зависимости проекта не установлены (пустой
 * oscript_modules/bin), раннер не найден ни локально, ни в PATH.
 */
function missingRunnerHint(result: { stdout: string; stderr: string; exitCode: number }): string {
	const output = result.stdout + result.stderr;
	const notFound =
		result.exitCode === 9009 ||
		result.exitCode === 127 ||
		/is not recognized|не является внутренней|command not found/i.test(output);
	if (!notFound) {
		return '';
	}
	return (
		'\nПохоже, раннер тестов не найден. Установите зависимости проекта ' +
		'(команда «Установить зависимости» или opm install --dev -l) ' +
		'либо укажите путь к раннеру в настройках testing.*Path.'
	);
}

/**
 * Запись о тестовом файле в дереве
 */
interface FileEntry {
	item: vscode.TestItem;
	adapter: TestFrameworkAdapter;
}

/**
 * Контроллер панели тестирования VS Code для тестов 1С
 *
 * Владеет vscode.TestController: строит дерево «фреймворк → файл → кейс»,
 * следит за файлами тестов и выполняет прогоны через адаптеры фреймворков.
 */
export class TestingController implements vscode.Disposable {
	private readonly controller: vscode.TestController;
	private readonly queue = new RunQueue();
	private readonly disposables: vscode.Disposable[] = [];
	private watchers: vscode.FileSystemWatcher[] = [];
	/** fileItemId → запись */
	private readonly files = new Map<string, FileEntry>();
	private runCounter = 0;
	/** Таймер дебаунса пересборки */
	private rebuildTimer: ReturnType<typeof setTimeout> | undefined;
	/** Цепочка пересборок: гарантирует, что rebuild не выполняется конкурентно */
	private rebuildChain: Promise<void> = Promise.resolve();
	/** Число активных прогонов: пока > 0, структура дерева заморожена */
	private activeRuns = 0;
	/** Запрошен ли пересбор во время прогона (выполнится после его завершения) */
	private rebuildPending = false;

	constructor(
		private readonly adapters: TestFrameworkAdapter[],
		private readonly vrunner: VRunnerManager,
		private readonly isProjectRef: { current: boolean }
	) {
		this.controller = vscode.tests.createTestController('1c-platform-tools-tests', '1С: Тесты');
		// Ручной Refresh выполняет пересборку и ждёт её (спиннер в панели)
		this.controller.refreshHandler = () => this.enqueueRebuild();

		this.controller.createRunProfile(
			'Запуск',
			vscode.TestRunProfileKind.Run,
			(request, token) => this.runHandler(request, token),
			true
		);

		this.disposables.push(this.controller);
	}

	/**
	 * Планирует пересборку дерева с дебаунсом
	 *
	 * Массовые файловые события (git checkout, переименование каталога)
	 * схлопываются в одну пересборку. Сами пересборки сериализованы
	 * через enqueueRebuild и никогда не выполняются конкурентно.
	 *
	 * Во время прогона дерево заморожено: пересбор откладывается до его
	 * завершения, иначе items.replace в rebuild сбрасывает дерево прямо под
	 * результатами и панель «прыгает».
	 */
	public scheduleRebuild(): void {
		if (this.activeRuns > 0) {
			this.rebuildPending = true;
			return;
		}
		if (this.rebuildTimer) {
			clearTimeout(this.rebuildTimer);
		}
		this.rebuildTimer = setTimeout(() => {
			this.rebuildTimer = undefined;
			void this.enqueueRebuild();
		}, REBUILD_DEBOUNCE_MS);
	}

	/**
	 * Ставит пересборку в очередь (сериализация против гонок конкурентного rebuild)
	 *
	 * Во время прогона пересбор откладывается (см. scheduleRebuild): защищает
	 * как от прямого вызова (ручной Refresh), так и от таймера дебаунса,
	 * сработавшего уже после старта прогона.
	 *
	 * @returns Промис завершения именно этой пересборки
	 */
	public enqueueRebuild(): Promise<void> {
		if (this.activeRuns > 0) {
			this.rebuildPending = true;
			return Promise.resolve();
		}
		const result = this.rebuildChain.then(() => this.rebuild());
		// Глушим ошибку в хвосте, чтобы цепочка продолжала жить
		this.rebuildChain = result.catch((error) => {
			log.error(`Пересборка дерева тестов не удалась: ${(error as Error).message}`);
		});
		return result;
	}

	/**
	 * Ставит мутацию дерева (upsert/remove одного файла) в общую цепочку
	 *
	 * Использует ту же цепочку, что и rebuild: события watcher и пересборка
	 * выполняются строго последовательно, без гонок на this.files/controller.
	 *
	 * Во время прогона структура дерева заморожена: мутацию не применяем,
	 * а лишь помечаем необходимость пересбора после завершения прогона.
	 */
	private enqueueMutation(mutation: () => Promise<void>): void {
		if (this.activeRuns > 0) {
			this.rebuildPending = true;
			return;
		}
		this.rebuildChain = this.rebuildChain.then(mutation).catch((error) => {
			log.warn(`Мутация дерева тестов не удалась: ${(error as Error).message}`);
		});
	}

	/**
	 * Полный пересбор дерева: повторное обнаружение файлов и пересоздание watcher'ов
	 *
	 * Не вызывать напрямую из обработчиков событий — используйте scheduleRebuild
	 * (дебаунс) или enqueueRebuild (сериализация).
	 */
	private async rebuild(): Promise<void> {
		this.disposeWatchers();
		this.files.clear();
		this.controller.items.replace([]);

		if (!this.isProjectRef.current) {
			return;
		}

		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return;
		}

		const excludeGlob = buildExcludeGlob(getExcludeSegments());

		for (const adapter of this.adapters) {
			if (!adapter.isEnabled()) {
				continue;
			}

			for (const glob of adapter.getIncludeGlobs()) {
				const uris = await vscode.workspace.findFiles(glob, excludeGlob);
				for (const uri of uris) {
					await this.upsertFile(adapter, uri);
				}

				const watcher = vscode.workspace.createFileSystemWatcher(
					new vscode.RelativePattern(workspaceRoot, glob)
				);
				// Мутации дерева сериализуем через ту же цепочку, что и rebuild,
				// чтобы события watcher и пересборка не переплетались на this.files
				watcher.onDidCreate((uri) => this.enqueueMutation(() => this.upsertFile(adapter, uri)));
				watcher.onDidChange((uri) => this.enqueueMutation(() => this.upsertFile(adapter, uri)));
				watcher.onDidDelete((uri) => this.enqueueMutation(async () => this.removeFile(adapter, uri)));
				this.watchers.push(watcher);
			}
		}

		log.debug(`Дерево тестов построено: файлов ${this.files.size}`);
	}

	/**
	 * Читает файл, разбирает его адаптером и обновляет дерево
	 *
	 * Файл, переставший быть тестовым (или с ошибкой чтения), удаляется из дерева.
	 */
	private async upsertFile(adapter: TestFrameworkAdapter, uri: vscode.Uri): Promise<void> {
		if (this.isExcluded(uri)) {
			return;
		}

		let content: string;
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			content = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
		} catch (error) {
			log.warn(`Не удалось прочитать ${uri.fsPath}: ${(error as Error).message}`);
			this.removeFile(adapter, uri);
			return;
		}

		const discovered = adapter.parseFile(content);
		if (!discovered) {
			this.removeFile(adapter, uri);
			return;
		}

		const workspaceRoot = this.vrunner.getWorkspaceRoot() ?? '';
		const location = adapter.describeFileLocation(uri, workspaceRoot);
		const parent = this.ensureDirectoryChain(adapter, uri, location.segments);
		const id = fileItemId(adapter.id, uri.toString());
		const label = discovered.label ?? location.label ?? path.basename(uri.fsPath);
		let entry = this.files.get(id);

		if (!entry) {
			const item = this.controller.createTestItem(id, label, uri);
			parent.children.add(item);
			entry = { item, adapter };
			this.files.set(id, entry);
		} else {
			entry.item.label = label;
		}
		// Файлы сортируются после каталогов (префикс «1» против «0» у каталогов)
		entry.item.sortText = `1${label}`;

		if (discovered.labelLine !== undefined) {
			entry.item.range = new vscode.Range(discovered.labelLine, 0, discovered.labelLine, 0);
		}

		const children: vscode.TestItem[] = [];
		const seenIds = new Set<string>();
		for (const testCase of discovered.cases) {
			// Дубли имён (одинаковые сценарии в одном файле) различаем по строке,
			// иначе TestItemCollection отвергнет повторный ID
			const baseId = caseItemId(adapter.id, uri.toString(), testCase.name);
			const id = dedupedCaseId(baseId, testCase.line, seenIds);
			const child = this.controller.createTestItem(id, testCase.name, uri);
			child.range = new vscode.Range(testCase.line, 0, testCase.line, 0);
			// Кейсы — в порядке следования по файлу, а не по алфавиту
			child.sortText = String(testCase.line).padStart(6, '0');
			if (testCase.tags) {
				child.tags = testCase.tags.map((tag) => new vscode.TestTag(tag));
			}
			children.push(child);
		}
		entry.item.children.replace(children);
	}

	/**
	 * Удаляет файл из дерева; опустевшие каталоги и корень фреймворка тоже удаляются
	 */
	private removeFile(adapter: TestFrameworkAdapter, uri: vscode.Uri): void {
		const id = fileItemId(adapter.id, uri.toString());
		const entry = this.files.get(id);
		if (!entry || !this.files.delete(id)) {
			return;
		}

		let current: vscode.TestItem | undefined = entry.item;
		while (current) {
			const parent: vscode.TestItem | undefined = current.parent;
			if (parent) {
				parent.children.delete(current.id);
				current = parent.children.size === 0 ? parent : undefined;
			} else {
				if (current.children.size === 0) {
					this.controller.items.delete(current.id);
				}
				current = undefined;
			}
		}
	}

	/**
	 * Возвращает (создавая при необходимости) цепочку узлов-каталогов
	 * между корнем фреймворка и файлом
	 *
	 * @param segments - Сегменты подкаталогов (например ['init'])
	 * @returns Родительский узел для файла
	 */
	private ensureDirectoryChain(
		adapter: TestFrameworkAdapter,
		fileUri: vscode.Uri,
		segments: string[]
	): vscode.TestItem {
		let parent = this.ensureRoot(adapter);
		if (segments.length === 0) {
			return parent;
		}

		// URI каталогов строим от каталога файла вверх, чтобы клик по узлу
		// открывал каталог в проводнике
		for (let i = 0; i < segments.length; i++) {
			const id = directoryNodeId(adapter.id, segments.slice(0, i + 1));
			let dirItem = parent.children.get(id);
			if (!dirItem) {
				const dirFsPath = directoryNodeFsPath(fileUri.fsPath, segments.length, i);
				dirItem = this.controller.createTestItem(id, segments[i], vscode.Uri.file(dirFsPath));
				// Каталоги сортируются перед файлами (префикс «0» против «1» у файлов)
				dirItem.sortText = `0${segments[i]}`;
				parent.children.add(dirItem);
			}
			parent = dirItem;
		}
		return parent;
	}

	/**
	 * Возвращает (создавая при необходимости) корневой узел фреймворка
	 */
	private ensureRoot(adapter: TestFrameworkAdapter): vscode.TestItem {
		const id = frameworkRootId(adapter.id);
		let root = this.controller.items.get(id);
		if (!root) {
			root = this.controller.createTestItem(id, adapter.label);
			root.tags = [new vscode.TestTag(id)];
			this.controller.items.add(root);
		}
		return root;
	}

	private isExcluded(uri: vscode.Uri): boolean {
		const excludeSegments = getExcludeSegments();
		const pathSegments = uri.fsPath.split(/[\\/]/);
		return pathSegments.some((segment) => excludeSegments.includes(segment));
	}

	/**
	 * Обработчик запуска из Test Explorer
	 *
	 * Группирует выбранные элементы по файлам и ставит прогон в очередь
	 * (прогоны последовательны — одна информационная база).
	 */
	private async runHandler(
		request: vscode.TestRunRequest,
		token: vscode.CancellationToken
	): Promise<void> {
		const units = this.collectRunUnits(request);
		if (units.length === 0) {
			return;
		}

		const run = this.controller.createTestRun(request);

		for (const unit of units) {
			for (const item of this.leafItems(unit.entry.item)) {
				run.enqueued(item);
			}
		}

		// Замораживаем структуру дерева на время прогона: файловые события от
		// самого прогона (сборка обработок, запись отчётов) не должны пересобирать
		// дерево под результатами. Накопленный пересбор выполнится после завершения.
		this.activeRuns += 1;
		try {
			await this.queue.enqueue(async () => {
				try {
					for (const unit of units) {
						if (token.isCancellationRequested) {
							break;
						}
						await this.runUnit(run, unit, token);
					}
				} finally {
					run.end();
				}
			});
		} finally {
			this.activeRuns -= 1;
			this.flushPendingRebuild();
		}
	}

	/**
	 * Выполняет отложенный во время прогона пересбор дерева
	 *
	 * Вызывается после завершения каждого прогона; реальная пересборка
	 * запускается только когда активных прогонов не осталось.
	 */
	private flushPendingRebuild(): void {
		if (this.activeRuns > 0 || !this.rebuildPending) {
			return;
		}
		this.rebuildPending = false;
		this.scheduleRebuild();
	}

	/**
	 * Собирает единицы запуска из запроса: корень/каталог → все файлы внутри,
	 * файл → файл, кейс → родительский файл с подмножеством кейсов
	 */
	private collectRunUnits(
		request: vscode.TestRunRequest
	): { entry: FileEntry; caseNames?: string[] }[] {
		const excluded = new Set(request.exclude?.map((item) => item.id) ?? []);
		const byFile = new Map<string, { entry: FileEntry; caseNames?: string[] }>();

		const addFile = (entry: FileEntry, caseNames?: string[]) => {
			if (excluded.has(entry.item.id)) {
				return;
			}
			const existing = byFile.get(entry.item.id);
			if (!existing) {
				byFile.set(entry.item.id, { entry, caseNames });
				return;
			}
			// Файл уже включён целиком — подмножество не сужает
			if (existing.caseNames && caseNames) {
				existing.caseNames = [...new Set([...existing.caseNames, ...caseNames])];
			} else {
				existing.caseNames = undefined;
			}
		};

		// Рекурсивный обход: корни фреймворков и каталоги спускаются до файлов
		const visit = (item: vscode.TestItem) => {
			if (excluded.has(item.id)) {
				return;
			}

			const fileEntry = this.files.get(item.id);
			if (fileEntry) {
				addFile(fileEntry);
				return;
			}

			// Кейс: родитель — файл
			if (item.parent) {
				const parentEntry = this.files.get(item.parent.id);
				if (parentEntry) {
					addFile(parentEntry, [item.label]);
					return;
				}
			}

			item.children.forEach((child) => visit(child));
		};

		const included = request.include ?? [...this.controller.items].map(([, item]) => item);
		for (const item of included) {
			visit(item);
		}

		return [...byFile.values()];
	}

	/**
	 * Выполняет прогон одной единицы запуска и раскладывает результаты
	 */
	private async runUnit(
		run: vscode.TestRun,
		unit: { entry: FileEntry; caseNames?: string[] },
		token: vscode.CancellationToken
	): Promise<void> {
		const { entry, caseNames } = unit;
		const adapter = entry.adapter;
		const leaves = this.leafItems(entry.item);

		for (const item of leaves) {
			run.started(item);
		}

		const fileUri = entry.item.uri;
		if (!fileUri) {
			this.markAll(run, leaves, 'errored', 'У элемента теста нет привязанного файла');
			return;
		}

		// Временный scratch-каталог нужен не всем адаптерам (OneScript/1bdd
		// пишут в свои постоянные каталоги и задают reportTarget сами)
		let reportDir = '';
		if (adapter.usesReportDir !== false) {
			const created = await this.createReportDir(adapter.id);
			if (!created) {
				this.markAll(run, leaves, 'errored', 'Не удалось создать каталог отчёта прогона');
				return;
			}
			reportDir = created;
		}

		let result: CancellableProcessResult;
		let plan: AdapterRunPlan;
		try {
			const runUnit: RunUnit = { fileUri, caseNames };
			plan = await adapter.buildRunPlan(runUnit, reportDir);

			// Чистим прошлые отчёты в настроенной цели, чтобы не прочитать устаревшие
			if (plan.reportTarget) {
				await this.clearReportTarget(plan.reportTarget);
			}

			const onOutput = (chunk: string) => run.appendOutput(chunk.replaceAll(/(?<!\r)\n/g, '\r\n'));

			run.appendOutput(`\r\n=== ${adapter.label}: ${entry.item.label} ===\r\n`);

			// Подготовительные шаги (например, сборка тестовой обработки)
			for (const step of plan.prepare ?? []) {
				if (token.isCancellationRequested) {
					await this.cleanupReportDir(reportDir);
					return;
				}
				run.appendOutput(`\r\n--- ${step.title} ---\r\n`);
				const stepResult = await this.executeStep(step.tool, step.args, plan.env, token, onOutput);
				if (stepResult.cancelled) {
					await this.cleanupReportDir(reportDir);
					return;
				}
				if (!stepResult.success) {
					const tail = (stepResult.stdout + '\n' + stepResult.stderr).slice(-ERROR_OUTPUT_TAIL_LENGTH);
					this.markAll(
						run,
						leaves,
						'errored',
						`Шаг «${step.title}» завершился с кодом ${stepResult.exitCode}.\n${tail}`
					);
					await this.cleanupReportDir(reportDir);
					return;
				}
			}

			result = await this.executeStep(plan.tool, plan.args, plan.env, token, onOutput);
		} catch (error) {
			this.markAll(run, leaves, 'errored', `Ошибка запуска: ${(error as Error).message}`);
			await this.cleanupReportDir(reportDir);
			return;
		}

		if (result.cancelled) {
			await this.cleanupReportDir(reportDir);
			return;
		}

		const target: ReportTarget = plan.reportTarget ?? { format: 'junit', path: reportDir };
		let junitCases = await this.readReports(target);
		if (junitCases && adapter.transformReportCases) {
			junitCases = adapter.transformReportCases(junitCases);
		}

		// Ненулевой код возврата при наличии отчёта — это упавшие тесты, не ошибка запуска
		if (junitCases === undefined || junitCases.length === 0) {
			const tail = (result.stdout + '\n' + result.stderr).slice(-ERROR_OUTPUT_TAIL_LENGTH);
			const planHint = plan.noReportHint ? `\n${plan.noReportHint}` : '';
			this.markAll(
				run,
				leaves,
				'errored',
				`Прогон завершился без jUnit-отчёта (код возврата ${result.exitCode}).` +
					`${planHint}${missingRunnerHint(result)}\n${tail}`
			);
			await this.cleanupReportDir(reportDir);
			return;
		}

		this.applyResults(run, entry, junitCases);
		await this.cleanupReportDir(reportDir);
	}

	/**
	 * Выполняет один шаг плана запуска (vrunner или shell-команда)
	 */
	private async executeStep(
		tool: 'vrunner' | 'shell',
		args: string[],
		env: NodeJS.ProcessEnv | undefined,
		token: vscode.CancellationToken,
		onOutput: (chunk: string) => void
	): Promise<CancellableProcessResult> {
		if (tool === 'vrunner') {
			return this.vrunner.executeVRunnerCancellable(args, { env, token, onOutput });
		}
		return runCancellableCommand(args[0], {
			cwd: this.vrunner.getWorkspaceRoot(),
			env,
			token,
			onOutput
		});
	}

	/**
	 * Применяет результаты jUnit-отчёта к элементам файла
	 */
	private applyResults(run: vscode.TestRun, entry: FileEntry, junitCases: JUnitCase[]): void {
		const leaves = this.leafItems(entry.item);
		const known: KnownCase[] = leaves.map((item) => ({ id: item.id, caseName: item.label }));
		const { results, unmatched } = mapResults(junitCases, known);

		for (const item of leaves) {
			const mapped = results.get(item.id);
			if (!mapped) {
				// Кейс не попал в отчёт (например, запускали подмножество) — пропущен
				run.skipped(item);
				continue;
			}

			switch (mapped.status) {
				case 'passed':
					run.passed(item, mapped.durationMs);
					break;
				case 'skipped':
					run.skipped(item);
					break;
				case 'failed':
				case 'error': {
					const messages = mapped.messages.map((text) => {
						const message = new vscode.TestMessage(text);
						if (item.uri && item.range) {
							message.location = new vscode.Location(item.uri, item.range.start);
						}
						return message;
					});
					if (mapped.status === 'failed') {
						run.failed(item, messages, mapped.durationMs);
					} else {
						run.errored(item, messages, mapped.durationMs);
					}
					break;
				}
			}
		}

		for (const orphan of unmatched) {
			run.appendOutput(
				`\r\n[предупреждение] testcase «${orphan.name}» (${orphan.status}) не сопоставлен с деревом тестов\r\n`
			);
		}
	}

	/**
	 * Листовые элементы файла: кейсы, а при их отсутствии — сам файл
	 */
	private leafItems(fileItem: vscode.TestItem): vscode.TestItem[] {
		const leaves: vscode.TestItem[] = [];
		fileItem.children.forEach((child) => leaves.push(child));
		return leaves.length > 0 ? leaves : [fileItem];
	}

	private markAll(
		run: vscode.TestRun,
		items: vscode.TestItem[],
		status: 'errored',
		message: string
	): void {
		log.warn(message);
		for (const item of items) {
			run.errored(item, new vscode.TestMessage(message));
		}
	}

	/**
	 * Абсолютный путь к базовому каталогу временных отчётов прогонов
	 *
	 * Единый источник пути (testing.reportsPath) для создания подкаталогов
	 * прогонов и для очистки устаревших отчётов.
	 *
	 * @returns Абсолютный путь либо undefined, если workspace не открыт
	 */
	private reportsBaseDir(): string | undefined {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return undefined;
		}
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const reportsBase = config.get<string>('testing.reportsPath', DEFAULT_TESTING.reportsPath);
		return path.join(workspaceRoot, reportsBase);
	}

	/**
	 * Удаляет базовый каталог отчётов целиком
	 *
	 * Вызывается при старте, чтобы убрать каталоги, оставшиеся от прерванных
	 * прогонов прошлых сессий.
	 */
	public async cleanupAllReports(): Promise<void> {
		const baseDir = this.reportsBaseDir();
		if (!baseDir) {
			return;
		}
		try {
			await fs.rm(baseDir, { recursive: true, force: true });
		} catch (error) {
			log.debug(`Очистка каталога отчётов ${baseDir} не удалась: ${(error as Error).message}`);
		}
	}

	/**
	 * Создаёт каталог отчёта прогона внутри workspace
	 *
	 * Каталог внутри workspace обязателен для Docker-режима: контейнер видит
	 * только смонтированную рабочую область.
	 */
	private async createReportDir(adapterId: string): Promise<string | undefined> {
		const baseDir = this.reportsBaseDir();
		if (!baseDir) {
			return undefined;
		}

		this.runCounter += 1;
		const dir = path.join(baseDir, `${adapterId}-${Date.now()}-${this.runCounter}`);

		try {
			await fs.mkdir(dir, { recursive: true });
			return dir;
		} catch (error) {
			log.error(`Не удалось создать каталог отчёта ${dir}: ${(error as Error).message}`);
			return undefined;
		}
	}

	/**
	 * Читает результаты прогона из цели отчёта (файл или каталог)
	 *
	 * Формат junit — *.xml, cucumber — *.json (Vanessa Automation).
	 *
	 * @returns Список testcase; undefined — файлов отчёта нет
	 */
	private async readReports(target: ReportTarget): Promise<JUnitCase[] | undefined> {
		const extension = target.format === 'cucumber' ? '.json' : '.xml';
		const files: string[] = [];

		try {
			const stat = await fs.stat(target.path);
			if (stat.isDirectory()) {
				const names = await fs.readdir(target.path);
				for (const name of names) {
					if (name.toLowerCase().endsWith(extension)) {
						files.push(path.join(target.path, name));
					}
				}
			} else {
				files.push(target.path);
			}
		} catch {
			return undefined;
		}

		if (files.length === 0) {
			return undefined;
		}

		const cases: JUnitCase[] = [];
		for (const file of files) {
			try {
				const content = await fs.readFile(file, 'utf8');
				cases.push(
					...(target.format === 'cucumber' ? parseCucumberJson(content) : parseJUnitXml(content))
				);
			} catch (error) {
				log.warn(`Не удалось разобрать отчёт ${file}: ${(error as Error).message}`);
			}
		}
		return cases;
	}

	/**
	 * Удаляет прошлые файлы отчётов в цели перед прогоном
	 *
	 * Цели указывают в build-каталоги проекта (env.json/VAParams), поэтому
	 * устаревший отчёт от предыдущего прогона был бы прочитан как актуальный.
	 */
	private async clearReportTarget(target: ReportTarget): Promise<void> {
		const extension = target.format === 'cucumber' ? '.json' : '.xml';
		try {
			const stat = await fs.stat(target.path);
			if (stat.isDirectory()) {
				const names = await fs.readdir(target.path);
				await Promise.all(
					names
						.filter((name) => name.toLowerCase().endsWith(extension))
						.map((name) => fs.rm(path.join(target.path, name), { force: true }))
				);
			} else {
				await fs.rm(target.path, { force: true });
			}
		} catch {
			// Цели ещё нет — нечего чистить
		}
	}

	private async cleanupReportDir(reportDir: string): Promise<void> {
		if (!reportDir) {
			return;
		}
		try {
			await fs.rm(reportDir, { recursive: true, force: true });
		} catch {
			// Не критично: каталог почистится при следующей активации
		}
	}

	private disposeWatchers(): void {
		for (const watcher of this.watchers) {
			watcher.dispose();
		}
		this.watchers = [];
	}

	public dispose(): void {
		if (this.rebuildTimer) {
			clearTimeout(this.rebuildTimer);
			this.rebuildTimer = undefined;
		}
		this.disposeWatchers();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}
}
