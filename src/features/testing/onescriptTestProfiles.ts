/**
 * Профили переменных среды прогона тестов OneScript.
 *
 * Файл проекта задаёт именованные наборы. Активный профиль выбирается в панели
 * тестов и в состояние проекта не коммитится. На тесты 1С набор не действует.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Пустой файл профилей. Имена и переменные пишет проект. */
export const ONESCRIPT_TEST_PROFILES_EMPTY = `{
	"profiles": {}
}
`;

/** Файл профилей относительно корня проекта. */
export const ONESCRIPT_TEST_PROFILES_FILE = path.join('.vscode', 'onescript-tests.json');

/** Разобранные профили: имя → переменные среды. */
export interface OnescriptTestProfiles {
	profiles: Record<string, Record<string, string>>;
}

/** Ошибка разбора файла профилей. */
export interface OnescriptTestProfilesError {
	error: string;
}

/**
 * Абсолютный путь файла профилей.
 *
 * @param root - Корень проекта
 */
export function onescriptTestProfilesPath(root: string): string {
	return path.join(root, ONESCRIPT_TEST_PROFILES_FILE);
}

/**
 * Разбирает текст файла профилей.
 *
 * @param text - Содержимое `.vscode/onescript-tests.json`
 * @returns Профили либо текст ошибки
 */
export function parseOnescriptTestProfiles(text: string): OnescriptTestProfiles | OnescriptTestProfilesError {
	let value: unknown;
	try {
		value = JSON.parse(text) as unknown;
	} catch {
		return { error: 'Файл профилей тестов OneScript не разобран' };
	}
	if (!isRecord(value)) {
		return { error: 'В файле профилей тестов OneScript нет объекта profiles' };
	}
	const profiles = value.profiles;
	if (!isRecord(profiles)) {
		return { error: 'В файле профилей тестов OneScript нет объекта profiles' };
	}

	const result: Record<string, Record<string, string>> = {};
	for (const [name, body] of Object.entries(profiles)) {
		const profileName = name.trim();
		if (profileName === '' || !isRecord(body)) {
			return { error: `Профиль «${name}» должен быть объектом переменных` };
		}
		const env: Record<string, string> = {};
		for (const [key, variable] of Object.entries(body)) {
			const variableName = key.trim();
			if (variableName === '') {
				return { error: `У профиля «${profileName}» пустое имя переменной` };
			}
			if (variableName.toUpperCase() === 'PATH' || variableName.toUpperCase() === 'OVM_OSCRIPTBIN') {
				return { error: `Профиль «${profileName}» не задаёт ${variableName}: каталог OneScript выбирает расширение` };
			}
			if (typeof variable !== 'string') {
				return { error: `Переменная ${variableName} профиля «${profileName}» должна быть строкой` };
			}
			env[variableName] = variable;
		}
		result[profileName] = env;
	}
	return { profiles: result };
}

/**
 * Добавляет в файл пустой профиль. Переменные не заполняет.
 *
 * @param text - Текущий текст файла; нет файла — создаётся новый
 * @param name - Имя профиля
 * @returns Новый текст либо ошибка
 */
export function withOnescriptTestProfile(
	text: string | undefined,
	name: string
): { text: string } | OnescriptTestProfilesError {
	const profileName = name.trim();
	if (profileName === '') {
		return { error: 'Укажите имя профиля' };
	}
	let root: Record<string, unknown>;
	if (text === undefined || text.trim() === '') {
		root = { profiles: {} };
	} else {
		let value: unknown;
		try {
			value = JSON.parse(text) as unknown;
		} catch {
			return { error: 'Файл профилей тестов OneScript не разобран' };
		}
		if (!isRecord(value) || (value.profiles !== undefined && !isRecord(value.profiles))) {
			return { error: 'В файле профилей тестов OneScript нет объекта profiles' };
		}
		const profiles = isRecord(value.profiles) ? { ...value.profiles } : {};
		root = { ...value, profiles };
	}
	const profiles = root.profiles;
	if (!isRecord(profiles)) {
		return { error: 'В файле профилей тестов OneScript нет объекта profiles' };
	}
	if (Object.hasOwn(profiles, profileName)) {
		return { error: 'Такой профиль уже есть' };
	}
	profiles[profileName] = {};
	return { text: `${JSON.stringify(root, null, '\t')}\n` };
}

/**
 * Читает профили проекта. Отсутствие файла — не ошибка.
 *
 * @param root - Корень проекта
 */
export async function readOnescriptTestProfiles(
	root: string
): Promise<OnescriptTestProfiles | OnescriptTestProfilesError | undefined> {
	try {
		const text = await fs.readFile(onescriptTestProfilesPath(root), 'utf8');
		return parseOnescriptTestProfiles(text);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return undefined;
		}
		return { error: 'Не прочитан файл профилей тестов OneScript' };
	}
}

/**
 * Окружение плана запуска. Набор переменных действует только на тесты OneScript.
 *
 * @param adapterId - Идентификатор адаптера
 * @param profile - Переменные активного профиля; без профиля не заданы
 * @param planEnv - Переменные, которые план уже принёс сам
 */
export function onescriptProfileEnv(
	adapterId: string,
	profile: Record<string, string> | undefined,
	planEnv: NodeJS.ProcessEnv | undefined
): NodeJS.ProcessEnv | undefined {
	if (adapterId !== 'onescript' || profile === undefined) {
		return planEnv;
	}
	return { ...planEnv, ...profile };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
