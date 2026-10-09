/**
 * Разбор одного файла профилей тестов OneScript.
 *
 * Переменные лежат в `env`. Рядом с ним у профиля может быть описание
 * и другие ключи: они не становятся переменными среды.
 */

import * as path from 'node:path';

/** Общий файл профилей, его коммитят. */
export const ONESCRIPT_TESTS_FILE = path.join('.vscode', 'onescript-tests.json');

/** Личный файл поверх общего. В git не входит. */
export const ONESCRIPT_TESTS_LOCAL_FILE = path.join('.vscode', 'onescript-tests.local.json');

/** Нейтральный шаблон: один профиль-пример, без паролей. */
export const ONESCRIPT_TESTS_TEMPLATE = `{
	"profiles": {
		"example": {
			"description": "Пример профиля",
			"env": {
				"EXAMPLE": "1"
			}
		}
	}
}
`;

/** Значение переменной: строка, число, логическое или снятие. */
export type EnvPrimitive = string | number | boolean | null;

/** Набор переменных. */
export type EnvMap = Record<string, EnvPrimitive>;

/** Один профиль. */
export interface OnescriptProfile {
	description?: string;
	env: EnvMap;
}

/** Разобранный файл. */
export interface OnescriptProfileFile {
	env: EnvMap;
	profiles: Record<string, OnescriptProfile>;
}

/** Ошибка разбора. */
export interface OnescriptProfileFileError {
	error: string;
}

/** Результат чтения файла с диска. */
export type OnescriptFileRead =
	| { kind: 'missing' }
	| { kind: 'error'; error: string }
	| { kind: 'file'; file: OnescriptProfileFile };

/** Последняя удачная загрузка и текст ошибки текущего файла. */
export interface OnescriptProfilesLoad {
	file: OnescriptProfileFile;
	/** Файл есть, но текущий текст не разобран. Профили остаются прежними. */
	broken?: string;
	/** Хотя бы один из файлов есть. */
	hasFile: boolean;
}

const RESERVED_ENV = 'OVM_OSCRIPTBIN';

/**
 * Разбирает текст одного файла.
 *
 * @param text - Содержимое файла
 * @returns Файл либо текст ошибки
 */
export function parseOnescriptProfileFile(text: string): OnescriptProfileFile | OnescriptProfileFileError {
	let value: unknown;
	try {
		value = JSON.parse(text) as unknown;
	} catch {
		return { error: 'Файл профилей тестов OneScript не разобран' };
	}
	if (!isRecord(value)) {
		return { error: 'В файле профилей тестов OneScript нет объекта profiles' };
	}
	const parsedEnv = parseEnvMap(value.env, 'общие переменные');
	if ('error' in parsedEnv) {
		return parsedEnv;
	}
	const env = parsedEnv.env;
	if (value.profiles !== undefined && !isRecord(value.profiles)) {
		return { error: 'В файле профилей тестов OneScript нет объекта profiles' };
	}
	const profiles: Record<string, OnescriptProfile> = {};
	const seen = new Set<string>();
	for (const [rawName, body] of Object.entries(value.profiles ?? {})) {
		const name = rawName.trim();
		if (name === '') {
			return { error: 'У профиля пустое имя' };
		}
		if (seen.has(name)) {
			return { error: `Профиль «${name}» задан дважды` };
		}
		seen.add(name);
		if (!isRecord(body)) {
			return { error: `Профиль «${name}» должен быть объектом` };
		}
		if (body.description !== undefined && typeof body.description !== 'string') {
			return { error: `Описание профиля «${name}» должно быть строкой` };
		}
		const parsedProfileEnv = parseEnvMap(body.env ?? {}, `профиль «${name}»`);
		if ('error' in parsedProfileEnv) {
			return parsedProfileEnv;
		}
		profiles[name] = {
			...(typeof body.description === 'string' ? { description: body.description } : {}),
			env: parsedProfileEnv.env,
		};
	}
	return { env, profiles };
}

/**
 * Накладывает личный файл на общий. Ключ личного файла сильнее.
 *
 * @param common - Общий файл; нет файла — пустой набор
 * @param local - Личный файл; нет файла — пустой набор
 */
export function mergeOnescriptProfileFiles(
	common: OnescriptProfileFile | undefined,
	local: OnescriptProfileFile | undefined
): OnescriptProfileFile {
	const env = { ...(common?.env ?? {}), ...(local?.env ?? {}) };
	const names = new Set([
		...Object.keys(common?.profiles ?? {}),
		...Object.keys(local?.profiles ?? {}),
	]);
	const profiles: Record<string, OnescriptProfile> = {};
	for (const name of names) {
		const base = common?.profiles[name];
		const over = local?.profiles[name];
		profiles[name] = {
			...(over?.description !== undefined
				? { description: over.description }
				: base?.description !== undefined
					? { description: base.description }
					: {}),
			env: { ...(base?.env ?? {}), ...(over?.env ?? {}) },
		};
	}
	return { env, profiles };
}

/**
 * Следующая загрузка. Ошибка разбора оставляет прежние профили.
 *
 * @param previous - Профили последней удачной загрузки
 * @param common - Чтение общего файла
 * @param local - Чтение личного файла
 */
export function nextOnescriptProfilesLoad(
	previous: OnescriptProfileFile,
	common: OnescriptFileRead,
	local: OnescriptFileRead
): OnescriptProfilesLoad {
	const hasFile = common.kind !== 'missing' || local.kind !== 'missing';
	if (!hasFile) {
		return { file: { env: {}, profiles: {} }, hasFile: false };
	}
	const error = common.kind === 'error' ? common.error : local.kind === 'error' ? local.error : undefined;
	if (error !== undefined) {
		return { file: previous, broken: error, hasFile: true };
	}
	return {
		file: mergeOnescriptProfileFiles(
			common.kind === 'file' ? common.file : undefined,
			local.kind === 'file' ? local.file : undefined
		),
		hasFile: true,
	};
}

function parseEnvMap(value: unknown, where: string): { env: EnvMap } | OnescriptProfileFileError {
	if (value === undefined) {
		return { env: {} };
	}
	if (!isRecord(value)) {
		return { error: `В файле профилей тестов OneScript нет объекта env (${where})` };
	}
	const env: EnvMap = {};
	for (const [rawName, variable] of Object.entries(value)) {
		const name = rawName.trim();
		if (name === '') {
			return { error: `Пустое имя переменной (${where})` };
		}
		if (name.toUpperCase() === RESERVED_ENV) {
			return { error: `Профиль не задаёт ${name}: каталог OneScript выбирает расширение` };
		}
		if (!isEnvPrimitive(variable)) {
			return { error: `Переменная ${name} (${where}) должна быть строкой, числом, логическим или null` };
		}
		env[name] = variable;
	}
	return { env };
}

function isEnvPrimitive(value: unknown): value is EnvPrimitive {
	return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
