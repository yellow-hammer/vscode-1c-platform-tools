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
import { EnvOverrides, NOT_SELECTED_LABEL } from '../../shared/envProfiles';
import { logger } from '../../shared/logger';
import { readTemplate } from '../serviceFiles/templates';
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

/** Скелет нового env-файла, если базового env.json ещё нет */
const ENV_SKELETON = {
	$schema:
		'https://raw.githubusercontent.com/vanessa-opensource/vanessa-runner/develop/vanessa-runner-schema.json',
	default: {
		'--ibconnection': '/F./build/ib',
		'--db-user': '',
		'--db-pwd': '',
		'--v8version': '8.3',
		'--locale': 'ru',
		'--language': 'ru',
	},
};

/**
 * Содержимое для нового env-файла: копия базового env.json, шаблон или скелет.
 *
 * @param workspaceRoot - Корень рабочей области
 * @param extensionPath - Путь к ресурсам расширения (для шаблона)
 * @returns Текст файла (JSON)
 */
async function buildNewEnvContent(workspaceRoot: string, extensionPath: string | undefined): Promise<string> {
	const basePath = path.join(workspaceRoot, 'env.json');
	try {
		const base = await fs.readFile(basePath, 'utf8');
		JSON.parse(base); // валидируем, что это корректный JSON
		return base;
	} catch {
		// базового env.json нет — берём шаблон расширения
	}
	if (extensionPath) {
		try {
			return await readTemplate(extensionPath, 'env.json.template');
		} catch {
			// шаблон недоступен — используем встроенный скелет
		}
	}
	return JSON.stringify(ENV_SKELETON, null, 2);
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
		await fs.writeFile(fullPath, await buildNewEnvContent(workspaceRoot, vrunner.getExtensionPath()), 'utf8');
		log.info(`Создан env-файл: ${fileName}`);
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

	const id = await vscode.window.showInputBox({
		title: 'Новый env-профиль',
		prompt: 'Идентификатор профиля → файл env.<id>.json (например dev, prod, local)',
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
	const fullPath = path.join(workspaceRoot, `env.${profileId}.json`);
	let created = false;
	if (!fsSync.existsSync(fullPath)) {
		const content = await buildEnvJsonWithSections(vrunner.getExtensionPath());
		if (content === undefined) {
			return;
		}
		await fs.writeFile(fullPath, content, 'utf8');
		log.info(`Создан env-профиль: env.${profileId}.json`);
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

/**
 * Выбор активного env-профиля и доступ к временным параметрам (главное меню статус-бара).
 *
 * @param vrunner - Менеджер vrunner
 * @param refresh - Колбэк обновления статус-бара
 */
async function selectProfile(vrunner: VRunnerManager, refresh: () => void): Promise<void> {
	interface ProfileItem extends vscode.QuickPickItem {
		action: 'select' | 'create' | 'open' | 'params' | 'clear';
		profileId?: string;
	}

	for (;;) {
		const profiles = vrunner.discoverEnvProfiles();
		const activeId = vrunner.getActiveEnvProfileId();
		const hasOverrides = vrunner.hasActiveEnvOverrides();

		const items: ProfileItem[] = [
			{
				label: `${!activeId ? '$(check)' : '$(blank)'} ${NOT_SELECTED_LABEL}`,
				action: 'select',
				profileId: '',
			},
			...profiles.map((profile) => ({
				label: `${profile.id === activeId ? '$(check)' : '$(blank)'} ${profile.label}`,
				description: profile.fileName,
				action: 'select' as const,
				profileId: profile.id,
			})),
		];
		items.push(
			{ label: '', kind: vscode.QuickPickItemKind.Separator, action: 'params' },
			{ label: '$(edit) Временные параметры', description: hasOverrides ? 'заданы' : 'не заданы', action: 'params' }
		);
		if (hasOverrides) {
			items.push({ label: '$(clear-all) Сбросить параметры', action: 'clear' });
		}
		items.push({ label: '$(add) Создать профиль…', action: 'create' });
		const hasActiveFile = Boolean(activeId) && profiles.some((profile) => profile.id === activeId);
		if (hasActiveFile) {
			items.push({ label: '$(go-to-file) Открыть файл активного профиля', action: 'open' });
		}

		const picked = await vscode.window.showQuickPick(items, {
			title: 'Профиль запуска 1С',
			placeHolder: 'Профиль подставляется во все команды vanessa-runner через --settings',
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
			case 'open':
				await openEnvFile(vrunner, vrunner.getActiveEnvFile());
				return;
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
		vscode.commands.registerCommand('1c-platform-tools.env.selectProfile', () => selectProfile(vrunner, refresh)),
		vscode.commands.registerCommand('1c-platform-tools.env.createProfile', () => createProfile(vrunner, refresh)),
		vscode.commands.registerCommand('1c-platform-tools.env.setOverrides', () => editOverrides(vrunner, refresh)),
		vscode.commands.registerCommand('1c-platform-tools.env.clearOverrides', () => clearOverrides(vrunner, refresh)),
		vscode.commands.registerCommand('1c-platform-tools.env.statusBarRefresh', () => refresh()),
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
		// Если удалили файл активного профиля — сбрасываем выбор на «Не выбран»
		const onFsDelete = async () => {
			const activeId = vrunner.getActiveEnvProfileId();
			if (activeId && !vrunner.discoverEnvProfiles().some((profile) => profile.id === activeId)) {
				await vrunner.setActiveEnvProfileId('');
			}
			onFsChange();
		};
		watcher.onDidCreate(onFsChange);
		watcher.onDidDelete(() => void onFsDelete());
		disposables.push(watcher);
	}

	return disposables;
}
