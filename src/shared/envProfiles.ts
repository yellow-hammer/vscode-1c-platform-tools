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

import { quoteFileIbConnection } from './ibConnectionPath';

/**
 * Схема файлов настроек по мажорной версии vanessa-runner: 2.x читает env.json,
 * 3.x — autumn-properties.json (оба — из корня проекта автоматически).
 */
export type SettingsSchema = 'v2' | 'v3';

/** Имя файла профиля «По умолчанию» (vanessa-runner 2.x) */
export const BASE_ENV_FILE = 'env.json';

/**
 * Файл локальных перекрытий активного профиля (в .gitignore, не коммитится).
 *
 * Значения из него применяются поверх активного профиля так же, как временные
 * параметры из интерфейса, но задаются программно — скриптами и git-хуками.
 * Имя зарезервировано: профилем запуска «local» этот файл не считается.
 */
export const LOCAL_OVERRIDES_FILE = 'env.local.json';

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
	const trimmed = fileName.trim();
	// env.local.json — файл локальных перекрытий, а не профиль запуска
	if (trimmed === LOCAL_OVERRIDES_FILE) {
		return undefined;
	}
	const pattern = schema === 'v3' ? AUTUMN_FILE_RE : ENV_FILE_RE;
	const match = pattern.exec(trimmed);
	if (!match) {
		return undefined;
	}
	const id = match[1];
	if (id === undefined) {
		return { id: DEFAULT_PROFILE_ID, fileName: baseSettingsFileName(schema), label: DEFAULT_PROFILE_LABEL, isBase: true };
	}
	return { id, fileName: trimmed, label: id, isBase: false };
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
 * Поля временных параметров по имени опции vrunner (без префикса `--`).
 *
 * Единственный источник истины для набора перекрываемых опций: из него строятся
 * и флаги команд (см. {@link buildOverrideArgs}), и разбор env.local.json
 * (см. {@link parseLocalOverrides}). Порядок ключей — порядок флагов.
 */
const OVERRIDE_FIELD_BY_OPTION: Record<string, keyof EnvOverrides> = {
	ibconnection: 'ibConnection',
	'db-user': 'dbUser',
	'db-pwd': 'dbPwd',
	v8version: 'v8version',
	additional: 'additional',
};

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
	for (const [option, field] of Object.entries(OVERRIDE_FIELD_BY_OPTION)) {
		const value = overrides[field];
		if (value) {
			args.push(`--${option}`, field === 'ibConnection' ? quoteFileIbConnection(value) : value);
		}
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

/** Разобранное содержимое файла локальных перекрытий */
export interface LocalOverridesParseResult {
	/** Поддержанные перекрытия (только непустые строки) */
	overrides: EnvOverrides;
	/** Ключи, которые расширение не умеет передавать флагами (для журнала) */
	ignoredKeys: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Разбирает содержимое env.local.json во временные параметры.
 *
 * Основной формат — плоский объект с флагами vrunner (`"--ibconnection": …`);
 * для копирования из файла профиля принимаются и обёртки `{"default": {…}}`
 * (схема 2.x) и `{"vrunner": {…}}` (3.x). Имена ключей допускаются с `--` и
 * без. Применяются только опции, которые расширение умеет передавать флагами
 * поверх профиля (те же, что у временных параметров интерфейса); остальные
 * ключи возвращаются в ignoredKeys — молчаливое игнорирование прятало бы
 * опечатки.
 *
 * @param parsed - Разобранный JSON файла перекрытий
 * @returns Перекрытия и список неподдержанных ключей
 */
export function parseLocalOverrides(parsed: unknown): LocalOverridesParseResult {
	if (!isPlainObject(parsed)) {
		return { overrides: {}, ignoredKeys: [] };
	}
	let source = parsed;
	if (isPlainObject(parsed.default)) {
		source = parsed.default;
	} else if (isPlainObject(parsed.vrunner)) {
		source = parsed.vrunner;
	}
	const overrides: EnvOverrides = {};
	const ignoredKeys: string[] = [];
	for (const [rawKey, value] of Object.entries(source)) {
		if (rawKey === '$schema') {
			continue;
		}
		const field = OVERRIDE_FIELD_BY_OPTION[rawKey.replace(/^--/, '').toLowerCase()];
		if (!field) {
			ignoredKeys.push(rawKey);
			continue;
		}
		if (typeof value !== 'string') {
			ignoredKeys.push(rawKey);
			continue;
		}
		// пустая строка — «не перекрывать», как пустое поле временных параметров
		if (value.trim()) {
			overrides[field] = value.trim();
		}
	}
	return { overrides, ignoredKeys };
}

/**
 * Сливает два набора перекрытий: непустые поля `over` побеждают поля `base`.
 *
 * Порядок приоритета собирается последовательными вызовами: значения профиля
 * с переменными ← env.local.json ← временные параметры интерфейса.
 *
 * @param base - Нижний слой (может быть undefined)
 * @param over - Верхний слой, его поля важнее (может быть undefined)
 * @returns Слитые перекрытия или undefined, если оба слоя пусты
 */
export function mergeEnvOverrides(
	base: EnvOverrides | undefined,
	over: EnvOverrides | undefined
): EnvOverrides | undefined {
	if (!base && !over) {
		return undefined;
	}
	const merged: EnvOverrides = {};
	for (const field of Object.values(OVERRIDE_FIELD_BY_OPTION)) {
		const value = over?.[field] || base?.[field];
		if (value) {
			merged[field] = value;
		}
	}
	return hasOverrides(merged) ? merged : undefined;
}

/** Формат файла настроек vanessa-runner по его содержимому. */
export type SettingsFileFormat = 'v2' | 'v3' | 'unknown';

/**
 * Определяет формат файла настроек по разобранному содержимому.
 *
 * Корневой ключ `vrunner` означает формат 3.x, плоские секции - 2.x. Файл
 * чужого формата ронял бы команду, поэтому формат проверяется до вызова.
 *
 * @param parsed - Разобранное содержимое файла настроек
 * @returns Формат файла или 'unknown', если содержимое не похоже на настройки
 */
export function detectSettingsFormat(parsed: unknown): SettingsFileFormat {
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return 'unknown';
	}
	return 'vrunner' in parsed ? 'v3' : 'v2';
}
