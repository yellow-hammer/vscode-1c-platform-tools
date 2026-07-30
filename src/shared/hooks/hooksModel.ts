/**
 * Модель хуков команд: что выполняется до и после команды расширения.
 *
 * Файл `.1cpt/hooks.json` - таблица «идентификатор команды - шаги», где шаг
 * это командная строка. Формат допускает короткую запись (строка вместо
 * объекта и одиночный шаг вместо массива), поэтому разбор приводит всё к
 * одному виду, а запись сохраняет короткую форму там, где она не теряет
 * данных: файл правят и руками.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { HOOKS_SCHEMA } from '../../features/serviceFiles/schemaUrls';

/** Когда выполняется шаг */
export type HookPhase = 'pre' | 'post' | 'onError';

/** Все фазы в порядке отображения */
export const HOOK_PHASES: HookPhase[] = ['pre', 'post', 'onError'];

/** Шаг хука: командная строка с настройками выполнения */
export interface HookAction {
	/** Командная строка, выполняется в корне проекта */
	command: string;
	/** Не прерывать цепочку хука при ошибке шага */
	continueOnError?: boolean;
	/** Ограничение времени в секундах */
	timeout?: number;
}

/** Шаги команды по фазам */
export type HookEntry = Partial<Record<HookPhase, HookAction[]>>;

/** Содержимое `.1cpt/hooks.json` в нормализованном виде */
export interface HooksModel {
	version?: number;
	/** Ключ - идентификатор команды или `*` для всех команд */
	hooks: Record<string, HookEntry>;
}

/** Путь файла относительно корня проекта */
export const HOOKS_FILE_REL_PATH = '.1cpt/hooks.json';

/** Ключ, действующий на все команды */
export const HOOKS_WILDCARD = '*';

/** Текущая версия формата файла */
export const HOOKS_FILE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAction(raw: unknown): HookAction | undefined {
	// Пустая строка сохраняется: шаг могли добавить и не заполнить, а молча
	// терять введённое нельзя. При выполнении такие шаги пропускаются
	if (typeof raw === 'string') {
		return { command: raw.trim() };
	}
	if (!isRecord(raw) || typeof raw.command !== 'string') {
		return undefined;
	}
	const action: HookAction = { command: raw.command.trim() };
	if (raw.continueOnError === true) {
		action.continueOnError = true;
	}
	if (typeof raw.timeout === 'number' && Number.isFinite(raw.timeout) && raw.timeout > 0) {
		action.timeout = raw.timeout;
	}
	return action;
}

function normalizeSteps(raw: unknown): HookAction[] {
	const list = Array.isArray(raw) ? raw : [raw];
	return list.map(normalizeAction).filter((action): action is HookAction => action !== undefined);
}

/**
 * Приводит содержимое файла к нормализованному виду.
 *
 * @param raw - Разобранный JSON файла
 * @returns Модель хуков; неизвестные записи отбрасываются
 */
export function normalizeHooks(raw: unknown): HooksModel {
	const source = isRecord(raw) && isRecord(raw.hooks) ? raw.hooks : {};
	const hooks: Record<string, HookEntry> = {};
	for (const [commandId, rawEntry] of Object.entries(source)) {
		if (!isRecord(rawEntry)) {
			continue;
		}
		const entry: HookEntry = {};
		for (const phase of HOOK_PHASES) {
			if (rawEntry[phase] === undefined) {
				continue;
			}
			const steps = normalizeSteps(rawEntry[phase]);
			if (steps.length > 0) {
				entry[phase] = steps;
			}
		}
		if (Object.keys(entry).length > 0) {
			hooks[commandId] = entry;
		}
	}
	return { version: HOOKS_FILE_VERSION, hooks };
}

/**
 * Сериализует модель в текст файла.
 *
 * Шаг без дополнительных настроек пишется строкой, одиночный шаг - без
 * массива: так файл остаётся читаемым при правке руками.
 *
 * @param model - Модель хуков
 * @returns Текст JSON с ссылкой на схему
 */
export function serializeHooks(model: HooksModel): string {
	const hooks: Record<string, Record<string, unknown>> = {};
	for (const [commandId, entry] of Object.entries(model.hooks)) {
		const compact: Record<string, unknown> = {};
		for (const phase of HOOK_PHASES) {
			const steps = entry[phase];
			if (!steps || steps.length === 0) {
				continue;
			}
			const items = steps.map((step) =>
				step.continueOnError === undefined && step.timeout === undefined ? step.command : step
			);
			compact[phase] = items.length === 1 ? items[0] : items;
		}
		if (Object.keys(compact).length > 0) {
			hooks[commandId] = compact;
		}
	}
	const content = { $schema: HOOKS_SCHEMA, version: HOOKS_FILE_VERSION, hooks };
	return `${JSON.stringify(content, null, 4)}\n`;
}

/**
 * Путь к файлу хуков проекта.
 *
 * @param workspaceRoot - Корень проекта
 * @returns Абсолютный путь к `.1cpt/hooks.json`
 */
export function hooksFilePath(workspaceRoot: string): string {
	return path.join(workspaceRoot, ...HOOKS_FILE_REL_PATH.split('/'));
}

/**
 * Читает хуки проекта.
 *
 * @param workspaceRoot - Корень проекта
 * @returns Модель хуков; для отсутствующего файла - пустая
 */
export async function readHooks(workspaceRoot: string): Promise<HooksModel> {
	try {
		const text = await fs.readFile(hooksFilePath(workspaceRoot), 'utf8');
		return normalizeHooks(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
	} catch {
		return { version: HOOKS_FILE_VERSION, hooks: {} };
	}
}

/**
 * Записывает хуки проекта, создавая каталог при необходимости.
 *
 * @param workspaceRoot - Корень проекта
 * @param model - Модель хуков
 */
export async function writeHooks(workspaceRoot: string, model: HooksModel): Promise<void> {
	const fullPath = hooksFilePath(workspaceRoot);
	await fs.mkdir(path.dirname(fullPath), { recursive: true });
	await fs.writeFile(fullPath, serializeHooks(model), 'utf8');
}

/**
 * Считает шаги команды по фазам: для подписи в дереве.
 *
 * @param entry - Шаги команды
 * @returns Строка вида «до 2, после 1»
 */
export function describeHookEntry(entry: HookEntry): string {
	const parts: string[] = [];
	const labels: Record<HookPhase, string> = { pre: 'до', post: 'после', onError: 'при ошибке' };
	for (const phase of HOOK_PHASES) {
		const steps = entry[phase];
		if (steps && steps.length > 0) {
			parts.push(`${labels[phase]} ${steps.length}`);
		}
	}
	return parts.join(', ');
}
