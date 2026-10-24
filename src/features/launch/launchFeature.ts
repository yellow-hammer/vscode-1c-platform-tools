/**
 * Профили запуска и временные параметры.
 *
 * Статус-бар активного профиля открывает выбор профиля. Временные параметры
 * (адрес ИБ, пользователь, пароль, версия платформы, доп. параметры) задаются
 * через QuickPick и применяются ко всем командам vanessa-runner поверх профиля.
 * Окружение профиля лежит в файлах `.env.<id>`: у проекта OneScript профиль —
 * только окружение.
 */

import { resolveODataEndpoint } from '../../shared/odataEndpoint';
import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { spawn } from 'node:child_process';
import { VRunnerManager } from '../../shared/vrunnerManager';
import {
	BASE_DOTENV_FILE,
	DEFAULT_PROFILE_ID,
	EnvOverrides,
	LOCAL_OVERRIDES_FILE,
	SettingsSchema,
	baseSettingsFileName,
	ownDotEnvFiles,
	parseDotEnvFileName,
	type EnvProfile,
} from '../../shared/envProfiles';
import { logger } from '../../shared/logger';
import { notifyQuiet } from '../../shared/notify';
import { ENV_DEFAULTS, AUTUMN_DEFAULTS } from '../serviceFiles/envDefaults';
import { buildEnvJsonWithSections } from '../serviceFiles/envJsonBuilder';
import { isAgentOptions, uiOnlyHandler } from '../../shared/agentGate';
import {
	currentRoot,
	onDidChangeCurrentProject,
	onDidChangeProjects,
	outsideProject,
	runWithProject,
} from '../../shared/workspaceProjects';
import { inCurrentProject } from '../../commands/projectScope';
import { profileStatusVisible } from './launchStatusScope';
import {
	ensureEnvProfileStatusBar,
	refreshEnvProfileStatusBar,
	disposeEnvProfileStatusBar,
} from './envProfileStatusBar';
import type { StructuredCommandResult } from '../../shared/commandExecutionTypes';

const log = logger.scope('launch');

/** Изменяемая ссылка на признак проекта 1С */
interface ProjectRef {
	current: boolean;
}

/** Поле временных параметров запуска */
interface OverrideField {
	key: keyof EnvOverrides;
	flag: string;
	prompt: string;
	password?: boolean;
}

const OVERRIDE_FIELDS: OverrideField[] = [
	{ key: 'ibConnection', flag: '--ibconnection', prompt: 'Файловая ИБ: /F<путь>. Серверная ИБ: /S<сервер>\\<имя_ИБ>' },
	{ key: 'dbUser', flag: '--db-user', prompt: 'Имя пользователя информационной базы' },
	{ key: 'dbPwd', flag: '--db-pwd', password: true, prompt: 'Пароль пользователя информационной базы' },
	{ key: 'v8version', flag: '--v8version', prompt: 'Версия платформы, например 8.3.21.1234' },
	{ key: 'additional', flag: '--additional', prompt: 'Дополнительные параметры командной строки запуска 1С' },
];

/** Предлагали ли уже в этой сессии добавить env.local.json в .gitignore */
let suggestedLocalOverridesGitignore = false;

/**
 * Игнорирует ли git файл (с учётом глобальных исключений пользователя).
 *
 * @param workspaceRoot - Корень проекта
 * @param relPath - Путь относительно корня
 * @returns true/false; undefined, если git недоступен или это не репозиторий
 */
function isGitIgnored(workspaceRoot: string, relPath: string): Promise<boolean | undefined> {
	return new Promise((resolve) => {
		const child = spawn('git', ['check-ignore', '-q', '--', relPath], { cwd: workspaceRoot });
		child.on('error', () => resolve(undefined));
		child.on('close', (code) => {
			// 0 — игнорируется, 1 — нет; 128 — не репозиторий или другая ошибка git
			resolve(code === 0 ? true : code === 1 ? false : undefined);
		});
	});
}

/**
 * Предлагает добавить env.local.json в .gitignore, если файл не игнорируется.
 *
 * Локальные перекрытия и создаются ради того, чтобы не попадать в общий
 * репозиторий; закоммиченный env.local.json навязал бы личные параметры всей
 * команде. Проверка через `git check-ignore` уважает и глобальные исключения.
 * Предложение показывается не чаще раза за сессию.
 *
 * @param workspaceRoot - Корень проекта
 */
async function suggestGitignoreForLocalOverrides(workspaceRoot: string): Promise<void> {
	if (suggestedLocalOverridesGitignore || !fsSync.existsSync(path.join(workspaceRoot, LOCAL_OVERRIDES_FILE))) {
		return;
	}
	if (await isGitIgnored(workspaceRoot, LOCAL_OVERRIDES_FILE) !== false) {
		return;
	}
	suggestedLocalOverridesGitignore = true;
	const addAction = 'Добавить в .gitignore';
	const picked = await vscode.window.showWarningMessage(
		`${LOCAL_OVERRIDES_FILE} не игнорируется git — локальные перекрытия могут попасть в коммит.`,
		addAction
	);
	if (picked !== addAction) {
		return;
	}
	const gitignorePath = path.join(workspaceRoot, '.gitignore');
	let content = '';
	try {
		content = await fs.readFile(gitignorePath, 'utf8');
	} catch {
		// .gitignore ещё нет — создаём
	}
	const separator = content === '' || content.endsWith('\n') ? '' : '\n';
	await fs.writeFile(
		gitignorePath,
		`${content}${separator}\n# Локальные перекрытия профиля запуска (не коммитятся)\n${LOCAL_OVERRIDES_FILE}\n`,
		'utf8'
	);
	log.info(`${LOCAL_OVERRIDES_FILE} добавлен в .gitignore`);
}

/**
 * Содержимое для нового файла профиля: копия базового файла настроек схемы
 * (env.json / autumn-properties.json) или канонический дефолт.
 *
 * @param workspaceRoot - Корень рабочей области
 * @param schema - Схема настроек установленного vrunner
 * @returns Текст файла (JSON)
 */
async function buildNewProfileContent(workspaceRoot: string, schema: SettingsSchema): Promise<string> {
	const basePath = path.join(workspaceRoot, baseSettingsFileName(schema));
	try {
		const base = await fs.readFile(basePath, 'utf8');
		JSON.parse(base); // валидируем, что это корректный JSON
		return base;
	} catch {
		// базового файла нет — используем канонический дефолт
	}
	if (schema === 'v3') {
		return JSON.stringify(AUTUMN_DEFAULTS, null, 4) + '\n';
	}
	return JSON.stringify(ENV_DEFAULTS, null, 4) + '\n';
}


/** Содержимое нового файла окружения: формат строки, остальное пишет пользователь */
const NEW_DOTENV_CONTENT = '# ИМЯ=значение\n';

/**
 * Спрашивает идентификатор нового профиля.
 *
 * @param namedPattern - Шаблон имени файла профиля для подсказки
 * @returns Идентификатор или undefined при отмене
 */
async function askProfileId(namedPattern: string): Promise<string | undefined> {
	const id = await vscode.window.showInputBox({
		title: 'Новый профиль запуска',
		prompt: `Идентификатор профиля → файл ${namedPattern} (например dev, ci, sqlite)`,
		placeHolder: 'dev',
		ignoreFocusOut: true,
		validateInput: (value) => {
			const trimmed = value.trim();
			if (!trimmed) {
				return 'Укажите идентификатор профиля';
			}
			if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
				return 'Допустимы латиница, цифры, точка, дефис и подчёркивание';
			}
			if (parseDotEnvFileName(`${BASE_DOTENV_FILE}.${trimmed}`) !== trimmed) {
				return 'Это имя служебного файла, выберите другое';
			}
			return undefined;
		},
	});
	return id?.trim();
}

/**
 * Открывает файл в редакторе; файла нет — создаёт его с подсказкой формата.
 *
 * @param fullPath - Абсолютный путь файла окружения
 * @returns true, если файл создан
 */
async function openDotEnvFile(fullPath: string): Promise<boolean> {
	const created = !fsSync.existsSync(fullPath);
	if (created) {
		await fs.writeFile(fullPath, NEW_DOTENV_CONTENT, 'utf8');
		log.info(`Создан файл окружения: ${path.basename(fullPath)}`);
	}
	await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath)));
	return created;
}

/**
 * Открывает файл окружения активного профиля: личный, если он есть, иначе общий;
 * файла нет — создаёт общий.
 *
 * @param vrunner - Менеджер vrunner
 */
async function openProfileEnvironment(vrunner: VRunnerManager): Promise<void> {
	const workspaceRoot = vrunner.getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
		return;
	}
	const own = ownDotEnvFiles(vrunner.getActiveEnvProfileId());
	const existing = own.filter((file) => fsSync.existsSync(path.join(workspaceRoot, file))).at(-1);
	if (await openDotEnvFile(path.join(workspaceRoot, existing ?? own[0]))) {
		notifyQuiet(`Создан ${own[0]}`);
	}
}

/**
 * Создаёт профиль из файла окружения `.env.<id>` и делает его активным: так
 * создаётся профиль проекта без vanessa-runner.
 *
 * @param vrunner - Менеджер vrunner
 * @param refresh - Колбэк обновления статус-бара
 */
async function createEnvironmentProfile(vrunner: VRunnerManager, refresh: () => void): Promise<void> {
	const workspaceRoot = vrunner.getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
		return;
	}
	const profileId = await askProfileId(`${BASE_DOTENV_FILE}.<id>`);
	if (profileId === undefined) {
		return;
	}
	const created = await openDotEnvFile(path.join(workspaceRoot, `${BASE_DOTENV_FILE}.${profileId}`));
	await vrunner.setActiveEnvProfileId(profileId);
	refresh();
	notifyQuiet(created ? `Профиль «${profileId}» создан и выбран активным` : `Профиль «${profileId}» выбран активным`);
}

/**
 * Создаёт новый профиль и делает его активным: файл настроек vanessa-runner
 * (env.<id>.json / autumn-properties.<id>.json), у проекта OneScript — файл окружения.
 *
 * @param vrunner - Менеджер vrunner
 * @param refresh - Колбэк обновления статус-бара
 */
async function createProfile(vrunner: VRunnerManager, refresh: () => void): Promise<void> {
	if (!vrunner.usesSettingsFiles()) {
		await createEnvironmentProfile(vrunner, refresh);
		return;
	}
	const workspaceRoot = vrunner.getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
		return;
	}

	await vrunner.getVRunnerVersion();
	const schema = vrunner.getActiveSettingsSchema();
	const profileId = await askProfileId(schema === 'v3' ? 'autumn-properties.<id>.json' : 'env.<id>.json');
	if (profileId === undefined) {
		return;
	}

	const fileName = schema === 'v3' ? `autumn-properties.${profileId}.json` : `env.${profileId}.json`;
	const fullPath = path.join(workspaceRoot, fileName);
	let created = false;
	if (!fsSync.existsSync(fullPath)) {
		// Для 2.x состав секций выбирается флажками; для 3.x — копия базового
		// autumn-properties.json или конвертированный дефолт
		const content = schema === 'v3'
			? await buildNewProfileContent(workspaceRoot, 'v3')
			: await buildEnvJsonWithSections();
		if (content === undefined) {
			return;
		}
		await fs.writeFile(fullPath, content, 'utf8');
		log.info(`Создан профиль запуска: ${fileName}`);
		created = true;
	}
	const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
	await vscode.window.showTextDocument(doc);
	await vrunner.setActiveEnvProfileId(profileId);
	refresh();
	notifyQuiet(created ? `Профиль «${profileId}» создан и выбран активным` : `Профиль «${profileId}» выбран активным`);
}

/** Элемент QuickPick временных параметров */
interface OverrideQuickItem extends vscode.QuickPickItem {
	action: 'field' | 'apply' | 'clear';
	field?: OverrideField;
}

/** Результат одного шага редактирования временных параметров */
interface OverrideStep {
	action: 'field' | 'apply' | 'clear' | 'back' | 'cancel';
	field?: OverrideField;
}

/**
 * Показывает шаг QuickPick временных параметров с нативной кнопкой «Назад» в шапке.
 *
 * @param draft - Текущие значения параметров
 * @param showBack - Показывать ли кнопку «Назад»
 * @returns Выбранное действие
 */
function pickOverrideStep(draft: EnvOverrides, showBack: boolean): Promise<OverrideStep> {
	return new Promise((resolve) => {
		const quickPick = vscode.window.createQuickPick<OverrideQuickItem>();
		quickPick.title = 'Временные параметры запуска';
		quickPick.placeholder = 'Выберите параметр для изменения, затем «Применить»';
		quickPick.ignoreFocusOut = true;
		if (showBack) {
			quickPick.buttons = [vscode.QuickInputButtons.Back];
		}

		const fieldItems: OverrideQuickItem[] = OVERRIDE_FIELDS.map((field) => {
			const value = draft[field.key];
			return {
				label: field.flag.replace(/^--/, ''),
				description: value ? (field.password ? '••••' : value) : '',
				action: 'field',
				field,
			};
		});
		quickPick.items = [
			...fieldItems,
			{ label: '', kind: vscode.QuickPickItemKind.Separator, action: 'apply' },
			{ label: 'Применить', action: 'apply' },
			{ label: 'Сбросить параметры', action: 'clear' },
		];

		let settled = false;
		const finish = (step: OverrideStep): void => {
			if (!settled) {
				settled = true;
				resolve(step);
			}
			quickPick.hide();
		};
		quickPick.onDidTriggerButton((button) => {
			if (button === vscode.QuickInputButtons.Back) {
				finish({ action: 'back' });
			}
		});
		quickPick.onDidAccept(() => {
			const item = quickPick.selectedItems[0];
			finish(item ? { action: item.action, field: item.field } : { action: 'cancel' });
		});
		quickPick.onDidHide(() => {
			if (!settled) {
				settled = true;
				resolve({ action: 'cancel' });
			}
			quickPick.dispose();
		});
		quickPick.show();
	});
}

/**
 * QuickPick-«бланк» временных параметров запуска (поверх активного профиля).
 *
 * Поля видны сразу с текущими значениями; выбор поля открывает ввод; «Применить»
 * сохраняет. Кнопка «Назад» в шапке (при showBack) возвращает в меню профиля.
 *
 * @param vrunner - Менеджер vrunner
 * @param refresh - Колбэк обновления статус-бара
 * @param showBack - Показывать ли в шапке кнопку «Назад»
 * @returns true, если нужно вернуться в меню профиля
 */
async function editOverrides(
	vrunner: VRunnerManager,
	refresh: () => void,
	showBack = false
): Promise<boolean> {
	const draft: EnvOverrides = { ...(vrunner.getActiveEnvOverrides() ?? {}) };

	for (;;) {
		const step = await pickOverrideStep(draft, showBack);

		if (step.action === 'cancel') {
			return false;
		}
		if (step.action === 'back') {
			return true;
		}
		if (step.action === 'clear') {
			await vrunner.setActiveEnvOverrides(undefined);
			refresh();
			notifyQuiet('Временные параметры сброшены');
			return showBack;
		}
		if (step.action === 'apply') {
			const had = vrunner.hasActiveEnvOverrides();
			await vrunner.setActiveEnvOverrides(draft);
			refresh();
			if (vrunner.hasActiveEnvOverrides()) {
				notifyQuiet('Временные параметры сохранены');
			} else if (had) {
				notifyQuiet('Временные параметры сброшены');
			}
			return showBack;
		}

		const field = step.field;
		if (!field) {
			continue;
		}
		const value = await vscode.window.showInputBox({
			title: field.flag.replace(/^--/, ''),
			prompt: field.prompt,
			value: draft[field.key] ?? '',
			password: field.password,
			ignoreFocusOut: true,
		});
		if (value !== undefined) {
			draft[field.key] = value.trim() || undefined;
		}
	}
}

/**
 * Сбрасывает временные параметры.
 *
 * Результат возвращается в формате StructuredCommandResult: агенту нужен
 * исход операции, а не дефолтное «Выполнено.».
 *
 * @param vrunner - Менеджер vrunner
 * @param refresh - Колбэк обновления статус-бара
 * @returns Результат операции для синхронного вызова
 */
async function clearOverrides(
	vrunner: VRunnerManager,
	refresh: () => void
): Promise<StructuredCommandResult> {
	await vrunner.setActiveEnvOverrides(undefined);
	refresh();
	const message = 'Временные параметры сброшены';
	notifyQuiet(message);
	return { success: true, exitCode: 0, stdout: message, stderr: '' };
}

/**
 * Результат неинтерактивного переключения профиля: совместим со
 * StructuredCommandResult (success/exitCode/stdout/stderr), чтобы MCP-сервер
 * показал агенту текст, а не дефолтное «Выполнено.».
 */
interface SelectProfileResult {
	/** Профиль найден и активирован. */
	success: boolean;
	/** 0 при успехе, 1 при отказе. */
	exitCode: number;
	/** Текст результата для агента. */
	stdout: string;
	/** Текст ошибки (профиль не найден). */
	stderr: string;
	/** id активированного профиля. */
	profileId?: string;
	/** Причина отказа (профиль не найден). */
	error?: string;
	/** Доступные id профилей. */
	available?: string[];
}

/**
 * Неинтерактивное переключение env-профиля по идентификатору, имени файла или подписи.
 *
 * @param vrunner - Менеджер vrunner
 * @param refresh - Колбэк обновления статус-бара
 * @param requested - Запрошенный профиль ('dev', 'env.dev.json', 'По умолчанию')
 * @returns Структурированный результат: success/error и доступные профили
 */
async function selectProfileById(
	vrunner: VRunnerManager,
	refresh: () => void,
	requested: string
): Promise<SelectProfileResult> {
	await vrunner.getVRunnerVersion();
	const profiles = vrunner.discoverEnvProfiles();
	const query = requested.trim().toLowerCase();
	const profile = profiles.find((candidate) =>
		candidate.id.toLowerCase() === query ||
		candidate.fileName.toLowerCase() === query ||
		candidate.label.toLowerCase() === query
	);
	if (!profile) {
		const available = profiles.map((candidate) => candidate.id);
		const error = `Профиль запуска «${requested}» не найден. Доступные профили: ${available.join(', ') || 'нет ни одного'}.`;
		// без тостов: результат уходит агенту в структурированном ответе
		return { success: false, exitCode: 1, stdout: '', stderr: error, error, available };
	}
	await vrunner.setActiveEnvProfileId(profile.id);
	refresh();
	const files = profileFiles(profile, vrunner.usesSettingsFiles());
	return {
		success: true,
		exitCode: 0,
		stdout: `Активирован профиль «${profile.id}»${files ? ` (${files})` : ''}.`,
		stderr: '',
		profileId: profile.id,
	};
}

/**
 * Свои файлы профиля для подписи в списке: файл настроек и файлы окружения.
 *
 * @param profile - Профиль
 * @param usesSettings - Проект читает файлы настроек vanessa-runner
 * @returns Имена файлов через запятую
 */
function profileFiles(profile: EnvProfile, usesSettings: boolean): string {
	return [...(usesSettings && profile.ownSettings ? [profile.fileName] : []), ...profile.envFiles].join(', ');
}

/**
 * Выбор активного профиля и доступ к временным параметрам (главное меню статус-бара).
 *
 * У проекта OneScript файлов настроек vanessa-runner нет: в меню только профили,
 * их окружение и создание профиля.
 *
 * @param vrunner - Менеджер vrunner
 * @param refresh - Колбэк обновления статус-бара
 */
async function selectProfile(vrunner: VRunnerManager, refresh: () => void): Promise<void> {
	interface ProfileItem extends vscode.QuickPickItem {
		action: 'select' | 'create' | 'ensure' | 'editor' | 'environment' | 'params' | 'clear' | 'redetect';
		profileId?: string;
	}

	// профили и подписи зависят от схемы установленного vrunner
	await vrunner.getVRunnerVersion();

	for (;;) {
		const usesSettings = vrunner.usesSettingsFiles();
		const profiles = vrunner.discoverEnvProfiles();
		const activeId = vrunner.getActiveEnvProfileId();
		const hasOverrides = vrunner.hasActiveEnvOverrides();
		const versionLabel = vrunner.getCachedVRunnerVersionLabel();
		const hasBase = profiles.some((profile) => profile.isBase);
		const environmentFiles = vrunner.profileEnvironment().files;

		const items: ProfileItem[] = profiles.map((profile) => ({
			label: `${profile.id === activeId ? '$(check)' : '$(blank)'} ${profile.label}`,
			description: profileFiles(profile, usesSettings),
			action: 'select' as const,
			profileId: profile.id,
		}));
		if (usesSettings && !hasBase) {
			items.unshift({
				label: '$(warning) Создать профиль запуска',
				description: 'не создан, команды заблокированы',
				action: 'ensure',
			});
		}

		items.push({ label: 'Действия', kind: vscode.QuickPickItemKind.Separator, action: 'params' });
		const hasActiveFile = Boolean(activeId) && profiles.some((profile) => profile.id === activeId);
		if (usesSettings && hasActiveFile) {
			items.push({ label: '$(go-to-file) Открыть редактор профиля', description: vrunner.getActiveEnvFile(), action: 'editor' });
		}
		items.push({
			label: '$(symbol-variable) Окружение профиля',
			description: environmentFiles.length > 0 ? environmentFiles.join(', ') : 'не задано',
			action: 'environment',
		});
		if (usesSettings) {
			items.push({ label: '$(settings-gear) Временные параметры', description: hasOverrides ? 'заданы' : 'не заданы', action: 'params' });
			if (hasOverrides) {
				items.push({ label: '$(clear-all) Сбросить параметры', action: 'clear' });
			}
		}
		items.push({ label: '$(add) Создать профиль…', action: 'create' });
		if (usesSettings) {
			items.push({ label: '$(refresh) Определить версию', description: versionLabel, action: 'redetect' });
		}

		const picked = await vscode.window.showQuickPick(items, {
			title: '1С: Профиль запуска',
			placeHolder: 'Выберите профиль запуска',
			ignoreFocusOut: true,
		});
		if (!picked) {
			return;
		}

		switch (picked.action) {
			case 'select':
				await vrunner.setActiveEnvProfileId(picked.profileId ?? '');
				refresh();
				return;
			case 'create':
				await createProfile(vrunner, refresh);
				return;
			case 'ensure':
				await vscode.commands.executeCommand('1c-platform-tools.serviceFiles.ensure', 'launchProfile');
				refresh();
				return;
			case 'editor':
				await vscode.commands.executeCommand('1c-platform-tools.env.openProfileEditor');
				return;
			case 'environment':
				await openProfileEnvironment(vrunner);
				return;
			case 'redetect':
				await vscode.commands.executeCommand('1c-platform-tools.env.refreshVersion');
				continue;
			case 'params':
				if (await editOverrides(vrunner, refresh, true)) {
					continue;
				}
				return;
			case 'clear':
				await clearOverrides(vrunner, refresh);
				continue;
		}
	}
}

/**
 * Регистрирует фичу профилей запуска: статус-бар и команды.
 *
 * @param context - Контекст расширения
 * @param isProjectRef - Изменяемая ссылка на признак проекта 1С
 * @returns Массив Disposable
 */
export function registerLaunchFeature(
	context: vscode.ExtensionContext,
	isProjectRef: ProjectRef
): vscode.Disposable[] {
	const vrunner = VRunnerManager.getInstance(context);
	// Строка состояния показывает профиль выбранного проекта, а не проекта вызова
	const refresh = () => outsideProject(() => refreshEnvProfileStatusBar(profileStatusVisible(vrunner)));

	ensureEnvProfileStatusBar();
	refresh();

	const disposables: vscode.Disposable[] = [
		vscode.commands.registerCommand('1c-platform-tools.env.selectProfile', inCurrentProject((profileId?: unknown) => {
			// строковый аргумент — неинтерактивный вызов (агент, web-сессия agent-клиента)
			if (typeof profileId === 'string' && profileId.trim() !== '') {
				return selectProfileById(vrunner, refresh, profileId);
			}
			// объект опций (MCP/IPC): имя профиля в поле profile; без него меню не открываем
			if (isAgentOptions(profileId)) {
				const requested = (profileId as { profile?: unknown }).profile;
				if (typeof requested === 'string' && requested.trim() !== '') {
					return selectProfileById(vrunner, refresh, requested);
				}
				const hint = 'Передайте имя профиля: параметр profile (MCP) или строка-аргумент (id, имя файла или подпись).';
				return {
					success: false,
					exitCode: 1,
					stdout: '',
					stderr: hint,
					error: hint,
					available: vrunner.discoverEnvProfiles().map((profile) => profile.id),
				};
			}
			return selectProfile(vrunner, refresh);
		})),
		vscode.commands.registerCommand('1c-platform-tools.env.openProfileEditor', inCurrentProject(async (target?: vscode.Uri) => {
			// Кнопка над открытым файлом передаёт его сам: редактор нужен для него,
			// а не для активного профиля проекта
			if (target instanceof vscode.Uri) {
				await vscode.commands.executeCommand('vscode.openWith', target, '1c-platform-tools.profileEditor');
				return;
			}
			const workspaceRoot = vrunner.getWorkspaceRoot();
			if (!workspaceRoot) {
				vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
				return;
			}
			await vrunner.getVRunnerVersion();
			const fileName = vrunner.getActiveEnvFile();
			const fullPath = path.join(workspaceRoot, fileName);
			if (!fsSync.existsSync(fullPath)) {
				// файла нет — обычный поток создания через служебные файлы
				await vscode.commands.executeCommand('1c-platform-tools.serviceFiles.ensure', 'launchProfile');
				return;
			}
			await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(fullPath), '1c-platform-tools.profileEditor');
		})),
		vscode.commands.registerCommand('1c-platform-tools.env.status', inCurrentProject(async () => {
			// read-only состояние окружения запуска: без окон, доступно агенту
			await vrunner.getVRunnerVersion();
			const workspaceRoot = vrunner.getWorkspaceRoot();
			const settingsFile = vrunner.getActiveEnvFile();
			const settingsFileExists = workspaceRoot
				? fsSync.existsSync(path.isAbsolute(settingsFile) ? settingsFile : path.join(workspaceRoot, settingsFile))
				: false;
			const overrides = vrunner.getActiveEnvOverrides();
			const localOverrides = vrunner.readLocalEnvOverrides();
			const effectiveOverrides = vrunner.getEffectiveEnvOverrides();
			const maskPwd = (value: EnvOverrides | undefined) =>
				value ? { ...value, dbPwd: value.dbPwd ? '••••' : undefined } : null;
			const profile = vrunner.launchProfileSummary();
			const status = {
				vrunnerVersion: vrunner.getCachedVRunnerVersionLabel() ?? null,
				settingsSchema: vrunner.getActiveSettingsSchema(),
				activeProfileId: profile.id,
				settingsFile,
				settingsFileExists,
				settingsFiles: profile.settingsFiles ?? null,
				// значения не отдаём: в файлах окружения бывают пароли
				environment: { files: profile.environment.files, variables: Object.keys(profile.environment.variables) },
				profileProblem: profile.problem ?? null,
				profiles: vrunner.discoverEnvProfiles().map((candidate) => ({
					id: candidate.id,
					fileName: candidate.fileName,
					label: candidate.label,
					envFiles: candidate.envFiles,
				})),
				overrides: maskPwd(overrides),
				localOverridesFile: localOverrides ? LOCAL_OVERRIDES_FILE : null,
				localOverrides: maskPwd(localOverrides),
				gitBranch: vrunner.getGitBranchDirName() ?? null,
				// уже с подстановкой ${gitBranch} и перекрытиями (UI > env.local.json > профиль)
				effectiveIbConnection: effectiveOverrides?.ibConnection
					?? vrunner.readActiveProfileSettingSync('ibconnection')
					?? null,
				// Запущен ли автономный сервер проекта с OData: без этого агент узнаёт о нём только пробным запросом
				odata: odataStatus(workspaceRoot),
			};
			return {
				success: true,
				exitCode: 0,
				stdout: JSON.stringify(status, null, 2),
				stderr: '',
				status,
			};
		})),
		vscode.commands.registerCommand('1c-platform-tools.env.createProfile', uiOnlyHandler(
			'Имя профиля запрашивается в окне VS Code; профиль создаётся файлом настроек (env.<id>.json, autumn-properties.<id>.json) или окружения (.env.<id>).',
			inCurrentProject(() => createProfile(vrunner, refresh))
		)),
		vscode.commands.registerCommand('1c-platform-tools.env.openEnvironment', uiOnlyHandler(
			'Окружение профиля открывается в редакторе VS Code: переменные лежат в .env и .env.<id> в корне проекта.',
			inCurrentProject(() => openProfileEnvironment(vrunner))
		)),
		vscode.commands.registerCommand('1c-platform-tools.env.setOverrides', uiOnlyHandler(
			'Временные параметры задаются в окнах VS Code; для агента передавайте settingsFile или ibConnection в вызове.',
			inCurrentProject(() => editOverrides(vrunner, refresh))
		)),
		vscode.commands.registerCommand('1c-platform-tools.env.clearOverrides', inCurrentProject(() => clearOverrides(vrunner, refresh))),
		vscode.commands.registerCommand('1c-platform-tools.env.statusBarRefresh', () => refresh()),
		vscode.commands.registerCommand('1c-platform-tools.env.refreshVersion', inCurrentProject(async (): Promise<StructuredCommandResult> => {
			const version = await vrunner.getVRunnerVersion(true);
			refresh();
			const message = version
				? `vanessa-runner: ${version.raw}`
				: 'Версия не определена. Проверьте установку vanessa-runner.';
			if (version) {
				notifyQuiet(message);
			} else {
				void vscode.window.showWarningMessage(message);
			}
			return {
				success: version !== undefined,
				exitCode: version !== undefined ? 0 : 1,
				stdout: version ? message : '',
				stderr: version ? '' : message,
			};
		})),
		vrunner.onDidChangeVRunnerVersion(() => refresh()),
		// Вид проекта известен после обнаружения
		onDidChangeProjects(() => refresh()),
		vscode.window.onDidChangeActiveTextEditor(() => refresh()),
		vscode.workspace.onDidChangeWorkspaceFolders(() => refresh()),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('1c-platform-tools.env.defaultProfile')) {
				refresh();
			}
		}),
		{ dispose: disposeEnvProfileStatusBar },
	];

	// Наблюдатель файлов смотрит в текущий проект и пересоздаётся при его смене
	let projectWatch: vscode.Disposable | undefined;
	const watchProject = (root: string | undefined): void => {
		projectWatch?.dispose();
		projectWatch = root === undefined ? undefined : watchProjectFiles(root, vrunner, isProjectRef, refresh);
	};
	watchProject(currentRoot());

	disposables.push(
		vrunner.watchVRunnerInstallation(),
		onDidChangeCurrentProject((change) => {
			watchProject(change.current);
			refresh();
			void vrunner.getVRunnerVersion();
		}),
		new vscode.Disposable(() => projectWatch?.dispose())
	);

	return disposables;
}

/**
 * Следит за профилями и служебными файлами проекта: создание и удаление обновляют
 * строку состояния и дерево, `.git/HEAD` обновляет значения с `${gitBranch}`.
 *
 * @param root - Корень проекта
 * @param vrunner - Менеджер vrunner
 * @param isProjectRef - Изменяемая ссылка на признак проекта 1С
 * @param refresh - Обновление строки состояния
 */
function watchProjectFiles(
	root: string,
	vrunner: VRunnerManager,
	isProjectRef: ProjectRef,
	refresh: () => void
): vscode.Disposable {
	const watcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(
			root,
			'{env*.json,autumn-properties*.json,.env,.env.*,.gitignore,.gitattributes,tools/**,.1cpt/**,.git/HEAD}'
		)
	);
	const onFsChange = () => {
		refresh();
		// Вне проекта 1С дерева нет, а команда обновления ответила бы уведомлением на каждую смену ветки
		if (isProjectRef.current) {
			void vscode.commands.executeCommand('1c-platform-tools.tools.refresh', { silent: true }).then(undefined, () => undefined);
		}
	};
	// Удалили файл активного именованного профиля — возвращаемся к базовому
	const onFsDelete = () => runWithProject(root, async () => {
		const activeId = vrunner.getActiveEnvProfileId();
		if (activeId !== DEFAULT_PROFILE_ID && !vrunner.discoverEnvProfiles().some((profile) => profile.id === activeId)) {
			await vrunner.setActiveEnvProfileId(DEFAULT_PROFILE_ID);
		}
		onFsChange();
	});
	// Предложение про .gitignore — только при появлении файла в открытом окне:
	// для давно существующего файла тост при каждом запуске был бы навязчивым
	const onFsCreate = (uri: vscode.Uri) => {
		onFsChange();
		if (isProjectRef.current && path.basename(uri.fsPath) === LOCAL_OVERRIDES_FILE) {
			void suggestGitignoreForLocalOverrides(root);
		}
	};
	return vscode.Disposable.from(
		watcher,
		watcher.onDidCreate(onFsCreate),
		watcher.onDidChange(onFsChange),
		watcher.onDidDelete(() => void onFsDelete())
	);
}

/**
 * Состояние стандартного интерфейса OData автономного сервера для env_status.
 *
 * @param workspaceRoot - Корень проекта
 * @returns Адрес интерфейса, если сервер проекта запущен с OData, иначе причина
 */
function odataStatus(workspaceRoot: string | undefined): { serviceRoot: string | null; problem: string | null } {
	const endpoint = resolveODataEndpoint(workspaceRoot);
	return 'problem' in endpoint
		? { serviceRoot: null, problem: endpoint.problem }
		: { serviceRoot: endpoint.serviceRoot, problem: null };
}
