/**
 * Каталоги исходного кода для команд md-sparrow над проектом целиком.
 * @module sourcePaths
 */

import { CONVENTIONAL_PATHS, projectPaths } from './projectPaths';

/** Каталоги исходного кода относительно рабочей области: общие каталоги и точные списки. */
export interface SourceDirs {
	cf: string;
	cfe: string;
	epf: string;
	erf: string;
	/** Каталоги расширений активной конфигурации, тестовых тоже, в том числе вложенные. */
	cfeDirs: string[];
	/** Каталоги внешних обработок выгрузки конфигуратора, тестовых тоже, где бы они ни лежали. */
	epfDirs: string[];
	/** Каталоги внешних отчётов выгрузки конфигуратора. */
	erfDirs: string[];
}

/**
 * Каталоги для команд md-sparrow, которые обходят проект целиком.
 *
 * Берутся из раскладки: конфигурация и расширения точными каталогами в обоих
 * форматах, внешние объекты выгрузки конфигуратора тоже; тестовые расширения и
 * обработки идут наравне с остальными. Чего в рабочей области нет, то идёт
 * привычным местом: пустой каталог md-sparrow пропускает.
 *
 * @param workspaceRoot - Корень рабочей области
 */
export async function detectedSourceDirs(workspaceRoot: string): Promise<SourceDirs> {
	const paths = await projectPaths(workspaceRoot);
	const externals = [...paths.processors, ...paths.reports, ...paths.testProcessors].filter(
		(external) => external.format === 'designer'
	);
	return {
		cf: paths.configuration?.dir ?? CONVENTIONAL_PATHS.cf,
		cfe: paths.extensionsContainer ?? CONVENTIONAL_PATHS.cfe,
		epf: paths.processorsContainer ?? CONVENTIONAL_PATHS.epf,
		erf: paths.reportsContainer ?? CONVENTIONAL_PATHS.erf,
		cfeDirs: [...paths.extensions, ...paths.testExtensions].map((extension) => extension.dir),
		epfDirs: externals.filter((external) => external.kind === 'processor').map((external) => external.dir),
		erfDirs: externals.filter((external) => external.kind === 'report').map((external) => external.dir),
	};
}
