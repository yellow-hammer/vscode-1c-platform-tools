import * as path from 'node:path';
import * as fsSync from 'node:fs';

/**
 * Поиск источников результатов тестов для Allure
 *
 * Allure 2 понимает несколько форматов результатов: собственный
 * (allure-results), jUnit XML и Cucumber JSON. Инструменты 1С раскладывают
 * их по разным каталогам внутри build/out:
 * - канонические каталоги `allure` (vanessa-runner: smoke/allure,
 *   syntax-check/allure; Vanessa Automation: allure);
 * - jUnit-отчёты (yaxunit/junit.xml и другие junit-каталоги);
 * - Cucumber JSON (cucumber/ от Vanessa Automation).
 *
 * Вместо жёсткого списка сканируем каталог результатов и отдаём только
 * реально существующие непустые источники.
 */

/** Максимальная глубина обхода build/out */
const MAX_SCAN_DEPTH = 3;

/**
 * Собирает каталоги с результатами тестов для allure generate
 *
 * @param outAbsPath - Абсолютный путь к каталогу результатов сборки (build/out)
 * @returns Абсолютные пути каталогов-источников (отсортированы для стабильности)
 */
export function collectAllureResultDirs(outAbsPath: string): string[] {
	const results = new Set<string>();

	const walk = (dir: string, depth: number): void => {
		let entries: fsSync.Dirent[];
		try {
			entries = fsSync.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		const dirName = path.basename(dir).toLowerCase();
		const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name.toLowerCase());

		// Канонический каталог allure-результатов
		if ((dirName === 'allure' || dirName === 'allure-results') && files.length > 0) {
			results.add(dir);
			return;
		}

		// Каталог с jUnit XML: junit/, yaxunit/, onescript/ (1testrunner и OneUnit), 1bdd/
		const junitDirNames = ['junit', 'yaxunit', 'onescript', '1bdd'];
		if (files.some((name) => name.endsWith('.xml')) && junitDirNames.includes(dirName)) {
			results.add(dir);
		}

		// Cucumber JSON от Vanessa Automation
		if (dirName === 'cucumber' && files.some((name) => name.endsWith('.json'))) {
			results.add(dir);
		}

		if (depth >= MAX_SCAN_DEPTH) {
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory()) {
				walk(path.join(dir, entry.name), depth + 1);
			}
		}
	};

	walk(outAbsPath, 0);

	// Дедупликация: jUnit-каталог пропускаем, если рядом есть allure-результаты
	// того же прогона (smoke/junit + smoke/allure — один прогон в двух форматах)
	const deduplicated = [...results].filter((dir) => {
		if (path.basename(dir).toLowerCase() !== 'junit') {
			return true;
		}
		const sibling = path.join(path.dirname(dir), 'allure');
		return !results.has(sibling);
	});

	return deduplicated.sort();
}
