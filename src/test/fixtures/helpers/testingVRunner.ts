import type { VRunnerManager } from '../../../shared/vrunnerManager';

/**
 * Менеджер для контроллера тестов: профиль запуска «По умолчанию» без окружения
 * и переданные члены поверх.
 *
 * @param members - Методы, которые нужны проверке
 * @returns Заглушка менеджера
 */
export function testingVRunner(members: Record<string, unknown> = {}): VRunnerManager {
	return {
		onDidChangeActiveEnvProfile: () => ({ dispose: () => undefined }),
		launchProfileSummary: () => ({ id: 'default', label: 'По умолчанию', environment: { variables: {}, files: [] } }),
		...members,
	} as unknown as VRunnerManager;
}
