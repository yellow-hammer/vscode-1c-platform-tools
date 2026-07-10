/**
 * Модель env-профилей запуска.
 *
 * Профиль — самодостаточный файл настроек vanessa-runner в корне проекта:
 * `env.json` (базовый) и `env.<id>.json` (именованные, например env.dev.json).
 * Активный профиль подставляется в команды vrunner через `--settings`; поверх
 * него можно задать временные параметры отдельными флагами.
 *
 * Модуль чистый (без vscode/fs).
 */

/**
 * Схема файлов настроек по мажорной версии vanessa-runner: 2.x читает env.json,
 * 3.x — autumn-properties.json (оба — из корня проекта автоматически).
 */
export type SettingsSchema = 'v2' | 'v3';

/** Имя файла профиля «По умолчанию» (vanessa-runner 2.x) */
export const BASE_ENV_FILE = 'env.json';

/** Имя файла профиля «По умолчанию» (vanessa-runner 3.x) */
export const BASE_AUTUMN_FILE = 'autumn-properties.json';

/**
 * Имя базового файла настроек для схемы.
 *
 * @param schema - Схема настроек (по версии vrunner)
 * @returns Имя базового файла в корне проекта
 */
export function baseSettingsFileName(schema: SettingsSchema): string {
	return schema === 'v3' ? BASE_AUTUMN_FILE : BASE_ENV_FILE;
}

/** id профиля «По умолчанию» (файл env.json) */
export const DEFAULT_PROFILE_ID = 'default';

/** Подпись профиля env.json */
export const DEFAULT_PROFILE_LABEL = 'По умолчанию';

/** Подпись состояния «базовый файл настроек ещё не создан» */
export const NO_SETTINGS_LABEL = 'Нет файла настроек';

/** Ключ хранения id активного профиля в workspaceState */
export const ACTIVE_ENV_PROFILE_KEY = '1c-platform-tools.activeEnvProfile';

/** Ключ хранения временных параметров активного профиля в workspaceState */
export const ACTIVE_ENV_OVERRIDES_KEY = '1c-platform-tools.activeEnvOverrides';

/**
 * Env-профиль запуска
 */
export interface EnvProfile {
	/** Идентификатор профиля ('default' — env.json, 'dev' — env.dev.json и т.п.) */
	id: string;
	/** Имя файла относительно корня проекта (например `env.dev.json`) */
	fileName: string;
	/** Подпись для UI */
	label: string;
	/** Признак базового профиля (env.json) */
	isBase: boolean;
}

/**
 * Временные параметры поверх активного профиля.
 *
 * Пустые поля не передаются — значение берётся из файла профиля.
 */
export interface EnvOverrides {
	/** Строка подключения к ИБ (--ibconnection) */
	ibConnection?: string;
	/** Пользователь ИБ (--db-user) */
	dbUser?: string;
	/** Пароль пользователя ИБ (--db-pwd) */
	dbPwd?: string;
	/** Версия платформы (--v8version) */
	v8version?: string;
	/** Дополнительные параметры запуска (--additional) */
	additional?: string;
}

const ENV_FILE_RE = /^env(?:\.([A-Za-z0-9_.-]+))?\.json$/;
const AUTUMN_FILE_RE = /^autumn-properties(?:\.([A-Za-z0-9_.-]+))?\.json$/;

/**
 * Разбирает имя файла в профиль запуска.
 *
 * Шаблон зависит от схемы: `env[.<id>].json` для vanessa-runner 2.x,
 * `autumn-properties[.<id>].json` для 3.x.
 *
 * @param fileName - Имя файла (например `env.dev.json` или `autumn-properties.ci.json`)
 * @param schema - Схема настроек (по умолчанию 2.x)
 * @returns Профиль или undefined, если имя не соответствует шаблону
 */
export function parseEnvFileName(fileName: string, schema: SettingsSchema = 'v2'): EnvProfile | undefined {
	const pattern = schema === 'v3' ? AUTUMN_FILE_RE : ENV_FILE_RE;
	const match = pattern.exec(fileName.trim());
	if (!match) {
		return undefined;
	}
	const id = match[1];
	if (id === undefined) {
		return { id: DEFAULT_PROFILE_ID, fileName: baseSettingsFileName(schema), label: DEFAULT_PROFILE_LABEL, isBase: true };
	}
	return { id, fileName, label: id, isBase: false };
}

/**
 * Строит список профилей из имён файлов корня проекта
 *
 * Возвращаются только профили для реально существующих файлов (env.json → «По
 * умолчанию», env.<id>.json → <id>). Дубликаты по id отбрасываются, сортировка:
 * env.json первым, далее по алфавиту.
 *
 * @param fileNames - Имена файлов в корне проекта
 * @returns Отсортированный список профилей
 */
export function buildEnvProfiles(fileNames: string[], schema: SettingsSchema = 'v2'): EnvProfile[] {
	const byId = new Map<string, EnvProfile>();
	for (const name of fileNames) {
		const profile = parseEnvFileName(name, schema);
		if (profile && !byId.has(profile.id)) {
			byId.set(profile.id, profile);
		}
	}
	return [...byId.values()].sort((a, b) => {
		if (a.isBase) {
			return -1;
		}
		if (b.isBase) {
			return 1;
		}
		return a.id.localeCompare(b.id);
	});
}

/**
 * Возвращает имя файла активного профиля
 *
 * Если профиль с указанным id не найден среди доступных — возвращается базовый
 * `env.json` (безопасный дефолт, полная обратная совместимость).
 *
 * @param activeId - Идентификатор активного профиля (из workspaceState/настроек)
 * @param profiles - Доступные профили (см. {@link buildEnvProfiles})
 * @returns Имя файла профиля относительно корня проекта
 */
export function resolveActiveEnvFileName(
	activeId: string | undefined,
	profiles: EnvProfile[],
	schema: SettingsSchema = 'v2'
): string {
	if (activeId) {
		const found = profiles.find((profile) => profile.id === activeId);
		if (found) {
			return found.fileName;
		}
	}
	return baseSettingsFileName(schema);
}

/**
 * Подпись активного профиля для UI
 *
 * @param activeId - id активного профиля
 * @param profiles - Доступные профили (только для существующих файлов настроек)
 * @returns Подпись профиля; если файла активного профиля нет — «Нет файла настроек»
 */
export function activeProfileLabel(activeId: string | undefined, profiles: EnvProfile[]): string {
	if (activeId) {
		const found = profiles.find((profile) => profile.id === activeId);
		if (found) {
			return found.label;
		}
	}
	return NO_SETTINGS_LABEL;
}

/**
 * Строит массив флагов vrunner для временных параметров
 *
 * Передаются только заданные (непустые) поля — остальное берётся из файла профиля.
 *
 * @param overrides - Временные параметры или undefined
 * @returns Массив аргументов vrunner (может быть пустым)
 */
export function buildOverrideArgs(overrides: EnvOverrides | undefined): string[] {
	if (!overrides) {
		return [];
	}
	const args: string[] = [];
	if (overrides.ibConnection) {
		args.push('--ibconnection', overrides.ibConnection);
	}
	if (overrides.dbUser) {
		args.push('--db-user', overrides.dbUser);
	}
	if (overrides.dbPwd) {
		args.push('--db-pwd', overrides.dbPwd);
	}
	if (overrides.v8version) {
		args.push('--v8version', overrides.v8version);
	}
	if (overrides.additional) {
		args.push('--additional', overrides.additional);
	}
	return args;
}

/**
 * Признак наличия непустых временных параметров
 *
 * @param overrides - Временные параметры или undefined
 * @returns true, если задано хотя бы одно поле
 */
export function hasOverrides(overrides: EnvOverrides | undefined): boolean {
	return buildOverrideArgs(overrides).length > 0;
}
