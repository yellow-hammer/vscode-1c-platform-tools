import * as vscode from 'vscode';
import { ensureOvm } from '../shared/ovmComponent';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { spawnSync } from 'node:child_process';
import { BaseCommand } from './baseCommand';
import {
	getInstallDependenciesCommandName,
	getInstallOneScriptCommandName,
	getSelectOneScriptCommandName,
	getUpdateOpmCommandName
} from '../features/tools/commandNames';
import { logger } from '../shared/logger';
import {
	ONESCRIPT_PROJECT_FILE_TEMPLATE,
	PROJECT_FILE_TEMPLATE,
	ProjectFileExistsError,
	writeProjectFile,
} from '../shared/workspaceProjects';
import { initializeProjectCommand } from '../features/projects/workspaceProjectCommands';
import { workspaceProjectsSource } from '../features/projects/workspaceProjectsSource';
import type { StructuredCommandResult } from '../shared/commandExecutionTypes';
import { ONESCRIPT_PROJECT_DIRECTORIES, ONESCRIPT_PROJECT_FILES, PROJECT_STRUCTURE } from '../shared/projectStructure';
import { getEngineBinaryCandidates, getOvmBaseDir, getOvmRootDir } from '../shared/ovmPaths';
import { listOvmInstallations, parseEngineVersion, engineVersionSupported, type EngineVersion } from '../shared/oneScriptEngine';
import { MODULES_DIRECTORY, readPackageManifest } from '../shared/oneScriptLayout';
import { notifyBusy, notifyQuiet, notifyQuietFailure } from '../shared/notify';
import { buildProcessCommand, joinCommands, PROCESS_HOST_SHELL } from '../utils/commandUtils';
import { createVRunnerTask } from '../features/tasks/vrunnerTask';
import { showComponentError } from '../shared/githubToken';
import { ensureWorkspaceTrusted } from '../shared/workspaceTrust';

const log = logger.scope('commands');

/** Интервал опроса появления OVM после установки (мс) */
const OVM_POLL_INTERVAL_MS = 3000;
/** Максимальное время ожидания завершения установки (мс) */
const OVM_POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** Теги OVM для выбора версии OneScript */
const OVM_TAGS = ['lts', 'stable', 'dev', 'preview'] as const;

type OvmVersionItem = vscode.QuickPickItem & { version?: string };

/**
 * QuickPick версии OneScript: версия из packagedef (если есть), теги. Можно ввести версию (2.0.0) в поле.
 */
async function pickOvmVersion(packagedefVersion: OscriptVersionFromPackagedef): Promise<string | undefined> {
	const items: OvmVersionItem[] = [
		...(packagedefVersion.fromPackagedef
			? [
					{ label: 'из packagedef', kind: vscode.QuickPickItemKind.Separator, version: undefined },
					{ label: packagedefVersion.version, version: packagedefVersion.version } as OvmVersionItem
				]
			: []),
		{ label: 'теги', kind: vscode.QuickPickItemKind.Separator, version: undefined },
		...OVM_TAGS.map((tag) => ({ label: tag, version: tag }))
	];

	const defaultVersion = packagedefVersion.fromPackagedef ? packagedefVersion.version : 'stable';
	const stableItem = items.find((i) => i.version === 'stable');

	let resolved = false;
	const chosen = await new Promise<OvmVersionItem | { typedVersion: string } | undefined>((resolve) => {
		const doResolve = (value: OvmVersionItem | { typedVersion: string } | undefined) => {
			if (!resolved) {
				resolved = true;
				resolve(value);
			}
		};
		const picker = vscode.window.createQuickPick<OvmVersionItem>();
		picker.title = 'Версия OneScript';
		picker.placeholder = 'Версия или тег (2.0.0, stable…)';
		picker.items = items;
		picker.activeItems = stableItem ? [stableItem] : [];
		picker.ignoreFocusOut = true;

		picker.onDidAccept(() => {
			const selected = picker.selectedItems[0];
			const typed = picker.value?.trim();
			if (typed && (!selected || selected.kind === vscode.QuickPickItemKind.Separator || selected.version !== typed)) {
				picker.hide();
				doResolve({ typedVersion: typed });
			} else if (selected && selected.kind !== vscode.QuickPickItemKind.Separator) {
				picker.hide();
				doResolve(selected);
			}
		});
		picker.onDidHide(() => {
			doResolve(undefined);
			picker.dispose();
		});
		picker.show();
	});

	if (!chosen) {
		return undefined;
	}
	if ('typedVersion' in chosen) {
		return chosen.typedVersion;
	}
	return chosen.version ?? defaultVersion;
}

/** Результат чтения версии OneScript из packagedef */
interface OscriptVersionFromPackagedef {
	/** Версия для ovm install (например '2.0.0' или 'stable') */
	version: string;
	/** true, если версия прочитана из файла packagedef */
	fromPackagedef: boolean;
}

/**
 * Версия OneScript из packagedef (ВерсияСреды); без неё stable.
 *
 * @param workspaceRoot - Корень проекта
 * @returns Версия и признак «из packagedef»
 */
function getOscriptVersionFromPackagedef(workspaceRoot: string): OscriptVersionFromPackagedef {
	const version = readPackageManifest(workspaceRoot)?.engineVersion;
	return version ? { version, fromPackagedef: true } : { version: 'stable', fromPackagedef: false };
}

/**
 * Исполняемый файл движка, который поставит `ovm install`, и его время изменения (0, если файла нет).
 *
 * @param version - Версия или метка, с которой ставится OneScript
 */
function installedEngineMtime(version: string): { path: string; mtimeMs: number } {
	const oscriptPath = getEngineBinaryCandidates(path.join(getOvmBaseDir(), version))[0];
	let mtimeMs = 0;
	try {
		const stat = fsSync.statSync(oscriptPath);
		if (stat.isFile()) {
			mtimeMs = stat.mtimeMs;
		}
	} catch {
		// файла нет
	}
	return { path: oscriptPath, mtimeMs };
}

/**
 * Ожидает завершения установки OVM: файл oscript появился или обновился (mtime вырос).
 * Перед первым опросом ждёт OVM_POLL_INTERVAL_MS, чтобы не сработать на старый файл.
 *
 * @param version - Версия или метка, с которой ставится OneScript
 * @param initialMtimeMs - Время модификации oscript до запуска установки (0, если файла не было)
 * @returns true, если установка зафиксирована (файл создан/обновлён); false при таймауте
 */
async function waitForOvmInstallComplete(version: string, initialMtimeMs: number): Promise<boolean> {
	const { path: oscriptPath } = installedEngineMtime(version);
	await new Promise((r) => setTimeout(r, OVM_POLL_INTERVAL_MS));

	const deadline = Date.now() + OVM_POLL_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const stat = fsSync.statSync(oscriptPath);
			if (stat.isFile() && stat.mtimeMs > initialMtimeMs) {
				return true;
			}
		} catch {
			// файла ещё нет — продолжаем ждать
		}
		await new Promise((r) => setTimeout(r, OVM_POLL_INTERVAL_MS));
	}
	return false;
}

/** Команды, требующие прав администратора: core.longpaths для системы, LC_ALL для всех пользователей */
const GIT_ADMIN_COMMANDS = ['git config --system core.longpaths true', 'setx LC_ALL C.UTF-8 /M'];

/**
 * Показывает системные команды (core.longpaths true, LC_ALL C.UTF-8) и предлагает
 * скопировать их для ручного запуска в терминале, открытом от имени администратора.
 *
 * Расширение намеренно не повышает права само: запись временного скрипта и его запуск
 * через Start-Process -Verb RunAs антивирусы распознают как эвристику trojan-downloader.
 */
async function showGitAdminCommands(): Promise<void> {
	const commandsText = GIT_ADMIN_COMMANDS.join('\r\n');
	const action = await vscode.window.showInformationMessage(
		'Эти настройки требуют прав администратора. Откройте терминал от имени администратора и выполните команды. Скопировать их в буфер обмена?',
		'Скопировать команды',
		'Отмена'
	);
	if (action !== 'Скопировать команды') {
		return;
	}

	try {
		await vscode.env.clipboard.writeText(commandsText);
		notifyQuiet('Команды скопированы в буфер обмена');
	} catch (error) {
		const errMsg = (error as Error).message;
		log.error(`Не удалось скопировать команды в буфер обмена: ${errMsg}`);
		vscode.window.showWarningMessage(
			`Не удалось скопировать команды. Выполните вручную от имени администратора: ${GIT_ADMIN_COMMANDS.join(' и ')}`
		);
	}
}

/**
 * Команды для управления зависимостями проекта
 */
/**
 * Аргументы вызова `git config`.
 *
 * Флаг области идёт после подкоманды: перед ней git считает его своей опцией и падает с
 * «unknown option».
 *
 * @param scopeArgs Флаги области: `--global` либо пусто для настроек текущего репозитория.
 */
export function gitConfigArgs(scopeArgs: readonly string[], key: string, value: string): string[] {
	return ['config', ...scopeArgs, key, value];
}

export class DependenciesCommands extends BaseCommand {
	/** Контекст нужен для кэша компонентов: OVM берём оттуда. */
	constructor(private readonly context: vscode.ExtensionContext) {
		super();
	}

	/**
	 * Устанавливает зависимости проекта
	 *
	 * Выполняет команду opm install --dev -l в терминале для установки всех
	 * зависимостей из packagedef. Флаг --dev добавляет зависимости разработки
	 * (РазработкаЗависитОт): без него не ставятся раннеры/хелперы тестов
	 * (oneunit, asserts), и панель тестирования не находит раннер.
	 *
	 * @returns Промис, который разрешается после запуска команды
	 */
	async installDependencies(): Promise<void> {
		if (!ensureWorkspaceTrusted('установка зависимостей')) {
			return;
		}
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureLocalOscriptAvailable())) {
			return;
		}

		const commandName = getInstallDependenciesCommandName();
		this.vrunner.executeOpmInTerminal(['install', '--dev', '-l'], {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Удаляет зависимости проекта
	 * 
	 * Удаляет каталог oscript_modules из workspace, что приводит к удалению
	 * всех установленных зависимостей проекта.
	 * 
	 * @returns Промис, который разрешается после удаления каталога
	 */
	async removeDependencies(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const oscriptModulesPath = path.join(workspaceRoot, MODULES_DIRECTORY);
		
		try {
			const stats = await fs.stat(oscriptModulesPath);
			if (stats.isDirectory()) {
				await fs.rm(oscriptModulesPath, { recursive: true, force: true });
				log.info(`Каталог oscript_modules успешно удалён: ${oscriptModulesPath}`);
				notifyQuiet('Каталог oscript_modules удалён');
			} else {
				log.warn(`oscript_modules не является каталогом: ${oscriptModulesPath}`);
				vscode.window.showWarningMessage('oscript_modules не является каталогом');
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				log.info('Каталог oscript_modules не найден');
				vscode.window.showInformationMessage('Каталог oscript_modules не найден');
			} else {
				const errMsg = (error as Error).message;
				log.error(`Не удалось удалить каталог oscript_modules: ${errMsg}. Путь: ${oscriptModulesPath}`);
				vscode.window.showErrorMessage(`Не удалось удалить каталог oscript_modules: ${errMsg}`);
			}
		}
	}

	/**
	 * Настраивает Git: user.name, user.email, алиасы и общие параметры.
	 * Запросы (имя, email, проект/глобально) показываются в верхней части окна VS Code.
	 * В Windows предлагает команды для настроек с правами администратора (core.longpaths true, LC_ALL C.UTF-8).
	 *
	 * @returns Промис, который разрешается по завершении
	 */
	async setupGit(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const userName = await vscode.window.showInputBox({
			title: 'Настройка Git',
			prompt: 'Введите имя пользователя для Git',
			placeHolder: 'Иван Иванов',
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim() ? undefined : 'Введите имя пользователя')
		});
		if (userName === undefined) {
			return;
		}

		const userEmail = await vscode.window.showInputBox({
			title: 'Настройка Git',
			prompt: 'Введите email для Git',
			placeHolder: 'user@example.com',
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim() ? undefined : 'Введите email')
		});
		if (userEmail === undefined) {
			return;
		}

		const scopeChoice = await vscode.window.showQuickPick(
			[
				{
					label: 'Текущий проект',
					detail: 'VS Code как merge/diff tool всё равно настраивается глобально',
					value: 'project' as const
				},
				{ label: 'Глобально', value: 'global' as const }
			],
			{
				title: 'Настройка Git',
				placeHolder: 'Установить настройки для текущего проекта или глобально?',
				ignoreFocusOut: true
			}
		);
		if (!scopeChoice) {
			return;
		}

		const isGlobal = scopeChoice.value === 'global';
		const scopeArgs = isGlobal ? ['--global'] : [];
		const cwd = isGlobal ? undefined : workspaceRoot;

		const runGitConfig = (args: string[]): { ok: boolean; stderr: string } => {
			const result = spawnSync('git', args, {
				cwd: cwd ?? undefined,
				encoding: 'utf8',
				shell: false
			});
			return {
				ok: result.status === 0,
				stderr: (result.stderr ?? result.error?.message ?? '').trim()
			};
		};

		/**
		 * Применяет список настроек git config с заданными флагами области видимости.
		 * При ошибке показывает сообщение и возвращает false.
		 */
		const applyGitConfigs = (configs: [string, string][], args: string[]): boolean => {
			for (const [key, value] of configs) {
				const { ok, stderr } = runGitConfig(gitConfigArgs(args, key, value));
				if (!ok) {
					log.error(`Git config ${args.join(' ') || '(local)'} ${key}=${value}: ${stderr}`);
					vscode.window.showErrorMessage(`Ошибка настройки Git (${key}): ${stderr || 'неизвестная ошибка'}`);
					return false;
				}
			}
			return true;
		};

		// Настройки пользователя и репозитория — в область видимости, выбранную пользователем (проект или глобально)
		const scopedConfigs: [string, string][] = [
			['user.name', userName.trim()],
			['user.email', userEmail.trim()],
			['core.quotePath', 'false'],
			['alias.co', 'checkout'],
			['alias.br', 'branch'],
			['alias.ci', 'commit'],
			['alias.st', 'status'],
			['alias.unstage', 'reset HEAD --'],
			['alias.last', 'log -1 HEAD'],
			['core.autocrlf', 'true'],
			['core.safecrlf', 'false'],
			['http.postBuffer', '1048576000']
		];
		if (!applyGitConfigs(scopedConfigs, scopeArgs)) {
			return;
		}

		// VS Code как merge/diff tool — настройка окружения разработчика (какой редактор запускать),
		// а не свойство репозитория, поэтому пишется всегда глобально независимо от выбора области видимости выше
		const vscodeToolConfigs: [string, string][] = [
			['merge.tool', 'vscode'],
			['mergetool.vscode.cmd', 'code --wait $MERGED'],
			['diff.tool', 'vscode'],
			['difftool.vscode.cmd', 'code --wait --diff $LOCAL $REMOTE']
		];
		if (!applyGitConfigs(vscodeToolConfigs, ['--global'])) {
			return;
		}

		notifyQuiet(isGlobal ? 'Настройки Git применены глобально' : 'Настройки Git применены для текущего проекта');

		if (process.platform !== 'win32') {
			return;
		}
		const doAdmin = await vscode.window.showInformationMessage(
			'Показать команды для настроек с правами администратора? (core.longpaths true, LC_ALL C.UTF-8 для системы)',
			'Да',
			'Нет'
		);
		if (doAdmin !== 'Да') {
			return;
		}

		await showGitAdminCommands();
	}

	/**
	 * Устанавливает OPM (OneScript Package Manager)
	 *
	 * Выполняет команду opm install opm в терминале для установки или обновления
	 * менеджера пакетов OPM в проекте.
	 *
	 * @returns Промис, который разрешается после запуска команды
	 */
	async updateOpm(): Promise<void> {
		if (!ensureWorkspaceTrusted('обновление OPM')) {
			return;
		}
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureLocalOscriptAvailable())) {
			return;
		}

		const commandName = getUpdateOpmCommandName();
		this.vrunner.executeOpmInTerminal(['install', 'opm'], {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Создаёт packagedef из шаблона и делает проект текущим.
	 *
	 * Агенту возвращает результат для каталога из `root`, `projectPath` или корня вызова.
	 * Пользователю при нескольких вариантах предлагает каталог: папки рабочей области и
	 * не проекты; существующий файл перезаписывается только после подтверждения.
	 *
	 * @param arg - Первый аргумент команды
	 * @param opts - Опции вызова
	 */
	initializePackagedef(arg?: unknown, opts?: unknown): Promise<StructuredCommandResult | undefined> {
		return initializeProjectCommand(workspaceProjectsSource(), arg, opts);
	}

	/** Вариант создания проекта в приветственном экране */
	private static readonly CREATE_PROJECT_KIND_WITH_STRUCTURE = 'withStructure';
	private static readonly CREATE_PROJECT_KIND_PACKAGEDEF_ONLY = 'packagedefOnly';
	private static readonly CREATE_PROJECT_KIND_ONESCRIPT = 'oneScript';

	/**
	 * Создаёт каталоги и файлы нового проекта OneScript; существующие файлы не трогает.
	 * @param targetRoot — корень проекта (полный путь)
	 * @returns количество созданных каталогов и файлов
	 */
	private async createOneScriptStructureInFolder(targetRoot: string): Promise<{ createdDirs: number; createdFiles: number }> {
		let createdFiles = 0;
		for (const dir of ONESCRIPT_PROJECT_DIRECTORIES) {
			await fs.mkdir(path.join(targetRoot, dir), { recursive: true });
		}
		for (const file of ONESCRIPT_PROJECT_FILES) {
			try {
				await fs.writeFile(path.join(targetRoot, file.path), file.content, { encoding: 'utf-8', flag: 'wx' });
				createdFiles += 1;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
					throw error;
				}
			}
		}
		return { createdDirs: ONESCRIPT_PROJECT_DIRECTORIES.length, createdFiles };
	}

	/**
	 * Создаёт структуру каталогов по шаблону vanessa-bootstrap в указанной папке.
	 * @param targetRoot — корень проекта (полный путь)
	 * @returns количество созданных каталогов и новых README
	 */
	private async createProjectStructureInFolder(targetRoot: string): Promise<{ createdDirs: number; createdReadmes: number }> {
		let createdDirs = 0;
		let createdReadmes = 0;
		for (const item of PROJECT_STRUCTURE) {
			const dirPath = path.join(targetRoot, item.path);
			const readmePath = path.join(dirPath, 'README.md');
			await fs.mkdir(dirPath, { recursive: true });
			createdDirs += 1;
			try {
				await fs.access(readmePath);
			} catch {
				await fs.writeFile(readmePath, item.readmeContent, 'utf-8');
				createdReadmes += 1;
			}
		}
		return { createdDirs, createdReadmes };
	}

	/** Ключ globalState: путь к папке, в которой после открытия нужно запустить установку зависимостей */
	static readonly INSTALL_DEPS_AFTER_CREATE_KEY = '1c-platform-tools.installDepsAfterCreate';

	/**
	 * Создаёт новый проект из приветственного экрана проводника (без открытой папки).
	 * Спрашивает тип проекта, установку зависимостей, затем папку; создаёт packagedef и при выборе — структуру каталогов; при выборе — откладывает установку зависимостей до открытия папки.
	 */
	async createProjectFromWelcome(context?: vscode.ExtensionContext): Promise<void> {
		const kindChoice = await vscode.window.showQuickPick(
			[
				{
					label: '$(folder-opened) С каталогами (vanessa-bootstrap)',
					description: 'Каталоги doc, src/cf, features, tests и др. с README',
					detail: 'Рекомендуется для новых проектов 1С',
					picked: true,
					kindChoice: DependenciesCommands.CREATE_PROJECT_KIND_WITH_STRUCTURE
				},
				{
					label: '$(file) Только packagedef',
					description: 'Без создания каталогов',
					detail: 'Минимальный проект 1С',
					kindChoice: DependenciesCommands.CREATE_PROJECT_KIND_PACKAGEDEF_ONLY
				},
				{
					label: '$(package) Проект OneScript',
					description: 'packagedef пакета, src/Классы, src/Модули и tests',
					detail: 'Библиотека или приложение без платформы 1С',
					kindChoice: DependenciesCommands.CREATE_PROJECT_KIND_ONESCRIPT
				}
			] as (vscode.QuickPickItem & { kindChoice: string })[],
			{
				title: 'Тип нового проекта',
				placeHolder: 'Выберите, как создать проект',
				ignoreFocusOut: true
			}
		);
		if (!kindChoice?.kindChoice) {
			return;
		}
		const oneScript = kindChoice.kindChoice === DependenciesCommands.CREATE_PROJECT_KIND_ONESCRIPT;
		const withStructure = kindChoice.kindChoice === DependenciesCommands.CREATE_PROJECT_KIND_WITH_STRUCTURE;
		const projectLabel = oneScript ? 'Проект OneScript' : 'Проект 1С';

		const installDepsChoice = await vscode.window.showQuickPick(
			[
				{
					label: '$(check) Да, установить зависимости',
					description: 'opm install --dev -l по списку из packagedef',
					detail: 'Требуется OneScript (oscript, opm)',
					picked: true,
					installDeps: true
				},
				{
					label: '$(close) Нет, только создать проект',
					description: 'Зависимости можно установить позже командой «Установить зависимости»',
					installDeps: false
				}
			] as (vscode.QuickPickItem & { installDeps: boolean })[],
			{
				title: 'Установить зависимости',
				placeHolder: 'Установить зависимости из packagedef после создания проекта?',
				ignoreFocusOut: true
			}
		);
		if (installDepsChoice === undefined) {
			return;
		}
		const installDependencies = installDepsChoice.installDeps;

		const selected = await vscode.window.showOpenDialog({
			canSelectFolders: true,
			canSelectMany: false,
			title: 'Выберите папку для нового проекта',
			openLabel: 'Выбрать папку'
		});
		if (!selected?.length) {
			return;
		}
		const targetDir = selected[0].fsPath;

		const extensionPath = this.vrunner.getExtensionPath();
		if (!extensionPath) {
			const msg = 'Не удалось определить путь к расширению';
			log.error(msg);
			logger.show();
			vscode.window.showErrorMessage(msg);
			return;
		}

		const templatePath = path.join(extensionPath, oneScript ? ONESCRIPT_PROJECT_FILE_TEMPLATE : PROJECT_FILE_TEMPLATE);
		const packagedefPath = path.join(targetDir, 'packagedef');

		try {
			try {
				await writeProjectFile(targetDir, templatePath);
			} catch (error) {
				if (!(error instanceof ProjectFileExistsError)) {
					throw error;
				}
				const action = await vscode.window.showWarningMessage(
					'В выбранной папке уже есть файл packagedef. Перезаписать и открыть папку?',
					'Да',
					'Нет'
				);
				if (action !== 'Да') {
					return;
				}
				await writeProjectFile(targetDir, templatePath, true);
			}
			log.info(`Файл packagedef создан: ${packagedefPath}`);

			if (withStructure || oneScript) {
				try {
					const created = oneScript
						? await this.createOneScriptStructureInFolder(targetDir)
						: await this.createProjectStructureInFolder(targetDir);
					const files = 'createdFiles' in created ? created.createdFiles : created.createdReadmes;
					log.info(`Структура проекта создана: каталогов=${created.createdDirs}, новых файлов=${files}. Путь: ${targetDir}`);
					notifyQuiet(`${projectLabel} создан: packagedef и ${created.createdDirs} каталогов. Открываю папку…`);
				} catch (error) {
					const errMsg = (error as Error).message;
					log.error(`Не удалось создать структуру проекта: ${errMsg}. Путь: ${targetDir}`);
					await vscode.window.showWarningMessage(`packagedef создан, каталоги не созданы: ${errMsg}`, { modal: true });
				}
			} else {
				notifyQuiet(`${projectLabel} создан. Открываю папку…`);
			}
			if (installDependencies && context) {
				await context.globalState.update(DependenciesCommands.INSTALL_DEPS_AFTER_CREATE_KEY, targetDir);
			}
			// Показать панель «Начало работы» после открытия только что созданного проекта
			if (context) {
				await context.globalState.update('1c-platform-tools.showGetStartedForPath', targetDir);
			}
			await vscode.commands.executeCommand('vscode.openFolder', selected[0]);
		} catch (error) {
			const errMsg = (error as Error).message;
			log.error(`Не удалось создать файл packagedef: ${errMsg}. Путь: ${packagedefPath}`);
			logger.show();
			vscode.window.showErrorMessage(`Не удалось создать файл packagedef: ${errMsg}`);
		}
	}

	/**
	 * Инициализирует структуру каталогов проекта по шаблону vanessa-bootstrap.
	 *
	 * Создаёт каталоги и помещает в каждый README.md с кратким описанием.
	 * Существующие каталоги и файлы README не перезаписываются.
	 *
	 * @returns Промис, который разрешается после создания структуры
	 */
	async initializeProjectStructure(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		let createdDirs = 0;
		let createdReadmes = 0;

		try {
			for (const item of PROJECT_STRUCTURE) {
				const dirPath = path.join(workspaceRoot, item.path);
				const readmePath = path.join(dirPath, 'README.md');

				await fs.mkdir(dirPath, { recursive: true });
				createdDirs += 1;

				try {
					await fs.access(readmePath);
					// README уже есть — не перезаписываем
				} catch {
					await fs.writeFile(readmePath, item.readmeContent, 'utf-8');
					createdReadmes += 1;
				}
			}

			log.info(
				`Структура проекта создана: каталогов=${createdDirs}, новых README=${createdReadmes}. Workspace: ${workspaceRoot}`
			);
			notifyQuiet(
				`Структура проекта создана: ${createdDirs} каталогов, ${createdReadmes} файлов README`
			);
		} catch (error) {
			const errMsg = (error as Error).message;
			log.error(`Не удалось создать структуру проекта: ${errMsg}. Workspace: ${workspaceRoot}`);
			logger.show();
			vscode.window.showErrorMessage(`Не удалось создать структуру проекта: ${errMsg}`);
		}
	}

	/**
	 * Ставит версию OneScript через OVM рядом с уже установленными.
	 *
	 * Версию для всей машины (`ovm use`) команда меняет только при первой установке:
	 * других версий ещё нет, и ломать нечего. Проект, из которого её поставили,
	 * работает поставленной версией: сам или, если сам он выбрал бы другую
	 * установку, через выбор версии проекта.
	 * На Windows ovm запускается сам, на Linux и macOS через Mono. Конец установки
	 * узнаётся по коду возврата задачи, в терминале — по появлению движка в каталоге версии.
	 *
	 * @returns Промис, который разрешается по завершении
	 */
	async installOscript(): Promise<void> {
		if (!ensureWorkspaceTrusted('установка OneScript')) {
			return;
		}
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const alreadyInstalled = await this.vrunner.checkOscriptAvailable();

		const packagedefVersion = getOscriptVersionFromPackagedef(workspaceRoot);
		const versionHint = packagedefVersion.fromPackagedef
			? ` packagedef: ${packagedefVersion.version}.`
			: ' В packagedef не указана.';
		const confirmMessage = alreadyInstalled
			? `OneScript установлен. Поставить через OVM ещё одну версию?${versionHint}`
			: `OneScript не найден. Установить через OVM? Нужен интернет.${versionHint}`;
		const confirm = await vscode.window.showWarningMessage(
			confirmMessage,
			'Установить',
			'Отмена'
		);
		if (confirm !== 'Установить') {
			return;
		}

		const ovmVersion = await pickOvmVersion(packagedefVersion);
		if (!ovmVersion) {
			return;
		}

		const commandName = getInstallOneScriptCommandName();
		const { mtimeMs: installedBefore } = installedEngineMtime(ovmVersion);
		// Первая установка становится версией машины: терминалы и другие проекты без неё движка не найдут
		const makeDefault = !fsSync.existsSync(getOvmRootDir());
		const steps = [['install', ovmVersion], ...(makeDefault ? [['use', ovmVersion]] : [])];

		// OVM берём из кэша компонентов: качаем средствами Node, а не оболочкой.
		// Связку «скачать .exe в оболочке и запустить» антивирусы метят как trojan-downloader.
		let ovmPath: string;
		try {
			ovmPath = await ensureOvm(this.context);
		} catch (error) {
			const errMsg = (error as Error).message;
			await showComponentError(`Не удалось получить OVM: ${errMsg}`);
			return;
		}

		// Задачей, а не терминалом: терминалу нужен ConPTY, а он есть не на всякой Windows
		if (this.vrunner.shouldUseTasks()) {
			// На Windows ovm запускается напрямую, на остальных ОС через mono
			const ovmCall = (args: string[]): string => process.platform === 'win32'
				? buildProcessCommand(ovmPath, args)
				: buildProcessCommand('mono', [ovmPath, ...args]);
			let resolveExit: (code: number) => void = () => undefined;
			const exitCode = new Promise<number>((resolve) => {
				resolveExit = resolve;
			});
			await vscode.tasks.executeTask(createVRunnerTask({
				name: commandName.title,
				command: joinCommands(steps.map(ovmCall), PROCESS_HOST_SHELL),
				cwd: workspaceRoot,
				exitCallback: resolveExit,
			}));

			// Код возврата задачи, а не опрос времени модификации oscript: раскладка
			// каталогов у ovm зависит от версии, и опрос её не всегда замечал
			if (await exitCode !== 0) {
				notifyQuietFailure('Установка OneScript завершилась с ошибкой');
				return;
			}
			await this.useInstalledVersion(workspaceRoot, ovmVersion);
			return;
			/* eslint-disable no-restricted-syntax -- execution.useTasks === false: терминал выбран пользователем */
		} else if (process.platform === 'win32') {
			const ovmQuoted = `'${ovmPath.replaceAll("'", "''")}'`;
			const psScript = [
				'$ErrorActionPreference = "Stop"',
				`Write-Host "Установка OneScript (${ovmVersion})..."`,
				...steps.map((args) => `& ${ovmQuoted} ${args.join(' ')}`),
				'Write-Host "Готово" -ForegroundColor Green'
			].join('; ');

			const terminal = vscode.window.createTerminal({
				name: commandName.title,
				shellPath: 'powershell.exe',
				shellArgs: ['-NoProfile', '-Command', psScript],
				cwd: workspaceRoot
			});
			terminal.show();
		} else {
			const shScript = [
				`echo "Установка OneScript (${ovmVersion})..."`,
				...steps.map((args) => `mono ${JSON.stringify(ovmPath)} ${args.join(' ')}`),
				'echo "Готово"'
			].join(' && ');

			const terminal = vscode.window.createTerminal({
				name: commandName.title,
				cwd: workspaceRoot
			});
			terminal.sendText(shScript);
			terminal.show();
			/* eslint-enable no-restricted-syntax */
		}

		log.info(`Установка OneScript запущена: ${commandName.title}, версия: ${ovmVersion}`);

		const busy = notifyBusy('Ожидание установки OneScript…');
		let installed: boolean;
		try {
			installed = await waitForOvmInstallComplete(ovmVersion, installedBefore);
		} finally {
			busy.dispose();
		}

		if (!installed) {
			await this.vrunner.refreshOneScriptResolution();
			log.warn('Установка OneScript не подтвердилась за время ожидания');
			void vscode.window.showWarningMessage(
				`Установка OneScript не подтвердилась. Проверьте вывод в терминале «${commandName.title}».`
			);
			return;
		}

		await this.useInstalledVersion(workspaceRoot, ovmVersion);
	}

	/**
	 * Проект берёт поставленную версию: сам, а если сам он нашёл другую
	 * установку, через выбор версии проекта.
	 *
	 * Движок ищется заново: иначе до конца сессии работала бы установка, найденная
	 * при активации, ведь PATH процесса VS Code задан при его запуске.
	 *
	 * @param root - Корень проекта
	 * @param version - Версия или метка, с которой поставлен OneScript
	 */
	private async useInstalledVersion(root: string, version: string): Promise<void> {
		await this.vrunner.refreshOneScriptResolution();
		const installed = listOvmInstallations().find((item) => item.name === version);
		const engine = await this.vrunner.projectEngine();
		if (installed !== undefined && !sameFile(engine?.oscript, installed.oscript)) {
			await this.vrunner.setProjectOscriptVersion(version);
			log.info(`OneScript проекта ${root}: установка OVM ${version}`);
		}
		notifyQuiet(`OneScript ${version} установлен`);
	}

	/**
	 * Выбирает версию OneScript проекта из установок OVM.
	 *
	 * Выбор хранится у проекта; без выбора движок проекта находится сам: движок
	 * машины, если он не ниже ВерсияСреды из packagedef, иначе установка по ней.
	 *
	 * @returns Промис, который разрешается после выбора
	 */
	async selectOscript(): Promise<void> {
		const root = this.ensureWorkspace();
		if (!root) {
			return;
		}
		const installations = listOvmInstallations();
		const required = readPackageManifest(root)?.engineVersion;
		const requiredVersion = required === undefined ? undefined : parseEngineVersion(required);
		const configured = this.vrunner.projectOscriptVersion();
		const versions = await Promise.all(installations.map((item) => item.version ?? this.vrunner.engineVersion(item.oscript)));
		const describe = (version: EngineVersion | undefined, name: string): string | undefined => {
			const parts = [
				version && version.text !== name ? version.text : undefined,
				version && requiredVersion && !engineVersionSupported(version.parts, requiredVersion.parts) ? `ниже ${required}` : undefined,
			].filter((part): part is string => part !== undefined);
			return parts.length > 0 ? parts.join(' · ') : undefined;
		};

		type VersionItem = vscode.QuickPickItem & { value?: string; install?: boolean };
		const items: VersionItem[] = [
			{
				label: 'Автоматически',
				description: required === undefined ? 'текущая установка OVM' : `не ниже ВерсияСреды ${required}`,
				value: '',
			},
			...(installations.length > 0 ? [{ label: 'Установки OVM', kind: vscode.QuickPickItemKind.Separator }] : []),
			...installations.map((item, index) => ({
				label: item.name,
				description: describe(versions[index], item.name),
				value: item.name,
			})),
			{ label: '', kind: vscode.QuickPickItemKind.Separator },
			{ label: '$(cloud-download) Установить другую версию', install: true },
		];
		for (const item of items) {
			if (item.value !== undefined && item.value === configured) {
				item.label = `$(check) ${item.label}`;
			}
		}

		const chosen = await vscode.window.showQuickPick(items, {
			title: getSelectOneScriptCommandName().title,
			placeHolder: 'Версия OneScript проекта',
		});
		if (!chosen) {
			return;
		}
		if (chosen.install) {
			await this.installOscript();
			return;
		}
		await this.vrunner.setProjectOscriptVersion(chosen.value === '' ? undefined : chosen.value);
		const engine = await this.vrunner.projectEngine();
		notifyQuiet(engine?.version ? `OneScript проекта: ${engine.version.text}` : 'Версия OneScript проекта выбрана');
	}
}

/**
 * Один ли это исполняемый файл: движок из `current` OVM — тот же файл каталога версии.
 *
 * @param left - Файл найденного движка; undefined, если движка нет
 * @param right - Файл установки
 */
function sameFile(left: string | undefined, right: string): boolean {
	if (left === undefined) {
		return false;
	}
	const real = (file: string): string => {
		try {
			return fsSync.realpathSync(file);
		} catch {
			return path.resolve(file);
		}
	};
	const [a, b] = [real(left), real(right)];
	return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
