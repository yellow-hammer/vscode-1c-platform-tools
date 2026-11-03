/**
 * Разбор JSON-отчётов depos: `check` и `doctor`.
 *
 * Поля — сериализация depos (`packageName`, `currentMinVersion`, `sections`).
 * Модуль чистый.
 * @module deposReport
 */

/** Целевая версия из `depos check`: минимум в манифесте и найденная. */
export interface DeposVersionUpdate {
	currentMin: string;
	targetMin: string;
}

/** Строка отчёта `check` или `upgrade`. */
export interface DeposVersionChange {
	name: string;
	dev: boolean;
	currentMin: string;
	targetMin: string;
}

/** Замечание depos по пакету. */
export interface DeposPackageProblem {
	/** Тип из отчёта depos, например `НеУстановлен`. */
	code: string;
	/** Короткий текст для строки дерева. */
	text: string;
	/** Проблема, а не рекомендация. */
	severity: 'problem' | 'hint';
	/** Подробности для подсказки. */
	detail?: string;
}

const PROBLEM_LABELS: Readonly<Record<string, { text: string; severity: 'problem' | 'hint' }>> = {
	ОтсутствуетВМанифесте: { text: 'нет в packagedef', severity: 'problem' },
	НеИспользуетсяНапрямую: { text: 'не используется в коде', severity: 'hint' },
	ПометкаТранзитивностиНеПодтверждена: { text: 'пометка не подтверждена', severity: 'problem' },
	НеУстановлен: { text: 'не установлен', severity: 'problem' },
	Поврежден: { text: 'повреждён', severity: 'problem' },
	НесоответствиеВерсий: { text: 'версия не совпадает', severity: 'problem' },
	НесовместимостьВерсийДвижка: { text: 'нужен новее OneScript', severity: 'problem' },
	ТранзитивныйКонфликт: { text: 'конфликт версий', severity: 'problem' },
	РекомендацияВерсии: { text: 'ограничение версии лишнее', severity: 'hint' },
};

/** Прямая зависимость есть в packagedef, каталога в `oscript_modules` нет. */
export function notInstalledProblem(): DeposPackageProblem {
	const known = PROBLEM_LABELS.НеУстановлен;
	return { code: 'НеУстановлен', text: known.text, severity: known.severity };
}

/**
 * Строки JSON `depos check` и `depos upgrade`.
 *
 * @param text - Содержимое файла отчёта
 * @returns undefined, если это не отчёт
 */
export function parseDeposChanges(text: string): DeposVersionChange[] | undefined {
	const parsed = parseJson(text);
	if (!Array.isArray(parsed)) {
		return undefined;
	}
	const changes: DeposVersionChange[] = [];
	for (const item of parsed) {
		if (!isRecord(item)) {
			continue;
		}
		const name = textOf(item['packageName']);
		if (name === undefined) {
			continue;
		}
		changes.push({
			name,
			dev: item['isDev'] === true,
			currentMin: textOf(item['currentMinVersion']) ?? '',
			targetMin: textOf(item['targetMinVersion']) ?? '',
		});
	}
	return changes;
}

/**
 * Обновления из JSON `depos check --format json`.
 *
 * @param text - Содержимое файла отчёта
 * @returns Имя пакета в нижнем регистре → версии; undefined, если это не отчёт
 */
export function parseDeposCheck(text: string): Map<string, DeposVersionUpdate> | undefined {
	const changes = parseDeposChanges(text);
	if (changes === undefined) {
		return undefined;
	}
	const updates = new Map<string, DeposVersionUpdate>();
	for (const change of changes) {
		const key = change.name.toLowerCase();
		const existing = updates.get(key);
		if (existing === undefined || !change.dev) {
			updates.set(key, { currentMin: change.currentMin, targetMin: change.targetMin });
		}
	}
	return updates;
}

/** Замечания одного пакета из отчёта doctor, с именем как в отчёте. */
export interface DeposPackageDiagnosis {
	name: string;
	problems: DeposPackageProblem[];
}

/**
 * Замечания из JSON `depos doctor --format json`.
 *
 * @param text - Содержимое файла отчёта
 * @returns Имя пакета в нижнем регистре → замечания; undefined, если это не отчёт
 */
export function parseDeposDoctor(text: string): Map<string, DeposPackageDiagnosis> | undefined {
	const parsed = parseJson(text);
	if (!isRecord(parsed) || !Array.isArray(parsed['sections'])) {
		return undefined;
	}
	const problems = new Map<string, DeposPackageDiagnosis>();
	for (const section of parsed['sections']) {
		if (!isRecord(section) || !Array.isArray(section['items'])) {
			continue;
		}
		for (const item of section['items']) {
			if (!isRecord(item)) {
				continue;
			}
			const name = textOf(item['packageName']);
			if (name === undefined) {
				continue;
			}
			const key = name.toLowerCase();
			const diagnosis = problems.get(key) ?? { name, problems: [] };
			diagnosis.problems.push(problemOf(item));
			problems.set(key, diagnosis);
		}
	}
	return problems;
}

function problemOf(item: Record<string, unknown>): DeposPackageProblem {
	const type = textOf(item['type']) ?? '';
	const known = PROBLEM_LABELS[type];
	const summary = textOf(item['summary']);
	const severity = item['isProblem'] === false ? 'hint' : (known?.severity ?? 'problem');
	const code = type === '' ? 'замечание' : type;
	const text = known?.text ?? summary ?? code;
	const detailParts = [summary, textOf(item['reason']), versionDetail(item), chainDetail(item['requirements'])]
		.filter((part): part is string => part !== undefined && part !== '' && part !== text);
	const detail = [...new Set(detailParts)].join('\n');
	return detail === '' ? { code, text, severity } : { code, text, severity, detail };
}

function versionDetail(item: Record<string, unknown>): string | undefined {
	const installed = textOf(item['installedVersion']);
	const required = textOf(item['requiredVersion']);
	const parts: string[] = [];
	if (installed !== undefined) {
		parts.push(`установлено ${installed}`);
	}
	if (required !== undefined) {
		parts.push(`в packagedef ${required}`);
	}
	return parts.length > 0 ? parts.join(', ') : undefined;
}

function chainDetail(value: unknown): string | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const lines: string[] = [];
	for (const item of value) {
		if (!isRecord(item) || !Array.isArray(item['dependencyChain'])) {
			continue;
		}
		const chain = item['dependencyChain'].filter((part): part is string => typeof part === 'string' && part !== '');
		if (chain.length > 0) {
			lines.push(chain.join(' → '));
		}
	}
	return lines.length > 0 ? lines.join('\n') : undefined;
}

function parseJson(text: string): unknown {
	const body = text.replace(/^\uFEFF/, '').trim();
	if (body === '') {
		return undefined;
	}
	try {
		return JSON.parse(body) as unknown;
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed === '' ? undefined : trimmed;
}
