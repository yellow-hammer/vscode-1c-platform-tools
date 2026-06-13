import { JUnitCase } from './parsers/junitParser';
import { normalizeTestName } from './testItemIds';

/**
 * Маппинг результатов jUnit-отчёта на элементы дерева тестов
 *
 * Чистая логика без vscode.* — тестируется юнит-тестами.
 * Имена testcase в отчётах не всегда совпадают с именами в исходниках
 * (Vanessa добавляет префиксы и нумерацию, кодировки различаются),
 * поэтому сопоставление выполняется по убыванию строгости.
 */

/**
 * Описание известного кейса дерева для сопоставления
 */
export interface KnownCase {
	/** ID элемента TestItem */
	id: string;
	/** Имя кейса из исходника */
	caseName: string;
}

/**
 * Агрегированный результат одного элемента дерева
 *
 * Один элемент может собрать несколько testcase (Структура сценария → строки Examples).
 */
export interface MappedResult {
	/** Итоговый статус: error > failed > passed; skipped — если все пропущены */
	status: 'passed' | 'failed' | 'error' | 'skipped';
	/** Суммарная длительность, мс (undefined, если ни один testcase не содержал time) */
	durationMs?: number;
	/** Сообщения падений (message + details), в порядке встречаемости */
	messages: string[];
}

/**
 * Результат сопоставления отчёта с деревом
 */
export interface MappingOutcome {
	/** Результаты по ID элементов */
	results: Map<string, MappedResult>;
	/** testcase, которые не удалось привязать ни к одному кейсу */
	unmatched: JUnitCase[];
}

/** Префиксы, которые инструменты дописывают к именам сценариев в отчётах */
const KNOWN_PREFIXES = [/^сценарий:\s*/i, /^scenario:\s*/i, /^структура сценария:\s*/i];

/** Ведущая нумерация вида «001. », «12) », «3 - » */
const LEADING_NUMBER_REGEX = /^\d+\s*[.)\-—]\s*/;

/**
 * Снимает известные префиксы и нумерацию с имени testcase
 */
function stripDecorations(name: string): string {
	let result = name.replace(LEADING_NUMBER_REGEX, '');
	for (const prefix of KNOWN_PREFIXES) {
		result = result.replace(prefix, '');
	}
	return result.trim();
}

/**
 * Находит ID известного кейса для testcase по убыванию строгости:
 * точное совпадение → без учёта регистра → без префиксов/нумерации → подстрока.
 *
 * @returns ID элемента или undefined
 */
function findMatch(
	junitName: string,
	exact: Map<string, string>,
	caseInsensitive: Map<string, string>,
	known: { id: string; normalized: string; lower: string }[]
): string | undefined {
	const normalized = normalizeTestName(junitName);

	const exactHit = exact.get(normalized);
	if (exactHit !== undefined) {
		return exactHit;
	}

	const lower = normalized.toLowerCase();
	const ciHit = caseInsensitive.get(lower);
	if (ciHit !== undefined) {
		return ciHit;
	}

	const stripped = stripDecorations(normalized).toLowerCase();
	if (stripped.length > 0) {
		const strippedHit = caseInsensitive.get(stripped);
		if (strippedHit !== undefined) {
			return strippedHit;
		}
	}

	// Подстрочное вхождение (последний рубеж): имя кейса содержится
	// в имени testcase или наоборот. Применяем ТОЛЬКО если кандидат
	// ровно один — иначе матч неоднозначен и легко привязать не к тому
	// (например, «ПроверкаЗаписи» содержится и в нём, и в «ПроверкаЗаписиДубль»).
	const candidates = known.filter(
		(candidate) =>
			candidate.lower.length >= 3 &&
			(lower.includes(candidate.lower) || candidate.lower.includes(lower))
	);
	return candidates.length === 1 ? candidates[0].id : undefined;
}

/**
 * Сопоставляет testcase из jUnit-отчёта с известными кейсами дерева
 *
 * @param junitCases - Результаты из отчёта
 * @param knownCases - Кейсы дерева (id + имя из исходника)
 * @returns Агрегированные результаты по ID и несматченные testcase
 */
export function mapResults(junitCases: JUnitCase[], knownCases: KnownCase[]): MappingOutcome {
	const exact = new Map<string, string>();
	const caseInsensitive = new Map<string, string>();
	const searchList: { id: string; normalized: string; lower: string }[] = [];

	for (const known of knownCases) {
		const normalized = normalizeTestName(known.caseName);
		const lower = normalized.toLowerCase();
		if (!exact.has(normalized)) {
			exact.set(normalized, known.id);
		}
		if (!caseInsensitive.has(lower)) {
			caseInsensitive.set(lower, known.id);
		}
		searchList.push({ id: known.id, normalized, lower });
	}

	const grouped = new Map<string, JUnitCase[]>();
	const unmatched: JUnitCase[] = [];

	for (const junitCase of junitCases) {
		const id = findMatch(junitCase.name, exact, caseInsensitive, searchList);
		if (id === undefined) {
			unmatched.push(junitCase);
			continue;
		}
		const bucket = grouped.get(id);
		if (bucket) {
			bucket.push(junitCase);
		} else {
			grouped.set(id, [junitCase]);
		}
	}

	const results = new Map<string, MappedResult>();
	for (const [id, bucket] of grouped) {
		results.set(id, aggregate(bucket));
	}

	return { results, unmatched };
}

/**
 * Агрегирует несколько testcase в один результат элемента
 */
function aggregate(bucket: JUnitCase[]): MappedResult {
	let status: MappedResult['status'] = 'skipped';
	let durationMs: number | undefined;
	const messages: string[] = [];

	const hasError = bucket.some((c) => c.status === 'error');
	const hasFailed = bucket.some((c) => c.status === 'failed');
	const hasPassed = bucket.some((c) => c.status === 'passed');

	if (hasError) {
		status = 'error';
	} else if (hasFailed) {
		status = 'failed';
	} else if (hasPassed) {
		status = 'passed';
	}

	for (const junitCase of bucket) {
		if (junitCase.timeMs !== undefined) {
			durationMs = (durationMs ?? 0) + junitCase.timeMs;
		}
		if (junitCase.status === 'failed' || junitCase.status === 'error') {
			const parts = [junitCase.message, junitCase.details].filter(
				(part): part is string => typeof part === 'string' && part.length > 0
			);
			messages.push(parts.length > 0 ? parts.join('\n') : 'Тест не пройден (без подробностей в отчёте)');
		}
	}

	return { status, durationMs, messages };
}
