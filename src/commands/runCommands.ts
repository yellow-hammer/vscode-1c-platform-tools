import { BaseCommand, INFOBASE_BUSY } from './baseCommand';
import type { VRunnerIntent } from '../shared/vrunnerCli';
import { confirmGuiCommandInRemote } from '../shared/remoteEnv';
import { getRunEnterpriseCommandName, getRunDesignerCommandName } from '../features/tools/commandNames';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';
import { resolvePlatformBinaryInRoots } from '../shared/platformBinary';
import { projectPlatformRoots } from '../shared/platformSettings';

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
		return this.runClient(() => this.startEnterprise(opts));
	}

	private async startEnterprise(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
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
		const notices = this.vrunner.consumePlanNotices();
		return this.appendNotices(
			await this.runVRunner(args, opts, commandName.title, undefined, commandName.id, true, window.restore),
			notices
		);
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
		return this.runClient(() => this.startDesigner(opts));
	}

	private async startDesigner(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
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
		const notices = this.vrunner.consumePlanNotices();
		return this.appendNotices(
			await this.runVRunner(args, opts, commandName.title, undefined, commandName.id, true, window.restore),
			notices
		);
	}

	/**
	 * Запускает клиент 1С с окном. В режиме Docker он открывается на этой машине, если на ней
	 * есть платформа, иначе в контейнере.
	 *
	 * @param start - Запуск клиента
	 */
	private async runClient(start: () => Promise<StructuredCommandResult | void>): Promise<StructuredCommandResult | void> {
		if ((await this.vrunner.shouldUseDocker()) && !(await this.vrunner.runOnThisMachine(() => this.platformInstalled()))) {
			return this.vrunner.runWithWindow(start);
		}
		return this.vrunner.runOnThisMachine(start);
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
