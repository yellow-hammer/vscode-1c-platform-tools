/**
 * Команды списка информационных баз: запуск через 1cestart и выбор из палитры.
 *
 * Учётки профиля запуска сюда не подставляются — только имя записи v8i.
 */

import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { infobaseConnectionString, readInfobases, type InfobaseEntry } from '../../shared/infobaseList';
import { readClustersSettings } from '../clusters/settings';
import { launchInfobase, shouldPassIbName, type CestartMode } from './cestart';
import type { IbasesProvider } from './ibasesProvider';
import { IbaseItem } from './nodes';

const log = logger.scope('ibases');

const ENTERPRISE_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('play'),
	tooltip: 'Предприятие',
};

const DESIGNER_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('tools'),
	tooltip: 'Конфигуратор',
};

/** Строка выбора базы в палитре. */
interface IbasePickItem extends vscode.QuickPickItem {
	readonly entry: InfobaseEntry;
}

/**
 * Запускает базу и показывает ошибку, если запуск не удался.
 *
 * @param entry - Запись списка платформы
 * @param mode - Предприятие или Конфигуратор
 * @returns Промис, который разрешается после запуска или отказа
 */
async function runInfobase(entry: InfobaseEntry, mode: CestartMode): Promise<void> {
	const result = launchInfobase(entry.name, mode, {
		extraRoots: [readClustersSettings().platformPath],
		connect: entry.connect,
		useIbName: shouldPassIbName(
			entry.name,
			readInfobases().map((item) => item.name)
		),
	});
	if (result.ok) {
		log.info(`запуск ${mode} «${entry.name}»: ${result.binary} ${result.args.join(' ')}`);
		return;
	}
	log.warn(result.message);
	const openSettings = result.message.includes('1cestart');
	const choice = openSettings
		? await vscode.window.showErrorMessage(result.message, 'Настройки')
		: await vscode.window.showErrorMessage(result.message);
	if (choice === 'Настройки') {
		await vscode.commands.executeCommand('1c-platform-tools.clusters.openSettings');
	}
}

/**
 * Берёт запись базы из узла дерева.
 *
 * @param node - Аргумент команды
 * @returns Запись или undefined
 */
function ibaseEntryFrom(node: unknown): InfobaseEntry | undefined {
	return node instanceof IbaseItem ? node.entry : undefined;
}

/**
 * Собирает строки QuickPick из текущего списка платформы.
 *
 * @returns Элементы выбора
 */
function pickItems(): IbasePickItem[] {
	return readInfobases()
		.map((entry) => ({
			label: entry.name,
			description: infobaseConnectionString(entry.connect),
			detail: entry.folder === '/' ? undefined : entry.folder,
			buttons: [ENTERPRISE_BUTTON, DESIGNER_BUTTON],
			entry,
		}))
		.sort(
			(left, right) =>
				(left.detail ?? '').localeCompare(right.detail ?? '', 'ru') ||
				left.label.localeCompare(right.label, 'ru')
		);
}

/**
 * Показывает список баз в палитре и запускает выбранную.
 *
 * Enter и кнопка «Предприятие» открывают Предприятие, кнопка «Конфигуратор» —
 * Конфигуратор.
 *
 * @returns Промис, который разрешается, когда окно выбора закрыто
 */
async function showInfobaseList(): Promise<void> {
	const items = pickItems();
	if (items.length === 0) {
		void vscode.window.showInformationMessage('В списке информационных баз 1С нет ни одной базы.');
		return;
	}

	const pick = vscode.window.createQuickPick<IbasePickItem>();
	pick.title = 'Информационные базы 1С';
	pick.placeholder = 'База для запуска';
	pick.matchOnDescription = true;
	pick.matchOnDetail = true;
	pick.items = items;

	const finished = new Promise<void>((resolve) => {
		const done = (): void => {
			pick.dispose();
			resolve();
		};
		pick.onDidTriggerItemButton((event) => {
			const mode: CestartMode = event.button.tooltip === DESIGNER_BUTTON.tooltip ? 'DESIGNER' : 'ENTERPRISE';
			pick.hide();
			void runInfobase(event.item.entry, mode);
		});
		pick.onDidAccept(() => {
			const chosen = pick.selectedItems[0];
			pick.hide();
			if (chosen) {
				void runInfobase(chosen.entry, 'ENTERPRISE');
			}
		});
		pick.onDidHide(() => {
			done();
		});
	});

	pick.show();
	await finished;
}

/**
 * Регистрирует команды списка информационных баз.
 *
 * @param provider - Дерево списка
 * @returns Подписки команд
 */
export function registerIbasesCommands(provider: IbasesProvider): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('1c-platform-tools.ibases.refresh', () => {
			provider.refresh();
		}),
		vscode.commands.registerCommand('1c-platform-tools.ibases.list', () => showInfobaseList()),
		vscode.commands.registerCommand('1c-platform-tools.ibases.launchEnterprise', async (node: unknown) => {
			const entry = ibaseEntryFrom(node);
			if (!entry) {
				return;
			}
			await runInfobase(entry, 'ENTERPRISE');
		}),
		vscode.commands.registerCommand('1c-platform-tools.ibases.launchDesigner', async (node: unknown) => {
			const entry = ibaseEntryFrom(node);
			if (!entry) {
				return;
			}
			await runInfobase(entry, 'DESIGNER');
		}),
	];
}
