/**
 * Подстановка переменных в значениях профиля запуска.
 *
 * Поддерживается `${gitBranch}` — имя текущей ветки git, приведённое к
 * безопасному имени каталога. Значение вычисляется в момент запуска команды
 * по `.git/HEAD`, поэтому переключение ветки подхватывается без перезагрузки
 * окна и без слежения за HEAD. Незнакомые `${…}` не трогаются: в параметрах
 * запуска 1С встречаются свои конструкции с `$`.
 *
 * Модуль чистый (без vscode/fs) — чтение `.git/HEAD` в gitHead.ts.
 */

/** Переменная имени ветки git в значениях профиля запуска */
export const GIT_BRANCH_VARIABLE = '${gitBranch}';

const GIT_BRANCH_VARIABLE_RE = /\$\{gitBranch\}/g;

/** Число символов хэша коммита для отсоединённого HEAD */
const DETACHED_SHA_LENGTH = 8;

/** Предел длины имени каталога из имени ветки */
const BRANCH_DIR_NAME_LIMIT = 64;

/** Зарезервированные имена файлов Windows: каталог с таким именем не создать */
const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Содержит ли значение переменную `${gitBranch}`
 *
 * @param value - Значение опции профиля
 * @returns true, если подстановка потребуется
 */
export function containsGitBranchVariable(value: string): boolean {
	return value.includes(GIT_BRANCH_VARIABLE);
}

/**
 * Приводит имя ветки git к безопасному имени каталога.
 *
 * Правило нормализации (предсказуемо и стабильно):
 * - буквы и цифры (включая кириллицу), `.`, `_`, `-` остаются как есть,
 *   регистр сохраняется;
 * - остальные символы (слэши, пробелы, `:*?"<>|` и т.п.) сворачиваются в `-`;
 * - дефисы не повторяются, ведущие/замыкающие `-` и `.` обрезаются;
 * - длина ограничена 64 символами;
 * - зарезервированные имена Windows (nul, con, com1…) получают префикс `git-`.
 *
 * `feature/RS-123` → `feature-RS-123`.
 *
 * @param raw - Имя ветки git как есть
 * @returns Безопасное имя каталога (непустое)
 */
export function normalizeBranchDirName(raw: string): string {
	let name = raw.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-');
	name = name.replace(/-{2,}/g, '-');
	name = name.replace(/^[-.]+|[-.]+$/g, '');
	if (name.length > BRANCH_DIR_NAME_LIMIT) {
		name = name.slice(0, BRANCH_DIR_NAME_LIMIT).replace(/[-.]+$/g, '');
	}
	if (!name) {
		return 'branch';
	}
	if (WINDOWS_RESERVED_RE.test(name)) {
		return `git-${name}`;
	}
	return name;
}

/** Состояние HEAD репозитория: ветка или хэш коммита (отсоединённый HEAD) */
export interface GitHeadState {
	/** Имя ветки (например `feature/RS-123`) */
	branch?: string;
	/** Хэш коммита при отсоединённом HEAD */
	sha?: string;
}

/**
 * Разбирает содержимое файла `.git/HEAD`.
 *
 * Символическая ссылка `ref: refs/heads/<ветка>` означает обычное состояние,
 * голый хэш — отсоединённый HEAD (checkout коммита или тега).
 *
 * @param content - Содержимое файла HEAD
 * @returns Состояние HEAD или undefined, если содержимое не распознано
 */
export function parseGitHead(content: string): GitHeadState | undefined {
	const trimmed = content.trim();
	if (trimmed.startsWith('ref:')) {
		const ref = trimmed.slice(4).trim();
		const branch = ref.replace(/^refs\/heads\//, '');
		return branch ? { branch } : undefined;
	}
	if (/^[0-9a-f]{40,64}$/i.test(trimmed)) {
		return { sha: trimmed.toLowerCase() };
	}
	return undefined;
}

/**
 * Имя каталога для состояния HEAD: нормализованная ветка, для отсоединённого
 * HEAD — первые 8 символов хэша коммита (путь остаётся уникальным и стабильным
 * для конкретного checkout).
 *
 * @param head - Состояние HEAD (см. {@link parseGitHead})
 * @returns Имя каталога или undefined
 */
export function branchDirNameFromHead(head: GitHeadState | undefined): string | undefined {
	if (head?.branch) {
		return normalizeBranchDirName(head.branch);
	}
	if (head?.sha) {
		return head.sha.slice(0, DETACHED_SHA_LENGTH);
	}
	return undefined;
}

/**
 * Подставляет имя ветки во все вхождения `${gitBranch}`.
 *
 * @param value - Значение опции профиля
 * @param branchDirName - Имя каталога ветки (см. {@link branchDirNameFromHead})
 * @returns Значение с подставленной веткой
 */
export function substituteGitBranch(value: string, branchDirName: string): string {
	return value.replace(GIT_BRANCH_VARIABLE_RE, branchDirName);
}
