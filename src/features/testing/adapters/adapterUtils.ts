/**
 * Общие утилиты адаптеров тестовых фреймворков
 */
import * as path from 'node:path';
import { configurationScope } from '../../../shared/activeConfiguration';
import { resolveProjectLayout } from '../../../shared/projectLayout';
import type { VRunnerManager } from '../../../shared/vrunnerManager';

/**
 * Нормализует базовый каталог из настройки для использования в glob-паттерне
 *
 * Убирает ведущие './', завершающие '/' и приводит разделители к '/'.
 * Пустое значение или '.' означают корень workspace — возвращается '**'-совместимая база.
 *
 * @param configured - Значение настройки пути (например './features')
 * @returns База для glob (например 'features')
 */
/**
 * Каталоги активной конфигурации и её расширений как базы для glob.
 *
 * В формате конфигуратора исходники лежат по настроенным путям, в EDT -
 * соседними проектами, поэтому базы берутся из раскладки, а не из настроек.
 *
 * @param vrunner - Менеджер vrunner (корень рабочей области и пути настроек)
 * @returns Базы относительно корня рабочей области
 */
export async function activeSourceGlobBases(vrunner: VRunnerManager): Promise<string[]> {
	const workspaceRoot = vrunner.getWorkspaceRoot();
	if (!workspaceRoot) {
		return [];
	}

	const scope = await configurationScope(workspaceRoot, {
		configuration: vrunner.getCfPath(),
		extensions: [vrunner.getCfePath(), vrunner.getTestsCfePath()],
	});

	const roots = [...(scope.configuration ? [scope.configuration] : []), ...scope.extensions];
	return roots
		.filter((root) => root.format === 'edt')
		.map((root) => normalizeGlobBase(path.relative(workspaceRoot, root.dir).split(path.sep).join('/')));
}

/**
 * Каталоги проектов EDT с внешними обработками и отчётами как базы для glob.
 *
 * @param vrunner - Менеджер vrunner (корень рабочей области и пути настроек)
 * @returns Базы относительно корня рабочей области
 */
export async function activeExternalGlobBases(vrunner: VRunnerManager): Promise<string[]> {
	const workspaceRoot = vrunner.getWorkspaceRoot();
	if (!workspaceRoot) {
		return [];
	}

	const layout = await resolveProjectLayout(workspaceRoot, {
		configuration: vrunner.getCfPath(),
		extensions: [vrunner.getCfePath(), vrunner.getTestsCfePath()],
	});

	return layout.externals.map((dir) =>
		normalizeGlobBase(path.relative(workspaceRoot, dir).split(path.sep).join('/'))
	);
}

export function normalizeGlobBase(configured: string): string {
	let base = configured.trim().replaceAll('\\', '/');
	while (base.startsWith('./')) {
		base = base.slice(2);
	}
	base = base.replace(/\/+$/, '');
	if (base === '' || base === '.') {
		return '*';
	}
	return base;
}

/**
 * Вычисляет сегменты каталогов между базовым каталогом тестов и файлом
 *
 * Используется для построения иерархии каталогов в дереве Test Explorer:
 * features/init/Файл.feature → ['init'].
 *
 * @param fileFsPath - Абсолютный путь к файлу
 * @param baseSetting - Базовый каталог из настройки (например './features')
 * @param workspaceRoot - Абсолютный путь к корню workspace
 * @returns Сегменты подкаталогов (пусто, если файл лежит прямо в базе или вне её)
 */
export function directorySegments(
	fileFsPath: string,
	baseSetting: string,
	workspaceRoot: string
): string[] {
	const base = normalizeGlobBase(baseSetting);
	const baseFsPath = base === '*' ? workspaceRoot : path.join(workspaceRoot, base);
	const relative = path.relative(baseFsPath, path.dirname(fileFsPath));
	if (relative === '' || relative === '.' || relative.startsWith('..') || path.isAbsolute(relative)) {
		return [];
	}
	return relative.split(/[\\/]/).filter((segment) => segment.length > 0);
}
