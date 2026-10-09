/**
 * Окружение процесса тестов OneScript: слои файлов, подстановки, снятие переменных.
 *
 * Не знает про VS Code. Каталог движка ставится в PATH последним.
 */

import { envName, withSelectedEngine } from '../../../shared/ovmPaths';
import { type EnvMap, type OnescriptProfileFile } from './profilesFile';

const SUBSTITUTION = /\$\{([^}]+)\}/g;

/** Профиль действует на раннеры OneScript, не на тесты 1С. */
export function profileAppliesTo(adapterId: string): boolean {
	return adapterId === 'onescript' || adapterId === 'onebdd';
}

/**
 * Окружение плана. Тесты 1С и прогон без профиля получают тот же объект.
 * С профилем переменные плана ложатся поверх окружения профиля.
 *
 * @param adapterId - Идентификатор адаптера
 * @param resolved - Окружение выбранного профиля; без профиля не задано
 * @param planEnv - Переменные, которые план уже принёс сам
 * @returns Окружение шага и признак, что оно уже полное (движок внутри)
 */
export function envForAdapter(
	adapterId: string,
	resolved: NodeJS.ProcessEnv | undefined,
	planEnv: NodeJS.ProcessEnv | undefined
): { env: NodeJS.ProcessEnv | undefined; complete: boolean } {
	if (!profileAppliesTo(adapterId) || resolved === undefined) {
		return { env: planEnv, complete: false };
	}
	if (planEnv === undefined) {
		return { env: resolved, complete: true };
	}
	const env: NodeJS.ProcessEnv = { ...resolved };
	for (const [name, value] of Object.entries(planEnv)) {
		env[envName(env, name)] = value;
	}
	return { env, complete: true };
}

/** Успешный расчёт профиля. */
export interface ResolvedOnescriptEnv {
	env: NodeJS.ProcessEnv;
	/** Имена заданных переменных, без значений. */
	variables: string[];
}

/** Отказ расчёта. */
export interface ResolvedOnescriptEnvError {
	error: string;
}

/**
 * Собирает окружение выбранного профиля.
 *
 * Слои от слабого к сильному: процесс, корневой env общего файла, корневой env
 * личного, env профиля общего, env профиля личного, каталог движка.
 *
 * @param options.processEnv - Окружение процесса VS Code
 * @param options.file - Общий и личный файлы уже слиты
 * @param options.profileName - Имя выбранного профиля
 * @param options.gitBranch - Имя каталога ветки; нет репозитория — не задано
 * @param options.engineBinDir - Каталог bin движка; нет абсолютного пути — не задан
 */
export function resolveOnescriptEnv(options: {
	processEnv: NodeJS.ProcessEnv;
	file: OnescriptProfileFile;
	profileName: string;
	gitBranch: string | undefined;
	engineBinDir: string | undefined;
}): ResolvedOnescriptEnv | ResolvedOnescriptEnvError {
	const profile = options.file.profiles[options.profileName];
	if (profile === undefined) {
		return { error: `Профиль ${options.profileName} не найден` };
	}
	const env: NodeJS.ProcessEnv = { ...options.processEnv };
	const variables = new Set<string>();
	const layers = [options.file.env, profile.env];
	for (const layer of layers) {
		const applied = applyLayer(env, layer, options.gitBranch, variables);
		if (applied !== undefined) {
			return applied;
		}
	}
	return { env: withSelectedEngine(env, options.engineBinDir), variables: [...variables] };
}

function applyLayer(
	env: NodeJS.ProcessEnv,
	layer: EnvMap | undefined,
	gitBranch: string | undefined,
	variables: Set<string>
): ResolvedOnescriptEnvError | undefined {
	if (layer === undefined) {
		return undefined;
	}
	for (const [rawName, rawValue] of Object.entries(layer)) {
		const key = envName(env, rawName);
		if (rawValue === null) {
			delete env[key];
			variables.delete(key);
			continue;
		}
		const text = typeof rawValue === 'string' ? substitute(rawValue, gitBranch) : String(rawValue);
		if (typeof text !== 'string') {
			return text;
		}
		env[key] = text;
		variables.add(key);
	}
	return undefined;
}

function substitute(value: string, gitBranch: string | undefined): string | ResolvedOnescriptEnvError {
	let error: string | undefined;
	const result = value.replace(SUBSTITUTION, (full, name: string) => {
		if (name === 'gitBranch' && gitBranch !== undefined) {
			return gitBranch;
		}
		error = `Неизвестная подстановка ${full}`;
		return full;
	});
	return error === undefined ? result : { error };
}
