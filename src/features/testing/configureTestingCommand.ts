import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { logger } from '../../shared/logger';
import { DEFAULT_TESTING } from '../../shared/pathDefaults';
import type { StructuredCommandResult } from '../../shared/commandExecutionTypes';

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
 * Опции неинтерактивного вызова команды настройки тестов (агент, MCP).
 */
interface ConfigureTestingOptions {
	/** При true — синхронный режим со структурированным результатом. */
	wait?: boolean;
	/** Ключи включаемых фреймворков; остальные выключаются. */
	frameworks?: string[];
}

/**
 * Строит структурированный результат для синхронного режима.
 */
function configureResult(success: boolean, message: string): StructuredCommandResult {
	return {
		success,
		exitCode: success ? 0 : 1,
		stdout: success ? message : '',
		stderr: success ? '' : message,
	};
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
 *
 * Неинтерактивный режим: первым аргументом принимает объект с ключами
 * `frameworks` (список включаемых фреймворков) и `wait`. С `frameworks`
 * визард не показывается, недостающие каталоги создаются без подтверждения;
 * с `wait: true` возвращается StructuredCommandResult.
 */
export function registerConfigureTestingCommand(vrunner: VRunnerManager): vscode.Disposable {
	return vscode.commands.registerCommand('1c-platform-tools.testing.configure', async (arg?: unknown) => {
		const opts: ConfigureTestingOptions | undefined =
			typeof arg === 'object' && arg !== null ? (arg as ConfigureTestingOptions) : undefined;
		const wait = opts?.wait === true;

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

		// список фреймворков в опциях — неинтерактивный вызов (агент, MCP)
		let selectedKeys: Set<string>;
		const nonInteractive = Array.isArray(opts?.frameworks);
		if (nonInteractive) {
			const knownKeys = new Set<string>(frameworks.map((framework) => framework.key));
			const requested = (opts?.frameworks ?? []).map((key) => String(key).trim().toLowerCase());
			const invalid = requested.filter((key) => !knownKeys.has(key));
			if (invalid.length > 0) {
				const message = `Неизвестные фреймворки: ${invalid.join(', ')}. Доступные: ${[...knownKeys].join(', ')}.`;
				if (wait) {
					return configureResult(false, message);
				}
				vscode.window.showErrorMessage(message);
				return;
			}
			selectedKeys = new Set(requested);
		} else {
			if (wait) {
				return configureResult(
					false,
					'Настройка тестов без параметра frameworks требует выбора в UI; передайте frameworks (vanessa, xunit, yaxunit, onescript, onebdd)'
				);
			}
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
			selectedKeys = new Set(selected.map((item) => item.key));
		}

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

		// Недостающие каталоги выбранных фреймворков: в неинтерактивном режиме
		// создаются сразу, в визарде — после подтверждения
		const workspaceRoot = vrunner.getWorkspaceRoot();
		const createdDirs: string[] = [];
		if (workspaceRoot) {
			const missing = frameworks
				.filter((framework) => framework.dir && selectedKeys.has(framework.key))
				.map((framework) => framework.dir as string)
				.filter((dir) => !fsSync.existsSync(path.join(workspaceRoot, normalizeRelative(dir))));

			if (missing.length > 0) {
				let shouldCreate = nonInteractive;
				if (!nonInteractive) {
					const action = await vscode.window.showInformationMessage(
						`Настройки тестирования обновлены. Создать недостающие каталоги: ${missing.join(', ')}?`,
						'Создать',
						'Не сейчас'
					);
					shouldCreate = action === 'Создать';
				}
				if (shouldCreate) {
					for (const dir of missing) {
						try {
							await fs.mkdir(path.join(workspaceRoot, normalizeRelative(dir)), { recursive: true });
							createdDirs.push(dir);
						} catch (error) {
							log.warn(`Не удалось создать каталог ${dir}: ${(error as Error).message}`);
						}
					}
				}
				if (!nonInteractive) {
					return;
				}
			}
		}

		const enabledList = [...selectedKeys].join(', ') || 'нет';
		const summary = createdDirs.length > 0
			? `Настройки тестирования обновлены. Включены: ${enabledList}. Созданы каталоги: ${createdDirs.join(', ')}.`
			: `Настройки тестирования обновлены. Включены: ${enabledList}.`;
		if (wait) {
			return configureResult(true, summary);
		}
		void vscode.window.showInformationMessage(summary);
	});
}

/**
 * Убирает ведущие './' для path.join
 */
function normalizeRelative(dir: string): string {
	return dir.replace(/^\.[\\/]/, '');
}
