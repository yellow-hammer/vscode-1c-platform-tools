/** Каталог результатов, объявленный в настройках проекта. */
export interface DeclaredResultDir {
	/** Абсолютный путь каталога */
	dir: string;
	/** Прогон, который пишет в каталог (xunit, syntax-check) */
	run?: string;
	/** В каталоге jUnit-отчёт прогона */
	junit?: boolean;
}

/**
 * Каталоги результатов без повторов одного прогона.
 *
 * Allure читает и jUnit, и собственные результаты, поэтому jUnit-отчёт
 * прогона, у которого есть результаты Allure, показал бы каждый тест дважды.
 *
 * @param declared - Существующие каталоги результатов
 * @returns Абсолютные пути каталогов без повторов
 */
export function uniqueResultDirs(declared: readonly DeclaredResultDir[]): string[] {
	const withAllure = new Set(declared.filter((entry) => entry.run && !entry.junit).map((entry) => entry.run));
	const dirs = declared
		.filter((entry) => !(entry.junit && withAllure.has(entry.run)))
		.map((entry) => entry.dir);
	return [...new Set(dirs)];
}
