import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { spawnSync } from 'node:child_process';
import { BaseCommand } from './baseCommand';
import {
	getInstallDependenciesCommandName,
	getInstallOneScriptCommandName,
	getUpdateOpmCommandName
} from '../commandNames';
import { logger } from '../logger';
import { notifyProjectCreated } from '../projectContext';
import { PROJECT_STRUCTURE } from '../projectStructure';

/** URL для скачивания OVM (OneScript Version Manager) */
const OVM_DOWNLOAD_URL = 'https://github.com/oscript-library/ovm/releases/latest/download/ovm.exe';

/** Регулярное выражение для извлечения ВерсияСреды из packagedef (например .ВерсияСреды("2.0.0")) */
const PACKAGEDEF_VERSIYA_SREDY = /\.ВерсияСреды\s*\(\s*["']([^"']+)["']\s*\)/;

/** Интервал опроса появления OVM после установки (мс) */
const OVM_POLL_INTERVAL_MS = 3000;
/** Максимальное время ожидания завершения установки (мс) */
const OVM_POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** Теги OVM для выбора версии OneScript */
const OVM_TAGS = ['lts', 'stable', 'dev', 'preview', 'lts-dev'] as const;

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
 * Читает версию OneScript из packagedef (ВерсияСреды). При отсутствии или ошибке возвращает stable.
 *
 * @param workspaceRoot - Корень workspace
 * @returns Версия и признак «из packagedef»
 */
async function getOscriptVersionFromPackagedef(workspaceRoot: string): Promise<OscriptVersionFromPackagedef> {
	try {
		const content = await fs.readFile(path.join(workspaceRoot, 'packagedef'), 'utf-8');
		const match = PACKAGEDEF_VERSIYA_SREDY.exec(content);
		const version = match?.[1]?.trim();
		if (version) {
			return { version, fromPackagedef: true };
		}
	} catch {
		// Файл отсутствует или не прочитался — используем stable
	}
	return { version: 'stable', fromPackagedef: false };
}

/**
 * Возвращает путь к oscript в каталоге OVM и его текущее время модификации (или 0, если файла нет).
 */
function getOvmOscriptPathAndMtime(): { path: string; mtimeMs: number } {
	const oscriptPath =
		process.platform === 'win32'
			? path.join(process.env.LOCALAPPDATA || '', 'ovm', 'current', 'bin', 'oscript.exe')
			: path.join(os.homedir(), '.local', 'share', 'ovm', 'current', 'bin', 'oscript');
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
 * @param initialMtimeMs - Время модификации oscript до запуска установки (0, если файла не было)
 * @returns true, если установка зафиксирована (файл создан/обновлён); false при таймауте
 */
async function waitForOvmInstallComplete(initialMtimeMs: number): Promise<boolean> {
	const { path: oscriptPath } = getOvmOscriptPathAndMtime();
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

/**
 * Запускает настройки Git с правами администратора (Windows): core.longpaths true, LC_ALL C.UTF-8.
 * Создаёт временный .cmd, запускает его через Start-Process -Verb RunAs, удаляет файл.
 *
 * @returns true при успешном запуске (или после попытки), false при ошибке создания скрипта
 */
async function runGitAdminElevated(): Promise<boolean> {
	const adminScript = [
		'@chcp 65001 >nul',
		'git config --system core.longpaths true',
		'setx LC_ALL C.UTF-8 /M'
	].join('\r\n');

	let tempFile: string;
	try {
		tempFile = path.join(os.tmpdir(), `1c-platform-tools-git-admin-${Date.now()}.cmd`);
		await fs.writeFile(tempFile, adminScript, 'utf-8');
	} catch (error) {
		const errMsg = (error as Error).message;
		logger.error(`Не удалось создать скрипт для админ-настроек: ${errMsg}`);
		vscode.window.showErrorMessage(`Не удалось создать временный скрипт: ${errMsg}`);
		return false;
	}

	try {
		const psRun = spawnSync(
			'powershell.exe',
			[
				'-NoProfile',
				'-ExecutionPolicy',
				'Bypass',
				'-Command',
				`Start-Process -FilePath "cmd.exe" -ArgumentList '/c','${tempFile.replaceAll("'", "''")}' -Verb RunAs -Wait`
			],
			{ encoding: 'utf8', shell: false }
		);
		if (psRun.status !== 0) {
			logger.warn(`Запуск с правами администратора завершился с кодом ${psRun.status}`);
		}
	} catch (error) {
		const errMsg = (error as Error).message;
		logger.error(`Ошибка запуска с правами администратора: ${errMsg}`);
		vscode.window.showWarningMessage(
			'Не удалось запустить настройки с правами администратора. Выполните вручную от имени администратора: git config --system core.longpaths true и setx LC_ALL C.UTF-8 /M'
		);
	} finally {
		try {
			await fs.unlink(tempFile);
		} catch {
			// игнорируем ошибку удаления временного файла
		}
	}
	return true;
}

/**
 * Команды для управления зависимостями проекта
 */
export class DependenciesCommands extends BaseCommand {

	/**
	 * Устанавливает зависимости проекта
	 * 
	 * Выполняет команду opm install -l в терминале для установки всех зависимостей,
	 * указанных в packagedef файле проекта.
	 * 
	 * @returns Промис, который разрешается после запуска команды
	 */
	async installDependencies(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		const commandName = getInstallDependenciesCommandName();
		this.vrunner.executeOpmInTerminal(['install', '-l'], {
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

		const oscriptModulesPath = path.join(workspaceRoot, 'oscript_modules');
		
		try {
			const stats = await fs.stat(oscriptModulesPath);
			if (stats.isDirectory()) {
				await fs.rm(oscriptModulesPath, { recursive: true, force: true });
				logger.info(`Каталог oscript_modules успешно удалён: ${oscriptModulesPath}`);
				vscode.window.showInformationMessage('Каталог oscript_modules успешно удален');
			} else {
				logger.warn(`oscript_modules не является каталогом: ${oscriptModulesPath}`);
				vscode.window.showWarningMessage('oscript_modules не является каталогом');
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				logger.info('Каталог oscript_modules не найден');
				vscode.window.showInformationMessage('Каталог oscript_modules не найден');
			} else {
				const errMsg = (error as Error).message;
				logger.error(`Не удалось удалить каталог oscript_modules: ${errMsg}. Путь: ${oscriptModulesPath}`);
				vscode.window.showErrorMessage(`Не удалось удалить каталог oscript_modules: ${errMsg}`);
			}
		}
	}

	/**
	 * Настраивает Git: user.name, user.email, алиасы и общие параметры.
	 * Запросы (имя, email, проект/глобально) показываются в верхней части окна VS Code.
	 * Опционально запускает настройки с правами администратора (core.longpaths true, LC_ALL C.UTF-8).
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
			ignoreFocusOut: true
		});
		if (userName === undefined) {
			return;
		}
		if (!userName.trim()) {
			vscode.window.showWarningMessage('Имя пользователя не задано.');
			return;
		}

		const userEmail = await vscode.window.showInputBox({
			title: 'Настройка Git',
			prompt: 'Введите email для Git',
			placeHolder: 'user@example.com',
			ignoreFocusOut: true
		});
		if (userEmail === undefined) {
			return;
		}
		if (!userEmail.trim()) {
			vscode.window.showWarningMessage('Email не задан.');
			return;
		}

		const scopeChoice = await vscode.window.showQuickPick(
			[
				{ label: 'Текущий проект', value: 'project' as const },
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
		const globalFlag = isGlobal ? ['--global'] : [];
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

		const configs: [string, string][] = [
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

		for (const [key, value] of configs) {
			const { ok, stderr } = runGitConfig([...globalFlag, 'config', key, value]);
			if (!ok) {
				logger.error(`Git config ${key}=${value}: ${stderr}`);
				vscode.window.showErrorMessage(`Ошибка настройки Git (${key}): ${stderr || 'неизвестная ошибка'}`);
				return;
			}
		}

		logger.info(`Настройки Git применены (${isGlobal ? 'глобально' : 'для текущего проекта'})`);
		vscode.window.showInformationMessage(
			`Настройки Git успешно применены (${isGlobal ? 'глобально' : 'для текущего проекта'}).`
		);

		const doAdmin = await vscode.window.showInformationMessage(
			'Выполнить настройки с правами администратора? (core.longpaths true, LC_ALL C.UTF-8 для системы)',
			'Да',
			'Нет'
		);
		if (doAdmin !== 'Да') {
			return;
		}

		if (process.platform !== 'win32') {
			vscode.window.showInformationMessage(
				'Настройки с правами администратора поддерживаются только в Windows. На Linux/macOS при необходимости выполните вручную: git config --system core.longpaths true и установите LC_ALL=C.UTF-8.'
			);
			return;
		}

		await runGitAdminElevated();
		vscode.window.showInformationMessage(
			'Команда с правами администратора выполнена. При запросе UAC было открыто отдельное окно.'
		);
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
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		const commandName = getUpdateOpmCommandName();
		this.vrunner.executeOpmInTerminal(['install', 'opm'], {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Инициализирует файл packagedef с шаблоном
	 * 
	 * Создает файл packagedef в корне проекта с базовым содержимым из шаблона.
	 * Если файл уже существует, запрашивает подтверждение на перезапись.
	 * После создания открывает файл в редакторе VS Code.
	 * 
	 * @returns Промис, который разрешается после создания файла
	 * @throws {Error} Если не удалось прочитать шаблон или создать файл
	 */
	async initializePackagedef(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const packagedefPath = path.join(workspaceRoot, 'packagedef');
		
		// Проверяем, существует ли уже файл
		try {
			await fs.access(packagedefPath);
			const action = await vscode.window.showWarningMessage(
				'Файл packagedef уже существует. Перезаписать?',
				'Да',
				'Нет'
			);
			
			if (action !== 'Да') {
				return;
			}
		} catch {
			// Файл не существует, продолжаем
		}

		// Получаем путь к шаблону
		const extensionPath = this.vrunner.getExtensionPath();
		if (!extensionPath) {
			const msg = 'Не удалось определить путь к расширению';
			logger.error(
				`${msg}. Возможные причины: расширение не передало ExtensionContext в VRunnerManager при активации; workspaceRoot=${workspaceRoot ?? 'не определён'}. Проверьте панель Output (1C: Platform tools) для диагностики.`
			);
			logger.show();
			vscode.window.showErrorMessage(msg);
			return;
		}

		const templatePath = path.join(extensionPath, 'resources', 'templates', 'packagedef.template');
		logger.debug(`Инициализация packagedef: workspaceRoot=${workspaceRoot}, extensionPath=${extensionPath}, templatePath=${templatePath}`);

		// Читаем шаблон из файла
		let packagedefContent: string;
		try {
			packagedefContent = await fs.readFile(templatePath, 'utf-8');
		} catch (error) {
			const errMsg = (error as Error).message;
			logger.error(`Не удалось прочитать шаблон packagedef: ${errMsg}. Путь: ${templatePath}`);
			logger.show();
			vscode.window.showErrorMessage(
				`Не удалось прочитать шаблон packagedef: ${errMsg}`
			);
			return;
		}

		try {
			await fs.writeFile(packagedefPath, packagedefContent, 'utf-8');
			logger.info(`Файл packagedef успешно создан: ${packagedefPath}`);
			vscode.window.showInformationMessage('Файл packagedef успешно создан');

			// Полная активация расширения: панель «Инструменты 1С» и дерево появятся без перезагрузки окна
			notifyProjectCreated();

			// Открываем файл в редакторе
			const uri = vscode.Uri.file(packagedefPath);
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc);
		} catch (error) {
			const errMsg = (error as Error).message;
			logger.error(`Не удалось создать файл packagedef: ${errMsg}. Путь: ${packagedefPath}`);
			logger.show();
			vscode.window.showErrorMessage(`Не удалось создать файл packagedef: ${errMsg}`);
		}
	}

	/** Вариант создания проекта в приветственном экране */
	private static readonly CREATE_PROJECT_KIND_WITH_STRUCTURE = 'withStructure';
	private static readonly CREATE_PROJECT_KIND_PACKAGEDEF_ONLY = 'packagedefOnly';

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
	 * Создаёт новый проект 1С из приветственного экрана проводника (без открытой папки).
	 * Спрашивает тип проекта, установку зависимостей, затем папку; создаёт packagedef и при выборе — структуру каталогов; при выборе — откладывает установку зависимостей до открытия папки.
	 */
	async createProjectFromWelcome(context?: vscode.ExtensionContext): Promise<void> {
		const kindChoice = await vscode.window.showQuickPick(
			[
				{
					label: '$(folder-opened) С каталогами (vanessa-bootstrap)',
					description: 'Каталоги doc, src/cf, features, tests и др. с README',
					detail: 'Рекомендуется для новых проектов',
					picked: true,
					kindChoice: DependenciesCommands.CREATE_PROJECT_KIND_WITH_STRUCTURE
				},
				{
					label: '$(file) Только packagedef',
					description: 'Без создания каталогов',
					detail: 'Минимальный проект',
					kindChoice: DependenciesCommands.CREATE_PROJECT_KIND_PACKAGEDEF_ONLY
				}
			] as (vscode.QuickPickItem & { kindChoice: string })[],
			{
				title: 'Тип нового проекта 1С',
				placeHolder: 'Выберите, как создать проект',
				ignoreFocusOut: true
			}
		);
		if (!kindChoice?.kindChoice) {
			return;
		}
		const withStructure = kindChoice.kindChoice === DependenciesCommands.CREATE_PROJECT_KIND_WITH_STRUCTURE;

		const installDepsChoice = await vscode.window.showQuickPick(
			[
				{
					label: '$(check) Да, установить зависимости',
					description: 'opm install -l по списку из packagedef',
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
			title: 'Выберите папку для нового проекта 1С',
			openLabel: 'Выбрать папку'
		});
		if (!selected?.length) {
			return;
		}
		const targetDir = selected[0].fsPath;

		const extensionPath = this.vrunner.getExtensionPath();
		if (!extensionPath) {
			const msg = 'Не удалось определить путь к расширению';
			logger.error(msg);
			logger.show();
			vscode.window.showErrorMessage(msg);
			return;
		}

		const templatePath = path.join(extensionPath, 'resources', 'templates', 'packagedef.template');
		const packagedefPath = path.join(targetDir, 'packagedef');

		try {
			await fs.access(packagedefPath);
			const action = await vscode.window.showWarningMessage(
				'В выбранной папке уже есть файл packagedef. Перезаписать и открыть папку?',
				'Да',
				'Нет'
			);
			if (action !== 'Да') {
				return;
			}
		} catch {
			// Файл не существует — создаём каталог при необходимости
			await fs.mkdir(targetDir, { recursive: true });
		}

		let packagedefContent: string;
		try {
			packagedefContent = await fs.readFile(templatePath, 'utf-8');
		} catch (error) {
			const errMsg = (error as Error).message;
			logger.error(`Не удалось прочитать шаблон packagedef: ${errMsg}. Путь: ${templatePath}`);
			logger.show();
			vscode.window.showErrorMessage(`Не удалось прочитать шаблон packagedef: ${errMsg}`);
			return;
		}

		try {
			await fs.writeFile(packagedefPath, packagedefContent, 'utf-8');
			logger.info(`Файл packagedef создан: ${packagedefPath}`);

			if (withStructure) {
				try {
					const { createdDirs, createdReadmes } = await this.createProjectStructureInFolder(targetDir);
					logger.info(
						`Структура проекта создана: каталогов=${createdDirs}, новых README=${createdReadmes}. Путь: ${targetDir}`
					);
					vscode.window.showInformationMessage(
						`Проект 1С создан: packagedef и структура (${createdDirs} каталогов, ${createdReadmes} README). Открываю папку…`
					);
				} catch (error) {
					const errMsg = (error as Error).message;
					logger.error(`Не удалось создать структуру проекта: ${errMsg}. Путь: ${targetDir}`);
					logger.show();
					vscode.window.showWarningMessage(
						`packagedef создан, но не удалось создать каталоги: ${errMsg}. Открываю папку.`
					);
				}
			} else {
				vscode.window.showInformationMessage('Проект 1С создан. Открываю папку…');
			}
			if (installDependencies && context) {
				await context.globalState.update(DependenciesCommands.INSTALL_DEPS_AFTER_CREATE_KEY, targetDir);
				vscode.window.showInformationMessage(
					'После открытия папки будет предложена установка зависимостей (opm install -l).'
				);
			}
			// Показать панель «Начало работы» после открытия только что созданного проекта
			if (context) {
				await context.globalState.update('1c-platform-tools.showGetStartedForPath', targetDir);
			}
			await vscode.commands.executeCommand('vscode.openFolder', selected[0]);
		} catch (error) {
			const errMsg = (error as Error).message;
			logger.error(`Не удалось создать файл packagedef: ${errMsg}. Путь: ${packagedefPath}`);
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

			logger.info(
				`Структура проекта создана: каталогов=${createdDirs}, новых README=${createdReadmes}. Workspace: ${workspaceRoot}`
			);
			vscode.window.showInformationMessage(
				`Структура проекта создана: ${createdDirs} каталогов, ${createdReadmes} файлов README`
			);
			notifyProjectCreated();
		} catch (error) {
			const errMsg = (error as Error).message;
			logger.error(`Не удалось создать структуру проекта: ${errMsg}. Workspace: ${workspaceRoot}`);
			logger.show();
			vscode.window.showErrorMessage(`Не удалось создать структуру проекта: ${errMsg}`);
		}
	}

	/**
	 * Устанавливает OneScript (oscript) через OVM при отсутствии в системе.
	 *
	 * Проверяет наличие oscript. Если доступен — сообщает и предлагает перезапуск при повторном запуске.
	 * Если нет — запускает в терминале установку через OVM: на Windows — PowerShell (ovm.exe),
	 * на Linux/macOS — загрузка ovm.exe и запуск через Mono (`mono ovm.exe install` и `use`).
	 * Ожидание завершения — по появлению/обновлению файла oscript в каталоге OVM.
	 *
	 * @returns Промис, который разрешается по завершении
	 */
	async installOscript(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const oscriptOk = await this.vrunner.checkOscriptAvailable();
		const alreadyInstalled = oscriptOk;

		const packagedefVersion = await getOscriptVersionFromPackagedef(workspaceRoot);
		const versionHint = packagedefVersion.fromPackagedef
			? ` packagedef: ${packagedefVersion.version}.`
			: ' В packagedef не указана.';
		const confirmMessage = alreadyInstalled
			? `OneScript установлен. Всё равно установить/обновить через OVM?${versionHint}`
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
		const { mtimeMs: ovmOscriptMtimeBefore } = getOvmOscriptPathAndMtime();

		if (process.platform === 'win32') {
			const tempOvm = String.raw`$env:TEMP\ovm.exe`;
			const ovmBinHint = String.raw`$env:LOCALAPPDATA\ovm\current\bin`;
			const psScript = [
				'$ErrorActionPreference = "Stop"',
				`Write-Host "Загрузка OVM из ${OVM_DOWNLOAD_URL}..."`,
				`Invoke-WebRequest -Uri '${OVM_DOWNLOAD_URL}' -OutFile ${tempOvm} -UseBasicParsing`,
				`Write-Host "Установка OneScript (${ovmVersion})..."`,
				`& ${tempOvm} install ${ovmVersion}`,
				`& ${tempOvm} use ${ovmVersion}`,
				`Write-Host "Готово. Путь OVM: ${ovmBinHint}" -ForegroundColor Green`
			].join('; ');

			const terminal = vscode.window.createTerminal({
				name: commandName.title,
				shellPath: 'powershell.exe',
				shellArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
				cwd: workspaceRoot
			});
			terminal.show();
		} else {
			const tmpOvm = path.join(os.tmpdir(), 'ovm.exe');
			const shScript = [
				`echo "Загрузка OVM из ${OVM_DOWNLOAD_URL}..."`,
				`curl -L -o ${JSON.stringify(tmpOvm)} ${JSON.stringify(OVM_DOWNLOAD_URL)}`,
				`echo "Установка OneScript (${ovmVersion})..."`,
				`mono ${JSON.stringify(tmpOvm)} install ${ovmVersion}`,
				`mono ${JSON.stringify(tmpOvm)} use ${ovmVersion}`,
				`echo "Готово. Путь OVM: $HOME/.local/share/ovm/current/bin"`
			].join(' && ');

			const terminal = vscode.window.createTerminal({
				name: commandName.title,
				cwd: workspaceRoot
			});
			terminal.sendText(shScript);
			terminal.show();
		}

		logger.info(`Установка OneScript запущена в терминале: ${commandName.title}, версия: ${ovmVersion}`);

		vscode.window.setStatusBarMessage('Ожидание установки OneScript…', OVM_POLL_TIMEOUT_MS);
		const installed = await waitForOvmInstallComplete(ovmOscriptMtimeBefore);
		vscode.window.setStatusBarMessage('', 0);

		if (!installed) {
			logger.info('Таймаут ожидания установки OVM');
			vscode.window.showInformationMessage(
				'Установка идёт дольше или с ошибкой. Если в терминале успешно — перезапустите окно (Reload Window).'
			);
			return;
		}

		const reload = await vscode.window.showInformationMessage(
			'OneScript установлен. Перезапустить окно (PATH обновится)?',
			'Перезапустить',
			'Позже'
		);
		if (reload === 'Перезапустить') {
			await vscode.commands.executeCommand('workbench.action.reloadWindow');
		}
	}
}
