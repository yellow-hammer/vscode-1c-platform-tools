import * as vscode from 'vscode';
import { BaseCommand, INFOBASE_BUSY } from './baseCommand';
import type { VRunnerIntent } from '../shared/vrunnerCli';
import { confirmGuiCommandInRemote } from '../shared/remoteEnv';
import { getRunEnterpriseCommandName, getRunDesignerCommandName } from '../features/tools/commandNames';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';
import { resolvePlatformBinaryInRoots } from '../shared/platformBinary';
import { projectPlatformRoots } from '../shared/platformSettings';
import { runWithHooks } from '../shared/commandHooks';
import { currentRoot, runWithProject } from '../shared/workspaceProjects';

/**
 * Команды для запуска 1С:Предприятие и Конфигуратора
 */
export class RunCommands extends BaseCommand {

	/**
	 * Собирает аргументы подключения для команд run/designer.
	 *
	 * При наличии файла активного профиля передаётся `--settings`, иначе — явный
	 * `--ibconnection`. Временные параметры добавляются централизованно в VRunnerManager.
	 *
	 * @returns Аргументы vrunner без имени команды
	 */
	private async buildConnectionArgs(opts?: CommandExecutionOptions): Promise<string[]> {
		// Параметры вызова имеют приоритет над активным профилем: явный
		// settingsFile подставляется как --settings, явная строка подключения
		// как --ibconnection (агентные вызовы, MCP)
		if (opts?.settingsFile) {
			return this.vrunner.getSettingsParam(opts.settingsFile);
		}
		if (opts?.ibConnection) {
			return this.vrunner.getIbConnectionParam(opts.ibConnection);
		}
		const settingsParam = this.vrunner.getActiveSettingsParamIfExists();
		if (settingsParam.length > 0) {
			return settingsParam;
		}
		return this.vrunner.getIbConnectionParam();
	}

	/**
	 * Запускает 1С:Предприятие
	 *
	 * Выполняет команду vrunner run с параметрами подключения из активного env-профиля.
	 * При наличии файла профиля он передаётся через --settings (применяются --v8version,
	 * учётка, --additional и пр.); поверх накладываются временные параметры.
	 *
	 * @returns Промис, который разрешается после запуска команды
	 */
	async runEnterprise(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		return this.runClient((inContainer) => this.startEnterprise(opts, inContainer));
	}

	private async startEnterprise(
		opts: CommandExecutionOptions | undefined,
		inContainer: boolean
	): Promise<StructuredCommandResult | void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}
		if (!opts?.settingsFile && !opts?.ibConnection && !(await this.vrunner.ensureProfileSettingsFile(true))) {
			return;
		}

		const connectionArgs = await this.buildConnectionArgs(opts);
		const commandName = getRunEnterpriseCommandName();
		if (!(await confirmGuiCommandInRemote(commandName.title))) {
			return;
		}
		// Обработка и строка /C приходят от агента: без них открывается пустое Предприятие
		const execute = typeof opts?.execute === 'string' && opts.execute.trim() !== '' ? opts.execute.trim() : undefined;
		const command = typeof opts?.command === 'string' && opts.command.trim() !== '' ? opts.command.trim() : undefined;
		const intent: VRunnerIntent = { kind: 'run.enterprise', noWait: true, execute, command, common: connectionArgs };
		const window = await this.openInfobaseWindow([intent], opts);
		if (window === 'blocked') {
			return opts?.wait === true ? this.executionError(INFOBASE_BUSY) : undefined;
		}
		const [args] = await this.vrunner.planIntent(intent, opts?.settingsFile, opts?.ibConnection);
		if (inContainer) {
			return this.startInContainer(args, opts, commandName, window.restore);
		}

		return this.runVRunner(args, opts, commandName.title, undefined, commandName.id, true, window.restore);
	}

	/**
	 * Запускает Конфигуратор
	 *
	 * Выполняет команду vrunner designer с параметрами подключения из активного env-профиля.
	 * При наличии файла профиля он передаётся через --settings; поверх накладываются
	 * временные параметры.
	 *
	 * @returns Промис, который разрешается после запуска команды
	 */
	async runDesigner(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		return this.runClient((inContainer) => this.startDesigner(opts, inContainer));
	}

	private async startDesigner(
		opts: CommandExecutionOptions | undefined,
		inContainer: boolean
	): Promise<StructuredCommandResult | void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}
		if (!opts?.settingsFile && !opts?.ibConnection && !(await this.vrunner.ensureProfileSettingsFile(true))) {
			return;
		}

		const connectionArgs = await this.buildConnectionArgs(opts);
		const commandName = getRunDesignerCommandName();
		if (!(await confirmGuiCommandInRemote(commandName.title))) {
			return;
		}
		const intent: VRunnerIntent = { kind: 'run.designer', noWait: true, common: connectionArgs };
		const window = await this.openInfobaseWindow([intent], opts);
		if (window === 'blocked') {
			return opts?.wait === true ? this.executionError(INFOBASE_BUSY) : undefined;
		}
		const [args] = await this.vrunner.planIntent(intent, opts?.settingsFile, opts?.ibConnection);
		if (inContainer) {
			return this.startInContainer(args, opts, commandName, window.restore);
		}

		return this.runVRunner(args, opts, commandName.title, undefined, commandName.id, true, window.restore);
	}

	/**
	 * Запускает клиент 1С с окном в контейнере: команда завершается, как только он
	 * запущен, а базу держателю возвращает выход контейнера.
	 *
	 * @param args - Итоговые аргументы vrunner
	 * @param opts - Опции выполнения
	 * @param commandName - Идентификатор и название команды
	 * @param restore - Возврат базы держателю
	 */
	private async startInContainer(
		args: string[],
		opts: CommandExecutionOptions | undefined,
		commandName: { id: string; title: string },
		restore: (() => Promise<void>) | undefined
	): Promise<StructuredCommandResult | void> {
		const cwd = this.getExecutionCwd(opts);
		if (!cwd) {
			await restore?.();
			if (opts?.wait === true) {
				return this.executionError('Укажите projectPath или откройте рабочую область с проектом 1С');
			}
			this.ensureWorkspace();
			return;
		}
		const root = currentRoot();
		let started = false;
		const start = async (): Promise<StructuredCommandResult> => {
			const run = await this.vrunner.startClientInContainer(args, { cwd, name: commandName.title });
			if ('error' in run) {
				return this.executionError(run.error);
			}
			started = true;
			void run.exited.then(() => runWithProject(root, async () => restore?.()));
			return { success: true, exitCode: 0, stdout: `Клиент 1С запущен в контейнере ${run.container}`, stderr: '' };
		};
		const result = await runWithHooks({ commandId: commandName.id, cwd, args, workspaceRoot: root ?? cwd, run: start });
		if (!started) {
			await restore?.();
		}
		if (opts?.wait === true) {
			return result;
		}
		if (result && !result.success) {
			void vscode.window.showErrorMessage(`${commandName.title}: ${result.stderr}`);
		}
	}

	/**
	 * Запускает клиент 1С с окном. В режиме Docker он открывается на этой машине, если на ней
	 * есть платформа, иначе в контейнере.
	 *
	 * @param start - Запуск клиента
	 */
	private async runClient(
		start: (inContainer: boolean) => Promise<StructuredCommandResult | void>
	): Promise<StructuredCommandResult | void> {
		if ((await this.vrunner.shouldUseDocker()) && !(await this.vrunner.runOnThisMachine(() => this.platformInstalled()))) {
			return this.vrunner.runWithWindow(() => start(true));
		}
		return this.vrunner.runOnThisMachine(() => start(false));
	}

	/** Установлена ли платформа, которую запросит активный профиль запуска. */
	private async platformInstalled(): Promise<boolean> {
		// Файл профиля выбирается по версии vrunner
		await this.vrunner.getVRunnerVersion();
		const requested = await this.vrunner.getActiveV8Version();
		const roots = projectPlatformRoots(this.vrunner.getWorkspaceRoot());
		return resolvePlatformBinaryInRoots(roots, '1cv8', { requestedVersion: requested || undefined }) !== undefined;
	}
}
