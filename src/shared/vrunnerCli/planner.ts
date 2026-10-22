/**
 * Планирование команд vrunner: намерения → аргументы CLI.
 *
 * Без vscode и файловой системы: версия runner, профиль и параметры вызова
 * приходят во входных данных.
 */

import { quoteFileIbConnection } from '../ibConnectionPath';
import { VRunnerIntent } from './intents';
import { selectCliAdapter } from './index';
import { isV3Cli, VRunnerVersion } from '../vrunnerVersion';

/** Входные данные планирования. */
export interface PlanContext {
	/** Установленная версия vrunner (undefined — не определена). */
	version: VRunnerVersion | undefined;
	/** Аргументы временных параметров активного профиля. */
	overrideArgs: string[];
	/** Файл настроек активного профиля (пусто — базовый профиль без --settings). */
	activeSettingsFile?: string;
	/** Файл настроек, заданный в вызове. */
	settingsFile?: string;
	/** Строка подключения к ИБ, заданная в вызове. */
	explicitIbConnection?: string;
}

/** Результат планирования. */
export interface PlanResult {
	/** Команды vrunner (каждая — массив аргументов). */
	steps: string[][];
	/** Замечания о применённых и отброшенных параметрах. */
	notices: string[];
}

/**
 * Аргумент — именованный флаг: `--flag` или `--flag=value`.
 *
 * @param arg - Один токен argv
 * @param flag - Имя с ведущими `--`, без `=`
 */
function isNamedFlag(arg: string, flag: string): boolean {
	return arg === flag || arg.startsWith(`${flag}=`);
}

/**
 * Есть ли в argv любой из перечисленных флагов (обе формы записи).
 *
 * @param args - Аргументы
 * @param flags - Имена с ведущими `--`
 */
function hasAnyFlag(args: readonly string[], flags: readonly string[]): boolean {
	return args.some((arg) => flags.some((flag) => isNamedFlag(arg, flag)));
}

/**
 * Значение флага из argv: `--flag value` или `--flag=value`.
 *
 * @param args - Аргументы
 * @param flag - Имя с ведущими `--`
 */
function valueOfFlag(args: readonly string[], flag: string): string | undefined {
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === flag) {
			return args[index + 1];
		}
		if (arg.startsWith(`${flag}=`)) {
			return arg.slice(flag.length + 1);
		}
	}
	return undefined;
}

/** В аргументах уже есть флаг подключения к информационной базе. */
function hasIbConnectionFlag(args: readonly string[]): boolean {
	return hasAnyFlag(args, ['--ibconnection']);
}

/** Значение `--ibconnection` в аргументах команды. */
function ibConnectionFromArgs(args: readonly string[]): string | undefined {
	return valueOfFlag(args, '--ibconnection');
}

/**
 * Дописывает строку подключения из вызова, если команда ещё не несёт свою.
 *
 * @param commonArgs - Сквозные опции намерения
 * @param connection - Строка подключения из вызова
 * @returns Опции с `--ibconnection` либо те же
 */
function withExplicitIbConnection(commonArgs: readonly string[], connection: string | undefined): string[] {
	if (!connection || hasIbConnectionFlag(commonArgs)) {
		return [...commonArgs];
	}
	return [...commonArgs, '--ibconnection', quoteFileIbConnection(connection)];
}

/**
 * Все шаги плана выполняются в запрошенной базе.
 *
 * Команды, у которых флага подключения нет (кластер, проверка EDT), отвечают false:
 * строка из вызова до них не доходит.
 *
 * @param steps - Команды плана
 * @param connection - Строка подключения из вызова
 */
export function stepsUseIbConnection(steps: readonly string[][], connection: string): boolean {
	const expected = quoteFileIbConnection(connection);
	return steps.length > 0 && steps.every((step) => ibConnectionFromArgs(step) === expected);
}

/**
 * Убирает из массива аргументов перечисленные флаги вместе со значениями.
 *
 * Понимает обе формы: `--flag value` и `--flag=value`.
 *
 * @param args - Аргументы
 * @param flags - Имена исключаемых флагов с ведущими `--`
 * @returns Аргументы без исключённых флагов
 */
export function stripOverrideFlags(args: string[], flags: string[]): string[] {
	const result: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const matched = flags.find((flag) => isNamedFlag(arg, flag));
		if (matched !== undefined) {
			if (arg === matched) {
				i++; // `--flag value` — пропускаем следующий токен
			}
			continue;
		}
		result.push(arg);
	}
	return result;
}

/**
 * Маскирует секреты в аргументах временных параметров для вывода.
 *
 * Понимает `--db-pwd value` и `--db-pwd=value`.
 *
 * @param args - Аргументы
 * @returns Копия с заменённым значением --db-pwd
 */
export function maskOverrideSecrets(args: string[]): string[] {
	const result: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--db-pwd') {
			result.push(arg);
			if (i + 1 < args.length) {
				result.push('••••');
				i++;
			}
			continue;
		}
		if (arg.startsWith('--db-pwd=')) {
			result.push('--db-pwd=••••');
			continue;
		}
		result.push(arg);
	}
	return result;
}

/**
 * Снимает инкремент с загрузки без обновления БД на vanessa-runner 2.x.
 *
 * Список изменённых файлов там собирает `update-dev`, а он всегда завершается обновлением
 * конфигурации БД. Чтобы команда работала одинаково на обеих версиях, загружаем исходники
 * целиком: результат тот же, отличается только объём работы, и об этом говорим замечанием.
 *
 * @param intent - Исходное намерение
 * @param cli3 - Установлен vanessa-runner 3.x
 * @param notices - Замечания планирования (пополняются при снятии инкремента)
 */
function withoutIncrementOnCli2(intent: VRunnerIntent, cli3: boolean, notices: string[]): VRunnerIntent {
	if (cli3 || intent.kind !== 'cf.loadFromSrc' || !intent.increment || intent.updateDb) {
		return intent;
	}
	notices.push(
		'Загрузка изменений без обновления конфигурации БД в vanessa-runner 2.x не выражается: ' +
		'исходники загружены целиком.'
	);
	return { ...intent, increment: false };
}

/**
 * Строит команды vrunner из намерений.
 *
 * Явный файл настроек вызова отменяет временные параметры профиля; явная
 * строка подключения исключает из них подключение к ИБ и уходит в
 * `--ibconnection`.
 *
 * @param intents - Намерения (каждое может развернуться в несколько команд)
 * @param context - Данные окружения (версия, профиль, параметры вызова)
 * @returns Команды и замечания планирования
 */
export function planIntents(intents: VRunnerIntent[], context: PlanContext): PlanResult {
	const notices: string[] = [];
	const adapter = selectCliAdapter(context.version);
	const cli3 = isV3Cli(context.version);

	// «Перекрытия профиля» — общий термин: временные параметры интерфейса,
	// env.local.json и значения активного профиля с ${gitBranch}
	let overrides = context.overrideArgs;
	if (overrides.length > 0 && context.settingsFile) {
		notices.push('Перекрытия активного профиля не применены: в вызове задан settingsFile.');
		overrides = [];
	} else if (overrides.length > 0 && context.explicitIbConnection) {
		const filtered = stripOverrideFlags(overrides, ['--ibconnection', '--db-user', '--db-pwd']);
		if (filtered.length !== overrides.length) {
			notices.push(
				'Из перекрытий профиля исключено подключение к ИБ: ' +
				'в вызове задана явная строка подключения.'
			);
		}
		overrides = filtered;
	}
	if (overrides.length > 0) {
		notices.push(`Применены перекрытия профиля: ${maskOverrideSecrets(overrides).join(' ')}.`);
	}

	// Именованный профиль подставляется во ВСЕ команды через --settings; для
	// базового профиля параметр пустой (vrunner читает файл настроек сам)
	const settingsFileToUse = context.settingsFile ?? context.activeSettingsFile;
	const settingsParam = settingsFileToUse ? ['--settings', settingsFileToUse] : [];

	const steps: string[][] = [];
	for (const raw of intents) {
		const intent = withoutIncrementOnCli2(raw, cli3, notices);
		const base = intent.common ?? [];
		const extra = [
			// не дублируем --settings, если он уже задан в намерении
			...(settingsParam.length > 0 && !hasAnyFlag(base, ['--settings']) ? settingsParam : []),
			...overrides,
		];
		const commonArgs = withExplicitIbConnection([...base, ...extra], context.explicitIbConnection);
		const merged: VRunnerIntent = commonArgs.length > 0
			? { ...intent, common: commonArgs }
			: intent;
		for (const step of adapter.plan(merged)) {
			steps.push(step);
		}
	}

	if (context.explicitIbConnection && stepsUseIbConnection(steps, context.explicitIbConnection)) {
		notices.push(`Подключение из вызова: ${quoteFileIbConnection(context.explicitIbConnection)}.`);
	}

	return { steps, notices };
}
