/**
 * Окружение запуска: выбор, создание и открытие файлов `.env`.
 *
 * Окружение выбирается отдельно от профиля запуска и есть у проекта любого
 * вида. Новый файл окружения сразу перечисляет переменные, которые читает
 * код проекта.
 *
 * @module launch/environmentFeature
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { VRunnerManager } from '../../shared/vrunnerManager';
import {
	BASE_DOTENV_FILE,
	NO_ENVIRONMENT_FILE_LABEL,
	environmentLabel,
	isEnvironmentId,
	newEnvironmentText,
	ownEnvironmentFiles,
} from '../../shared/environments';
import { isAgentOptions, uiOnlyHandler } from '../../shared/agentGate';
import { inCurrentProject } from '../../commands/projectScope';
import { logger } from '../../shared/logger';
import { notifyQuiet } from '../../shared/notify';
import { projectEnvironmentVariables } from './projectEnvironmentVariables';
import type { StructuredCommandResult } from '../../shared/commandExecutionTypes';

const log = logger.scope('launch');

/** Результат неинтерактивного выбора окружения: агенту нужен текст, а не «Выполнено.». */
interface SelectEnvironmentResult extends StructuredCommandResult {
	/** Выбранное окружение; нет — по умолчанию, только общие файлы */
	environmentId?: string;
	/** Доступные окружения, если запрошенного нет */
	available?: string[];
}

/** Создаёт файл окружения с переменными из кода проекта, если его нет. */
async function ensureEnvironmentFile(root: string, fileName: string): Promise<boolean> {
	const fullPath = path.join(root, fileName);
	if (fsSync.existsSync(fullPath)) {
		return false;
	}
	await fs.writeFile(fullPath, newEnvironmentText(await projectEnvironmentVariables(root)), 'utf8');
	log.info(`Создан файл окружения: ${fileName}`);
	return true;
}

/**
 * Открывает свой файл выбранного окружения (по умолчанию — `.env`); файла нет — создаёт его.
 *
 * @param vrunner - Менеджер vrunner
 */
async function openEnvironmentFile(vrunner: VRunnerManager): Promise<void> {
	const root = vrunner.getWorkspaceRoot();
	if (!root) {
		vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
		return;
	}
	const own = ownEnvironmentFiles(vrunner.getActiveEnvironmentId());
	const fileName = own.find((file) => fsSync.existsSync(path.join(root, file))) ?? own[0];
	await ensureEnvironmentFile(root, fileName);
	await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, fileName)));
}

/**
 * Спрашивает имя, создаёт `.env.<имя>` и выбирает это окружение.
 *
 * @param vrunner - Менеджер vrunner
 * @param refresh - Обновление строки состояния
 */
async function createEnvironment(vrunner: VRunnerManager, refresh: () => void): Promise<void> {
	const root = vrunner.getWorkspaceRoot();
	if (!root) {
		vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
		return;
	}
	const input = await vscode.window.showInputBox({
		title: 'Новое окружение',
		prompt: `Имя окружения → файл ${BASE_DOTENV_FILE}.<имя> (например dev, ci)`,
		placeHolder: 'dev',
		ignoreFocusOut: true,
		validateInput: (value) => {
			const trimmed = value.trim();
			if (!trimmed) {
				return 'Укажите имя окружения';
			}
			if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
				return 'Допустимы латиница, цифры, точка, дефис и подчёркивание';
			}
			return isEnvironmentId(trimmed) ? undefined : 'Это имя служебного файла, выберите другое';
		},
	});
	if (input === undefined) {
		return;
	}
	const id = input.trim();
	const fileName = `${BASE_DOTENV_FILE}.${id}`;
	const created = await ensureEnvironmentFile(root, fileName);
	await vrunner.setActiveEnvironmentId(id);
	refresh();
	await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, fileName)));
	notifyQuiet(created ? `Окружение «${id}» создано и выбрано` : `Окружение «${id}» выбрано`);
}

/**
 * Неинтерактивный выбор окружения по имени или имени файла; пустая строка — по умолчанию.
 *
 * @param vrunner - Менеджер vrunner
 * @param refresh - Обновление строки состояния
 * @param requested - Запрошенное окружение ('ci', '.env.ci' или '')
 */
async function selectEnvironmentById(
	vrunner: VRunnerManager,
	refresh: () => void,
	requested: string
): Promise<SelectEnvironmentResult> {
	const query = requested.trim().toLowerCase();
	if (query === '') {
		await vrunner.setActiveEnvironmentId(undefined);
		refresh();
		const { files } = vrunner.activeEnvironment();
		const stdout = files.length > 0
			? `Выбрано окружение по умолчанию (${files.join(', ')}).`
			: `Выбрано окружение по умолчанию: ${NO_ENVIRONMENT_FILE_LABEL.toLowerCase()}.`;
		return { success: true, exitCode: 0, stdout, stderr: '' };
	}
	const environments = vrunner.discoverEnvironments();
	const environment = environments.find((candidate) =>
		candidate.id.toLowerCase() === query || `${BASE_DOTENV_FILE}.${candidate.id}`.toLowerCase() === query
	);
	if (!environment) {
		const available = environments.map((candidate) => candidate.id);
		const error = `Окружение «${requested}» не найдено. Доступные окружения: ${available.join(', ') || 'нет ни одного'}.`;
		// без тостов: результат уходит агенту в структурированном ответе
		return { success: false, exitCode: 1, stdout: '', stderr: error, available };
	}
	await vrunner.setActiveEnvironmentId(environment.id);
	refresh();
	return {
		success: true,
		exitCode: 0,
		stdout: `Выбрано окружение «${environment.id}» (${environment.files.join(', ')}).`,
		stderr: '',
		environmentId: environment.id,
	};
}

/**
 * Выбор окружения (меню строки состояния): окружения проекта, открытие файла и создание.
 *
 * @param vrunner - Менеджер vrunner
 * @param refresh - Обновление строки состояния
 */
async function selectEnvironment(vrunner: VRunnerManager, refresh: () => void): Promise<void> {
	interface EnvironmentItem extends vscode.QuickPickItem {
		action: 'select' | 'open' | 'create';
		environmentId?: string;
	}

	const root = vrunner.getWorkspaceRoot();
	if (!root) {
		vscode.window.showErrorMessage('Откройте рабочую область для работы с проектом');
		return;
	}
	const activeId = vrunner.getActiveEnvironmentId();
	const mark = (selected: boolean) => (selected ? '$(check)' : '$(blank)');
	const baseFiles = ownEnvironmentFiles().filter((file) => fsSync.existsSync(path.join(root, file)));
	const own = ownEnvironmentFiles(activeId);
	const openFile = own.find((file) => fsSync.existsSync(path.join(root, file))) ?? own[0];

	const items: EnvironmentItem[] = [
		{
			label: `${mark(activeId === undefined)} ${environmentLabel(undefined, baseFiles)}`,
			description: baseFiles.join(', '),
			action: 'select',
		},
		...vrunner.discoverEnvironments().map((environment): EnvironmentItem => ({
			label: `${mark(environment.id === activeId)} ${environment.id}`,
			description: environment.files.join(', '),
			action: 'select',
			environmentId: environment.id,
		})),
		{ label: 'Действия', kind: vscode.QuickPickItemKind.Separator, action: 'open' },
		{ label: `$(go-to-file) Открыть ${openFile}`, action: 'open' },
		{ label: '$(add) Создать окружение…', action: 'create' },
	];

	const picked = await vscode.window.showQuickPick(items, {
		title: '1С: Окружение',
		placeHolder: 'Выберите окружение',
		ignoreFocusOut: true,
	});
	if (!picked) {
		return;
	}
	switch (picked.action) {
		case 'select':
			await vrunner.setActiveEnvironmentId(picked.environmentId);
			refresh();
			return;
		case 'open':
			await openEnvironmentFile(vrunner);
			return;
		case 'create':
			await createEnvironment(vrunner, refresh);
			return;
		default: {
			const unknown: never = picked.action;
			throw new Error(`Неизвестное действие меню окружения: ${String(unknown)}`);
		}
	}
}

/**
 * Регистрирует команды окружения запуска.
 *
 * @param vrunner - Менеджер vrunner
 * @param refresh - Обновление строки состояния
 * @returns Disposable команд
 */
export function registerEnvironmentCommands(vrunner: VRunnerManager, refresh: () => void): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('1c-platform-tools.env.selectEnvironment', inCurrentProject((requested?: unknown) => {
			// строковый аргумент — неинтерактивный вызов: имя окружения, пустая строка — по умолчанию
			if (typeof requested === 'string') {
				return selectEnvironmentById(vrunner, refresh, requested);
			}
			// объект опций (MCP/IPC): имя окружения в поле environment; без него меню не открываем
			if (isAgentOptions(requested)) {
				const environment = (requested as { environment?: unknown }).environment;
				if (typeof environment === 'string') {
					return selectEnvironmentById(vrunner, refresh, environment);
				}
				const hint = 'Передайте имя окружения: параметр environment (MCP) или строка-аргумент; пустая строка — по умолчанию.';
				return {
					success: false,
					exitCode: 1,
					stdout: '',
					stderr: hint,
					available: vrunner.discoverEnvironments().map((environment) => environment.id),
				};
			}
			return selectEnvironment(vrunner, refresh);
		})),
		vscode.commands.registerCommand('1c-platform-tools.env.createEnvironment', uiOnlyHandler(
			'Имя окружения запрашивается в окне VS Code; окружение — файл .env.<имя> в корне проекта.',
			inCurrentProject(() => createEnvironment(vrunner, refresh))
		)),
		vscode.commands.registerCommand('1c-platform-tools.env.openEnvironment', uiOnlyHandler(
			'Файл окружения открывается в редакторе VS Code: переменные лежат в .env и .env.<имя> в корне проекта.',
			inCurrentProject(() => openEnvironmentFile(vrunner))
		)),
	];
}
