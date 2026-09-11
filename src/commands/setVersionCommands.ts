import { projectPaths } from '../shared/projectPaths';
import { NO_CONFIGURATION_SOURCES } from './baseCommand';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { BaseCommand } from './baseCommand';
import {
	getSetVersionConfigurationCommandName,
	getSetVersionExtensionCommandName,
	getSetVersionReportCommandName,
	getSetVersionProcessorCommandName
} from '../features/tools/commandNames';
import { pickExtensions } from '../features/extensions/extensionPicker';
import { extensionEntries } from '../features/extensions/extensionRoots';
import { logger } from '../shared/logger';
import { configurationScope } from '../shared/activeConfiguration';
import { configurationDescriptorFile } from '../shared/objectPaths';
import { ensureMdSparrowRuntime } from '../features/metadata/mdSparrowBootstrap';
import { runMdSparrowParamsMutation } from '../features/metadata/mdSparrowParams';
import { edtExternalProjectsOf, EDT_STAGING_DIR } from '../features/edt/edtSourceBridge';
import { runEdtExports, runEdtImports } from '../features/edt/edtBridgeRunner';

const log = logger.scope('commands');

/**
 * Команды для установки версий исходного кода конфигурации, расширений и внешних файлов
 *
 * Использует vrunner set-version для обновления версии в метаданных.
 */
export class SetVersionCommands extends BaseCommand {
	constructor(private readonly context: vscode.ExtensionContext) {
		super();
	}

	/**
	 * Пишет версию в описание проекта EDT.
	 *
	 * Раннер ставит версию в Configuration.xml выгрузки, а у проекта EDT
	 * версия лежит в Configuration.mdo: её правит md-sparrow точечно.
	 *
	 * @param configurationMdo - Описание конфигурации или расширения
	 * @param version - Новая версия
	 * @param workspaceRoot - Корень рабочей области
	 * @returns Удалась ли запись
	 */
	private async stampEdtProject(configurationMdo: string, version: string, workspaceRoot: string): Promise<boolean> {
		const runtime = await ensureMdSparrowRuntime(this.context);
		const res = await runMdSparrowParamsMutation(
			runtime,
			{
				op: 'cf-configuration-properties-set',
				configurationXml: configurationMdo,
				payloadJson: JSON.stringify({ version }),
			},
			{ cwd: workspaceRoot }
		);
		if (res.exitCode !== 0) {
			void vscode.window.showErrorMessage((res.stderr.trim() || res.stdout.trim()).slice(0, 400));
			return false;
		}
		return true;
	}

	/**
	 * Ставит версию внешним объектам проектов EDT.
	 *
	 * Проект выгружается самой EDT, версию в выгрузку ставит раннер, результат
	 * возвращается в проект импортом: так же идут сборка и разборка.
	 *
	 * @param artifactsRoot - Каталог внешних объектов относительно рабочей области
	 * @param names - Имена объектов
	 * @param version - Новая версия
	 * @param workspaceRoot - Корень рабочей области
	 * @param title - Название задачи в терминале
	 */
	private async stampEdtExternal(
		artifactsRoot: string,
		names: readonly string[],
		version: string,
		workspaceRoot: string,
		title: string
	): Promise<void> {
		const projects = edtExternalProjectsOf(workspaceRoot, artifactsRoot).filter((project) =>
			names.includes(project.name)
		);
		if (projects.length === 0) {
			vscode.window.showInformationMessage('В каталоге нет проектов внешних объектов EDT.');
			return;
		}
		const buildDir = this.vrunner.getOutPath();
		const staging = `${buildDir}/${EDT_STAGING_DIR}/${path.basename(artifactsRoot)}`;
		const context = { workspaceRoot, buildDir, baseProjectDir: await this.activeEdtProjectDirForVersion() };
		const exported = await runEdtExports(
			projects.map((project) => ({
				projectDir: project.projectDir,
				target: `${staging}/${project.name}`,
				externalName: project.name,
			})),
			context
		);
		if (!exported) {
			void vscode.window.showErrorMessage('Выгрузка проекта 1С:EDT не удалась, версия не изменена.');
			return;
		}
		const argsList = projects.map((project) => [
			'set-version',
			'--src',
			`${staging}/${project.name}`,
			'--check-module',
			'--new-version',
			version,
		]);
		await this.vrunner.executeVRunnerTaskSequenceAndWait(argsList, { cwd: workspaceRoot, name: title });
		await runEdtImports([{ source: staging, projectDir: artifactsRoot, needsBase: true, external: true }], context);
	}

	/** Каталог проекта активной конфигурации EDT: базовый проект внешних объектов. */
	private async activeEdtProjectDirForVersion(): Promise<string | undefined> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return undefined;
		}
		const scope = await configurationScope(workspaceRoot);
		return scope.configuration?.format === 'edt' ? scope.configuration.dir : undefined;
	}


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
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		const version = await this.askNewVersion('1.0.0');
		if (!version) {
			return;
		}

		const scope = await configurationScope(workspaceRoot);
		if (scope.configuration?.format === 'edt') {
			if (await this.stampEdtProject(configurationDescriptorFile(scope.configuration), version, workspaceRoot)) {
				vscode.window.showInformationMessage(`Версия конфигурации: ${version}`);
			}
			return;
		}
		const cfPath = await this.activeCfPath();
		if (cfPath === undefined) {
			vscode.window.showErrorMessage(NO_CONFIGURATION_SOURCES);
			return;
		}
		const args = ['set-version', '--src', cfPath, '--new-version', version];
		const commandName = getSetVersionConfigurationCommandName();

		await this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Устанавливает версию выбранным расширениям.
	 *
	 * Предлагает расширения решения и тестовые из раскладки, тем же выбором и с тем
	 * же сохранённым подмножеством, что у команд загрузки и выгрузки расширений.
	 * Выгрузке конфигуратора версию ставит раннер:
	 * vrunner set-version --src &lt;каталог расширения&gt; --new-version &lt;версия&gt;;
	 * проекту EDT версия пишется в его описание.
	 *
	 * @returns Промис, который разрешается после запуска команды
	 */
	async setVersionExtension(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		const extensions = extensionEntries(await this.paths(), 'all');
		if (extensions.length === 0) {
			log.info('Расширений в рабочей области не найдено');
			vscode.window.showInformationMessage('Расширений в рабочей области не найдено.');
			return;
		}

		const selected = await pickExtensions(extensions, this.vrunner.getWorkspaceMemento());
		if (selected === undefined) {
			// Отмена quickpick — команда не выполняется
			return;
		}
		if (selected.length === 0) {
			vscode.window.showInformationMessage('Не выбрано ни одного расширения.');
			return;
		}

		const version = await this.askNewVersion('1.0.0');
		if (!version) {
			return;
		}

		const argsList: string[][] = [];
		for (const extension of selected) {
			if (extension.format === 'edt') {
				const descriptor = configurationDescriptorFile({
					name: extension.name,
					dir: path.join(workspaceRoot, extension.dir),
					format: extension.format,
					isExtension: true,
				});
				if (!(await this.stampEdtProject(descriptor, version, workspaceRoot))) {
					return;
				}
				continue;
			}
			argsList.push(['set-version', '--src', extension.dir, '--new-version', version]);
		}
		if (argsList.length === 0) {
			vscode.window.showInformationMessage(`Версия расширений: ${version}`);
			return;
		}
		const commandName = getSetVersionExtensionCommandName();

		await this.vrunner.executeVRunnerCommandsInSequence(argsList, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Устанавливает версию внешнему отчёту.
	 * При вызове из палитры команд без аргумента показывает список отчётов для выбора.
	 * Выполняет: vrunner set-version --src &lt;каталог отчёта&gt; --check-module --new-version &lt;версия&gt;
	 * @param reportName - Имя отчёта (если не указано, показывается выбор из списка)
	 * @returns Промис, который разрешается после запуска команды
	 */
	async setVersionReport(reportName?: string): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		let selected = reportName;
		if (selected === undefined) {
			const reports = await this.getReportFoldersForTree();
			if (reports.length === 0) {
				log.info('Внешних отчётов в рабочей области нет');
				vscode.window.showInformationMessage('Внешних отчётов в рабочей области нет');
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

		const erfPath = await this.reportsContainer();
		const srcPath = (await this.paths())?.reports.find((report) => report.name === selected)?.dir ?? path.join(erfPath, selected);
		const commandName = getSetVersionReportCommandName(selected);
		if (edtExternalProjectsOf(workspaceRoot, srcPath).length > 0) {
			await this.stampEdtExternal(srcPath, [selected], version, workspaceRoot, commandName.title);
			return;
		}
		const args = ['set-version', '--src', srcPath, '--check-module', '--new-version', version];

		await this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Устанавливает версию внешней обработке.
	 * При вызове из палитры команд без аргумента показывает список обработок для выбора.
	 * Выполняет: vrunner set-version --src &lt;каталог обработки&gt; --check-module --new-version &lt;версия&gt;
	 * @param processorName - Имя обработки (если не указано, показывается выбор из списка)
	 * @returns Промис, который разрешается после запуска команды
	 */
	async setVersionProcessor(processorName?: string): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}

		let selected = processorName;
		if (selected === undefined) {
			const processors = await this.getProcessorFoldersForTree();
			if (processors.length === 0) {
				log.info('Внешних обработок в рабочей области нет');
				vscode.window.showInformationMessage('Внешних обработок в рабочей области нет');
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

		const epfPath = await this.processorsContainer();
		const srcPath = (await this.paths())?.processors.find((processor) => processor.name === selected)?.dir ?? path.join(epfPath, selected);
		const commandName = getSetVersionProcessorCommandName(selected);
		if (edtExternalProjectsOf(workspaceRoot, srcPath).length > 0) {
			await this.stampEdtExternal(srcPath, [selected], version, workspaceRoot, commandName.title);
			return;
		}
		const args = ['set-version', '--src', srcPath, '--check-module', '--new-version', version];

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
		const paths = await projectPaths(workspaceRoot);
		return [...paths.extensions, ...paths.testExtensions].map((extension) =>
			extension.format === 'edt' ? extension.name : path.basename(extension.dir)
		);
	}

	/**
	 * Имена внешних отчётов рабочей области (для дерева команд).
	 * @returns Промис, который разрешается массивом имён каталогов
	 */
	async getReportFoldersForTree(): Promise<string[]> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return [];
		}
		return (await projectPaths(workspaceRoot)).reports.map((report) => report.name);
	}

	/**
	 * Имена внешних обработок рабочей области (для дерева команд).
	 * @returns Промис, который разрешается массивом имён каталогов
	 */
	async getProcessorFoldersForTree(): Promise<string[]> {
		const workspaceRoot = this.vrunner.getWorkspaceRoot();
		if (!workspaceRoot) {
			return [];
		}
		return (await projectPaths(workspaceRoot)).processors.map((processor) => processor.name);
	}
}
