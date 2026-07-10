import { BaseCommand } from './baseCommand';
import { getRunEnterpriseCommandName, getRunDesignerCommandName } from '../features/tools/commandNames';

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
	private async buildConnectionArgs(): Promise<string[]> {
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
	async runEnterprise(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}
		if (!(await this.vrunner.ensureProfileSettingsFile(true))) {
			return;
		}

		const connectionArgs = await this.buildConnectionArgs();
		const commandName = getRunEnterpriseCommandName();
		const [args] = await this.vrunner.planIntent(
			{ kind: 'run.enterprise', noWait: true, common: connectionArgs }
		);

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title,
			appendOverrides: false
		});
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
	async runDesigner(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}
		if (!(await this.ensureOscriptAvailable())) {
			return;
		}
		if (!(await this.vrunner.ensureProfileSettingsFile(true))) {
			return;
		}

		const connectionArgs = await this.buildConnectionArgs();
		const commandName = getRunDesignerCommandName();
		const [args] = await this.vrunner.planIntent(
			{ kind: 'run.designer', noWait: true, common: connectionArgs }
		);

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title,
			appendOverrides: false
		});
	}
}
