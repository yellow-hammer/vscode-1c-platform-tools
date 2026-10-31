import type { VRunnerManager } from '../../../shared/vrunnerManager';

/**
 * Менеджер для контроллера тестов: проект без профиля и окружения и переданные
 * члены поверх.
 *
 * @param members - Методы, которые нужны проверке
 * @returns Заглушка менеджера
 */
export function testingVRunner(members: Record<string, unknown> = {}): VRunnerManager {
	return {
		onDidChangeActiveEnvProfile: () => ({ dispose: () => undefined }),
		onDidChangeActiveEnvironment: () => ({ dispose: () => undefined }),
		launchSummary: () => ({
			profile: { id: 'default', label: 'По умолчанию', settingsFiles: [] },
			environment: { variables: {}, files: [] },
		}),
		profileProblem: () => undefined,
		environmentProblem: () => undefined,
		shouldUseDocker: async () => false,
		warnIfEngineUnfit: async () => undefined,
		...members,
	} as unknown as VRunnerManager;
}
