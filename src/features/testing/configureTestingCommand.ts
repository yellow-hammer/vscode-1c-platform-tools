import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { logger } from '../../shared/logger';
import { DEFAULT_TESTING } from '../../shared/pathDefaults';

const log = logger.scope('testing');

/**
 * Описание фреймворка в визарде конфигурации
 */
interface FrameworkPick extends vscode.QuickPickItem {
	/** Ключ настройки testing.frameworks.<key> */
	key: 'vanessa' | 'xunit' | 'yaxunit' | 'onescript' | 'onebdd';
	/** Значение по умолчанию */
	defaultEnabled: boolean;
	/** Каталог фреймворка (относительно корня), создаётся при необходимости */
	dir?: string;
}

/**
 * Регистрирует команду «Настроить тесты» (1c-platform-tools.testing.configure)
 *
 * Визард в духе «Configure Python Tests»: выбор фреймворков проекта
 * (мультивыбор с текущим состоянием), запись настроек workspace и создание
 * недостающих каталогов. Дерево тестов пересобирается автоматически
 * по событию изменения настроек testing.*.
 *
 * Команда вызывается также из welcome-содержимого панели тестирования,
 * когда тесты ещё не найдены.
 */
export function registerConfigureTestingCommand(vrunner: VRunnerManager): vscode.Disposable {
	return vscode.commands.registerCommand('1c-platform-tools.testing.configure', async () => {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const featuresPath = config.get<string>('testing.featuresPath', DEFAULT_TESTING.featuresPath);
		const onescriptPath = config.get<string>('testing.onescriptTestsPath', DEFAULT_TESTING.onescriptTestsPath);

		const frameworks: FrameworkPick[] = [
			{
				key: 'vanessa',
				label: 'Vanessa Automation',
				description: `сценарии .feature в ${featuresPath} (нужны исходники конфигурации)`,
				defaultEnabled: true,
				dir: featuresPath
			},
			{
				key: 'xunit',
				label: 'xUnit (Vanessa-ADD)',
				description: `тестовые обработки (исходники в ${vrunner.getTestsSrcPath()})`,
				defaultEnabled: true,
				dir: vrunner.getTestsSrcPath()
			},
			{
				key: 'yaxunit',
				label: 'YAxUnit',
				description: 'модули тестового расширения в каталоге расширений',
				defaultEnabled: true
			},
			{
				key: 'onescript',
				label: 'OneScript (1testrunner / OneUnit)',
				description: `скриптовые тесты .os в ${onescriptPath}`,
				defaultEnabled: true,
				dir: onescriptPath
			},
			{
				key: 'onebdd',
				label: '1bdd',
				description: `сценарии .feature в ${featuresPath} (OneScript-проекты без конфигурации)`,
				defaultEnabled: true
			}
		];

		const picks = frameworks.map((framework) => ({
			...framework,
			picked: config.get<boolean>(`testing.frameworks.${framework.key}`, framework.defaultEnabled)
		}));

		const selected = await vscode.window.showQuickPick(picks, {
			canPickMany: true,
			title: 'Тестовые фреймворки проекта',
			placeHolder: 'Отметьте фреймворки, которые показывать в панели тестирования'
		});
		if (!selected) {
			return;
		}

		const selectedKeys = new Set(selected.map((item) => item.key));
		for (const framework of frameworks) {
			await config.update(
				`testing.frameworks.${framework.key}`,
				selectedKeys.has(framework.key),
				vscode.ConfigurationTarget.Workspace
			);
		}
		if (!config.get<boolean>('testing.enabled', true)) {
			await config.update('testing.enabled', true, vscode.ConfigurationTarget.Workspace);
		}

		// Предлагаем создать недостающие каталоги выбранных фреймворков
		const workspaceRoot = vrunner.getWorkspaceRoot();
		if (workspaceRoot) {
			const missing = frameworks
				.filter((framework) => framework.dir && selectedKeys.has(framework.key))
				.map((framework) => framework.dir as string)
				.filter((dir) => !fsSync.existsSync(path.join(workspaceRoot, normalizeRelative(dir))));

			if (missing.length > 0) {
				const action = await vscode.window.showInformationMessage(
					`Настройки тестирования обновлены. Создать недостающие каталоги: ${missing.join(', ')}?`,
					'Создать',
					'Не сейчас'
				);
				if (action === 'Создать') {
					for (const dir of missing) {
						try {
							await fs.mkdir(path.join(workspaceRoot, normalizeRelative(dir)), { recursive: true });
						} catch (error) {
							log.warn(`Не удалось создать каталог ${dir}: ${(error as Error).message}`);
						}
					}
				}
				return;
			}
		}

		void vscode.window.showInformationMessage('Настройки тестирования обновлены.');
	});
}

/**
 * Убирает ведущие './' для path.join
 */
function normalizeRelative(dir: string): string {
	return dir.replace(/^\.[\\/]/, '');
}
