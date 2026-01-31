import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { BaseCommand } from './baseCommand';
import {
	getSetVersionConfigurationCommandName,
	getSetVersionAllExtensionsCommandName,
	getSetVersionExtensionCommandName,
	getSetVersionReportCommandName,
	getSetVersionProcessorCommandName
} from '../commandNames';

/**
 * Команды для установки версий исходного кода конфигурации, расширений и внешних файлов
 *
 * Использует vrunner set-version для обновления версии в метаданных.
 */
export class SetVersionCommands extends BaseCommand {

	/**
	 * Запрашивает у пользователя новую версию
	 * @param placeHolder - Подсказка для поля ввода (например, "1.0.0")
	 * @returns Промис, который разрешается введённой версией или undefined при отмене
	 */
	private async askNewVersion(placeHolder: string): Promise<string | undefined> {
		const version = await vscode.window.showInputBox({
			prompt: 'Введите новую версию',
			placeHolder,
			validateInput: (value) => {
				if (!value || value.trim().length === 0) {
					return 'Введите версию';
				}
				return undefined;
			}
		});
		return version?.trim();
	}

	/**
	 * Устанавливает версию конфигурации (src/cf)
	 * Выполняет: vrunner set-version --src src/cf --new-version &lt;версия&gt;
	 * @returns Промис, который разрешается после запуска команды
	 */
	async setVersionConfiguration(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const version = await this.askNewVersion('1.0.0');
		if (!version) {
			return;
		}

		const cfPath = this.vrunner.getCfPath();
		const args = ['set-version', '--src', cfPath, '--new-version', version];
		const commandName = getSetVersionConfigurationCommandName();

		await this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Устанавливает версию всем расширениям (src/cfe)
	 * Выполняет: vrunner set-version --src src/cfe --new-version &lt;версия&gt;
	 * @returns Промис, который разрешается после запуска команды
	 */
	async setVersionAllExtensions(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const version = await this.askNewVersion('1.0.0');
		if (!version) {
			return;
		}

		const cfePath = this.vrunner.getCfePath();
		const args = ['set-version', '--src', cfePath, '--new-version', version];
		const commandName = getSetVersionAllExtensionsCommandName();

		await this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Устанавливает версию указанному расширению.
	 * При вызове из палитры команд без аргумента показывает список расширений для выбора.
	 * Выполняет: vrunner set-version --src src/cfe/&lt;имя&gt; --new-version &lt;версия&gt;
	 * @param extensionName - Имя каталога расширения в src/cfe (если не указано — показывается выбор из списка)
	 * @returns Промис, который разрешается после запуска команды
	 */
	async setVersionExtension(extensionName?: string): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		let selected = extensionName;
		if (selected === undefined) {
			const extensions = await this.getExtensionFoldersForTree();
			if (extensions.length === 0) {
				vscode.window.showInformationMessage('В папке src/cfe не найдено расширений');
				return;
			}
			const picked = await vscode.window.showQuickPick(extensions, {
				placeHolder: 'Выберите расширение',
				title: 'Расширения'
			});
			if (picked === undefined) {
				return;
			}
			selected = picked;
		}

		const version = await this.askNewVersion('1.0.0');
		if (!version) {
			return;
		}

		const cfePath = this.vrunner.getCfePath();
		const srcPath = path.join(cfePath, selected);
		const args = ['set-version', '--src', srcPath, '--new-version', version];
		const commandName = getSetVersionExtensionCommandName(selected);

		await this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Устанавливает версию внешнему отчёту.
	 * При вызове из палитры команд без аргумента показывает список отчётов для выбора.
	 * Выполняет: vrunner set-version --src src/erf/&lt;имя&gt; --check-module --new-version &lt;версия&gt;
	 * @param reportName - Имя каталога отчёта в src/erf (если не указано — показывается выбор из списка)
	 * @returns Промис, который разрешается после запуска команды
	 */
	async setVersionReport(reportName?: string): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		let selected = reportName;
		if (selected === undefined) {
			const reports = await this.getReportFoldersForTree();
			if (reports.length === 0) {
				vscode.window.showInformationMessage('В папке src/erf не найдено внешних отчётов');
				return;
			}
			const picked = await vscode.window.showQuickPick(reports, {
				placeHolder: 'Выберите внешний отчёт',
				title: 'Внешнего отчёта'
			});
			if (picked === undefined) {
				return;
			}
			selected = picked;
		}

		const version = await this.askNewVersion('1.0.0');
		if (!version) {
			return;
		}

		const erfPath = this.vrunner.getErfPath();
		const srcPath = path.join(erfPath, selected);
		const args = ['set-version', '--src', srcPath, '--check-module', '--new-version', version];
		const commandName = getSetVersionReportCommandName(selected);

		await this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Устанавливает версию внешней обработке.
	 * При вызове из палитры команд без аргумента показывает список обработок для выбора.
	 * Выполняет: vrunner set-version --src src/epf/&lt;имя&gt; --check-module --new-version &lt;версия&gt;
	 * @param processorName - Имя каталога обработки в src/epf (если не указано — показывается выбор из списка)
	 * @returns Промис, который разрешается после запуска команды
	 */
	async setVersionProcessor(processorName?: string): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		let selected = processorName;
		if (selected === undefined) {
			const processors = await this.getProcessorFoldersForTree();
			if (processors.length === 0) {
				vscode.window.showInformationMessage('В папке src/epf не найдено внешних обработок');
				return;
			}
			const picked = await vscode.window.showQuickPick(processors, {
				placeHolder: 'Выберите внешнюю обработку',
				title: 'Внешней обработки'
			});
			if (picked === undefined) {
				return;
			}
			selected = picked;
		}

		const version = await this.askNewVersion('1.0.0');
		if (!version) {
			return;
		}

		const epfPath = this.vrunner.getEpfPath();
		const srcPath = path.join(epfPath, selected);
		const args = ['set-version', '--src', srcPath, '--check-module', '--new-version', version];
		const commandName = getSetVersionProcessorCommandName(selected);

		await this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Возвращает список имён каталогов расширений в src/cfe (для дерева команд).
	 * При отсутствии каталога или ошибке чтения возвращает пустой массив без уведомления пользователя.
	 * @returns Промис, который разрешается массивом имён каталогов
	 */
	async getExtensionFoldersForTree(): Promise<string[]> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return [];
		}
		const cfePath = this.vrunner.getCfePath();
		const fullPath = path.join(workspaceRoot, cfePath);
		try {
			const entries = await fs.readdir(fullPath, { withFileTypes: true });
			return entries.filter((e) => e.isDirectory()).map((e) => e.name);
		} catch {
			return [];
		}
	}

	/**
	 * Возвращает список имён каталогов внешних отчётов в src/erf (для дерева команд).
	 * При отсутствии каталога или ошибке чтения возвращает пустой массив без уведомления пользователя.
	 * @returns Промис, который разрешается массивом имён каталогов
	 */
	async getReportFoldersForTree(): Promise<string[]> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return [];
		}
		const erfPath = this.vrunner.getErfPath();
		const fullPath = path.join(workspaceRoot, erfPath);
		try {
			const entries = await fs.readdir(fullPath, { withFileTypes: true });
			return entries.filter((e) => e.isDirectory()).map((e) => e.name);
		} catch {
			return [];
		}
	}

	/**
	 * Возвращает список имён каталогов внешних обработок в src/epf (для дерева команд).
	 * При отсутствии каталога или ошибке чтения возвращает пустой массив без уведомления пользователя.
	 * @returns Промис, который разрешается массивом имён каталогов
	 */
	async getProcessorFoldersForTree(): Promise<string[]> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return [];
		}
		const epfPath = this.vrunner.getEpfPath();
		const fullPath = path.join(workspaceRoot, epfPath);
		try {
			const entries = await fs.readdir(fullPath, { withFileTypes: true });
			return entries.filter((e) => e.isDirectory()).map((e) => e.name);
		} catch {
			return [];
		}
	}
}
