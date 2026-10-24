/**
 * Модель профилей запуска.
 *
 * У профиля две половины, обе в корне проекта и обе необязательные:
 * - настройки vanessa-runner: `env.json` / `autumn-properties.json` (базовый) и
 *   `env.<id>.json` / `autumn-properties.<id>.json` (именованные). Именованный
 *   подставляется в команды vrunner через `--settings`; поверх можно задать
 *   временные параметры отдельными флагами;
 * - окружение: `.env` и `.env.<id>` с личными `.local`-парами. Переменные
 *   получает каждый процесс, который запускает расширение.
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
 * Личный файл настроек vanessa-runner 3: проектный autumn-properties.json
 * подключает его ключом `vrunner.settings`, профилем запуска он не считается.
 */
export const LOCAL_AUTUMN_FILE = 'autumn-properties.local.json';

/** Файл окружения профиля «По умолчанию»: его переменные действуют во всех профилях */
export const BASE_DOTENV_FILE = '.env';

/** Суффикс личного файла окружения (`.env.local`, `.env.<id>.local`) */
const LOCAL_DOTENV_SUFFIX = '.local';

/** Образцы вроде `.env.example`: их кладут в репозиторий для справки, профилями они не считаются */
const DOTENV_TEMPLATES = new Set(['example', 'sample', 'template', 'dist']);

const DOTENV_FILE_RE = /^\.env\.([A-Za-z0-9_.-]+)$/;

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

/**
 * Профиль запуска
 */
export interface EnvProfile {
	/** Идентификатор профиля ('default' — env.json, 'dev' — env.dev.json и т.п.) */
	id: string;
	/** Файл настроек, который читает vrunner: свой файл профиля или базовый */
	fileName: string;
	/** Подпись для UI */
	label: string;
	/** Признак базового профиля (env.json) */
	isBase: boolean;
	/** У профиля свой файл настроек; без него vrunner читает базовый */
	ownSettings: boolean;
	/** Свои файлы окружения профиля, от слабого к сильному */
	envFiles: string[];
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
	// личные файлы перекрытий, а не профили запуска
	if (trimmed === LOCAL_OVERRIDES_FILE || trimmed === LOCAL_AUTUMN_FILE) {
		return undefined;
	}
	const pattern = schema === 'v3' ? AUTUMN_FILE_RE : ENV_FILE_RE;
	const match = pattern.exec(trimmed);
	if (!match) {
		return undefined;
	}
	const id = match[1];
	if (id === undefined) {
		return baseProfile(schema, true);
	}
	return { id, fileName: trimmed, label: id, isBase: false, ownSettings: true, envFiles: [] };
}

function baseProfile(schema: SettingsSchema, ownSettings: boolean): EnvProfile {
	return {
		id: DEFAULT_PROFILE_ID,
		fileName: baseSettingsFileName(schema),
		label: DEFAULT_PROFILE_LABEL,
		isBase: true,
		ownSettings,
		envFiles: [],
	};
}

/**
 * Профиль, к которому относится файл окружения: `.env.ci` и `.env.ci.local` — профиль ci.
 *
 * @param fileName - Имя файла в корне проекта
 * @returns id именованного профиля; undefined для `.env`, `.env.local`, образцов и прочих файлов
 */
export function parseDotEnvFileName(fileName: string): string | undefined {
	const match = DOTENV_FILE_RE.exec(fileName.trim());
	if (!match || match[1] === LOCAL_DOTENV_SUFFIX.slice(1)) {
		return undefined;
	}
	const id = match[1].endsWith(LOCAL_DOTENV_SUFFIX) ? match[1].slice(0, -LOCAL_DOTENV_SUFFIX.length) : match[1];
	return id === '' || DOTENV_TEMPLATES.has(id.toLowerCase()) ? undefined : id;
}

/**
 * Свои файлы окружения профиля, от слабого к сильному: личный файл перекрывает общий.
 *
 * @param profileId - id профиля
 * @returns Имена файлов в корне проекта
 */
export function ownDotEnvFiles(profileId: string): string[] {
	const name = profileId === DEFAULT_PROFILE_ID ? BASE_DOTENV_FILE : `${BASE_DOTENV_FILE}.${profileId}`;
	return [name, `${name}${LOCAL_DOTENV_SUFFIX}`];
}

/**
 * Файлы окружения, которые действуют в профиле, от слабого к сильному:
 * сначала файлы профиля «По умолчанию», затем свои файлы профиля.
 *
 * @param profileId - id профиля
 * @returns Имена файлов в корне проекта (существование не проверяется)
 */
export function dotEnvFilesOf(profileId: string): string[] {
	const base = ownDotEnvFiles(DEFAULT_PROFILE_ID);
	return profileId === DEFAULT_PROFILE_ID ? base : [...base, ...ownDotEnvFiles(profileId)];
}

/**
 * Строит список профилей из имён файлов корня проекта
 *
 * Профиль появляется по своему файлу настроек (env.json → «По умолчанию»,
 * env.<id>.json → <id>) или по файлу окружения (`.env.<id>` → <id>). Проект без
 * vanessa-runner файлов настроек не читает: у него профиль «По умолчанию» есть
 * всегда. Дубликаты по id сливаются, сортировка: базовый первым, далее по алфавиту.
 *
 * @param fileNames - Имена файлов в корне проекта
 * @param schema - Схема настроек установленного vrunner
 * @param usesSettings - Проект работает с vanessa-runner и читает его файлы настроек
 * @returns Отсортированный список профилей
 */
export function buildEnvProfiles(fileNames: string[], schema: SettingsSchema = 'v2', usesSettings = true): EnvProfile[] {
	const byId = new Map<string, EnvProfile>();
	if (usesSettings) {
		for (const name of fileNames) {
			const profile = parseEnvFileName(name, schema);
			if (profile && !byId.has(profile.id)) {
				byId.set(profile.id, profile);
			}
		}
	} else {
		byId.set(DEFAULT_PROFILE_ID, baseProfile(schema, false));
	}
	for (const name of fileNames) {
		const id = parseDotEnvFileName(name);
		if (id !== undefined && !byId.has(id)) {
			byId.set(id, { id, fileName: baseSettingsFileName(schema), label: id, isBase: false, ownSettings: false, envFiles: [] });
		}
	}
	const present = new Set(fileNames);
	for (const profile of byId.values()) {
		profile.envFiles = ownDotEnvFiles(profile.id).filter((file) => present.has(file));
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
