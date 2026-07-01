import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { runCancellableCommand, CancellableProcessResult } from '../../shared/cancellableProcess';
import { logger } from '../../shared/logger';
import { TestFrameworkAdapter, RunUnit, AdapterRunPlan, FileTreeLocation } from './frameworkAdapter';
import { DiscoveredFile } from './parsers/parserTypes';
import { frameworkRootId, fileItemId } from './testItemIds';
import {
	directoryNodeId,
	directoryNodeFsPath,
	directorySortKey,
	fileSortKey,
	caseSortKey
} from './treeLayout';
import { buildCaseDescriptors } from './caseResolver';
import { mapResults, KnownCase, MappedResult } from './testResultMapper';
import { parseJUnitXml, JUnitCase } from './parsers/junitParser';
import { parseCucumberJson } from './parsers/cucumberParser';
import { ReportTarget } from './projectTestConfig';
import { RunQueue } from './runQueue';
import { routeReportCases, RoutableFile } from './batchRouter';
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
 * Подсказка при падении прогона из-за неустановленных зависимостей проекта
 *
 * oscript-раннер не находит библиотеку, которую #Использует тест, если
 * зависимости проекта не установлены — сообщение раннера «Библиотека не найдена:
 * 'irac'». Это общая проблема прогона (затрагивает все файлы), а не конкретного теста.
 */
function missingDependencyHint(result: { stdout: string; stderr: string }): string {
	const match = /Библиотека не найдена:?\s*['"«]?([\wа-яёА-ЯЁ.\-]+)/i.exec(result.stdout + result.stderr);
	if (!match) {
		return '';
	}
	return (
		`\nНе найдена библиотека «${match[1]}», которую используют тесты — ` +
		'похоже, зависимости проекта не установлены. Выполните «Установить зависимости» ' +
		'(opm install --dev -l) и повторите прогон.'
	);
}

/**
 * Запись о тестовом файле в дереве
 */
interface FileEntry {
	item: vscode.TestItem;
	adapter: TestFrameworkAdapter;
	/**
	 * Разобрано ли содержимое файла (кейсы загружены в children)
	 *
	 * При обнаружении узел-файл создаётся пустым (resolved = false); кейсы
	 * парсятся лениво в resolveFile — при разворачивании, запуске или изменении.
	 */
	resolved: boolean;
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
	/**
	 * caseItemId → имя метода для точечного запуска (только когда отличается от label).
	 *
	 * Параметризованные кейсы («[ibcmd]») в отчёте зовутся отображаемым именем
	 * набора значений, а раннеру для `-m` нужна сама процедура. Матчинг результатов
	 * идёт по label, запуск — по этому имени.
	 */
	private readonly caseMethodNames = new Map<string, string>();
	/**
	 * caseItemId → имя группы (контейнера параметризованного теста).
	 *
	 * Различает одноимённые наборы значений разных процедур («[ibcmd]») при
	 * сопоставлении с отчётом (по вложенному testsuite) и показывается подписью в дереве.
	 */
	private readonly caseGroupNames = new Map<string, string>();
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
		// Ленивое раскрытие: при разворачивании узла-файла парсим его кейсы;
		// item === undefined — запрос корней (например, после перезагрузки окна)
		this.controller.resolveHandler = (item) => {
			if (!item) {
				return this.enqueueRebuild();
			}
			const entry = this.files.get(item.id);
			if (entry) {
				return this.resolveFile(entry);
			}
		};

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
		// Если проект больше не 1С (или workspace закрыт) — единственный случай,
		// когда дерево обнуляется. Во всех остальных случаях обновляем дифом:
		// findFiles на большой конфигурации идёт ~1.5 с, и всё это время прежнее
		// дерево остаётся видимым (раньше items.replace([]) очищал его сразу).
		if (!this.isProjectRef.current) {
			this.clearTree();
			return;
		}

		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			this.clearTree();
			return;
		}

		const excludeGlob = buildExcludeGlob(getExcludeSegments());
		const startedAt = Date.now();

		// Каждый (адаптер, glob) — независимый обход workspace. На больших
		// конфигурациях именно эти findFiles доминируют над временем сборки, поэтому
		// все обходы и классификацию запускаем параллельно — БЕЗ мутаций дерева.
		// Дерево обновляется ниже единым последовательным дифом, чтобы пользователь
		// не видел «прыгающие» узлы во время refresh.
		const jobs = this.adapters
			.filter((adapter) => adapter.isEnabled())
			.flatMap((adapter) => adapter.getIncludeGlobs().map((glob) => ({ adapter, glob })));

		const discovered = await Promise.all(
			jobs.map(async ({ adapter, glob }) => {
				const uris = await vscode.workspace.findFiles(glob, excludeGlob);
				const classified = await Promise.all(
					uris.map(async (uri) => ({ uri, location: await this.classifyTestFile(adapter, uri) }))
				);
				return { adapter, glob, classified };
			})
		);

		// Диф-апдейт: новые/изменившиеся узлы upsert'ятся, исчезнувшие удаляются.
		// addFileNode идемпотентен — для существующей записи обновит лишь label/sort,
		// но сохранит и сам узел, и уже загруженные дети (resolved=true).
		this.disposeWatchers();

		const nextFileIds = new Set<string>();
		for (const { adapter, glob, classified } of discovered) {
			for (const { uri, location } of classified) {
				if (location) {
					nextFileIds.add(fileItemId(adapter.id, uri.toString()));
					this.addFileNode(adapter, location, uri);
				}
			}

			const watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(workspaceRoot, glob)
			);
			// Мутации дерева сериализуем через ту же цепочку, что и rebuild,
			// чтобы события watcher и пересборка не переплетались на this.files
			watcher.onDidCreate((uri) => this.enqueueMutation(() => this.registerFile(adapter, uri)));
			watcher.onDidChange((uri) => this.enqueueMutation(() => this.onFileChanged(adapter, uri)));
			watcher.onDidDelete((uri) => this.enqueueMutation(async () => this.removeFile(adapter, uri)));
			this.watchers.push(watcher);
		}

		// Удаляем файлы, которых больше нет (стёрты с диска или, для широкого glob,
		// перестали быть тестовыми). Снимок this.files обязателен — removeFile мутирует
		for (const entry of [...this.files.values()]) {
			if (!nextFileIds.has(entry.item.id) && entry.item.uri) {
				this.removeFile(entry.adapter, entry.item.uri);
			}
		}

		log.debug(`Дерево тестов построено: файлов ${this.files.size} за ${Date.now() - startedAt} мс`);
	}

	/**
	 * Полностью очищает дерево (используется только при потере проекта/workspace)
	 */
	private clearTree(): void {
		this.disposeWatchers();
		this.files.clear();
		this.controller.items.replace([]);
	}

	/**
	 * Регистрирует/обновляет узел-файл в дереве (точечно, для событий watcher)
	 *
	 * Если файл не тестовый (исключён или не прошёл проверку широкого glob) —
	 * удаляет узел. Полный разбор кейсов всё равно откладывается до resolveFile.
	 */
	private async registerFile(adapter: TestFrameworkAdapter, uri: vscode.Uri): Promise<void> {
		const location = await this.classifyTestFile(adapter, uri);
		if (!location) {
			this.removeFile(adapter, uri);
			return;
		}
		this.addFileNode(adapter, location, uri);
	}

	/**
	 * Определяет, тестовый ли файл, и его положение в дереве (без мутаций дерева)
	 *
	 * Для большинства адаптеров содержимое не читается — glob сам признак теста.
	 * Адаптеры с широким glob (isTestFile, например YAxUnit) читаются здесь,
	 * чтобы отсеять нетестовые файлы (иначе дерево заполнят все общие модули);
	 * вызывается параллельно для всех файлов при пересборке.
	 *
	 * @returns Положение файла в дереве либо undefined, если файл не тестовый
	 */
	private async classifyTestFile(
		adapter: TestFrameworkAdapter,
		uri: vscode.Uri
	): Promise<FileTreeLocation | undefined> {
		if (this.isExcluded(uri)) {
			return undefined;
		}

		if (adapter.isTestFile) {
			let content: string;
			try {
				const bytes = await vscode.workspace.fs.readFile(uri);
				content = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
			} catch (error) {
				log.warn(`Не удалось прочитать ${uri.fsPath}: ${(error as Error).message}`);
				return undefined;
			}
			if (!adapter.isTestFile(content)) {
				return undefined;
			}
		}

		const workspaceRoot = this.vrunner.getWorkspaceRoot() ?? '';
		return adapter.describeFileLocation(uri, workspaceRoot);
	}

	/**
	 * Добавляет (или обновляет) пустой узел-файл в дерево — без разбора содержимого
	 *
	 * Узел получает canResolveChildren = true; кейсы парсятся лениво в resolveFile
	 * (при разворачивании/запуске/изменении). Заголовок — из раскладки адаптера
	 * или имени файла. Только синхронные мутации дерева (вызывать последовательно).
	 */
	private addFileNode(
		adapter: TestFrameworkAdapter,
		location: FileTreeLocation,
		uri: vscode.Uri
	): void {
		const parent = this.ensureDirectoryChain(adapter, uri, location.segments);
		const id = fileItemId(adapter.id, uri.toString());
		const label = location.label ?? path.basename(uri.fsPath);
		let entry = this.files.get(id);

		if (!entry) {
			const item = this.controller.createTestItem(id, label, uri);
			// Дети (кейсы) подгружаются лениво в resolveFile
			item.canResolveChildren = true;
			parent.children.add(item);
			entry = { item, adapter, resolved: false };
			this.files.set(id, entry);
		} else {
			entry.item.label = label;
		}
		// Ключ сортировки по пути: внутри каталога файлы идут после подкаталогов
		// и по имени (числовые префиксы задают порядок запуска), а плоский список
		// в Test Explorer повторяет обход дерева
		entry.item.sortText = fileSortKey(location.segments, label);
	}

	/**
	 * Разбирает файл и заполняет его кейсы (ядро ленивого резолвера)
	 *
	 * Вызывается при разворачивании узла (resolveHandler), перед запуском
	 * (resolveForRun) и при изменении содержимого (force). Идемпотентен:
	 * повторный вызов без force ничего не делает.
	 *
	 * @param entry - Запись файла в дереве
	 * @param force - Перечитать и пересобрать кейсы, даже если файл уже разобран
	 */
	private async resolveFile(entry: FileEntry, force = false): Promise<void> {
		if (entry.resolved && !force) {
			return;
		}
		const uri = entry.item.uri;
		if (!uri) {
			return;
		}

		entry.item.busy = true;
		try {
			let discovered: DiscoveredFile | undefined;
			try {
				const bytes = await vscode.workspace.fs.readFile(uri);
				const content = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
				discovered = entry.adapter.parseFile(content);
			} catch (error) {
				log.warn(`Не удалось прочитать ${uri.fsPath}: ${(error as Error).message}`);
				discovered = undefined;
			}

			// Дерево могло быть пересобрано за время чтения — запись устарела,
			// её узел уже отсоединён; новый узел резолвится по запросу заново
			if (this.files.get(entry.item.id) !== entry) {
				return;
			}

			// Заголовок узла-файла остаётся именем файла — так в дереве сохраняется
			// порядок запуска по числовым префиксам, а имя не «прыгает» при
			// разворачивании. Строку объявления (например, «Функционал:» для
			// .feature) используем лишь для позиции гуттер-кнопки запуска.
			if (discovered?.labelLine !== undefined) {
				entry.item.range = new vscode.Range(discovered.labelLine, 0, discovered.labelLine, 0);
			}

			const fileKey = entry.item.sortText ?? '';
			const descriptors = buildCaseDescriptors(entry.adapter.id, uri.toString(), discovered?.cases ?? []);
			const children = descriptors.map((descriptor) => {
				const child = this.controller.createTestItem(descriptor.id, descriptor.name, uri);
				child.range = new vscode.Range(descriptor.line, 0, descriptor.line, 0);
				// Префикс ключом файла: кейсы держатся под своим файлом и в плоском списке
				child.sortText = caseSortKey(fileKey, descriptor.sortText);
				if (descriptor.tags) {
					child.tags = descriptor.tags.map((tag) => new vscode.TestTag(tag));
				}
				// Параметризованный кейс: запоминаем имя процедуры для точечного запуска
				if (descriptor.methodName && descriptor.methodName !== descriptor.name) {
					this.caseMethodNames.set(descriptor.id, descriptor.methodName);
				} else {
					this.caseMethodNames.delete(descriptor.id);
				}
				// Имя контейнера — подписью в дереве (различает одноимённые «[ibcmd]»)
				// и для сопоставления одноимённых кейсов по группе
				if (descriptor.groupName) {
					child.description = descriptor.groupName;
					this.caseGroupNames.set(descriptor.id, descriptor.groupName);
				} else {
					this.caseGroupNames.delete(descriptor.id);
				}
				return child;
			});
			entry.item.children.replace(children);
			entry.resolved = true;
			// Кейсы загружены — повторно резолвить не нужно (изменения ловит watcher)
			entry.item.canResolveChildren = false;
		} finally {
			entry.item.busy = false;
		}
	}

	/**
	 * Реакция на изменение содержимого файла
	 *
	 * Прошлые результаты затронутого файла помечаются устаревшими
	 * (invalidateTestResults): VS Code приглушает их сразу, не дожидаясь нового
	 * прогона. Затем гарантируется регистрация узла (для широкого glob — заодно
	 * отсев, если файл перестал быть тестовым) и перечитываются кейсы, если файл
	 * уже был разобран. Неразобранные узлы остаются ленивыми — перечитаются при
	 * разворачивании.
	 */
	private async onFileChanged(adapter: TestFrameworkAdapter, uri: vscode.Uri): Promise<void> {
		const id = fileItemId(adapter.id, uri.toString());
		const existing = this.files.get(id);
		if (existing) {
			this.controller.invalidateTestResults(existing.item);
		}
		await this.registerFile(adapter, uri);
		const entry = this.files.get(id);
		if (entry?.resolved) {
			await this.resolveFile(entry, true);
		}
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
				// Ключ сортировки по пути: каталог идёт перед файлами того же
				// родителя, а его поддерево — единым блоком в плоском списке
				dirItem.sortText = directorySortKey(segments.slice(0, i + 1));
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
		// Замораживаем структуру дерева на всё время обработки запроса, включая
		// ленивый резолв запрошенных файлов: файловые события (как от самого
		// прогона — сборка обработок, запись отчётов, — так и сторонние) не
		// должны пересобирать дерево под результатами. Накопленный пересбор
		// выполнится после завершения (flushPendingRebuild).
		this.activeRuns += 1;
		try {
			// Лениво обнаруженные узлы-файлы могут быть ещё не разобраны: резолвим
			// детей для всех запрошенных файлов, чтобы прогон видел кейсы
			await this.resolveForRun(request);

			const units = this.collectRunUnits(request);
			if (units.length === 0) {
				return;
			}

			const run = this.controller.createTestRun(request);

			for (const unit of units) {
				for (const item of this.leafItems(unit.entry.item)) {
					run.enqueued(item);
				}
				const suite = this.suiteNode(unit.entry.item);
				if (suite) {
					run.enqueued(suite);
				}
			}

			await this.queue.enqueue(async () => {
				try {
					await this.runUnits(run, units, token);
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
	 * Выполняет единицы запроса: батчит полнофайловые прогоны адаптеров,
	 * умеющих прогнать несколько файлов одним процессом, остальное — поштучно
	 *
	 * Батч (один холодный старт раннера вместо N) применяется к ≥2 полнофайловым
	 * единицам одного адаптера без подмножества кейсов. Группируем по каталогу:
	 * файлы одной папки совместимы в одном процессе, а разнородные категории
	 * (например, unit и e2e) не валят друг друга конфликтом регистрации наборов.
	 * Прогон подмножества кейсов и адаптеры без батча идут прежним поштучным путём.
	 * Если адаптер вернул undefined-план (батч недоступен) или батч не дал отчёта,
	 * файлы группы прогоняются поштучно.
	 */
	private async runUnits(
		run: vscode.TestRun,
		units: { entry: FileEntry; caseNames?: string[] }[],
		token: vscode.CancellationToken
	): Promise<void> {
		const batches = new Map<string, { entry: FileEntry; caseNames?: string[] }[]>();
		const individual: { entry: FileEntry; caseNames?: string[] }[] = [];

		for (const unit of units) {
			const uri = unit.entry.item.uri;
			if (!unit.caseNames && unit.entry.adapter.buildBatchRunPlan && uri) {
				const key = `${unit.entry.adapter.id} ${path.dirname(uri.fsPath)}`;
				const group = batches.get(key);
				if (group) {
					group.push(unit);
				} else {
					batches.set(key, [unit]);
				}
			} else {
				individual.push(unit);
			}
		}

		for (const group of batches.values()) {
			if (token.isCancellationRequested) {
				return;
			}
			// Один файл проще и не дешевле прогнать обычным путём (без раскладки общего отчёта)
			if (group.length < 2 || !(await this.runBatch(run, group, token))) {
				individual.push(...group);
			}
		}

		for (const unit of individual) {
			if (token.isCancellationRequested) {
				break;
			}
			await this.runUnit(run, unit, token);
		}
	}

	/**
	 * Прогоняет несколько файлов одним процессом и раскладывает общий отчёт по файлам
	 *
	 * @returns true — батч обработан (исполнен или размечен ошибкой); false — батч
	 *          в текущей конфигурации недоступен, файлы нужно прогнать поштучно
	 */
	private async runBatch(
		run: vscode.TestRun,
		units: { entry: FileEntry; caseNames?: string[] }[],
		token: vscode.CancellationToken
	): Promise<boolean> {
		const adapter = units[0].entry.adapter;
		const entries = units.map((unit) => unit.entry);
		const allLeaves = entries.flatMap((entry) => this.leafItems(entry.item));
		const allSuites = entries
			.map((entry) => this.suiteNode(entry.item))
			.filter((suite): suite is vscode.TestItem => suite !== undefined);

		const runUnits: RunUnit[] = [];
		for (const entry of entries) {
			if (!entry.item.uri) {
				this.markAll(run, allLeaves, 'errored', 'У элемента теста нет привязанного файла', allSuites);
				return true;
			}
			runUnits.push({ fileUri: entry.item.uri });
		}

		let reportDir = '';
		if (adapter.usesReportDir !== false) {
			const created = await this.createReportDir(adapter.id);
			if (!created) {
				this.markAll(run, allLeaves, 'errored', 'Не удалось создать каталог отчёта прогона', allSuites);
				return true;
			}
			reportDir = created;
		}

		let plan: AdapterRunPlan | undefined;
		let result: CancellableProcessResult;
		try {
			plan = await adapter.buildBatchRunPlan!(runUnits, reportDir);
			if (!plan) {
				await this.cleanupReportDir(reportDir);
				return false;
			}

			if (plan.reportTarget) {
				await this.clearReportTarget(plan.reportTarget);
			}

			// Вывод общий (один процесс на все файлы) — привязываем к прогону, не к узлу
			const onOutput = (chunk: string) => run.appendOutput(chunk.replaceAll(/(?<!\r)\n/g, '\r\n'));
			run.appendOutput(`\r\n=== ${adapter.label}: батч-прогон (${entries.length} файлов) ===\r\n`);

			for (const item of allLeaves) {
				run.started(item);
			}
			for (const suite of allSuites) {
				run.started(suite);
			}

			for (const step of plan.prepare ?? []) {
				if (token.isCancellationRequested) {
					await this.cleanupReportDir(reportDir);
					return true;
				}
				run.appendOutput(`\r\n--- ${step.title} ---\r\n`);
				const stepResult = await this.executeStep(step.tool, step.args, plan.env, token, onOutput);
				if (stepResult.cancelled) {
					await this.cleanupReportDir(reportDir);
					return true;
				}
				if (!stepResult.success) {
					const tail = (stepResult.stdout + '\n' + stepResult.stderr).slice(-ERROR_OUTPUT_TAIL_LENGTH);
					this.markAll(
						run,
						allLeaves,
						'errored',
						`Шаг «${step.title}» завершился с кодом ${stepResult.exitCode}.\n${tail}`,
						allSuites
					);
					await this.cleanupReportDir(reportDir);
					return true;
				}
			}

			result = await this.executeStep(plan.tool, plan.args, plan.env, token, onOutput);
		} catch (error) {
			this.markAll(run, allLeaves, 'errored', `Ошибка запуска: ${(error as Error).message}`, allSuites);
			await this.cleanupReportDir(reportDir);
			return true;
		}

		if (result.cancelled) {
			await this.cleanupReportDir(reportDir);
			return true;
		}

		const target: ReportTarget = plan.reportTarget ?? { format: 'junit', path: reportDir };
		let junitCases = await this.readReports(target);
		if (junitCases && adapter.transformReportCases) {
			junitCases = adapter.transformReportCases(junitCases);
		}

		if (junitCases === undefined || junitCases.length === 0) {
			const tail = (result.stdout + '\n' + result.stderr).slice(-ERROR_OUTPUT_TAIL_LENGTH);
			const runnerHint = missingRunnerHint(result);
			const depHint = missingDependencyHint(result);

			// Раннер не найден или не установлены зависимости — это общая проблема всех
			// файлов, поштучный прогон её не вылечит. Помечаем ошибкой с подсказкой,
			// не плодя бесполезные повторные запуски.
			if (runnerHint || depHint) {
				const planHint = plan.noReportHint ? `\n${plan.noReportHint}` : '';
				this.markAll(
					run,
					allLeaves,
					'errored',
					`Батч-прогон завершился без jUnit-отчёта (код возврата ${result.exitCode}).` +
						`${planHint}${runnerHint}${depHint}\n${tail}`,
					allSuites
				);
				await this.cleanupReportDir(reportDir);
				return true;
			}

			// Иначе вероятен сбой одного файла или конфликт (двойная регистрация набора):
			// откатываемся на поштучный прогон — он изолирует сбойный файл, остальные
			// дадут результат (поведение прежней версии). Узлы остаются enqueued/started —
			// runUnit проставит им финальный статус.
			log.warn(
				`Батч-прогон ${adapter.label} без jUnit-отчёта (код ${result.exitCode}) — откат на поштучный прогон`
			);
			run.appendOutput(
				`\r\n[батч] прогон одним процессом не дал отчёта (код ${result.exitCode}) — повторяю по файлам\r\n` +
					`${tail.replaceAll(/(?<!\r)\n/g, '\r\n')}\r\n`
			);
			await this.cleanupReportDir(reportDir);
			return false;
		}

		// Раскладываем общий отчёт по файлам (по атрибуту file/classname кейса)
		const routable: RoutableFile[] = entries.map((entry) => ({
			id: entry.item.id,
			fsPath: entry.item.uri!.fsPath
		}));
		const { byFile, unrouted } = routeReportCases(junitCases, routable);

		for (const entry of entries) {
			const cases = byFile.get(entry.item.id);
			// Раскладка не дала кейсов файлу (нестандартный формат отчёта) — запасной путь:
			// применяем весь отчёт по совпадению имён, чтобы не пометить пройденный файл
			// ошибкой; в обычном случае сюда приходят только свои кейсы файла
			this.applyResults(run, entry, cases && cases.length > 0 ? cases : junitCases);
		}

		// unrouted логируем только если он не «съест» весь отчёт запасным путём выше
		if (byFile.size > 0) {
			for (const orphan of unrouted) {
				run.appendOutput(
					`\r\n[предупреждение] testcase «${orphan.name}» (${orphan.status}) не сопоставлен ни с одним файлом\r\n`
				);
			}
		}

		await this.cleanupReportDir(reportDir);
		return true;
	}

	/**
	 * Резолвит детей всех файлов, затронутых запросом запуска
	 *
	 * Корень/каталог раскрываются до файлов; кейс пропускается (его файл уже
	 * разобран, раз кейс существует). Без этого запуск нераскрытого файла видел
	 * бы пустой список кейсов.
	 */
	private async resolveForRun(request: vscode.TestRunRequest): Promise<void> {
		const seen = new Set<string>();
		const targets: FileEntry[] = [];

		const visit = (item: vscode.TestItem) => {
			const entry = this.files.get(item.id);
			if (entry) {
				if (!seen.has(entry.item.id)) {
					seen.add(entry.item.id);
					targets.push(entry);
				}
				return;
			}
			// Кейс: его родитель-файл уже разобран (иначе кейса бы не было)
			if (item.parent && this.files.has(item.parent.id)) {
				return;
			}
			item.children.forEach((child) => visit(child));
		};

		const included = request.include ?? [...this.controller.items].map(([, item]) => item);
		for (const item of included) {
			visit(item);
		}

		await Promise.all(targets.map((entry) => this.resolveFile(entry)));
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

			// Кейс: родитель — файл. Для параметризованных кейсов раннеру передаём
			// имя процедуры (label — это отображаемое имя набора значений, напр. «[ibcmd]»)
			if (item.parent) {
				const parentEntry = this.files.get(item.parent.id);
				if (parentEntry) {
					addFile(parentEntry, [this.caseMethodNames.get(item.id) ?? item.label]);
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
		const suite = this.suiteNode(entry.item);

		for (const item of leaves) {
			run.started(item);
		}
		if (suite) {
			run.started(suite);
		}

		const fileUri = entry.item.uri;
		if (!fileUri) {
			this.markAll(run, leaves, 'errored', 'У элемента теста нет привязанного файла', suite ? [suite] : undefined);
			return;
		}

		// Временный scratch-каталог нужен не всем адаптерам (OneScript/1bdd
		// пишут в свои постоянные каталоги и задают reportTarget сами)
		let reportDir = '';
		if (adapter.usesReportDir !== false) {
			const created = await this.createReportDir(adapter.id);
			if (!created) {
				this.markAll(run, leaves, 'errored', 'Не удалось создать каталог отчёта прогона', suite ? [suite] : undefined);
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

			// Привязываем вывод к узлу файла: в Test Explorer работает «Перейти к выводу теста»
			const onOutput = (chunk: string) =>
				run.appendOutput(chunk.replaceAll(/(?<!\r)\n/g, '\r\n'), undefined, entry.item);

			run.appendOutput(`\r\n=== ${adapter.label}: ${entry.item.label} ===\r\n`, undefined, entry.item);

			// Подготовительные шаги (например, сборка тестовой обработки)
			for (const step of plan.prepare ?? []) {
				if (token.isCancellationRequested) {
					await this.cleanupReportDir(reportDir);
					return;
				}
				run.appendOutput(`\r\n--- ${step.title} ---\r\n`, undefined, entry.item);
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
						`Шаг «${step.title}» завершился с кодом ${stepResult.exitCode}.\n${tail}`,
						suite ? [suite] : undefined
					);
					await this.cleanupReportDir(reportDir);
					return;
				}
			}

			result = await this.executeStep(plan.tool, plan.args, plan.env, token, onOutput);
		} catch (error) {
			this.markAll(run, leaves, 'errored', `Ошибка запуска: ${(error as Error).message}`, suite ? [suite] : undefined);
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
					`${planHint}${missingRunnerHint(result)}${missingDependencyHint(result)}\n${tail}`,
				suite ? [suite] : undefined
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
		const known: KnownCase[] = leaves.map((item) => ({
			id: item.id,
			caseName: item.label,
			suiteName: this.caseGroupNames.get(item.id)
		}));
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
					const messages = mapped.messages.map((failure) => {
						// При наличии пары ожидаемое/фактическое показываем нативный
						// diff, иначе откатываемся на обычное текстовое сообщение
						const message =
							failure.expected !== undefined && failure.actual !== undefined
								? vscode.TestMessage.diff(failure.text, failure.expected, failure.actual)
								: new vscode.TestMessage(failure.text);
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

		this.markSuiteAggregate(run, entry.item, results);

		for (const orphan of unmatched) {
			run.appendOutput(
				`\r\n[предупреждение] testcase «${orphan.name}» (${orphan.status}) не сопоставлен с деревом тестов\r\n`,
				undefined,
				entry.item
			);
		}
	}

	/**
	 * Проставляет узлу-файлу (сьюту) агрегированный статус прогона
	 *
	 * В TEST RESULTS сьют показывается отдельной строкой; без явного статуса он
	 * висит «Ожидали…» вровень с тестом. Итог сворачиваем из результатов кейсов:
	 * error > failed > passed, и skipped, если ни один кейс не отработал.
	 * Длительность — сумма длительностей кейсов. Узлы без детей пропускаем: там
	 * файл сам лист и статус ему уже проставлен как кейсу.
	 */
	private markSuiteAggregate(
		run: vscode.TestRun,
		fileItem: vscode.TestItem,
		results: Map<string, MappedResult>
	): void {
		const suite = this.suiteNode(fileItem);
		if (!suite) {
			return;
		}

		let anyError = false;
		let anyFailed = false;
		let anyPassed = false;
		let duration: number | undefined;
		for (const mapped of results.values()) {
			if (mapped.status === 'error') {
				anyError = true;
			} else if (mapped.status === 'failed') {
				anyFailed = true;
			} else if (mapped.status === 'passed') {
				anyPassed = true;
			}
			if (mapped.durationMs !== undefined) {
				duration = (duration ?? 0) + mapped.durationMs;
			}
		}

		if (anyError) {
			run.errored(suite, [], duration);
		} else if (anyFailed) {
			run.failed(suite, [], duration);
		} else if (anyPassed) {
			run.passed(suite, duration);
		} else {
			run.skipped(suite);
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
		message: string,
		suites?: vscode.TestItem[]
	): void {
		log.warn(message);
		for (const item of items) {
			run.errored(item, new vscode.TestMessage(message));
		}
		// Сьюты помечаем тем же статусом, чтобы в TEST RESULTS у узла-файла тоже
		// стоял индекс, а не «Ожидали…» (иначе он висит нераскрытым)
		for (const suite of suites ?? []) {
			run.errored(suite, new vscode.TestMessage(message));
		}
	}

	/**
	 * Узел-сьют файла для разметки в панели результатов
	 *
	 * Возвращает сам узел-файл, только если у него есть дочерние кейсы: тогда в
	 * TEST RESULTS сьют показывается отдельной строкой с индексом выполнения. Если
	 * кейсов нет, файл сам выступает листом (его размечает leafItems) — отдельная
	 * разметка сьюта не нужна, иначе один и тот же узел размечался бы дважды.
	 */
	private suiteNode(fileItem: vscode.TestItem): vscode.TestItem | undefined {
		return fileItem.children.size > 0 ? fileItem : undefined;
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
