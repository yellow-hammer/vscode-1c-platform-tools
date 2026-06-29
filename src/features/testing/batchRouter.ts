import * as path from 'node:path';
import { JUnitCase } from './parsers/junitParser';

/**
 * Раскладка кейсов общего jUnit-отчёта по файлам (для батч-прогона)
 *
 * При батч-прогоне несколько тестовых файлов исполняются одним процессом и
 * пишут общий отчёт. Чтобы разложить результаты обратно по узлам-файлам дерева,
 * каждый testcase нужно сопоставить со своим файлом. Логика вынесена сюда —
 * чистая, без vscode.*, покрыта юнит-тестами.
 */

/**
 * Файл-цель раскладки
 */
export interface RoutableFile {
	/** ID узла-файла в дереве */
	id: string;
	/** Абсолютный путь к файлу теста */
	fsPath: string;
}

/**
 * Результат раскладки общего отчёта по файлам
 */
export interface RouteOutcome {
	/** ID узла-файла → его кейсы из общего отчёта */
	byFile: Map<string, JUnitCase[]>;
	/** Кейсы, которые не удалось привязать ни к одному файлу */
	unrouted: JUnitCase[];
}

interface FileKey {
	id: string;
	/** Полный путь в нижнем регистре с прямыми слэшами */
	pathNorm: string;
	/** Имя файла (basename) в нижнем регистре */
	base: string;
	/** Имя файла без расширения в нижнем регистре (для сопоставления с classname) */
	stem: string;
}

/** Приводит путь к сравнимому виду: прямые слэши, без ведущего ./, нижний регистр */
function normalizePath(value: string): string {
	// OneUnit пишет file в виде ".\tests\unit\...\X.os" — нормализуем слэши и
	// ведущий ./ , чтобы хвост пути совпал с абсолютным путём узла-файла
	return value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

/**
 * Заканчивается ли полный путь на относительный «хвост» по границе сегмента
 *
 * Граница сегмента отсекает ложные совпадения вида .../mytests.os ≠ tests.os.
 */
function endsWithPathSegment(full: string, tail: string): boolean {
	if (full === tail) {
		return true;
	}
	return full.endsWith(tail) && full[full.length - tail.length - 1] === '/';
}

/**
 * Возвращает единственный подходящий файл по предикату либо undefined,
 * если совпадений нет или они неоднозначны (больше одного)
 */
function singleMatch(files: FileKey[], predicate: (file: FileKey) => boolean): FileKey | undefined {
	let found: FileKey | undefined;
	for (const file of files) {
		if (!predicate(file)) {
			continue;
		}
		if (found) {
			return undefined;
		}
		found = file;
	}
	return found;
}

/**
 * Находит файл для одного testcase по убыванию надёжности признака:
 * атрибут file (полный путь → имя файла) → classname/suiteName (= имя набора).
 */
function matchCase(testCase: JUnitCase, files: FileKey[]): FileKey | undefined {
	if (testCase.file) {
		const fileNorm = normalizePath(testCase.file);
		const byPath = singleMatch(files, (file) => endsWithPathSegment(file.pathNorm, fileNorm));
		if (byPath) {
			return byPath;
		}
		const fileBase = path.posix.basename(fileNorm);
		const byBase = singleMatch(files, (file) => file.base === fileBase);
		if (byBase) {
			return byBase;
		}
	}

	// classname у OneUnit — имя набора (как правило, имя модуля без расширения);
	// suiteName — запасной источник того же признака
	for (const suiteKey of [testCase.className, testCase.suiteName]) {
		const key = suiteKey?.trim().toLowerCase();
		if (!key) {
			continue;
		}
		const byStem = singleMatch(files, (file) => file.stem === key);
		if (byStem) {
			return byStem;
		}
	}

	return undefined;
}

/**
 * Раскладывает кейсы общего отчёта по файлам батч-прогона
 *
 * @param cases - Кейсы из общего jUnit-отчёта
 * @param files - Файлы, участвовавшие в батч-прогоне
 * @returns Кейсы, сгруппированные по ID файла, и непривязанные кейсы
 */
export function routeReportCases(cases: JUnitCase[], files: RoutableFile[]): RouteOutcome {
	const keys: FileKey[] = files.map((file) => {
		const pathNorm = normalizePath(file.fsPath);
		const base = path.posix.basename(pathNorm);
		const ext = path.posix.extname(base);
		return {
			id: file.id,
			pathNorm,
			base,
			stem: ext.length > 0 ? base.slice(0, -ext.length) : base
		};
	});

	const byFile = new Map<string, JUnitCase[]>();
	const unrouted: JUnitCase[] = [];

	for (const testCase of cases) {
		const match = matchCase(testCase, keys);
		if (!match) {
			unrouted.push(testCase);
			continue;
		}
		const bucket = byFile.get(match.id);
		if (bucket) {
			bucket.push(testCase);
		} else {
			byFile.set(match.id, [testCase]);
		}
	}

	return { byFile, unrouted };
}
