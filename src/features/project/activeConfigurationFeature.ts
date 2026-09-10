/**
 * Выбор конфигурации, с которой работают команды и панели.
 *
 * Элемент статусной строки показывается, когда конфигураций в рабочей области
 * больше одной: пока она одна, выбирать не из чего.
 * @module activeConfigurationFeature
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { logger } from '../../shared/logger';
import { onDidChangeProjectLayout } from '../../shared/projectLayoutWatch';
import {
	configurationScope,
	initActiveConfiguration,
	onDidChangeActiveConfiguration,
	setActiveConfiguration,
	type ConfigurationScope,
} from '../../shared/activeConfiguration';
import type { SourceRoot } from '../../shared/projectLayout';

const log = logger.scope('проект');

/** Подписи форматов исходного кода. */
const FORMAT_LABELS: Record<SourceRoot['format'], string> = {
	designer: 'Конфигуратор',
	edt: 'EDT',
};

/**
 * Настройки путей проекта: пока они есть, раскладка учитывает их.
 */
function layoutPaths(vrunner: VRunnerManager): { configuration: string; extensions: string[] } {
	return {
		configuration: vrunner.getCfPath(),
		extensions: [vrunner.getCfePath(), vrunner.getTestsCfePath()],
	};
}

/** Область работы для текущей рабочей области. */
async function currentScope(): Promise<{ root: string; scope: ConfigurationScope } | undefined> {
	const vrunner = VRunnerManager.getInstance();
	const root = vrunner.getWorkspaceRoot();
	if (!root) {
		return undefined;
	}
	return { root, scope: await configurationScope(root, layoutPaths(vrunner)) };
}

/** Название конфигурации для списка и статусной строки. */
function configurationLabel(root: SourceRoot): string {
	return root.name || path.basename(root.dir);
}

/**
 * Спрашивает, с какой конфигурацией работать.
 */
async function selectConfiguration(): Promise<void> {
	const current = await currentScope();
	const active = current?.scope.configuration;
	if (!current || !active) {
		void vscode.window.showInformationMessage('В рабочей области нет исходного кода конфигурации.');
		return;
	}

	const { root, scope } = current;
	const items = [active, ...scope.others].map((configuration) => ({
		label: `${configuration.dir === active.dir ? '$(check) ' : ''}${configurationLabel(configuration)}`,
		description: FORMAT_LABELS[configuration.format],
		detail: path.relative(root, configuration.dir) || '.',
		configuration,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		title: 'Конфигурация проекта',
		placeHolder: 'С какой конфигурацией работают команды и панели',
	});
	if (!picked) {
		return;
	}

	await setActiveConfiguration(picked.configuration.dir);
	log.info(`Активная конфигурация: ${configurationLabel(picked.configuration)}`);
}

/**
 * Обновляет статусную строку по текущей раскладке.
 */
async function refreshStatusBar(item: vscode.StatusBarItem, visible: boolean): Promise<void> {
	if (!visible) {
		item.hide();
		return;
	}

	const current = await currentScope();
	const configuration = current?.scope.configuration;
	if (!configuration || current.scope.others.length === 0) {
		item.hide();
		return;
	}

	item.text = `$(symbol-namespace) ${configurationLabel(configuration)}`;
	item.tooltip = `Конфигурация проекта: ${FORMAT_LABELS[configuration.format]}\n${configuration.dir}`;
	item.show();
}

/** Изменяемая ссылка на признак проекта 1С. */
interface ProjectRef {
	current: boolean;
}

/**
 * Подключает выбор конфигурации: команду и статусную строку.
 *
 * @param context - Контекст расширения
 * @param isProjectRef - Изменяемая ссылка на признак проекта 1С
 * @returns Подписки фичи
 */
export function registerActiveConfigurationFeature(
	context: vscode.ExtensionContext,
	isProjectRef: ProjectRef
): vscode.Disposable[] {
	initActiveConfiguration(context);

	const item = vscode.window.createStatusBarItem(
		'1c-platform-tools.project.configuration',
		vscode.StatusBarAlignment.Left,
		3
	);
	item.name = 'Конфигурация проекта 1С';
	item.command = '1c-platform-tools.project.selectConfiguration';

	const refresh = () => {
		void refreshStatusBar(item, isProjectRef.current).catch((error: unknown) => {
			log.error(`Статусная строка конфигурации: ${(error as Error).message}`);
		});
	};
	refresh();

	return [
		item,
		vscode.commands.registerCommand('1c-platform-tools.project.selectConfiguration', selectConfiguration),
		onDidChangeActiveConfiguration(refresh),
		onDidChangeProjectLayout(refresh),
	];
}
