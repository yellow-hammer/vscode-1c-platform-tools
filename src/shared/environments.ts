/**
 * Окружения запуска: переменные среды из файлов `.env` в корне проекта.
 *
 * Общий `.env` и личный `.env.local` действуют всегда. Выбранное окружение
 * `<id>` накладывает поверх них `.env.<id>` и личный `.env.<id>.local`.
 * Окружение выбирается отдельно от профиля запуска: профиль задаёт файл
 * настроек vanessa-runner, окружение — переменные процессов, которые
 * запускает расширение.
 *
 * Модуль чистый (без vscode/fs).
 */

/** Общий файл окружения: действует при любом выбранном окружении */
export const BASE_DOTENV_FILE = '.env';

/** Суффикс личного файла окружения (`.env.local`, `.env.<id>.local`) */
const LOCAL_SUFFIX = '.local';

/** Образцы вроде `.env.example`: их кладут в репозиторий для справки, окружениями они не считаются */
const TEMPLATES = new Set(['example', 'sample', 'template', 'dist']);

const NAMED_FILE_RE = /^\.env\.([A-Za-z0-9_.-]+)$/;

/** Подпись окружения без выбранного: действуют общие `.env` и `.env.local` */
export const DEFAULT_ENVIRONMENT_LABEL = 'По умолчанию';

/** Подпись окружения без выбранного и без общих файлов */
export const NO_ENVIRONMENT_FILE_LABEL = 'Нет файла окружения';

/** Окружение проекта. */
export interface Environment {
	/** Имя окружения: `.env.ci` → ci */
	id: string;
	/** Файлы окружения в проекте, от слабого к сильному */
	files: string[];
}

/**
 * Окружение, к которому относится файл: `.env.ci` и `.env.ci.local` — окружение ci.
 *
 * @param fileName - Имя файла в корне проекта
 * @returns Имя окружения; undefined для общих файлов, образцов и прочих имён
 */
export function parseEnvironmentFileName(fileName: string): string | undefined {
	const match = NAMED_FILE_RE.exec(fileName.trim());
	if (!match || match[1] === LOCAL_SUFFIX.slice(1)) {
		return undefined;
	}
	const id = match[1].endsWith(LOCAL_SUFFIX) ? match[1].slice(0, -LOCAL_SUFFIX.length) : match[1];
	return id === '' || TEMPLATES.has(id.toLowerCase()) ? undefined : id;
}

/**
 * Годится ли имя для нового окружения: файл `.env.<имя>` должен читаться как
 * окружение с тем же именем.
 *
 * @param id - Имя окружения
 */
export function isEnvironmentId(id: string): boolean {
	return parseEnvironmentFileName(`${BASE_DOTENV_FILE}.${id}`) === id;
}

/**
 * Свои файлы окружения от слабого к сильному: личный файл перекрывает общий.
 *
 * @param id - Имя окружения; без него — общие файлы
 * @returns Имена файлов в корне проекта
 */
export function ownEnvironmentFiles(id?: string): string[] {
	const name = id === undefined ? BASE_DOTENV_FILE : `${BASE_DOTENV_FILE}.${id}`;
	return [name, `${name}${LOCAL_SUFFIX}`];
}

/**
 * Файлы, которые действуют при выбранном окружении, от слабого к сильному:
 * сначала общие, затем свои файлы окружения.
 *
 * @param id - Выбранное окружение; без него — только общие файлы
 * @returns Имена файлов в корне проекта (существование не проверяется)
 */
export function environmentFiles(id?: string): string[] {
	return id === undefined ? ownEnvironmentFiles() : [...ownEnvironmentFiles(), ...ownEnvironmentFiles(id)];
}

/**
 * Окружения проекта по именам файлов его корня, по алфавиту.
 *
 * @param fileNames - Имена файлов в корне проекта
 * @returns Окружения с их файлами
 */
export function buildEnvironments(fileNames: readonly string[]): Environment[] {
	const present = new Set(fileNames);
	const ids = new Set<string>();
	for (const name of fileNames) {
		const id = parseEnvironmentFileName(name);
		if (id !== undefined) {
			ids.add(id);
		}
	}
	return [...ids]
		.sort((a, b) => a.localeCompare(b))
		.map((id) => ({ id, files: ownEnvironmentFiles(id).filter((file) => present.has(file)) }));
}

/**
 * Текст нового файла окружения: переменные, которые читает код проекта, —
 * закомментированными строками, чтобы файл ничего не менял, пока их не зададут.
 *
 * @param variables - Имена переменных из кода проекта
 */
export function newEnvironmentText(variables: readonly string[]): string {
	if (variables.length === 0) {
		return '# ИМЯ=значение\n';
	}
	return ['# Переменные, которые читает код проекта', ...variables.map((name) => `# ${name}=`), ''].join('\n');
}

/**
 * Подпись окружения, как у профиля: имя выбранного; без выбранного — «По умолчанию»,
 * если есть общий файл, иначе «Нет файла окружения».
 *
 * @param id - Выбранное окружение
 * @param files - Файлы окружения, которые есть в проекте
 */
export function environmentLabel(id: string | undefined, files: readonly string[]): string {
	if (id !== undefined) {
		return id;
	}
	return files.length > 0 ? DEFAULT_ENVIRONMENT_LABEL : NO_ENVIRONMENT_FILE_LABEL;
}
