import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { VRUNNER_TASK_TYPE, VRunnerTaskDefinition } from './vrunnerTask';

/**
 * Провайдер задач vrunner для tasks.json.
 *
 * Собственных автозадач не предлагает (provideTasks → пусто): команды расширения
 * запускают задачи ad-hoc через {@link VRunnerManager.executeVRunnerTask}.
 * resolveTask позволяет пользователю описать задачу в tasks.json:
 * `{ "type": "1c-vrunner", "command": "vanessa", "args": ["--settings", "env.json"] }`.
 */
class VRunnerTaskProvider implements vscode.TaskProvider {
	constructor(private readonly vrunner: VRunnerManager) {}

	public provideTasks(): vscode.ProviderResult<vscode.Task[]> {
		return [];
	}

	public resolveTask(task: vscode.Task): vscode.ProviderResult<vscode.Task> {
		const definition = task.definition as VRunnerTaskDefinition;
		if (!definition || definition.type !== VRUNNER_TASK_TYPE || !definition.command) {
			return undefined;
		}

		const args = [definition.command, ...(definition.args ?? [])];
		return this.vrunner.createVRunnerTaskFromArgs(args, {
			name: task.name || definition.command,
			appendOverrides: false,
			translateRaw: true,
			definition,
		});
	}
}

/**
 * Регистрирует провайдер задач vrunner.
 *
 * @returns Disposable'ы фичи (регистрация провайдера)
 */
export function registerTasksFeature(): vscode.Disposable[] {
	const vrunner = VRunnerManager.getInstance();
	return [vscode.tasks.registerTaskProvider(VRUNNER_TASK_TYPE, new VRunnerTaskProvider(vrunner))];
}
