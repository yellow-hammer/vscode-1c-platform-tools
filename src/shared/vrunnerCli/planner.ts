/**
 * Планирование команд vrunner: намерения → аргументы CLI.
 *
 * Чистый модуль без vscode и файловой системы: всё, что зависит от среды
 * (версия vrunner, активный профиль, временные параметры, формат файлов
 * настроек), передаётся входными данными. Так правила приоритета параметров
 * проверяются юнит-тестами.
 */

import { VRunnerIntent } from './intents';
import { selectCliAdapter } from './index';
import { VRunnerVersion, VRUNNER_FEATURES, isAtLeast } from '../vrunnerVersion';

/** Формат файла настроек vanessa-runner. */
export type SettingsFileFormat = 'v2' | 'v3' | 'unknown';

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
	/** Формат файла настроек: нужен, чтобы не передавать файл чужой версии. */
	settingsFormat: (settingsFile: string) => SettingsFileFormat;
}

/** Результат планирования. */
export interface PlanResult {
	/** Команды vrunner (каждая — массив аргументов). */
	steps: string[][];
	/** Замечания о применённых и отброшенных параметрах. */
	notices: string[];
}

/**
 * Убирает из массива аргументов перечисленные флаги вместе со значениями.
 *
 * @param args - Аргументы вида ['--flag', 'value', ...]
 * @param flags - Имена исключаемых флагов
 * @returns Аргументы без исключённых флагов
 */
export function stripOverrideFlags(args: string[], flags: string[]): string[] {
	const result: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (flags.includes(args[i])) {
			i++; // пропускаем и значение флага
			continue;
		}
		result.push(args[i]);
	}
	return result;
}

/**
 * Маскирует секреты в аргументах временных параметров для вывода.
 *
 * @param args - Аргументы вида ['--flag', 'value', ...]
 * @returns Копия с заменённым значением --db-pwd
 */
export function maskOverrideSecrets(args: string[]): string[] {
	return args.map((arg, index) => (index > 0 && args[index - 1] === '--db-pwd' ? '••••' : arg));
}

/**
 * Убирает `--settings` с файлом формата 2.x из команды vanessa-runner 3.x.
 *
 * vanessa-runner 3 — другой инструмент с другим форматом настроек: файл 2.x он
 * не понимает, а расширение его не конвертирует.
 *
 * @param args - Аргументы команды
 * @param settingsFormat - Определение формата файла
 * @param notices - Список замечаний (пополняется при вырезании)
 * @returns Аргументы без `--settings` формата 2.x (или те же)
 */
function stripV2SettingsOnCli3(
	args: string[],
	settingsFormat: PlanContext['settingsFormat'],
	notices: string[]
): string[] {
	const idx = args.indexOf('--settings');
	if (idx === -1 || idx + 1 >= args.length) {
		return args;
	}
	const settingsFile = args[idx + 1];
	if (settingsFormat(settingsFile) !== 'v2') {
		return args;
	}

	notices.push(
		`Файл настроек ${settingsFile} в формате vanessa-runner 2.x не передан: ` +
		'установлен vanessa-runner 3.x, который читает autumn-properties.json.'
	);
	const copy = [...args];
	copy.splice(idx, 2);
	return copy;
}

/**
 * Строит команды vrunner из намерений.
 *
 * Правила приоритета: явный файл настроек вызова отменяет временные параметры
 * профиля; явная строка подключения исключает из них подключение к ИБ; файл
 * настроек чужого формата не передаётся ни в одну сторону.
 *
 * @param intents - Намерения (каждое может развернуться в несколько команд)
 * @param context - Данные окружения (версия, профиль, параметры вызова)
 * @returns Команды и замечания планирования
 */
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

export function planIntents(intents: VRunnerIntent[], context: PlanContext): PlanResult {
	const notices: string[] = [];
	const adapter = selectCliAdapter(context.version);
	const cli3 = context.version !== undefined && isAtLeast(context.version, VRUNNER_FEATURES.cli3);

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
	let settingsParam = settingsFileToUse ? ['--settings', settingsFileToUse] : [];

	// Зеркально stripV2SettingsOnCli3: файл формата 3.x роняет vanessa-runner
	// 2.x на командах, читающих секции настроек
	if (!cli3 && settingsParam.length === 2 && context.settingsFormat(settingsParam[1]) === 'v3') {
		notices.push(
			`Файл настроек ${settingsParam[1]} в формате vanessa-runner 3.x не передан: ` +
			'установлен vanessa-runner 2.x.'
		);
		settingsParam = [];
	}

	const steps: string[][] = [];
	for (const raw of intents) {
		const intent = withoutIncrementOnCli2(raw, cli3, notices);
		const base = intent.common ?? [];
		const extra = [
			// не дублируем --settings, если он уже задан в намерении
			...(settingsParam.length > 0 && !base.includes('--settings') ? settingsParam : []),
			...overrides,
		];
		const merged: VRunnerIntent = extra.length > 0
			? { ...intent, common: [...base, ...extra] }
			: intent;
		for (const step of adapter.plan(merged)) {
			steps.push(cli3 ? stripV2SettingsOnCli3(step, context.settingsFormat, notices) : step);
		}
	}

	return { steps, notices };
}
