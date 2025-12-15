import { BaseCommand } from './baseCommand';
import { getRunEnterpriseCommandName, getRunDesignerCommandName } from '../commandNames';

/**
 * Команды для запуска 1С:Предприятие и Конфигуратора
 */
export class RunCommands extends BaseCommand {

	/**
	 * Запускает 1С:Предприятие
	 * Выполняет команду vrunner run --no-wait
	 * @returns Промис, который разрешается после запуска команды
	 */
	async runEnterprise(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const commandName = getRunEnterpriseCommandName();
		const args = ['run', '--no-wait'];

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Запускает Конфигуратор
	 * Выполняет команду vrunner designer --no-wait
	 * @returns Промис, который разрешается после запуска команды
	 */
	async runDesigner(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const commandName = getRunDesignerCommandName();
		const args = ['designer', '--no-wait'];

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}
}
