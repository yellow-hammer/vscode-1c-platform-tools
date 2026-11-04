/**
 * Куда класть новый внешний отчёт или обработку.
 *
 * Выгрузка конфигуратора — каталог `<Имя>` с `<Имя>.xml` в `src/epf` или `src/erf`.
 * Проект 1C:EDT — отдельный проект рядом с проектом конфигурации.
 * Базовая конфигурация необязательна: без неё в манифесте нет `Base-Project`.
 * @module metadata/externalArtifactTarget
 */

import * as path from 'node:path';
import { sameOrUnder, type SourceFormat } from '../../shared/projectLayout';

/** Куда писать внешний объект. */
export interface ExternalArtifactTarget {
	/** Каталог, в котором создаётся объект: выгрузка или проект. */
	artifactsRoot: string;
	/** `Configuration.mdo` базового проекта EDT. Нет — проект без `Base-Project`. */
	configurationMdo?: string;
}

/**
 * Цель создания внешнего объекта.
 *
 * @param workspaceRoot - Корень проекта с `packagedef`
 * @param containerRelative - `src/epf` или `src/erf` для выгрузки конфигуратора
 * @param format - Формат нового объекта
 * @param configuration - Главная конфигурация из раскладки, если она есть
 */
export function externalArtifactTarget(
	workspaceRoot: string,
	containerRelative: string,
	format: SourceFormat,
	configuration: { dir: string; format: SourceFormat } | undefined
): ExternalArtifactTarget {
	if (format === 'designer') {
		return { artifactsRoot: path.resolve(workspaceRoot, containerRelative) };
	}
	const configurationDir = configuration?.format === 'edt' ? configuration.dir : undefined;
	return {
		artifactsRoot: edtProjectParent(workspaceRoot, configurationDir),
		...(configurationDir
			? { configurationMdo: path.join(configurationDir, 'src', 'Configuration', 'Configuration.mdo') }
			: {}),
	};
}

/** Родитель нового проекта: тот же каталог, что у проекта конфигурации, иначе корень рабочей области. */
function edtProjectParent(workspaceRoot: string, configurationDir: string | undefined): string {
	if (!configurationDir) {
		return workspaceRoot;
	}
	const parent = path.dirname(configurationDir);
	return sameOrUnder(parent, workspaceRoot) ? parent : workspaceRoot;
}
