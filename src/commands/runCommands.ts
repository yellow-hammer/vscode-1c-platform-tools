import { BaseCommand } from './baseCommand';
import { getRunEnterpriseCommandName, getRunDesignerCommandName } from '../commandNames';

/**
 * Команды для запуска 1С:Предприятие и Конфигуратора
 */
export class RunCommands extends BaseCommand {

	/**
	 * Запускает 1С:Предприятие
	 * 
	 * Выполняет команду vrunner run с параметрами подключения из env.json.
	 * Запускает 1С:Предприятие в режиме предприятия с указанными параметрами подключения.
	 * 
	 * @returns Промис, который разрешается после запуска команды
	 */
	async runEnterprise(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getRunEnterpriseCommandName();
		const args = ['run', '--no-wait', ...ibConnectionParam];

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Запускает Конфигуратор
	 * 
	 * Выполняет команду vrunner designer с параметрами подключения из env.json.
	 * Запускает Конфигуратор 1С:Предприятие с указанными параметрами подключения.
	 * 
	 * @returns Промис, который разрешается после запуска команды
	 */
	async runDesigner(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const commandName = getRunDesignerCommandName();
		const args = ['designer', '--no-wait', ...ibConnectionParam];

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}
}
