/**
 * Профили запуска 1С и временные параметры.
 *
 * Статус-бар активного профиля открывает выбор профиля. Временные параметры
 * (адрес ИБ, пользователь, пароль, версия платформы, доп. параметры) задаются
 * через QuickPick и применяются ко всем командам vanessa-runner поверх профиля.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { EnvOverrides, DEFAULT_PROFILE_ID, SettingsSchema, baseSettingsFileName } from '../../shared/envProfiles';
import { logger } from '../../shared/logger';
import { ENV_DEFAULTS, AUTUMN_DEFAULTS } from '../serviceFiles/envDefaults';
import { buildEnvJsonWithSections } from '../serviceFiles/envJsonBuilder';
import {
	ensureEnvProfileStatusBar,
	refreshEnvProfileStatusBar,
	disposeEnvProfileStatusBar,
} from './envProfileStatusBar';

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

/**
 * Открывает env-файл в редакторе, создавая его при отсутствии.
 *
 * @param vrunner - Менеджер vrunner
 * @param fileName - Имя файла относительно корня (например 'env.dev.json')
 */
async function openEnvFile(vrunner: VRunnerManager, fileName: string): Promise<void> {
	const workspaceRoot = vrunner.getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
		return;
	}
	const fullPath = path.join(workspaceRoot, fileName);
	if (!fsSync.existsSync(fullPath)) {
		await fs.writeFile(fullPath, await buildNewProfileContent(workspaceRoot, vrunner.getActiveSettingsSchema()), 'utf8');
		log.info(`Создан файл профиля: ${fileName}`);
	}
	const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
	await vscode.window.showTextDocument(doc);
}

/**
 * Создаёт новый env-профиль (env.<id>.json) и делает его активным.
 *
 * @param vrunner - Менеджер vrunner
 * @param refresh - Колбэк обновления статус-бара
 */
async function createProfile(vrunner: VRunnerManager, refresh: () => void): Promise<void> {
	const workspaceRoot = vrunner.getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
		return;
	}

	await vrunner.getVRunnerVersion();
	const schema = vrunner.getActiveSettingsSchema();
	const namedPattern = schema === 'v3' ? 'autumn-properties.<id>.json' : 'env.<id>.json';
	const id = await vscode.window.showInputBox({
		title: 'Новый профиль запуска',
		prompt: `Идентификатор профиля → файл ${namedPattern} (например dev, prod, local)`,
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
			return undefined;
		},
	});
	if (id === undefined) {
		return;
	}

	const profileId = id.trim();
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
	vscode.window.showInformationMessage(
		created ? `Профиль «${profileId}» создан и выбран активным.` : `Профиль «${profileId}» выбран активным.`
	);
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
			vscode.window.showInformationMessage('Временные параметры сброшены.');
			return showBack;
		}
		if (step.action === 'apply') {
			await vrunner.setActiveEnvOverrides(draft);
			refresh();
			vscode.window.showInformationMessage(
				vrunner.hasActiveEnvOverrides()
					? 'Временные параметры сохранены.'
					: 'Временные параметры не заданы.'
			);
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
 * @param vrunner - Менеджер vrunner
 * @param refresh - Колбэк обновления статус-бара
 */
async function clearOverrides(vrunner: VRunnerManager, refresh: () => void): Promise<void> {
	await vrunner.setActiveEnvOverrides(undefined);
	refresh();
	vscode.window.showInformationMessage('Временные параметры запуска сброшены.');
}

/** Результат неинтерактивного переключения профиля (возвращается агенту). */
interface SelectProfileResult {
	/** Профиль найден и активирован. */
	success: boolean;
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
		vscode.window.showErrorMessage(error);
		return { success: false, error, available };
	}
	await vrunner.setActiveEnvProfileId(profile.id);
	refresh();
	return { success: true, profileId: profile.id };
}

/**
 * Выбор активного env-профиля и доступ к временным параметрам (главное меню статус-бара).
 *
 * @param vrunner - Менеджер vrunner
 * @param refresh - Колбэк обновления статус-бара
 */
async function selectProfile(vrunner: VRunnerManager, refresh: () => void): Promise<void> {
	interface ProfileItem extends vscode.QuickPickItem {
		action: 'select' | 'create' | 'ensure' | 'editor' | 'params' | 'clear' | 'redetect';
		profileId?: string;
	}

	// профили и подписи зависят от схемы установленного vrunner
	await vrunner.getVRunnerVersion();

	for (;;) {
		const profiles = vrunner.discoverEnvProfiles();
		const activeId = vrunner.getActiveEnvProfileId();
		const hasOverrides = vrunner.hasActiveEnvOverrides();
		const versionLabel = vrunner.getCachedVRunnerVersionLabel();
		const hasBase = profiles.some((profile) => profile.isBase);

		const items: ProfileItem[] = profiles.map((profile) => ({
			label: `${profile.id === activeId ? '$(check)' : '$(blank)'} ${profile.label}`,
			description: profile.fileName,
			action: 'select' as const,
			profileId: profile.id,
		}));
		if (!hasBase) {
			items.unshift({
				label: '$(warning) Создать профиль запуска',
				description: 'не создан, команды заблокированы',
				action: 'ensure',
			});
		}

		items.push({ label: 'Действия', kind: vscode.QuickPickItemKind.Separator, action: 'params' });
		const hasActiveFile = Boolean(activeId) && profiles.some((profile) => profile.id === activeId);
		if (hasActiveFile) {
			items.push({ label: '$(go-to-file) Открыть редактор профиля', description: vrunner.getActiveEnvFile(), action: 'editor' });
		}
		items.push({ label: '$(settings-gear) Временные параметры', description: hasOverrides ? 'заданы' : 'не заданы', action: 'params' });
		if (hasOverrides) {
			items.push({ label: '$(clear-all) Сбросить параметры', action: 'clear' });
		}
		items.push(
			{ label: '$(add) Создать профиль…', action: 'create' },
			{ label: '$(refresh) Определить версию заново', description: versionLabel, action: 'redetect' }
		);

		const picked = await vscode.window.showQuickPick(items, {
			title: 'Профиль запуска 1С',
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
				await vscode.commands.executeCommand('1c-platform-tools.profile.openEditor');
				return;
			case 'redetect':
				await vscode.commands.executeCommand('1c-platform-tools.vrunner.refreshVersion');
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
	const refresh = () => refreshEnvProfileStatusBar(isProjectRef.current);

	ensureEnvProfileStatusBar();
	refresh();

	const disposables: vscode.Disposable[] = [
		vscode.commands.registerCommand('1c-platform-tools.env.selectProfile', (profileId?: unknown) => {
			// строковый аргумент — неинтерактивный вызов (агент, web-сессия agent-клиента)
			if (typeof profileId === 'string' && profileId.trim() !== '') {
				return selectProfileById(vrunner, refresh, profileId);
			}
			return selectProfile(vrunner, refresh);
		}),
		vscode.commands.registerCommand('1c-platform-tools.profile.openEditor', async () => {
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
		}),
		vscode.commands.registerCommand('1c-platform-tools.env.createProfile', () => createProfile(vrunner, refresh)),
		vscode.commands.registerCommand('1c-platform-tools.env.setOverrides', () => editOverrides(vrunner, refresh)),
		vscode.commands.registerCommand('1c-platform-tools.env.clearOverrides', () => clearOverrides(vrunner, refresh)),
		vscode.commands.registerCommand('1c-platform-tools.env.statusBarRefresh', () => refresh()),
		vscode.commands.registerCommand('1c-platform-tools.vrunner.refreshVersion', async () => {
			const version = await vrunner.getVRunnerVersion(true);
			refresh();
			vscode.window.showInformationMessage(
				version
					? `vanessa-runner: ${version.raw}`
					: 'Версия не определена. Проверьте установку vanessa-runner.'
			);
		}),
		vrunner.onDidChangeVRunnerVersion(() => refresh()),
		vrunner.watchVRunnerInstallation(),
		vscode.workspace.onDidChangeWorkspaceFolders(() => refresh()),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('1c-platform-tools.defaultEnvProfile')) {
				refresh();
			}
		}),
		{ dispose: disposeEnvProfileStatusBar },
	];

	// Создание/удаление env-профилей и служебных файлов → обновляем статус-бар и дерево
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (workspaceFolder) {
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(workspaceFolder, '{env*.json,.gitignore,.gitattributes,tools/**}')
		);
		const onFsChange = () => {
			refresh();
			void vscode.commands.executeCommand('1c-platform-tools.refresh').then(undefined, () => undefined);
		};
		// Удалили файл активного именованного профиля — возвращаемся к базовому
		const onFsDelete = async () => {
			const activeId = vrunner.getActiveEnvProfileId();
			if (activeId !== DEFAULT_PROFILE_ID && !vrunner.discoverEnvProfiles().some((profile) => profile.id === activeId)) {
				await vrunner.setActiveEnvProfileId(DEFAULT_PROFILE_ID);
			}
			onFsChange();
		};
		watcher.onDidCreate(onFsChange);
		watcher.onDidDelete(() => void onFsDelete());
		disposables.push(watcher);
	}

	return disposables;
}
